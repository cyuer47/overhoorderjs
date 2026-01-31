import sqlite3 from "sqlite3";
import { open } from "sqlite";

(async () => {
  const db = await open({ filename: "data.db", driver: sqlite3.Database });
  const rows = await db.all(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  console.log("Tables in database:");
  rows.forEach((r) => console.log("  -", r.name));
  await db.close();
})();
