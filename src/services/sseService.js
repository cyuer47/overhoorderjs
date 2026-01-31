import { getDatabase } from "../config/database.js";

/**
 * Server-Sent Events (SSE) service for real-time session updates
 */

// Map of sessionId -> Set(response objects)
const sseClients = new Map();

// Map of leerling_id -> { status, focused, last_seen }
const presence = new Map();

/**
 * Register a client for SSE stream
 */
export function registerSSEClient(sessionId, res, isTeacher) {
  const clients = sseClients.get(sessionId) || new Set();
  res._isTeacher = isTeacher;
  clients.add(res);
  sseClients.set(sessionId, clients);
}

/**
 * Unregister a client from SSE stream
 */
export function unregisterSSEClient(sessionId, res) {
  const clients = sseClients.get(sessionId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) {
      sseClients.delete(sessionId);
    }
  }
}

/**
 * Get presence information for a student
 */
export function getPresence(leerlingId) {
  return presence.get(String(leerlingId));
}

/**
 * Update presence information for a student
 */
export function updatePresence(leerlingId, status) {
  const p = {
    status: String(status || "non-actief"),
    focused: String(status || "").toLowerCase() === "actief",
    last_seen: new Date().toISOString(),
  };
  presence.set(String(leerlingId), p);
}

/**
 * Send SSE event to all connected clients for a session
 */
export function sendSSE(sessionId, eventName, data) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;

  const teacherPayload = JSON.stringify(data || {});
  const studentPayload = JSON.stringify(
    sanitizeSessionPayloadForStudents(data || {}),
  );

  for (const res of clients) {
    try {
      if (res._isTeacher) {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${teacherPayload}\n\n`);
      } else {
        // For students: send lightweight update event
        res.write(`event: update\n`);
        res.write(`data: ${studentPayload}\n\n`);
      }
    } catch (err) {
      console.warn("Error writing SSE to client:", err.message);
    }
  }
}

/**
 * Build complete session payload with all related data
 */
export async function buildSessionPayload(sessionId) {
  const db = getDatabase();

  const sess = await db.get(
    "SELECT s.*, k.naam as klasnaam, k.klascode FROM sessies s JOIN klassen k ON k.id = s.klas_id WHERE s.id = ?",
    sessionId,
  );

  if (!sess) return null;

  // Normalize some fields for the client
  try {
    sess.round_seen = sess.round_seen ? JSON.parse(sess.round_seen) : [];
  } catch (e) {
    sess.round_seen = sess.round_seen || [];
  }
  sess.actief = Boolean(sess.actief);
  if (sess.started_at) sess.started_at = String(sess.started_at);
  if (sess.question_start_time)
    sess.question_start_time = String(sess.question_start_time);

  const currentQuestion = sess.current_question_id
    ? await db.get(
        "SELECT id, vraag, antwoord FROM vragen WHERE id = ?",
        sess.current_question_id,
      )
    : null;

  const answerCountRow = currentQuestion
    ? await db.get(
        "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
        sessionId,
        currentQuestion.id,
      )
    : { c: 0 };

  const leerlingen = await db.all(
    "SELECT id, naam FROM leerlingen WHERE klas_id = ?",
    sess.klas_id,
  );

  // Attach ephemeral presence info
  for (const l of leerlingen) {
    const p = getPresence(String(l.id));
    l.last_seen = p ? p.last_seen : null;
    l.online = p ? p.status === "actief" : false;
    l.focused = p ? Boolean(p.focused) : false;
  }

  const totalStudents = await db.get(
    "SELECT COUNT(*) as c FROM leerlingen WHERE klas_id = ?",
    sess.klas_id,
  );

  const scoreboard = await db.all(
    `SELECT l.id as leerling_id, l.naam, COALESCE(SUM(r.points),0) as points, COUNT(r.id) as answers
     FROM leerlingen l
     LEFT JOIN resultaten r ON r.leerling_id = l.id AND r.sessie_id = ?
     WHERE l.klas_id = ?
     GROUP BY l.id
     ORDER BY points DESC, l.naam ASC`,
    sessionId,
    sess.klas_id,
  );

  const recent = await db.all(
    `SELECT r.id, r.leerling_id, l.naam as leerling, r.antwoord_given as antwoord, r.status, r.points, r.created_at, v.vraag as vraag
     FROM resultaten r
     JOIN leerlingen l ON l.id = r.leerling_id
     LEFT JOIN vragen v ON v.id = r.vraag_id
     WHERE r.sessie_id = ?
     ORDER BY (CASE WHEN r.status IS NULL OR r.status = 'onbekend' THEN 0 ELSE 1 END), r.created_at DESC
     LIMIT 50`,
    sessionId,
  );

  const pendingRow = await db.get(
    "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND (status IS NULL OR status = 'onbekend')",
    sessionId,
  );

  return {
    sess,
    currentQuestion,
    answerCount: answerCountRow.c || 0,
    total_students: totalStudents.c || 0,
    leerlingen,
    scoreboard,
    recentAnswers: recent,
    pending_count: pendingRow ? pendingRow.c || 0 : 0,
  };
}

/**
 * Broadcast session update to all connected clients
 */
export async function broadcastSession(sessionId) {
  try {
    const payload = await buildSessionPayload(sessionId);
    if (!payload) return;
    sendSSE(sessionId, "session", payload);
  } catch (err) {
    console.error("broadcastSession error:", err);
  }
}

/**
 * Sanitize session payload for students (remove sensitive data)
 */
function sanitizeSessionPayloadForStudents(payload) {
  const out = Object.assign({}, payload || {});
  try {
    if (out.currentQuestion) {
      const cq = Object.assign({}, out.currentQuestion);
      // hide correct answer from students
      delete cq.antwoord;
      out.currentQuestion = cq;
    }

    if (Array.isArray(out.leerlingen)) {
      out.leerlingen = out.leerlingen.map((l) => ({
        id: l.id,
        online: l.online,
        focused: l.focused,
        last_seen: l.last_seen,
      }));
    }

    if (Array.isArray(out.scoreboard)) {
      out.scoreboard = out.scoreboard.map((r) => ({
        leerling_id: r.leerling_id,
        points: r.points,
        answers: r.answers,
      }));
    }

    if (Array.isArray(out.recentAnswers)) {
      out.recentAnswers = out.recentAnswers.map((r) => ({
        antwoord: r.antwoord,
        status: r.status,
        points: r.points,
        created_at: r.created_at,
        vraag: r.vraag,
      }));
    }
  } catch (e) {
    console.warn("Error sanitizing session payload:", e.message);
  }
  return out;
}
