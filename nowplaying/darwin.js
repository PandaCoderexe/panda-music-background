// macOS now-playing detection via AppleScript (Spotify + Apple Music).
const { execFile } = require('child_process');
const https = require('https');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

function osascript(script) {
  return run('osascript', ['-e', script]).then((out) => (out == null ? null : out.trim()));
}

async function isProcessRunning(name) {
  const out = await run('pgrep', ['-x', name]);
  return out != null && out.trim().length > 0;
}

const SEP = '|||';

// AppleScript prints floats with a comma decimal separator in some locales.
function asNum(s) {
  return parseFloat(String(s || '').replace(',', '.')) || 0;
}

async function getSpotify() {
  if (!(await isProcessRunning('Spotify'))) return null;
  const out = await osascript(`
    tell application "Spotify"
      set pandaState to (player state as text)
      if pandaState is "playing" or pandaState is "paused" then
        return pandaState & "${SEP}" & (name of current track) & "${SEP}" & (artist of current track) & "${SEP}" & (album of current track) & "${SEP}" & (artwork url of current track) & "${SEP}" & (player position as text) & "${SEP}" & ((duration of current track) as text)
      end if
      return ""
    end tell`);
  if (!out) return null;
  const [state, title, artist, album, artUrl, pos, dur] = out.split(SEP);
  return {
    source: 'Spotify',
    playing: state === 'playing',
    title, artist, album,
    artUrl: artUrl || null,
    position: asNum(pos),
    positionAt: Date.now(), // stamped now, before any artwork/lyrics work
    duration: asNum(dur) / 1000 // Spotify reports ms
  };
}

const musicArtCache = new Map();

async function getMusicArtwork(trackKey, title) {
  // Artwork can be missing right after a track starts (Music hasn't loaded
  // it yet), so keep retrying for a while instead of caching the failure.
  const cached = musicArtCache.get(trackKey);
  if (cached && (cached.dataUrl || cached.tries > 8)) return cached.dataUrl;
  // Name + artwork in one AppleScript call: when tracks are skipped fast,
  // "current track" may already be a different song than the one we're
  // caching for — verify before accepting, or the wrong cover sticks.
  const out = await osascript(`
    tell application "Music"
      set pandaTrack to current track
      return {name of pandaTrack, data of artwork 1 of pandaTrack}
    end tell`);
  let dataUrl = null;
  if (out) {
    // osascript prints the list as: TrackName, «data XXXX48656C6C6F...»
    const di = out.indexOf('«data');
    if (di > 0 && out.slice(0, di).includes(title)) {
      const m = out.slice(di).match(/«data [A-Za-z0-9 ]{4}([0-9A-Fa-f]+)»/);
      if (m) {
        const buf = Buffer.from(m[1], 'hex');
        const mime = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }
  }
  if (musicArtCache.size > 20) musicArtCache.clear();
  musicArtCache.set(trackKey, { dataUrl, tries: (cached ? cached.tries : 0) + 1 });
  return dataUrl;
}

// Fallback: look the cover up in Apple's public iTunes catalog. A result
// is only accepted when artist AND title genuinely match — showing the
// panda placeholder beats showing some other band's cover.
const itunesCache = new Map();

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[’´`]/g, "'")
    .replace(/\s*[([].*?[)\]]/g, '') // "(feat. X)", "(Single Edit)", …
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

function itunesArtUrl(title, artist, album) {
  const key = `${title}::${artist}`;
  if (itunesCache.has(key)) return itunesCache.get(key);
  const promise = new Promise((resolve) => {
    const url = 'https://itunes.apple.com/search?media=music&limit=8&term='
      + encodeURIComponent(`${artist} ${title}`);
    const req = https.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const results = JSON.parse(Buffer.concat(chunks).toString('utf8')).results || [];
          const wantTitle = normalize(title);
          const wantArtist = normalize(artist);
          const wantAlbum = normalize(album);
          const matches = results.filter((r) => {
            const rt = normalize(r.trackName), ra = normalize(r.artistName);
            const titleOk = rt === wantTitle || rt.includes(wantTitle) || wantTitle.includes(rt);
            const artistOk = ra.includes(wantArtist) || wantArtist.includes(ra)
              || wantArtist.split(' ').every((w) => ra.includes(w));
            return r.artworkUrl100 && titleOk && artistOk;
          });
          const best = matches.find((r) => wantAlbum && normalize(r.collectionName) === wantAlbum)
            || matches[0];
          resolve(best ? best.artworkUrl100.replace('100x100', '600x600') : null);
        } catch (e) { resolve(null); }
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => req.destroy());
  });
  if (itunesCache.size > 40) itunesCache.clear();
  itunesCache.set(key, promise);
  return promise;
}

async function getAppleMusic() {
  if (!(await isProcessRunning('Music'))) return null;
  const out = await osascript(`
    tell application "Music"
      set pandaState to (player state as text)
      if pandaState is "playing" or pandaState is "paused" then
        set pandaTrack to current track
        return pandaState & "${SEP}" & (name of pandaTrack) & "${SEP}" & (artist of pandaTrack) & "${SEP}" & (album of pandaTrack) & "${SEP}" & (player position as text) & "${SEP}" & ((duration of pandaTrack) as text)
      end if
      return ""
    end tell`);
  if (!out) return null;
  const [state, title, artist, album, pos, dur] = out.split(SEP);
  const info = {
    source: 'Apple Music',
    playing: state === 'playing',
    title, artist, album,
    artUrl: null,
    position: asNum(pos),
    positionAt: Date.now(), // stamped now, before any artwork/lyrics work
    duration: asNum(dur)
  };
  info.artDataUrl = await getMusicArtwork(`${title}::${artist}::${album}`, title);
  if (!info.artDataUrl) {
    // no artwork from the Music app -> iTunes catalog lookup; main.js
    // downloads artUrl and turns it into a data URL
    info.artUrl = await itunesArtUrl(title, artist, album);
  }
  return info;
}

async function getNowPlaying() {
  const [spotify, music] = await Promise.all([getSpotify(), getAppleMusic()]);
  // Prefer whichever is actively playing; fall back to a paused one.
  return (
    [spotify, music].find((i) => i && i.playing) ||
    spotify || music ||
    { playing: false }
  );
}

module.exports = { getNowPlaying, itunesArtUrl };
