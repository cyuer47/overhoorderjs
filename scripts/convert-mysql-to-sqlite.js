import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const dumpPath = path.join(process.cwd(), "import", "mysql_dump.sql");
const outSqlPath = path.join(process.cwd(), "sqlite_migration.sql");
const dbPath = path.join(process.cwd(), "data.db");

if (!fs.existsSync(dumpPath)) {
  console.error("Dump file not found:", dumpPath);
  process.exit(1);
}

let sql = fs.readFileSync(dumpPath, "utf8");

// 1) Remove MySQL-specific directives and comments we don't need
// Remove delimiter blocks and any code between custom delimiters (procedures/triggers)
sql = sql.replace(/DELIMITER \$\$[\s\S]*?DELIMITER\s*;/g, "");
// remove single-line comments starting with --
sql = sql.replace(/--.*$/gm, "");
// also remove stray delimiters
sql = sql.replace(/DELIMITER\s+\$\$/g, "");
sql = sql.replace(/DELIMITER\s*;/g, "");
sql = sql.replace(/\$\$/g, "");

// remove /*! ... */ blocks
sql = sql.replace(/\/\*!40101[\s\S]*?\*\//g, "");
// remove DEFINER/procedure blocks
sql = sql.replace(/CREATE\s+DEFINER[\s\S]*?END\s*;?/gi, "");
sql = sql.replace(/CREATE\s+PROCEDURE[\s\S]*?END\s*;?/gi, "");
// remove SET and transaction statements
sql = sql.replace(/SET\s+[^;]+;/g, "");
sql = sql.replace(/START TRANSACTION;|COMMIT;/g, "");
// strip CHARACTER SET / COLLATE fragments
sql = sql.replace(/CHARACTER\s+SET\s+[^,\)\s]+/gi, "");
sql = sql.replace(/COLLATE\s+[^,\)\s]+/gi, "");
// remove remaining 'CHARACTER' words
sql = sql.replace(/\bCHARACTER\b/gi, "");
// collapse spaces and tabs but keep newlines
sql = sql.replace(/[ \t]+/g, " ");

// 2) Find tables that get PRIMARY KEY or AUTO_INCREMENT via ALTER TABLE
const hasPK = new Set();
const hasAutoinc = new Set();
{
  const alterPK = sql.matchAll(
    /ALTER TABLE `([^`]+)`[\s\S]*?ADD PRIMARY KEY \(`id`\)/g
  );
  for (const m of alterPK) hasPK.add(m[1]);
  const alterAutoinc = sql.matchAll(
    /ALTER TABLE `([^`]+)`[\s\S]*?MODIFY `id`[^;]*AUTO_INCREMENT/g
  );
  for (const m of alterAutoinc) hasAutoinc.add(m[1]);
}

// 3) Remove `ENGINE=...` and `DEFAULT CHARSET` etc.
sql = sql.replace(/\) ENGINE=.+?;/g, ") ;");
sql = sql.replace(/CHARSET=[^\s;]+/g, "");
sql = sql.replace(/COLLATE=[^\s;]+/g, ""); // remove leftover CHARACTER keywords from CHARACTER SET ... removals
sql = sql.replace(/CHARACTER\s*/gi, "");
// normalize tinyINTEGER artifacts
sql = sql.replace(/tinyINTEGER/gi, "INTEGER");
// 4) Convert CREATE TABLE blocks: tweak id column and types
function splitTopLevelCommas(s) {
  const parts = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      cur += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function processCreateTables(raw) {
  let out = "";
  let i = 0;
  const lower = raw.toLowerCase();
  while (true) {
    const idx = lower.indexOf("create table `", i);
    if (idx === -1) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, idx);
    const nameMatch = raw.slice(idx).match(/^CREATE TABLE `([^`]+)`\s*\(/i);
    if (!nameMatch) {
      out += raw.slice(idx, idx + 12);
      i = idx + 12;
      continue;
    }
    const table = nameMatch[1];
    const parenPos = idx + raw.slice(idx).indexOf("(");
    let pos = parenPos + 1;
    let depth = 1;
    while (pos < raw.length && depth > 0) {
      const ch = raw[pos];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      pos++;
    }
    const body = raw.slice(parenPos + 1, pos - 1);
    let endPos = raw.indexOf(";", pos);
    if (endPos === -1) endPos = pos;

    let cols = splitTopLevelCommas(body);
    cols = cols.map((line) => {
      line = line.replace(/`([^`]*)`/g, "$1").trim();
      line = line.replace(/int\(\d+\)/gi, "INTEGER");
      line = line.replace(/tinyint\(1\)/gi, "INTEGER");
      line = line.replace(/varchar\(\d+\)/gi, "TEXT");
      line = line.replace(/longtext/gi, "TEXT");
      line = line.replace(/text/gi, "TEXT");
      line = line.replace(
        /DEFAULT\s+current_timestamp\(\)/gi,
        "DEFAULT (CURRENT_TIMESTAMP)"
      );
      line = line.replace(
        /(\b[\w_]+\b)\s+enum\(([^)]+)\)/i,
        (m2, colName, enumVals) => {
          return `${colName} TEXT CHECK (${colName} IN (${enumVals}))`;
        }
      );

      if (hasPK.has(table)) {
        if (/^id\b/i.test(line) && /NOT NULL/i.test(line)) {
          if (hasAutoinc.has(table)) {
            return "id INTEGER PRIMARY KEY AUTOINCREMENT";
          }
          return "id INTEGER PRIMARY KEY";
        }
      }

      line = line.replace(/ON UPDATE current_timestamp\(\)/gi, "");
      return line.replace(/,$/, "");
    });

    const body2 = cols.filter(Boolean).join(",\n  ");
    out += `CREATE TABLE IF NOT EXISTS ${table} (\n  ${body2}\n);\n`;
    i = endPos + 1;
  }
  return out;
}

// Use the robust processCreateTables function to handle CREATE TABLE transformations
sql = processCreateTables(sql);

// 5) Convert ALTER TABLE ... ADD KEY / ADD UNIQUE KEY into CREATE INDEX statements
sql = sql.replace(
  /ALTER TABLE `([^`]+)`\s+ADD PRIMARY KEY \(`([^`]+)`\);/g,
  (m0, table, col) => {
    // already handled by CREATE TABLE modification, so drop
    return "";
  }
);
sql = sql.replace(
  /ALTER TABLE `([^`]+)`\s+ADD UNIQUE KEY `([^`]+)` \(`([^`]+)`\);/g,
  (m0, table, idx, col) => {
    return `CREATE UNIQUE INDEX IF NOT EXISTS ${idx} ON ${table}(${col});`;
  }
);
sql = sql.replace(
  /ALTER TABLE `([^`]+)`\s+ADD KEY `([^`]+)` \(`([^`]+)`\);/g,
  (m0, table, idx, col) => {
    return `CREATE INDEX IF NOT EXISTS ${idx} ON ${table}(${col});`;
  }
);

// 6) Remove trigger / procedure blocks (we'll create defaults instead where necessary)
sql = sql.replace(/CREATE TRIGGER[\s\S]*?END\s*;?/gi, "");
sql = sql.replace(/PROCEDURE[\s\S]*?END\s*;?/gi, "");

// 7) Replace INSERTs: remove backticks
sql = sql.replace(/`/g, "");

// 8) Add PRAGMA and wrap up
// clean up stray semicolons and leading junk
sql = sql.replace(/;\s*;/g, ";");
sql = sql.replace(/^[\s;]+/, "");
const header = `PRAGMA foreign_keys = ON;\nPRAGMA journal_mode = WAL;\nBEGIN TRANSACTION;\n`;
const footer = "\nCOMMIT;\n";
const finalSql = header + sql + footer;

// ensure statements are separated by a semicolon + newline for reliable splitting
let splitReadySql = finalSql.replace(/;\s*/g, ";\n");
// remove any CREATE TABLE definitions for tables we will ensure with fallbacks (avoid malformed duplicates)
for (const t of Object.keys({ docenten: 1 })) {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${t}[\\s\\S]*?;`, "gi");
  splitReadySql = splitReadySql.replace(re, "");
}
// Normalize tinyINTEGER artifacts left over
splitReadySql = splitReadySql.replace(/tinyINTEGER/gi, "INTEGER");
// Ensure semicolon exists after a closing parenthesis when followed by INSERT/CREATE
splitReadySql = splitReadySql.replace(
  /\)\s*\r?\n\s*INSERT INTO/gi,
  ");\nINSERT INTO"
);
splitReadySql = splitReadySql.replace(
  /\)\s*\r?\n\s*CREATE TABLE/gi,
  ");\nCREATE TABLE"
);
// collapse accidental duplicate closing ');' lines (e.g. after an INSERT block)
splitReadySql = splitReadySql.replace(/\)\s*;\s*\r?\n\)\s*;\s*\r?\n/g, ");\n");
fs.writeFileSync(outSqlPath, splitReadySql, "utf8");

console.log("Wrote", outSqlPath);

// 9) Backup existing DB if exists
if (fs.existsSync(dbPath)) {
  const bak = dbPath + ".bak";
  fs.copyFileSync(dbPath, bak);
  console.log("Backed up existing data.db -> data.db.bak");
}

// 10) Execute SQL into SQLite DB
(async () => {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  console.log("Opened", dbPath);

  // Ensure some critical tables exist with sane schemas (fallbacks) so INSERTs don't fail
  const fallbackSchemas = {
    docenten: `CREATE TABLE IF NOT EXISTS docenten (
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
    );`,
  };

  for (const [t, stmt] of Object.entries(fallbackSchemas)) {
    try {
      await db.exec(stmt);
      console.log(`Ensured fallback schema for ${t}`);
    } catch (err) {
      console.warn(`Failed to create fallback schema for ${t}:`, err.message);
    }
  }
  // Execute full migration SQL in one go (fallback schemas already created above)
  try {
    console.log("Executing full migration SQL...");
    await db.exec(splitReadySql);
    console.log("Full migration executed successfully");
  } catch (err) {
    console.error("Full migration exec failed:", err.message);
    // If full exec fails, fall back to per-statement execution to capture individual errors
    const stmts = splitReadySql
      .split(/;\s*[\r\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(
      "Falling back to per-statement execution (count=",
      stmts.length,
      ")"
    );
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      try {
        await db.exec(s + ";");
      } catch (err2) {
        console.error(`Statement #${i + 1} failed:`, err2.message);
      }
    }
  }
  await db.close();
  console.log("Import finished");
})();
