import express from "express";
import fs from "fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

// Enable optional request logging when DEBUG_REQUESTS=1 or DEBUG=true
const DEBUG_REQUESTS =
  process.env.DEBUG_REQUESTS === "1" || process.env.DEBUG === "true";

const SECRET = process.env.SECRET || "supersecretkey";
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
let routeCount = 0; // Track routes being registered

// Override app methods to track route registration
const origGet = app.get;
const origPost = app.post;
const origPut = app.put;
const origDelete = app.delete;

app.get = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] GET ${args[0]}`);
  return origGet.apply(this, args);
};
app.post = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] POST ${args[0]}`);
  return origPost.apply(this, args);
};
app.put = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] PUT ${args[0]}`);
  return origPut.apply(this, args);
};
app.delete = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] DELETE ${args[0]}`);
  return origDelete.apply(this, args);
};

console.log("✅ Route tracking initialized");
app.use(express.json()); // Belangrijk: parse JSON body
app.use(express.urlencoded({ extended: true })); // parse form bodies

// Request logger for debugging (enabled via env)
if (DEBUG_REQUESTS) {
  app.use((req, res, next) => {
    console.log("REQ", req.method, req.path);
    next();
  });
}
// CORS / preflight handling (allow Authorization header for browser preflights)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  next();
});

// --------------------
// Server-Sent Events (SSE) for session updates (teacher page)
// --------------------
const sseClients = new Map(); // sessionId -> Set(res)

// lightweight in-memory presence map (leerling_id -> { status, focused, last_seen })
const presence = new Map();

function sanitizeSessionPayloadForStudents(payload) {
  // Return a minimal payload suitable for anonymous student clients.
  const out = Object.assign({}, payload || {});
  try {
    if (out.currentQuestion) {
      const cq = Object.assign({}, out.currentQuestion);
      // hide correct answer from students
      delete cq.antwoord;
      out.currentQuestion = cq;
    }

    if (Array.isArray(out.leerlingen)) {
      out.leerlingen = out.leerlingen.map((l) => ({
        id: l.id,
        online: l.online,
        focused: l.focused,
        last_seen: l.last_seen,
      }));
    }

    if (Array.isArray(out.scoreboard)) {
      out.scoreboard = out.scoreboard.map((r) => ({
        leerling_id: r.leerling_id,
        points: r.points,
        answers: r.answers,
      }));
    }

    if (Array.isArray(out.recentAnswers)) {
      out.recentAnswers = out.recentAnswers.map((r) => ({
        antwoord: r.antwoord,
        status: r.status,
        points: r.points,
        created_at: r.created_at,
        vraag: r.vraag,
      }));
    }
  } catch (e) {
    // swallow errors in sanitization
  }
  return out;
}

function sendSSE(sessionId, name, data) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const teacherPayload = JSON.stringify(data || {});
  const studentPayload = JSON.stringify(
    sanitizeSessionPayloadForStudents(data || {})
  );
  for (const res of clients) {
    try {
      if (res._isTeacher) {
        res.write(`event: ${name}\n`);
        res.write(`data: ${teacherPayload}\n\n`);
      } else {
        // For students/anonymous clients we send a lightweight 'update' event
        // so they can refetch state without exposing teacher-only data.
        res.write(`event: update\n`);
        res.write(`data: ${studentPayload}\n\n`);
      }
    } catch (err) {
      console.warn("Error writing SSE to client:", err.message);
    }
  }
}

async function buildSessionPayload(sessionId) {
  const sess = await db.get(
    "SELECT s.*, k.naam as klasnaam, k.klascode FROM sessies s JOIN klassen k ON k.id = s.klas_id WHERE s.id = ?",
    sessionId
  );
  if (!sess) return null;

  // normalize some fields for the client
  // parse round_seen (stored as JSON text) and normalize boolean/timestamps
  try {
    sess.round_seen = sess.round_seen ? JSON.parse(sess.round_seen) : [];
  } catch (e) {
    sess.round_seen = sess.round_seen || [];
  }
  sess.actief = Boolean(sess.actief);
  // ensure timestamps are strings (ISO/local whatever DB returns)
  if (sess.started_at) sess.started_at = String(sess.started_at);
  if (sess.question_start_time)
    sess.question_start_time = String(sess.question_start_time);

  const currentQuestion = sess.current_question_id
    ? await db.get(
        "SELECT id, vraag, antwoord FROM vragen WHERE id = ?",
        sess.current_question_id
      )
    : null;
  const answerCountRow = currentQuestion
    ? await db.get(
        "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
        sessionId,
        currentQuestion.id
      )
    : { c: 0 };
  const leerlingen = await db.all(
    "SELECT id, naam FROM leerlingen WHERE klas_id = ?",
    sess.klas_id
  );

  // attach ephemeral presence info (updated via /status-update)
  for (const l of leerlingen) {
    const p = presence.get(String(l.id));
    l.last_seen = p ? p.last_seen : null;
    l.online = p ? p.status === "actief" : false;
    l.focused = p ? Boolean(p.focused) : false;
  }

  const totalStudents = await db.get(
    "SELECT COUNT(*) as c FROM leerlingen WHERE klas_id = ?",
    sess.klas_id
  );
  // also expose count on sess for convenience
  sess.total_students = totalStudents.c || 0;

  const scoreboard = await db.all(
    `SELECT l.id as leerling_id, l.naam, COALESCE(SUM(r.points),0) as points, COUNT(r.id) as answers
       FROM leerlingen l
       LEFT JOIN resultaten r ON r.leerling_id = l.id AND r.sessie_id = ?
       WHERE l.klas_id = ?
       GROUP BY l.id
       ORDER BY points DESC, l.naam ASC`,
    sessionId,
    sess.klas_id
  );

  const recent = await db.all(
    `SELECT r.id, r.leerling_id, l.naam as leerling, r.antwoord_given as antwoord, r.status, r.points, r.created_at, v.vraag as vraag
       FROM resultaten r
       JOIN leerlingen l ON l.id = r.leerling_id
       LEFT JOIN vragen v ON v.id = r.vraag_id
       WHERE r.sessie_id = ?
       ORDER BY (CASE WHEN r.status IS NULL OR r.status = 'onbekend' THEN 0 ELSE 1 END), r.created_at DESC
       LIMIT 50`,
    sessionId
  );

  const pendingRow = await db.get(
    "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND (status IS NULL OR status = 'onbekend')",
    sessionId
  );

  return {
    sess,
    currentQuestion,
    answerCount: answerCountRow.c || 0,
    total_students: totalStudents.c || 0,
    leerlingen,
    scoreboard,
    recentAnswers: recent,
    pending_count: pendingRow ? pendingRow.c || 0 : 0,
  };
}

async function broadcastSession(sessionId) {
  try {
    const payload = await buildSessionPayload(sessionId);
    if (!payload) return;
    sendSSE(sessionId, "session", payload);
  } catch (err) {
    console.error("broadcastSession error:", err);
  }
}

// Endpoint: SSE stream for a session
app.get("/sessies/:id/stream", async (req, res) => {
  try {
    const token =
      req.query.token ||
      (req.headers.authorization && req.headers.authorization.split(" ")[1]);
    let user = null;
    let isTeacher = false;

    if (token) {
      try {
        user = jwt.verify(token, SECRET);
      } catch (err) {
        return res.status(403).send("Invalid token");
      }
    }

    const id = parseInt(req.params.id, 10);
    const sess = await db.get("SELECT * FROM sessies WHERE id = ?", id);
    if (!sess) return res.status(404).send("session not found");

    // if a token was provided, confirm teacher owns this session
    if (user) {
      if (sess.docent_id !== user.id)
        return res.status(403).send("unauthorized");
      isTeacher = true;
    }

    // Set headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    // register client
    const set = sseClients.get(id) || new Set();
    // mark res for teacher vs student
    res._isTeacher = isTeacher;
    set.add(res);
    sseClients.set(id, set);

    // send initial payload: teachers get full session; students get a lightweight update event
    const payload = await buildSessionPayload(id);
    if (payload) {
      if (isTeacher) {
        res.write(`event: session\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } else {
        // students: minimal update trigger only (no sensitive fields)
        res.write(`event: update\n`);
        res.write(`data: {}\n\n`);
      }
    }

    // keep-alive ping
    const interval = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch (e) {}
    }, 15000);

    req.on("close", () => {
      clearInterval(interval);
      const s = sseClients.get(id);
      if (s) {
        s.delete(res);
        if (s.size === 0) sseClients.delete(id);
      }
    });
  } catch (err) {
    console.error("/sessies/:id/stream error:", err);
    res.status(500).send("server error");
  }
});

// Admin/client notify hook so non-Node pages (PHP) can notify about DB changes
app.post("/notify-session-update", express.json(), async (req, res) => {
  try {
    const sid = parseInt(req.body.sessie_id, 10);
    const secret =
      req.body.secret || req.query.secret || req.headers["x-update-secret"];
    if (process.env.UPDATE_SECRET && process.env.UPDATE_SECRET !== secret) {
      return res.status(403).json({ error: "invalid secret" });
    }
    if (!sid) return res.status(400).json({ error: "sessie_id required" });

    await broadcastSession(sid);
    res.json({ ok: true });
  } catch (err) {
    console.error("/notify-session-update error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Static files
app.use(express.static(__dirname));

// Quick ping endpoint to validate routing
app.get("/ping", (req, res) => {
  try {
    const info = { ok: true, pid: process.pid };
    if (app._router && Array.isArray(app._router.stack)) {
      info.routes = app._router.stack
        .filter((m) => m.route && m.route.path)
        .map((m) => ({
          path: m.route.path,
          methods: Object.keys(m.route.methods),
        }));
    } else {
      info.has_router = !!app._router;
    }
    console.log("PING INFO", info);
    res.json(info);
  } catch (err) {
    console.error("ping error", err);
    res.json({ ok: false, error: err.message });
  }
});

// Debug: list routes at runtime
app.get("/list-routes-now", (req, res) => {
  const routes = [];
  if (app._router && Array.isArray(app._router.stack)) {
    app._router.stack.forEach((m) => {
      if (m.route && m.route.path)
        routes.push({ path: m.route.path, methods: m.route.methods });
    });
  }
  res.json({ routes, has_router: !!app._router });
});

let db;

// Init DB
async function initDB() {
  try {
    db = await open({
      filename: path.join(__dirname, "data.db"),
      driver: sqlite3.Database,
    });

    // Enable foreign keys and better concurrency
    await db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

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

    // Migration: import sqlite_migration.sql if DB has few/no tables
    async function runMigrationIfNeeded() {
      try {
        const row = await db.get(
          "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        );
        const cnt = row?.cnt || 0;
        const migrationPath = path.join(__dirname, "sqlite_migration.sql");
        if (cnt > 5) {
          console.log(
            `DB already has tables (count=${cnt}), skipping migration.`
          );
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
              !/^(PRAGMA|BEGIN|COMMIT)/i.test(line.trim())
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

    await runMigrationIfNeeded();

    // Ensure persistent per-user ebook column exists (safe ALTER TABLE)
    try {
      const cols = await db.all("PRAGMA table_info(docenten);");
      const hasCol = cols.some((c) => c.name === "current_ebook_id");
      if (!hasCol) {
        await db.exec(
          "ALTER TABLE docenten ADD COLUMN current_ebook_id INTEGER;"
        );
        console.log("Added column docenten.current_ebook_id");
      }
    } catch (err) {
      console.warn("Could not ensure current_ebook_id column:", err.message);
    }

    // Ensure sessies has the columns used by the app (safe ALTER TABLE)
    try {
      const scols = await db.all("PRAGMA table_info(sessies);");
      const colNames = scols.map((c) => c.name);
      const need = [];
      if (!colNames.includes("docent_id"))
        need.push("ALTER TABLE sessies ADD COLUMN docent_id INTEGER;");
      if (!colNames.includes("actief"))
        need.push("ALTER TABLE sessies ADD COLUMN actief INTEGER DEFAULT 1;");
      if (!colNames.includes("started_at"))
        need.push(
          "ALTER TABLE sessies ADD COLUMN started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;"
        );
      if (!colNames.includes("round_seen"))
        need.push(
          "ALTER TABLE sessies ADD COLUMN round_seen TEXT DEFAULT '[]';"
        );
      if (!colNames.includes("prev_student_id"))
        need.push("ALTER TABLE sessies ADD COLUMN prev_student_id INTEGER;");
      if (!colNames.includes("current_student_id"))
        need.push("ALTER TABLE sessies ADD COLUMN current_student_id INTEGER;");
      if (!colNames.includes("current_question_id"))
        need.push(
          "ALTER TABLE sessies ADD COLUMN current_question_id INTEGER;"
        );
      // Ensure question_start_time exists (used to show when a question was sent)
      if (!colNames.includes("question_start_time"))
        need.push(
          "ALTER TABLE sessies ADD COLUMN question_start_time TIMESTAMP NULL;"
        );

      for (const q of need) {
        try {
          await db.exec(q);
          console.log("Added sessies column via:", q);
        } catch (err) {
          console.warn("Could not add sessies column:", err.message);
        }
      }
    } catch (err) {
      console.warn("Could not inspect sessies columns:", err.message);
    }

    // Ensure resultaten has grading and answer columns used by the UI
    try {
      const rcols = await db.all("PRAGMA table_info(resultaten);");
      const rcolNames = rcols.map((c) => c.name);
      const rneed = [];
      if (!rcolNames.includes("status"))
        rneed.push(
          "ALTER TABLE resultaten ADD COLUMN status TEXT DEFAULT 'onbekend';"
        );
      if (!rcolNames.includes("points"))
        rneed.push(
          "ALTER TABLE resultaten ADD COLUMN points INTEGER DEFAULT 0;"
        );
      if (!rcolNames.includes("antwoord_given"))
        rneed.push("ALTER TABLE resultaten ADD COLUMN antwoord_given TEXT;");

      for (const q of rneed) {
        try {
          await db.exec(q);
          console.log("Added resultaten column via:", q);
        } catch (err) {
          console.warn("Could not add resultaten column:", err.message);
        }
      }
    } catch (err) {
      console.warn("Could not inspect resultaten columns:", err.message);
    }

    console.log("Database ready ✅");
  } catch (err) {
    console.error("DB init error:", err);
  }
}
await initDB();

// --------------------
// Register route
// --------------------
app.post("/register", async (req, res) => {
  try {
    // Accept both english and dutch field names
    const email = req.body.email || req.body.e_mail;
    const rawPassword = req.body.password || req.body.wachtwoord;
    const naam = req.body.naam || req.body.name || null;

    if (!email || !rawPassword) {
      return res.status(400).json({ error: "email and password required" });
    }

    // Check whether email already exists
    const exists = await db.get(
      "SELECT id FROM docenten WHERE email = ?",
      email
    );
    if (exists) return res.status(400).json({ error: "email already exists" });

    const hashed = await bcrypt.hash(rawPassword, 10);

    // Insert into docenten using the imported column names
    await db.run(
      "INSERT INTO docenten (naam, email, wachtwoord) VALUES (?, ?, ?)",
      [naam, email, hashed]
    );

    // Return token so the client can authenticate immediately
    const newUser = await db.get(
      "SELECT id, email, naam FROM docenten WHERE email = ?",
      email
    );
    const token = jwt.sign({ id: newUser.id, email: newUser.email }, SECRET);

    res.json({ token });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------
// Login route
// --------------------
app.post("/login", async (req, res) => {
  try {
    const email = req.body.email;
    const rawPassword = req.body.password || req.body.wachtwoord;

    if (!email || !rawPassword)
      return res.status(400).json({ error: "Missing fields" });

    const user = await db.get("SELECT * FROM docenten WHERE email = ?", email);
    // Ensure we have a password column (imported `docenten` uses `wachtwoord`)
    if (!user || !user.wachtwoord)
      return res.status(400).json({ error: "User not found or no password" });

    const match = await bcrypt.compare(rawPassword, user.wachtwoord);
    if (!match) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET);
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------
// Auth middleware
// --------------------
function auth(req, res, next) {
  try {
    const headerToken = req.headers.authorization?.split(" ")[1];
    const bodyToken = req.body?.token || req.query?.token;
    const token = headerToken || bodyToken;
    if (!token) return res.status(401).json({ error: "No token" });

    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    console.error("auth error", err);
    res.status(403).json({ error: "Invalid token" });
  }
}

// --------------------
// Protected endpoint
// --------------------
app.get("/me", auth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// Set currently-opened ebook for the authenticated user (persisted in DB)
app.post("/open-ebook", auth, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.body.id || req.body.bookId, 10);
    if (!id || Number.isNaN(id))
      return res.status(400).json({ error: "invalid id" });

    // ensure book exists
    const book = await db.get("SELECT id FROM boeken WHERE id = ?", id);
    if (!book) return res.status(404).json({ error: "book not found" });

    // check license: does the user have an active license that includes this book?
    const lic = await db.get(
      `SELECT l.id FROM licentie_boeken lb
       JOIN licenties l ON lb.licentie_id = l.id
       WHERE lb.boek_id = ? AND l.docent_id = ? AND l.actief = 1
         AND (l.vervalt_op IS NULL OR DATE(l.vervalt_op) >= DATE('now'))
       LIMIT 1`,
      id,
      req.user.id
    );

    if (!lic) {
      return res.status(403).json({ error: "no license to open this book" });
    }

    await db.run(
      "UPDATE docenten SET current_ebook_id = ? WHERE id = ?",
      id,
      req.user.id
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error("/open-ebook error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Get current ebook for the authenticated user (includes book info when available)
app.get("/my-current-ebook", auth, async (req, res) => {
  try {
    const row = await db.get(
      "SELECT current_ebook_id FROM docenten WHERE id = ?",
      req.user.id
    );
    const id = row?.current_ebook_id || null;
    if (!id) return res.json({ id: null });
    const book = await db.get(
      "SELECT id, titel, omschrijving FROM boeken WHERE id = ?",
      id
    );
    res.json({ id, book });
  } catch (err) {
    console.error("/my-current-ebook error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Dashboard data (klassen, licenties, bibliotheek, boeken) — authenticated
app.get("/dashboard-data", auth, async (req, res) => {
  try {
    const docentId = req.user.id;
    console.log(`/dashboard-data requested by ${docentId}`);

    const docent = await db.get(
      "SELECT id, naam, avatar, current_ebook_id FROM docenten WHERE id = ?",
      docentId
    );
    console.log("Loaded docent:", !!docent);

    const klassen = await db.all(
      "SELECT * FROM klassen WHERE docent_id = ? ORDER BY id DESC",
      docentId
    );
    console.log("Loaded klassen:", (klassen || []).length);

    let licenties = [];
    try {
      licenties = await db.all(
        "SELECT * FROM licenties WHERE docent_id = ? AND actief = 1 AND (vervalt_op IS NULL OR DATE(vervalt_op) >= DATE('now'))",
        docentId
      );
      console.log("Loaded licenties:", licenties.length);
    } catch (err) {
      console.warn("Could not load licenties:", err.message);
      licenties = [];
    }

    const heeft_licentie = Array.isArray(licenties)
      ? licenties.some((l) => l.type === "vragenlijsten")
      : false;

    let biblio_lijsten = [];
    try {
      if (docentId === 3) {
        biblio_lijsten = await db.all(
          "SELECT * FROM bibliotheek_vragenlijsten ORDER BY id DESC"
        );
      } else {
        biblio_lijsten = await db.all(
          "SELECT * FROM bibliotheek_vragenlijsten WHERE licentie_type != 'verborgen' ORDER BY id DESC"
        );
      }
      console.log("Loaded biblio_lijsten:", (biblio_lijsten || []).length);
    } catch (err) {
      console.warn("Could not load bibliotheek_vragenlijsten:", err.message);
      biblio_lijsten = [];
    }

    let boeken = [];
    try {
      if (docentId === -1) {
        boeken = await db.all(
          "SELECT id, titel, omschrijving FROM boeken ORDER BY id DESC"
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
          docentId
        );
      }
      console.log("Loaded boeken:", (boeken || []).length);
    } catch (err) {
      console.warn(
        "Could not load boeken with licentie join, falling back to empty list:",
        err.message
      );
      boeken = [];
    }

    res.json({
      docent,
      klassen,
      licenties,
      heeft_licentie,
      biblio_lijsten,
      boeken,
    });
  } catch (err) {
    console.error("/dashboard-data error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Create new klas (authenticated)
app.post("/create-klas", auth, express.json(), async (req, res) => {
  try {
    const naam = (req.body.naam || "").trim();
    const vak = (req.body.vak || "").trim();
    if (!naam) return res.status(400).json({ error: "naam required" });
    const code = crypto
      .randomBytes(4)
      .toString("hex")
      .slice(0, 6)
      .toUpperCase();
    const r = await db.run(
      "INSERT INTO klassen (docent_id, naam, klascode, vak, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
      req.user.id,
      naam,
      code,
      vak
    );
    const klas = await db.get("SELECT * FROM klassen WHERE id = ?", r.lastID);
    res.json({ ok: true, klas });
  } catch (err) {
    console.error("/create-klas error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Simple public search for public docenten
app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json([]);
    const rows = await db.all(
      "SELECT id, naam, badge FROM docenten WHERE is_public = 1 AND naam LIKE ? LIMIT 20",
      `%${q}%`
    );
    res.json(rows);
  } catch (err) {
    console.error("/search error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Get klas details (authenticated)
app.get("/klas/:id", auth, async (req, res) => {
  try {
    const klasId = parseInt(req.params.id, 10);
    const klas = await db.get(
      "SELECT * FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      req.user.id
    );
    if (!klas) return res.status(404).json({ error: "klas not found" });

    const leerlingen = await db.all(
      "SELECT id, naam FROM leerlingen WHERE klas_id = ? ORDER BY naam",
      klasId
    );
    const vragenlijsten = await db.all(
      "SELECT id, naam FROM vragenlijsten WHERE klas_id = ? ORDER BY id DESC",
      klasId
    );

    res.json({ klas, leerlingen, vragenlijsten });
  } catch (err) {
    console.error("/klas/:id error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Delete klas (authenticated, owner only)
app.post("/delete-klas", auth, express.json(), async (req, res) => {
  try {
    const klasId = parseInt(req.body.id, 10);
    if (!klasId) return res.status(400).json({ error: "id required" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    await db.exec("PRAGMA foreign_keys = OFF;");
    await db.exec("BEGIN;");
    try {
      // Delete in order of dependencies
      await db.run(
        "DELETE FROM resultaten WHERE sessie_id IN (SELECT id FROM sessies WHERE klas_id = ?)",
        klasId
      );
      await db.run("DELETE FROM sessies WHERE klas_id = ?", klasId);
      await db.run("DELETE FROM vragen WHERE klas_id = ?", klasId);
      await db.run("DELETE FROM leerlingen WHERE klas_id = ?", klasId);
      await db.run("DELETE FROM vragenlijsten WHERE klas_id = ?", klasId);
      await db.run(
        "DELETE FROM klassen WHERE id = ? AND docent_id = ?",
        klasId,
        req.user.id
      );
      await db.exec("COMMIT;");
    } catch (err) {
      await db.exec("ROLLBACK;");
      throw err;
    } finally {
      await db.exec("PRAGMA foreign_keys = ON;");
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("/delete-klas error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Create vragenlijst (authenticated, owner of klas)
app.post("/vragenlijst", auth, express.json(), async (req, res) => {
  try {
    const klasId = parseInt(req.body.klas_id, 10);
    const naam = (req.body.naam || "").trim();
    if (!klasId || !naam)
      return res.status(400).json({ error: "klas_id and naam required" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    const r = await db.run(
      "INSERT INTO vragenlijsten (klas_id, naam) VALUES (?, ?)",
      klasId,
      naam
    );
    res.json({ ok: true, id: r.lastID });
  } catch (err) {
    console.error("/vragenlijst error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Update vragenlijst (authenticated)
app.put("/vragenlijst/:id", auth, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const naam = (req.body.naam || "").trim();
    if (!naam) return res.status(400).json({ error: "naam required" });

    const vl = await db.get(
      "SELECT klas_id FROM vragenlijsten WHERE id = ?",
      id
    );
    if (!vl) return res.status(404).json({ error: "vragenlijst not found" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      vl.klas_id,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    await db.run("UPDATE vragenlijsten SET naam = ? WHERE id = ?", naam, id);
    res.json({ ok: true });
  } catch (err) {
    console.error("/vragenlijst/:id error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Delete vragenlijst (authenticated)
app.delete("/vragenlijst/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const vl = await db.get(
      "SELECT klas_id FROM vragenlijsten WHERE id = ?",
      id
    );
    if (!vl) return res.status(404).json({ error: "vragenlijst not found" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      vl.klas_id,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    // Delete vragen and resultaten
    const vragen = await db.all(
      "SELECT id FROM vragen WHERE vragenlijst_id = ?",
      id
    );
    for (const v of vragen) {
      await db.run("DELETE FROM resultaten WHERE vraag_id = ?", v.id);
    }
    await db.run("DELETE FROM vragen WHERE vragenlijst_id = ?", id);
    await db.run("DELETE FROM vragenlijsten WHERE id = ?", id);

    res.json({ ok: true });
  } catch (err) {
    console.error("/vragenlijst/:id DELETE error:", err);
    res.status(500).json({ error: "server error" });
  }
});

console.log("Registering GET /vragenlijst/:id");
// Get vragenlijst with vragen (authenticated)
app.get("/vragenlijst/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const lijst = await db.get(
      "SELECT v.*, k.docent_id, k.naam as klasnaam, v.klas_id FROM vragenlijsten v JOIN klassen k ON v.klas_id = k.id WHERE v.id = ?",
      id
    );
    if (!lijst) return res.status(404).json({ error: "vragenlijst not found" });
    if (lijst.docent_id !== req.user.id)
      return res.status(403).json({ error: "unauthorized" });

    const vragen = await db.all(
      "SELECT * FROM vragen WHERE vragenlijst_id = ? ORDER BY id DESC",
      id
    );

    res.json({ ...lijst, vragen });
  } catch (err) {
    console.error("/vragenlijst/:id GET error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Diagnostic: list routes
app.get("/routes", (req, res) => {
  const routes = [];
  if (app._router && Array.isArray(app._router.stack)) {
    app._router.stack.forEach((m) => {
      if (m.route && m.route.path) {
        routes.push({ path: m.route.path, methods: m.route.methods });
      }
    });
  }
  res.json(routes);
});

// Diagnostic: app inspection
app.get("/who", (req, res) => {
  res.json({
    has_router: !!app._router,
    router_keys: app._router ? Object.keys(app._router) : null,
    stack_len:
      app._router && app._router.stack ? app._router.stack.length : null,
  });
});

// Vragenlijst: add vraag
app.post("/vragenlijst/:id/vraag", auth, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vraag = (req.body.vraag || "").trim();
    const antwoord = (req.body.antwoord || "").trim();
    if (!vraag || !antwoord)
      return res.status(400).json({ error: "vraag and antwoord required" });

    const vl = await db.get(
      "SELECT klas_id FROM vragenlijsten WHERE id = ?",
      id
    );
    if (!vl) return res.status(404).json({ error: "vragenlijst not found" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      vl.klas_id,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    const r = await db.run(
      "INSERT INTO vragen (klas_id, vragenlijst_id, vraag, antwoord) VALUES (?, ?, ?, ?)",
      vl.klas_id,
      id,
      vraag,
      antwoord
    );
    res.json({ ok: true, id: r.lastID });
  } catch (err) {
    console.error("/vragenlijst/:id/vraag error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Vragenlijst: edit vraag
app.put("/vragen/:id", auth, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const vraag = (req.body.vraag || "").trim();
    const antwoord = (req.body.antwoord || "").trim();
    if (!vraag || !antwoord)
      return res.status(400).json({ error: "vraag and antwoord required" });

    // Also select klas_id so we can verify ownership
    const v = await db.get(
      "SELECT vragenlijst_id, klas_id FROM vragen WHERE id = ?",
      id
    );
    if (!v) return res.status(404).json({ error: "vraag not found" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      v.klas_id,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    await db.run(
      "UPDATE vragen SET vraag = ?, antwoord = ? WHERE id = ?",
      vraag,
      antwoord,
      id
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("/vragen/:id PUT error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Vragenlijst: delete vraag
app.delete("/vragen/:id", auth, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const v = await db.get(
      "SELECT vragenlijst_id, klas_id FROM vragen WHERE id = ?",
      id
    );
    if (!v) return res.status(404).json({ error: "vraag not found" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      v.klas_id,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    await db.run("DELETE FROM resultaten WHERE vraag_id = ?", id);
    await db.run("DELETE FROM vragen WHERE id = ?", id);
    res.json({ ok: true });
  } catch (err) {
    console.error("/vragen/:id DELETE error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Start a new sessie (authenticated)
app.post("/sessies", auth, express.json(), async (req, res) => {
  try {
    const klasId = parseInt(req.body.klas_id, 10);
    const vragenlijstId = parseInt(req.body.vragenlijst_id, 10);
    if (!klasId || !vragenlijstId)
      return res
        .status(400)
        .json({ error: "klas_id and vragenlijst_id required" });

    // verify klas belongs to user
    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      req.user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    // verify vragenlijst belongs to klas
    const lijst = await db.get(
      "SELECT id FROM vragenlijsten WHERE id = ? AND klas_id = ?",
      vragenlijstId,
      klasId
    );
    if (!lijst)
      return res.status(400).json({ error: "vragenlijst not found for klas" });

    // stop other sessies for this klas
    await db.run("UPDATE sessies SET actief = 0 WHERE klas_id = ?", klasId);

    // insert new sessie
    const r = await db.run(
      `INSERT INTO sessies (klas_id, docent_id, vragenlijst_id, actief, started_at, round_seen, prev_student_id, current_student_id, current_question_id)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, json('[]'), NULL, NULL, NULL)`,
      klasId,
      req.user.id,
      vragenlijstId
    );
    res.json({ ok: true, id: r.lastID });
  } catch (err) {
    console.error("/sessies POST error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Start sessie via GET (supports token in query for non-preflighted requests)
app.get("/start-sessie", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: "No token" });
    let user;
    try {
      user = jwt.verify(token, SECRET);
    } catch (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    const klasId = parseInt(req.query.klas_id || req.query.klas, 10);
    const vragenlijstId = parseInt(
      req.query.vragenlijst_id || req.query.vragenlijst,
      10
    );
    if (!klasId || !vragenlijstId)
      return res
        .status(400)
        .json({ error: "klas_id and vragenlijst_id required" });

    const klas = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      user.id
    );
    if (!klas) return res.status(403).json({ error: "unauthorized" });

    const lijst = await db.get(
      "SELECT id FROM vragenlijsten WHERE id = ? AND klas_id = ?",
      vragenlijstId,
      klasId
    );
    if (!lijst)
      return res.status(400).json({ error: "vragenlijst not found for klas" });

    await db.run("UPDATE sessies SET actief = 0 WHERE klas_id = ?", klasId);
    const r = await db.run(
      `INSERT INTO sessies (klas_id, docent_id, vragenlijst_id, actief, started_at, round_seen, prev_student_id, current_student_id, current_question_id)
       VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, json('[]'), NULL, NULL, NULL)`,
      klasId,
      user.id,
      vragenlijstId
    );
    res.json({ ok: true, id: r.lastID });
  } catch (err) {
    console.error("/start-sessie GET error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Delete all students from klas (authenticated)
app.post("/delete-leerlingen", auth, express.json(), async (req, res) => {
  try {
    const klasId = parseInt(req.body.klas_id, 10);
    if (!klasId) return res.status(400).json({ error: "klas_id required" });

    const klas2 = await db.get(
      "SELECT id FROM klassen WHERE id = ? AND docent_id = ?",
      klasId,
      req.user.id
    );
    if (!klas2) return res.status(403).json({ error: "unauthorized" });

    await db.run("DELETE FROM leerlingen WHERE klas_id = ?", klasId);
    res.json({ ok: true });
  } catch (err) {
    console.error("/delete-leerlingen error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// --------------------
// Sessies & results API (authenticated)
// --------------------
console.log(
  "Registering session routes: /sessies/:id, /sessies/:id/scoreboard, /sessies/:id/recent-answers, /sessies/:id/send_question"
);

// Get session details including current question, answer count and students
app.get("/sessies/:id", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sess = await db.get(
      "SELECT s.*, k.naam as klasnaam, k.klascode FROM sessies s JOIN klassen k ON k.id = s.klas_id WHERE s.id = ? AND s.docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res
        .status(404)
        .json({ error: "sessie not found or unauthorized" });

    const currentQuestion = sess.current_question_id
      ? await db.get(
          "SELECT id, vraag, antwoord FROM vragen WHERE id = ?",
          sess.current_question_id
        )
      : null;
    const answerCountRow = currentQuestion
      ? await db.get(
          "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
          id,
          currentQuestion.id
        )
      : { c: 0 };

    const leerlingen = await db.all(
      "SELECT id, naam FROM leerlingen WHERE klas_id = ?",
      sess.klas_id
    );

    res.json({
      sess,
      currentQuestion,
      answerCount: answerCountRow.c,
      leerlingen,
    });
  } catch (err) {
    console.error("GET /sessies/:id error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Scoreboard for a session
app.get("/_test_sessies", (req, res) => res.json({ ok: true, msg: "test ok" }));
app.get("/sessies/:id/scoreboard", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sess = await db.get(
      "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res
        .status(404)
        .json({ error: "sessie not found or unauthorized" });

    const rows = await db.all(
      `SELECT l.id as leerling_id, l.naam, COALESCE(SUM(r.points),0) as points, COUNT(r.id) as answers
       FROM leerlingen l
       LEFT JOIN resultaten r ON r.leerling_id = l.id AND r.sessie_id = ?
       WHERE l.klas_id = ?
       GROUP BY l.id
       ORDER BY points DESC, l.naam ASC`,
      id,
      sess.klas_id
    );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error("GET /sessies/:id/scoreboard error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Recent answers for a session
app.get("/sessies/:id/recent-answers", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sess = await db.get(
      "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res
        .status(404)
        .json({ error: "sessie not found or unauthorized" });

    const rows = await db.all(
      `SELECT r.id, r.leerling_id, l.naam as leerling, r.antwoord, r.status, r.points, r.created_at, v.vraag as vraag
       FROM resultaten r
       JOIN leerlingen l ON l.id = r.leerling_id
       LEFT JOIN vragen v ON v.id = r.vraag_id
       WHERE r.sessie_id = ?
       ORDER BY (CASE WHEN r.status IS NULL OR r.status = 'onbekend' THEN 0 ELSE 1 END), r.created_at DESC
       LIMIT 50`,
      id
    );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error("GET /sessies/:id/recent-answers error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Send next question (pick random not-yet-asked question)
app.post(
  "/sessies/:id/send_question",
  auth,
  express.json(),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const sess = await db.get(
        "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
        id,
        req.user.id
      );
      if (!sess)
        return res
          .status(404)
          .json({ error: "sessie not found or unauthorized" });

      const asked = await db.all(
        "SELECT DISTINCT vraag_id FROM resultaten WHERE sessie_id = ?",
        id
      );
      const askedIds = asked.map((r) => r.vraag_id).filter(Boolean);

      let q;
      if (askedIds.length === 0) {
        q = await db.get(
          "SELECT * FROM vragen WHERE klas_id = ? AND vragenlijst_id = ? ORDER BY RANDOM() LIMIT 1",
          sess.klas_id,
          sess.vragenlijst_id
        );
      } else {
        const placeholders = askedIds.map(() => "?").join(",");
        const sql = `SELECT * FROM vragen WHERE klas_id = ? AND vragenlijst_id = ? AND id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT 1`;
        q = await db.get(sql, sess.klas_id, sess.vragenlijst_id, ...askedIds);
      }

      if (!q) return res.json({ ok: false, no_more: true });

      await db.run(
        "UPDATE sessies SET current_question_id = ?, question_start_time = CURRENT_TIMESTAMP WHERE id = ?",
        q.id,
        id
      );

      // Clear previous answers for this question in this session
      await db.run(
        "DELETE FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
        id,
        q.id
      );

      res.json({ ok: true, vraag_id: q.id });
      // broadcast update to any connected teacher clients
      broadcastSession(id).catch((e) =>
        console.error("broadcast send_question", e)
      );
    } catch (err) {
      console.error("POST /sessies/:id/send_question error:", err);
      res.status(500).json({ error: "server error" });
    }
  }
);

// Clear current question
app.post(
  "/sessies/:id/clear_question",
  auth,
  express.json(),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const sess = await db.get(
        "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
        id,
        req.user.id
      );
      if (!sess)
        return res
          .status(404)
          .json({ error: "sessie not found or unauthorized" });

      await db.run(
        "UPDATE sessies SET current_question_id = NULL, question_start_time = NULL WHERE id = ?",
        id
      );
      res.json({ ok: true });
      // broadcast update
      broadcastSession(id).catch((e) =>
        console.error("broadcast clear_question", e)
      );
    } catch (err) {
      console.error("POST /sessies/:id/clear_question error:", err);
      res.status(500).json({ error: "server error" });
    }
  }
);

// Stop (end) a session — teacher only
app.post("/sessies/:id/stop", auth, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sess = await db.get(
      "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res
        .status(404)
        .json({ error: "sessie not found or unauthorized" });

    // mark session inactive and clear current question
    await db.run(
      "UPDATE sessies SET actief = 0, current_question_id = NULL, question_start_time = NULL WHERE id = ?",
      id
    );

    res.json({ ok: true });
    // broadcast updated session to all clients
    broadcastSession(id).catch((e) =>
      console.error("broadcast stop_session", e)
    );
  } catch (err) {
    console.error("POST /sessies/:id/stop error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Grade an answer
app.post("/grade-answer", auth, express.json(), async (req, res) => {
  try {
    const { resultaat_id, status } = req.body;
    if (!resultaat_id || !status)
      return res
        .status(400)
        .json({ error: "resultaat_id and status required" });

    let points = 0;
    switch (status) {
      case "goed":
        points = 10;
        break;
      case "typfout":
        points = 5;
        break;
      case "fout":
      default:
        points = 0;
    }

    await db.run(
      "UPDATE resultaten SET status = ?, points = ? WHERE id = ?",
      status,
      points,
      resultaat_id
    );
    res.json({ ok: true });
    // broadcast update for the session that contains this resultaat
    try {
      const rrow = await db.get(
        "SELECT sessie_id FROM resultaten WHERE id = ?",
        resultaat_id
      );
      if (rrow && rrow.sessie_id)
        broadcastSession(rrow.sessie_id).catch((e) =>
          console.error("broadcast grade-answer", e)
        );
    } catch (e) {
      console.warn("Could not broadcast after grade:", e.message);
    }
  } catch (err) {
    console.error("POST /grade-answer error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Delete a single student from a session's klas
app.delete("/sessies/:id/leerling/:lid", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const lid = parseInt(req.params.lid, 10);
    const sess = await db.get(
      "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res
        .status(404)
        .json({ error: "sessie not found or unauthorized" });

    await db.run(
      "DELETE FROM resultaten WHERE leerling_id = ? AND sessie_id = ?",
      lid,
      id
    );
    await db.run(
      "DELETE FROM leerlingen WHERE id = ? AND klas_id = ?",
      lid,
      sess.klas_id
    );

    res.json({ ok: true });
    // broadcast update
    broadcastSession(id).catch((e) =>
      console.error("broadcast delete-leerling", e)
    );
  } catch (err) {
    console.error("DELETE /sessies/:id/leerling/:lid error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Export results CSV for a session (authenticated)
app.get("/sessies/:id/export", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sess = await db.get(
      "SELECT * FROM sessies WHERE id = ? AND docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res.status(404).send("sessie niet gevonden of geen rechten");

    const rows = await db.all(
      `SELECT l.naam as leerling, v.vraag, COALESCE(r.antwoord_given, r.antwoord) as gegeven_antwoord, COALESCE(r.status, 'onbekend') as status, r.created_at
       FROM resultaten r
       JOIN leerlingen l ON l.id = r.leerling_id
       LEFT JOIN vragen v ON v.id = r.vraag_id
       WHERE r.sessie_id = ?
       ORDER BY r.created_at ASC`,
      id
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sessie_${id}_resultaten.csv`
    );

    // Write CSV header
    res.write("Leerling,Vraag,Gegeven Antwoord,Status,Datum en Tijd\n");
    for (const r of rows) {
      // Basic CSV escaping
      const row =
        [
          r.leerling || "",
          r.vraag || "",
          r.gegeven_antwoord || "",
          r.status || "",
          r.created_at || "",
        ]
          .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
          .join(",") + "\n";
      res.write(row);
    }
    res.end();
  } catch (err) {
    console.error("GET /sessies/:id/export error:", err);
    res.status(500).send("server error");
  }
});

// Return answer count for current question (simple endpoint)
app.get("/sessies/:id/answer_count", auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sess = await db.get(
      "SELECT current_question_id FROM sessies WHERE id = ? AND docent_id = ?",
      id,
      req.user.id
    );
    if (!sess)
      return res
        .status(404)
        .json({ error: "sessie not found or unauthorized" });
    if (!sess.current_question_id) return res.send("0");
    const row = await db.get(
      "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
      id,
      sess.current_question_id
    );
    res.send(String(row.c || 0));
  } catch (err) {
    console.error("GET /sessies/:id/answer_count error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// --------------------
// Student-facing routes (replacement for legacy PHP endpoints)
// --------------------

// Join a class as leerling
app.post("/leerling/join", express.json(), async (req, res) => {
  console.log("POST /leerling/join called");
  try {
    const code = String(req.body.klascode || req.body.join_klascode || "")
      .toUpperCase()
      .trim();
    const naam = String(req.body.naam || "").trim();
    if (!code || !naam)
      return res.status(400).json({ error: "klascode en naam required" });

    const klas = await db.get("SELECT * FROM klassen WHERE klascode = ?", code);
    if (!klas) return res.status(404).json({ error: "klas not found" });

    const r = await db.run(
      "INSERT INTO leerlingen (klas_id, naam) VALUES (?, ?)",
      klas.id,
      naam
    );
    const lid = r.lastID;

    res.json({ ok: true, leerling_id: lid, klas_id: klas.id, klas_code: code });
  } catch (err) {
    console.error("/leerling/join error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Get student state (active session, current question, score, recent answers)
app.get("/student/state", async (req, res) => {
  try {
    const leerling_id = parseInt(req.query.leerling_id, 10);
    const klas_id = parseInt(req.query.klas_id, 10);
    if (!leerling_id || !klas_id)
      return res
        .status(400)
        .json({ error: "leerling_id and klas_id required" });

    const leerling = await db.get(
      "SELECT id, naam FROM leerlingen WHERE id = ? AND klas_id = ?",
      leerling_id,
      klas_id
    );
    if (!leerling) return res.status(404).json({ error: "leerling not found" });

    const sess = await db.get(
      "SELECT * FROM sessies WHERE klas_id = ? AND actief = 1 LIMIT 1",
      klas_id
    );
    if (!sess) return res.json({ session_ended: true });

    const session_id = sess.id;
    const currentQuestion = sess.current_question_id
      ? await db.get(
          "SELECT id, vraag FROM vragen WHERE id = ?",
          sess.current_question_id
        )
      : null;

    let already_answered = false;
    let question_text = null;
    if (currentQuestion) {
      question_text = currentQuestion.vraag;
      const r = await db.get(
        "SELECT id, status, points, antwoord_given, created_at FROM resultaten WHERE sessie_id = ? AND vraag_id = ? AND leerling_id = ?",
        session_id,
        currentQuestion.id,
        leerling_id
      );
      if (r) already_answered = true;
    }

    const scoreRow = await db.get(
      "SELECT COALESCE(SUM(points),0) as score FROM resultaten WHERE sessie_id = ? AND leerling_id = ?",
      session_id,
      leerling_id
    );
    const answerCountRow = await db.get(
      "SELECT COUNT(*) as c FROM resultaten WHERE sessie_id = ? AND leerling_id = ?",
      session_id,
      leerling_id
    );

    const recent = await db.all(
      "SELECT r.id, r.vraag_id, v.vraag as question, COALESCE(r.antwoord_given, r.antwoord) as antwoord, r.status, r.points, r.created_at FROM resultaten r LEFT JOIN vragen v ON v.id = r.vraag_id WHERE r.sessie_id = ? AND r.leerling_id = ? ORDER BY r.created_at DESC LIMIT 50",
      session_id,
      leerling_id
    );

    let all_answered = false;
    let correct_answer = null;
    if (currentQuestion) {
      const totalStudents = await db.get(
        "SELECT COUNT(*) as c FROM leerlingen WHERE klas_id = ?",
        klas_id
      );
      const answeredCount = await db.get(
        "SELECT COUNT(DISTINCT leerling_id) as c FROM resultaten WHERE sessie_id = ? AND vraag_id = ?",
        session_id,
        currentQuestion.id
      );
      all_answered = (answeredCount.c || 0) >= (totalStudents.c || 0);
      const ansRow = await db.get(
        "SELECT antwoord FROM vragen WHERE id = ?",
        currentQuestion.id
      );
      correct_answer = ansRow?.antwoord || null;
    }

    res.json({
      session_id,
      current_question_id: currentQuestion?.id || null,
      question_text,
      already_answered,
      score: scoreRow?.score || 0,
      answer_count: answerCountRow?.c || 0,
      recent_answers: (recent || []).map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.antwoord,
        status: r.status,
        points: r.points,
        created_at: r.created_at,
      })),
      all_answered,
      correct_answer,
    });
  } catch (err) {
    console.error("/student/state error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Submit an answer as a leerling
app.post("/sessies/:id/answer", express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const leerling_id = parseInt(req.body.leerling_id, 10);
    const vraag_id = parseInt(req.body.vraag_id, 10);
    const antwoord = String(req.body.antwoord || "").trim();

    if (!id || !leerling_id || !vraag_id || !antwoord)
      return res.status(400).json({ error: "missing fields" });

    const sess = await db.get(
      "SELECT * FROM sessies WHERE id = ? AND actief = 1",
      id
    );
    if (!sess) return res.status(404).json({ error: "sessie not found" });

    const existing = await db.get(
      "SELECT id FROM resultaten WHERE sessie_id = ? AND vraag_id = ? AND leerling_id = ?",
      id,
      vraag_id,
      leerling_id
    );
    if (existing)
      return res.json({ success: false, message: "already answered" });

    // auto-grade: fetch correct answer and compare (loose normalizing: trim, collapse spaces, case-insensitive)
    const correctRow = await db.get(
      "SELECT antwoord FROM vragen WHERE id = ?",
      vraag_id
    );
    const normalize = (s) =>
      String(s || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    let status = "onbekend";
    let points = 0;
    if (correctRow) {
      if (normalize(correctRow.antwoord) === normalize(antwoord)) {
        status = "goed";
        points = 10;
      } else {
        status = "onbekend";
        points = 0;
      }
    }

    await db.run(
      "INSERT INTO resultaten (sessie_id, leerling_id, vraag_id, antwoord, antwoord_given, status, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
      id,
      leerling_id,
      vraag_id,
      antwoord,
      antwoord,
      status,
      points
    );

    // notify teachers and students
    broadcastSession(id).catch(() => {});
    res.json({ success: true, auto_graded: status === "goed", status });
  } catch (err) {
    console.error("/sessies/:id/answer error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Lightweight presence/status update
app.post("/status-update", express.json(), async (req, res) => {
  try {
    // Accept { leerling_id, klas_id, status }
    const { leerling_id, klas_id, status } = req.body || {};
    if (leerling_id) {
      const p = {
        status: String(status || "non-actief"),
        focused: String(status || "").toLowerCase() === "actief",
        last_seen: new Date().toISOString(),
      };
      presence.set(String(leerling_id), p);

      // If klas_id provided, try to broadcast session update for that klas
      if (klas_id) {
        try {
          const sessRow = await db.get(
            "SELECT id FROM sessies WHERE klas_id = ? AND actief = 1",
            klas_id
          );
          if (sessRow && sessRow.id) {
            broadcastSession(sessRow.id).catch(() => {});
          }
        } catch (e) {
          // ignore
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("/status-update error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// --------------------
// Server starten
// --------------------
// Debug: list registered routes at startup (guarded)
if (app._router && Array.isArray(app._router.stack)) {
  console.log("Registered routes:");
  app._router.stack.forEach((m) => {
    if (m.route && m.route.path) {
      console.log(m.route.path, Object.keys(m.route.methods).join(","));
    }
  });
} else {
  console.log("Registered routes: app._router is not defined yet");
}
setTimeout(() => {
  if (app._router && Array.isArray(app._router.stack)) {
    console.log("Delayed route list:");
    app._router.stack.forEach((m) => {
      if (m.route && m.route.path)
        console.log(m.route.path, Object.keys(m.route.methods).join(","));
    });
  } else {
    console.log("Delayed route list: app._router is not defined");
  }
}, 1000);

// Global error handlers to help debugging unexpected exits
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err && err.stack ? err.stack : err);
  // don't exit on error
});
process.on("unhandledRejection", (reason, p) => {
  console.error("unhandledRejection at:", p, "reason:", reason);
  // don't exit on rejection
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);

  // List routes after listen to ensure they're registered
  setTimeout(() => {
    console.log("📋 Available routes (after listen):");
    if (app._router && Array.isArray(app._router.stack)) {
      const routes = app._router.stack.filter((m) => m.route);
      if (routes.length > 0) {
        routes.forEach((m) => {
          const methods = Object.keys(m.route.methods)
            .map((m) => m.toUpperCase())
            .join(",");
          console.log(`  ${methods.padEnd(6)} ${m.route.path}`);
        });
      } else {
        console.log("  [No routes registered]");
      }
    } else {
      console.log("  [app._router not initialized]");
    }
  }, 100);
});

// Keep server alive
server.on("error", (err) => {
  console.error("Server error:", err);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutdown signal received");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
