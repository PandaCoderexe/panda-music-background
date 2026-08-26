# 🐼 Panda Music Background

Ambient, always-on music visualizer for **macOS and Windows**. It detects
whatever is currently playing on your computer, pulls the album cover, and
turns your screen into a living background in the album's colors.

## Modes

- **Bars** (`1`) — a full-width spectrum of glowing rounded bars that dance to
  the beat, colored with a slowly cycling gradient built from the album cover.
- **Disk** (`2`) — the album cover as a spinning vinyl disk, surrounded by
  radial bars that appear and vanish with the beat, in an accent color chosen
  to contrast with the rest of the artwork's palette.

Both modes float on a background of slowly shifting color blobs extracted from
the album art. Press `M` to toggle modes, or use the buttons (move the mouse
to reveal the UI).

## Now-playing detection

- **macOS** — Spotify and Apple Music via AppleScript (including artwork).
- **Windows** — the system media session (Global System Media Transport
  Controls), which covers Spotify, browsers, and most players — including the
  cover thumbnail.

## Audio reactivity (the beat)

The app tries these sources in order; click the `audio:` badge to switch:

1. **system** — real system-audio loopback (works on Windows out of the box).
2. **mic** — microphone; on macOS this is the easy way to react to speaker
   audio. (For perfect loopback on macOS, install a virtual device like
   [BlackHole](https://existential.audio/blackhole/) and pick it as the mic.)
3. **beat sim** — a built-in beat engine so the visuals always move, even with
   headphones and no permissions.

## Run it

```bash
cd panda-music-background
npm install
npm start
```

## Package installers

```bash
npm i -D electron-builder
npm run dist   # .dmg on macOS, NSIS installer on Windows
```

## Env toggles (debug)

- `PANDA_AUDIO=sim|mic` — force an audio source.
- `PANDA_SHOT=/path/out.png` — take a screenshot after ~6 s and quit.
