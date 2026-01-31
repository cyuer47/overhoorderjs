import { getDatabase } from "../config/database.js";

/**
 * User/Docent service - handles all docent-related database operations
 */

export async function getUserById(userId) {
  const db = getDatabase();
  return db.get("SELECT id, email, naam FROM docenten WHERE id = ?", userId);
}

export async function getUserByEmail(email) {
  const db = getDatabase();
  return db.get("SELECT * FROM docenten WHERE email = ?", email);
}

export async function createUser(naam, email, hashedPassword) {
  const db = getDatabase();
  const result = await db.run(
    "INSERT INTO docenten (naam, email, wachtwoord) VALUES (?, ?, ?)",
    [naam, email, hashedPassword],
  );
  return result.lastID;
}

export async function getUserCurrentEbook(userId) {
  const db = getDatabase();
  const row = await db.get(
    "SELECT current_ebook_id FROM docenten WHERE id = ?",
    userId,
  );
  const id = row?.current_ebook_id || null;

  if (!id) return { id: null };

  const book = await db.get(
    "SELECT id, titel, omschrijving FROM boeken WHERE id = ?",
    id,
  );
  return { id, book };
}

export async function setUserCurrentEbook(userId, ebookId) {
  const db = getDatabase();
  await db.run(
    "UPDATE docenten SET current_ebook_id = ? WHERE id = ?",
    ebookId,
    userId,
  );
}
