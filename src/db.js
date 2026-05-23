const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || './data/rio.db';
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode = faster writes, safer on crash
db.pragma('journal_mode = WAL');

// CREATE IF NOT EXISTS — safe to run on every restart
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT    NOT NULL,
    char_name   TEXT    NOT NULL,
    realm       TEXT    NOT NULL,
    region      TEXT    NOT NULL DEFAULT 'eu',
    rio_score   INTEGER          DEFAULT 0,
    spec        TEXT,
    class       TEXT,
    is_active   INTEGER          DEFAULT 0,
    updated_at  INTEGER          DEFAULT 0,
    UNIQUE(discord_id, char_name, realm, region)
  );
`);

console.log(`✅ Database ready at ${path.resolve(DB_PATH)}`);

module.exports = {
  // ── Write ──────────────────────────────────────────────────────────────

  upsertCharacter(discordId, charName, realm, region) {
    db.prepare(`
      INSERT INTO characters (discord_id, char_name, realm, region)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(discord_id, char_name, realm, region) DO NOTHING
    `).run(discordId, charName.toLowerCase(), realm.toLowerCase(), region.toLowerCase());
  },

  updateScore(id, score, spec, cls) {
    db.prepare(`
      UPDATE characters
      SET rio_score  = ?,
          spec       = ?,
          class      = ?,
          updated_at = ?
      WHERE id = ?
    `).run(score, spec, cls, Date.now(), id);
  },

  // Sets one character as active, deactivates all others for that user
  setActive(discordId, id) {
    db.prepare(`UPDATE characters SET is_active = 0 WHERE discord_id = ?`).run(discordId);
    db.prepare(`UPDATE characters SET is_active = 1 WHERE id = ? AND discord_id = ?`).run(id, discordId);
  },

  removeCharacter(id, discordId) {
    db.prepare(`DELETE FROM characters WHERE id = ? AND discord_id = ?`).run(id, discordId);
  },

  // ── Read ───────────────────────────────────────────────────────────────

  getCharacters(discordId) {
    return db.prepare(`SELECT * FROM characters WHERE discord_id = ? ORDER BY is_active DESC, id ASC`).all(discordId);
  },

  getActiveCharacter(discordId) {
    return db.prepare(`SELECT * FROM characters WHERE discord_id = ? AND is_active = 1`).get(discordId);
  },

  getCharacterById(id) {
    return db.prepare(`SELECT * FROM characters WHERE id = ?`).get(id);
  },

  // Returns all characters that haven't been updated in the last 20 hours
  // (gives a buffer so daily updates don't skip recently set characters)
  getStaleCharacters() {
    const cutoff = Date.now() - 20 * 60 * 60 * 1000;
    return db.prepare(`SELECT * FROM characters WHERE updated_at < ?`).all(cutoff);
  },

  getAllCharacters() {
    return db.prepare(`SELECT * FROM characters`).all();
  },
};
