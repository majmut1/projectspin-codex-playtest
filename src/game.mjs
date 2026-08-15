import { RiftAudio } from "./audio.mjs";
import { BOT_STATES, RiftBot } from "./bot.mjs";
import { CAMERA_CANDIDATES, CAMERA_MODES, CameraRig } from "./camera.mjs";
import { DualThumbInput, POWER_DEFINITIONS } from "./input.mjs";
import {
  ARENA,
  CANDIDATE_CONFIGS,
  PHYSICS_MODES,
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  RiftPhysics,
} from "./physics.mjs";
import { COLORS, RiftRenderer } from "./renderer.mjs?v=RIFT-20260815.6-r1";
import { RiftTelemetry, telemetryHealth } from "./telemetry.mjs";

const BUILD_ID = "RIFT-20260815.6";
const BUILD_IDENTITY = `CODEX • RIFTBALL • ${BUILD_ID}`;
const FIXED_STEP = 1 / 120;
const WIN_SCORE = 3;
const ONBOARDING_KEY = "riftball-landscape-onboarding-v1";

const GAME_STATES = Object.freeze({
  MENU: "MENU",
  MATCH_INTRO: "MATCH_INTRO",
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
const controls = document.getElementById("controls");
const results = document.getElementById("results");
const playButton = document.getElementById("play-button");
const replayButton = document.getElementById("replay-button");
const homeButton = document.getElementById("home-button");
const soundButton = document.getElementById("sound-button");
const movePad = document.getElementById("move-pad");
const moveStick = document.getElementById("move-stick");
const actionCluster = document.getElementById("action-cluster");
const actionButton = document.getElementById("action-button");
const actionIcon = document.getElementById("action-icon");
const actionLabel = document.getElementById("action-label");
const fluxReadout = document.getElementById("flux-readout");
const fluxValue = document.getElementById("flux-value");
const powerOptions = [...document.querySelectorAll(".power-option")];
const playerScoreLabel = document.getElementById("player-score");
const botScoreLabel = document.getElementById("bot-score");
const playerPips = document.getElementById("player-pips");
const botPips = document.getElementById("bot-pips");
const statusCall = document.getElementById("status");
const onboardingCall = document.getElementById("onboarding");
const onboardingLabel = onboardingCall.querySelector("span");
const duelMeter = document.querySelector("#duel-meter span");
const territoryMarker = document.querySelector("#territory-readout span");
const matchPointFlag = document.getElementById("match-point-flag");
const matchPointLabel = matchPointFlag.querySelector("span");
const resultTitle = document.getElementById("result-title");
const resultScore = document.getElementById("result-score");
const resultStats = document.getElementById("result-stats");

for (const element of document.querySelectorAll(".build-identity, .game-build")) element.textContent = BUILD_IDENTITY;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatSeconds(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function createPips(container) {
  container.replaceChildren();
  for (let index = 0; index < WIN_SCORE; index += 1) container.append(document.createElement("i"));
}

createPips(playerPips);
createPips(botPips);

class RiftGame {
  constructor() {
    const search = new URLSearchParams(location.search);
    const requestedPhysics = search.get("physics");
    const requestedCamera = search.get("camera");
    this.physicsMode = CANDIDATE_CONFIGS[requestedPhysics] ? requestedPhysics : PHYSICS_MODES.DRIVE;
    this.cameraMode = CAMERA_CANDIDATES[requestedCamera] ? requestedCamera : CAMERA_MODES.ARENA;
    this.physics = new RiftPhysics({ mode: this.physicsMode, seed: 15473 });
    this.bot = new RiftBot(8819, "wraith");
    this.audio = new RiftAudio();
    this.camera = new CameraRig(this.cameraMode);
    this.renderer = new RiftRenderer(canvas, context, this.camera);
    this.telemetry = new RiftTelemetry({ build: BUILD_ID, physics: this.physicsMode, camera: this.cameraMode });
    this.input = new DualThumbInput({ joystickRadius: 50, radialDeadZone: 46, holdDelay: 108 });

    this.state = GAME_STATES.MENU;
    this.scores = { player: 0, bot: 0 };
    this.stats = this.#freshStats();
    this.flux = { player: 100, bot: 100 };
    this.lastFluxDisplay = -1;
    this.matchStartedAt = 0;
    this.matchIntro = 0;
    this.introDuration = 0;
    this.introLong = true;
    this.introCoreCue = false;
    this.roundIntro = 0;
    this.goalTimer = 0;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.menuTime = 0;
    this.visualTime = 0;
    this.soundEnabled = true;
    this.statusExpires = 0;
    this.hitStop = 0;
    this.coreTrailBoost = 0;
    this.trail = [];
    this.trailSampleTimer = 0;
    this.particles = [];
    this.shockwaves = [];
    this.flash = { alpha: 0, color: COLORS.chalk };
    this.shake = 0;
    this.crowdPulse = 0;
    this.finDeploy = 0;
    this.goalOwner = null;
    this.roundLaunchDirection = "neutral";
    this.pendingResult = false;
    this.resultVictory = false;
    this.railsAnnounced = false;
    this.matchPointAnnounced = false;
    this.lastBotState = BOT_STATES.PROBE;
    this.devicePixelRatio = 1;
    this.radialTimer = null;
    this.radialSelection = null;
    this.riderFx = {
      player: { recoil: 0, flash: 0, celebrate: 0, power: 0 },
      bot: { recoil: 0, flash: 0, celebrate: 0, power: 0 },
    };
    this.reactorFx = {
      player: { impact: 0, collapse: 0 },
      bot: { impact: 0, collapse: 0 },
    };
    this.danger = { player: 0, bot: 0 };
    this.onboardingStage = sessionStorage.getItem(ONBOARDING_KEY) === "done" ? "done" : "move";
    this.onboardingMoveSeconds = 0;
    this.lastTelemetry = null;
    this.qaEnabled = search.get("qa") === "1";
    this.qaScene = this.qaEnabled ? search.get("scene") : null;

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
      strikes: 0,
      powers: 0,
      whiffs: 0,
      rebounds: 0,
      maxChain: 0,
      longestDuel: 0,
      duelSeconds: [],
    };
  }

  #isInputLive() {
    return this.state === GAME_STATES.ROUND_INTRO || this.state === GAME_STATES.PLAYING;
  }

  #wireInput() {
    addEventListener("resize", () => this.resize(), { passive: true });
    addEventListener("orientationchange", () => this.resize(), { passive: true });
    addEventListener("blur", () => this.#cancelInput(), { passive: true });
    addEventListener("focus", () => this.audio.recover?.("focus"), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.#cancelInput();
      else this.audio.recover?.("visible");
    });

    movePad.addEventListener("pointerdown", (event) => {
      if (!this.#isInputLive()) return;
      event.preventDefault();
      const rect = movePad.getBoundingClientRect();
      if (!this.input.beginMove(event.pointerId, rect.left + rect.width * 0.5, rect.top + rect.height * 0.5, event.clientX, event.clientY)) return;
      movePad.setPointerCapture?.(event.pointerId);
      movePad.classList.add("engaged");
      this.telemetry.control("joystick-start");
      this.#updateMoveInput(event);
      this.audio.unlock();
    });
    movePad.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.input.move.pointerId) return;
      event.preventDefault();
      this.#updateMoveInput(event);
    });
    const releaseMove = (event) => {
      if (!this.input.endMove(event.pointerId)) return;
      this.physics.setNodeDrive("player", 0, 0, 0);
      movePad.classList.remove("engaged");
      moveStick.style.transform = "translate(-50%, -50%)";
    };
    movePad.addEventListener("pointerup", releaseMove);
    movePad.addEventListener("pointercancel", releaseMove);
    movePad.addEventListener("lostpointercapture", (event) => {
      if (event.pointerId === this.input.move.pointerId) releaseMove(event);
    });

    actionButton.addEventListener("pointerdown", (event) => {
      if (!this.#isInputLive()) return;
      event.preventDefault();
      if (!this.input.beginAction(event.pointerId, performance.now())) return;
      actionButton.setPointerCapture?.(event.pointerId);
      actionButton.classList.add("pressed");
      this.telemetry.control("action-press");
      this.audio.unlock();
      clearTimeout(this.radialTimer);
      this.radialTimer = setTimeout(() => {
        if (this.input.openRadial(event.pointerId)) {
          this.telemetry.control("radial-open");
          this.#renderRadialState();
          this.audio.radial?.();
        }
      }, this.input.holdDelay);
    });
    actionButton.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.input.action.pointerId) return;
      event.preventDefault();
      const rect = actionButton.getBoundingClientRect();
      const wasOpen = this.input.action.radialOpen;
      const previousPower = this.input.action.selectedPower;
      this.input.updateAction(event.pointerId, event.clientX, event.clientY, rect.left + rect.width * 0.5, rect.top + rect.height * 0.5, performance.now());
      if (!wasOpen && this.input.action.radialOpen) this.telemetry.control("radial-open");
      if (this.input.action.radialOpen && this.input.action.selectedPower !== previousPower) {
        this.audio.radialSelect?.(this.input.action.selectedPower);
        this.telemetry.control("radial-change", this.input.action.selectedPower);
      }
      this.#renderRadialState();
    });
    const releaseAction = (event) => {
      if (event.pointerId !== this.input.action.pointerId) return;
      event.preventDefault();
      clearTimeout(this.radialTimer);
      const rect = actionButton.getBoundingClientRect();
      this.input.updateAction(event.pointerId, event.clientX, event.clientY, rect.left + rect.width * 0.5, rect.top + rect.height * 0.5, performance.now());
      const result = this.input.endAction(event.pointerId, performance.now());
      this.#closeRadialUI();
      if (!result) return;
      if (result.type === "power-fire") this.#performStrike("player", result.power, { releaseToFire: true });
      else {
        if (result.fromCenter) this.telemetry.control("center-release");
        else this.telemetry.control("tap-strike");
        this.#performStrike("player", null);
      }
    };
    actionButton.addEventListener("pointerup", releaseAction);
    actionButton.addEventListener("pointercancel", (event) => this.#cancelAction(event.pointerId));
    actionButton.addEventListener("lostpointercapture", (event) => {
      if (event.pointerId === this.input.action.pointerId) this.#cancelAction(event.pointerId);
    });
    actionButton.addEventListener("click", (event) => event.preventDefault());

    playButton.addEventListener("click", async () => {
      await this.audio.unlock();
      this.audio.ui();
      this.startMatch(false);
    });
    replayButton.addEventListener("click", async () => {
      await this.audio.unlock();
      this.audio.ui();
      this.startMatch(true);
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

  #updateMoveInput(event) {
    const output = this.input.updateMove(event.pointerId, event.clientX, event.clientY);
    if (!output) return;
    moveStick.style.transform = `translate(calc(-50% + ${output.pixelX}px), calc(-50% + ${output.pixelY}px))`;
    const worldDrive = this.camera.screenDriveToWorld(output.x, output.y);
    this.physics.setNodeDrive("player", worldDrive.x, worldDrive.y, output.magnitude);
    const node = this.physics.nodes.player;
    this.telemetry.touch(node.x + worldDrive.x * output.magnitude * 28, node.y + worldDrive.y * output.magnitude * 28);
  }

  #cancelAction(pointerId = this.input.action.pointerId) {
    clearTimeout(this.radialTimer);
    if (pointerId !== null && pointerId === this.input.action.pointerId) this.telemetry.control("action-cancel");
    this.input.cancelAction(pointerId);
    this.#closeRadialUI();
  }

  #cancelInput() {
    clearTimeout(this.radialTimer);
    if (this.input.action.pointerId !== null) this.telemetry.control("action-cancel");
    this.input.cancelAll();
    this.physics.setNodeDrive("player", 0, 0, 0);
    movePad.classList.remove("engaged");
    moveStick.style.transform = "translate(-50%, -50%)";
    this.#closeRadialUI();
    this.accumulator = 0;
  }

  #renderRadialState() {
    const radialOpen = this.input.action.radialOpen;
    actionCluster.classList.toggle("open", radialOpen);
    actionCluster.classList.toggle("has-selection", radialOpen && Boolean(this.input.action.selectedPower));
    this.radialSelection = radialOpen ? this.input.action.selectedPower : null;
    const selectedDefinition = this.radialSelection ? POWER_DEFINITIONS[this.radialSelection] : null;
    if (selectedDefinition) actionCluster.style.setProperty("--selected-color", selectedDefinition.color);
    else actionCluster.style.removeProperty("--selected-color");
    if (radialOpen && this.onboardingStage === "powers") this.#updateOnboardingUI();
    for (const option of powerOptions) {
      const definition = POWER_DEFINITIONS[option.dataset.power];
      option.classList.toggle("selected", radialOpen && this.input.action.selectedPower === definition.id);
      option.classList.toggle("locked", this.flux.player + 0.01 < definition.cost);
    }
    if (radialOpen) {
      actionLabel.textContent = this.input.action.selectedPower
        ? POWER_DEFINITIONS[this.input.action.selectedPower].label
        : "FLICK";
      actionIcon.textContent = this.input.action.selectedPower
        ? POWER_DEFINITIONS[this.input.action.selectedPower].icon
        : "+";
    }
  }

  #closeRadialUI() {
    actionButton.classList.remove("pressed");
    actionCluster.classList.remove("open");
    actionCluster.classList.remove("has-selection");
    actionCluster.style.removeProperty("--selected-color");
    this.radialSelection = null;
    for (const option of powerOptions) option.classList.remove("selected");
    this.#updatePowerUI(true);
  }

  #performStrike(owner, requestedPower = null, { releaseToFire = false } = {}) {
    let power = requestedPower;
    const definition = power ? POWER_DEFINITIONS[power] : null;
    if (definition && this.flux[owner] + 0.01 < definition.cost) {
      power = null;
      if (owner === "player") {
        this.announce("LOW FLUX • STRIKE", 0.46);
        this.audio.denied?.();
        this.telemetry.control("power-denied", requestedPower);
      }
    }
    const fired = this.physics.requestStrike(owner, power);
    if (!fired) return false;
    if (power) this.flux[owner] = Math.max(0, this.flux[owner] - POWER_DEFINITIONS[power].cost);
    this.riderFx[owner].recoil = Math.max(this.riderFx[owner].recoil, power ? 0.66 : 0.42);
    if (owner === "player") {
      if (power) this.telemetry.control("power-fire", power);
      if (releaseToFire && power) this.audio.powerRelease?.(power);
      this.#updatePowerUI(true);
      if (power) this.announce(`${POWER_DEFINITIONS[power].label} • FIRE`, 0.34);
    }
    return true;
  }

  #updatePowerUI(force = false) {
    const roundedFlux = Math.round(this.flux.player);
    if (!force && roundedFlux === this.lastFluxDisplay) return;
    this.lastFluxDisplay = roundedFlux;
    actionCluster.style.setProperty("--flux", String(roundedFlux));
    fluxValue.textContent = String(roundedFlux);
    actionIcon.textContent = "◆";
    actionLabel.textContent = "STRIKE";
    actionButton.querySelector("small").textContent = "TAP";
    fluxReadout.querySelector("span").textContent = "FLUX";
    for (const option of powerOptions) {
      const definition = POWER_DEFINITIONS[option.dataset.power];
      option.classList.toggle("locked", this.flux.player + 0.01 < definition.cost);
    }
  }

  resize() {
    const rect = app.getBoundingClientRect();
    this.devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * this.devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * this.devicePixelRatio));
  }

  showMenu() {
    this.state = GAME_STATES.MENU;
    this.#cancelInput();
    this.trail.length = 0;
    this.particles.length = 0;
    this.shockwaves.length = 0;
    this.physics.resetRound("neutral");
    this.physics.setScoreContext(0, false);
    menu.hidden = false;
    hud.hidden = true;
    controls.hidden = true;
    results.hidden = true;
    onboardingCall.hidden = true;
    matchPointFlag.hidden = true;
  }

  startMatch(rematch = false) {
    this.scores.player = 0;
    this.scores.bot = 0;
    this.stats = this.#freshStats();
    this.flux.player = 100;
    this.flux.bot = 100;
    this.matchStartedAt = performance.now();
    this.railsAnnounced = false;
    this.matchPointAnnounced = false;
    this.pendingResult = false;
    this.goalOwner = null;
    this.finDeploy = 0;
    this.crowdPulse = 0.22;
    this.trail.length = 0;
    this.particles.length = 0;
    this.shockwaves.length = 0;
    this.physics.resetRound("neutral");
    this.physics.core.vx = 0;
    this.physics.core.vy = 0;
    this.physics.setScoreContext(0, false);
    this.bot.reset();
    this.telemetry.startMatch({ rematch, control: "dual-thumb-radial" });
    this.onboardingMoveSeconds = 0;
    this.introLong = !rematch;
    this.introDuration = rematch ? 0.36 : 1.86;
    this.matchIntro = this.introDuration;
    this.introCoreCue = false;
    this.state = GAME_STATES.MATCH_INTRO;
    menu.hidden = true;
    results.hidden = true;
    hud.hidden = false;
    controls.hidden = false;
    this.updateScoreUI();
    this.#updatePowerUI(true);
    this.#updateOnboardingUI();
    this.audio.intro();
    this.announce(rematch ? "RIFT LIVE" : "TWO THUMBS LINKED", rematch ? 0.32 : 0.66);
  }

  prepareRound(direction, fast = false) {
    this.state = GAME_STATES.ROUND_INTRO;
    this.roundIntro = fast ? 0.28 : 0.46;
    this.goalTimer = 0;
    this.goalOwner = null;
    this.roundLaunchDirection = direction;
    this.trail.length = 0;
    this.physics.resetRound(direction);
    this.physics.core.vx = 0;
    this.physics.core.vy = 0;
    this.bot.reset();
    this.#cancelInput();
    const totalGoals = this.scores.player + this.scores.bot;
    const matchPoint = this.scores.player === 2 || this.scores.bot === 2;
    const finalPoint = this.scores.player === 2 && this.scores.bot === 2;
    this.physics.setScoreContext(totalGoals, matchPoint);
    matchPointFlag.hidden = !matchPoint;
    matchPointLabel.textContent = finalPoint ? "FINAL POINT" : "MATCH POINT";
    if (finalPoint) this.announce("FINAL RIFT", 0.92);
    else if (matchPoint) this.announce("MATCH POINT", 0.82);
    else this.announce(totalGoals === 0 ? "BREAK THEIR REACTOR" : "CORE RESET", fast ? 0.30 : 0.48);
  }

  frame(time) {
    const realDelta = clamp((time - this.lastFrame) / 1000, 0, 0.05);
    this.lastFrame = time;
    this.telemetry.frame(realDelta * 1000);
    this.visualTime += realDelta;
    this.menuTime += this.state === GAME_STATES.MENU ? realDelta : 0;
    this.accumulator = Math.min(this.accumulator + realDelta, 0.12);
    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.updateVisualEffects(realDelta);
    this.renderer.draw(this);
    requestAnimationFrame((nextTime) => this.frame(nextTime));
  }

  fixedUpdate(dt) {
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      return;
    }

    if (this.state === GAME_STATES.MATCH_INTRO) {
      this.matchIntro -= dt;
      const progress = 1 - this.matchIntro / Math.max(this.introDuration, 0.001);
      if (!this.introCoreCue && progress > (this.introLong ? 0.42 : 0.18)) {
        this.introCoreCue = true;
        this.audio.coreForm();
      }
      if (this.matchIntro <= 0) this.prepareRound("neutral", true);
      return;
    }

    if (this.state === GAME_STATES.ROUND_INTRO) {
      this.roundIntro -= dt;
      this.physics.step(dt);
      this.physics.core.x = WORLD_WIDTH * 0.5;
      this.physics.core.y = WORLD_HEIGHT * 0.5;
      this.physics.core.vx = 0;
      this.physics.core.vy = 0;
      if (this.roundIntro <= 0) {
        this.state = GAME_STATES.PLAYING;
        this.physics.launch(this.roundLaunchDirection, 178);
        this.announce("CORE LIVE", 0.38);
      }
      return;
    }

    if (this.state === GAME_STATES.PLAYING) {
      this.flux.player = Math.min(100, this.flux.player + dt * 3.4);
      this.flux.bot = Math.min(100, this.flux.bot + dt * 3.1);
      this.#updatePowerUI();
      if (this.input.move.magnitude > 0.24 && this.onboardingStage === "move") {
        this.onboardingMoveSeconds += dt;
        if (this.onboardingMoveSeconds >= 0.42) {
          this.onboardingStage = "strike";
          this.#updateOnboardingUI();
        }
      }

      const matchPoint = this.scores.player === 2 || this.scores.bot === 2;
      this.lastBotState = this.bot.update(dt, this.physics, { scores: this.scores, matchPoint, botFlux: this.flux.bot });
      const botAction = this.bot.consumeAction();
      if (botAction) this.#performStrike("bot", botAction.power);

      const events = this.physics.step(dt);
      this.telemetry.sample(dt, this.physics);
      this.processPhysicsEvents(events);
      this.trailSampleTimer -= dt;
      if (this.trailSampleTimer <= 0) {
        this.trailSampleTimer = 1 / 60;
        this.trail.unshift({
          x: this.physics.core.x,
          y: this.physics.core.y,
          speed: Math.hypot(this.physics.core.vx, this.physics.core.vy),
          influence: this.physics.nodes.player.influence - this.physics.nodes.bot.influence,
          boost: this.coreTrailBoost,
        });
        if (this.trail.length > 40) this.trail.pop();
      }
      duelMeter.style.height = `${clamp(this.physics.pressure * 100, 0, 100)}%`;
      const territory = clamp((1 - this.physics.core.y / WORLD_HEIGHT) * 76 + 12, 12, 88);
      territoryMarker.style.left = `${territory}%`;
      return;
    }

    if (this.state === GAME_STATES.GOAL) {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        if (this.pendingResult) this.showResults();
        else this.prepareRound(this.goalOwner, false);
      }
    }
  }

  #updateOnboardingUI() {
    if (![GAME_STATES.MATCH_INTRO, GAME_STATES.ROUND_INTRO, GAME_STATES.PLAYING].includes(this.state) || this.onboardingStage === "done") {
      onboardingCall.hidden = true;
      return;
    }
    const messages = {
      move: "LEFT THUMB • MOVE",
      strike: "RIGHT THUMB • TAP TO STRIKE",
      powers: "HOLD • FLICK • RELEASE",
    };
    onboardingLabel.textContent = messages[this.onboardingStage] || "";
    onboardingCall.hidden = !messages[this.onboardingStage];
  }

  processPhysicsEvents(events) {
    for (const event of events) {
      this.telemetry.event(event);
      if (event.type === "field") continue;
      this.audio.event(event);

      if (event.type === "strike-start") {
        const fx = this.riderFx[event.owner];
        fx.recoil = Math.max(fx.recoil, event.power ? 0.70 : 0.46);
        fx.power = Math.max(fx.power, event.power ? 0.52 : 0.18);
      } else if (event.type === "strike") {
        this.spawnStrike(event);
        const fx = this.riderFx[event.owner];
        fx.flash = 1;
        fx.power = event.power ? 1 : 0.35;
        const contactLevel = event.power ? 4 : event.perfect ? 3 : event.clean ? 2 : 1;
        this.shake = Math.max(this.shake, [0, 4.6, 7.0, 9.2, 11.2][contactLevel]);
        this.hitStop = Math.max(this.hitStop, [0, 0.026, 0.038, 0.050, 0.056][contactLevel]);
        this.coreTrailBoost = Math.max(this.coreTrailBoost, [0, 0.46, 0.72, 0.90, 1][contactLevel]);
        this.crowdPulse = Math.max(this.crowdPulse, [0, 0.40, 0.58, 0.76, 0.88][contactLevel]);
        if (event.owner === "player") {
          this.stats.strikes += 1;
          if (event.power) this.stats.powers += 1;
          this.flux.player = Math.min(100, this.flux.player + (event.perfect ? 14 : event.clean ? 9 : 5));
          if (event.power) this.announce(`${POWER_DEFINITIONS[event.power].label} HIT`, 0.46);
          else if (event.perfect) this.announce("PERFECT STRIKE", 0.44);
          else if (event.clean) this.announce("CLEAN STRIKE", 0.34);
          if (this.onboardingStage === "strike") {
            this.onboardingStage = "powers";
            this.#updateOnboardingUI();
          } else if (event.power && this.onboardingStage === "powers") {
            this.onboardingStage = "done";
            sessionStorage.setItem(ONBOARDING_KEY, "done");
            this.#updateOnboardingUI();
          }
        }
      } else if (event.type === "strike-whiff") {
        if (event.owner === "player") this.stats.whiffs += 1;
      } else if (event.type === "grip-release") {
        this.coreTrailBoost = Math.max(this.coreTrailBoost, 0.58);
        this.spawnSling({ ...event, charge: 0.58 });
      } else if (event.type === "surge") {
        this.announce("RIFT UNSTABLE", 0.70);
        this.flash = { alpha: 0.10, color: COLORS.chalk };
        this.crowdPulse = Math.max(this.crowdPulse, 0.52);
        this.shockwaves.push(
          { x: WORLD_WIDTH * 0.5, y: ARENA.topReactorY, radius: 42, target: 120, life: 0.34, maxLife: 0.34, color: COLORS.violet, dashed: true },
          { x: WORLD_WIDTH * 0.5, y: ARENA.bottomReactorY, radius: 42, target: 120, life: 0.34, maxLife: 0.34, color: COLORS.amber, dashed: true },
        );
      } else if (event.type === "break") {
        this.announce("RIFT BREAK", 0.86);
        this.shake = Math.max(this.shake, 6.5);
        this.flash = { alpha: 0.18, color: COLORS.danger };
        this.crowdPulse = 0.82;
        this.shockwaves.push({ x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5, radius: 38, target: 215, life: 0.48, maxLife: 0.48, color: COLORS.chalk, dashed: true });
      } else if (event.type === "contest-break") {
        this.shockwaves.push({ x: this.physics.core.x, y: this.physics.core.y, radius: 14, target: 58, life: 0.18, maxLife: 0.18, color: COLORS.cyan, dashed: true });
      } else if (["intercept", "perfect", "clutch"].includes(event.type)) {
        this.spawnIntercept(event);
        const ownerFx = this.riderFx[event.owner];
        ownerFx.recoil = 1;
        ownerFx.flash = 1;
        this.shake = Math.max(this.shake, event.type === "clutch" ? 9 : event.type === "perfect" ? 5.5 : 2.4);
        this.stats.maxChain = Math.max(this.stats.maxChain, event.chain || 0);
        if (event.owner === "player" && event.defensive) this.stats.saves += 1;
        if (event.owner === "player" && event.perfect) this.stats.perfect += 1;
        if (event.type === "perfect") {
          this.hitStop = Math.max(this.hitStop, 0.026);
          this.crowdPulse = Math.max(this.crowdPulse, 0.70);
          if (event.owner === "player") {
            this.flux.player = Math.min(100, this.flux.player + 12);
            this.announce("PERFECT INTERCEPT", 0.58);
          }
        }
        if (event.owner === "player" && event.clutch) {
          this.stats.clutch += 1;
          this.flux.player = Math.min(100, this.flux.player + 18);
          this.hitStop = Math.max(this.hitStop, 0.042);
          this.crowdPulse = 1;
          this.announce("CLUTCH REVERSAL", 0.80);
          this.flash = { alpha: 0.24, color: COLORS.amberHot };
        }
      } else if (event.type === "sling") {
        if (event.owner === "player") this.stats.slings += 1;
        this.spawnSling(event);
        if (event.owner === "player" && event.charge > 0.64) this.announce("GRAV SLING", 0.40);
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
    const scoringFx = this.riderFx[event.owner];
    const targetReactor = event.owner === "player" ? this.reactorFx.bot : this.reactorFx.player;
    scoringFx.celebrate = 1;
    targetReactor.impact = 1;
    targetReactor.collapse = this.scores[event.owner] >= WIN_SCORE ? 1 : 0.56;
    if (event.owner === "player") {
      this.stats.goals += 1;
      this.flux.player = Math.min(100, this.flux.player + 16);
      this.announce(this.scores.player >= WIN_SCORE ? "REACTOR DESTROYED" : "REACTOR BREACH", 0.98);
    } else {
      this.announce(this.scores.bot >= WIN_SCORE ? "OUR REACTOR DESTROYED" : "REACTOR HIT", 0.98);
    }
    this.stats.longestDuel = Math.max(this.stats.longestDuel, event.roundTime);
    this.stats.duelSeconds.push(event.roundTime);
    this.updateScoreUI();
    this.state = GAME_STATES.GOAL;
    this.pendingResult = this.scores.player >= WIN_SCORE || this.scores.bot >= WIN_SCORE;
    this.goalTimer = this.pendingResult ? 1.18 : 0.88;
    this.shake = 17;
    this.crowdPulse = 1;
    this.flash = { alpha: 0.46, color: event.owner === "player" ? COLORS.amber : COLORS.violet };
    this.spawnGoal(event.owner, this.pendingResult);
    onboardingCall.hidden = true;

    const totalGoals = this.scores.player + this.scores.bot;
    const isMatchPoint = this.scores.player === 2 || this.scores.bot === 2;
    if (!this.pendingResult && totalGoals >= 2 && !isMatchPoint && !this.railsAnnounced) {
      this.railsAnnounced = true;
      setTimeout(() => {
        if (this.state !== GAME_STATES.RESULTS) this.announce("RIFT FINS ONLINE", 0.72);
      }, 320);
    }
    if (!this.pendingResult && isMatchPoint && !this.matchPointAnnounced) {
      this.matchPointAnnounced = true;
      this.audio.matchPoint();
    }
  }

  updateScoreUI() {
    playerScoreLabel.textContent = String(this.scores.player);
    botScoreLabel.textContent = String(this.scores.bot);
    [...playerPips.children].forEach((pip, index) => pip.classList.toggle("active", index < this.scores.bot));
    [...botPips.children].forEach((pip, index) => pip.classList.toggle("active", index < this.scores.player));
  }

  announce(message, duration = 0.6) {
    statusCall.textContent = message;
    statusCall.classList.add("visible");
    this.statusExpires = performance.now() + duration * 1000;
  }

  showResults() {
    this.state = GAME_STATES.RESULTS;
    this.#cancelInput();
    hud.hidden = true;
    controls.hidden = true;
    results.hidden = false;
    onboardingCall.hidden = true;
    matchPointFlag.hidden = true;
    const victory = this.scores.player > this.scores.bot;
    this.resultVictory = victory;
    resultTitle.textContent = victory ? "VICTORY" : "DEFEAT";
    resultTitle.style.color = victory ? COLORS.amberHot : COLORS.violetHot;
    const separator = document.createElement("i");
    resultScore.replaceChildren(document.createTextNode(`${this.scores.player}`), separator, document.createTextNode(`${this.scores.bot}`));
    const matchSeconds = (performance.now() - this.matchStartedAt) / 1000;
    const values = [
      [this.stats.strikes, "STRIKES"],
      [this.stats.powers, "POWER HITS"],
      [this.stats.perfect, "PERFECT"],
      [this.stats.clutch, "CLUTCH SAVES"],
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
    this.lastTelemetry = this.telemetry.finish(this.scores);
    this.audio.result(victory);
    this.spawnResult(victory);
  }

  spawnStrike(event) {
    const core = this.physics.core;
    const definition = event.power ? POWER_DEFINITIONS[event.power] : null;
    const color = definition?.color || (event.owner === "player" ? COLORS.amberHot : COLORS.violetHot);
    const count = event.power ? 25 : event.sweetSpot ? 17 : 11;
    const heading = Math.atan2(core.vy, core.vx);
    for (let index = 0; index < count; index += 1) {
      const spread = (Math.random() - 0.5) * (event.power === "pulse" ? 2.0 : 0.9);
      const angle = heading + Math.PI + spread;
      const speed = 95 + Math.random() * (event.power ? 250 : 150);
      this.particles.push({
        x: core.x,
        y: core.y,
        z: 13,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.24 + Math.random() * 0.23,
        maxLife: 0.48,
        color: index % 4 === 0 ? COLORS.chalk : color,
        size: 1.4 + Math.random() * (event.power ? 3.5 : 2.4),
        shape: index % 3 === 0 ? "shard" : "spark",
      });
    }
    this.shockwaves.push({ x: core.x, y: core.y, radius: 15, target: event.power ? 104 : 70, life: event.power ? 0.29 : 0.21, maxLife: event.power ? 0.29 : 0.21, color, dashed: Boolean(event.power) });
  }

  spawnIntercept(event) {
    const core = this.physics.core;
    const color = event.owner === "player" ? COLORS.amber : COLORS.violet;
    const count = event.type === "clutch" ? 26 : event.type === "perfect" ? 18 : 10;
    const direction = Math.atan2(core.vy, core.vx);
    for (let index = 0; index < count; index += 1) {
      const fan = (index / Math.max(count - 1, 1) - 0.5) * Math.PI * (event.type === "clutch" ? 1.5 : 1.1);
      const angle = direction + fan + (Math.random() - 0.5) * 0.18;
      const speed = (event.type === "clutch" ? 205 : 135) * (0.55 + Math.random() * 0.65);
      this.particles.push({ x: core.x, y: core.y, z: 12, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.30 + Math.random() * 0.20, maxLife: 0.50, color: index % 4 === 0 ? COLORS.chalk : color, size: 1.5 + Math.random() * 2.8, shape: index % 3 === 0 ? "shard" : "spark" });
    }
    this.shockwaves.push({ x: core.x, y: core.y, radius: 18, target: event.type === "clutch" ? 116 : 72, life: 0.30, maxLife: 0.30, color });
  }

  spawnSling(event) {
    const core = this.physics.core;
    const color = event.owner === "player" ? COLORS.amberHot : COLORS.violetHot;
    this.shockwaves.push({ x: core.x, y: core.y, radius: 20, target: 84 + event.charge * 52, life: 0.25, maxLife: 0.25, color, dashed: true });
  }

  spawnRebound(event) {
    const core = this.physics.core;
    const color = event.surface === "rift-fin" ? COLORS.cyan : COLORS.chalkDim;
    this.shockwaves.push({ x: core.x, y: core.y, radius: 8, target: event.surface === "rift-fin" ? 46 : 32, life: 0.16, maxLife: 0.16, color });
  }

  spawnGoal(owner, final) {
    const x = this.physics.core.x;
    const advance = this.physics.overtimeOpen * 84;
    const y = owner === "player" ? ARENA.topReactorY + advance : ARENA.bottomReactorY - advance;
    const color = owner === "player" ? COLORS.amber : COLORS.violet;
    for (let ring = 0; ring < (final ? 5 : 3); ring += 1) {
      this.shockwaves.push({ x, y, radius: 18 + ring * 9, target: 160 + ring * 25, life: 0.48 + ring * 0.07, maxLife: 0.48 + ring * 0.07, color: ring % 2 ? COLORS.chalk : color, delay: ring * 0.045 });
    }
    const count = final ? 76 : 52;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * index / count + Math.random() * 0.18;
      const speed = 110 + Math.random() * (final ? 340 : 270);
      this.particles.push({ x, y, z: 12 + Math.random() * 15, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.42 + Math.random() * (final ? 0.72 : 0.48), maxLife: final ? 1.14 : 0.90, color: index % 5 === 0 ? COLORS.chalk : index % 9 === 0 ? COLORS.danger : color, size: 2 + Math.random() * (final ? 5.5 : 4.2), shape: index % 2 ? "shard" : "spark" });
    }
  }

  spawnResult(victory) {
    const color = victory ? COLORS.amber : COLORS.violet;
    for (let index = 0; index < 42; index += 1) {
      this.particles.push({ x: 42 + Math.random() * 306, y: 170 + Math.random() * 504, z: 8 + Math.random() * 20, vx: (Math.random() - 0.5) * 105, vy: (Math.random() - 0.5) * 125, life: 1.0 + Math.random() * 0.9, maxLife: 1.9, color: index % 4 === 0 ? COLORS.chalk : color, size: 2 + Math.random() * 4, shape: "shard" });
    }
  }

  updateVisualEffects(dt) {
    if (performance.now() >= this.statusExpires) statusCall.classList.remove("visible");
    this.shake = Math.max(0, this.shake - dt * 40);
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2.0);
    this.coreTrailBoost = Math.max(0, this.coreTrailBoost - dt * 1.85);
    this.crowdPulse = Math.max(0, this.crowdPulse - dt * 0.82);
    this.finDeploy += (Number(this.physics.railsActive) - this.finDeploy) * Math.min(1, dt * 3.8);
    for (const fx of Object.values(this.riderFx)) {
      fx.recoil = Math.max(0, fx.recoil - dt * 7.5);
      fx.flash = Math.max(0, fx.flash - dt * 5.8);
      fx.celebrate = Math.max(0, fx.celebrate - dt * 1.8);
      fx.power = Math.max(0, fx.power - dt * 2.7);
    }
    for (const fx of Object.values(this.reactorFx)) {
      fx.impact = Math.max(0, fx.impact - dt * 2.7);
      fx.collapse = Math.max(0, fx.collapse - dt * 1.2);
    }
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.94, dt * 60);
      particle.vy *= Math.pow(0.96, dt * 60);
      particle.z = Math.max(0, (particle.z || 0) - dt * 7);
    }
    this.particles = this.particles.filter((particle) => particle.life > 0).slice(-240);
    for (const wave of this.shockwaves) {
      if (wave.delay > 0) wave.delay -= dt;
      else wave.life -= dt;
    }
    this.shockwaves = this.shockwaves.filter((wave) => wave.life > 0 || wave.delay > 0).slice(-32);

    const core = this.physics.core;
    const playerThreat = core.y > 594 && core.vy > 25 ? clamp((core.y - 594) / 190 + core.vy / 1050, 0, 1) : 0;
    const botThreat = core.y < 250 && core.vy < -25 ? clamp((250 - core.y) / 190 + -core.vy / 1050, 0, 1) : 0;
    this.danger.player += (playerThreat - this.danger.player) * Math.min(1, dt * 10);
    this.danger.bot += (botThreat - this.danger.bot) * Math.min(1, dt * 10);

    const speed = Math.hypot(core.vx, core.vy);
    const playerSpeed = Math.hypot(this.physics.nodes.player.vx, this.physics.nodes.player.vy);
    const botSpeed = Math.hypot(this.physics.nodes.bot.vx, this.physics.nodes.bot.vy);
    const threat = Math.max(this.danger.player, this.danger.bot);
    const phase = this.state === GAME_STATES.MENU
      ? "MENU"
      : this.state === GAME_STATES.RESULTS
        ? this.resultVictory ? "VICTORY" : "DEFEAT"
        : this.physics.matchPoint
          ? "MATCH_POINT"
          : this.physics.pressure > 0.56 || threat > 0.42
            ? "PRESSURE"
            : "DUEL";
    this.audio.update({ speed, playerField: this.physics.nodes.player.influence, botField: this.physics.nodes.bot.influence, playerSpeed, botSpeed, tension: this.physics.matchPoint ? 1 : this.physics.pressure, danger: threat, crowd: this.crowdPulse, contested: this.physics.contention, phase, active: this.state !== GAME_STATES.MENU || this.audio.unlocked });
  }

  activateQAScene(scene) {
    if (!this.qaEnabled) return false;
    if (scene === "menu" || !scene) {
      this.showMenu();
      return true;
    }
    this.startMatch(true);
    this.matchIntro = 0;
    this.physics.resetRound("neutral");
    this.state = GAME_STATES.PLAYING;
    if (scene === "controls") {
      this.flux.player = 82;
      this.#updatePowerUI(true);
      actionCluster.classList.add("open");
      for (const option of powerOptions) option.style.opacity = "1";
      this.physics.core.vx = 290;
      this.physics.core.vy = -190;
      return true;
    }
    if (scene === "matchpoint" || scene === "clutch") {
      this.scores.player = 2;
      this.scores.bot = 2;
      this.updateScoreUI();
      this.physics.setScoreContext(4, true);
      matchPointFlag.hidden = false;
      matchPointLabel.textContent = "FINAL POINT";
      if (scene === "clutch") {
        this.physics.core.x = 202;
        this.physics.core.y = 704;
        this.physics.core.vx = 88;
        this.physics.core.vy = 480;
        this.physics.nodes.player.x = 187;
        this.physics.nodes.player.y = 706;
      } else {
        this.physics.core.vx = 330;
        this.physics.core.vy = -260;
      }
      return true;
    }
    if (scene === "results") {
      this.scores.player = 3;
      this.scores.bot = 2;
      this.updateScoreUI();
      this.showResults();
      return true;
    }
    if (scene === "fins") {
      this.scores.player = 1;
      this.scores.bot = 1;
      this.updateScoreUI();
      this.physics.setScoreContext(2, false);
      this.finDeploy = 1;
      this.physics.core.vx = 420;
      this.physics.core.vy = -180;
      return true;
    }
    return false;
  }
}

const game = new RiftGame();
const publicApi = {
  build: BUILD_ID,
  identity: BUILD_IDENTITY,
  orientation: "landscape",
  control: "dual-thumb-joystick-radial",
  powerExecution: "hold-drag-release-fire",
  physics: game.physicsMode,
  candidate: CANDIDATE_CONFIGS[game.physicsMode].label,
  camera: game.cameraMode,
  presentation: CAMERA_CANDIDATES[game.cameraMode].label,
  powers: Object.values(POWER_DEFINITIONS).map((power) => ({ ...power })),
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
      contention: snapshot.contention,
      contestDominance: snapshot.contestDominance,
      camera: game.cameraMode,
      input: game.input.snapshot(),
      flux: { ...game.flux },
      audio: game.audio.diagnostics?.() || null,
    };
  },
  telemetry() {
    const data = game.telemetry.snapshot();
    return { ...data, lastHealth: telemetryHealth(game.lastTelemetry) };
  },
};
if (game.qaEnabled) publicApi.qa = (scene) => game.activateQAScene(scene);
globalThis.__RIFTBALL__ = Object.freeze(publicApi);

setTimeout(() => {
  boot.classList.add("dismissed");
  setTimeout(() => { boot.hidden = true; }, 260);
  if (game.qaScene) setTimeout(() => game.activateQAScene(game.qaScene), 60);
}, 480);
