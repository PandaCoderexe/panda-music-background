const { app, BrowserWindow, ipcMain, session, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const platformModules = {
  darwin: './nowplaying/darwin',
  win32: './nowplaying/win32'
};
const nowPlaying = require(platformModules[process.platform] || './nowplaying/none');
const { fetchLyrics } = require('./nowplaying/lyrics');

let win = null;
let pollTimer = null;
let lastTrackKey = null;
const artCache = new Map();

function fetchAsDataUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchAsDataUrl(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mime};base64,${buf.toString('base64')}`);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function pollNowPlaying() {
  let info = null;
  try {
    info = await nowPlaying.getNowPlaying();
  } catch (e) {
    info = null;
  }
  if (info && info.artUrl && !info.artDataUrl) {
    if (!artCache.has(info.artUrl)) {
      if (artCache.size > 30) artCache.clear();
      try {
        artCache.set(info.artUrl, await fetchAsDataUrl(info.artUrl));
      } catch (e) {
        artCache.set(info.artUrl, null);
      }
    }
    info.artDataUrl = artCache.get(info.artUrl);
  }
  // lets the renderer interpolate between polls (platforms that don't
  // stamp it themselves)
  if (info && !info.positionAt) info.positionAt = Date.now();
  // Send right away — never make the track/cover/colors wait on the
  // lyrics lookup; lyrics follow on their own channel when they arrive.
  if (win && !win.isDestroyed()) {
    win.webContents.send('now-playing', info || { playing: false });
  }
  if (info && info.title && info.artist) {
    const { title, artist, album } = info;
    lastTrackKey = `${title}::${artist}::${album}`;
    fetchLyrics(info)
      .catch(() => null)
      .then((lyrics) => {
        if (lastTrackKey !== `${title}::${artist}::${album}`) return; // stale
        if (win && !win.isDestroyed()) {
          win.webContents.send('lyrics', { title, artist, album, lyrics });
        }
      });
  } else {
    lastTrackKey = null;
  }
}

function createWindow() {
  // Debug helper: PANDA_SIZE=900x700 opens the window at a given size.
  const dbgSize = (process.env.PANDA_SIZE || '').match(/^(\d+)x(\d+)$/);
  win = new BrowserWindow({
    width: dbgSize ? Number(dbgSize[1]) : 1280,
    height: dbgSize ? Number(dbgSize[2]) : 800,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0a0a10',
    title: 'Panda Music Background',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // System audio loopback for getDisplayMedia (Windows, and macOS 13+ on
  // recent Electron). If capture is unavailable or the user denied the
  // Screen Recording permission, deny cleanly so the renderer falls back
  // to mic / simulated beat.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    let done = false;
    const answer = (streams) => {
      if (done) return;
      done = true;
      try { callback(streams); } catch (e) { try { callback(null); } catch (e2) {} }
    };
    // Without the Screen Recording permission, getSources fails (and can
    // block on the OS permission dialog) — deny up front / after 5s so the
    // renderer's fallback chain keeps moving.
    if (process.platform === 'darwin'
        && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      return answer(null);
    }
    setTimeout(() => answer(null), 5000);
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => answer(sources.length ? { video: sources[0], audio: 'loopback' } : null))
      .catch(() => answer(null));
  });

  pollTimer = setInterval(pollNowPlaying, 1200);
  win.webContents.once('did-finish-load', pollNowPlaying);

  // Debug helper: PANDA_SHOT=/path/out.png captures a screenshot then quits.
  if (process.env.PANDA_SHOT) {
    setTimeout(async () => {
      try {
        if (process.env.PANDA_MODE) {
          await win.webContents.executeJavaScript(
            `window.__panda && window.__panda.setMode('${process.env.PANDA_MODE}')`
          );
        }
        if (process.env.PANDA_PLAYING) {
          await win.webContents.executeJavaScript(
            'window.__panda && window.__panda.setPlaying(true)'
          );
        }
        if (process.env.PANDA_INJECT) {
          await win.webContents.executeJavaScript(
            fs.readFileSync(process.env.PANDA_INJECT, 'utf8')
          );
        }
        if (process.env.PANDA_MODE || process.env.PANDA_PLAYING || process.env.PANDA_INJECT) {
          await new Promise((r) => setTimeout(r, 2500));
        }
        const dbg = await win.webContents.executeJavaScript(
          'window.__panda ? JSON.stringify({ mode: window.__panda.getMode(), audio: window.__panda.audio.source, lyrics: window.__panda.lyricsVisible(), test: window.__pandaTest || null }) : "no-debug-hook"'
        );
        console.log('PANDA_DEBUG:', dbg);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.PANDA_SHOT, img.toPNG());
      } catch (e) {
        console.error('screenshot failed:', e);
      }
      app.quit();
      // active capture streams can keep the app alive past quit
      setTimeout(() => app.exit(0), 1500);
    }, Number(process.env.PANDA_SHOT_DELAY || 6000));
  }
}

ipcMain.handle('refresh-now-playing', () => pollNowPlaying());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  clearInterval(pollTimer);
  app.quit();
});
