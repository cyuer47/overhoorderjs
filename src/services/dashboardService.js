import { getDatabase } from "../config/database.js";

/**
 * Dashboard service - loads all dashboard data for authenticated user
 */

export async function getDashboardData(docentId) {
  const db = getDatabase();

  // Get docent info
  const docent = await db.get(
    "SELECT id, naam, avatar, current_ebook_id FROM docenten WHERE id = ?",
    docentId,
  );

  // Get all classes
  const klassen = await db.all(
    "SELECT * FROM klassen WHERE docent_id = ? ORDER BY id DESC",
    docentId,
  );

  // Get active licenses
  let licenties = [];
  try {
    licenties = await db.all(
      "SELECT * FROM licenties WHERE docent_id = ? AND actief = 1 AND (vervalt_op IS NULL OR DATE(vervalt_op) >= DATE('now'))",
      docentId,
    );
  } catch (err) {
    console.warn("Could not load licenties:", err.message);
  }

  const heeft_licentie = Array.isArray(licenties)
    ? licenties.some((l) => l.type === "vragenlijsten")
    : false;

  // Get biblioteca (question lists)
  let biblio_lijsten = [];
  try {
    if (docentId === 3) {
      biblio_lijsten = await db.all(
        "SELECT * FROM bibliotheek_vragenlijsten ORDER BY id DESC",
      );
    } else {
      biblio_lijsten = await db.all(
        "SELECT * FROM bibliotheek_vragenlijsten WHERE licentie_type != 'verborgen' ORDER BY id DESC",
      );
    }
  } catch (err) {
    console.warn("Could not load bibliotheek_vragenlijsten:", err.message);
  }

  // Get books
  let boeken = [];
  try {
    if (docentId === -1) {
      boeken = await db.all(
        "SELECT id, titel, omschrijving FROM boeken ORDER BY id DESC",
      );
    } else {
      boeken = await db.all(
        `
        SELECT DISTINCT b.id, b.titel, b.omschrijving
        FROM boeken b
        JOIN licentie_boeken lb ON lb.boek_id = b.id
        JOIN licenties l ON l.id = lb.licentie_id
        WHERE l.docent_id = ? AND l.actief = 1
          AND (l.vervalt_op IS NULL OR DATE(l.vervalt_op) >= DATE('now'))
        ORDER BY b.id DESC
      `,
        docentId,
      );
    }
  } catch (err) {
    console.warn("Could not load boeken:", err.message);
  }

  return {
    docent,
    klassen,
    licenties,
    heeft_licentie,
    biblio_lijsten,
    boeken,
  };
}

/**
 * Check if book exists and user has license
 */
export async function canUserAccessBook(userId, bookId) {
  const db = getDatabase();

  const book = await db.get("SELECT id FROM boeken WHERE id = ?", bookId);
  if (!book) return false;

  const license = await db.get(
    `SELECT l.id FROM licentie_boeken lb
     JOIN licenties l ON lb.licentie_id = l.id
     WHERE lb.boek_id = ? AND l.docent_id = ? AND l.actief = 1
       AND (l.vervalt_op IS NULL OR DATE(l.vervalt_op) >= DATE('now'))
     LIMIT 1`,
    bookId,
    userId,
  );

  return !!license;
}

/**
 * Search public docenten
 */
export async function searchPublicDocenten(query) {
  const db = getDatabase();
  if (!query || query.trim().length === 0) return [];

  return db.all(
    "SELECT id, naam, badge FROM docenten WHERE is_public = 1 AND naam LIKE ? LIMIT 20",
    `%${query}%`,
  );
}
