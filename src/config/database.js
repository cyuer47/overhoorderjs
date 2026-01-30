import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;

/**
 * Initialize the SQLite database with schema and migrations
 */
export async function initDatabase() {
  try {
    db = await open({
      filename: path.join(__dirname, "../../data.db"),
      driver: sqlite3.Database,
    });

    // Enable foreign keys and better concurrency
    await db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

    // Create base tables if they don't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS klassen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        docent_id INTEGER NOT NULL,
        naam TEXT NOT NULL,
        klascode TEXT UNIQUE NOT NULL,
        vak TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS licenties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        docent_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        actief INTEGER DEFAULT 1,
        vervalt_op DATE DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS licentie_boeken (
        licentie_id INTEGER NOT NULL,
        boek_id INTEGER NOT NULL,
        PRIMARY KEY (licentie_id, boek_id)
      );
      
      CREATE TABLE IF NOT EXISTS leerlingen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        klas_id INTEGER NOT NULL,
        naam TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS vragenlijsten (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        klas_id INTEGER NOT NULL,
        naam TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS sessies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        klas_id INTEGER NOT NULL,
        vragenlijst_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS vragen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        klas_id INTEGER NOT NULL,
        vragenlijst_id INTEGER NOT NULL,
        vraag TEXT NOT NULL,
        antwoord TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS resultaten (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessie_id INTEGER NOT NULL,
        leerling_id INTEGER NOT NULL,
        vraag_id INTEGER NOT NULL,
        antwoord TEXT NOT NULL,
        correct INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Run migrations
    await runMigrations();

    // Ensure all required columns exist
    await ensureSchemaColumns();

    console.log("Database ready ✅");
    return db;
  } catch (err) {
    console.error("DB init error:", err);
    throw err;
  }
}

/**
 * Run database migrations from sqlite_migration.sql if needed
 */
async function runMigrations() {
  try {
    const row = await db.get(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    );
    const cnt = row?.cnt || 0;
    const migrationPath = path.join(__dirname, "../../sqlite_migration.sql");

    if (cnt > 5) {
      console.log(`DB already has tables (count=${cnt}), skipping migration.`);
      return;
    }

    if (!fs.existsSync(migrationPath)) {
      console.log("No migration file at", migrationPath);
      return;
    }

    let sql = fs.readFileSync(migrationPath, "utf8");
    // strip comments and pragmas and BEGIN/COMMIT
    sql = sql
      .split("\n")
      .filter(
        (line) =>
          !line.trim().startsWith("--") &&
          !/^(PRAGMA|BEGIN|COMMIT)/i.test(line.trim()),
      )
      .join("\n");
    const stmts = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.exec("BEGIN;");
    for (const s of stmts) {
      try {
        await db.exec(s + ";");
      } catch (err) {
        console.warn("Migration statement skipped:", err.message);
      }
    }
    await db.exec("COMMIT;");
    await db.exec("PRAGMA foreign_keys = ON;");
    console.log("Migration finished (best-effort).");
  } catch (err) {
    console.error("Migration error:", err);
  }
}

/**
 * Ensure all required schema columns exist (safe ALTER TABLE operations)
 */
async function ensureSchemaColumns() {
  try {
    // Ensure docenten table has current_ebook_id
    const cols = await db.all("PRAGMA table_info(docenten);");
    const hasEbookCol = cols.some((c) => c.name === "current_ebook_id");
    if (!hasEbookCol) {
      await db.exec(
        "ALTER TABLE docenten ADD COLUMN current_ebook_id INTEGER;",
      );
      console.log("Added column docenten.current_ebook_id");
    }
  } catch (err) {
    console.warn("Could not ensure current_ebook_id column:", err.message);
  }

  try {
    // Ensure sessies has all required columns
    const scols = await db.all("PRAGMA table_info(sessies);");
    const colNames = scols.map((c) => c.name);
    const need = [];

    if (!colNames.includes("docent_id"))
      need.push("ALTER TABLE sessies ADD COLUMN docent_id INTEGER;");
    if (!colNames.includes("actief"))
      need.push("ALTER TABLE sessies ADD COLUMN actief INTEGER DEFAULT 1;");
    if (!colNames.includes("started_at"))
      need.push(
        "ALTER TABLE sessies ADD COLUMN started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;",
      );
    if (!colNames.includes("round_seen"))
      need.push("ALTER TABLE sessies ADD COLUMN round_seen TEXT DEFAULT '[]';");
    if (!colNames.includes("prev_student_id"))
      need.push("ALTER TABLE sessies ADD COLUMN prev_student_id INTEGER;");
    if (!colNames.includes("current_student_id"))
      need.push("ALTER TABLE sessies ADD COLUMN current_student_id INTEGER;");
    if (!colNames.includes("current_question_id"))
      need.push("ALTER TABLE sessies ADD COLUMN current_question_id INTEGER;");
    if (!colNames.includes("question_start_time"))
      need.push(
        "ALTER TABLE sessies ADD COLUMN question_start_time TIMESTAMP NULL;",
      );

    for (const q of need) {
      try {
        await db.exec(q);
        console.log("Added sessies column");
      } catch (err) {
        console.warn("Could not add sessies column:", err.message);
      }
    }
  } catch (err) {
    console.warn("Could not inspect sessies columns:", err.message);
  }

  try {
    // Ensure resultaten has grading columns
    const rcols = await db.all("PRAGMA table_info(resultaten);");
    const rcolNames = rcols.map((c) => c.name);
    const rneed = [];

    if (!rcolNames.includes("status"))
      rneed.push(
        "ALTER TABLE resultaten ADD COLUMN status TEXT DEFAULT 'onbekend';",
      );
    if (!rcolNames.includes("points"))
      rneed.push("ALTER TABLE resultaten ADD COLUMN points INTEGER DEFAULT 0;");
    if (!rcolNames.includes("antwoord_given"))
      rneed.push("ALTER TABLE resultaten ADD COLUMN antwoord_given TEXT;");

    for (const q of rneed) {
      try {
        await db.exec(q);
        console.log("Added resultaten column");
      } catch (err) {
        console.warn("Could not add resultaten column:", err.message);
      }
    }
  } catch (err) {
    console.warn("Could not inspect resultaten columns:", err.message);
  }
}

/**
 * Get database instance
 */
export function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  if (db) {
    await db.close();
  }
}
