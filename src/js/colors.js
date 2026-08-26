// Palette extraction from album art + color helpers.
// Exposes window.PandaColors.
(function () {
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s, l];
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }

  function adjust(rgb, { s: satMin = null, sMax = null, lMin = null, lMax = null, lMul = null } = {}) {
    let [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    if (satMin != null && s > 0.08) s = Math.max(s, satMin);
    if (sMax != null) s = Math.min(s, sMax);
    if (lMul != null) l *= lMul;
    if (lMin != null) l = Math.max(l, lMin);
    if (lMax != null) l = Math.min(l, lMax);
    return hslToRgb(h, s, l);
  }

  function hueDist(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function rgbDist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function lerpRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function css(rgb, a = 1) {
    return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
  }

  // Extracts a theme from an image: background blob colors, bar gradient
  // colors, and an accent that contrasts with everything else.
  function extractTheme(img) {
    const S = 56;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S).data;

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      let bk = buckets.get(key);
      if (!bk) buckets.set(key, (bk = { n: 0, r: 0, g: 0, b: 0 }));
      bk.n++; bk.r += r; bk.g += g; bk.b += b;
    }

    const scored = [];
    let totalN = 0;
    for (const bk of buckets.values()) {
      totalN += bk.n;
      const rgb = [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n];
      const [, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const usable = l > 0.06 && l < 0.96 ? 1 : 0.08;
      scored.push({ rgb, s, l, n: bk.n, score: bk.n * (0.18 + s) * usable });
    }
    scored.sort((a, b) => b.score - a.score);

    // Pick distinct colors.
    const palette = [];
    for (const c of scored) {
      if (palette.every((p) => rgbDist(p.rgb, c.rgb) > 55)) palette.push(c);
      if (palette.length >= 6) break;
    }
    if (palette.length === 0) return defaultTheme();

    const dominant = palette[0].rgb;

    // A cover only counts as colorful if saturated pixels actually cover a
    // meaningful share of it — a white cover with a blue-tinted shadow or a
    // small colored patch must stay neutral.
    const satCoverage = scored
      .filter((c) => c.s > 0.22 && c.l > 0.1 && c.l < 0.92)
      .reduce((sum, c) => sum + c.n, 0) / Math.max(1, totalN);
    const isColorful = satCoverage > 0.06;

    // Bars: stay faithful to the cover. Saturation is boosted
    // proportionally (never invented), so muted covers give muted bars and
    // neutral covers give soft whites/silvers.
    const vividSrc = isColorful ? palette.filter((p) => p.s > 0.18).slice(0, 3) : [];
    const vivid = vividSrc.length
      ? vividSrc.map((p) => {
          const [h, s, l] = rgbToHsl(p.rgb[0], p.rgb[1], p.rgb[2]);
          return hslToRgb(h, Math.min(0.8, s * 1.25 + 0.04), Math.min(0.68, Math.max(0.45, l)));
        })
      : palette.slice(0, 3).map((p) => {
          const [h, s, l] = rgbToHsl(p.rgb[0], p.rgb[1], p.rgb[2]);
          return hslToRgb(h, Math.min(0.28, s), Math.min(0.82, Math.max(0.58, l)));
        });
    while (vivid.length < 3) vivid.push(vivid[vivid.length - 1] || adjust(dominant, { lMin: 0.5 }));

    // Background: darkened versions of the top colors; on neutral covers
    // also strip leftover color tints so it reads as clean dark gray.
    const bg = palette.slice(0, 4).map((p) =>
      adjust(p.rgb, { lMul: 0.55, lMin: 0.14, lMax: 0.34, sMax: isColorful ? null : 0.12 }));
    while (bg.length < 4) bg.push(bg[bg.length - 1]);

    // Accent: the cover color whose hue differs most from the bars — but it
    // must genuinely exist on the cover (saturated AND covering >2% of it).
    // Never synthesize a color that isn't there; fall back to a lightened
    // dominant, or white for neutral covers.
    const barHues = vivid.map((c) => rgbToHsl(c[0], c[1], c[2])[0]);
    let accent = null, bestDist = 0;
    for (const p of palette) {
      if (p.s < 0.3 || p.n / totalN < 0.02) continue;
      const h = rgbToHsl(p.rgb[0], p.rgb[1], p.rgb[2])[0];
      const d = Math.min(...barHues.map((bh) => hueDist(h, bh)));
      if (d > bestDist) { bestDist = d; accent = p.rgb; }
    }
    if (accent && bestDist >= 45) {
      accent = adjust(accent, { s: 0.7, lMin: 0.58, lMax: 0.72 });
    } else if (isColorful) {
      const [h, s] = rgbToHsl(dominant[0], dominant[1], dominant[2]);
      accent = hslToRgb(h, Math.min(0.7, s * 1.2 + 0.08), 0.66);
    } else {
      accent = [255, 255, 255]; // neutral art -> clean white accent
    }

    return { bg, bars: vivid, accent, dominant };
  }

  // Warm pink/orange defaults (used before any track is detected).
  function defaultTheme() {
    return {
      bg: [[70, 18, 44], [96, 34, 18], [30, 12, 52], [80, 20, 30]],
      bars: [[255, 84, 112], [255, 155, 61], [255, 209, 102]],
      accent: [120, 220, 255],
      dominant: [255, 84, 112]
    };
  }

  // Panda placeholder cover for tracks with no artwork.
  function pandaPlaceholder(theme) {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, css(theme.bars[0]));
    g.addColorStop(1, css(theme.bars[2] || theme.bars[1]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    const cx = S / 2, cy = S / 2 + 14;
    ctx.fillStyle = '#111';
    for (const dx of [-96, 96]) {
      ctx.beginPath(); ctx.arc(cx + dx, cy - 104, 52, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, 140, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    for (const dx of [-52, 52]) {
      ctx.save();
      ctx.translate(cx + dx, cy - 26);
      ctx.rotate(dx < 0 ? -0.5 : 0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, 26, 36, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#fff';
    for (const dx of [-52, 52]) {
      ctx.beginPath(); ctx.arc(cx + dx + (dx < 0 ? 6 : -6), cy - 30, 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(cx, cy + 34, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = '#111'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - 12, cy + 62, 14, -0.3, Math.PI * 0.7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 12, cy + 62, 14, Math.PI * 0.3, Math.PI + 0.3); ctx.stroke();
    return cv;
  }

  window.PandaColors = { extractTheme, defaultTheme, pandaPlaceholder, css, lerpRgb, hslToRgb, rgbToHsl };
})();
