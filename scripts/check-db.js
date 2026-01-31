import sqlite3 from "sqlite3";
import { open } from "sqlite";

(async () => {
  const db = await open({ filename: "data.db", driver: sqlite3.Database });
  const tables = ["api_keys", "docenten", "bibliotheek_vragen", "boeken"];
  for (const t of tables) {
    try {
      const row = await db.get(`SELECT count(*) as c FROM ${t}`);
      console.log(t, row?.c ?? 0);
    } catch (err) {
      console.log(t, "error:", err.message);
    }
  }
  await db.close();
})();
