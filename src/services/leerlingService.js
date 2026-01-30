import { getDatabase } from "../config/database.js";

/**
 * Leerling (Student) service - handles all student database operations
 */

export async function createLeerling(klasId, naam) {
  const db = getDatabase();
  const result = await db.run(
    "INSERT INTO leerlingen (klas_id, naam) VALUES (?, ?)",
    klasId,
    naam,
  );
  return result.lastID;
}

export async function getLeerlingById(leerlingId) {
  const db = getDatabase();
  return db.get("SELECT id, naam FROM leerlingen WHERE id = ?", leerlingId);
}

export async function getLeerlingByIdAndKlas(leerlingId, klasId) {
  const db = getDatabase();
  return db.get(
    "SELECT id, naam FROM leerlingen WHERE id = ? AND klas_id = ?",
    leerlingId,
    klasId,
  );
}

export async function getLeerlingenByKlas(klasId) {
  const db = getDatabase();
  return db.all(
    "SELECT id, naam FROM leerlingen WHERE klas_id = ? ORDER BY naam",
    klasId,
  );
}

export async function getTotalLeerlingenCount(klasId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT COUNT(*) as c FROM leerlingen WHERE klas_id = ?",
    klasId,
  );
  return row?.c || 0;
}

export async function getAnsweredLeerlingenCount(sessieId, vraagId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT COUNT(DISTINCT leerling_id) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
    sessieId,
    vraagId,
  );
  return row?.c || 0;
}

export async function deleteLeerling(leerlingId, klasId) {
  const db = getDatabase();

  // Verify leerling belongs to klas
  const leerling = await getLeerlingByIdAndKlas(leerlingId, klasId);
  if (!leerling) {
    throw new Error("Leerling not found in this class");
  }

  await db.run(
    "DELETE FROM leerlingen WHERE id = ? AND klas_id = ?",
    leerlingId,
    klasId,
  );
}
