import { ARENA, seededRandom } from "./physics.mjs";

export const BOT_STATES = Object.freeze({
  PROBE: "PROBE",
  PRESS: "PRESS",
  TRAP: "TRAP",
  COUNTER: "COUNTER",
  SCRAMBLE: "SCRAMBLE",
});

export const BOT_PROFILES = Object.freeze({
  sparring: Object.freeze({ reaction: 0.205, decisionInterval: 0.105, predictionHorizon: 0.44, baseError: 18, fastError: 28, aggression: 0.46, risk: 0.38, movementPrecision: 0.78 }),
  wraith: Object.freeze({ reaction: 0.148, decisionInterval: 0.082, predictionHorizon: 0.58, baseError: 11, fastError: 20, aggression: 0.71, risk: 0.65, movementPrecision: 0.93 }),
  apex: Object.freeze({ reaction: 0.112, decisionInterval: 0.066, predictionHorizon: 0.66, baseError: 7, fastError: 14, aggression: 0.78, risk: 0.70, movementPrecision: 0.97 }),
});

export const BOT_PROFILE = BOT_PROFILES.wraith;

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
  constructor(seed = 9917, profile = "wraith") {
    this.random = seededRandom(seed);
    this.profileName = BOT_PROFILES[profile] ? profile : "wraith";
    this.profile = BOT_PROFILES[this.profileName];
    this.time = 0;
    this.decisionTimer = 0;
    this.state = BOT_STATES.PROBE;
    this.history = [];
    this.target = { x: 195, y: 170 };
    this.readConfidence = 0;
    this.overextended = 0;
    this.lastStateChange = 0;
    this.intent = { x: 195, y: 240, strength: 0 };
    this.actionTimer = 0;
    this.pendingAction = null;
    this.queuedAction = null;
    this.telegraphTimer = 0;
    this.telegraphPower = null;
  }

  reset() {
    this.time = 0;
    this.decisionTimer = 0;
    this.state = BOT_STATES.PROBE;
    this.history.length = 0;
    this.target = { x: 195, y: 170 };
    this.readConfidence = 0;
    this.overextended = 0;
    this.lastStateChange = 0;
    this.intent = { x: 195, y: 240, strength: 0 };
    this.actionTimer = 0;
    this.pendingAction = null;
    this.queuedAction = null;
    this.telegraphTimer = 0;
    this.telegraphPower = null;
  }

  update(dt, physics, context = {}) {
    this.time += dt;
    this.decisionTimer -= dt;
    this.actionTimer = Math.max(0, this.actionTimer - dt);
    if (this.queuedAction) {
      this.telegraphTimer = Math.max(0, this.telegraphTimer - dt);
      if (this.telegraphTimer <= 0 && !this.pendingAction) {
        this.pendingAction = this.queuedAction;
        this.queuedAction = null;
        this.telegraphPower = null;
      }
    }
    const core = physics.core;
    this.history.push({ time: this.time, x: core.x, y: core.y, vx: core.vx, vy: core.vy, speed: Math.hypot(core.vx, core.vy) });
    while (this.history.length > 2 && this.time - this.history[0].time > 1.25) this.history.shift();

    const observed = this.#observedCore();
    if (!observed) {
      physics.setNodeTarget("bot", this.target.x, this.target.y);
      return this.state;
    }

    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.profile.decisionInterval + this.random() * 0.042;
      const nextState = this.#chooseState(observed, physics, context);
      if (nextState !== this.state) {
        this.state = nextState;
        this.lastStateChange = this.time;
      }
      this.target = this.#chooseTarget(observed, physics, context);
      this.#considerAction(observed, physics, context);
    }

    const botNode = physics.nodes.bot;
    this.overextended = clamp((botNode.y - 214) / 144, 0, 1);
    const observationAge = Math.max(0, this.time - observed.time);
    this.readConfidence = clamp(1 - observationAge / 0.46 - observed.speed / 1500, 0.10, 0.96);
    this.intent.x = this.target.x;
    this.intent.y = this.target.y;
    this.intent.strength = clamp(0.35 + this.readConfidence * 0.45 + (this.state === BOT_STATES.SCRAMBLE ? 0.2 : 0), 0, 1);
    physics.nodes.bot.telegraphPower = this.telegraphPower;
    physics.nodes.bot.telegraphStrength = this.telegraphPower
      ? clamp(1 - this.telegraphTimer / 0.24, 0.18, 1)
      : 0;
    physics.setNodeTarget("bot", this.target.x, this.target.y);
    return this.state;
  }

  consumeAction() {
    const action = this.pendingAction;
    this.pendingAction = null;
    return action;
  }

  #considerAction(core, physics, context) {
    if (this.actionTimer > 0 || this.pendingAction || this.queuedAction) return;
    const node = physics.nodes.bot;
    const observedDistance = Math.hypot(core.x - node.x, core.y - node.y);
    const tacticalReach = this.state === BOT_STATES.SCRAMBLE ? 138 : 110;
    if (observedDistance > tacticalReach) return;

    const incoming = core.vy < -28;
    const attackable = core.y > 125 && core.y < 420;
    const urgency = this.state === BOT_STATES.SCRAMBLE || this.state === BOT_STATES.COUNTER;
    if (!urgency && !incoming && !attackable) return;

    const riskRoll = this.random();
    const centralLane = Math.abs(core.x - 195) < 60;
    const fastIncoming = core.vy < -210;
    let power = null;
    if (context.botFlux >= 40 && this.state === BOT_STATES.SCRAMBLE && riskRoll < 0.78) power = "pulse";
    else if (context.botFlux >= 30 && this.state === BOT_STATES.TRAP && Math.abs(core.vy) < 235 && riskRoll < 0.68) power = "grip";
    else if (context.botFlux >= 34 && this.state === BOT_STATES.COUNTER && !centralLane && riskRoll < 0.62) power = "bend";
    else if (context.botFlux >= 40 && this.state === BOT_STATES.COUNTER && fastIncoming && riskRoll < 0.72) power = "pulse";
    else if (context.botFlux >= 48 && this.state === BOT_STATES.PRESS && centralLane && riskRoll < this.profile.risk * 0.76) power = "rush";
    else if (context.botFlux >= 34 && this.state === BOT_STATES.PRESS && !centralLane && riskRoll < this.profile.risk * 0.58) power = "bend";

    const timingError = (this.random() - 0.5) * (0.065 + (1 - this.profile.movementPrecision) * 0.12);
    this.actionTimer = clamp(0.60 + timingError, 0.46, 0.86);
    const action = { type: "strike", power, observedDistance, state: this.state };
    if (power) {
      this.queuedAction = action;
      this.telegraphPower = power;
      this.telegraphTimer = power === "rush" ? 0.24 : power === "pulse" ? 0.19 : 0.15;
    } else {
      this.pendingAction = action;
    }
  }

  #observedCore() {
    const variableReaction = this.profile.reaction + (this.random() - 0.5) * 0.022;
    const targetTime = this.time - variableReaction;
    let observed = null;
    for (const sample of this.history) {
      if (sample.time <= targetTime) observed = sample;
      else break;
    }
    return observed ?? this.history[0] ?? null;
  }

  #chooseState(core, physics, context) {
    const botNode = physics.nodes.bot;
    const severeThreat = core.y < 170 && core.vy < -138;
    const incoming = core.y < 390 && core.vy < -34;
    const attackWindow = core.y > 352 && core.y < 590 && core.vy > -18;
    const trapWindow = core.y > 235 && core.y < 465 && Math.abs(core.vy) < 215;
    if (severeThreat) return BOT_STATES.SCRAMBLE;
    if (incoming) return BOT_STATES.COUNTER;
    if (botNode.y > 306 && core.vy > 130) return BOT_STATES.PROBE;
    if (attackWindow && (context.matchPoint || this.random() < this.profile.aggression)) return BOT_STATES.PRESS;
    if (trapWindow) return BOT_STATES.TRAP;
    return BOT_STATES.PROBE;
  }

  #predict(core, horizon) {
    const t = clamp(horizon, 0, this.profile.predictionHorizon);
    return { x: reflectArenaX(core.x + core.vx * t), y: core.y + core.vy * t };
  }

  #chooseTarget(core, physics, context) {
    const zone = ARENA.botZone;
    const playerNode = physics.nodes.player;
    const speedFactor = clamp(core.speed / 760, 0, 1);
    const predictionTime = this.state === BOT_STATES.SCRAMBLE
      ? 0.17
      : this.state === BOT_STATES.COUNTER
        ? 0.30
        : this.state === BOT_STATES.PRESS
          ? 0.22
          : this.state === BOT_STATES.TRAP ? 0.16 : 0.12;
    const predicted = this.#predict(core, predictionTime);
    const errorMagnitude = (this.profile.baseError + speedFactor * this.profile.fastError) * (2 - this.profile.movementPrecision);
    const errorX = (this.random() - 0.5) * errorMagnitude * 2;
    const errorY = (this.random() - 0.5) * errorMagnitude * 0.72;
    const openSide = playerNode.x < 195 ? 1 : -1;

    if (this.state === BOT_STATES.SCRAMBLE) {
      return { x: clamp(predicted.x + errorX * 0.52, zone.left, zone.right), y: clamp(predicted.y - 27 + errorY, zone.top, 190) };
    }
    if (this.state === BOT_STATES.COUNTER) {
      const angleSetup = openSide * (21 + speedFactor * 18);
      return { x: clamp(predicted.x - angleSetup + errorX, zone.left, zone.right), y: clamp(predicted.y - 39 + errorY, zone.top, 278) };
    }
    if (this.state === BOT_STATES.PRESS) {
      const attackSide = openSide * (33 + this.profile.risk * 24);
      return { x: clamp(predicted.x - attackSide + errorX * 0.48, zone.left, zone.right), y: clamp(predicted.y - 46 + errorY, 240, zone.bottom) };
    }
    if (this.state === BOT_STATES.TRAP) {
      const orbit = Math.sin(this.time * 4.25) * (27 + this.profile.aggression * 15);
      const bias = context.matchPoint ? openSide * 12 : 0;
      return {
        x: clamp(predicted.x + orbit - openSide * 16 + bias + errorX * 0.40, zone.left, zone.right),
        y: clamp(predicted.y - 55 + Math.cos(this.time * 3.1) * 14 + errorY, 214, zone.bottom),
      };
    }
    return {
      x: 195 + clamp((predicted.x - 195) * 0.27 + Math.sin(this.time * 1.9) * 12, -62, 62),
      y: 166 + Math.sin(this.time * 1.25) * 9,
    };
  }
}
