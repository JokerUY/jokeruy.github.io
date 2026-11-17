// Genera data/speedrun.json con datos reales de la API publica de speedrun.com.
// Uso: node scripts/update-speedrun.js
// Si algun dato no llega de la API, queda en null o fuera del JSON: nunca se inventa.
const fs = require('fs');
const path = require('path');

const USER = 'JokerUY';
const API = 'https://www.speedrun.com/api/v1';
const HEADERS = { 'User-Agent': 'jokeruy-site/1.0 (static personal page)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    if (res.status === 420 || res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    throw new Error(url + ' -> HTTP ' + res.status);
  }
  throw new Error(url + ' -> sin respuesta tras ' + tries + ' intentos');
}

// Trae todas las paginas de un listado (max 200 por pagina).
async function getAll(url) {
  const out = [];
  let next = url + (url.includes('?') ? '&' : '?') + 'max=200';
  while (next) {
    const j = await get(next);
    out.push(...j.data);
    const n = j.pagination && j.pagination.links && j.pagination.links.find((l) => l.rel === 'next');
    next = n ? n.uri : null;
    if (next) await sleep(300);
  }
  return out;
}

(async () => {
  const user = (await get(`${API}/users/${USER}`)).data;
  const pbs = await getAll(`${API}/users/${USER}/personal-bests?embed=game,category`);
  const runs = await getAll(`${API}/runs?user=${user.id}&status=verified&embed=game`);

  // Subcategorias (variables) de cada categoria, para distinguir tablas como "New Game" Professional / Standard
  const varsCache = {};
  async function subcategoryLabel(categoryId, values) {
    if (!varsCache[categoryId]) {
      varsCache[categoryId] = (await get(`${API}/categories/${categoryId}/variables`)).data;
      await sleep(250);
    }
    const parts = [];
    for (const v of varsCache[categoryId]) {
      if (!v['is-subcategory']) continue;
      const id = values && values[v.id];
      const label = id && v.values && v.values.values && v.values.values[id] ? v.values.values[id].label : null;
      if (label) parts.push(label);
    }
    return parts.length ? parts.join(' · ') : null;
  }

  // Mejores tiempos personales
  const personalBests = pbs
    .filter((p) => p.run && p.run.times && p.game && p.game.data && p.category && p.category.data)
    .map((p) => {
      const r = p.run;
      const t = r.times;
      const seconds = t.primary_t != null ? t.primary_t : null;
      return {
        game: p.game.data.names.international,
        gameAbbreviation: p.game.data.abbreviation,
        category: p.category.data.name,
        categoryType: p.category.data.type,
        timeSeconds: seconds,
        place: p.place != null ? p.place : null,
        date: r.date || null,
        link: r.weblink || null,
        worldRecord: p.place === 1,
        _categoryId: p.category.data.id,
        _values: r.values,
      };
    })
  ;
  for (const p of personalBests) {
    p.subcategory = await subcategoryLabel(p._categoryId, p._values);
    delete p._categoryId; delete p._values;
  }
  personalBests.sort((a, b) => (b.worldRecord - a.worldRecord) || ((a.place || 9999) - (b.place || 9999)) || a.game.localeCompare(b.game) || a.category.localeCompare(b.category));

  // Runs verificadas por juego
  const byGame = {};
  for (const r of runs) {
    const g = r.game && r.game.data ? r.game.data.names.international : r.game;
    byGame[g] = (byGame[g] || 0) + 1;
  }
  const topGame = Object.entries(byGame).sort((a, b) => b[1] - a[1])[0] || null;

  const games = new Set(personalBests.map((p) => p.game));
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'https://www.speedrun.com/users/' + USER,
    user: {
      name: user.names.international,
      signup: user.signup || null,
      signupYear: user.signup ? Number(user.signup.slice(0, 4)) : null,
      country: user.location && user.location.country ? user.location.country.names.international : null,
    },
    stats: {
      gamesWithPersonalBest: games.size,
      worldRecords: personalBests.filter((p) => p.worldRecord).length,
      verifiedRuns: runs.length,
      mostRunsGame: topGame ? { game: topGame[0], runs: topGame[1] } : null,
    },
    personalBests,
  };

  const file = path.join(__dirname, '..', 'data', 'speedrun.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('OK:', personalBests.length, 'PBs,', out.stats.worldRecords, 'WR,', runs.length, 'runs verificadas ->', file);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
