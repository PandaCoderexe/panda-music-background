// Lyrics lookup via lrclib.net (free, no API key). Returns
// { synced: [{ t, text }], plain } or null, cached per track.
const https = require('https');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PandaMusicBackground/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    // lrclib can be slow at times; lyrics load async so a long wait is
    // fine — better late than "no lyrics"
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

// "[01:23.45] line" (possibly several timestamps per line) -> [{ t, text }]
function parseLrc(lrc) {
  const out = [];
  for (const raw of lrc.split('\n')) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!times.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of times) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  out.sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}

// "Mood Swings (feat. Lil Tjay)" -> "Mood Swings"; catalogs rarely
// include the guest suffix in the track name.
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[([][^)\]]*\b(feat|ft|with)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s*-\s*\b(feat|ft)\b.*$/i, '')
    .trim();
}

// "Central Cee & Tony Boy" -> "Central Cee"
function mainArtist(a) {
  return (a || '').split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b/i)[0].trim();
}

function toResult(rec) {
  if (!rec || rec.instrumental) return null;
  const synced = rec.syncedLyrics ? parseLrc(rec.syncedLyrics) : null;
  const plain = rec.plainLyrics || null;
  return synced || plain ? { synced, plain } : null;
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[’´`]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
}

// key -> { promise, done, empty, tries }. Empty results are retried on
// later polls (a few times) so one flaky request can't permanently mark a
// song as lyricless.
const cache = new Map();

function fetchLyrics(info) {
  const key = `${info.title}::${info.artist}::${info.album}`;
  const cached = cache.get(key);
  if (cached && (!cached.done || !cached.empty || cached.tries >= 5)) return cached.promise;
  if (cache.size > 40) cache.clear();

  const entry = { done: false, empty: false, tries: cached ? cached.tries + 1 : 1 };
  entry.promise = (async () => {
    const getUrl = (artist, title, extra = '') => 'https://lrclib.net/api/get'
      + `?artist_name=${encodeURIComponent(artist)}`
      + `&track_name=${encodeURIComponent(title)}` + extra;

    // strict lookup (album + duration) is unambiguous — trust it when it
    // has synced lyrics; everything else becomes a scored candidate
    const urls = [
      getUrl(info.artist || '', info.title || '',
        (info.album ? `&album_name=${encodeURIComponent(info.album)}` : '')
        + (info.duration ? `&duration=${Math.round(info.duration)}` : '')),
      getUrl(info.artist || '', info.title || ''),
      getUrl(mainArtist(info.artist), cleanTitle(info.title))
    ];
    const [exact, ...rest] = await Promise.all(
      [...new Set(urls)].map((u) => getJson(u).catch(() => null)));

    // Records for a different version of the song (duration off by >10s)
    // are unusable — their timings drift off the vocals.
    const durOk = (r) => r && !r.instrumental
      && (!info.duration || !r.duration || Math.abs(r.duration - info.duration) < 10);

    if (exact && exact.syncedLyrics && durOk(exact)) return toResult(exact);

    // The catalog often has many entries with slightly different timings
    // (single vs album cut, video edits). Score candidates: synced first,
    // then matching album, then closest duration.
    const candidates = [exact, ...rest];
    try {
      const rs = await getJson('https://lrclib.net/api/search'
        + `?track_name=${encodeURIComponent(cleanTitle(info.title))}`
        + `&artist_name=${encodeURIComponent(mainArtist(info.artist))}`);
      candidates.push(...(rs || []));
    } catch (e) {}

    let best = null, bestScore = 0;
    for (const r of candidates) {
      if (!durOk(r) || (!r.syncedLyrics && !r.plainLyrics)) continue;
      let s = 1;
      if (r.syncedLyrics) s += 100;
      if (info.album && norm(r.albumName) === norm(info.album)) s += 30;
      if (info.duration && r.duration) s += Math.max(0, 10 - Math.abs(r.duration - info.duration)) * 2;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    return toResult(best);
  })().then((r) => { entry.done = true; entry.empty = !r; return r; });

  cache.set(key, entry);
  return entry.promise;
}

module.exports = { fetchLyrics };
