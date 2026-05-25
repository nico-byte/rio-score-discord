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

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
}

module.exports = { sessionSet, sessionGet, sessionDelete, fetchChannel };
