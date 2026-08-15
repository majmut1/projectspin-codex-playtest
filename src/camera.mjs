import {
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./physics.mjs";

export const CAMERA_MODES = Object.freeze({
  SIDELINE: "sideline",
  WIDE: "wide",
  ARENA: "arena",
});

export const CAMERA_CANDIDATES = Object.freeze({
  [CAMERA_MODES.SIDELINE]: Object.freeze({
    label: "PREMIUM SIDELINE",
    paddingX: 39,
    laneScale: 0.84,
    objectScale: 0.88,
    centerLift: 0,
  }),
  [CAMERA_MODES.WIDE]: Object.freeze({
    label: "TACTICAL WIDE",
    paddingX: 22,
    laneScale: 0.76,
    objectScale: 0.82,
    centerLift: 0,
  }),
  [CAMERA_MODES.ARENA]: Object.freeze({
    label: "RIFT ARENA BROADCAST",
    paddingX: 52,
    laneScale: 0.87,
    objectScale: 0.91,
    centerLift: -4,
  }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class CameraRig {
  constructor(mode = CAMERA_MODES.ARENA) {
    this.mode = CAMERA_CANDIDATES[mode] ? mode : CAMERA_MODES.ARENA;
    this.config = CAMERA_CANDIDATES[this.mode];
  }

  scaleAt(worldY) {
    const axis = clamp(worldY / WORLD_HEIGHT, 0, 1);
    const centerFocus = 1 - Math.abs(axis - 0.5) * 2;
    return this.config.objectScale + centerFocus * 0.055;
  }

  project(worldX, worldY, z = 0) {
    const axis = clamp(worldY / WORLD_HEIGHT, 0, 1);
    const usableWidth = REFERENCE_WIDTH - this.config.paddingX * 2;
    const screenX = this.config.paddingX + (1 - axis) * usableWidth;
    const arenaBow = Math.sin(axis * Math.PI) * this.config.centerLift;
    const scale = this.scaleAt(worldY);
    return {
      x: screenX,
      y: REFERENCE_HEIGHT * 0.5
        + (worldX - WORLD_WIDTH * 0.5) * this.config.laneScale
        + arenaBow
        - z * scale * 0.72,
      scale,
    };
  }

  unproject(screenX, screenY) {
    const usableWidth = REFERENCE_WIDTH - this.config.paddingX * 2;
    const axis = clamp(1 - (screenX - this.config.paddingX) / Math.max(usableWidth, 0.001), 0, 1);
    const worldY = axis * WORLD_HEIGHT;
    const arenaBow = Math.sin(axis * Math.PI) * this.config.centerLift;
    return {
      x: clamp(WORLD_WIDTH * 0.5 + (screenY - REFERENCE_HEIGHT * 0.5 - arenaBow) / this.config.laneScale, 0, WORLD_WIDTH),
      y: worldY,
    };
  }

  screenDriveToWorld(x, y) {
    return { x: y, y: -x };
  }

  direction(x, y, vx, vy) {
    const start = this.project(x, y);
    const end = this.project(x + vx * 0.04, y + vy * 0.04);
    return Math.atan2(end.y - start.y, end.x - start.x);
  }
}
