import sqlite3 from "sqlite3";
import { open } from "sqlite";

(async () => {
  const db = await open({ filename: "data.db", driver: sqlite3.Database });
  const tables = await db.all(
    "SELECT name, type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  for (const t of tables) {
    try {
      const row = await db.get(`SELECT count(*) as c FROM ${t.name}`);
      console.log(t.name.padEnd(30), row?.c ?? 0);
    } catch (err) {
      console.log(t.name.padEnd(30), "error", err.message);
    }
  }
  await db.close();
})();
