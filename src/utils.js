const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function sessionSet(map, userId, data) {
  map.set(userId, { ...data, expiresAt: Date.now() + SESSION_TTL_MS });
}

function sessionGet(map, userId) {
  const session = map.get(userId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    map.delete(userId);
    return null;
  }
  return session;
}

function sessionDelete(map, userId) {
  map.delete(userId);
}

// ── Raider.IO API rate limit: shared across addmain + addalt ─────────────────
const _rioTimestamps = new Map();

// Returns seconds remaining if on cooldown, 0 if the call is allowed (and records the timestamp).
function checkRioRateLimit(userId, cooldownMs = 30_000) {
  const last = _rioTimestamps.get(userId);
  const now  = Date.now();
  if (last && now - last < cooldownMs) {
    return Math.ceil((cooldownMs - (now - last)) / 1000);
  }
  _rioTimestamps.set(userId, now);
  return 0;
}

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
}

module.exports = { sessionSet, sessionGet, sessionDelete, fetchChannel, checkRioRateLimit };
