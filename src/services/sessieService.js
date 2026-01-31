import { getDatabase } from "../config/database.js";

/**
 * Sessie (Session) service - handles all session database operations
 */

export async function createSessie(klasId, docentId, vragenlijstId) {
  const db = getDatabase();

  // Deactivate other sessions for this class
  await db.run("UPDATE sessies SET actief = 0 WHERE klas_id = ?", klasId);

  const result = await db.run(
    `INSERT INTO sessies (klas_id, docent_id, vragenlijst_id, actief, started_at, round_seen, prev_student_id, current_student_id, current_question_id)
     VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, json('[]'), NULL, NULL, NULL)`,
    klasId,
    docentId,
    vragenlijstId,
  );

  return result.lastID;
}

export async function getSessieById(sessieId) {
  const db = getDatabase();
  return db.get("SELECT * FROM sessies WHERE id = ?", sessieId);
}

export async function getSessieWithClassInfo(sessieId) {
  const db = getDatabase();
  const sess = await db.get(
    "SELECT s.*, k.naam as klasnaam, k.klascode FROM sessies s JOIN klassen k ON k.id = s.klas_id WHERE s.id = ?",
    sessieId,
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

  return sess;
}

export async function getSessieByIdAndDocent(sessieId, docentId) {
  const db = getDatabase();
  return db.get(
    "SELECT s.*, k.naam as klasnaam, k.klascode FROM sessies s JOIN klassen k ON k.id = s.klas_id WHERE s.id = ? AND s.docent_id = ?",
    sessieId,
    docentId,
  );
}

export async function getActiveSessieForKlas(klasId) {
  const db = getDatabase();
  return db.get(
    "SELECT * FROM sessies WHERE klas_id = ? AND actief = 1 LIMIT 1",
    klasId,
  );
}

export async function setCurrentQuestion(sessieId, vraagId) {
  const db = getDatabase();
  await db.run(
    "UPDATE sessies SET current_question_id = ?, question_start_time = CURRENT_TIMESTAMP WHERE id = ?",
    vraagId,
    sessieId,
  );
}

export async function clearCurrentQuestion(sessieId) {
  const db = getDatabase();
  await db.run(
    "UPDATE sessies SET current_question_id = NULL, question_start_time = NULL WHERE id = ?",
    sessieId,
  );
}

export async function stopSessie(sessieId) {
  const db = getDatabase();
  await db.run(
    "UPDATE sessies SET actief = 0, current_question_id = NULL, question_start_time = NULL WHERE id = ?",
    sessieId,
  );
}

export async function getAskedQuestions(sessieId) {
  const db = getDatabase();
  return db.all(
    "SELECT DISTINCT vraag_id FROM resultaten WHERE sessie_id = ?",
    sessieId,
  );
}

export async function clearCurrentQuestionAnswers(sessieId, vraagId) {
  const db = getDatabase();
  await db.run(
    "DELETE FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
    sessieId,
    vraagId,
  );
}
