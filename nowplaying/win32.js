// Windows now-playing detection via Global System Media Transport Controls.
const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'nowplaying.ps1');

function getNowPlaying() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err || !stdout) return resolve({ playing: false });
        try {
          const info = JSON.parse(stdout.trim());
          if (info.source) {
            // "Spotify.exe" / "SpotifyAB.SpotifyMusic_..." -> "Spotify"
            info.source = info.source.replace(/\.exe$/i, '').split(/[._]/)[0];
          }
          resolve(info);
        } catch (e) {
          resolve({ playing: false });
        }
      }
    );
  });
}

module.exports = { getNowPlaying };
