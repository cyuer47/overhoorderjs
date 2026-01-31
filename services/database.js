import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

export const initDB = async () => {
  try {
    db = await open({
      filename: path.join(__dirname, '../data.db'),
      driver: sqlite3.Database,
    });

    await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

    // Create tables
    await createTables();
    
    // Create admin user
    await createAdminUser();
    
    console.log('✅ Database initialized successfully');
    return db;
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
  }
};

const createTables = async () => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS docenten (
      id INTEGER PRIMARY KEY,
      naam TEXT,
      email TEXT UNIQUE NOT NULL,
      wachtwoord TEXT,
      avatar TEXT,
      is_public INTEGER DEFAULT 0,
      badge TEXT,
      reset_token TEXT,
      reset_token_expiry TEXT,
      current_ebook_id INTEGER
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
      docent_id INTEGER,
      klas_id INTEGER,
      max_leerlingen INTEGER DEFAULT 30,
      licentie_code TEXT UNIQUE NOT NULL,
      is_redeemed INTEGER DEFAULT 0,
      redeemed_by INTEGER DEFAULT NULL,
      redeemed_at TIMESTAMP DEFAULT NULL,
      actief INTEGER DEFAULT 1,
      vervalt_op DATE DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER NOT NULL,
      FOREIGN KEY (klas_id) REFERENCES klassen(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES docenten(id),
      FOREIGN KEY (redeemed_by) REFERENCES docenten(id)
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
      email TEXT UNIQUE NOT NULL,
      password TEXT,
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
    
    CREATE TABLE IF NOT EXISTS bibliotheek_vragenlijsten (
      id INTEGER PRIMARY KEY,
      naam TEXT NOT NULL,
      beschrijving TEXT DEFAULT NULL,
      licentie_type TEXT CHECK (licentie_type IN ('gratis','verborgen','Neue Kontakte','Engels','Grandes Lignes','Overal Natuurkunde')) DEFAULT 'gratis',
      created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    
    CREATE TABLE IF NOT EXISTS bibliotheek_vragen (
      id INTEGER NOT NULL,
      bibliotheek_lijst_id INTEGER NOT NULL,
      vraag TEXT NOT NULL,
      antwoord TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS boeken (
      id INTEGER PRIMARY KEY,
      titel TEXT NOT NULL,
      bestand TEXT NOT NULL,
      omschrijving TEXT DEFAULT NULL
    );
    
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER NOT NULL,
      key TEXT NOT NULL,
      type TEXT CHECK (type IN ('docent','leerling')) NOT NULL,
      user_id INTEGER NOT NULL,
      active INTEGER DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    
    CREATE TABLE IF NOT EXISTS berichten (
      id INTEGER NOT NULL,
      afzender_id INTEGER NOT NULL,
      ontvanger_type TEXT CHECK (ontvanger_type IN ('klas','leerling')) NOT NULL,
      ontvanger_id INTEGER NOT NULL,
      bericht TEXT NOT NULL,
      gelezen INTEGER DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP) 
    );
  `);
};

const createAdminUser = async () => {
  const adminExists = await db.get('SELECT id FROM docenten WHERE id = 1');
  if (!adminExists) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    await db.run(
      'INSERT INTO docenten (id, naam, email, wachtwoord) VALUES (1, ?, ?, ?)',
      'Administrator',
      'admin@overhoorder.nl',
      adminPassword
    );
    console.log('✅ Admin user created (id: 1, email: admin@overhoorder.nl, password: admin123)');
  }
};

export const getDB = () => db;
