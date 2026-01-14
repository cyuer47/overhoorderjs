import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const dumpPath = path.join(process.cwd(), "import", "mysql_dump.sql");
const dbPath = path.join(process.cwd(), "data.db");

if (!fs.existsSync(dumpPath)) {
  console.error("Dump not found");
  process.exit(1);
}
const dump = fs.readFileSync(dumpPath, "utf8");
const m = dump.match(/INSERT INTO `docenten`[\s\S]*?;/i);
if (!m) {
  console.error("No INSERT for docenten found in dump");
  process.exit(1);
}
let insertSql = m[0];
// sanitize: remove backticks
insertSql = insertSql.replace(/`/g, "");

(async () => {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  try {
    // Ensure docenten table exists with a sane fallback schema
    const fallback = `CREATE TABLE IF NOT EXISTS docenten (
      id INTEGER PRIMARY KEY,
      naam TEXT NOT NULL,
      email TEXT NOT NULL,
      wachtwoord TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      reset_token TEXT,
      reset_token_expiry TIMESTAMP,
      avatar TEXT,
      bio TEXT DEFAULT '',
      vakken TEXT DEFAULT '',
      is_public INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      badge TEXT DEFAULT 'none'
    );`;
    await db.exec(fallback);

    // Make insert idempotent to avoid failures when rows already exist
    insertSql = insertSql.replace(
      /INSERT INTO\s+docenten/i,
      "INSERT OR IGNORE INTO docenten"
    );

    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.exec("BEGIN;");
    await db.exec(insertSql);
    await db.exec("COMMIT;");
    console.log("Inserted docenten rows");
  } catch (err) {
    console.error("Import failed:", err.message);
    try {
      await db.exec("ROLLBACK;");
    } catch (e) {
      // ignore
    }
  }
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.close();
})();
