// sound.js — every sound in Marisol Vice is synthesised with WebAudio: there are
// no audio files. One-shot effects (gunshot, crash, pickup, jingle) are built on
// the spot; the engine hum and the police siren are two looping oscillators
// whose pitch and volume the game steers every frame.

export class SoundBank {
  constructor() {
    this.context = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenPhase = 0;
  }

  // Browsers only allow audio after a user gesture, so the game calls this from
  // its first click or keypress.
  unlock() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.context = new AudioCtor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.context.destination);
    this.startEngineLoop();
    this.startSirenLoop();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  startEngineLoop() {
    const ctx = this.context;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  startSirenLoop() {
    const ctx = this.context;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
  }

  // speedRatio 0..1 while driving, null when on foot.
  updateEngine(speedRatio) {
    if (!this.context || !this.engineOsc) return;
    const target = speedRatio === null ? 0 : 0.05 + Math.abs(speedRatio) * 0.05;
    this.engineGain.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
    if (speedRatio !== null) {
      this.engineOsc.frequency.setTargetAtTime(52 + Math.abs(speedRatio) * 130, this.context.currentTime, 0.08);
    }
  }

  // nearestCop is a distance in pixels, or null when no police are active.
  updateSiren(nearestCop, dt) {
    if (!this.context || !this.sirenOsc) return;
    if (nearestCop === null) {
      this.sirenGain.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
      return;
    }
    this.sirenPhase += dt * 2.4;
    const wail = Math.sin(this.sirenPhase * Math.PI * 2) > 0 ? 880 : 660;
    this.sirenOsc.frequency.setTargetAtTime(wail, this.context.currentTime, 0.03);
    const volume = Math.max(0, 0.075 * (1 - nearestCop / 720));
    this.sirenGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.1);
  }

  noiseBurst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!this.context || this.muted) return;
    const ctx = this.context;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }

  tone(freqFrom, freqTo, duration, gainValue, type = 'square') {
    if (!this.context || this.muted) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  playGunshot() {
    this.noiseBurst(0.14, 1800, 0.5, 'highpass');
    this.tone(160, 40, 0.1, 0.3, 'square');
  }

  playCrash(intensity) {
    this.noiseBurst(0.28, 500, Math.min(0.6, 0.2 + intensity * 0.4));
    this.tone(90, 35, 0.25, 0.25, 'sine');
  }

  playPickup() {
    this.tone(660, 990, 0.12, 0.2, 'sine');
  }

  playCash() {
    this.tone(880, 880, 0.07, 0.18, 'sine');
    setTimeout(() => this.tone(1320, 1320, 0.1, 0.18, 'sine'), 60);
  }

  playDoor() {
    this.tone(220, 140, 0.09, 0.2, 'square');
  }

  playHorn() {
    this.tone(370, 370, 0.18, 0.12, 'square');
  }

  playMissionComplete() {
    if (!this.context || this.muted) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, i) => setTimeout(() => this.tone(freq, freq, 0.22, 0.2, 'triangle'), i * 110));
  }

  playBusted() {
    this.tone(392, 392, 0.2, 0.2, 'triangle');
    setTimeout(() => this.tone(311, 311, 0.2, 0.2, 'triangle'), 180);
    setTimeout(() => this.tone(233, 220, 0.42, 0.22, 'triangle'), 360);
  }
}
