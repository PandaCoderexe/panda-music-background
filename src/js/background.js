// Shifting ambient background made of drifting gradient blobs in the album
// colors. Drawn low-res; the canvas element is blurred via CSS.
(function () {
  class Background {
    constructor(canvas, theme) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.theme = theme;
      this.blobs = [];
      for (let i = 0; i < 5; i++) {
        this.blobs.push({
          speed: 0.05 + Math.random() * 0.06,
          phase: Math.random() * Math.PI * 2,
          orbit: 0.28 + Math.random() * 0.3,
          size: 0.55 + Math.random() * 0.4,
          dir: Math.random() > 0.5 ? 1 : -1
        });
      }
    }

    resize() {
      // deliberately tiny -- CSS blur smooths the upscale
      this.canvas.width = Math.max(2, Math.floor(window.innerWidth / 10));
      this.canvas.height = Math.max(2, Math.floor(window.innerHeight / 10));
    }

    draw(t, frame) {
      const { ctx, canvas } = this;
      const w = canvas.width, h = canvas.height;
      const colors = this.theme.current.bg;
      const dom = this.theme.current.dominant;

      ctx.globalCompositeOperation = 'source-over';
      const base = `rgb(${(dom[0] * 0.10) | 0},${(dom[1] * 0.10) | 0},${(dom[2] * 0.14) | 0})`;
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      const energy = 0.55 + frame.level * 0.45 + frame.beatEnv * 0.12;
      for (let i = 0; i < this.blobs.length; i++) {
        const b = this.blobs[i];
        const c = colors[i % colors.length];
        const a = t * b.speed * b.dir + b.phase;
        const x = w / 2 + Math.cos(a) * w * b.orbit;
        const y = h / 2 + Math.sin(a * 1.31 + b.phase) * h * b.orbit;
        const r = Math.max(w, h) * b.size * (0.85 + 0.15 * Math.sin(t * 0.23 + b.phase));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${0.55 * energy})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  window.PandaBackground = Background;
})();
