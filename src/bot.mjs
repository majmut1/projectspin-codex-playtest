import { ARENA, seededRandom } from "./physics.mjs";

export const BOT_STATES = Object.freeze({
  READ: "READ",
  DEFEND: "DEFEND",
  PRESSURE: "PRESSURE",
  ATTACK: "ATTACK",
  SCRAMBLE: "SCRAMBLE",
  RECOVER: "RECOVER",
});

export const BOT_PROFILE = Object.freeze({
  reaction: 0.142,
  decisionInterval: 0.082,
  predictionHorizon: 0.58,
  baseError: 11,
  fastError: 18,
  aggression: 0.62,
  recoveryDiscipline: 0.72,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function reflectArenaX(x) {
  let result = x;
  const left = ARENA.left + 13;
  const right = ARENA.right - 13;
  for (let pass = 0; pass < 3; pass += 1) {
    if (result < left) result = left + (left - result);
    if (result > right) result = right - (result - right);
  }
  return clamp(result, left, right);
}

export class RiftBot {
  constructor(seed = 9917) {
    this.random = seededRandom(seed);
    this.time = 0;
    this.decisionTimer = 0;
    this.state = BOT_STATES.READ;
    this.history = [];
    this.target = { x: 195, y: 170 };
    this.readConfidence = 0;
    this.overextended = 0;
    this.lastStateChange = 0;
  }

  reset() {
    this.time = 0;
    this.decisionTimer = 0;
    this.state = BOT_STATES.READ;
    this.history.length = 0;
    this.target = { x: 195, y: 170 };
    this.readConfidence = 0;
    this.overextended = 0;
    this.lastStateChange = 0;
  }

  update(dt, physics, context = {}) {
    this.time += dt;
    this.decisionTimer -= dt;
    const core = physics.core;
    this.history.push({
      time: this.time,
      x: core.x,
      y: core.y,
      vx: core.vx,
      vy: core.vy,
      speed: Math.hypot(core.vx, core.vy),
    });
    while (this.history.length > 2 && this.time - this.history[0].time > 1.15) this.history.shift();

    const observed = this.#observedCore();
    if (!observed) {
      physics.setNodeTarget("bot", this.target.x, this.target.y);
      return this.state;
    }

    if (this.decisionTimer <= 0) {
      this.decisionTimer = BOT_PROFILE.decisionInterval + this.random() * 0.040;
      const nextState = this.#chooseState(observed, physics, context);
      if (nextState !== this.state) {
        this.state = nextState;
        this.lastStateChange = this.time;
      }
      this.target = this.#chooseTarget(observed, physics, context);
    }

    const botNode = physics.nodes.bot;
    this.overextended = clamp((botNode.y - 214) / 144, 0, 1);
    const observationAge = Math.max(0, this.time - observed.time);
    this.readConfidence = clamp(1 - observationAge / 0.42 - observed.speed / 1450, 0.12, 0.96);
    physics.setNodeTarget("bot", this.target.x, this.target.y);
    return this.state;
  }

  #observedCore() {
    const variableReaction = BOT_PROFILE.reaction + (this.random() - 0.5) * 0.018;
    const targetTime = this.time - variableReaction;
    let observed = null;
    for (const sample of this.history) {
      if (sample.time <= targetTime) observed = sample;
      else break;
    }
    return observed ?? this.history[0] ?? null;
  }

  #chooseState(core, physics) {
    const botNode = physics.nodes.bot;
    const severeThreat = core.y < 164 && core.vy < -145;
    const incoming = core.y < 375 && core.vy < -28;
    const ballLeaving = core.vy > 70 && core.y > 365;
    if (severeThreat) return BOT_STATES.SCRAMBLE;
    if (incoming) return BOT_STATES.DEFEND;
    if (botNode.y > 298 && ballLeaving) return BOT_STATES.RECOVER;
    if (core.y >= 330 && core.y <= 520 && core.vy > 20) return BOT_STATES.ATTACK;
    if (core.y < 470 && Math.abs(core.vy) < 210) return BOT_STATES.PRESSURE;
    return BOT_STATES.READ;
  }

  #predict(core, horizon) {
    const t = clamp(horizon, 0, BOT_PROFILE.predictionHorizon);
    return {
      x: reflectArenaX(core.x + core.vx * t),
      y: core.y + core.vy * t,
    };
  }

  #chooseTarget(core, physics, context) {
    const zone = ARENA.botZone;
    const playerNode = physics.nodes.player;
    const speedFactor = clamp(core.speed / 720, 0, 1);
    const predictionTime = this.state === BOT_STATES.SCRAMBLE
      ? 0.17
      : this.state === BOT_STATES.DEFEND
        ? 0.29
        : this.state === BOT_STATES.ATTACK
          ? 0.20
          : 0.13;
    const predicted = this.#predict(core, predictionTime);
    const errorMagnitude = BOT_PROFILE.baseError + speedFactor * BOT_PROFILE.fastError;
    const error = (this.random() - 0.5) * errorMagnitude * 2;
    const openSide = playerNode.x < 195 ? 1 : -1;

    if (this.state === BOT_STATES.SCRAMBLE) {
      return {
        x: clamp(predicted.x + error * 0.65, zone.left, zone.right),
        y: clamp(predicted.y - 31, zone.top, 190),
      };
    }

    if (this.state === BOT_STATES.DEFEND) {
      const angleSetup = openSide * (22 + speedFactor * 15);
      return {
        x: clamp(predicted.x - angleSetup + error, zone.left, zone.right),
        y: clamp(predicted.y - 42, zone.top, 270),
      };
    }

    if (this.state === BOT_STATES.ATTACK) {
      const setupX = predicted.x - openSide * (30 + BOT_PROFILE.aggression * 18);
      return {
        x: clamp(setupX + error * 0.55, zone.left, zone.right),
        y: clamp(predicted.y - 48, 238, zone.bottom),
      };
    }

    if (this.state === BOT_STATES.PRESSURE) {
      const feint = Math.sin(this.time * 4.1) * 24;
      return {
        x: clamp(predicted.x - openSide * 24 + feint + error * 0.45, zone.left, zone.right),
        y: clamp(predicted.y - 56, 225, zone.bottom),
      };
    }

    if (this.state === BOT_STATES.RECOVER) {
      return {
        x: 195 + clamp((core.x - 195) * 0.18, -26, 26),
        y: 166,
      };
    }

    const scorePressure = context.matchPoint ? 0.08 : 0;
    return {
      x: 195 + clamp((predicted.x - 195) * (0.24 + scorePressure), -54, 54),
      y: 170,
    };
  }
}
