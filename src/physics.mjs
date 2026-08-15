export const REFERENCE_WIDTH = 390;
export const REFERENCE_HEIGHT = 844;

export const PHYSICS_MODES = Object.freeze({
  FIELD: "field",
  TRANSFER: "transfer",
  TETHER: "tether",
});

export const CANDIDATE_CONFIGS = Object.freeze({
  [PHYSICS_MODES.FIELD]: Object.freeze({
    label: "FIELD",
    fieldRadius: 174,
    fieldStrength: 920,
    fieldExponent: 1.75,
    movingFieldBonus: 0.08,
    continuousTransfer: 0.0,
    contactTransfer: 0.08,
    contactRestitution: 0.74,
    releaseTransfer: 0.0,
    releaseKick: 0,
    coreDamping: 0.9970,
    baseSpeedCap: 500,
  }),
  [PHYSICS_MODES.TRANSFER]: Object.freeze({
    label: "TRANSFER",
    fieldRadius: 162,
    fieldStrength: 710,
    fieldExponent: 1.90,
    movingFieldBonus: 0.24,
    continuousTransfer: 0.11,
    contactTransfer: 0.36,
    contactRestitution: 0.78,
    releaseTransfer: 0.0,
    releaseKick: 0,
    coreDamping: 0.9977,
    baseSpeedCap: 585,
  }),
  [PHYSICS_MODES.TETHER]: Object.freeze({
    label: "TETHER-SLING",
    fieldRadius: 178,
    fieldStrength: 735,
    fieldExponent: 2.05,
    movingFieldBonus: 0.34,
    continuousTransfer: 0.075,
    contactTransfer: 0.43,
    contactRestitution: 0.82,
    releaseTransfer: 0.20,
    releaseKick: 86,
    coreDamping: 0.9982,
    baseSpeedCap: 620,
  }),
});

export const ARENA = Object.freeze({
  left: 21,
  right: 369,
  topWall: 66,
  bottomWall: 788,
  goalHalfWidth: 61,
  topReactorY: 54,
  bottomReactorY: 800,
  playerZone: Object.freeze({ left: 42, right: 348, top: 486, bottom: 740 }),
  botZone: Object.freeze({ left: 42, right: 348, top: 104, bottom: 358 }),
});

const CORE_RADIUS = 12.5;
const NODE_RADIUS = 25;
const CONTACT_RADIUS = CORE_RADIUS + NODE_RADIUS;
const CLOSE_RADIUS = 70;
const RELEASE_RADIUS = 96;
const RAIL_RADIUS = 7;
const EPSILON = 0.00001;

export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function length(x, y) {
  return Math.hypot(x, y);
}

function normalized(x, y) {
  const magnitude = Math.max(length(x, y), EPSILON);
  return { x: x / magnitude, y: y / magnitude };
}

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function moveToward(current, target, maximumDelta) {
  if (Math.abs(target - current) <= maximumDelta) return target;
  return current + Math.sign(target - current) * maximumDelta;
}

function reflect(vx, vy, nx, ny, restitution = 1) {
  const incoming = dot(vx, vy, nx, ny);
  return {
    x: vx - (1 + restitution) * incoming * nx,
    y: vy - (1 + restitution) * incoming * ny,
  };
}

function railClosestPoint(px, py, rail) {
  const abx = rail.bx - rail.ax;
  const aby = rail.by - rail.ay;
  const denominator = abx * abx + aby * aby;
  const t = denominator <= EPSILON
    ? 0
    : clamp(((px - rail.ax) * abx + (py - rail.ay) * aby) / denominator, 0, 1);
  return { x: rail.ax + abx * t, y: rail.ay + aby * t };
}

export class RiftPhysics {
  constructor({ mode = PHYSICS_MODES.TETHER, seed = 7127 } = {}) {
    if (!CANDIDATE_CONFIGS[mode]) throw new Error(`Unknown RIFTBALL physics mode: ${mode}`);
    this.mode = mode;
    this.config = CANDIDATE_CONFIGS[mode];
    this.random = seededRandom(seed);
    this.time = 0;
    this.roundTime = 0;
    this.pressure = 0;
    this.duelSurge = 0;
    this.overtimeOpen = 0;
    this.surgeAnnounced = false;
    this.lastTouch = null;
    this.sameSideChain = 0;
    this.rallyContacts = 0;
    this.lastMotionAngle = -Math.PI / 2;
    this.totalGoals = 0;
    this.matchPoint = false;
    this.frozen = false;
    this.events = [];
    this.railsActive = false;
    this.rails = [
      { ax: 83, ay: 402, bx: 143, by: 442, side: "left" },
      { ax: 247, ay: 442, bx: 307, by: 402, side: "right" },
    ];
    this.core = { x: 195, y: 422, vx: 0, vy: 0, radius: CORE_RADIUS, rotation: 0 };
    this.nodes = {
      player: this.#makeNode("player", 195, 690),
      bot: this.#makeNode("bot", 195, 170),
    };
    this.resetRound("neutral");
  }

  #makeNode(owner, x, y) {
    return {
      owner,
      x,
      y,
      previousX: x,
      previousY: y,
      targetX: x,
      targetY: y,
      vx: 0,
      vy: 0,
      radius: NODE_RADIUS,
      contactCooldown: 0,
      contactArmed: true,
      tetherActive: false,
      tetherCharge: 0,
      tetherCooldown: 0,
      closestDistance: Infinity,
      influence: 0,
      fieldAngle: 0,
    };
  }

  setScoreContext(totalGoals, matchPoint = false) {
    this.totalGoals = totalGoals;
    this.matchPoint = matchPoint;
    this.railsActive = totalGoals >= 2 && !matchPoint;
  }

  setNodeTarget(owner, x, y) {
    const node = this.nodes[owner];
    if (!node) return;
    const zone = owner === "player" ? ARENA.playerZone : ARENA.botZone;
    node.targetX = clamp(x, zone.left, zone.right);
    node.targetY = clamp(y, zone.top, zone.bottom);
  }

  resetRound(direction = "neutral") {
    this.frozen = false;
    this.roundTime = 0;
    this.pressure = 0;
    this.duelSurge = 0;
    this.overtimeOpen = 0;
    this.surgeAnnounced = false;
    this.lastTouch = null;
    this.sameSideChain = 0;
    this.rallyContacts = 0;
    this.events.length = 0;
    this.core.x = 195;
    this.core.y = 422;
    const lane = (this.random() - 0.5) * 0.38;
    const vertical = direction === "player" ? 1 : direction === "bot" ? -1 : (this.random() < 0.5 ? -1 : 1);
    this.core.vx = lane * 120;
    this.core.vy = vertical * 112;
    this.core.rotation = 0;
    this.lastMotionAngle = Math.atan2(this.core.vy, this.core.vx);
    this.#resetNode(this.nodes.player, 195, 686);
    this.#resetNode(this.nodes.bot, 195, 170);
  }

  #resetNode(node, x, y) {
    node.x = x;
    node.y = y;
    node.previousX = x;
    node.previousY = y;
    node.targetX = x;
    node.targetY = y;
    node.vx = 0;
    node.vy = 0;
    node.contactCooldown = 0;
    node.contactArmed = true;
    node.tetherActive = false;
    node.tetherCharge = 0;
    node.tetherCooldown = 0;
    node.closestDistance = Infinity;
    node.influence = 0;
  }

  launch(direction = "neutral", speed = 176) {
    const sign = direction === "player" ? 1 : direction === "bot" ? -1 : (this.random() < 0.5 ? -1 : 1);
    const angle = (this.random() - 0.5) * 0.44;
    this.core.vx = Math.sin(angle) * speed;
    this.core.vy = Math.cos(angle) * speed * sign;
    this.lastMotionAngle = Math.atan2(this.core.vy, this.core.vx);
    this.events.push({ type: "launch", direction, speed });
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return [];
    dt = Math.min(dt, 1 / 30);
    this.events = [];
    this.time += dt;
    if (this.frozen) return this.events;
    this.roundTime += dt;

    this.#updateNode(this.nodes.player, dt, true);
    this.#updateNode(this.nodes.bot, dt, false);
    this.#applyNodeField(this.nodes.player, dt);
    this.#applyNodeField(this.nodes.bot, dt);

    const damping = Math.pow(this.config.coreDamping, dt * 60);
    this.core.vx *= damping;
    this.core.vy *= damping;
    this.pressure = Math.max(0, this.pressure - dt * 0.006);
    const longDuelPressure = clamp((this.roundTime - 7) / 20, 0, 0.90);
    this.duelSurge = longDuelPressure;
    this.overtimeOpen = clamp((this.roundTime - 28) / 12, 0, 1);
    this.pressure = Math.max(this.pressure, longDuelPressure);
    if (!this.surgeAnnounced && this.duelSurge >= 0.58) {
      this.surgeAnnounced = true;
      this.events.push({ type: "surge", strength: this.duelSurge });
    }

    const speedCap = this.config.baseSpeedCap + this.pressure * 260 + (this.matchPoint ? 26 : 0);
    this.#clampCoreSpeed(speedCap);
    let currentSpeed = length(this.core.vx, this.core.vy);
    const minimumPace = this.roundTime > 7 ? 105 + longDuelPressure * 330 : 0;
    if (minimumPace > 0 && currentSpeed < minimumPace) {
      if (currentSpeed > 12) this.lastMotionAngle = Math.atan2(this.core.vy, this.core.vx);
      const restoredSpeed = Math.min(minimumPace, currentSpeed + dt * 420);
      this.core.vx = Math.cos(this.lastMotionAngle) * restoredSpeed;
      this.core.vy = Math.sin(this.lastMotionAngle) * restoredSpeed;
      currentSpeed = restoredSpeed;
    }
    if (currentSpeed > 38) this.lastMotionAngle = Math.atan2(this.core.vy, this.core.vx);

    this.core.x += this.core.vx * dt;
    this.core.y += this.core.vy * dt;
    this.core.rotation += currentSpeed * dt * 0.010;

    this.#resolveNodeContact(this.nodes.player);
    this.#resolveNodeContact(this.nodes.bot);
    if (this.railsActive) {
      for (const rail of this.rails) this.#resolveRail(rail);
    }
    this.#resolveArena();
    this.#clampCoreSpeed(speedCap);
    return this.events;
  }

  #clampCoreSpeed(speedCap) {
    const currentSpeed = length(this.core.vx, this.core.vy);
    if (currentSpeed <= speedCap || currentSpeed <= EPSILON) return;
    const scale = speedCap / currentSpeed;
    this.core.vx *= scale;
    this.core.vy *= scale;
  }

  #updateNode(node, dt, isPlayer) {
    const zone = isPlayer ? ARENA.playerZone : ARENA.botZone;
    node.previousX = node.x;
    node.previousY = node.y;
    node.contactCooldown = Math.max(0, node.contactCooldown - dt);
    node.tetherCooldown = Math.max(0, node.tetherCooldown - dt);

    const dx = node.targetX - node.x;
    const dy = node.targetY - node.y;
    const distance = length(dx, dy);
    const maxSpeed = isPlayer ? 900 : 640;
    const acceleration = isPlayer ? 6500 : 3600;
    const desiredSpeed = Math.min(maxSpeed, distance * (isPlayer ? 16 : 7.5));
    const direction = distance > EPSILON ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 };
    const desiredVx = direction.x * desiredSpeed;
    const desiredVy = direction.y * desiredSpeed;
    node.vx = moveToward(node.vx, desiredVx, acceleration * dt);
    node.vy = moveToward(node.vy, desiredVy, acceleration * dt);
    node.x = clamp(node.x + node.vx * dt, zone.left, zone.right);
    node.y = clamp(node.y + node.vy * dt, zone.top, zone.bottom);
    if (node.x === zone.left || node.x === zone.right) node.vx *= 0.45;
    if (node.y === zone.top || node.y === zone.bottom) node.vy *= 0.45;
    node.fieldAngle += dt * (1.7 + Math.min(length(node.vx, node.vy) / 260, 2.4));
  }

  #applyNodeField(node, dt) {
    const dx = node.x - this.core.x;
    const dy = node.y - this.core.y;
    const distance = Math.max(length(dx, dy), 1);
    const falloff = clamp(1 - distance / this.config.fieldRadius, 0, 1);
    const nodeSpeed = length(node.vx, node.vy);
    node.influence = falloff;
    if (falloff <= 0) {
      this.#releaseTetherIfReady(node, distance);
      return;
    }

    const direction = { x: dx / distance, y: dy / distance };
    const movingBonus = 1 + Math.min(nodeSpeed / 650, 1) * this.config.movingFieldBonus;
    const force = this.config.fieldStrength * Math.pow(falloff, this.config.fieldExponent) * movingBonus;
    this.core.vx += direction.x * force * dt;
    this.core.vy += direction.y * force * dt;

    if (this.config.continuousTransfer > 0) {
      const transfer = this.config.continuousTransfer * falloff * falloff * dt * 4.2;
      this.core.vx += node.vx * transfer;
      this.core.vy += node.vy * transfer;
    }

    if (this.mode === PHYSICS_MODES.TETHER && node.tetherCooldown <= 0 && nodeSpeed > 72 && distance < CLOSE_RADIUS) {
      const radial = normalized(this.core.x - node.x, this.core.y - node.y);
      const tangentSpeed = Math.abs(cross(radial.x, radial.y, node.vx, node.vy));
      const approach = Math.max(0, dot(node.vx, node.vy, radial.x, radial.y));
      node.tetherActive = true;
      node.closestDistance = Math.min(node.closestDistance, distance);
      node.tetherCharge = Math.max(node.tetherCharge, clamp(
        (1 - distance / CLOSE_RADIUS) * 0.20 + tangentSpeed / 710 + approach / 1900,
        0,
        1,
      ));
    } else {
      this.#releaseTetherIfReady(node, distance);
    }

    if (falloff > 0.16) {
      this.events.push({ type: "field", owner: node.owner, strength: falloff, distance });
    }
  }

  #releaseTetherIfReady(node, distance) {
    if (!node.tetherActive || distance <= RELEASE_RADIUS) return;
    const charge = node.tetherCharge;
    if (charge >= 0.30) {
      const radial = normalized(this.core.x - node.x, this.core.y - node.y);
      const nodeSpeed = length(node.vx, node.vy);
      let tangentSign = Math.sign(cross(radial.x, radial.y, node.vx, node.vy));
      if (tangentSign === 0) tangentSign = node.owner === "player" ? -1 : 1;
      const tangent = { x: -radial.y * tangentSign, y: radial.x * tangentSign };
      this.core.vx += node.vx * this.config.releaseTransfer * charge + tangent.x * this.config.releaseKick * charge;
      this.core.vy += node.vy * this.config.releaseTransfer * charge + tangent.y * this.config.releaseKick * charge;
      this.pressure = clamp(this.pressure + 0.10 + charge * 0.12, 0, 1);
      this.events.push({ type: "sling", owner: node.owner, charge, nodeSpeed });
      node.tetherCooldown = 0.62;
    }
    node.tetherActive = false;
    node.tetherCharge = 0;
    node.closestDistance = Infinity;
  }

  #resolveNodeContact(node) {
    const dx = this.core.x - node.x;
    const dy = this.core.y - node.y;
    const distance = Math.max(length(dx, dy), EPSILON);
    if (distance >= CONTACT_RADIUS) {
      if (distance > CONTACT_RADIUS + 11) node.contactArmed = true;
      return;
    }

    const contactY = this.core.y;
    const normal = { x: dx / distance, y: dy / distance };
    const overlap = CONTACT_RADIUS - distance;
    this.core.x += normal.x * overlap;
    this.core.y += normal.y * overlap;

    const incomingVx = this.core.vx;
    const incomingVy = this.core.vy;
    const relativeVx = this.core.vx - node.vx;
    const relativeVy = this.core.vy - node.vy;
    const intoSurface = dot(relativeVx, relativeVy, normal.x, normal.y);
    if (intoSurface < 0) {
      const bounced = reflect(relativeVx, relativeVy, normal.x, normal.y, this.config.contactRestitution);
      this.core.vx = bounced.x + node.vx * this.config.contactTransfer;
      this.core.vy = bounced.y + node.vy * this.config.contactTransfer;
    } else {
      this.core.vx += normal.x * 42;
      this.core.vy += normal.y * 42;
    }

    if (!node.contactArmed || node.contactCooldown > 0) return;
    node.contactArmed = false;
    node.contactCooldown = 0.17;
    const nodeSpeed = length(node.vx, node.vy);
    const approachAlignment = nodeSpeed > 1 ? dot(node.vx / nodeSpeed, node.vy / nodeSpeed, normal.x, normal.y) : 0;
    const approachSpeed = Math.max(0, -dot(incomingVx - node.vx, incomingVy - node.vy, normal.x, normal.y));
    const defensiveDanger = node.owner === "player"
      ? contactY > 650 && incomingVy > 65
      : contactY < 194 && incomingVy < -65;
    const clutchZone = node.owner === "player" ? contactY > 690 : contactY < 154;
    const reversedThreat = node.owner === "player" ? this.core.vy < -55 : this.core.vy > 55;
    const defensive = defensiveDanger && reversedThreat;
    const clutch = defensive && clutchZone;
    const perfect = nodeSpeed > 360 && approachAlignment > 0.80 && approachSpeed > 250;

    this.rallyContacts += 1;
    if (perfect) this.pressure = clamp(this.pressure + 0.17 + Math.min(this.rallyContacts * 0.004, 0.04), 0, 1);
    else this.pressure = clamp(this.pressure + 0.08 + Math.min(this.rallyContacts * 0.003, 0.03), 0, 1);
    const contactSpeed = length(this.core.vx, this.core.vy);
    const earnedFloor = 205 + this.pressure * 180 + (perfect ? 54 : 0);
    if (contactSpeed > EPSILON && contactSpeed < earnedFloor) {
      const scale = earnedFloor / contactSpeed;
      this.core.vx *= scale;
      this.core.vy *= scale;
    }

    if (this.lastTouch === node.owner) this.sameSideChain += 1;
    else this.sameSideChain = 1;
    this.lastTouch = node.owner;
    this.events.push({
      type: clutch ? "clutch" : perfect ? "perfect" : "intercept",
      owner: node.owner,
      perfect,
      defensive,
      clutch,
      speed: length(this.core.vx, this.core.vy),
      chain: this.rallyContacts,
    });
  }

  #resolveRail(rail) {
    const closest = railClosestPoint(this.core.x, this.core.y, rail);
    const dx = this.core.x - closest.x;
    const dy = this.core.y - closest.y;
    const distance = Math.max(length(dx, dy), EPSILON);
    const collisionDistance = CORE_RADIUS + RAIL_RADIUS;
    if (distance >= collisionDistance) return;
    const normal = { x: dx / distance, y: dy / distance };
    const incoming = dot(this.core.vx, this.core.vy, normal.x, normal.y);
    this.core.x += normal.x * (collisionDistance - distance);
    this.core.y += normal.y * (collisionDistance - distance);
    if (incoming < 0) {
      const result = reflect(this.core.vx, this.core.vy, normal.x, normal.y, 0.91);
      this.core.vx = result.x;
      this.core.vy = result.y;
      this.pressure = clamp(this.pressure + 0.035, 0, 1);
      this.events.push({ type: "rebound", surface: "rift-fin", side: rail.side, speed: length(result.x, result.y) });
    }
  }

  #resolveArena() {
    if (this.core.x - CORE_RADIUS < ARENA.left) {
      this.core.x = ARENA.left + CORE_RADIUS;
      if (this.core.vx < 0) this.core.vx = Math.abs(this.core.vx) * 0.92;
      this.events.push({ type: "rebound", surface: "left-wall", speed: length(this.core.vx, this.core.vy) });
    } else if (this.core.x + CORE_RADIUS > ARENA.right) {
      this.core.x = ARENA.right - CORE_RADIUS;
      if (this.core.vx > 0) this.core.vx = -Math.abs(this.core.vx) * 0.92;
      this.events.push({ type: "rebound", surface: "right-wall", speed: length(this.core.vx, this.core.vy) });
    }

    const liveGoalHalfWidth = ARENA.goalHalfWidth + this.duelSurge * 14 + this.overtimeOpen * 18;
    const inMouth = Math.abs(this.core.x - REFERENCE_WIDTH / 2) <= liveGoalHalfWidth;
    if (inMouth && this.core.y <= ARENA.topReactorY) {
      this.#score("player");
      return;
    }
    if (inMouth && this.core.y >= ARENA.bottomReactorY) {
      this.#score("bot");
      return;
    }

    if (this.core.y - CORE_RADIUS < ARENA.topWall && !inMouth) {
      this.core.y = ARENA.topWall + CORE_RADIUS;
      if (this.core.vy < 0) this.core.vy = Math.abs(this.core.vy) * 0.91;
      this.events.push({ type: "rebound", surface: "top-rail", speed: length(this.core.vx, this.core.vy) });
    } else if (this.core.y + CORE_RADIUS > ARENA.bottomWall && !inMouth) {
      this.core.y = ARENA.bottomWall - CORE_RADIUS;
      if (this.core.vy > 0) this.core.vy = -Math.abs(this.core.vy) * 0.91;
      this.events.push({ type: "rebound", surface: "bottom-rail", speed: length(this.core.vx, this.core.vy) });
    }
  }

  #score(owner) {
    this.frozen = true;
    this.core.vx = 0;
    this.core.vy = 0;
    this.events.push({
      type: "goal",
      owner,
      roundTime: this.roundTime,
      lastTouch: this.lastTouch,
      pressure: this.pressure,
      duelSurge: this.duelSurge,
      overtimeOpen: this.overtimeOpen,
      chain: this.rallyContacts,
    });
  }

  snapshot() {
    return {
      mode: this.mode,
      time: this.time,
      roundTime: this.roundTime,
      pressure: this.pressure,
      railsActive: this.railsActive,
      matchPoint: this.matchPoint,
      core: { ...this.core },
      nodes: {
        player: { ...this.nodes.player },
        bot: { ...this.nodes.bot },
      },
    };
  }
}

export const RIFTBALL_CONSTANTS = Object.freeze({
  CORE_RADIUS,
  NODE_RADIUS,
  CONTACT_RADIUS,
  CLOSE_RADIUS,
  RELEASE_RADIUS,
});
