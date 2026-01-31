const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
(async () => {
  try {
    const db = await open({ filename: "data.db", driver: sqlite3.Database });
    console.log("Licenties for docent id 1:");
    const rows = await db.all(
      "SELECT * FROM licenties WHERE docent_id = 1 ORDER BY id",
    );
    console.log(rows);
    console.log("\nKlassen for docent id 1:");
    const k = await db.all(
      "SELECT * FROM klassen WHERE docent_id = 1 ORDER BY id",
    );
    console.log(k);
    await db.close();
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
})();
