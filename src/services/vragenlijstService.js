import { getDatabase } from "../config/database.js";

/**
 * Vragenlijst (Question List) service - handles all question list database operations
 */

export async function createVragenlijst(klasId, naam) {
  const db = getDatabase();
  const result = await db.run(
    "INSERT INTO vragenlijsten (klas_id, naam) VALUES (?, ?)",
    klasId,
    naam,
  );
  return result.lastID;
}

export async function getVragenlijstById(vragenlijstId) {
  const db = getDatabase();
  return db.get(
    "SELECT v.*, k.docent_id, k.naam as klasnaam, v.klas_id FROM vragenlijsten v JOIN klassen k ON v.klas_id = k.id WHERE v.id = ?",
    vragenlijstId,
  );
}

export async function getVragenlijstWithVragen(vragenlijstId) {
  const db = getDatabase();
  const vragenlijst = await getVragenlijstById(vragenlijstId);
  if (!vragenlijst) return null;

  const vragen = await db.all(
    "SELECT * FROM vragen WHERE vragenlijst_id = ? ORDER BY id DESC",
    vragenlijstId,
  );

  return { ...vragenlijst, vragen };
}

export async function updateVragenlijst(vragenlijstId, naam) {
  const db = getDatabase();
  await db.run(
    "UPDATE vragenlijsten SET naam = ? WHERE id = ?",
    naam,
    vragenlijstId,
  );
}

export async function deleteVragenlijst(vragenlijstId) {
  const db = getDatabase();
  const vragen = await db.all(
    "SELECT id FROM vragen WHERE vragenlijst_id = ?",
    vragenlijstId,
  );

  // Delete in dependency order
  for (const v of vragen) {
    await db.run("DELETE FROM resultaten WHERE vraag_id = ?", v.id);
  }
  await db.run("DELETE FROM vragen WHERE vragenlijst_id = ?", vragenlijstId);
  await db.run("DELETE FROM vragenlijsten WHERE id = ?", vragenlijstId);
}

export async function getVragenlijstenByKlas(klasId) {
  const db = getDatabase();
  return db.all(
    "SELECT id, naam FROM vragenlijsten WHERE klas_id = ? ORDER BY id DESC",
    klasId,
  );
}
