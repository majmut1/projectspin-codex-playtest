import { RiftAudio } from "./audio.mjs";
import { BOT_STATES, RiftBot } from "./bot.mjs";
import {
  ARENA,
  CANDIDATE_CONFIGS,
  PHYSICS_MODES,
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
  RIFTBALL_CONSTANTS,
  RiftPhysics,
} from "./physics.mjs";

const BUILD_ID = "RIFT-20260815.1";
const BUILD_IDENTITY = `CODEX • RIFTBALL • ${BUILD_ID}`;
const FIXED_STEP = 1 / 120;
const WIN_SCORE = 3;
const COLORS = Object.freeze({
  ink: "#05060a",
  glass: "#111520",
  glassLine: "#303642",
  bone: "#fff6d8",
  boneSoft: "#d8d1b7",
  amber: "#ffb548",
  amberHot: "#ffe08b",
  violet: "#7967ff",
  violetHot: "#b7adff",
  danger: "#ff5368",
  steel: "#8f96a5",
});

const GAME_STATES = Object.freeze({
  MENU: "MENU",
  ROUND_INTRO: "ROUND_INTRO",
  PLAYING: "PLAYING",
  GOAL: "GOAL",
  RESULTS: "RESULTS",
});

const canvas = document.getElementById("game-canvas");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const app = document.getElementById("app");
const boot = document.getElementById("boot");
const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const results = document.getElementById("results");
const playButton = document.getElementById("play-button");
const replayButton = document.getElementById("replay-button");
const homeButton = document.getElementById("home-button");
const soundButton = document.getElementById("sound-button");
const playerScoreLabel = document.getElementById("player-score");
const botScoreLabel = document.getElementById("bot-score");
const playerPips = document.getElementById("player-pips");
const botPips = document.getElementById("bot-pips");
const statusCall = document.getElementById("status");
const duelMeter = document.querySelector("#duel-meter span");
const resultTitle = document.getElementById("result-title");
const resultScore = document.getElementById("result-score");
const resultStats = document.getElementById("result-stats");

for (const element of document.querySelectorAll(".build-identity, .game-build")) element.textContent = BUILD_IDENTITY;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
}

function formatSeconds(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function createPips(container) {
  container.replaceChildren();
  for (let index = 0; index < WIN_SCORE; index += 1) container.append(document.createElement("i"));
}

createPips(playerPips);
createPips(botPips);

class RiftGame {
  constructor() {
    const requestedMode = new URLSearchParams(location.search).get("physics");
    this.physicsMode = CANDIDATE_CONFIGS[requestedMode] ? requestedMode : PHYSICS_MODES.TETHER;
    this.physics = new RiftPhysics({ mode: this.physicsMode, seed: 15473 });
    this.bot = new RiftBot(8819);
    this.audio = new RiftAudio();
    this.state = GAME_STATES.MENU;
    this.scores = { player: 0, bot: 0 };
    this.stats = this.#freshStats();
    this.matchStartedAt = 0;
    this.roundIntro = 0;
    this.goalTimer = 0;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.menuTime = 0;
    this.visualTime = 0;
    this.pointerId = null;
    this.hasInteracted = false;
    this.tutorialTimer = 0;
    this.statusExpires = 0;
    this.soundEnabled = true;
    this.trail = [];
    this.trailSampleTimer = 0;
    this.particles = [];
    this.shockwaves = [];
    this.flash = { alpha: 0, color: COLORS.bone };
    this.shake = 0;
    this.goalOwner = null;
    this.roundLaunchDirection = "neutral";
    this.pendingResult = false;
    this.railsAnnounced = false;
    this.matchPointAnnounced = false;
    this.lastBotState = BOT_STATES.READ;
    this.devicePixelRatio = 1;
    this.#wireInput();
    this.resize();
    this.showMenu();
    requestAnimationFrame((time) => this.frame(time));
  }

  #freshStats() {
    return {
      goals: 0,
      saves: 0,
      perfect: 0,
      clutch: 0,
      slings: 0,
      rebounds: 0,
      maxChain: 0,
      longestDuel: 0,
      duelSeconds: [],
    };
  }

  #wireInput() {
    addEventListener("resize", () => this.resize(), { passive: true });
    addEventListener("orientationchange", () => this.resize(), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.pointerId = null;
        const node = this.physics.nodes.player;
        this.physics.setNodeTarget("player", node.x, node.y);
        this.accumulator = 0;
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (![GAME_STATES.ROUND_INTRO, GAME_STATES.PLAYING].includes(this.state) || this.pointerId !== null) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      canvas.setPointerCapture?.(event.pointerId);
      this.hasInteracted = true;
      this.#movePlayerToPointer(event);
      this.audio.unlock();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.#movePlayerToPointer(event);
    });
    const releasePointer = (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
    };
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener("lostpointercapture", () => { this.pointerId = null; });

    playButton.addEventListener("click", async () => {
      await this.audio.unlock();
      this.audio.ui();
      this.startMatch();
    });
    replayButton.addEventListener("click", async () => {
      await this.audio.unlock();
      this.audio.ui();
      this.startMatch();
    });
    homeButton.addEventListener("click", () => {
      this.audio.ui();
      this.showMenu();
    });
    soundButton.addEventListener("click", async () => {
      this.soundEnabled = !this.soundEnabled;
      this.audio.setEnabled(this.soundEnabled);
      soundButton.classList.toggle("muted", !this.soundEnabled);
      soundButton.setAttribute("aria-label", this.soundEnabled ? "Mute sound" : "Enable sound");
      if (this.soundEnabled) {
        await this.audio.unlock();
        this.audio.ui();
      }
    });
  }

  #movePlayerToPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * REFERENCE_WIDTH / Math.max(rect.width, 1);
    const y = (event.clientY - rect.top) * REFERENCE_HEIGHT / Math.max(rect.height, 1);
    this.physics.setNodeTarget("player", x, y);
  }

  resize() {
    const rect = app.getBoundingClientRect();
    this.devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * this.devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * this.devicePixelRatio));
  }

  showMenu() {
    this.state = GAME_STATES.MENU;
    this.pointerId = null;
    this.trail.length = 0;
    this.particles.length = 0;
    this.shockwaves.length = 0;
    this.audio.update({ active: false });
    menu.hidden = false;
    hud.hidden = true;
    results.hidden = true;
  }

  startMatch() {
    this.scores.player = 0;
    this.scores.bot = 0;
    this.stats = this.#freshStats();
    this.matchStartedAt = performance.now();
    this.hasInteracted = false;
    this.tutorialTimer = 3.2;
    this.railsAnnounced = false;
    this.matchPointAnnounced = false;
    this.pendingResult = false;
    this.goalOwner = null;
    menu.hidden = true;
    results.hidden = true;
    hud.hidden = false;
    this.updateScoreUI();
    this.prepareRound("neutral");
  }

  prepareRound(direction) {
    this.state = GAME_STATES.ROUND_INTRO;
    this.roundIntro = 0.72;
    this.goalTimer = 0;
    this.goalOwner = null;
    this.roundLaunchDirection = direction;
    this.trail.length = 0;
    this.physics.resetRound(direction);
    this.physics.core.vx = 0;
    this.physics.core.vy = 0;
    this.bot.reset();
    const totalGoals = this.scores.player + this.scores.bot;
    const matchPoint = this.scores.player === 2 || this.scores.bot === 2;
    this.physics.setScoreContext(totalGoals, matchPoint);
    if (this.scores.player === 2 && this.scores.bot === 2) this.announce("FINAL RIFT", 1.05);
    else if (matchPoint) this.announce("MATCH POINT", 1.05);
    else this.announce(totalGoals === 0 ? "DRAG • PULL • BREAK" : "CORE RESET", 0.66);
  }

  frame(time) {
    const realDelta = clamp((time - this.lastFrame) / 1000, 0, 0.05);
    this.lastFrame = time;
    this.visualTime += realDelta;
    this.menuTime += this.state === GAME_STATES.MENU ? realDelta : 0;
    this.accumulator = Math.min(this.accumulator + realDelta, 0.12);

    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.updateVisualEffects(realDelta);
    this.draw();
    requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  fixedUpdate(dt) {
    if (this.tutorialTimer > 0) this.tutorialTimer -= dt;

    if (this.state === GAME_STATES.ROUND_INTRO) {
      this.roundIntro -= dt;
      const player = this.physics.nodes.player;
      const botNode = this.physics.nodes.bot;
      this.physics.setNodeTarget("player", player.targetX, player.targetY);
      this.physics.setNodeTarget("bot", botNode.targetX, botNode.targetY);
      this.physics.step(dt);
      this.physics.core.x = 195;
      this.physics.core.y = 422;
      this.physics.core.vx = 0;
      this.physics.core.vy = 0;
      if (this.roundIntro <= 0) {
        this.state = GAME_STATES.PLAYING;
        this.physics.launch(this.roundLaunchDirection, 174);
        this.announce("CORE LIVE", 0.48);
      }
      return;
    }

    if (this.state === GAME_STATES.PLAYING) {
      const matchPoint = this.scores.player === 2 || this.scores.bot === 2;
      this.lastBotState = this.bot.update(dt, this.physics, { scores: this.scores, matchPoint });
      const events = this.physics.step(dt);
      this.processPhysicsEvents(events);
      this.trailSampleTimer -= dt;
      if (this.trailSampleTimer <= 0) {
        this.trailSampleTimer = 1 / 60;
        this.trail.unshift({
          x: this.physics.core.x,
          y: this.physics.core.y,
          speed: Math.hypot(this.physics.core.vx, this.physics.core.vy),
          influence: this.physics.nodes.player.influence - this.physics.nodes.bot.influence,
        });
        if (this.trail.length > 34) this.trail.pop();
      }
      duelMeter.style.width = `${clamp(this.physics.pressure * 100, 0, 100)}%`;
      return;
    }

    if (this.state === GAME_STATES.GOAL) {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        if (this.pendingResult) this.showResults();
        else this.prepareRound(this.goalOwner);
      }
    }
  }

  processPhysicsEvents(events) {
    for (const event of events) {
      if (event.type === "field") continue;
      if (event.type === "sling" && event.charge < 0.90) continue;
      this.audio.event(event);
      if (event.type === "surge") {
        this.announce("RIFT SURGE", 0.72);
        this.flash = { alpha: 0.12, color: COLORS.bone };
        this.shockwaves.push(
          { x: 195, y: ARENA.topReactorY, radius: 42, target: 116, life: 0.34, maxLife: 0.34, color: COLORS.violet, dashed: true },
          { x: 195, y: ARENA.bottomReactorY, radius: 42, target: 116, life: 0.34, maxLife: 0.34, color: COLORS.amber, dashed: true },
        );
      } else if (event.type === "break") {
        this.announce("RIFT BREAK", 0.84);
        this.shake = Math.max(this.shake, 5.5);
        this.flash = { alpha: 0.18, color: COLORS.bone };
        this.shockwaves.push({ x: 195, y: 422, radius: 38, target: 208, life: 0.46, maxLife: 0.46, color: COLORS.bone, dashed: true });
      } else if (["intercept", "perfect", "clutch"].includes(event.type)) {
        this.spawnIntercept(event);
        this.shake = Math.max(this.shake, event.type === "clutch" ? 8 : event.type === "perfect" ? 4.5 : 2.2);
        this.stats.maxChain = Math.max(this.stats.maxChain, event.chain || 0);
        if (event.owner === "player" && event.defensive) this.stats.saves += 1;
        if (event.owner === "player" && event.perfect) this.stats.perfect += 1;
        if (event.owner === "player" && event.clutch) {
          this.stats.clutch += 1;
          this.announce("CLUTCH REVERSAL", 0.82);
          this.flash = { alpha: 0.22, color: COLORS.amberHot };
        } else if (event.owner === "player" && event.type === "perfect") {
          this.announce("PERFECT INTERCEPT", 0.62);
        }
      } else if (event.type === "sling") {
        if (event.owner === "player") this.stats.slings += 1;
        this.spawnSling(event);
        if (event.owner === "player" && event.charge > 0.62) this.announce("SLINGSHOT", 0.48);
      } else if (event.type === "rebound") {
        this.stats.rebounds += 1;
        this.spawnRebound(event);
      } else if (event.type === "goal") {
        this.handleGoal(event);
      }
    }
  }

  handleGoal(event) {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.goalOwner = event.owner;
    this.scores[event.owner] += 1;
    if (event.owner === "player") {
      this.stats.goals += 1;
      this.announce("REACTOR BREACH", 1.0);
    } else {
      this.announce("REACTOR LOST", 1.0);
    }
    this.stats.longestDuel = Math.max(this.stats.longestDuel, event.roundTime);
    this.stats.duelSeconds.push(event.roundTime);
    this.updateScoreUI();
    this.state = GAME_STATES.GOAL;
    this.goalTimer = 0.86;
    this.pendingResult = this.scores.player >= WIN_SCORE || this.scores.bot >= WIN_SCORE;
    this.shake = 15;
    this.flash = { alpha: 0.45, color: event.owner === "player" ? COLORS.amber : COLORS.violet };
    this.spawnGoal(event.owner);

    const totalGoals = this.scores.player + this.scores.bot;
    const isMatchPoint = this.scores.player === 2 || this.scores.bot === 2;
    if (!this.pendingResult && totalGoals >= 2 && !isMatchPoint && !this.railsAnnounced) {
      this.railsAnnounced = true;
      setTimeout(() => this.announce("RIFT FINS ONLINE", 0.82), 440);
    }
    if (!this.pendingResult && isMatchPoint && !this.matchPointAnnounced) {
      this.matchPointAnnounced = true;
      this.audio.matchPoint();
    }
  }

  updateScoreUI() {
    playerScoreLabel.textContent = String(this.scores.player);
    botScoreLabel.textContent = String(this.scores.bot);
    [...playerPips.children].forEach((pip, index) => pip.classList.toggle("active", index < this.scores.player));
    [...botPips.children].forEach((pip, index) => pip.classList.toggle("active", index < this.scores.bot));
  }

  announce(message, duration = 0.6) {
    statusCall.textContent = message;
    statusCall.classList.add("visible");
    this.statusExpires = performance.now() + duration * 1000;
  }

  showResults() {
    this.state = GAME_STATES.RESULTS;
    hud.hidden = true;
    results.hidden = false;
    const victory = this.scores.player > this.scores.bot;
    resultTitle.textContent = victory ? "VICTORY" : "DEFEAT";
    resultTitle.style.color = victory ? COLORS.amberHot : COLORS.violetHot;
    resultScore.textContent = `${this.scores.player} — ${this.scores.bot}`;
    const duelAverage = this.stats.duelSeconds.length
      ? this.stats.duelSeconds.reduce((sum, value) => sum + value, 0) / this.stats.duelSeconds.length
      : 0;
    const matchSeconds = (performance.now() - this.matchStartedAt) / 1000;
    const values = [
      [this.stats.saves, "SAVES"],
      [this.stats.perfect, "PERFECT INTERCEPTS"],
      [this.stats.clutch, "CLUTCH REVERSALS"],
      [this.stats.slings, "SLINGSHOTS"],
      [this.stats.maxChain, "PRESSURE CHAIN"],
      [`${duelAverage.toFixed(1)}s`, "AVG DUEL"],
      [`${this.stats.longestDuel.toFixed(1)}s`, "LONGEST DUEL"],
      [formatSeconds(matchSeconds), "MATCH TIME"],
    ];
    resultStats.replaceChildren(...values.map(([value, label]) => {
      const wrapper = document.createElement("div");
      wrapper.className = "result-stat";
      const strong = document.createElement("b");
      strong.textContent = String(value);
      const span = document.createElement("span");
      span.textContent = label;
      wrapper.append(strong, span);
      return wrapper;
    }));
    this.audio.result(victory);
    this.spawnResult(victory);
  }

  spawnIntercept(event) {
    const core = this.physics.core;
    const color = event.owner === "player" ? COLORS.amber : COLORS.violet;
    const count = event.type === "clutch" ? 18 : event.type === "perfect" ? 13 : 8;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * index / count + Math.random() * 0.22;
      const speed = (event.type === "clutch" ? 165 : 105) * (0.55 + Math.random() * 0.7);
      this.particles.push({
        x: core.x,
        y: core.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.30 + Math.random() * 0.18,
        maxLife: 0.48,
        color,
        size: 1.4 + Math.random() * 2.3,
        shape: index % 3 === 0 ? "shard" : "spark",
      });
    }
    this.shockwaves.push({ x: core.x, y: core.y, radius: 18, target: event.type === "clutch" ? 108 : 64, life: 0.30, maxLife: 0.30, color });
  }

  spawnSling(event) {
    const core = this.physics.core;
    const color = event.owner === "player" ? COLORS.amberHot : COLORS.violetHot;
    this.shockwaves.push({ x: core.x, y: core.y, radius: 22, target: 82 + event.charge * 44, life: 0.24, maxLife: 0.24, color, dashed: true });
  }

  spawnRebound() {
    const core = this.physics.core;
    this.shockwaves.push({ x: core.x, y: core.y, radius: 8, target: 34, life: 0.16, maxLife: 0.16, color: COLORS.boneSoft });
  }

  spawnGoal(owner) {
    const x = this.physics.core.x;
    const y = owner === "player" ? ARENA.topReactorY : ARENA.bottomReactorY;
    const color = owner === "player" ? COLORS.amber : COLORS.violet;
    for (let ring = 0; ring < 3; ring += 1) {
      this.shockwaves.push({ x, y, radius: 18 + ring * 9, target: 150 + ring * 26, life: 0.48 + ring * 0.08, maxLife: 0.48 + ring * 0.08, color, delay: ring * 0.055 });
    }
    for (let index = 0; index < 42; index += 1) {
      const angle = Math.PI * 2 * index / 42 + Math.random() * 0.16;
      const speed = 90 + Math.random() * 250;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.42 + Math.random() * 0.46,
        maxLife: 0.88,
        color: index % 5 === 0 ? COLORS.bone : color,
        size: 2 + Math.random() * 4.5,
        shape: index % 2 ? "shard" : "spark",
      });
    }
  }

  spawnResult(victory) {
    const color = victory ? COLORS.amber : COLORS.violet;
    for (let index = 0; index < 34; index += 1) {
      this.particles.push({
        x: 35 + Math.random() * 320,
        y: 170 + Math.random() * 210,
        vx: (Math.random() - 0.5) * 80,
        vy: 55 + Math.random() * 105,
        life: 1.0 + Math.random() * 0.8,
        maxLife: 1.8,
        color: index % 4 === 0 ? COLORS.bone : color,
        size: 2 + Math.random() * 4,
        shape: "shard",
      });
    }
  }

  updateVisualEffects(dt) {
    if (performance.now() >= this.statusExpires) statusCall.classList.remove("visible");
    this.shake = Math.max(0, this.shake - dt * 38);
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 1.9);
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.94, dt * 60);
      particle.vy = particle.vy * Math.pow(0.96, dt * 60) + 34 * dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0).slice(-180);
    for (const wave of this.shockwaves) {
      if (wave.delay > 0) wave.delay -= dt;
      else wave.life -= dt;
    }
    this.shockwaves = this.shockwaves.filter((wave) => wave.life > 0 || wave.delay > 0).slice(-24);

    const speed = Math.hypot(this.physics.core.vx, this.physics.core.vy);
    this.audio.update({
      speed,
      playerField: this.physics.nodes.player.influence,
      botField: this.physics.nodes.bot.influence,
      tension: this.physics.matchPoint ? 1 : this.physics.pressure,
      active: [GAME_STATES.ROUND_INTRO, GAME_STATES.PLAYING, GAME_STATES.GOAL].includes(this.state),
    });
  }

  draw() {
    const scaleX = canvas.width / REFERENCE_WIDTH;
    const scaleY = canvas.height / REFERENCE_HEIGHT;
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.clearRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);
    context.save();
    if (this.shake > 0) {
      const amplitude = this.shake * 0.45;
      context.translate((Math.random() - 0.5) * amplitude, (Math.random() - 0.5) * amplitude);
    }
    this.drawArena();
    if (this.state === GAME_STATES.MENU) this.drawMenuHero();
    else {
      this.drawReactors();
      this.drawRails();
      this.drawTrail();
      this.drawGravityLink(this.physics.nodes.player, COLORS.amber);
      this.drawGravityLink(this.physics.nodes.bot, COLORS.violet);
      this.drawNode(this.physics.nodes.bot, COLORS.violet, false);
      this.drawNode(this.physics.nodes.player, COLORS.amber, true);
      if (this.tutorialTimer > 0 && !this.hasInteracted) this.drawFirstTouchCue();
    }
    this.drawParticles();
    this.drawShockwaves();
    if (this.state !== GAME_STATES.MENU) this.drawCore(this.physics.core.x, this.physics.core.y, 1);
    if (this.flash.alpha > 0) {
      context.globalAlpha = this.flash.alpha;
      context.fillStyle = this.flash.color;
      context.fillRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);
      context.globalAlpha = 1;
    }
    context.restore();
  }

  drawArena() {
    const gradient = context.createRadialGradient(195, 430, 30, 195, 430, 470);
    gradient.addColorStop(0, this.physics.matchPoint ? "#181225" : "#11131c");
    gradient.addColorStop(0.55, "#090b12");
    gradient.addColorStop(1, "#030408");
    context.fillStyle = gradient;
    context.fillRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);

    context.save();
    context.globalAlpha = 0.56;
    context.strokeStyle = "#1d212c";
    context.lineWidth = 1;
    for (let y = 100; y < 790; y += 54) {
      context.beginPath();
      context.moveTo(28, y);
      context.lineTo(362, y);
      context.stroke();
    }
    for (let x = 49; x < 370; x += 48) {
      context.beginPath();
      context.moveTo(x, 76);
      context.lineTo(195 + (x - 195) * 0.72, 788);
      context.stroke();
    }
    context.restore();

    const seamEnergy = 0.08 + this.physics.pressure * 0.16 + this.physics.duelSurge * 0.08 + this.physics.overtimeOpen * 0.08 + (this.physics.matchPoint ? 0.13 : 0);
    context.save();
    context.strokeStyle = hexToRgba(COLORS.bone, seamEnergy);
    context.lineWidth = 1.4;
    context.setLineDash([4, 13]);
    context.lineDashOffset = -this.visualTime * 26;
    context.beginPath();
    context.moveTo(195, 74);
    context.bezierCurveTo(174, 270, 217, 580, 195, 788);
    context.stroke();
    context.restore();

    context.strokeStyle = "#373c49";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(ARENA.left, ARENA.topWall);
    context.lineTo(ARENA.left, ARENA.bottomWall);
    context.moveTo(ARENA.right, ARENA.topWall);
    context.lineTo(ARENA.right, ARENA.bottomWall);
    context.stroke();

    context.strokeStyle = "#1d222c";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(ARENA.left - 3, ARENA.topWall);
    context.lineTo(ARENA.left - 3, ARENA.bottomWall);
    context.moveTo(ARENA.right + 3, ARENA.topWall);
    context.lineTo(ARENA.right + 3, ARENA.bottomWall);
    context.stroke();

    if (this.physics.matchPoint) {
      context.globalAlpha = 0.11 + Math.sin(this.visualTime * 4.2) * 0.035;
      context.fillStyle = COLORS.danger;
      context.fillRect(0, 0, 8, REFERENCE_HEIGHT);
      context.fillRect(REFERENCE_WIDTH - 8, 0, 8, REFERENCE_HEIGHT);
      context.globalAlpha = 1;
    }
  }

  drawMenuHero() {
    const time = this.menuTime;
    const coreX = 195 + Math.sin(time * 1.24) * 52;
    const coreY = 218 + Math.cos(time * 1.57) * 34;
    const playerNode = { x: 112 + Math.sin(time * 0.87) * 14, y: 331 + Math.cos(time * 1.2) * 11, influence: 0.72, fieldAngle: time * 2.1, vx: 0, vy: 0 };
    const botNode = { x: 278 + Math.cos(time * 0.91) * 13, y: 122 + Math.sin(time * 1.1) * 10, influence: 0.62, fieldAngle: -time * 1.9, vx: 0, vy: 0 };
    const savedCore = this.physics.core;
    this.physics.core = { ...savedCore, x: coreX, y: coreY };
    this.drawGravityLink(playerNode, COLORS.amber);
    this.drawGravityLink(botNode, COLORS.violet);
    this.drawNode(botNode, COLORS.violet, false, 0.88);
    this.drawNode(playerNode, COLORS.amber, true, 0.88);
    for (let index = 7; index >= 0; index -= 1) {
      const t = index / 8;
      const x = coreX - Math.cos(time * 1.2) * t * 58;
      const y = coreY + Math.sin(time * 1.2) * t * 36;
      context.globalAlpha = (1 - t) * 0.26;
      context.fillStyle = index % 2 ? COLORS.amber : COLORS.violet;
      context.beginPath();
      context.arc(x, y, 5 * (1 - t * 0.55), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    this.drawCore(coreX, coreY, 1.18);
    this.physics.core = savedCore;
  }

  drawReactors() {
    this.drawReactor(195, ARENA.topWall + 1, false, this.scores.player, COLORS.violet);
    this.drawReactor(195, ARENA.bottomWall - 1, true, this.scores.bot, COLORS.amber);
  }

  drawReactor(x, y, facingUp, damage, color) {
    const rotation = facingUp ? Math.PI : 0;
    const pulse = 1 + Math.sin(this.visualTime * (this.physics.matchPoint ? 6.4 : 2.7) + (facingUp ? 1.2 : 0)) * 0.035;
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(pulse * (1 + this.physics.duelSurge * 0.14 + this.physics.overtimeOpen * 0.28), pulse);
    context.fillStyle = "#07080d";
    context.strokeStyle = "#454b58";
    context.lineWidth = 8;
    context.beginPath();
    context.arc(0, 0, 73, Math.PI * 0.12, Math.PI * 0.88);
    context.stroke();
    context.lineWidth = 2;
    context.strokeStyle = hexToRgba(color, 0.48);
    context.beginPath();
    context.arc(0, 0, 61, Math.PI * 0.14, Math.PI * 0.86);
    context.stroke();
    for (let index = 0; index < 3; index += 1) {
      const offset = (index - 1) * 36;
      const broken = index < damage;
      context.save();
      context.translate(offset, 7 + Math.abs(index - 1) * 4);
      context.rotate((index - 1) * 0.18);
      context.fillStyle = broken ? "#20131a" : hexToRgba(color, 0.34 + (2 - damage) * 0.04);
      context.strokeStyle = broken ? hexToRgba(COLORS.danger, 0.5) : hexToRgba(color, 0.82);
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(-15, 1);
      context.lineTo(-8, 26);
      context.lineTo(0, 34);
      context.lineTo(8, 26);
      context.lineTo(15, 1);
      context.closePath();
      context.fill();
      context.stroke();
      if (broken) {
        context.beginPath();
        context.moveTo(-6, 8);
        context.lineTo(3, 16);
        context.lineTo(-2, 24);
        context.lineTo(7, 31);
        context.strokeStyle = COLORS.danger;
        context.stroke();
      }
      context.restore();
    }
    const aperture = context.createRadialGradient(0, 14, 2, 0, 14, 38);
    aperture.addColorStop(0, hexToRgba(color, 0.32));
    aperture.addColorStop(0.34, "#020206");
    aperture.addColorStop(1, "rgba(2,2,6,0)");
    context.fillStyle = aperture;
    context.beginPath();
    context.ellipse(0, 14, 53, 28, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  drawRails() {
    if (!this.physics.railsActive) return;
    for (const rail of this.physics.rails) {
      const gradient = context.createLinearGradient(rail.ax, rail.ay, rail.bx, rail.by);
      gradient.addColorStop(0, hexToRgba(COLORS.amber, 0.78));
      gradient.addColorStop(0.5, hexToRgba(COLORS.bone, 0.92));
      gradient.addColorStop(1, hexToRgba(COLORS.violet, 0.78));
      context.lineCap = "round";
      context.strokeStyle = "#252a35";
      context.lineWidth = 15;
      context.beginPath();
      context.moveTo(rail.ax, rail.ay);
      context.lineTo(rail.bx, rail.by);
      context.stroke();
      context.strokeStyle = gradient;
      context.lineWidth = 3;
      context.stroke();
    }
    context.lineCap = "butt";
  }

  drawGravityLink(node, color) {
    const core = this.physics.core;
    const influence = clamp(node.influence ?? 0, 0, 1);
    if (influence < 0.025) return;
    const dx = core.x - node.x;
    const dy = core.y - node.y;
    const perpendicularX = -dy;
    const perpendicularY = dx;
    const magnitude = Math.max(Math.hypot(perpendicularX, perpendicularY), 1);
    const bend = Math.sin(node.fieldAngle ?? this.visualTime) * 13 * influence;
    const controlX = (node.x + core.x) * 0.5 + perpendicularX / magnitude * bend;
    const controlY = (node.y + core.y) * 0.5 + perpendicularY / magnitude * bend;
    context.save();
    context.strokeStyle = hexToRgba(color, 0.12 + influence * 0.42);
    context.lineWidth = 0.8 + influence * 2.2;
    context.setLineDash([2 + influence * 5, 7 - influence * 3]);
    context.lineDashOffset = -this.visualTime * (22 + influence * 46);
    context.beginPath();
    context.moveTo(node.x, node.y);
    context.quadraticCurveTo(controlX, controlY, core.x, core.y);
    context.stroke();
    context.restore();
  }

  drawNode(node, color, isPlayer, scale = 1) {
    const core = this.physics.core;
    const angleToCore = Math.atan2(core.y - node.y, core.x - node.x);
    const speed = Math.hypot(node.vx ?? 0, node.vy ?? 0);
    const stateEnergy = !isPlayer && [BOT_STATES.ATTACK, BOT_STATES.SCRAMBLE].includes(this.lastBotState) ? 1 : 0;
    const pulse = 1 + Math.sin(this.visualTime * (3.2 + stateEnergy * 2.4) + (isPlayer ? 0 : 1.7)) * 0.045;
    context.save();
    context.translate(node.x, node.y);
    context.rotate(angleToCore + Math.PI * 0.5);
    context.scale(scale * pulse, scale * pulse);

    const fieldAlpha = 0.08 + clamp(node.influence ?? 0, 0, 1) * 0.20;
    context.strokeStyle = hexToRgba(color, fieldAlpha);
    context.lineWidth = 1.2;
    context.setLineDash([2, 7]);
    context.lineDashOffset = -(node.fieldAngle ?? 0) * 9;
    context.beginPath();
    context.arc(0, 0, 48 + clamp(speed / 800, 0, 1) * 5, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    context.rotate((node.fieldAngle ?? 0) * (isPlayer ? 0.34 : -0.34));
    for (let index = 0; index < 3; index += 1) {
      context.save();
      context.rotate(index * Math.PI * 2 / 3);
      context.fillStyle = index === 0 ? color : hexToRgba(color, 0.58);
      context.strokeStyle = index === 0 ? COLORS.bone : hexToRgba(COLORS.bone, 0.28);
      context.lineWidth = 1.1;
      context.beginPath();
      context.moveTo(-7, -14);
      context.quadraticCurveTo(-23, -32, -9, -43);
      context.lineTo(0, -31);
      context.lineTo(9, -43);
      context.quadraticCurveTo(23, -32, 7, -14);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }
    context.fillStyle = "#07080d";
    context.strokeStyle = hexToRgba(color, 0.94);
    context.lineWidth = 4;
    context.beginPath();
    context.arc(0, 0, RIFTBALL_CONSTANTS.NODE_RADIUS - 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = COLORS.bone;
    context.beginPath();
    context.moveTo(0, -9);
    context.lineTo(7, 6);
    context.lineTo(0, 3);
    context.lineTo(-7, 6);
    context.closePath();
    context.fill();
    context.restore();
  }

  drawTrail() {
    if (this.trail.length < 2) return;
    const speed = Math.hypot(this.physics.core.vx, this.physics.core.vy);
    const visibleCount = Math.min(this.trail.length, Math.round(10 + clamp(speed / 720, 0, 1) * 22));
    for (let ribbon = -1; ribbon <= 1; ribbon += 2) {
      context.beginPath();
      for (let index = 0; index < visibleCount; index += 1) {
        const point = this.trail[index];
        const next = this.trail[Math.min(index + 1, visibleCount - 1)] ?? point;
        const dx = point.x - next.x;
        const dy = point.y - next.y;
        const magnitude = Math.max(Math.hypot(dx, dy), 1);
        const offset = (3.8 + Math.sin(this.visualTime * 12 - index * 0.7) * 1.4) * ribbon;
        const x = point.x - dy / magnitude * offset;
        const y = point.y + dx / magnitude * offset;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      const influence = this.trail[0]?.influence ?? 0;
      const baseColor = influence > 0.08 ? COLORS.amber : influence < -0.08 ? COLORS.violet : COLORS.bone;
      context.strokeStyle = hexToRgba(baseColor, 0.18 + clamp(speed / 720, 0, 1) * 0.38);
      context.lineWidth = 1.3 + clamp(speed / 720, 0, 1) * 2.4;
      context.lineCap = "round";
      context.stroke();
    }
    context.lineCap = "butt";
  }

  drawCore(x, y, scale = 1) {
    const speed = Math.hypot(this.physics.core.vx, this.physics.core.vy);
    const stretch = clamp(speed / 760, 0, 1);
    const velocityAngle = Math.atan2(this.physics.core.vy, this.physics.core.vx);
    context.save();
    context.translate(x, y);
    context.rotate(velocityAngle);
    context.scale(scale * (1 + stretch * 0.23), scale * (1 - stretch * 0.09));
    const halo = context.createRadialGradient(0, 0, 4, 0, 0, 34);
    halo.addColorStop(0, "rgba(255,246,216,0.40)");
    halo.addColorStop(0.42, "rgba(255,238,178,0.10)");
    halo.addColorStop(1, "rgba(255,246,216,0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, 35, 0, Math.PI * 2);
    context.fill();

    const body = context.createRadialGradient(-4, -5, 2, 0, 0, 16);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.38, COLORS.bone);
    body.addColorStop(0.73, "#d1c79e");
    body.addColorStop(0.77, "#292934");
    body.addColorStop(1, "#0c0d12");
    context.fillStyle = body;
    context.beginPath();
    context.arc(0, 0, RIFTBALL_CONSTANTS.CORE_RADIUS + 2.5, 0, Math.PI * 2);
    context.fill();

    context.rotate(-velocityAngle + this.physics.core.rotation);
    for (let index = 0; index < 4; index += 1) {
      context.save();
      context.rotate(index * Math.PI / 2);
      context.fillStyle = index % 2 ? COLORS.violet : COLORS.amber;
      context.globalAlpha = 0.82;
      context.beginPath();
      context.moveTo(-2, -9);
      context.lineTo(2, -9);
      context.lineTo(5, -3);
      context.lineTo(0, -5);
      context.lineTo(-5, -3);
      context.closePath();
      context.fill();
      context.restore();
    }
    context.globalAlpha = 1;
    context.fillStyle = "#11121a";
    context.beginPath();
    context.arc(0, 0, 3.4, 0, Math.PI * 2);
    context.fill();

    context.rotate(this.visualTime * 1.7);
    context.strokeStyle = hexToRgba(COLORS.bone, 0.74);
    context.lineWidth = 1.3;
    context.setLineDash([7, 9]);
    context.beginPath();
    context.ellipse(0, 0, 24 + stretch * 6, 17, 0.3, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  drawFirstTouchCue() {
    const t = clamp(this.tutorialTimer / 3.2, 0, 1);
    const node = this.physics.nodes.player;
    const progress = (1 - t + Math.floor(this.visualTime * 0.8)) % 1;
    const targetX = lerp(node.x, this.physics.core.x, progress * 0.42);
    const targetY = lerp(node.y, Math.max(this.physics.core.y + 75, 535), progress * 0.42);
    context.save();
    context.globalAlpha = Math.min(0.62, t);
    context.strokeStyle = COLORS.bone;
    context.lineWidth = 1.4;
    context.setLineDash([4, 7]);
    context.beginPath();
    context.moveTo(node.x, node.y);
    context.lineTo(this.physics.core.x, this.physics.core.y + 54);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = hexToRgba(COLORS.bone, 0.16);
    context.strokeStyle = COLORS.amberHot;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(targetX, targetY, 17, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  drawParticles() {
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(Math.atan2(particle.vy, particle.vx));
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      if (particle.shape === "shard") {
        context.fillRect(-particle.size * 2, -particle.size * 0.45, particle.size * 4, particle.size * 0.9);
      } else {
        context.beginPath();
        context.arc(0, 0, particle.size, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
  }

  drawShockwaves() {
    for (const wave of this.shockwaves) {
      if (wave.delay > 0) continue;
      const progress = 1 - wave.life / wave.maxLife;
      const radius = lerp(wave.radius, wave.target, easeOutCubic(progress));
      context.save();
      context.globalAlpha = clamp(1 - progress, 0, 1) * 0.76;
      context.strokeStyle = wave.color;
      context.lineWidth = lerp(4, 0.8, progress);
      if (wave.dashed) context.setLineDash([8, 7]);
      context.beginPath();
      context.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }
}

const game = new RiftGame();
globalThis.__RIFTBALL__ = Object.freeze({
  build: BUILD_ID,
  identity: BUILD_IDENTITY,
  physics: game.physicsMode,
  candidate: CANDIDATE_CONFIGS[game.physicsMode].label,
  get state() { return game.state; },
  get scores() { return { ...game.scores }; },
  snapshot() {
    const snapshot = game.physics.snapshot();
    return {
      state: game.state,
      scores: { ...game.scores },
      botState: game.lastBotState,
      core: snapshot.core,
      nodes: snapshot.nodes,
      railsActive: snapshot.railsActive,
      matchPoint: snapshot.matchPoint,
      duelSurge: snapshot.duelSurge,
      overtimeOpen: snapshot.overtimeOpen,
    };
  },
});

setTimeout(() => {
  boot.classList.add("dismissed");
  setTimeout(() => { boot.hidden = true; }, 260);
}, 480);
