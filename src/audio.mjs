const AUDIO_CONTEXT = () => globalThis.AudioContext || globalThis.webkitAudioContext;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class RiftAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.coreGain = null;
    this.coreOsc = null;
    this.coreSub = null;
    this.fieldGain = null;
    this.fieldOsc = null;
    this.playerEngineGain = null;
    this.playerEngineOsc = null;
    this.wraithEngineGain = null;
    this.wraithEngineOsc = null;
    this.dangerGain = null;
    this.dangerOsc = null;
    this.crowdGain = null;
    this.musicPhase = "MENU";
    this.nextBeat = 0;
    this.beatIndex = 0;
    this.unlocked = false;
    this.enabled = true;
  }

  async unlock() {
    if (!this.enabled) return false;
    if (!this.context) {
      const Context = AUDIO_CONTEXT();
      if (!Context) return false;
      this.context = new Context({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.context.destination);
      this.#buildContinuousVoices();
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.unlocked = this.context.state === "running";
    return this.unlocked;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.72 : 0, this.context.currentTime, 0.025);
    }
  }

  #buildContinuousVoices() {
    const now = this.context.currentTime;
    this.coreGain = this.context.createGain();
    this.coreGain.gain.value = 0;
    const coreFilter = this.context.createBiquadFilter();
    coreFilter.type = "lowpass";
    coreFilter.frequency.value = 920;
    coreFilter.Q.value = 1.2;
    this.coreOsc = this.context.createOscillator();
    this.coreOsc.type = "triangle";
    this.coreOsc.frequency.value = 74;
    this.coreSub = this.context.createOscillator();
    this.coreSub.type = "sine";
    this.coreSub.frequency.value = 37;
    const subGain = this.context.createGain();
    subGain.gain.value = 0.35;
    this.coreOsc.connect(coreFilter);
    this.coreSub.connect(subGain).connect(coreFilter);
    coreFilter.connect(this.coreGain).connect(this.master);
    this.coreOsc.start(now);
    this.coreSub.start(now);

    this.fieldGain = this.context.createGain();
    this.fieldGain.gain.value = 0;
    const fieldFilter = this.context.createBiquadFilter();
    fieldFilter.type = "bandpass";
    fieldFilter.frequency.value = 620;
    fieldFilter.Q.value = 4.8;
    this.fieldOsc = this.context.createOscillator();
    this.fieldOsc.type = "sawtooth";
    this.fieldOsc.frequency.value = 92;
    this.fieldOsc.connect(fieldFilter).connect(this.fieldGain).connect(this.master);
    this.fieldOsc.start(now);

    this.playerEngineGain = this.context.createGain();
    this.playerEngineGain.gain.value = 0;
    const playerFilter = this.context.createBiquadFilter();
    playerFilter.type = "lowpass";
    playerFilter.frequency.value = 540;
    this.playerEngineOsc = this.context.createOscillator();
    this.playerEngineOsc.type = "sawtooth";
    this.playerEngineOsc.frequency.value = 54;
    this.playerEngineOsc.connect(playerFilter).connect(this.playerEngineGain).connect(this.master);
    this.playerEngineOsc.start(now);

    this.wraithEngineGain = this.context.createGain();
    this.wraithEngineGain.gain.value = 0;
    const wraithFilter = this.context.createBiquadFilter();
    wraithFilter.type = "bandpass";
    wraithFilter.frequency.value = 410;
    wraithFilter.Q.value = 2.2;
    this.wraithEngineOsc = this.context.createOscillator();
    this.wraithEngineOsc.type = "square";
    this.wraithEngineOsc.frequency.value = 46;
    this.wraithEngineOsc.connect(wraithFilter).connect(this.wraithEngineGain).connect(this.master);
    this.wraithEngineOsc.start(now);

    this.dangerGain = this.context.createGain();
    this.dangerGain.gain.value = 0;
    this.dangerOsc = this.context.createOscillator();
    this.dangerOsc.type = "triangle";
    this.dangerOsc.frequency.value = 188;
    this.dangerOsc.connect(this.dangerGain).connect(this.master);
    this.dangerOsc.start(now);

    const crowdBuffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * 1.4), this.context.sampleRate);
    const crowdData = crowdBuffer.getChannelData(0);
    let memory = 0;
    for (let index = 0; index < crowdData.length; index += 1) {
      memory = memory * 0.965 + (Math.random() * 2 - 1) * 0.035;
      crowdData[index] = memory;
    }
    const crowdSource = this.context.createBufferSource();
    crowdSource.buffer = crowdBuffer;
    crowdSource.loop = true;
    const crowdFilter = this.context.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 1260;
    crowdFilter.Q.value = 0.55;
    this.crowdGain = this.context.createGain();
    this.crowdGain.gain.value = 0;
    crowdSource.connect(crowdFilter).connect(this.crowdGain).connect(this.master);
    crowdSource.start(now);
  }

  update({
    speed = 0,
    playerField = 0,
    botField = 0,
    playerSpeed = 0,
    botSpeed = 0,
    tension = 0,
    danger = 0,
    crowd = 0,
    contested = 0,
    phase = "DUEL",
    active = true,
  } = {}) {
    if (!this.unlocked || !this.enabled) return;
    const now = this.context.currentTime;
    const normalizedSpeed = clamp(speed / 720, 0, 1);
    const field = clamp(Math.max(playerField, botField), 0, 1);
    this.coreGain.gain.setTargetAtTime(active ? 0.012 + normalizedSpeed * 0.030 + tension * 0.008 : 0, now, 0.045);
    this.coreOsc.frequency.setTargetAtTime(66 + normalizedSpeed * 112 + tension * 24, now, 0.035);
    this.coreSub.frequency.setTargetAtTime(33 + normalizedSpeed * 28, now, 0.05);
    this.fieldGain.gain.setTargetAtTime(active ? field * field * 0.025 : 0, now, 0.035);
    this.fieldOsc.frequency.setTargetAtTime(76 + field * 138 + normalizedSpeed * 38 + contested * 42, now, 0.035);
    const playerVelocity = clamp(playerSpeed / 900, 0, 1);
    const wraithVelocity = clamp(botSpeed / 700, 0, 1);
    this.playerEngineGain.gain.setTargetAtTime(active ? 0.003 + playerVelocity * 0.018 : 0, now, 0.045);
    this.playerEngineOsc.frequency.setTargetAtTime(48 + playerVelocity * 136, now, 0.035);
    this.wraithEngineGain.gain.setTargetAtTime(active ? 0.002 + wraithVelocity * 0.014 : 0, now, 0.045);
    this.wraithEngineOsc.frequency.setTargetAtTime(42 + wraithVelocity * 118, now, 0.040);
    this.dangerGain.gain.setTargetAtTime(active ? danger * danger * 0.020 : 0, now, 0.025);
    this.dangerOsc.frequency.setTargetAtTime(168 + danger * 92 + Math.sin(now * 12) * danger * 18, now, 0.020);
    this.crowdGain.gain.setTargetAtTime(active ? 0.002 + clamp(crowd + tension * 0.4, 0, 1) * 0.020 : 0, now, 0.18);
    this.#updateMusic(active ? phase : "MENU", tension);
  }

  #updateMusic(phase, tension) {
    if (!this.context || !this.unlocked) return;
    if (phase !== this.musicPhase) {
      this.musicPhase = phase;
      this.nextBeat = this.context.currentTime + 0.04;
      this.beatIndex = 0;
    }
    const now = this.context.currentTime;
    if (now < this.nextBeat) return;
    const tempo = phase === "MATCH_POINT" ? 0.215 : phase === "PRESSURE" ? 0.255 : phase === "VICTORY" ? 0.34 : phase === "MENU" ? 0.52 : 0.34;
    const roots = phase === "MATCH_POINT" ? [55, 73.4, 82.4, 110] : phase === "MENU" ? [49, 65.4, 73.4, 98] : [55, 65.4, 82.4, 98];
    const root = roots[this.beatIndex % roots.length];
    const accent = this.beatIndex % 4 === 0;
    if (phase !== "VICTORY") {
      this.#tone({ from: root * (accent ? 1 : 0.98), to: root, duration: tempo * 0.78, gain: 0.022 + tension * 0.014 + (accent ? 0.012 : 0), type: "triangle", filter: 420 });
      if (phase === "MATCH_POINT" && this.beatIndex % 2 === 0) {
        this.#tone({ from: root * 4, to: root * 2.7, duration: tempo * 0.52, gain: 0.020, type: "sawtooth", filter: 980 });
      }
    }
    this.beatIndex += 1;
    this.nextBeat = now + tempo;
  }

  event(event) {
    if (!this.unlocked || !this.enabled || !event) return;
    switch (event.type) {
      case "intercept":
        this.#impact(118, 48, 0.13, 0.20, 0.17);
        break;
      case "perfect":
        this.#impact(420, 62, 0.18, 0.34, 0.21);
        this.#tone({ from: 780, to: 1740, duration: 0.15, gain: 0.14, type: "triangle" });
        this.crowdResponse(0.58);
        break;
      case "clutch":
        this.#impact(260, 38, 0.26, 0.38, 0.26);
        this.#tone({ from: 360, to: 1460, duration: 0.28, gain: 0.16, type: "sine" });
        this.#tone({ from: 72, to: 116, duration: 0.38, gain: 0.16, type: "sawtooth", delay: 0.05, filter: 620 });
        this.crowdResponse(0.9);
        break;
      case "sling":
        this.#whoosh(180, 1120, 0.25, 0.14);
        break;
      case "rebound":
        this.#impact(176, 96, 0.085, 0.15, 0.10);
        break;
      case "goal":
        this.goal(event.owner);
        break;
      case "launch":
        this.#whoosh(110, 420, 0.18, 0.09);
        break;
      case "surge":
        this.#tone({ from: 84, to: 246, duration: 0.42, gain: 0.16, type: "sawtooth", filter: 680 });
        this.#whoosh(120, 760, 0.34, 0.10);
        break;
      case "break":
        this.#impact(78, 29, 0.36, 0.30, 0.24);
        this.#tone({ from: 180, to: 880, duration: 0.34, gain: 0.13, type: "triangle", filter: 1200 });
        break;
      case "contest-break":
        this.#tone({ from: 138, to: 510, duration: 0.18, gain: 0.075, type: "triangle", filter: 860 });
        break;
      default:
        break;
    }
  }

  ui() {
    this.#tone({ from: 260, to: 520, duration: 0.11, gain: 0.11, type: "triangle" });
  }

  matchPoint() {
    this.#tone({ from: 92, to: 61, duration: 0.55, gain: 0.21, type: "sawtooth", filter: 520 });
    this.#tone({ from: 410, to: 620, duration: 0.48, gain: 0.08, type: "sine", delay: 0.08 });
    this.#tone({ from: 49, to: 49, duration: 1.15, gain: 0.14, type: "triangle", delay: 0.16, filter: 260 });
  }

  intro() {
    this.#tone({ from: 42, to: 96, duration: 0.72, gain: 0.14, type: "sawtooth", filter: 640 });
    this.#tone({ from: 260, to: 620, duration: 0.38, gain: 0.07, type: "triangle", delay: 0.52, filter: 1280 });
  }

  coreForm() {
    this.#tone({ from: 170, to: 940, duration: 0.36, gain: 0.105, type: "sine", filter: 1520 });
    this.#whoosh(220, 1180, 0.28, 0.07);
  }

  crowdResponse(strength = 0.5) {
    if (!this.unlocked || !this.enabled || !this.crowdGain) return;
    const now = this.context.currentTime;
    const target = 0.016 + clamp(strength, 0, 1) * 0.055;
    this.crowdGain.gain.cancelScheduledValues(now);
    this.crowdGain.gain.setValueAtTime(Math.max(this.crowdGain.gain.value, 0.002), now);
    this.crowdGain.gain.linearRampToValueAtTime(target, now + 0.055);
    this.crowdGain.gain.exponentialRampToValueAtTime(0.003, now + 0.72 + strength * 0.45);
  }

  goal(owner) {
    this.#impact(102, 28, 0.46, 0.46, 0.38);
    this.#noiseBurst(0.40, 0.34, 780);
    const rise = owner === "player";
    this.#tone({ from: rise ? 190 : 280, to: rise ? 1080 : 62, duration: 0.48, gain: 0.19, type: "sawtooth", filter: 1220 });
    this.#tone({ from: 58, to: 34, duration: 0.62, gain: 0.24, type: "sine", delay: 0.055, filter: 320 });
    this.crowdResponse(rise ? 1 : 0.68);
  }

  result(victory) {
    this.musicPhase = victory ? "VICTORY" : "DEFEAT";
    if (victory) {
      [0, 0.11, 0.23].forEach((delay, index) => this.#tone({
        from: [246, 329, 493][index],
        to: [329, 493, 739][index],
        duration: 0.52,
        gain: 0.13,
        type: "triangle",
        delay,
      }));
    } else {
      this.#tone({ from: 220, to: 58, duration: 0.72, gain: 0.18, type: "sawtooth", filter: 520 });
    }
    this.crowdResponse(victory ? 1 : 0.32);
  }

  #tone({ from, to, duration, gain, type = "sine", delay = 0, filter = 1600 }) {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const voiceGain = this.context.createGain();
    const voiceFilter = this.context.createBiquadFilter();
    voiceFilter.type = "lowpass";
    voiceFilter.frequency.setValueAtTime(filter, start);
    voiceFilter.frequency.exponentialRampToValueAtTime(Math.max(90, filter * 0.48), start + duration);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(24, from), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, to), start + duration);
    voiceGain.gain.setValueAtTime(0.0001, start);
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), start + Math.min(0.018, duration * 0.2));
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(voiceFilter).connect(voiceGain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }

  #impact(from, to, duration, gain, noiseGain) {
    this.#tone({ from, to, duration, gain, type: "sine", filter: 740 });
    this.#tone({ from: from * 2.8, to: Math.max(45, to * 1.4), duration: duration * 0.72, gain: gain * 0.36, type: "triangle", filter: 1450 });
    this.#noiseBurst(duration * 0.70, noiseGain, 980);
  }

  #whoosh(from, to, duration, gain) {
    this.#tone({ from, to, duration, gain: gain * 0.62, type: "sawtooth", filter: 1100 });
    this.#noiseBurst(duration, gain, 1550, "bandpass");
  }

  #noiseBurst(duration, gain, frequency, type = "lowpass") {
    if (!this.context || !this.master) return;
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const fade = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * fade * fade;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = type === "bandpass" ? 1.8 : 0.72;
    const voiceGain = this.context.createGain();
    const now = this.context.currentTime;
    voiceGain.gain.setValueAtTime(Math.max(0.001, gain), now);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(voiceGain).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }
}
