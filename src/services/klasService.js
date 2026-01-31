import { getDatabase } from "../config/database.js";
import crypto from "crypto";

/**
 * Klas (Class) service - handles all class-related database operations
 */

export async function createKlas(docentId, naam, vak) {
  const db = getDatabase();
  const code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

  const result = await db.run(
    "INSERT INTO klassen (docent_id, naam, klascode, vak, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    [docentId, naam, code, vak || null],
  );

  return db.get("SELECT * FROM klassen WHERE id = ?", result.lastID);
}

export async function getKlasByIdAndDocent(klasId, docentId) {
  const db = getDatabase();
  return db.get(
    "SELECT * FROM klassen WHERE id = ? AND docent_id = ?",
    klasId,
    docentId,
  );
}

export async function getKlasByCode(code) {
  const db = getDatabase();
  return db.get("SELECT * FROM klassen WHERE klascode = ?", code);
}

export async function getKlassenByDocent(docentId) {
  const db = getDatabase();
  return db.all(
    "SELECT * FROM klassen WHERE docent_id = ? ORDER BY id DESC",
    docentId,
  );
}

export async function deleteKlas(klasId, docentId) {
  const db = getDatabase();

  // Verify ownership
  const klas = await getKlasByIdAndDocent(klasId, docentId);
  if (!klas) {
    throw new Error("Klas not found or unauthorized");
  }

  // Delete in order of dependencies with transaction
  await db.exec("PRAGMA foreign_keys = OFF;");
  await db.exec("BEGIN;");

  try {
    await db.run(
      "DELETE FROM resultaten WHERE sessie_id IN (SELECT id FROM sessies WHERE klas_id = ?)",
      klasId,
    );
    await db.run("DELETE FROM sessies WHERE klas_id = ?", klasId);
    await db.run("DELETE FROM vragen WHERE klas_id = ?", klasId);
    await db.run("DELETE FROM leerlingen WHERE klas_id = ?", klasId);
    await db.run("DELETE FROM vragenlijsten WHERE klas_id = ?", klasId);
    await db.run(
      "DELETE FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      docentId,
    );
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  } finally {
    await db.exec("PRAGMA foreign_keys = ON;");
  }
}

export async function getKlasWithDetails(klasId, docentId) {
  const db = getDatabase();
  const klas = await getKlasByIdAndDocent(klasId, docentId);
  if (!klas) return null;

  const leerlingen = await db.all(
    "SELECT id, naam FROM leerlingen WHERE klas_id = ? ORDER BY naam",
    klasId,
  );

  const vragenlijsten = await db.all(
    "SELECT id, naam FROM vragenlijsten WHERE klas_id = ? ORDER BY id DESC",
    klasId,
  );

  return { klas, leerlingen, vragenlijsten };
}

export async function deleteAllLeerlingenFromKlas(klasId, docentId) {
  const db = getDatabase();

  // Verify ownership
  const klas = await getKlasByIdAndDocent(klasId, docentId);
  if (!klas) {
    throw new Error("Klas not found or unauthorized");
  }

  await db.run("DELETE FROM leerlingen WHERE klas_id = ?", klasId);
}
