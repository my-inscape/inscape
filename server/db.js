'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.INSCAPE_DB_PATH || path.join(DATA_DIR, 'inscape.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEED_PATH = path.join(__dirname, 'seed.sql');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function openDb() {
  ensureDataDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrateColumns(db) {
  const cols = db.prepare('PRAGMA table_info(invitation_codes)').all().map((c) => c.name);
  if (!cols.includes('issued_by_session_id')) {
    db.exec('ALTER TABLE invitation_codes ADD COLUMN issued_by_session_id TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_invitation_codes_session
        ON invitation_codes (issued_by_session_id)
    `);
  }
  if (!cols.includes('is_reusable')) {
    db.exec('ALTER TABLE invitation_codes ADD COLUMN is_reusable INTEGER NOT NULL DEFAULT 0');
  }
}

function ensureTestUnlimitedCode(db) {
  db.prepare(`
    INSERT OR IGNORE INTO invitation_codes (code, origin_route, is_used, used_at, is_reusable)
    VALUES ('TEST-UNLIMITED', 'TEST', 0, NULL, 1)
  `).run();
  db.prepare(`
    UPDATE invitation_codes
    SET origin_route = 'TEST', is_reusable = 1, is_used = 0, used_at = NULL
    WHERE code = 'TEST-UNLIMITED' COLLATE NOCASE
  `).run();
}

function migrate(db) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  migrateColumns(db);
}

function seedIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM invitation_codes').get();
  if (row && row.n > 0) return;
  const seed = fs.readFileSync(SEED_PATH, 'utf8');
  db.exec(seed);
}

function initDatabase() {
  const db = openDb();
  migrate(db);
  seedIfEmpty(db);
  ensureTestUnlimitedCode(db);
  return db;
}

module.exports = { initDatabase, DB_PATH };
