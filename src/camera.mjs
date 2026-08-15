import { REFERENCE_HEIGHT, REFERENCE_WIDTH } from "./physics.mjs";

export const CAMERA_MODES = Object.freeze({
  FLAT: "flat",
  PIT: "pit",
  BROADCAST: "broadcast",
});

export const CAMERA_CANDIDATES = Object.freeze({
  [CAMERA_MODES.FLAT]: Object.freeze({ label: "PREMIUM FLAT", yOffset: 0, yScale: 1, topScale: 1, bottomScale: 1 }),
  [CAMERA_MODES.PIT]: Object.freeze({ label: "PERSPECTIVE PIT", yOffset: 41, yScale: 0.902, topScale: 0.76, bottomScale: 1.03 }),
  [CAMERA_MODES.BROADCAST]: Object.freeze({ label: "HYBRID BROADCAST", yOffset: 24, yScale: 0.947, topScale: 0.87, bottomScale: 1.02 }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class CameraRig {
  constructor(mode = CAMERA_MODES.BROADCAST) {
    this.mode = CAMERA_CANDIDATES[mode] ? mode : CAMERA_MODES.BROADCAST;
    this.config = CAMERA_CANDIDATES[this.mode];
  }

  scaleAt(y) {
    const t = clamp(y / REFERENCE_HEIGHT, 0, 1);
    return this.config.topScale + (this.config.bottomScale - this.config.topScale) * t;
  }

  project(x, y, z = 0) {
    const scale = this.scaleAt(y);
    return {
      x: REFERENCE_WIDTH * 0.5 + (x - REFERENCE_WIDTH * 0.5) * scale,
      y: this.config.yOffset + y * this.config.yScale - z * scale,
      scale,
    };
  }

  unproject(x, y) {
    const worldY = clamp((y - this.config.yOffset) / this.config.yScale, 0, REFERENCE_HEIGHT);
    const scale = this.scaleAt(worldY);
    return {
      x: REFERENCE_WIDTH * 0.5 + (x - REFERENCE_WIDTH * 0.5) / Math.max(scale, 0.001),
      y: worldY,
    };
  }

  direction(x, y, vx, vy) {
    const start = this.project(x, y);
    const end = this.project(x + vx * 0.04, y + vy * 0.04);
    return Math.atan2(end.y - start.y, end.x - start.x);
  }
}
