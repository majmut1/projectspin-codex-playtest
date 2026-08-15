const STORAGE_KEY = "riftball-owner-telemetry-v6";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percentile(values, amount) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * amount))];
}

function safeLoad() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-12) : [];
  } catch {
    return [];
  }
}

function safeStore(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value.slice(-12)));
  } catch {
    // Telemetry must never affect play.
  }
}

export class RiftTelemetry {
  constructor({ build, physics, camera }) {
    this.build = build;
    this.physics = physics;
    this.camera = camera;
    this.history = safeLoad();
    this.frameTimes = [];
    this.current = null;
    this.lastTouch = null;
    this.stallActive = false;
  }

  startMatch({ rematch = false } = {}) {
    this.frameTimes.length = 0;
    this.lastTouch = null;
    this.stallActive = false;
    this.current = {
      schema: 1,
      build: this.build,
      physics: this.physics,
      camera: this.camera,
      startedAt: new Date().toISOString(),
      rematch,
      duration: 0,
      score: { player: 0, bot: 0 },
      goals: [],
      maxCoreSpeed: 0,
      averageCoreSpeed: 0,
      speedSamples: 0,
      contentionSeconds: 0,
      fieldSeconds: { player: 0, bot: 0 },
      slingshots: 0,
      chargedSlingshots: 0,
      intercepts: 0,
      perfectIntercepts: 0,
      saves: 0,
      clutchSaves: 0,
      strikes: 0,
      powerHits: { rush: 0, bend: 0, grip: 0, pulse: 0 },
      strikeQuality: { normal: 0, clean: 0, perfect: 0, power: 0 },
      strikeWhiffs: 0,
      rebounds: 0,
      finRebounds: 0,
      touchMovement: 0,
      touchSamples: 0,
      longStalls: [],
      currentStall: 0,
      peakFieldHeat: { player: 0, bot: 0 },
      firstActionAt: null,
      controls: {
        joystickEngagements: 0,
        actionPresses: 0,
        radialOpens: 0,
        radialChanges: 0,
        centerReleases: 0,
        tapStrikes: 0,
        actionCancels: 0,
        powerFires: { rush: 0, bend: 0, grip: 0, pulse: 0 },
        powerDenied: { rush: 0, bend: 0, grip: 0, pulse: 0 },
      },
      frame: null,
    };
  }

  frame(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 250) return;
    this.frameTimes.push(milliseconds);
    if (this.frameTimes.length > 2400) this.frameTimes.shift();
  }

  touch(x, y) {
    if (!this.current) return;
    if (this.lastTouch) this.current.touchMovement += Math.hypot(x - this.lastTouch.x, y - this.lastTouch.y);
    this.lastTouch = { x, y };
    this.current.touchSamples += 1;
    if (this.current.firstActionAt === null) this.current.firstActionAt = this.current.duration;
  }

  control(type, power = null) {
    if (!this.current) return;
    if (this.current.firstActionAt === null) this.current.firstActionAt = this.current.duration;
    const controls = this.current.controls;
    if (type === "joystick-start") controls.joystickEngagements += 1;
    else if (type === "action-press") controls.actionPresses += 1;
    else if (type === "radial-open") controls.radialOpens += 1;
    else if (type === "radial-change") controls.radialChanges += 1;
    else if (type === "center-release") controls.centerReleases += 1;
    else if (type === "tap-strike") controls.tapStrikes += 1;
    else if (type === "action-cancel") controls.actionCancels += 1;
    else if (type === "power-fire" && power in controls.powerFires) controls.powerFires[power] += 1;
    else if (type === "power-denied" && power in controls.powerDenied) controls.powerDenied[power] += 1;
  }

  sample(dt, physics) {
    if (!this.current || !physics || dt <= 0) return;
    const speed = Math.hypot(physics.core.vx, physics.core.vy);
    this.current.duration += dt;
    this.current.maxCoreSpeed = Math.max(this.current.maxCoreSpeed, speed);
    this.current.averageCoreSpeed += speed;
    this.current.speedSamples += 1;
    if (physics.contention > 0.16) this.current.contentionSeconds += dt;
    if (physics.nodes.player.influence > 0.08) this.current.fieldSeconds.player += dt;
    if (physics.nodes.bot.influence > 0.08) this.current.fieldSeconds.bot += dt;
    this.current.peakFieldHeat.player = Math.max(this.current.peakFieldHeat.player, physics.nodes.player.fieldHeat || 0);
    this.current.peakFieldHeat.bot = Math.max(this.current.peakFieldHeat.bot, physics.nodes.bot.fieldHeat || 0);
    const stalled = physics.contention > 0.20 && speed < 96;
    if (stalled) {
      this.current.currentStall += dt;
      this.stallActive = true;
    } else if (this.stallActive) {
      if (this.current.currentStall >= 0.55) this.current.longStalls.push(Number(this.current.currentStall.toFixed(2)));
      this.current.currentStall = 0;
      this.stallActive = false;
    }
  }

  event(event) {
    if (!this.current || !event) return;
    if (event.type === "goal") {
      this.current.goals.push({
        owner: event.owner,
        matchTime: Number(this.current.duration.toFixed(2)),
        duelTime: Number((event.roundTime || 0).toFixed(2)),
        chain: event.chain || 0,
        lastTouch: event.lastTouch || null,
      });
    } else if (event.type === "sling") {
      if (event.owner === "player") {
        this.current.slingshots += 1;
        if (event.charge >= 0.68) this.current.chargedSlingshots += 1;
      }
    } else if (["intercept", "perfect", "clutch"].includes(event.type) && event.owner === "player") {
      this.current.intercepts += 1;
      if (event.perfect) this.current.perfectIntercepts += 1;
      if (event.defensive) this.current.saves += 1;
      if (event.clutch) this.current.clutchSaves += 1;
    } else if (event.type === "strike" && event.owner === "player") {
      this.current.strikes += 1;
      if (event.power in this.current.powerHits) this.current.powerHits[event.power] += 1;
      if (event.quality in this.current.strikeQuality) this.current.strikeQuality[event.quality] += 1;
    } else if (event.type === "strike-whiff" && event.owner === "player") {
      this.current.strikeWhiffs += 1;
    } else if (event.type === "rebound") {
      this.current.rebounds += 1;
      if (event.surface === "rift-fin") this.current.finRebounds += 1;
    }
  }

  finish(score) {
    if (!this.current) return null;
    if (this.stallActive && this.current.currentStall >= 0.55) this.current.longStalls.push(Number(this.current.currentStall.toFixed(2)));
    this.current.score = { ...score };
    this.current.averageCoreSpeed = this.current.speedSamples
      ? Math.round(this.current.averageCoreSpeed / this.current.speedSamples)
      : 0;
    this.current.maxCoreSpeed = Math.round(this.current.maxCoreSpeed);
    this.current.contentionRatio = Number((this.current.contentionSeconds / Math.max(this.current.duration, 0.001)).toFixed(3));
    this.current.touchMovement = Math.round(this.current.touchMovement);
    this.current.frame = {
      averageMs: Number((this.frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(this.frameTimes.length, 1)).toFixed(2)),
      p95Ms: Number(percentile(this.frameTimes, 0.95).toFixed(2)),
      p99Ms: Number(percentile(this.frameTimes, 0.99).toFixed(2)),
      over20ms: this.frameTimes.filter((value) => value > 20).length,
      samples: this.frameTimes.length,
    };
    delete this.current.currentStall;
    delete this.current.speedSamples;
    const completed = structuredClone(this.current);
    this.history.push(completed);
    this.history = this.history.slice(-12);
    safeStore(this.history);
    return completed;
  }

  snapshot() {
    return {
      storageKey: STORAGE_KEY,
      current: this.current ? structuredClone(this.current) : null,
      matches: structuredClone(this.history),
    };
  }

  clear() {
    this.history = [];
    this.current = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* no-op */ }
  }
}

export function telemetryHealth(record) {
  if (!record) return { score: 0, label: "NO MATCH" };
  let score = 100;
  score -= clamp((record.contentionRatio - 0.24) * 120, 0, 24);
  score -= clamp((Math.max(...(record.longStalls || [0])) - 1.8) * 8, 0, 18);
  score -= clamp(((record.frame?.p95Ms || 0) - 17) * 1.6, 0, 20);
  score -= record.duration > 135 ? 12 : 0;
  score -= record.duration < 35 ? 8 : 0;
  return { score: Math.round(score), label: score >= 86 ? "CLEAN" : score >= 70 ? "WATCH" : "REVIEW" };
}
