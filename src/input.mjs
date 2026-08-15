export const POWER_DIRECTIONS = Object.freeze({
  UP: "rush",
  RIGHT: "bend",
  DOWN: "grip",
  LEFT: "pulse",
});

export const POWER_DEFINITIONS = Object.freeze({
  rush: Object.freeze({
    id: "rush",
    label: "RUSH",
    shortLabel: "RUSH",
    direction: "up",
    icon: "»",
    color: "#ff6b35",
    cost: 48,
    description: "FINISH",
    role: "offensive-finisher",
  }),
  bend: Object.freeze({
    id: "bend",
    label: "BEND",
    shortLabel: "BEND",
    direction: "right",
    icon: "↷",
    color: "#67f5e8",
    cost: 34,
    description: "ANGLE",
    role: "angle-tool",
  }),
  grip: Object.freeze({
    id: "grip",
    label: "GRIP",
    shortLabel: "GRIP",
    direction: "down",
    icon: "⌁",
    color: "#6aa8ff",
    cost: 30,
    description: "CAPTURE",
    role: "control-possession",
  }),
  pulse: Object.freeze({
    id: "pulse",
    label: "PULSE",
    shortLabel: "PULSE",
    direction: "left",
    icon: "◉",
    color: "#e66cff",
    cost: 40,
    description: "COUNTER",
    role: "defensive-displacement",
  }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function radialPowerFromVector(dx, dy, deadZone = 34) {
  const distance = Math.hypot(dx, dy);
  if (distance < deadZone) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? POWER_DIRECTIONS.RIGHT : POWER_DIRECTIONS.LEFT;
  return dy > 0 ? POWER_DIRECTIONS.DOWN : POWER_DIRECTIONS.UP;
}

export class DualThumbInput {
  constructor({ joystickRadius = 50, radialDeadZone = 46, holdDelay = 108 } = {}) {
    this.joystickRadius = joystickRadius;
    this.radialDeadZone = radialDeadZone;
    this.holdDelay = holdDelay;
    this.move = this.#freshMove();
    this.action = this.#freshAction();
  }

  #freshMove() {
    return {
      pointerId: null,
      centerX: 0,
      centerY: 0,
      x: 0,
      y: 0,
      magnitude: 0,
    };
  }

  #freshAction() {
    return {
      pointerId: null,
      startedAt: 0,
      radialOpen: false,
      selectedPower: null,
      dx: 0,
      dy: 0,
    };
  }

  beginMove(pointerId, centerX, centerY, x = centerX, y = centerY) {
    if (this.move.pointerId !== null) return false;
    this.move.pointerId = pointerId;
    this.move.centerX = centerX;
    this.move.centerY = centerY;
    this.updateMove(pointerId, x, y);
    return true;
  }

  updateMove(pointerId, x, y) {
    if (pointerId !== this.move.pointerId) return null;
    const dx = x - this.move.centerX;
    const dy = y - this.move.centerY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > this.joystickRadius ? this.joystickRadius / Math.max(distance, 0.001) : 1;
    const limitedX = dx * scale;
    const limitedY = dy * scale;
    this.move.x = limitedX / this.joystickRadius;
    this.move.y = limitedY / this.joystickRadius;
    this.move.magnitude = clamp(distance / this.joystickRadius, 0, 1);
    return { x: this.move.x, y: this.move.y, magnitude: this.move.magnitude, pixelX: limitedX, pixelY: limitedY };
  }

  endMove(pointerId) {
    if (pointerId !== this.move.pointerId) return false;
    this.move = this.#freshMove();
    return true;
  }

  beginAction(pointerId, now) {
    if (this.action.pointerId !== null) return false;
    this.action = this.#freshAction();
    this.action.pointerId = pointerId;
    this.action.startedAt = now;
    return true;
  }

  openRadial(pointerId) {
    if (pointerId !== this.action.pointerId || this.action.radialOpen) return false;
    this.action.radialOpen = true;
    return true;
  }

  updateAction(pointerId, x, y, centerX, centerY, now) {
    if (pointerId !== this.action.pointerId) return null;
    if (!this.action.radialOpen && now - this.action.startedAt >= this.holdDelay) this.action.radialOpen = true;
    this.action.dx = x - centerX;
    this.action.dy = y - centerY;
    this.action.selectedPower = this.action.radialOpen
      ? radialPowerFromVector(this.action.dx, this.action.dy, this.radialDeadZone)
      : null;
    return {
      radialOpen: this.action.radialOpen,
      selectedPower: this.action.selectedPower,
      dx: this.action.dx,
      dy: this.action.dy,
    };
  }

  endAction(pointerId, now) {
    if (pointerId !== this.action.pointerId) return null;
    const elapsed = now - this.action.startedAt;
    const result = this.action.radialOpen
      ? this.action.selectedPower
        ? { type: "power-fire", power: this.action.selectedPower, elapsed }
        : { type: "strike", power: null, elapsed, fromCenter: true }
      : { type: "strike", power: null, elapsed, fromCenter: false };
    this.action = this.#freshAction();
    return result;
  }

  cancelAction(pointerId = this.action.pointerId) {
    if (pointerId !== this.action.pointerId) return false;
    this.action = this.#freshAction();
    return true;
  }

  cancelAll() {
    this.move = this.#freshMove();
    this.action = this.#freshAction();
  }

  snapshot() {
    return {
      move: { ...this.move },
      action: { ...this.action },
    };
  }
}
