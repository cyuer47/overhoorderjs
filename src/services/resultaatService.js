import { getDatabase } from "../config/database.js";

/**
 * Resultaat (Result/Answer) service - handles all result database operations
 */

export async function submitAnswer(sessieId, leerlingId, vraagId, antwoord) {
  const db = getDatabase();

  // Check if already answered
  const existing = await db.get(
    "SELECT id FROM resultaten WHERE sessie_id = ? AND vraag_id = ? AND leerling_id = ?",
    sessieId,
    vraagId,
    leerlingId,
  );

  if (existing) {
    return { success: false, message: "already answered" };
  }

  // Auto-grade: fetch correct answer and compare
  const correctRow = await db.get(
    "SELECT antwoord FROM vragen WHERE id = ?",
    vraagId,
  );

  const normalize = (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  let status = "onbekend";
  let points = 0;

  if (correctRow) {
    if (normalize(correctRow.antwoord) === normalize(antwoord)) {
      status = "goed";
      points = 10;
    }
  }

  await db.run(
    "INSERT INTO resultaten (sessie_id, leerling_id, vraag_id, antwoord, antwoord_given, status, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    sessieId,
    leerlingId,
    vraagId,
    antwoord,
    antwoord,
    status,
    points,
  );

  return { success: true, status, autoGraded: status === "goed" };
}

export async function gradeAnswer(resultaatId, status) {
  const db = getDatabase();

  let points = 0;
  switch (status) {
    case "goed":
      points = 10;
      break;
    case "typfout":
      points = 5;
      break;
    case "fout":
    default:
      points = 0;
  }

  await db.run(
    "UPDATE resultaten SET status = ?, points = ? WHERE id = ?",
    status,
    points,
    resultaatId,
  );

  // Return the session ID for broadcasting
  const result = await db.get(
    "SELECT sessie_id FROM resultaten WHERE id = ?",
    resultaatId,
  );
  return result?.sessie_id || null;
}

export async function getSessionScoreboard(sessieId, klasId) {
  const db = getDatabase();
  return db.all(
    `SELECT l.id as leerling_id, l.naam, COALESCE(SUM(r.points),0) as points, COUNT(r.id) as answers
     FROM leerlingen l
     LEFT JOIN resultaten r ON r.leerling_id = l.id AND r.sessie_id = ?
     WHERE l.klas_id = ?
     GROUP BY l.id
     ORDER BY points DESC, l.naam ASC`,
    sessieId,
    klasId,
  );
}

export async function getRecentAnswers(sessieId) {
  const db = getDatabase();
  return db.all(
    `SELECT r.id, r.leerling_id, l.naam as leerling, r.antwoord_given as antwoord, r.status, r.points, r.created_at, v.vraag as vraag
     FROM resultaten r
     JOIN leerlingen l ON l.id = r.leerling_id
     LEFT JOIN vragen v ON v.id = r.vraag_id
     WHERE r.sessie_id = ?
     ORDER BY (CASE WHEN r.status IS NULL OR r.status = 'onbekend' THEN 0 ELSE 1 END), r.created_at DESC
     LIMIT 50`,
    sessieId,
  );
}

export async function getPendingAnswerCount(sessieId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND (status IS NULL OR status = 'onbekend')",
    sessieId,
  );
  return row?.c || 0;
}

export async function getAnswerCountForQuestion(sessieId, vraagId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
    sessieId,
    vraagId,
  );
  return row?.c || 0;
}

export async function getStudentScore(sessieId, leerlingId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT COALESCE(SUM(points),0) as score FROM resultaten WHERE sessie_id = ? AND leerling_id = ?",
    sessieId,
    leerlingId,
  );
  return row?.score || 0;
}

export async function getStudentAnswerCount(sessieId, leerlingId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND leerling_id = ?",
    sessieId,
    leerlingId,
  );
  return row?.c || 0;
}

export async function getStudentAnswerForQuestion(
  sessieId,
  vraagId,
  leerlingId,
) {
  const db = getDatabase();
  return db.get(
    "SELECT id, status, points, antwoord_given, created_at FROM resultaten WHERE sessie_id = ? AND vraag_id = ? AND leerling_id = ?",
    sessieId,
    vraagId,
    leerlingId,
  );
}

export async function getSessionResults(sessieId) {
  const db = getDatabase();
  return db.all(
    `SELECT l.naam as leerling, v.vraag, COALESCE(r.antwoord_given, r.antwoord) as gegeven_antwoord, COALESCE(r.status, 'onbekend') as status, r.created_at
     FROM resultaten r
     JOIN leerlingen l ON l.id = r.leerling_id
     LEFT JOIN vragen v ON v.id = r.vraag_id
     WHERE r.sessie_id = ?
     ORDER BY r.created_at ASC`,
    sessieId,
  );
}

export async function deleteStudentAnswer(sessieId, leerlingId) {
  const db = getDatabase();
  await db.run(
    "DELETE FROM resultaten WHERE leerling_id = ? AND sessie_id = ?",
    leerlingId,
    sessieId,
  );
}
