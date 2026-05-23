const { createClient } = require('@libsql/client');
const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DB_PATH || './data/rio.db';
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = createClient({ url: `file:${DB_PATH}` });

async function init() {
  await db.execute(`
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
    )
  `);
  console.log(`✅ Database ready at ${path.resolve(DB_PATH)}`);
}

async function upsertCharacter(discordId, charName, realm, region) {
  await db.execute({
    sql: `INSERT INTO characters (discord_id, char_name, realm, region)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(discord_id, char_name, realm, region) DO NOTHING`,
    args: [discordId, charName.toLowerCase(), realm.toLowerCase(), region.toLowerCase()],
  });
}

async function updateScore(id, score, spec, cls) {
  await db.execute({
    sql: `UPDATE characters SET rio_score=?, spec=?, class=?, updated_at=? WHERE id=?`,
    args: [score, spec, cls, Date.now(), id],
  });
}

async function setActive(discordId, id) {
  await db.execute({ sql: `UPDATE characters SET is_active=0 WHERE discord_id=?`, args: [discordId] });
  await db.execute({ sql: `UPDATE characters SET is_active=1 WHERE id=? AND discord_id=?`, args: [id, discordId] });
}

async function removeCharacter(id, discordId) {
  await db.execute({ sql: `DELETE FROM characters WHERE id=? AND discord_id=?`, args: [id, discordId] });
}

async function getCharacters(discordId) {
  const res = await db.execute({
    sql:  `SELECT * FROM characters WHERE discord_id=? ORDER BY is_active DESC, id ASC`,
    args: [discordId],
  });
  return res.rows;
}

async function getActiveCharacter(discordId) {
  const res = await db.execute({
    sql:  `SELECT * FROM characters WHERE discord_id=? AND is_active=1`,
    args: [discordId],
  });
  return res.rows[0] ?? null;
}

async function getCharacterById(id) {
  const res = await db.execute({ sql: `SELECT * FROM characters WHERE id=?`, args: [id] });
  return res.rows[0] ?? null;
}

async function getStaleCharacters() {
  const cutoff = Date.now() - 20 * 60 * 60 * 1000;
  const res = await db.execute({
    sql:  `SELECT * FROM characters WHERE updated_at < ?`,
    args: [cutoff],
  });
  return res.rows;
}

module.exports = {
  init,
  upsertCharacter, updateScore, setActive, removeCharacter,
  getCharacters, getActiveCharacter, getCharacterById, getStaleCharacters,
};