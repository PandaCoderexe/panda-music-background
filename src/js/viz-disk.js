// Mode 2: spinning disk with the album cover inside, surrounded by radial
// bars in the same album-colored gradient as bars mode.
(function () {
  const { css, lerpRgb } = window.PandaColors;

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  class DiskViz {
    constructor(canvas, theme) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.theme = theme;
      this.n = 96;
      this.angle = 0;
      this.lastT = 0;
      this.shiftTarget = 0; // -0.22 when lyrics panel is open
      this.shift = 0;
      this.curR = 0;
      this.art = null;      // source image / canvas
      this.disk = null;     // prebuilt circular disk canvas
      this.off = document.createElement('canvas');
      this.offCtx = this.off.getContext('2d');
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.off.width = this.canvas.width;
      this.off.height = this.canvas.height;
      this.curR = 0; // snap to the new size instead of easing
    }

    setArt(img) {
      this.art = img;
      this.disk = this.buildDisk(img);
    }

    buildDisk(img) {
      const S = 640;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const ctx = cv.getContext('2d');
      const r = S / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, r - 2, 0, Math.PI * 2);
      ctx.clip();
      // cover-fit the artwork
      const iw = img.width, ih = img.height;
      const scale = S / Math.min(iw, ih);
      ctx.drawImage(img, r - (iw * scale) / 2, r - (ih * scale) / 2, iw * scale, ih * scale);
      ctx.restore();

      // vinyl grooves
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      for (let gr = r * 0.55; gr < r - 8; gr += 9) {
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(r, r, gr, 0, Math.PI * 2);
        ctx.stroke();
      }

      // darkened rim + subtle sheen
      const rim = ctx.createRadialGradient(r, r, r * 0.62, r, r, r);
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(r, r, r, 0, Math.PI * 2); ctx.fill();

      const sheen = ctx.createLinearGradient(0, 0, S, S);
      sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
      sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2); ctx.fill();

      // center hole
      ctx.fillStyle = 'rgba(10,10,14,0.95)';
      ctx.beginPath(); ctx.arc(r, r, r * 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r, r, r * 0.055, 0, Math.PI * 2); ctx.stroke();
      return cv;
    }

    // same slowly-cycling gradient lookup as bars mode
    colorAt(pos, t) {
      const cols = this.theme.current.bars;
      const shift = (pos + t * 0.03) % 1;
      const x = shift * (cols.length - 1);
      const i = Math.min(cols.length - 2, Math.floor(x));
      return lerpRgb(cols[i], cols[i + 1], x - i);
    }

    draw(t, frame) {
      const { ctx, off, offCtx } = this;
      const w = this.canvas.width, h = this.canvas.height;
      this.shift += (this.shiftTarget - this.shift) * 0.06;
      const cx = w / 2 + this.shift * w, cy = h / 2;
      // with the lyrics panel open the disk must fit the left half, spikes
      // included, however small the window gets
      const baseR = Math.min(w, h) * 0.26;
      const targetR = this.shiftTarget < -0.02 ? Math.min(baseR, w * 0.145) : baseR;
      this.curR += this.curR ? (targetR - this.curR) * 0.08 : targetR;
      const R = this.curR;
      const bars = frame.bars;
      const n = this.n;

      const dt = this.lastT ? Math.min(0.1, t - this.lastT) : 0.016;
      this.lastT = t;
      this.angle += dt * (0.55 + frame.beatEnv * 0.9); // spins faster on the beat

      // --- radial bars (drawn to offscreen for the glow pass) ---
      offCtx.clearRect(0, 0, w, h);
      const inner = R * 1.1;
      const maxLen = R * 0.85;
      offCtx.lineCap = 'round';
      offCtx.lineWidth = Math.max(2, (2 * Math.PI * inner) / n * 0.5);

      for (let i = 0; i < n; i++) {
        // mirror the spectrum so both sides of the disk feel balanced
        const half = i < n / 2 ? i / (n / 2) : (n - i) / (n / 2);
        const v = bars[Math.floor(half * (bars.length - 1))];
        const alpha = smoothstep(0.10, 0.26, v); // bars appear & hide with the beat
        if (alpha <= 0.01) continue;
        const len = Math.max(3, v * v * maxLen * (0.82 + frame.beatEnv * 0.42));
        const a = (i / n) * Math.PI * 2 - Math.PI / 2 + this.angle * 0.1;
        const c1 = Math.cos(a), s1 = Math.sin(a);
        // color by the mirrored position so the gradient stays seamless
        offCtx.strokeStyle = css(this.colorAt(half, t), alpha);
        offCtx.beginPath();
        offCtx.moveTo(cx + c1 * inner, cy + s1 * inner);
        offCtx.lineTo(cx + c1 * (inner + len), cy + s1 * (inner + len));
        offCtx.stroke();
      }

      ctx.clearRect(0, 0, w, h);

      // glow pass for the radial bars
      ctx.save();
      ctx.filter = `blur(${Math.round(8 + frame.beatEnv * 12)}px)`;
      ctx.globalAlpha = 0.8;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(off, 0, 0);
      ctx.restore();
      ctx.drawImage(off, 0, 0);

      // --- spinning disk ---
      const pulse = 1 + frame.beatEnv * 0.06;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.angle);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = R * 0.25;
      if (this.disk) ctx.drawImage(this.disk, -R, -R, R * 2, R * 2);
      ctx.restore();

      // thin ring around the disk in the bars-mode gradient
      const cols = this.theme.current.bars;
      const ringG = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      const ringA = 0.35 + frame.beatEnv * 0.4;
      ringG.addColorStop(0, css(cols[0], ringA));
      ringG.addColorStop(0.5, css(cols[1], ringA));
      ringG.addColorStop(1, css(cols[2] || cols[1], ringA));
      ctx.strokeStyle = ringG;
      ctx.lineWidth = Math.max(2, R * 0.012);
      ctx.beginPath();
      ctx.arc(cx, cy, R * pulse + ctx.lineWidth, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  window.PandaDiskViz = DiskViz;
})();
