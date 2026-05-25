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
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lfg_groups (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id        TEXT    NOT NULL,
      guild_id          TEXT    NOT NULL,
      dungeon           TEXT    NOT NULL,
      key_level         TEXT    NOT NULL,
      char_id           INTEGER NOT NULL,
      roles_wanted      TEXT    NOT NULL,
      score_req         TEXT    NOT NULL,
      mgmt_channel_id   TEXT,
      mgmt_info_msg_id  TEXT,
      voice_channel_id  TEXT,
      spots_total       INTEGER NOT NULL DEFAULT 5,
      status            TEXT    NOT NULL DEFAULT 'open',
      created_at        INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Migrations: add columns to existing tables (characters and lfg_groups exist above)
  await db.execute(`ALTER TABLE lfg_groups ADD COLUMN voice_channel_id TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE characters ADD COLUMN score_tank INTEGER DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE characters ADD COLUMN score_healer INTEGER DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE characters ADD COLUMN score_dps INTEGER DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE characters ADD COLUMN highest_key INTEGER DEFAULT 0`).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lfg_applications (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      lfg_id            INTEGER NOT NULL,
      applicant_id      TEXT    NOT NULL,
      char_ids          TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'pending',
      mgmt_message_id   TEXT,
      invite_message_id TEXT,
      invite_channel_id TEXT,
      roles_offered     TEXT,
      approved_role     TEXT,
      char_roles        TEXT,
      created_at        INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Migrations for lfg_applications (no-ops on fresh DBs which already have these columns)
  await db.execute(`ALTER TABLE lfg_applications ADD COLUMN invite_channel_id TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE lfg_applications ADD COLUMN roles_offered TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE lfg_applications ADD COLUMN approved_role TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE lfg_applications ADD COLUMN char_roles TEXT`).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lfg_announcements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      lfg_id     INTEGER NOT NULL,
      channel_id TEXT    NOT NULL,
      message_id TEXT    NOT NULL
    )
  `);
  console.log(`✅ Database ready at ${path.resolve(DB_PATH)}`);
}

async function upsertCharacter(discordId, charName, realm, region) {
  const realmLow  = realm.toLowerCase();
  const regionLow = region.toLowerCase();
  const existing  = await db.execute({
    sql:  `SELECT id FROM characters WHERE discord_id=? AND LOWER(char_name)=? AND LOWER(realm)=? AND region=?`,
    args: [discordId, charName.toLowerCase(), realmLow, regionLow],
  });
  if (existing.rows.length > 0) {
    await db.execute({
      sql:  `UPDATE characters SET char_name=?, realm=? WHERE id=?`,
      args: [charName, realm, existing.rows[0].id],
    });
  } else {
    await db.execute({
      sql:  `INSERT INTO characters (discord_id, char_name, realm, region) VALUES (?, ?, ?, ?)`,
      args: [discordId, charName, realm, regionLow],
    });
  }
}

async function updateScore(id, score, spec, cls, scoreTank = 0, scoreHealer = 0, scoreDps = 0, highestKey = 0) {
  await db.execute({
    sql: `UPDATE characters SET rio_score=?, spec=?, class=?, score_tank=?, score_healer=?, score_dps=?, highest_key=?, updated_at=? WHERE id=?`,
    args: [score, spec, cls, scoreTank, scoreHealer, scoreDps, highestKey, Date.now(), id],
  });
}

async function setActive(discordId, id) {
  // await db.execute({ sql: `UPDATE characters SET is_active=0 WHERE discord_id=?`, args: [discordId] });
  await db.execute({ sql: `UPDATE characters SET is_active=1 WHERE id=? AND discord_id=?`, args: [id, discordId] });
}

async function setInactive(discordId, id) {
  await db.execute({
    sql:  `UPDATE characters SET is_active=0 WHERE id=? AND discord_id=?`,
    args: [id, discordId],
  });
}

// Used by /rio to enforce single-active when explicitly setting a new main
async function setOnlyActive(discordId, id) {
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

// Returns all active characters for a user (can be multiple)
async function getActiveCharacters(discordId) {
  const res = await db.execute({
    sql:  `SELECT * FROM characters WHERE discord_id=? AND is_active=1`,
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

async function getStaleOpenLfgGroups(olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  const res = await db.execute({
    sql:  `SELECT * FROM lfg_groups WHERE status='open' AND created_at < ?`,
    args: [cutoff],
  });
  return res.rows.map(r => ({ ...r, roles_wanted: JSON.parse(r.roles_wanted) }));
}

async function getStaleCharacters() {
  const cutoff = Date.now() - 20 * 60 * 60 * 1000;
  const res = await db.execute({
    sql:  `SELECT * FROM characters WHERE updated_at < ?`,
    args: [cutoff],
  });
  return res.rows;
}

// ── LFG groups ────────────────────────────────────────────────────────────────

async function createLfgGroup({ creatorId, guildId, dungeon, keyLevel, charId, rolesWanted, scoreReq }) {
  const res = await db.execute({
    sql:  `INSERT INTO lfg_groups (creator_id, guild_id, dungeon, key_level, char_id, roles_wanted, score_req, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [creatorId, guildId, dungeon, keyLevel, charId, JSON.stringify(rolesWanted), scoreReq, Date.now()],
  });
  return Number(res.lastInsertRowid);
}

async function setLfgMgmtChannel(lfgId, channelId, msgId) {
  await db.execute({
    sql:  `UPDATE lfg_groups SET mgmt_channel_id=?, mgmt_info_msg_id=? WHERE id=?`,
    args: [channelId, msgId, lfgId],
  });
}

async function setLfgVoiceChannel(lfgId, channelId) {
  await db.execute({
    sql:  `UPDATE lfg_groups SET voice_channel_id=? WHERE id=?`,
    args: [channelId, lfgId],
  });
}

async function getLfgGroupByVoiceChannel(channelId) {
  const res = await db.execute({
    sql:  `SELECT * FROM lfg_groups WHERE voice_channel_id=? AND status IN ('open','closed')`,
    args: [channelId],
  });
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, roles_wanted: JSON.parse(row.roles_wanted) };
}

async function getLfgGroup(lfgId) {
  const res = await db.execute({ sql: `SELECT * FROM lfg_groups WHERE id=?`, args: [lfgId] });
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, roles_wanted: JSON.parse(row.roles_wanted) };
}

async function getOpenLfgByCreator(creatorId) {
  const res = await db.execute({
    sql:  `SELECT id FROM lfg_groups WHERE creator_id=? AND status='open' LIMIT 1`,
    args: [creatorId],
  });
  return res.rows[0] ?? null;
}

async function closeLfgGroup(lfgId) {
  await db.execute({ sql: `UPDATE lfg_groups SET status='closed' WHERE id=?`, args: [lfgId] });
}

// Returns how many spots are still free (spots_total minus accepted applications)
async function getLfgSpotsLeft(lfgId) {
  const group = await getLfgGroup(lfgId);
  if (!group) return 0;
  const res = await db.execute({
    sql:  `SELECT COUNT(*) as cnt FROM lfg_applications WHERE lfg_id=? AND status='accepted'`,
    args: [lfgId],
  });
  // keyholder counts as 1
  const accepted = Number(res.rows[0].cnt);
  return group.spots_total - 1 - accepted;
}

// ── LFG announcements ─────────────────────────────────────────────────────────

async function addLfgAnnouncement(lfgId, channelId, messageId) {
  await db.execute({
    sql:  `INSERT INTO lfg_announcements (lfg_id, channel_id, message_id) VALUES (?, ?, ?)`,
    args: [lfgId, channelId, messageId],
  });
}

async function getLfgAnnouncements(lfgId) {
  const res = await db.execute({ sql: `SELECT * FROM lfg_announcements WHERE lfg_id=?`, args: [lfgId] });
  return res.rows;
}

async function deleteLfgAnnouncements(lfgId) {
  await db.execute({ sql: `DELETE FROM lfg_announcements WHERE lfg_id=?`, args: [lfgId] });
}

async function deleteLfgAnnouncement(id) {
  await db.execute({ sql: `DELETE FROM lfg_announcements WHERE id=?`, args: [id] });
}

// Returns announcements whose parent LFG group was created more than olderThanMs ago
async function getExpiredAnnouncements(olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  const res = await db.execute({
    sql:  `SELECT a.*, g.guild_id FROM lfg_announcements a
           JOIN lfg_groups g ON g.id = a.lfg_id
           WHERE g.created_at < ?`,
    args: [cutoff],
  });
  return res.rows;
}

// ── LFG applications ──────────────────────────────────────────────────────────

// charRoles: [{ charId, role }]
async function createApplication({ lfgId, applicantId, charRoles }) {
  const charIds = charRoles.map(p => p.charId);
  const res = await db.execute({
    sql:  `INSERT INTO lfg_applications (lfg_id, applicant_id, char_ids, roles_offered, char_roles, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [lfgId, applicantId, JSON.stringify(charIds), JSON.stringify([]), JSON.stringify(charRoles), Date.now()],
  });
  return Number(res.lastInsertRowid);
}

async function setApplicationApprovedRole(appId, role) {
  await db.execute({ sql: `UPDATE lfg_applications SET approved_role=? WHERE id=?`, args: [role, appId] });
}

async function setApplicationMgmtMsg(appId, msgId) {
  await db.execute({ sql: `UPDATE lfg_applications SET mgmt_message_id=? WHERE id=?`, args: [msgId, appId] });
}

async function setApplicationInviteMsg(appId, msgId) {
  await db.execute({ sql: `UPDATE lfg_applications SET invite_message_id=? WHERE id=?`, args: [msgId, appId] });
}

async function setApplicationInviteChannel(appId, channelId) {
  await db.execute({ sql: `UPDATE lfg_applications SET invite_channel_id=? WHERE id=?`, args: [channelId, appId] });
}

// Returns other pending/approved applications for a user (used to clean up invite channels before cancelling)
async function getOtherPendingApplications(applicantId, exceptAppId) {
  const res = await db.execute({
    sql:  `SELECT * FROM lfg_applications WHERE applicant_id=? AND id != ? AND status IN ('pending','approved')`,
    args: [applicantId, exceptAppId],
  });
  return res.rows.map(r => ({
    ...r,
    char_ids:      JSON.parse(r.char_ids),
    roles_offered: r.roles_offered ? JSON.parse(r.roles_offered) : [],
    char_roles:    r.char_roles    ? JSON.parse(r.char_roles)    : null,
  }));
}

async function getApplication(appId) {
  const res = await db.execute({ sql: `SELECT * FROM lfg_applications WHERE id=?`, args: [appId] });
  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row,
    char_ids:      JSON.parse(row.char_ids),
    roles_offered: row.roles_offered ? JSON.parse(row.roles_offered) : [],
    char_roles:    row.char_roles    ? JSON.parse(row.char_roles)    : null,
  };
}

async function setApplicationStatus(appId, status) {
  await db.execute({ sql: `UPDATE lfg_applications SET status=? WHERE id=?`, args: [status, appId] });
}

// Cancel all pending/approved applications for a user (except the given appId)
async function cancelOtherApplications(applicantId, exceptAppId) {
  await db.execute({
    sql:  `UPDATE lfg_applications SET status='cancelled'
           WHERE applicant_id=? AND id != ? AND status IN ('pending','approved')`,
    args: [applicantId, exceptAppId],
  });
}

// Returns all non-cancelled applications for an LFG group
async function getLfgApplications(lfgId) {
  const res = await db.execute({
    sql:  `SELECT * FROM lfg_applications WHERE lfg_id=? AND status != 'cancelled'`,
    args: [lfgId],
  });
  return res.rows.map(r => ({
    ...r,
    char_ids:      JSON.parse(r.char_ids),
    roles_offered: r.roles_offered ? JSON.parse(r.roles_offered) : [],
    char_roles:    r.char_roles    ? JSON.parse(r.char_roles)    : null,
  }));
}

// Check if a user already has a pending/approved application for a group
async function getExistingApplication(lfgId, applicantId) {
  const res = await db.execute({
    sql:  `SELECT * FROM lfg_applications WHERE lfg_id=? AND applicant_id=? AND status IN ('pending','approved')`,
    args: [lfgId, applicantId],
  });
  return res.rows[0] ?? null;
}

// Atomically claim a pending application — returns true only if this caller won the race
async function claimApplicationPending(appId) {
  const res = await db.execute({
    sql:  `UPDATE lfg_applications SET status='approved' WHERE id=? AND status='pending'`,
    args: [appId],
  });
  return Number(res.rowsAffected) > 0;
}

async function hasRejectedApplication(lfgId, applicantId) {
  const res = await db.execute({
    sql:  `SELECT id FROM lfg_applications WHERE lfg_id=? AND applicant_id=? AND status='rejected' LIMIT 1`,
    args: [lfgId, applicantId],
  });
  return res.rows.length > 0;
}

async function countPendingApplications(applicantId) {
  const res = await db.execute({
    sql:  `SELECT COUNT(*) as cnt FROM lfg_applications WHERE applicant_id=? AND status IN ('pending','approved')`,
    args: [applicantId],
  });
  return Number(res.rows[0].cnt);
}

module.exports = {
  init,
  upsertCharacter, updateScore, setActive, setInactive, setOnlyActive, removeCharacter,
  getCharacters, getActiveCharacters, getActiveCharacter, getCharacterById, getStaleCharacters, getStaleOpenLfgGroups,
  // LFG
  createLfgGroup, setLfgMgmtChannel, setLfgVoiceChannel, getLfgGroup, getLfgGroupByVoiceChannel, getOpenLfgByCreator, closeLfgGroup, getLfgSpotsLeft,
  addLfgAnnouncement, getLfgAnnouncements, deleteLfgAnnouncements, deleteLfgAnnouncement, getExpiredAnnouncements,
  createApplication, setApplicationMgmtMsg, setApplicationInviteMsg, setApplicationInviteChannel,
  setApplicationApprovedRole,
  getApplication, setApplicationStatus, cancelOtherApplications, getOtherPendingApplications,
  getLfgApplications, getExistingApplication, hasRejectedApplication, countPendingApplications, claimApplicationPending,
};