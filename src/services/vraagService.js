import { getDatabase } from "../config/database.js";

/**
 * Vragen (Questions) service - handles all question database operations
 */

export async function addVraag(klasId, vragenlijstId, vraag, antwoord) {
  const db = getDatabase();
  const result = await db.run(
    "INSERT INTO vragen (klas_id, vragenlijst_id, vraag, antwoord) VALUES (?, ?, ?, ?)",
    klasId,
    vragenlijstId,
    vraag,
    antwoord,
  );
  return result.lastID;
}

export async function getVraagById(vraagId) {
  const db = getDatabase();
  return db.get("SELECT * FROM vragen WHERE id = ?", vraagId);
}

export async function getVraagWithoutAnswer(vraagId) {
  const db = getDatabase();
  return db.get("SELECT id, vraag FROM vragen WHERE id = ?", vraagId);
}

export async function updateVraag(vraagId, vraag, antwoord) {
  const db = getDatabase();
  await db.run(
    "UPDATE vragen SET vraag = ?, antwoord = ? WHERE id = ?",
    vraag,
    antwoord,
    vraagId,
  );
}

export async function deleteVraag(vraagId) {
  const db = getDatabase();
  // Delete answers first (due to foreign key)
  await db.run("DELETE FROM resultaten WHERE vraag_id = ?", vraagId);
  await db.run("DELETE FROM vragen WHERE id = ?", vraagId);
}

export async function getVraagsByVragenlijst(vragenlijstId) {
  const db = getDatabase();
  return db.all(
    "SELECT * FROM vragen WHERE vragenlijst_id = ? ORDER BY id DESC",
    vragenlijstId,
  );
}

export async function getRandomUnaskedVraag(klasId, vragenlijstId, askedIds) {
  const db = getDatabase();

  if (askedIds.length === 0) {
    return db.get(
      "SELECT * FROM vragen WHERE klas_id = ? AND vragenlijst_id = ? ORDER BY RANDOM() LIMIT 1",
      klasId,
      vragenlijstId,
    );
  }

  const placeholders = askedIds.map(() => "?").join(",");
  const sql = `
    SELECT * FROM vragen 
    WHERE klas_id = ? AND vragenlijst_id = ? AND id NOT IN (${placeholders}) 
    ORDER BY RANDOM() LIMIT 1
  `;
  return db.get(sql, klasId, vragenlijstId, ...askedIds);
}
