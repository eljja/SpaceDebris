/**
 * SpaceDebris — Procedural Web Audio Sound Engine
 * Generates ambient deep-space drones, sub-bass explosion shockwaves,
 * debris launch pings, atmospheric reentry crackles, and UI sound effects using Web Audio API.
 */

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambientGain = null;
    this.sfxGain = null;

    this.enabled = true;
    this.muted = false;
    this.volume = 0.4; // 40% default

    this.ambientOsc1 = null;
    this.ambientOsc2 = null;
    this.ambientLfo = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Category Gains
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(0.15, this.ctx.currentTime); // Subtle ambient drone
      this.ambientGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.startAmbientDrone();
      this.initialized = true;

      // Power-saving: Suspend Web Audio when tab is hidden, resume on focus
      document.addEventListener('visibilitychange', () => {
        if (this.ctx) {
          if (document.hidden && this.ctx.state === 'running') {
            this.ctx.suspend();
          } else if (!document.hidden && this.ctx.state === 'suspended' && !this.muted) {
            this.ctx.resume();
          }
        }
      });
    } catch (e) {
      console.warn('[SoundEngine] Web Audio API init failed:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) {
      this.init();
    } else if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Deep Space Ambient Drone: Detuned sine waves + low-frequency modulation (LFO)
   */
  startAmbientDrone() {
    if (!this.ctx) return;

    // Sub drone 55Hz (A1) + 55.5Hz detuned
    this.ambientOsc1 = this.ctx.createOscillator();
    this.ambientOsc2 = this.ctx.createOscillator();

    this.ambientOsc1.type = 'sine';
    this.ambientOsc1.frequency.setValueAtTime(55, this.ctx.currentTime);

    this.ambientOsc2.type = 'sine';
    this.ambientOsc2.frequency.setValueAtTime(55.8, this.ctx.currentTime);

    // Low pass filter for warmth
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, this.ctx.currentTime);

    // LFO for slow breathing (0.08 Hz)
    this.ambientLfo = this.ctx.createOscillator();
    this.ambientLfo.frequency.setValueAtTime(0.08, this.ctx.currentTime);

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(30, this.ctx.currentTime);

    this.ambientLfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    this.ambientOsc1.connect(filter);
    this.ambientOsc2.connect(filter);
    filter.connect(this.ambientGain);

    this.ambientOsc1.start();
    this.ambientOsc2.start();
    this.ambientLfo.start();
  }

  /**
   * Play Explosion Shockwave: Heavy sub-bass thud + decaying noise burst
   */
  playExplosion(powerScale = 1.0) {
    if (!this.enabled || this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const duration = Math.min(3.5, 0.8 + powerScale * 0.4);

    // 1. Sub-bass sine sweep (60Hz -> 20Hz)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(80 * Math.cbrt(powerScale), t);
    subOsc.frequency.exponentialRampToValueAtTime(18, t + duration);

    subGain.gain.setValueAtTime(0.7 * Math.min(1.2, powerScale), t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    subOsc.connect(subGain);
    subGain.connect(this.sfxGain);

    subOsc.start(t);
    subOsc.stop(t + duration);

    // 2. Filtered White Noise Burst for rumble
    const bufferSize = this.ctx.sampleRate * duration;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(350, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(40, t + duration);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5 * Math.min(1.0, powerScale), t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    noise.start(t);
    noise.stop(t + duration);
  }

  /**
   * Play Debris Launch Ping: High sine chime (880Hz -> 1760Hz sweep)
   */
  playDebrisLaunch() {
    if (!this.enabled || this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.15);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  /**
   * Play Reentry Crackle: Pitch sweep down + noise
   */
  playReentryBurn() {
    if (!this.enabled || this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.8);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.8);
  }

  /**
   * Play UI Click
   */
  playClick() {
    if (!this.enabled || this.muted) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);

    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
    return this.muted;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }
}
