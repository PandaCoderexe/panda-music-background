// Mode 1: full-width spectrum bars with rounded caps, album-colored
// gradient that slowly cycles, glow, and a soft reflection.
(function () {
  const { lerpRgb, css } = window.PandaColors;

  class BarsViz {
    constructor(canvas, theme) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.theme = theme;
      this.n = 72;
      this.off = document.createElement('canvas');
      this.offCtx = this.off.getContext('2d');
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.off.width = this.canvas.width;
      this.off.height = this.canvas.height;
    }

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
      const n = this.n;
      const bars = frame.bars;

      offCtx.clearRect(0, 0, w, h);

      const slot = w / n;
      const barW = slot * 0.62;
      const radius = barW / 2;
      const baseY = h * 0.72;
      const maxH = h * 0.5;
      const minH = barW * 0.8;

      for (let i = 0; i < n; i++) {
        const v = bars[i];
        const bh = minH + v * v * maxH * (0.80 + frame.beatEnv * 0.32);
        const x = i * slot + (slot - barW) / 2;
        const c = this.colorAt(i / n, t);
        const g = offCtx.createLinearGradient(0, baseY - bh, 0, baseY);
        g.addColorStop(0, css(c.map((v2, k) => Math.min(255, v2 + 70))));
        g.addColorStop(1, css(c.map((v2) => v2 * 0.75)));
        offCtx.fillStyle = g;
        offCtx.beginPath();
        offCtx.roundRect(x, baseY - bh, barW, bh, radius);
        offCtx.fill();
      }

      ctx.clearRect(0, 0, w, h);

      // glow pass
      ctx.save();
      ctx.filter = `blur(${Math.round(10 + frame.beatEnv * 14)}px)`;
      ctx.globalAlpha = 0.75;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(off, 0, 0);
      ctx.restore();

      // sharp pass
      ctx.drawImage(off, 0, 0);

      // reflection
      ctx.save();
      ctx.translate(0, baseY * 2 + 4);
      ctx.scale(1, -1);
      ctx.globalAlpha = 0.16;
      ctx.drawImage(off, 0, 0);
      ctx.restore();

      // fade reflection out toward the bottom
      const fade = ctx.createLinearGradient(0, baseY, 0, baseY + h * 0.2);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, baseY, w, h - baseY);
    }
  }

  window.PandaBarsViz = BarsViz;
})();
