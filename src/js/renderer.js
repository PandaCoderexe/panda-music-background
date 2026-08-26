// App orchestration: audio, now-playing, theme transitions, mode switching.
(function () {
  const PC = window.PandaColors;

  // Theme holds current + target colors and eases between them so a track
  // change morphs the whole scene instead of snapping.
  class Theme {
    constructor() {
      this.current = PC.defaultTheme();
      this.target = PC.defaultTheme();
    }
    setTarget(theme) { this.target = theme; }
    tick() {
      const k = 0.055;
      const ease = (a, b) => PC.lerpRgb(a, b, k);
      const c = this.current, tg = this.target;
      c.dominant = ease(c.dominant, tg.dominant);
      c.accent = ease(c.accent, tg.accent);
      c.bars = c.bars.map((col, i) => ease(col, tg.bars[i % tg.bars.length]));
      c.bg = c.bg.map((col, i) => ease(col, tg.bg[i % tg.bg.length]));
    }
  }

  const bgCanvas = document.getElementById('bg');
  const vizCanvas = document.getElementById('viz');
  const theme = new Theme();
  const background = new window.PandaBackground(bgCanvas, theme);
  const barsViz = new window.PandaBarsViz(vizCanvas, theme);
  const diskViz = new window.PandaDiskViz(vizCanvas, theme);
  const audio = window.PandaAudio;

  let mode = 'bars';
  let trackKey = null;

  const el = {
    ui: document.getElementById('ui'),
    title: document.getElementById('track-title'),
    meta: document.getElementById('track-meta'),
    modeBars: document.getElementById('mode-bars'),
    modeDisk: document.getElementById('mode-disk'),
    sourceBadge: document.getElementById('source-badge'),
    lyricsBtn: document.getElementById('lyrics-btn'),
    lyrics: document.getElementById('lyrics'),
    lyricsStack: document.getElementById('lyrics-stack')
  };

  function resize() {
    background.resize();
    barsViz.resize();
    diskViz.resize();
  }
  window.addEventListener('resize', resize);
  resize();

  // Placeholder art until a real track shows up.
  diskViz.setArt(PC.pandaPlaceholder(PC.defaultTheme()));

  function setMode(m) {
    mode = m;
    el.modeBars.classList.toggle('active', m === 'bars');
    el.modeDisk.classList.toggle('active', m === 'disk');
    updateLyricsUI();
  }
  el.modeBars.addEventListener('click', () => setMode('bars'));
  el.modeDisk.addEventListener('click', () => setMode('disk'));

  const sourceLabels = { system: 'audio: system 🔊', mic: 'audio: mic 🎤', sim: 'audio: beat sim 🐼' };
  function updateSourceBadge() {
    el.sourceBadge.textContent = sourceLabels[audio.source] || 'audio: …';
  }
  el.sourceBadge.addEventListener('click', async () => {
    el.sourceBadge.textContent = 'audio: switching…';
    await audio.cycleSource();
    updateSourceBadge();
  });

  // ---- lyrics -------------------------------------------------------------
  // Synced karaoke view fed by lrclib lyrics + the player position that
  // arrives with each now-playing poll; the clock is interpolated between
  // polls. If a track has no lyrics the overlay simply stays hidden.
  let lyricsOn = localStorage.getItem('pandaLyrics') === 'on';
  let lyricLines = null;   // [{ t, text }] or null
  let lyricIdx = -2;       // -1 = before first line
  let lyricsTrackKey = null;
  let lyricsAppliedKey = null; // track whose async lyrics payload is already applied
  let lyricsPending = false;   // lookup in flight -> don't claim "no lyrics" yet
  let lyricsOffset = 0;        // manual sync nudge ([ / ] keys), saved per track
  const clock = { pos: 0, at: 0, playing: false, duration: 0 };

  const OFFSETS_KEY = 'pandaLyricsOffsets';
  function loadLyricsOffset(key) {
    try { return JSON.parse(localStorage.getItem(OFFSETS_KEY) || '{}')[key] || 0; }
    catch (e) { return 0; }
  }
  function saveLyricsOffset(key, v) {
    try {
      const m = JSON.parse(localStorage.getItem(OFFSETS_KEY) || '{}');
      if (v) m[key] = v; else delete m[key];
      const keys = Object.keys(m);
      if (keys.length > 100) delete m[keys[0]];
      localStorage.setItem(OFFSETS_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  function nudgeLyrics(delta) {
    if (!lyricLines) return;
    lyricsOffset = Math.round((lyricsOffset + delta) * 100) / 100;
    saveLyricsOffset(lyricsTrackKey, lyricsOffset);
    lyricIdx = -2; // re-render at the new offset
    updateLyricsUI();
  }

  function buildLines(lyr, duration) {
    if (!lyr) return null;
    if (lyr.synced && lyr.synced.length) return lyr.synced;
    if (lyr.plain && duration) {
      // no timestamps -> spread the lines evenly across the track
      const rows = lyr.plain.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!rows.length) return null;
      const start = duration * 0.05, span = duration * 0.88;
      return rows.map((text, i) => ({ t: start + (span * i) / rows.length, text }));
    }
    return null;
  }

  function lyricsVisible() {
    return lyricsOn && !!lyricLines;
  }

  function updateLyricsUI() {
    el.lyricsBtn.classList.toggle('active', lyricsOn);
    const noText = lyricsOn && trackKey !== null && !lyricLines && !lyricsPending;
    el.lyricsBtn.classList.toggle('unavailable', noText);
    el.lyricsBtn.textContent = noText ? '♪ no lyrics'
      : lyricsOffset ? `♪ Lyrics ${lyricsOffset > 0 ? '+' : ''}${lyricsOffset}s`
      : '♪ Lyrics';
    const vis = lyricsVisible();
    el.lyrics.classList.toggle('visible', vis);
    el.lyrics.classList.toggle('side', vis && mode === 'disk');
    diskViz.shiftTarget = vis && mode === 'disk' ? -0.22 : 0;
    // layout width may have changed (side vs centered) -> lines re-wrap
    if (vis && lyricIdx !== -2 && lineEls.length) layoutLyrics(lyricIdx);
  }

  function setLyricsOn(v) {
    lyricsOn = v;
    localStorage.setItem('pandaLyrics', v ? 'on' : 'off');
    lyricIdx = -2; // force re-render
    updateLyricsUI();
  }
  el.lyricsBtn.addEventListener('click', () => setLyricsOn(!lyricsOn));

  function currentPos() {
    return clock.pos + (clock.playing ? (performance.now() - clock.at) / 1000 : 0);
  }

  // The full lyric list lives in #lyrics-stack; verse changes scroll the
  // stack (translateY) so the active line always sits exactly at the
  // vertical center, no matter how many rows any verse wraps to.
  let lineEls = [];

  function clearLyricsDom() {
    lineEls = [];
    el.lyricsStack.textContent = '';
    el.lyricsStack.style.transform = '';
    lyricIdx = -2;
  }

  function buildStack() {
    el.lyricsStack.textContent = '';
    lineEls = lyricLines.map((line) => {
      const div = document.createElement('div');
      div.className = 'lyric-line hide';
      div.textContent = line.text || '♪';
      el.lyricsStack.appendChild(div);
      return div;
    });
  }

  function layoutLyrics(idx) {
    if (!lineEls.length) buildStack();
    for (let i = 0; i < lineEls.length; i++) {
      const d = Math.abs(i - idx);
      lineEls[i].className =
        'lyric-line' + (i === idx ? ' active' : d === 1 ? '' : d === 2 ? ' far' : ' hide');
    }
    // anchor: center of the active line (or just above the first line
    // while waiting for the song's first verse)
    const anchor = idx >= 0 && lineEls[idx]
      ? lineEls[idx].offsetTop + lineEls[idx].offsetHeight / 2
      : lineEls[0] ? lineEls[0].offsetTop - 44 : 0;
    el.lyricsStack.style.transform = `translateY(${-anchor}px)`;
  }

  // re-anchor when the window resizes (line wrapping changes heights)
  window.addEventListener('resize', () => {
    if (lyricIdx !== -2 && lineEls.length) layoutLyrics(lyricIdx);
  });

  function renderLyrics() {
    if (!lyricsVisible()) return;
    // slight lead: LRC stamps + AppleScript latency both run late, so a
    // line should light up a touch before its nominal time
    const pos = currentPos() + 0.15 + lyricsOffset;
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= pos) idx = i; else break;
    }
    if (idx === lyricIdx) return;
    lyricIdx = idx;
    layoutLyrics(idx);
  }
  // -------------------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') setMode('bars');
    else if (e.key === '2') setMode('disk');
    else if (e.key.toLowerCase() === 'm') setMode(mode === 'bars' ? 'disk' : 'bars');
    else if (e.key.toLowerCase() === 'l') setLyricsOn(!lyricsOn);
    else if (e.key === '[') nudgeLyrics(-0.25); // lyrics run ahead -> delay them
    else if (e.key === ']') nudgeLyrics(0.25);  // lyrics run late -> advance them
  });

  // Auto-hide UI when the mouse is idle.
  let hideTimer = null;
  function wakeUI() {
    el.ui.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.ui.classList.add('hidden'), 3500);
  }
  window.addEventListener('mousemove', wakeUI);
  wakeUI();

  function applyArtwork(img) {
    theme.setTarget(PC.extractTheme(img));
    diskViz.setArt(img);
  }

  let forcePlaying = false;  // debug: keeps the sim in "playing" state
  let injectedTrack = false; // debug: injected track wins over real polls

  function handleNowPlaying(info) {
    audio.playing = forcePlaying || !!(info && info.playing);
    if (!info || (!info.title && !info.playing)) {
      if (trackKey !== null) {
        trackKey = null;
        el.title.textContent = 'Nothing playing';
        el.meta.textContent = 'Play something on Spotify, Apple Music…';
        theme.setTarget(PC.defaultTheme());
        diskViz.setArt(PC.pandaPlaceholder(PC.defaultTheme()));
        lyricLines = null;
        lyricsTrackKey = null;
        clearLyricsDom();
        updateLyricsUI();
      }
      return;
    }

    // playback clock for lyric sync (interpolated between polls)
    clock.pos = info.position || 0;
    clock.at = performance.now() - (info.positionAt ? Date.now() - info.positionAt : 0);
    clock.playing = !!info.playing;
    clock.duration = info.duration || 0;

    // (re)build lyric lines only when the track actually changes, so the
    // per-poll refresh doesn't reset the line animations
    const lKey = `${info.title}::${info.artist}::${info.album}`;
    if (lKey !== lyricsTrackKey || (!lyricLines && info.lyrics)) {
      lyricsTrackKey = lKey;
      lyricsAppliedKey = null;
      lyricsPending = !info.lyrics;
      lyricsOffset = loadLyricsOffset(lKey);
      lyricLines = buildLines(info.lyrics, info.duration);
      clearLyricsDom();
      updateLyricsUI();
    }

    el.title.textContent = info.title || 'Unknown track';
    el.meta.textContent = [info.artist, info.album].filter(Boolean).join(' — ')
      + (info.source ? `  ·  ${info.source}` : '')
      + (info.playing ? '' : '  ·  paused');

    const key = `${info.title}::${info.artist}::${info.album}::${info.artDataUrl ? 1 : 0}`;
    if (key === trackKey) return;
    trackKey = key;

    if (info.artDataUrl) {
      const img = new Image();
      img.onload = () => applyArtwork(img);
      img.onerror = () => applyArtwork(PC.pandaPlaceholder(PC.defaultTheme()));
      img.src = info.artDataUrl;
    } else {
      applyArtwork(PC.pandaPlaceholder(PC.defaultTheme()));
    }
  }

  window.panda.onNowPlaying((info) => { if (!injectedTrack) handleNowPlaying(info); });

  // Lyrics arrive async so track/cover/colors never wait on the lookup.
  window.panda.onLyrics((p) => {
    if (injectedTrack) return;
    const key = `${p.title}::${p.artist}::${p.album}`;
    if (key !== lyricsTrackKey || key === lyricsAppliedKey) return;
    lyricsPending = false;
    const built = buildLines(p.lyrics, clock.duration);
    if (!built) { updateLyricsUI(); return; } // nothing found -> "no lyrics"
    lyricsAppliedKey = key;
    lyricLines = built;
    clearLyricsDom();
    updateLyricsUI();
  });

  window.panda.refreshNowPlaying();

  audio.init(window.panda.forcedAudioSource).then(updateSourceBadge);

  // debug hook (used by PANDA_SHOT captures)
  window.__panda = {
    getMode: () => mode,
    setMode,
    audio,
    setPlaying(v) { forcePlaying = v; audio.playing = v; },
    injectTrack(info) { injectedTrack = true; handleNowPlaying(info); },
    setLyricsOn,
    lyricsVisible
  };

  const N = 72;
  function loop(ms) {
    const t = ms / 1000;
    const frame = audio.getFrame(N, t);
    theme.tick();
    background.draw(t, frame);
    (mode === 'bars' ? barsViz : diskViz).draw(t, frame);
    renderLyrics();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
