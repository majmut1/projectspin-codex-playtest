// The simulation keeps the proven portrait-era world axes internally while the
// camera presents that field horizontally. This separates competitive physics
// from the landscape screen and keeps every touch/control mapping explicit.
export const WORLD_WIDTH = 390;
export const WORLD_HEIGHT = 844;
export const REFERENCE_WIDTH = 844;
export const REFERENCE_HEIGHT = 390;

export const PHYSICS_MODES = Object.freeze({
  TETHER: "tether",
  DRIVE: "drive",
  COUNTER: "counter",
});

export const CANDIDATE_CONFIGS = Object.freeze({
  [PHYSICS_MODES.TETHER]: Object.freeze({
    label: "TETHER BASELINE",
    fieldRadius: 178,
    fieldStrength: 735,
    fieldExponent: 2.05,
    movingFieldBonus: 0.34,
    stationaryAuthority: 1,
    contestBias: 0,
    contestInstability: 0,
    heatPenalty: 0,
    momentumPriority: 0,
    continuousTransfer: 0.075,
    contactTransfer: 0.43,
    contactRestitution: 0.82,
    releaseTransfer: 0.20,
    releaseKick: 86,
    coreDamping: 0.9982,
    baseSpeedCap: 620,
  }),
  [PHYSICS_MODES.DRIVE]: Object.freeze({
    label: "DRIVE-SLING",
    fieldRadius: 176,
    fieldStrength: 748,
    fieldExponent: 2.02,
    movingFieldBonus: 0.52,
    stationaryAuthority: 0.34,
    contestBias: 0.58,
    contestInstability: 108,
    heatPenalty: 0.48,
    momentumPriority: 0.16,
    continuousTransfer: 0.090,
    contactTransfer: 0.47,
    contactRestitution: 0.84,
    releaseTransfer: 0.25,
    releaseKick: 112,
    coreDamping: 0.99835,
    baseSpeedCap: 644,
  }),
  [PHYSICS_MODES.COUNTER]: Object.freeze({
    label: "COUNTER-SLING",
    fieldRadius: 170,
    fieldStrength: 748,
    fieldExponent: 2.14,
    movingFieldBonus: 0.44,
    stationaryAuthority: 0.46,
    contestBias: 0.74,
    contestInstability: 152,
    heatPenalty: 0.34,
    momentumPriority: 0.44,
    continuousTransfer: 0.065,
    contactTransfer: 0.56,
    contactRestitution: 0.88,
    releaseTransfer: 0.22,
    releaseKick: 104,
    coreDamping: 0.9985,
    baseSpeedCap: 650,
  }),
});

export const ARENA = Object.freeze({
  left: 21,
  right: 369,
  topWall: 66,
  bottomWall: 788,
  goalHalfWidth: 68,
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
const STRIKE_REACH = 118;
const PULSE_REACH = 164;
const GRIP_REACH = 124;
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
    this.breakAnnounced = false;
    this.contention = 0;
    this.contestDominance = 0;
    this.contestedSeconds = 0;
    this.stallSeconds = 0;
    this.longestStall = 0;
    this.currentStall = 0;
    this.lastTouch = null;
    this.sameSideChain = 0;
    this.rallyContacts = 0;
    this.lastMotionAngle = -Math.PI / 2;
    this.totalGoals = 0;
    this.matchPoint = false;
    this.frozen = false;
    this.events = [];
    this.queuedEvents = [];
    this.railsActive = false;
    this.rails = [
      { ax: 83, ay: 402, bx: 143, by: 442, side: "left" },
      { ax: 247, ay: 442, bx: 307, by: 402, side: "right" },
    ];
    this.core = {
      x: 195,
      y: 422,
      vx: 0,
      vy: 0,
      radius: CORE_RADIUS,
      rotation: 0,
      curveTime: 0,
      curveStrength: 0,
      curveOwner: null,
      gripTime: 0,
      gripOwner: null,
      gripNormalX: 0,
      gripNormalY: 0,
      impactCompression: 0,
      impactSnap: 0,
      impactClass: null,
    };
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
      authority: 0,
      fieldHeat: 0,
      fieldAngle: 0,
      driveX: 0,
      driveY: 0,
      driveMagnitude: 0,
      strikeWindow: 0,
      strikeWindup: 0,
      strikeCooldown: 0,
      strikePower: null,
      strikePending: false,
      actionKick: 0,
      telegraphPower: null,
      telegraphStrength: 0,
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

  setNodeDrive(owner, x, y, magnitude = Math.hypot(x, y)) {
    const node = this.nodes[owner];
    if (!node) return;
    const lengthValue = Math.max(Math.hypot(x, y), EPSILON);
    const limitedMagnitude = clamp(magnitude, 0, 1);
    node.driveX = limitedMagnitude > 0.02 ? x / lengthValue : 0;
    node.driveY = limitedMagnitude > 0.02 ? y / lengthValue : 0;
    node.driveMagnitude = limitedMagnitude;
  }

  requestStrike(owner, power = null) {
    const node = this.nodes[owner];
    if (!node || node.strikeCooldown > 0 || this.frozen || this.core.gripTime > 0) return false;
    node.strikeWindow = power === "pulse" ? 0.205 : power === "grip" ? 0.185 : 0.165;
    node.strikeWindup = power ? 0.034 : 0.022;
    node.strikePower = power;
    node.strikePending = true;
    node.actionKick = 1;
    node.strikeCooldown = power === "rush" ? 0.44 : power ? 0.34 : 0.205;
    this.queuedEvents.push({ type: "strike-start", owner, power });
    return true;
  }

  resetRound(direction = "neutral") {
    this.frozen = false;
    this.roundTime = 0;
    this.pressure = 0;
    this.duelSurge = 0;
    this.overtimeOpen = 0;
    this.surgeAnnounced = false;
    this.breakAnnounced = false;
    this.contention = 0;
    this.contestDominance = 0;
    this.contestedSeconds = 0;
    this.stallSeconds = 0;
    this.longestStall = 0;
    this.currentStall = 0;
    this.lastTouch = null;
    this.sameSideChain = 0;
    this.rallyContacts = 0;
    this.events.length = 0;
    this.queuedEvents.length = 0;
    this.core.x = 195;
    this.core.y = 422;
    const lane = (this.random() - 0.5) * 0.38;
    const vertical = direction === "player" ? 1 : direction === "bot" ? -1 : (this.random() < 0.5 ? -1 : 1);
    this.core.vx = lane * 120;
    this.core.vy = vertical * 112;
    this.core.rotation = 0;
    this.core.curveTime = 0;
    this.core.curveStrength = 0;
    this.core.curveOwner = null;
    this.core.gripTime = 0;
    this.core.gripOwner = null;
    this.core.gripNormalX = 0;
    this.core.gripNormalY = 0;
    this.core.impactCompression = 0;
    this.core.impactSnap = 0;
    this.core.impactClass = null;
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
    node.authority = 0;
    node.fieldHeat = 0;
    node.driveX = 0;
    node.driveY = 0;
    node.driveMagnitude = 0;
    node.strikeWindow = 0;
    node.strikeWindup = 0;
    node.strikeCooldown = 0;
    node.strikePower = null;
    node.strikePending = false;
    node.actionKick = 0;
    node.telegraphPower = null;
    node.telegraphStrength = 0;
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
    this.events = this.queuedEvents.splice(0);
    this.time += dt;
    if (this.frozen) return this.events;
    this.roundTime += dt;

    this.#updateNode(this.nodes.player, dt, true);
    this.#updateNode(this.nodes.bot, dt, false);
    this.core.impactCompression = Math.max(0, this.core.impactCompression - dt * 9.5);
    this.core.impactSnap = Math.max(0, this.core.impactSnap - dt * 5.2);
    if (this.core.gripTime > 0) {
      this.#updateGrip(dt);
      this.#resolveArena();
      return this.events;
    }
    const fieldIntents = {
      player: this.#measureField(this.nodes.player, dt),
      bot: this.#measureField(this.nodes.bot, dt),
    };
    this.contention = Math.min(fieldIntents.player.falloff, fieldIntents.bot.falloff);
    const authorityTotal = fieldIntents.player.authority + fieldIntents.bot.authority + EPSILON;
    this.contestDominance = clamp(
      (fieldIntents.player.authority - fieldIntents.bot.authority) / authorityTotal,
      -1,
      1,
    );
    if (this.contention > 0.16) this.contestedSeconds += dt;
    this.#applyNodeField(this.nodes.player, fieldIntents.player, dt);
    this.#applyNodeField(this.nodes.bot, fieldIntents.bot, dt);
    this.#resolveContention(fieldIntents, dt);

    this.#applyCoreCurve(dt);

    const damping = Math.pow(this.config.coreDamping, dt * 60);
    this.core.vx *= damping;
    this.core.vy *= damping;
    this.pressure = Math.max(0, this.pressure - dt * 0.006);
    const longDuelPressure = clamp((this.roundTime - 7) / 20, 0, 0.90);
    this.duelSurge = longDuelPressure;
    this.overtimeOpen = clamp((this.roundTime - 24) / 6, 0, 1);
    this.pressure = Math.max(this.pressure, longDuelPressure);
    if (!this.surgeAnnounced && this.duelSurge >= 0.58) {
      this.surgeAnnounced = true;
      this.events.push({ type: "surge", strength: this.duelSurge });
    }
    if (!this.breakAnnounced && this.overtimeOpen >= 0.05) {
      this.breakAnnounced = true;
      this.events.push({ type: "break", strength: this.overtimeOpen });
    }

    const speedCap = this.config.baseSpeedCap + this.pressure * 260 + (this.matchPoint ? 26 : 0);
    this.#clampCoreSpeed(speedCap);
    let currentSpeed = length(this.core.vx, this.core.vy);
    const stalled = this.contention > 0.20 && currentSpeed < 96;
    if (stalled) {
      this.currentStall += dt;
      this.stallSeconds += dt;
      this.longestStall = Math.max(this.longestStall, this.currentStall);
    } else {
      this.currentStall = Math.max(0, this.currentStall - dt * 2.5);
    }
    const minimumPace = this.roundTime > 7 ? 105 + longDuelPressure * 330 + this.overtimeOpen * 240 : 0;
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

    const playerActionHit = this.#resolveActionStrike(this.nodes.player);
    const botActionHit = this.#resolveActionStrike(this.nodes.bot);
    if (!playerActionHit) this.#resolveNodeContact(this.nodes.player);
    if (!botActionHit) this.#resolveNodeContact(this.nodes.bot);
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
    node.strikeCooldown = Math.max(0, node.strikeCooldown - dt);
    node.strikeWindow = Math.max(0, node.strikeWindow - dt);
    node.strikeWindup = Math.max(0, node.strikeWindup - dt);
    node.actionKick = Math.max(0, node.actionKick - dt * 7.5);

    const dx = node.targetX - node.x;
    const dy = node.targetY - node.y;
    const distance = length(dx, dy);
    const maxSpeed = isPlayer ? 604 : 650;
    const useDrive = isPlayer && node.driveMagnitude > 0.015;
    const driveResponse = node.driveMagnitude < 0.45
      ? node.driveMagnitude / 0.45 * 0.28
      : 0.28 + (node.driveMagnitude - 0.45) / 0.55 * 0.72;
    const desiredSpeed = useDrive
      ? maxSpeed * driveResponse
      : isPlayer
        ? 0
        : Math.min(maxSpeed, distance * 7.5);
    const direction = useDrive
      ? { x: node.driveX, y: node.driveY }
      : distance > EPSILON
        ? { x: dx / distance, y: dy / distance }
        : { x: 0, y: 0 };
    const desiredVx = direction.x * desiredSpeed;
    const desiredVy = direction.y * desiredSpeed;
    const velocityDot = node.vx * desiredVx + node.vy * desiredVy;
    const acceleration = isPlayer
      ? !useDrive
        ? 6900
        : velocityDot < -2000 ? 7200 : 4750
      : 3900;
    node.vx = moveToward(node.vx, desiredVx, acceleration * dt);
    node.vy = moveToward(node.vy, desiredVy, acceleration * dt);
    node.x = clamp(node.x + node.vx * dt, zone.left, zone.right);
    node.y = clamp(node.y + node.vy * dt, zone.top, zone.bottom);
    if (node.x === zone.left || node.x === zone.right) node.vx *= 0.45;
    if (node.y === zone.top || node.y === zone.bottom) node.vy *= 0.45;
    node.fieldAngle += dt * (1.7 + Math.min(length(node.vx, node.vy) / 260, 2.4));
  }

  #measureField(node, dt) {
    const dx = node.x - this.core.x;
    const dy = node.y - this.core.y;
    const distance = Math.max(length(dx, dy), 1);
    const falloff = clamp(1 - distance / this.config.fieldRadius, 0, 1);
    const nodeSpeed = length(node.vx, node.vy);
    const moving = clamp(nodeSpeed / 520, 0, 1);
    if (falloff > 0.20 && nodeSpeed < 86) node.fieldHeat = clamp(node.fieldHeat + dt * 0.72, 0, 1);
    else node.fieldHeat = clamp(node.fieldHeat - dt * (0.78 + moving * 1.12), 0, 1);
    const movementAuthority = this.config.stationaryAuthority + (1 - this.config.stationaryAuthority) * moving;
    const authority = movementAuthority * (1 - node.fieldHeat * this.config.heatPenalty);
    node.influence = falloff;
    node.authority = authority;
    return { dx, dy, distance, falloff, nodeSpeed, moving, authority };
  }

  #applyNodeField(node, intent, dt) {
    const { dx, dy, distance, falloff, nodeSpeed, moving, authority } = intent;
    if (falloff <= 0) {
      this.#releaseTetherIfReady(node, distance);
      return;
    }

    const direction = { x: dx / distance, y: dy / distance };
    const movingBonus = 1 + moving * this.config.movingFieldBonus;
    const breakAuthority = 1 - this.overtimeOpen * 0.66;
    const signedDominance = node.owner === "player" ? this.contestDominance : -this.contestDominance;
    const contestMultiplier = this.contention > 0.08
      ? clamp(1 + signedDominance * this.config.contestBias, 0.32, 1.68)
      : 1;
    const coreSpeed = length(this.core.vx, this.core.vy);
    const momentumAlignment = coreSpeed > 12
      ? dot(direction.x, direction.y, this.core.vx / coreSpeed, this.core.vy / coreSpeed)
      : 0;
    const momentumMultiplier = momentumAlignment < 0
      ? 1 - this.config.momentumPriority * Math.min(-momentumAlignment, 1)
      : 1;
    const force = this.config.fieldStrength
      * Math.pow(falloff, this.config.fieldExponent)
      * movingBonus
      * authority
      * contestMultiplier
      * momentumMultiplier
      * breakAuthority;
    this.core.vx += direction.x * force * dt;
    this.core.vy += direction.y * force * dt;

    if (this.config.continuousTransfer > 0) {
      const transfer = this.config.continuousTransfer * falloff * falloff * dt * 4.2 * breakAuthority * authority;
      this.core.vx += node.vx * transfer;
      this.core.vy += node.vy * transfer;
    }

    if (node.tetherCooldown <= 0 && nodeSpeed > 72 && distance < CLOSE_RADIUS) {
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
      this.events.push({
        type: "field",
        owner: node.owner,
        strength: falloff,
        distance,
        authority,
        heat: node.fieldHeat,
        contested: this.contention,
      });
    }
  }

  #resolveContention(intents, dt) {
    if (this.contention <= 0.15 || this.config.contestInstability <= 0) return;
    const speed = length(this.core.vx, this.core.vy);
    const movementVectorX = this.nodes.player.vx - this.nodes.bot.vx;
    const movementVectorY = this.nodes.player.vy - this.nodes.bot.vy;
    const movementMagnitude = length(movementVectorX, movementVectorY);
    const direction = movementMagnitude > 22
      ? normalized(movementVectorX, movementVectorY)
      : normalized(this.core.vx || 1, this.core.vy);
    const side = Math.sign(cross(
      intents.player.dx,
      intents.player.dy,
      intents.bot.dx,
      intents.bot.dy,
    )) || (this.contestDominance >= 0 ? 1 : -1);
    const instability = this.config.contestInstability
      * this.contention
      * (0.35 + Math.abs(this.contestDominance) * 0.65)
      * clamp(1 - speed / 540, 0.20, 1);
    this.core.vx += (-direction.y * side + direction.x * this.contestDominance * 0.35) * instability * dt;
    this.core.vy += (direction.x * side + direction.y * this.contestDominance * 0.35) * instability * dt;
    if (this.currentStall > 0.42) {
      this.pressure = clamp(this.pressure + dt * 0.045, 0, 1);
      if (this.currentStall > 0.44 && this.currentStall - dt <= 0.44) {
        this.events.push({ type: "contest-break", dominance: this.contestDominance, strength: this.contention });
      }
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

  #applyCoreCurve(dt) {
    if (this.core.curveTime <= 0 || Math.abs(this.core.curveStrength) < 1) {
      this.core.curveTime = 0;
      this.core.curveStrength = 0;
      this.core.curveOwner = null;
      return;
    }
    const speed = length(this.core.vx, this.core.vy);
    if (speed > 24) {
      const forward = normalized(this.core.vx, this.core.vy);
      const fade = clamp(this.core.curveTime / 0.82, 0, 1);
      this.core.vx += -forward.y * this.core.curveStrength * fade * dt;
      this.core.vy += forward.x * this.core.curveStrength * fade * dt;
    }
    this.core.curveTime = Math.max(0, this.core.curveTime - dt);
  }

  #updateGrip(dt) {
    const owner = this.core.gripOwner;
    const node = this.nodes[owner];
    if (!node) {
      this.core.gripTime = 0;
      this.core.gripOwner = null;
      return;
    }
    const attackSign = owner === "player" ? -1 : 1;
    const targetX = clamp(node.x + node.driveX * 13, ARENA.left + CORE_RADIUS, ARENA.right - CORE_RADIUS);
    const targetY = node.y + attackSign * 46 + node.driveY * 6;
    const follow = Math.min(1, dt * 30);
    this.core.x += (targetX - this.core.x) * follow;
    this.core.y += (targetY - this.core.y) * follow;
    this.core.vx = node.vx * 0.58;
    this.core.vy = node.vy * 0.58;
    this.core.rotation += dt * (5.8 + length(node.vx, node.vy) * 0.012);
    this.core.gripTime = Math.max(0, this.core.gripTime - dt);
    if (this.core.gripTime > 0) return;

    const nodeSpeed = length(node.vx, node.vy);
    const releaseDirection = normalized(
      this.core.gripNormalX * 0.30 + node.driveX * 0.66,
      attackSign * 0.72 + this.core.gripNormalY * 0.18 + node.driveY * 0.34,
    );
    const releaseSpeed = 326 + Math.min(nodeSpeed * 0.28, 116) + this.pressure * 46;
    this.core.vx = releaseDirection.x * releaseSpeed + node.vx * 0.14;
    this.core.vy = releaseDirection.y * releaseSpeed + node.vy * 0.14;
    this.lastMotionAngle = Math.atan2(this.core.vy, this.core.vx);
    this.core.gripOwner = null;
    this.core.impactSnap = 0.70;
    this.events.push({ type: "grip-release", owner, speed: length(this.core.vx, this.core.vy), direction: releaseDirection });
  }

  #resolveActionStrike(node) {
    if (!node.strikePending) return false;
    if (node.strikeWindup > 0) return true;
    if (node.strikeWindow <= 0) {
      this.events.push({ type: "strike-whiff", owner: node.owner, power: node.strikePower });
      node.strikePending = false;
      node.strikePower = null;
      return false;
    }

    const dx = this.core.x - node.x;
    const dy = this.core.y - node.y;
    const distance = Math.max(length(dx, dy), EPSILON);
    const power = node.strikePower;
    const reach = power === "pulse" ? PULSE_REACH : power === "grip" ? GRIP_REACH : STRIKE_REACH;
    if (distance > reach) return true;

    const radial = normalized(dx, dy);
    const attackSign = node.owner === "player" ? -1 : 1;
    const nodeSpeed = length(node.vx, node.vy);
    const velocityDirection = nodeSpeed > 20 ? normalized(node.vx, node.vy) : radial;
    const approachAlignment = nodeSpeed > 20 ? dot(velocityDirection.x, velocityDirection.y, radial.x, radial.y) : 0;
    const approachSpeed = Math.max(0, dot(node.vx, node.vy, radial.x, radial.y));
    const clean = distance <= 84 && approachAlignment >= 0.58 && approachSpeed >= 178;
    const perfect = distance <= 72 && approachAlignment >= 0.84 && approachSpeed >= 338;
    let direction = normalized(
      radial.x * 0.78 + velocityDirection.x * (0.24 + Math.max(0, approachAlignment) * 0.20),
      radial.y * 0.78 + velocityDirection.y * (0.24 + Math.max(0, approachAlignment) * 0.20),
    );
    let speed = 468 + Math.min(approachSpeed * 0.34, 164) + this.pressure * 74 + (clean ? 46 : 0) + (perfect ? 66 : 0);
    let carry = 0.15;
    let recoil = perfect ? 124 : clean ? 102 : 82;
    let defensivePower = false;

    if (power === "rush") {
      direction = normalized(radial.x * 0.56 + velocityDirection.x * 0.58, radial.y * 0.56 + velocityDirection.y * 0.58);
      speed = 654 + Math.min(approachSpeed * 0.38, 178) + this.pressure * 92 + (clean ? 44 : 0);
      carry = 0.06;
      recoil = 168;
    } else if (power === "bend") {
      speed = 506 + Math.min(approachSpeed * 0.22, 104) + this.pressure * 62;
      carry = 0.12;
      recoil = 94;
      let curveSign = Math.sign(node.driveX || direction.x);
      if (curveSign === 0) curveSign = this.core.x < WORLD_WIDTH * 0.5 ? 1 : -1;
      this.core.curveTime = 0.94;
      this.core.curveStrength = curveSign * (472 + this.pressure * 86);
      this.core.curveOwner = node.owner;
    } else if (power === "grip") {
      this.core.vx *= 0.08;
      this.core.vy *= 0.08;
      this.core.gripTime = 0.30;
      this.core.gripOwner = node.owner;
      this.core.gripNormalX = radial.x;
      this.core.gripNormalY = radial.y;
      speed = 0;
      carry = 0;
      recoil = 46;
    } else if (power === "pulse") {
      const inDefensiveThird = node.owner === "player" ? this.core.y > 610 : this.core.y < 234;
      defensivePower = inDefensiveThird;
      direction = normalized(radial.x * 0.94 + velocityDirection.x * 0.18, radial.y * 0.94 + velocityDirection.y * 0.18);
      speed = (inDefensiveThird ? 626 : 492) + Math.min(approachSpeed * 0.16, 74) + this.pressure * 54;
      carry = 0.03;
      recoil = 188;
    }

    if (power !== "grip") {
      this.core.vx = this.core.vx * carry + direction.x * speed;
      this.core.vy = this.core.vy * carry + direction.y * speed;
    }
    this.lastMotionAngle = Math.atan2(this.core.vy, this.core.vx);
    this.pressure = clamp(this.pressure + (power ? 0.145 : 0.085), 0, 1);
    this.rallyContacts += 1;
    this.lastTouch = node.owner;
    node.contactCooldown = 0.19;
    node.contactArmed = false;
    node.strikeWindow = 0;
    node.strikeWindup = 0;
    node.strikePending = false;
    node.strikePower = null;
    node.vx -= direction.x * recoil;
    node.vy -= direction.y * recoil;
    const quality = power ? "power" : perfect ? "perfect" : clean ? "clean" : "normal";
    this.core.impactCompression = 1;
    this.core.impactSnap = power ? 1 : perfect ? 0.88 : clean ? 0.68 : 0.46;
    this.core.impactClass = quality;
    this.events.push({
      type: "strike",
      owner: node.owner,
      power,
      speed: length(this.core.vx, this.core.vy),
      distance,
      sweetSpot: clean || perfect,
      clean,
      perfect,
      quality,
      approachSpeed,
      approachAlignment,
      defensivePower,
      chain: this.rallyContacts,
      direction: { ...direction },
    });
    return true;
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

    if (clutch) {
      const counterDirection = node.owner === "player" ? -1 : 1;
      this.core.vy += counterDirection * (82 + Math.min(nodeSpeed * 0.10, 72));
      this.core.vx += node.vx * 0.06;
    } else if (perfect) {
      this.core.vx += node.vx * 0.035;
      this.core.vy += node.vy * 0.035;
    }

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

    // RIFT BREAK is a visible, symmetric long-duel resolution: both Reactor
    // mouths mechanically iris open and advance into the field. It never
    // chooses a winner; it only removes safe bank angles and shortens the last
    // defensive read so the next earned attack can finish the duel.
    // Repeated earned contacts make both Reactor mouths more vulnerable before
    // the emergency RIFT BREAK. Pressure, not elapsed time, resolves most
    // exchanges; the long-duel machinery remains only a symmetric backstop.
    const liveGoalHalfWidth = ARENA.goalHalfWidth + this.pressure * 28 + this.duelSurge * 8 + this.overtimeOpen * 88;
    const reactorAdvance = this.overtimeOpen * 84;
    const inMouth = Math.abs(this.core.x - WORLD_WIDTH / 2) <= liveGoalHalfWidth;
    if (inMouth && this.core.y <= ARENA.topReactorY + reactorAdvance) {
      this.#score("player");
      return;
    }
    if (inMouth && this.core.y >= ARENA.bottomReactorY - reactorAdvance) {
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
      duelSurge: this.duelSurge,
      overtimeOpen: this.overtimeOpen,
      contention: this.contention,
      contestDominance: this.contestDominance,
      contestedSeconds: this.contestedSeconds,
      stallSeconds: this.stallSeconds,
      longestStall: this.longestStall,
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
  STRIKE_REACH,
  PULSE_REACH,
  GRIP_REACH,
});
