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
  }

  update({ speed = 0, playerField = 0, botField = 0, tension = 0, active = true } = {}) {
    if (!this.unlocked || !this.enabled) return;
    const now = this.context.currentTime;
    const normalizedSpeed = clamp(speed / 720, 0, 1);
    const field = clamp(Math.max(playerField, botField), 0, 1);
    this.coreGain.gain.setTargetAtTime(active ? 0.012 + normalizedSpeed * 0.030 + tension * 0.008 : 0, now, 0.045);
    this.coreOsc.frequency.setTargetAtTime(66 + normalizedSpeed * 112 + tension * 24, now, 0.035);
    this.coreSub.frequency.setTargetAtTime(33 + normalizedSpeed * 28, now, 0.05);
    this.fieldGain.gain.setTargetAtTime(active ? field * field * 0.025 : 0, now, 0.035);
    this.fieldOsc.frequency.setTargetAtTime(76 + field * 138 + normalizedSpeed * 38, now, 0.035);
  }

  event(event) {
    if (!this.unlocked || !this.enabled || !event) return;
    switch (event.type) {
      case "intercept":
        this.#impact(118, 48, 0.13, 0.20, 0.17);
        break;
      case "perfect":
        this.#impact(360, 72, 0.19, 0.31, 0.20);
        this.#tone({ from: 920, to: 1480, duration: 0.16, gain: 0.12, type: "triangle" });
        break;
      case "clutch":
        this.#impact(230, 44, 0.24, 0.34, 0.23);
        this.#tone({ from: 410, to: 1320, duration: 0.26, gain: 0.14, type: "sine" });
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
  }

  goal(owner) {
    this.#impact(94, 31, 0.42, 0.42, 0.34);
    this.#noiseBurst(0.36, 0.30, 860);
    const rise = owner === "player";
    this.#tone({ from: rise ? 190 : 260, to: rise ? 940 : 74, duration: 0.46, gain: 0.17, type: "sawtooth", filter: 1180 });
  }

  result(victory) {
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
