// Audio capture + analysis. Tries system loopback (Windows), then the
// microphone, then falls back to a simulated beat engine so the visuals
// always move. Exposes window.PandaAudio.
(function () {
  class AudioEngine {
    constructor() {
      this.source = 'none'; // 'system' | 'mic' | 'sim'
      this.ctx = null;
      this.analyser = null;
      this.stream = null;
      this.freq = null;
      this.smoothed = null;
      this.peak = 0.35;
      this.loudRef = 0.1;
      this.loudness = 0;
      this.bassHistory = new Float32Array(48);
      this.bassIdx = 0;
      this.beatEnv = 0;
      this.playing = true; // set from now-playing info; damps sim when idle
    }

    async init(forced) {
      if (forced === 'sim') { this.setSim(); return this.source; }
      if (forced === 'mic') {
        try { await this.initMic(); return this.source; } catch (e) {}
        this.setSim(); return this.source;
      }
      try { await this.initSystem(); return this.source; } catch (e) {}
      try { await this.initMic(); return this.source; } catch (e) {}
      this.setSim();
      return this.source;
    }

    async cycleSource() {
      const order = ['system', 'mic', 'sim'];
      const next = order[(order.indexOf(this.source) + 1) % order.length];
      this.teardown();
      if (next === 'system') {
        try { await this.initSystem(); } catch (e) { try { await this.initMic(); } catch (e2) { this.setSim(); } }
      } else if (next === 'mic') {
        try { await this.initMic(); } catch (e) { this.setSim(); }
      } else {
        this.setSim();
      }
      return this.source;
    }

    teardown() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close().catch(() => {});
      this.stream = null; this.ctx = null; this.analyser = null;
    }

    // Capture requests can stall indefinitely on OS permission dialogs;
    // give up after a while so the fallback chain keeps moving. If the
    // request resolves late anyway, stop its tracks.
    streamWithTimeout(promise, ms) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          promise.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
          reject(new Error('capture timed out'));
        }, ms);
        promise.then((s) => { clearTimeout(timer); resolve(s); }, (e) => { clearTimeout(timer); reject(e); });
      });
    }

    async initSystem() {
      // Main process answers getDisplayMedia with a loopback audio track
      // (Windows, and macOS on recent Electron). If the platform can't do
      // it the request is denied and we fall through to the mic.
      const stream = await this.streamWithTimeout(
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }), 8000);
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) throw new Error('no loopback audio');
      this.attach(stream);
      this.source = 'system';
    }

    async initMic() {
      const stream = await this.streamWithTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        }), 8000);
      this.attach(stream);
      this.source = 'mic';
    }

    setSim() {
      this.teardown();
      this.source = 'sim';
      this.simBars = null;
    }

    attach(stream) {
      this.stream = stream;
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;
      src.connect(this.analyser);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    }

    // Returns { bars: Float32Array(n) in 0..1, level, beatEnv }.
    getFrame(n, t) {
      if (this.source === 'sim' || !this.analyser) return this.simFrame(n, t);

      this.analyser.getByteFrequencyData(this.freq);
      if (!this.smoothed || this.smoothed.length !== n) this.smoothed = new Float32Array(n);

      const nyquist = this.ctx.sampleRate / 2;
      const minHz = 40, maxHz = Math.min(13000, nyquist);
      const binCount = this.freq.length;
      let level = 0, rawMax = 0;

      for (let i = 0; i < n; i++) {
        const f0 = minHz * Math.pow(maxHz / minHz, i / n);
        const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / n);
        const b0 = Math.max(0, Math.floor((f0 / nyquist) * binCount));
        const b1 = Math.min(binCount - 1, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * binCount)));
        let sum = 0;
        for (let b = b0; b < b1; b++) sum += this.freq[b];
        let v = sum / (b1 - b0) / 255;
        rawMax = Math.max(rawMax, v);
        // fast attack, snappy release so hits read clearly
        this.smoothed[i] = v > this.smoothed[i]
          ? this.smoothed[i] + (v - this.smoothed[i]) * 0.65
          : this.smoothed[i] * 0.86;
        level += this.smoothed[i];
      }
      level /= n;

      // auto-gain so quiet sources still fill the screen...
      this.peak = Math.max(this.peak * 0.996, rawMax, 0.22);
      const gain = 1 / this.peak;

      // ...but shaped by loudness relative to the track's own recent peak,
      // so quiet passages shrink and loud ones grow.
      this.loudRef = Math.max(this.loudRef * 0.998, level, 0.03);
      const loudTarget = Math.min(1, level / this.loudRef);
      this.loudness += (loudTarget - this.loudness) * (loudTarget > this.loudness ? 0.4 : 0.08);
      const shape = 0.30 + 0.70 * this.loudness;

      const bars = Float32Array.from(this.smoothed, (v) => Math.min(1, v * gain * shape));

      // beat detection on low end
      const bassBins = Math.max(2, Math.floor((160 / nyquist) * binCount));
      let bass = 0;
      for (let b = 1; b < bassBins; b++) bass += this.freq[b];
      bass = bass / (bassBins - 1) / 255;
      let avg = 0;
      for (let i = 0; i < this.bassHistory.length; i++) avg += this.bassHistory[i];
      avg /= this.bassHistory.length;
      this.bassHistory[this.bassIdx] = bass;
      this.bassIdx = (this.bassIdx + 1) % this.bassHistory.length;
      if (bass > avg * 1.25 && bass > 0.10) this.beatEnv = 1;
      this.beatEnv *= 0.90;

      return { bars, level: Math.min(1, level * gain) * shape, beatEnv: this.beatEnv };
    }

    simFrame(n, t) {
      if (!this.simBars || this.simBars.length !== n) this.simBars = new Float32Array(n);
      const bpm = 118;
      const beatPhase = (t * bpm / 60) % 1;
      const kick = Math.pow(1 - beatPhase, 3.2);
      const idle = this.playing ? 1 : 0.25;
      for (let i = 0; i < n; i++) {
        const f = i / n;
        const rolloff = 1 - f * 0.6;
        const melody = 0.5 + 0.5 * Math.sin(t * 1.9 + i * 0.55 + Math.sin(t * 0.53 + i * 0.13) * 2.2);
        const shimmer = 0.5 + 0.5 * Math.sin(t * 5.1 + i * 1.31);
        let v = rolloff * (0.16 + 0.34 * melody + 0.18 * shimmer) + kick * rolloff * (0.35 + 0.3 * Math.sin(i * 0.8));
        v = Math.max(0, Math.min(1, v * idle));
        this.simBars[i] = v > this.simBars[i]
          ? this.simBars[i] + (v - this.simBars[i]) * 0.5
          : this.simBars[i] * 0.9;
      }
      this.beatEnv = Math.max(this.beatEnv * 0.93, this.playing ? kick : 0);
      let level = 0;
      for (let i = 0; i < n; i++) level += this.simBars[i];
      return { bars: this.simBars, level: level / n, beatEnv: this.beatEnv };
    }
  }

  window.PandaAudio = new AudioEngine();
})();
