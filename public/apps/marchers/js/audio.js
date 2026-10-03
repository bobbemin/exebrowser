// Marchers — every sound is synthesised here with WebAudio (oscillators, filtered noise,
// envelopes). No audio files.
export class Sound {
  constructor() { this.ac = null; this.muted = false; this.last = {}; }
  // must be called from a user gesture the first time
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.out = this.ac.createGain(); this.out.gain.value = 0.35; this.out.connect(this.ac.destination);
      const len = Math.floor(this.ac.sampleRate * 0.8);
      this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noise.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
    } catch (e) { this.ac = null; }
  }
  setMuted(m) { this.muted = !!m; if (this.out) this.out.gain.value = this.muted ? 0 : 0.35; }
  get ok() { return this.ac && !this.muted && this.ac.state === 'running'; }
  throttle(k, ms) { const n = performance.now(); if (this.last[k] && n - this.last[k] < ms) return false; this.last[k] = n; return true; }

  tone(f, dur, { type = 'square', gain = 0.15, at = 0, to = null, attack = 0.004 } = {}) {
    const a = this.ac, t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  hiss(dur, { freq = 1200, q = 1, gain = 0.2, at = 0, type = 'bandpass', to = null } = {}) {
    const a = this.ac, t = a.currentTime + at, src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out); src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
  }

  play(name, extra) {
    if (!this.ok) return;
    switch (name) {
      case 'release': if (this.throttle(name, 40)) this.tone(720, 0.07, { type: 'sine', gain: 0.12, to: 360 }); break;
      case 'hatch': this.tone(180, 0.18, { type: 'triangle', gain: 0.2, to: 90 }); this.hiss(0.15, { freq: 500, gain: 0.08 }); break;
      case 'assign': this.tone(1046, 0.05, { gain: 0.07 }); this.tone(1568, 0.07, { gain: 0.06, at: 0.05 }); break;
      case 'deny': this.tone(220, 0.08, { type: 'triangle', gain: 0.1 }); break;
      case 'select': this.tone(880, 0.03, { type: 'triangle', gain: 0.06 }); break;
      case 'dig': if (this.throttle(name, 110)) this.hiss(0.07, { freq: 300 + Math.random() * 200, q: 2, gain: 0.12 }); break;
      case 'brick': if (this.throttle(name, 60)) this.tone(940, 0.03, { type: 'triangle', gain: 0.08 }); break;
      case 'warn': this.tone(1320, 0.05, { type: 'square', gain: 0.05 }); break;
      case 'splat': if (this.throttle(name, 60)) { this.hiss(0.12, { freq: 260, gain: 0.25, type: 'lowpass' }); this.tone(110, 0.1, { type: 'sine', gain: 0.25, to: 50 }); } break;
      case 'exit': if (this.throttle(name, 70)) { const b = 659 * Math.pow(2, ((extra || 0) % 5) / 12); this.tone(b, 0.12, { type: 'sine', gain: 0.1 }); this.tone(b * 1.26, 0.12, { type: 'sine', gain: 0.08, at: 0.06 }); this.tone(b * 1.5, 0.2, { type: 'sine', gain: 0.07, at: 0.12 }); } break;
      case 'fuse': if (this.throttle(name, 30)) this.tone(1800, 0.02, { type: 'square', gain: 0.05 }); break;
      case 'boom': if (this.throttle(name, 50)) { this.hiss(0.6, { freq: 1600, to: 80, gain: 0.45, type: 'lowpass' }); this.tone(90, 0.4, { type: 'sine', gain: 0.4, to: 30 }); } break;
      case 'drown': if (this.throttle(name, 80)) { for (let i = 0; i < 4; i++) this.tone(300 + i * 90, 0.06, { type: 'sine', gain: 0.07, at: i * 0.06, to: 600 + i * 90 }); } break;
      case 'burn': if (this.throttle(name, 80)) this.hiss(0.35, { freq: 3000, gain: 0.12, type: 'highpass' }); break;
      case 'trap': this.tone(1400, 0.03, { type: 'square', gain: 0.1 }); this.hiss(0.08, { freq: 2500, gain: 0.15 }); break;
      case 'clank': if (this.throttle(name, 80)) { this.tone(1230, 0.18, { type: 'square', gain: 0.05 }); this.tone(1710, 0.15, { type: 'square', gain: 0.04 }); } break;
      case 'open': if (this.throttle(name, 60)) this.hiss(0.15, { freq: 900, to: 300, gain: 0.08 }); break;
      case 'nuke': for (let i = 0; i < 3; i++) this.tone(440, 0.25, { type: 'sawtooth', gain: 0.06, at: i * 0.3, to: 880 }); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.14, at: i * 0.12 })); this.tone(1318, 0.6, { type: 'sine', gain: 0.1, at: 0.5 }); break;
      case 'lose': [440, 392, 349, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.13, at: i * 0.16 })); break;
    }
  }
}
