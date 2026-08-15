import { BOT_STATES } from "./bot.mjs";
import { ARENA, REFERENCE_HEIGHT, REFERENCE_WIDTH, RIFTBALL_CONSTANTS } from "./physics.mjs";

export const COLORS = Object.freeze({
  void: "#08070b",
  carbon: "#111118",
  smoke: "#25242d",
  chalk: "#fff8df",
  chalkDim: "#cfc9b7",
  amber: "#ff9e2d",
  amberHot: "#ffd166",
  amberDeep: "#a43f12",
  violet: "#7b4dff",
  violetHot: "#c0a7ff",
  violetDeep: "#2f176e",
  danger: "#ff3f59",
  cyan: "#80f7ef",
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
}

function easeInOut(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function rgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function polygon(context, points) {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath();
}

export class RiftRenderer {
  constructor(canvas, context, camera) {
    this.canvas = canvas;
    this.context = context;
    this.camera = camera;
  }

  draw(game) {
    const context = this.context;
    const scaleX = this.canvas.width / REFERENCE_WIDTH;
    const scaleY = this.canvas.height / REFERENCE_HEIGHT;
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.clearRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);
    context.save();
    if (game.shake > 0) {
      const amplitude = game.shake * 0.43;
      context.translate((Math.random() - 0.5) * amplitude, (Math.random() - 0.5) * amplitude);
    }

    this.#drawBackdrop(game);
    this.#drawArena(game);
    if (game.state === "MENU") this.#drawMenuScene(game);
    else if (game.state === "RESULTS") this.#drawResultScene(game);
    else this.#drawMatchScene(game);

    if (game.flash.alpha > 0) {
      context.globalAlpha = game.flash.alpha;
      context.fillStyle = game.flash.color;
      context.fillRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);
      context.globalAlpha = 1;
    }
    context.restore();
  }

  #project(x, y, z = 0) {
    return this.camera.project(x, y, z);
  }

  #drawBackdrop(game) {
    const context = this.context;
    const final = game.physics.matchPoint;
    const breakOpen = game.physics.overtimeOpen || 0;
    const background = context.createRadialGradient(195, 390, 24, 195, 430, 520);
    background.addColorStop(0, final ? "#24111e" : "#17131b");
    background.addColorStop(0.40, breakOpen > 0.05 ? "#15101a" : "#0d0c12");
    background.addColorStop(1, "#040307");
    context.fillStyle = background;
    context.fillRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);

    context.save();
    context.globalAlpha = 0.22 + game.crowdPulse * 0.12;
    for (let index = 0; index < 22; index += 1) {
      const y = 24 + index * 39;
      const offset = (index % 3) * 4;
      context.fillStyle = index % 2 ? rgba(COLORS.violet, 0.15) : rgba(COLORS.amber, 0.13);
      context.fillRect(0, y + offset, 5 + (index % 4), 21);
      context.fillRect(REFERENCE_WIDTH - 5 - (index % 4), y - offset, 5 + (index % 4), 21);
    }
    context.restore();
  }

  #drawArena(game) {
    this.#drawAudience(game);
    this.#drawArenaFloor(game);
    this.#drawSideArchitecture(game);
    this.#drawArenaLogo(game);
    if (game.physics.matchPoint) this.#drawFinalPointArchitecture(game);
    if (game.physics.overtimeOpen > 0.01) this.#drawRiftBreakGeometry(game);
  }

  #drawAudience(game) {
    const context = this.context;
    const pulse = game.crowdPulse;
    const finalPulse = game.physics.matchPoint ? 0.28 + Math.sin(game.visualTime * 5.2) * 0.12 : 0;
    for (let side = 0; side < 2; side += 1) {
      const direction = side ? 1 : -1;
      const innerX = side ? 370 : 20;
      const outerX = side ? 390 : 0;
      const gradient = context.createLinearGradient(innerX, 0, outerX, 0);
      gradient.addColorStop(0, "rgba(21,19,27,0.94)");
      gradient.addColorStop(1, "rgba(5,4,8,0.98)");
      context.fillStyle = gradient;
      polygon(context, [[innerX, 60], [outerX, 16], [outerX, 828], [innerX, 786]]);
      context.fill();
      for (let row = 0; row < 15; row += 1) {
        const y = 74 + row * 48;
        const width = 8 + (row % 3) * 2;
        const activity = clamp(0.12 + pulse * 0.55 + finalPulse + Math.sin(game.visualTime * 3 + row * 1.8) * 0.05, 0.04, 0.95);
        const color = row % 4 === 0 ? COLORS.chalk : side ? COLORS.violet : COLORS.amber;
        context.fillStyle = rgba(color, activity);
        context.fillRect(side ? 377 : 3, y, width, 4);
        context.fillStyle = rgba(color, activity * 0.42);
        context.fillRect(side ? 373 : 8, y + 9, 5, 2);
        context.fillRect(side ? 380 : 3, y + 15, 6, 2);
      }
      context.strokeStyle = rgba(side ? COLORS.violet : COLORS.amber, 0.18 + pulse * 0.22);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(innerX, 68);
      context.lineTo(innerX + direction * 13, 180);
      context.lineTo(innerX, 290);
      context.lineTo(innerX + direction * 13, 422);
      context.lineTo(innerX, 552);
      context.lineTo(innerX + direction * 13, 674);
      context.lineTo(innerX, 780);
      context.stroke();
    }
  }

  #drawArenaFloor(game) {
    const context = this.context;
    const topLeft = this.#project(ARENA.left, ARENA.topWall);
    const topRight = this.#project(ARENA.right, ARENA.topWall);
    const bottomRight = this.#project(ARENA.right, ARENA.bottomWall);
    const bottomLeft = this.#project(ARENA.left, ARENA.bottomWall);
    const floor = context.createLinearGradient(0, topLeft.y, 0, bottomLeft.y);
    floor.addColorStop(0, "#11101a");
    floor.addColorStop(0.48, "#0d0c12");
    floor.addColorStop(1, "#17120f");
    context.fillStyle = floor;
    polygon(context, [[topLeft.x, topLeft.y], [topRight.x, topRight.y], [bottomRight.x, bottomRight.y], [bottomLeft.x, bottomLeft.y]]);
    context.fill();

    const territoryBands = [
      { y0: ARENA.topWall, y1: 346, color: COLORS.violet },
      { y0: 346, y1: 498, color: COLORS.chalk },
      { y0: 498, y1: ARENA.bottomWall, color: COLORS.amber },
    ];
    for (const band of territoryBands) {
      const leftA = this.#project(ARENA.left + 2, band.y0);
      const rightA = this.#project(ARENA.right - 2, band.y0);
      const rightB = this.#project(ARENA.right - 2, band.y1);
      const leftB = this.#project(ARENA.left + 2, band.y1);
      const gradient = context.createLinearGradient(0, leftA.y, 0, leftB.y);
      gradient.addColorStop(0, rgba(band.color, band.color === COLORS.chalk ? 0.012 : 0.055));
      gradient.addColorStop(0.5, rgba(band.color, band.color === COLORS.chalk ? 0.022 : 0.025));
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      polygon(context, [[leftA.x, leftA.y], [rightA.x, rightA.y], [rightB.x, rightB.y], [leftB.x, leftB.y]]);
      context.fill();
    }

    context.save();
    context.lineWidth = 1;
    for (let y = 104; y <= 760; y += 47) {
      const left = this.#project(ARENA.left + 4, y);
      const right = this.#project(ARENA.right - 4, y);
      const central = Math.abs(y - 422) < 28;
      context.strokeStyle = central ? rgba(COLORS.chalk, 0.16) : "rgba(255,248,223,0.055)";
      context.beginPath();
      context.moveTo(left.x, left.y);
      context.lineTo(right.x, right.y);
      context.stroke();
    }
    for (let x = 53; x <= 337; x += 47) {
      const top = this.#project(x, ARENA.topWall + 1);
      const bottom = this.#project(x, ARENA.bottomWall - 1);
      context.strokeStyle = "rgba(255,248,223,0.052)";
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(bottom.x, bottom.y);
      context.stroke();
    }
    context.restore();

    const seamEnergy = 0.13 + game.physics.pressure * 0.18 + game.physics.overtimeOpen * 0.24;
    context.save();
    context.strokeStyle = rgba(COLORS.chalk, seamEnergy);
    context.lineWidth = 1.5;
    context.setLineDash([5, 11]);
    context.lineDashOffset = -game.visualTime * (24 + game.physics.pressure * 30);
    context.beginPath();
    for (let y = 75; y <= 790; y += 14) {
      const drift = Math.sin(y * 0.027 + game.visualTime * 1.8) * (2 + game.physics.overtimeOpen * 8);
      const point = this.#project(195 + drift, y);
      if (y === 75) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
    context.restore();
  }

  #drawSideArchitecture(game) {
    const context = this.context;
    const energy = 0.26 + game.physics.pressure * 0.23 + game.crowdPulse * 0.18;
    for (let side = 0; side < 2; side += 1) {
      const worldX = side ? ARENA.right : ARENA.left;
      const color = side ? COLORS.violet : COLORS.amber;
      for (let segment = 0; segment < 8; segment += 1) {
        const y = 102 + segment * 84;
        const top = this.#project(worldX, y);
        const bottom = this.#project(worldX, y + 59);
        const outward = side ? 16 : -16;
        context.fillStyle = segment % 2 ? "#17161d" : "#201e24";
        polygon(context, [[top.x, top.y], [top.x + outward, top.y + 8], [bottom.x + outward * 0.72, bottom.y - 6], [bottom.x, bottom.y]]);
        context.fill();
        context.strokeStyle = rgba(color, energy * (segment % 3 === 0 ? 1 : 0.5));
        context.lineWidth = segment % 3 === 0 ? 2 : 1;
        context.beginPath();
        context.moveTo(top.x + outward * 0.18, top.y + 10);
        context.lineTo(bottom.x + outward * 0.18, bottom.y - 10);
        context.stroke();
        if (segment % 2 === 0) {
          context.fillStyle = rgba(COLORS.chalk, 0.23 + game.crowdPulse * 0.3);
          context.fillRect(top.x + outward * 0.45 - (side ? 0 : 4), (top.y + bottom.y) * 0.5, 4, 2);
        }
      }
    }
  }

  #drawArenaLogo(game) {
    const context = this.context;
    const center = this.#project(195, 422);
    context.save();
    context.translate(center.x, center.y);
    context.scale(center.scale * 0.82, center.scale * 0.48);
    context.globalAlpha = 0.16 + game.physics.pressure * 0.08;
    context.strokeStyle = COLORS.chalk;
    context.lineWidth = 2;
    polygon(context, [[-53, -33], [-12, -25], [-25, 0], [-12, 25], [-53, 33], [-30, 0]]);
    context.stroke();
    polygon(context, [[53, -33], [12, -25], [25, 0], [12, 25], [53, 33], [30, 0]]);
    context.stroke();
    context.fillStyle = COLORS.chalk;
    polygon(context, [[0, -12], [9, 0], [0, 12], [-9, 0]]);
    context.fill();
    context.restore();
  }

  #drawFinalPointArchitecture(game) {
    const context = this.context;
    const pulse = 0.45 + Math.sin(game.visualTime * 6.2) * 0.16;
    context.save();
    context.fillStyle = rgba(COLORS.danger, 0.06 + pulse * 0.06);
    context.fillRect(0, 0, 9, REFERENCE_HEIGHT);
    context.fillRect(REFERENCE_WIDTH - 9, 0, 9, REFERENCE_HEIGHT);
    context.strokeStyle = rgba(COLORS.danger, pulse);
    context.lineWidth = 2;
    context.setLineDash([15, 16]);
    context.lineDashOffset = -game.visualTime * 54;
    context.beginPath();
    context.moveTo(11, 0);
    context.lineTo(11, REFERENCE_HEIGHT);
    context.moveTo(REFERENCE_WIDTH - 11, 0);
    context.lineTo(REFERENCE_WIDTH - 11, REFERENCE_HEIGHT);
    context.stroke();
    context.restore();
  }

  #drawRiftBreakGeometry(game) {
    const context = this.context;
    const open = easeOutCubic(game.physics.overtimeOpen);
    const center = this.#project(195, 422);
    context.save();
    context.strokeStyle = rgba(COLORS.danger, 0.20 + open * 0.36);
    context.lineWidth = 1.5;
    for (let branch = -1; branch <= 1; branch += 2) {
      context.beginPath();
      context.moveTo(center.x, center.y - 108);
      context.lineTo(center.x + branch * 11 * open, center.y - 44);
      context.lineTo(center.x + branch * 4 * open, center.y + 8);
      context.lineTo(center.x + branch * 16 * open, center.y + 74);
      context.lineTo(center.x + branch * 7 * open, center.y + 138);
      context.stroke();
    }
    context.restore();
  }

  #drawMenuScene(game) {
    const time = game.menuTime;
    const core = {
      x: 202 + Math.sin(time * 1.5) * 28,
      y: 397 + Math.cos(time * 1.22) * 23,
      vx: 470 + Math.cos(time) * 120,
      vy: -290 + Math.sin(time * 1.3) * 90,
      rotation: time * 2.4,
    };
    const hero = { x: 111 + Math.sin(time * 0.82) * 8, y: 639 + Math.cos(time * 1.1) * 7, vx: 240, vy: -120, influence: 0.72, authority: 0.94, fieldHeat: 0.08, fieldAngle: time * 2.2, tetherActive: true, tetherCharge: 0.74 };
    const wraith = { x: 278 + Math.cos(time * 0.91) * 9, y: 225 + Math.sin(time * 1.18) * 8, vx: -170, vy: 110, influence: 0.52, authority: 0.82, fieldHeat: 0.12, fieldAngle: -time * 2.6, tetherActive: false, tetherCharge: 0.18 };
    this.#drawReactor(game, 195, ARENA.topReactorY, false, 1, COLORS.violet, { impact: 0.16, collapse: 0 });
    this.#drawReactor(game, 195, ARENA.bottomReactorY, true, 0, COLORS.amber, { impact: 0, collapse: 0 });
    this.#drawMenuWake(core, time);
    this.#drawGravityLink(game, hero, COLORS.amber, core);
    this.#drawGravityLink(game, wraith, COLORS.violet, core);
    this.#drawRiderShadow(hero, 1.15);
    this.#drawRiderShadow(wraith, 1.08);
    this.#drawRider(game, wraith, "bot", core, 1.08);
    this.#drawRider(game, hero, "player", core, 1.15);
    this.#drawCore(game, core, 1.22);
  }

  #drawMenuWake(core, time) {
    const context = this.context;
    const head = this.#project(core.x, core.y, 12);
    context.save();
    for (let ribbon = -1; ribbon <= 1; ribbon += 2) {
      const gradient = context.createLinearGradient(head.x - 130, head.y + 90, head.x, head.y);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.52, rgba(ribbon < 0 ? COLORS.amber : COLORS.violet, 0.18));
      gradient.addColorStop(1, rgba(COLORS.chalk, 0.62));
      context.strokeStyle = gradient;
      context.lineWidth = 2.4;
      context.beginPath();
      context.moveTo(head.x - 128, head.y + 78 + ribbon * 16);
      context.bezierCurveTo(head.x - 84, head.y + 60 + Math.sin(time * 2) * 7, head.x - 42, head.y + ribbon * 12, head.x, head.y);
      context.stroke();
    }
    context.restore();
  }

  #drawMatchScene(game) {
    this.#drawReactors(game);
    this.#drawRiftFins(game);
    this.#drawCoreTrail(game);
    this.#drawDangerPath(game);
    this.#drawFieldDeformation(game);

    let playerNode = game.physics.nodes.player;
    let botNode = game.physics.nodes.bot;
    let coreScale = 1;
    if (game.state === "MATCH_INTRO") {
      const progress = 1 - game.matchIntro / Math.max(game.introDuration, 0.001);
      const arrive = easeOutCubic(clamp(progress * 1.5, 0, 1));
      playerNode = { ...playerNode, y: lerp(835, playerNode.y, arrive), vx: 0, vy: -260 * (1 - arrive) };
      botNode = { ...botNode, y: lerp(8, botNode.y, arrive), vx: 0, vy: 230 * (1 - arrive) };
      coreScale = easeOutCubic(clamp((progress - 0.35) * 2.4, 0, 1));
    }

    this.#drawGravityLink(game, playerNode, COLORS.amber, game.physics.core);
    this.#drawGravityLink(game, botNode, COLORS.violet, game.physics.core);
    this.#drawRiderShadow(playerNode);
    this.#drawRiderShadow(botNode);
    this.#drawRider(game, botNode, "bot", game.physics.core);
    this.#drawRider(game, playerNode, "player", game.physics.core);
    this.#drawParticles(game);
    this.#drawShockwaves(game);
    if (coreScale > 0.02) this.#drawCore(game, game.physics.core, coreScale);
    this.#drawDangerVignette(game);
    if (game.state === "MATCH_INTRO") this.#drawMatchIntro(game);
  }

  #drawResultScene(game) {
    this.#drawReactors(game);
    const victory = game.scores.player > game.scores.bot;
    const winner = victory ? "player" : "bot";
    const source = game.physics.nodes[winner];
    const core = { x: victory ? 240 : 150, y: 276, vx: victory ? 200 : -200, vy: -80, rotation: game.visualTime * 1.8 };
    const node = {
      ...source,
      x: victory ? 142 : 248,
      y: 292 + Math.sin(game.visualTime * 2.3) * 5,
      vx: victory ? 55 : -55,
      vy: -20,
      influence: 0.58,
      authority: 1,
      tetherActive: true,
      tetherCharge: 0.55,
      fieldAngle: game.visualTime * 2,
    };
    this.#drawGravityLink(game, node, victory ? COLORS.amber : COLORS.violet, core);
    this.#drawRiderShadow(node, 1.42);
    this.#drawRider(game, node, winner, core, 1.42);
    this.#drawParticles(game);
    this.#drawShockwaves(game);
    this.#drawCore(game, core, 1.16);
  }

  #drawReactors(game) {
    this.#drawReactor(game, 195, ARENA.topReactorY, false, game.scores.player, COLORS.violet, game.reactorFx.bot);
    this.#drawReactor(game, 195, ARENA.bottomReactorY, true, game.scores.bot, COLORS.amber, game.reactorFx.player);
  }

  #drawReactor(game, x, y, facingUp, damage, color, fx) {
    const context = this.context;
    const point = this.#project(x, y, 4);
    const danger = facingUp ? game.danger.player : game.danger.bot;
    const finalEnergy = game.physics.matchPoint ? 0.20 + Math.sin(game.visualTime * 6.1) * 0.07 : 0;
    const pulse = 1 + Math.sin(game.visualTime * (game.physics.matchPoint ? 7 : 2.8) + (facingUp ? 1.3 : 0)) * (0.025 + danger * 0.035);
    const impact = fx?.impact || 0;
    const collapse = fx?.collapse || 0;
    const breakScale = 1 + game.physics.overtimeOpen * 0.34;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(facingUp ? Math.PI : 0);
    context.scale(point.scale * pulse * breakScale * (1 + impact * 0.10), point.scale * pulse * (1 - collapse * 0.18));

    context.fillStyle = "rgba(0,0,0,0.45)";
    context.beginPath();
    context.ellipse(0, 22, 82, 25, 0, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = rgba(color, 0.40 + danger * 0.35 + finalEnergy);
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, 72, Math.PI * 0.10, Math.PI * 0.90);
    context.stroke();
    context.strokeStyle = "#34313a";
    context.lineWidth = 9;
    context.beginPath();
    context.arc(0, -1, 80, Math.PI * 0.08, Math.PI * 0.92);
    context.stroke();

    for (let side = -1; side <= 1; side += 2) {
      context.save();
      context.scale(side, 1);
      context.fillStyle = "#242129";
      context.strokeStyle = rgba(color, 0.42 + impact * 0.4);
      context.lineWidth = 1.5;
      polygon(context, [[37, -3], [67, 5], [86, 26], [73, 42], [48, 27]]);
      context.fill();
      context.stroke();
      context.fillStyle = rgba(color, 0.24 + danger * 0.24);
      polygon(context, [[51, 8], [68, 13], [77, 24], [65, 27]]);
      context.fill();
      context.restore();
    }

    for (let index = 0; index < 3; index += 1) {
      const offset = (index - 1) * 39;
      const broken = index < damage;
      const shardDrift = broken ? (index - 1) * 3 + collapse * (index - 1) * 9 : 0;
      context.save();
      context.translate(offset + shardDrift, 4 + Math.abs(index - 1) * 5 + (broken ? collapse * 8 : 0));
      context.rotate((index - 1) * 0.16 + (broken ? (index - 1 || 1) * collapse * 0.18 : 0));
      const segment = context.createLinearGradient(0, 0, 0, 38);
      segment.addColorStop(0, broken ? "#171219" : rgba(COLORS.chalk, 0.66));
      segment.addColorStop(0.32, broken ? rgba(COLORS.danger, 0.16) : rgba(color, 0.78));
      segment.addColorStop(1, broken ? "#211118" : rgba(color, 0.23));
      context.fillStyle = segment;
      context.strokeStyle = broken ? rgba(COLORS.danger, 0.64) : rgba(color, 0.94);
      context.lineWidth = 1.5;
      polygon(context, [[-16, 0], [-12, 24], [0, 38], [12, 24], [16, 0], [6, 7], [0, 2], [-6, 7]]);
      context.fill();
      context.stroke();
      if (broken) {
        context.strokeStyle = COLORS.danger;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(-8, 8);
        context.lineTo(3, 15);
        context.lineTo(-3, 24);
        context.lineTo(7, 32);
        context.stroke();
      } else {
        context.fillStyle = COLORS.chalk;
        context.globalAlpha = 0.7 + danger * 0.3;
        polygon(context, [[0, 9], [5, 17], [0, 26], [-5, 17]]);
        context.fill();
      }
      context.restore();
    }

    const aperture = context.createRadialGradient(0, 19, 2, 0, 19, 39);
    aperture.addColorStop(0, rgba(game.physics.matchPoint ? COLORS.danger : color, 0.62 + danger * 0.30));
    aperture.addColorStop(0.23, "#fff8df");
    aperture.addColorStop(0.29, "#08070b");
    aperture.addColorStop(0.72, "#020205");
    aperture.addColorStop(1, "rgba(2,2,5,0)");
    context.fillStyle = aperture;
    context.beginPath();
    context.ellipse(0, 19, 51, 25, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  #drawRiftFins(game) {
    if (game.finDeploy <= 0.01) return;
    const context = this.context;
    const deploy = easeOutCubic(game.finDeploy);
    for (const rail of game.physics.rails) {
      const anchorWorld = rail.side === "left" ? { x: rail.ax, y: rail.ay } : { x: rail.bx, y: rail.by };
      const freeWorld = rail.side === "left" ? { x: rail.bx, y: rail.by } : { x: rail.ax, y: rail.ay };
      const free = {
        x: lerp(anchorWorld.x, freeWorld.x, deploy),
        y: lerp(anchorWorld.y, freeWorld.y, deploy),
      };
      const anchor = this.#project(anchorWorld.x, anchorWorld.y, 5);
      const end = this.#project(free.x, free.y, 5);
      const gradient = context.createLinearGradient(anchor.x, anchor.y, end.x, end.y);
      gradient.addColorStop(0, rgba(rail.side === "left" ? COLORS.amber : COLORS.violet, 0.86));
      gradient.addColorStop(0.5, COLORS.chalk);
      gradient.addColorStop(1, rgba(rail.side === "left" ? COLORS.violet : COLORS.amber, 0.86));
      context.lineCap = "round";
      context.strokeStyle = "#26232b";
      context.lineWidth = 17 * anchor.scale;
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.strokeStyle = gradient;
      context.lineWidth = 3 * anchor.scale;
      context.stroke();
      context.fillStyle = "#0a090d";
      context.strokeStyle = rgba(COLORS.chalk, 0.66);
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(anchor.x, anchor.y, 10 * anchor.scale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = rail.side === "left" ? COLORS.amber : COLORS.violet;
      context.beginPath();
      context.arc(anchor.x, anchor.y, 3.5 * anchor.scale, 0, Math.PI * 2);
      context.fill();
    }
    context.lineCap = "butt";
  }

  #drawCoreTrail(game) {
    if (game.trail.length < 2) return;
    const context = this.context;
    const speed = Math.hypot(game.physics.core.vx, game.physics.core.vy);
    const visibleCount = Math.min(game.trail.length, Math.round(12 + clamp(speed / 760, 0, 1) * 26));
    for (let ribbon = -1; ribbon <= 1; ribbon += 1) {
      context.beginPath();
      for (let index = 0; index < visibleCount; index += 1) {
        const point = game.trail[index];
        const next = game.trail[Math.min(index + 1, visibleCount - 1)] ?? point;
        const projected = this.#project(point.x, point.y, 11);
        const projectedNext = this.#project(next.x, next.y, 11);
        const dx = projected.x - projectedNext.x;
        const dy = projected.y - projectedNext.y;
        const magnitude = Math.max(Math.hypot(dx, dy), 1);
        const wave = Math.sin(game.visualTime * 15 - index * 0.72) * 1.7;
        const offset = (ribbon * (4.6 + wave)) * (1 - index / visibleCount * 0.35);
        const x = projected.x - dy / magnitude * offset;
        const y = projected.y + dx / magnitude * offset;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      const influence = game.trail[0]?.influence ?? 0;
      const base = ribbon === 0 ? COLORS.chalk : influence > 0.07 ? COLORS.amber : influence < -0.07 ? COLORS.violet : ribbon < 0 ? COLORS.amber : COLORS.violet;
      context.strokeStyle = rgba(base, (ribbon === 0 ? 0.20 : 0.12) + clamp(speed / 760, 0, 1) * (ribbon === 0 ? 0.52 : 0.38));
      context.lineWidth = ribbon === 0 ? 1.5 + clamp(speed / 760, 0, 1) * 2.8 : 1.1 + clamp(speed / 760, 0, 1) * 2.1;
      context.lineCap = "round";
      context.stroke();
    }
    context.lineCap = "butt";
  }

  #drawDangerPath(game) {
    const threat = Math.max(game.danger.player, game.danger.bot);
    if (threat < 0.14) return;
    const context = this.context;
    const core = game.physics.core;
    const targetY = game.danger.player > game.danger.bot ? ARENA.bottomReactorY : ARENA.topReactorY;
    const start = this.#project(core.x, core.y, 13);
    const end = this.#project(195, targetY, 4);
    context.save();
    context.strokeStyle = rgba(COLORS.danger, 0.20 + threat * 0.48);
    context.lineWidth = 2 + threat * 2;
    context.setLineDash([5, 9]);
    context.lineDashOffset = -game.visualTime * 68;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo((start.x + end.x) * 0.5, (start.y + end.y) * 0.5, end.x, end.y);
    context.stroke();
    context.restore();
  }

  #drawFieldDeformation(game) {
    const context = this.context;
    const core = game.physics.core;
    const corePoint = this.#project(core.x, core.y, 3);
    for (const [owner, color] of [["player", COLORS.amber], ["bot", COLORS.violet]]) {
      const node = game.physics.nodes[owner];
      if (node.influence < 0.05) continue;
      const point = this.#project(node.x, node.y, 2);
      const influence = node.influence;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(node.fieldAngle * (owner === "player" ? 0.18 : -0.18));
      context.strokeStyle = rgba(color, 0.06 + influence * 0.18);
      context.lineWidth = 1;
      for (let ring = 0; ring < 3; ring += 1) {
        context.setLineDash([2 + ring * 2, 8 + ring * 3]);
        context.beginPath();
        context.ellipse(0, 0, (39 + ring * 15) * point.scale, (22 + ring * 10) * point.scale, ring * 0.35, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    }
    if (game.physics.contention > 0.13) {
      context.save();
      context.translate(corePoint.x, corePoint.y);
      context.rotate(game.visualTime * 1.9);
      context.strokeStyle = rgba(COLORS.cyan, 0.12 + game.physics.contention * 0.32);
      context.lineWidth = 1.2;
      context.setLineDash([3, 7]);
      context.beginPath();
      context.ellipse(0, 0, 33 + game.physics.contention * 18, 23 + game.physics.contention * 7, 0.4, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  #drawGravityLink(game, node, color, core) {
    const influence = clamp(node.influence ?? 0, 0, 1);
    if (influence < 0.025) return;
    const context = this.context;
    const from = this.#project(node.x, node.y, 15);
    const to = this.#project(core.x, core.y, 14);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const magnitude = Math.max(Math.hypot(dx, dy), 1);
    const normalX = -dy / magnitude;
    const normalY = dx / magnitude;
    const tether = node.tetherActive ? 1 : 0;
    const charge = node.tetherCharge || 0;
    const authority = node.authority ?? 1;
    context.save();
    for (let strand = -2; strand <= 2; strand += 1) {
      const wave = Math.sin((node.fieldAngle || game.visualTime) * 2.2 + strand * 1.7) * 5;
      const bend = strand * (3.2 + influence * 4.5) + wave * influence;
      const controlX = (from.x + to.x) * 0.5 + normalX * bend;
      const controlY = (from.y + to.y) * 0.5 + normalY * bend;
      context.strokeStyle = strand === 0
        ? rgba(COLORS.chalk, 0.16 + influence * 0.48 + tether * 0.20)
        : rgba(color, 0.05 + influence * 0.23 + tether * 0.12);
      context.lineWidth = strand === 0 ? 0.8 + influence * 1.8 + charge * 1.4 : 0.7 + influence * 0.8;
      context.setLineDash(strand === 0 && tether ? [] : [2 + influence * 4, 8 - influence * 3]);
      context.lineDashOffset = -game.visualTime * (24 + influence * 54 + strand * 2);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.quadraticCurveTo(controlX, controlY, to.x, to.y);
      context.stroke();
    }
    context.setLineDash([]);
    const dotCount = 2 + Math.round(influence * 4);
    for (let index = 0; index < dotCount; index += 1) {
      const t = (game.visualTime * (0.7 + authority * 0.5) + index / dotCount) % 1;
      const oneMinus = 1 - t;
      const bend = Math.sin((node.fieldAngle || 0) * 2) * 8 * influence;
      const controlX = (from.x + to.x) * 0.5 + normalX * bend;
      const controlY = (from.y + to.y) * 0.5 + normalY * bend;
      const x = oneMinus * oneMinus * from.x + 2 * oneMinus * t * controlX + t * t * to.x;
      const y = oneMinus * oneMinus * from.y + 2 * oneMinus * t * controlY + t * t * to.y;
      context.fillStyle = index % 2 ? color : COLORS.chalk;
      context.globalAlpha = 0.22 + influence * 0.55;
      context.beginPath();
      context.arc(x, y, 1.2 + charge * 1.1, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  #drawRiderShadow(node, scale = 1) {
    const context = this.context;
    const point = this.#project(node.x, node.y, 0);
    const speed = Math.hypot(node.vx || 0, node.vy || 0);
    context.save();
    context.translate(point.x + 3, point.y + 11 * point.scale);
    context.scale(scale * point.scale, scale * point.scale * 0.42);
    context.fillStyle = `rgba(0,0,0,${0.35 + clamp(speed / 900, 0, 1) * 0.12})`;
    context.beginPath();
    context.ellipse(0, 0, 35, 18, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  #drawRider(game, node, owner, core, extraScale = 1) {
    const isPlayer = owner === "player";
    const color = isPlayer ? COLORS.amber : COLORS.violet;
    const hot = isPlayer ? COLORS.amberHot : COLORS.violetHot;
    const fx = game.riderFx[isPlayer ? "player" : "bot"];
    const point = this.#project(node.x, node.y, 13);
    const corePoint = this.#project(core.x, core.y, 13);
    const angle = Math.atan2(corePoint.y - point.y, corePoint.x - point.x) + Math.PI * 0.5;
    const speed = Math.hypot(node.vx || 0, node.vy || 0);
    const speedN = clamp(speed / (isPlayer ? 900 : 680), 0, 1);
    const influence = clamp(node.influence || 0, 0, 1);
    const charge = clamp(node.tetherCharge || 0, 0, 1);
    const recoil = fx?.recoil || 0;
    const celebrate = fx?.celebrate || 0;
    const aggressive = !isPlayer && [BOT_STATES.PRESS, BOT_STATES.TRAP, BOT_STATES.SCRAMBLE].includes(game.lastBotState);
    const compression = 1 - recoil * 0.18;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(angle + (node.vx || 0) / 9000 + (aggressive ? Math.sin(game.visualTime * 9) * 0.018 : 0));
    context.scale(extraScale * point.scale * (1 + recoil * 0.12), extraScale * point.scale * compression);

    const engineLength = 12 + speedN * 20 + celebrate * 9;
    const engineGradient = context.createLinearGradient(0, 15, 0, 15 + engineLength);
    engineGradient.addColorStop(0, COLORS.chalk);
    engineGradient.addColorStop(0.28, hot);
    engineGradient.addColorStop(1, rgba(color, 0));
    context.fillStyle = engineGradient;
    if (isPlayer) {
      for (const offset of [-13, 13]) {
        polygon(context, [[offset - 4, 13], [offset + 4, 13], [offset + 2, 15 + engineLength], [offset, 21 + engineLength], [offset - 2, 15 + engineLength]]);
        context.fill();
      }
    } else {
      polygon(context, [[-5, 15], [5, 15], [2, 18 + engineLength], [0, 25 + engineLength], [-2, 18 + engineLength]]);
      context.fill();
      context.strokeStyle = rgba(color, 0.46);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-17, 10);
      context.lineTo(-25, 18 + engineLength * 0.55);
      context.moveTo(17, 10);
      context.lineTo(25, 18 + engineLength * 0.55);
      context.stroke();
    }

    if (influence > 0.03) {
      context.save();
      context.rotate((node.fieldAngle || 0) * (isPlayer ? 0.22 : -0.25));
      context.strokeStyle = rgba(color, 0.10 + influence * 0.24 + charge * 0.20);
      context.lineWidth = 1.2;
      context.setLineDash([3, 7]);
      context.beginPath();
      context.ellipse(0, 1, 43 + charge * 9, 35 + charge * 6, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    if (isPlayer) this.#drawHeroChassis(game, node, color, hot, speedN, influence, charge, fx);
    else this.#drawWraithChassis(game, node, color, hot, speedN, influence, charge, fx);
    context.restore();
  }

  #drawHeroChassis(game, node, color, hot, speed, influence, charge, fx) {
    const context = this.context;
    const armOpen = 4 + influence * 8 + charge * 6;
    const brake = clamp((Math.abs(node.vx || 0) + Math.abs(node.vy || 0)) / 1000, 0, 1);
    for (let side = -1; side <= 1; side += 2) {
      context.save();
      context.scale(side, 1);
      context.rotate(-side * armOpen * Math.PI / 180);
      const shell = context.createLinearGradient(8, -20, 29, 24);
      shell.addColorStop(0, COLORS.chalk);
      shell.addColorStop(0.14, hot);
      shell.addColorStop(0.42, color);
      shell.addColorStop(1, COLORS.amberDeep);
      context.fillStyle = shell;
      context.strokeStyle = rgba(COLORS.chalk, 0.72);
      context.lineWidth = 1.1;
      polygon(context, [[5, -23], [20, -18], [31, -2], [27, 20], [13, 29], [8, 14], [14, 2]]);
      context.fill();
      context.stroke();
      context.fillStyle = "#151118";
      polygon(context, [[17, -10], [25, -1], [22, 13], [13, 17], [15, 2]]);
      context.fill();
      context.fillStyle = rgba(COLORS.chalk, 0.50 + speed * 0.4);
      polygon(context, [[25, 1], [30, 5], [27, 15], [23, 12]]);
      context.fill();
      context.save();
      context.translate(20, 18);
      context.rotate(side * brake * 0.26);
      context.fillStyle = rgba(color, 0.72);
      polygon(context, [[-3, 0], [7, 2], [10, 12], [0, 8]]);
      context.fill();
      context.restore();
      context.restore();
    }

    const body = context.createLinearGradient(-10, -29, 11, 29);
    body.addColorStop(0, COLORS.chalk);
    body.addColorStop(0.18, "#5c5550");
    body.addColorStop(0.33, "#171319");
    body.addColorStop(1, "#09080c");
    context.fillStyle = body;
    context.strokeStyle = rgba(COLORS.chalk, 0.68);
    context.lineWidth = 1.2;
    polygon(context, [[0, -34], [11, -20], [14, 12], [7, 29], [0, 22], [-7, 29], [-14, 12], [-11, -20]]);
    context.fill();
    context.stroke();

    const canopy = context.createLinearGradient(0, -20, 0, 12);
    canopy.addColorStop(0, COLORS.chalk);
    canopy.addColorStop(0.22, hot);
    canopy.addColorStop(0.48, rgba(color, 0.9));
    canopy.addColorStop(1, "#26130d");
    context.fillStyle = canopy;
    polygon(context, [[0, -24], [7, -13], [6, 9], [0, 15], [-6, 9], [-7, -13]]);
    context.fill();

    context.fillStyle = COLORS.chalk;
    polygon(context, [[0, -38], [5, -28], [0, -24], [-5, -28]]);
    context.fill();
    context.fillStyle = rgba(color, 0.58 + influence * 0.34);
    context.beginPath();
    context.arc(0, 10, 6 + charge * 2, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = COLORS.chalk;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(0, 10, 8 + charge * 4, 0, Math.PI * 2);
    context.stroke();

    if ((node.fieldHeat || 0) > 0.35) {
      context.fillStyle = rgba(COLORS.danger, (node.fieldHeat - 0.35) * 1.1);
      context.fillRect(-11, 18, 22, 3);
    }
    if ((fx?.flash || 0) > 0) {
      context.globalAlpha = fx.flash * 0.45;
      context.fillStyle = COLORS.chalk;
      polygon(context, [[0, -39], [31, -2], [10, 30], [-10, 30], [-31, -2]]);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  #drawWraithChassis(game, node, color, hot, speed, influence, charge, fx) {
    const context = this.context;
    const aggression = [BOT_STATES.PRESS, BOT_STATES.TRAP, BOT_STATES.SCRAMBLE].includes(game.lastBotState) ? 1 : 0;
    const bladeSpread = 1 + influence * 0.16 + aggression * 0.10;
    for (let side = -1; side <= 1; side += 2) {
      context.save();
      context.scale(side * bladeSpread, 1);
      const blade = context.createLinearGradient(6, -28, 33, 22);
      blade.addColorStop(0, COLORS.chalk);
      blade.addColorStop(0.13, hot);
      blade.addColorStop(0.34, color);
      blade.addColorStop(1, COLORS.violetDeep);
      context.fillStyle = blade;
      context.strokeStyle = rgba(COLORS.violetHot, 0.70);
      context.lineWidth = 1.1;
      polygon(context, [[3, -30], [16, -24], [30, -6], [35, 18], [22, 12], [12, -2], [9, 29], [2, 20]]);
      context.fill();
      context.stroke();
      context.fillStyle = "#0e0b13";
      polygon(context, [[12, -18], [25, -4], [27, 10], [18, 4], [10, -3]]);
      context.fill();
      context.strokeStyle = rgba(hot, 0.44 + aggression * 0.35);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(15, -16);
      context.lineTo(26, -3);
      context.lineTo(29, 12);
      context.stroke();
      context.restore();
    }

    const spine = context.createLinearGradient(0, -34, 0, 31);
    spine.addColorStop(0, COLORS.chalk);
    spine.addColorStop(0.15, color);
    spine.addColorStop(0.52, "#171020");
    spine.addColorStop(1, "#08070b");
    context.fillStyle = spine;
    context.strokeStyle = rgba(hot, 0.68);
    context.lineWidth = 1.1;
    polygon(context, [[0, -38], [8, -23], [7, 19], [0, 34], [-7, 19], [-8, -23]]);
    context.fill();
    context.stroke();

    context.fillStyle = hot;
    polygon(context, [[0, -29], [5, -19], [2, 6], [0, 13], [-2, 6], [-5, -19]]);
    context.fill();
    context.fillStyle = "#09070d";
    context.beginPath();
    context.arc(0, 9, 7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = rgba(color, 0.68 + charge * 0.3);
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 9, 9 + charge * 4, -Math.PI * 0.82, Math.PI * 0.82);
    context.stroke();
    if ((fx?.flash || 0) > 0) {
      context.globalAlpha = fx.flash * 0.42;
      context.fillStyle = hot;
      polygon(context, [[0, -41], [38, 18], [8, 24], [0, 36], [-8, 24], [-38, 18]]);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  #drawCore(game, core, extraScale = 1) {
    const context = this.context;
    const point = this.#project(core.x, core.y, 17);
    const speed = Math.hypot(core.vx || 0, core.vy || 0);
    const stretch = clamp(speed / 820, 0, 1);
    const velocityAngle = this.camera.direction(core.x, core.y, core.vx || 1, core.vy || 0);
    const playerInfluence = game.physics.nodes.player.influence || 0;
    const botInfluence = game.physics.nodes.bot.influence || 0;
    const pressure = clamp(game.physics.pressure, 0, 1);
    const threat = Math.max(game.danger.player, game.danger.bot);
    context.save();
    context.translate(point.x, point.y);
    context.rotate(velocityAngle);
    context.scale(extraScale * point.scale * (1 + stretch * 0.23), extraScale * point.scale * (1 - stretch * 0.10));

    const halo = context.createRadialGradient(0, 0, 3, 0, 0, 42);
    halo.addColorStop(0, "rgba(255,248,223,0.58)");
    halo.addColorStop(0.28, rgba(threat > 0.4 ? COLORS.danger : COLORS.chalk, 0.16 + pressure * 0.09));
    halo.addColorStop(1, "rgba(255,248,223,0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, 43, 0, Math.PI * 2);
    context.fill();

    context.rotate(-velocityAngle + (core.rotation || 0));
    for (let index = 0; index < 3; index += 1) {
      context.save();
      context.rotate(index * Math.PI * 2 / 3 + game.visualTime * 0.22);
      const ownerColor = index === 0 ? COLORS.chalk : index === 1 ? COLORS.amber : COLORS.violet;
      context.fillStyle = rgba(ownerColor, 0.72 + pressure * 0.22);
      context.strokeStyle = COLORS.chalk;
      context.lineWidth = 0.9;
      polygon(context, [[-3, -13], [0, -24 - pressure * 4], [5, -15], [10, -8], [3, -9], [0, -5], [-3, -9], [-10, -8]]);
      context.fill();
      context.stroke();
      context.restore();
    }

    context.fillStyle = "#0a090e";
    context.strokeStyle = rgba(COLORS.chalk, 0.92);
    context.lineWidth = 2;
    polygon(context, [[0, -16], [13, -7], [12, 9], [0, 18], [-12, 9], [-13, -7]]);
    context.fill();
    context.stroke();

    const crystal = context.createLinearGradient(-7, -10, 7, 12);
    crystal.addColorStop(0, "#ffffff");
    crystal.addColorStop(0.36, COLORS.chalk);
    crystal.addColorStop(0.70, threat > 0.45 ? COLORS.danger : "#d4c89f");
    crystal.addColorStop(1, "#5f5747");
    context.fillStyle = crystal;
    polygon(context, [[0, -12], [8, -2], [5, 10], [0, 14], [-5, 10], [-8, -2]]);
    context.fill();
    context.fillStyle = "#ffffff";
    polygon(context, [[0, -9], [4, -2], [0, 2], [-4, -2]]);
    context.fill();

    context.lineWidth = 2;
    context.strokeStyle = rgba(COLORS.amber, 0.18 + playerInfluence * 0.82);
    context.beginPath();
    context.arc(0, 0, 21 + pressure * 3, Math.PI * 0.58, Math.PI * 1.48);
    context.stroke();
    context.strokeStyle = rgba(COLORS.violet, 0.18 + botInfluence * 0.82);
    context.beginPath();
    context.arc(0, 0, 21 + pressure * 3, -Math.PI * 0.42, Math.PI * 0.48);
    context.stroke();

    context.rotate(-(core.rotation || 0));
    if (stretch > 0.25) {
      context.strokeStyle = rgba(COLORS.chalk, 0.28 + stretch * 0.44);
      context.lineWidth = 1.4;
      context.beginPath();
      context.moveTo(-20, 0);
      context.lineTo(-33 - stretch * 15, 0);
      context.stroke();
    }
    context.restore();
  }

  #drawParticles(game) {
    const context = this.context;
    for (const particle of game.particles) {
      const point = this.#project(particle.x, particle.y, particle.z || 10);
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.save();
      context.translate(point.x, point.y);
      context.rotate(Math.atan2(particle.vy, particle.vx));
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      if (particle.shape === "shard") {
        polygon(context, [[-particle.size * 2.3, -particle.size * 0.35], [particle.size * 2.2, -particle.size * 0.7], [particle.size * 1.4, particle.size * 0.55], [-particle.size * 1.8, particle.size * 0.42]]);
        context.fill();
      } else {
        context.beginPath();
        context.arc(0, 0, particle.size * point.scale, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
  }

  #drawShockwaves(game) {
    const context = this.context;
    for (const wave of game.shockwaves) {
      if (wave.delay > 0) continue;
      const point = this.#project(wave.x, wave.y, 12);
      const progress = 1 - wave.life / wave.maxLife;
      const radius = lerp(wave.radius, wave.target, easeOutCubic(progress)) * point.scale;
      context.save();
      context.translate(point.x, point.y);
      context.scale(1, 0.72);
      context.globalAlpha = clamp(1 - progress, 0, 1) * 0.78;
      context.strokeStyle = wave.color;
      context.lineWidth = lerp(4.2, 0.7, progress);
      if (wave.dashed) context.setLineDash([8, 7]);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  #drawDangerVignette(game) {
    const context = this.context;
    const threat = Math.max(game.danger.player, game.danger.bot);
    if (threat < 0.05) return;
    const gradient = context.createRadialGradient(195, 422, 190, 195, 422, 470);
    gradient.addColorStop(0, "rgba(255,63,89,0)");
    gradient.addColorStop(0.72, "rgba(255,63,89,0)");
    gradient.addColorStop(1, rgba(COLORS.danger, 0.10 + threat * 0.18));
    context.fillStyle = gradient;
    context.fillRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT);
  }

  #drawMatchIntro(game) {
    if (!game.introLong) return;
    const context = this.context;
    const progress = 1 - game.matchIntro / Math.max(game.introDuration, 0.001);
    const opacity = progress < 0.22 ? progress / 0.22 : progress > 0.82 ? (1 - progress) / 0.18 : 1;
    const label = progress < 0.38 ? "RIFTBALL" : progress < 0.72 ? "YOU  /  WRAITH" : "BREAK THE REACTOR";
    context.save();
    context.globalAlpha = clamp(opacity, 0, 1);
    context.fillStyle = "rgba(8,7,11,0.76)";
    context.fillRect(43, 374, 304, 62);
    context.strokeStyle = rgba(COLORS.chalk, 0.34);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(58, 374);
    context.lineTo(332, 374);
    context.moveTo(58, 436);
    context.lineTo(332, 436);
    context.stroke();
    context.fillStyle = progress > 0.70 ? COLORS.amberHot : COLORS.chalk;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `900 ${progress < 0.38 ? 25 : 13}px Inter, sans-serif`;
    context.letterSpacing = "2px";
    context.fillText(label, 195, 405);
    context.restore();
  }
}
