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
    + `&fields=mythic_plus_scores_by_season:current,class,active_spec_name`;

  try {
    const res = await fetch(url, { timeout: 8000 });

    if (res.status === 404) return { error: 'Charakter nicht gefunden. Prüfe Name, Realm und Region.' };
    if (!res.ok)           return { error: `Raider.IO API Fehler (${res.status}).` };

    const data = await res.json();

    return {
      name:       data.name,
      score:      Math.round(data?.mythic_plus_scores_by_season?.[0]?.scores?.all ?? 0),
      spec:       data.active_spec_name ?? 'Unbekannt',
      cls:        data.class            ?? 'Unbekannt',
      thumbnail:  data.thumbnail_url,
      profileUrl: `https://raider.io/characters/${region}/${realm}/${name}`,
    };
  } catch (err) {
    return { error: `Verbindung zu Raider.IO fehlgeschlagen: ${err.message}` };
  }
}

module.exports = { fetchRioScore };
