const fetch = require('node-fetch');

/**
 * Fetches a character profile from the Raider.IO public API.
 * Returns { score, spec, cls, thumbnail, profileUrl } or { error: string }
 */
async function fetchRioScore(name, realm, region) {
  const url = 'https://raider.io/api/v1/characters/profile'
    + `?region=${encodeURIComponent(region)}`
    + `&realm=${encodeURIComponent(realm)}`
    + `&name=${encodeURIComponent(name)}`
    + `&fields=mythic_plus_scores_by_season:current,mythic_plus_highest_level_runs,class,active_spec_name`;

  try {
    const res = await fetch(url, { timeout: 8000 });

    if (res.status === 404) return { error: 'Charakter nicht gefunden. Prüfe Name, Realm und Region.' };
    if (!res.ok)           return { error: `Raider.IO API Fehler (${res.status}).` };

    const data = await res.json();

    const scores     = data?.mythic_plus_scores_by_season?.[0]?.scores ?? {};
    const hlRuns     = data?.mythic_plus_highest_level_runs ?? [];
    const highestKey = hlRuns.length ? Math.max(...hlRuns.map(r => r.mythic_level ?? 0)) : 0;

    return {
      name:        data.name,
      realm:       data.realm,
      score:       Math.round(scores.all    ?? 0),
      scoreTank:   Math.round(scores.tank   ?? 0),
      scoreHealer: Math.round(scores.healer ?? 0),
      scoreDps:    Math.round(scores.dps    ?? 0),
      highestKey,
      spec:        data.active_spec_name ?? 'Unbekannt',
      cls:         data.class            ?? 'Unbekannt',
      thumbnail:   data.thumbnail_url,
      profileUrl:  `https://raider.io/characters/${region}/${data.realm}/${data.name}`,
    };
  } catch (err) {
    return { error: `Verbindung zu Raider.IO fehlgeschlagen: ${err.message}` };
  }
}

module.exports = { fetchRioScore };
