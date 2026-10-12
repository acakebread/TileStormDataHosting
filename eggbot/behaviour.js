// Unity testbed timings and UV values, kept independent of the rendering engine.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// EggbotController.UpdateTurn/UpdateMove and SmoothingUtils.Ease.
export const movementEase = t => (1 - Math.cos(clamp(t, 0, 1) * Math.PI)) / 2;
const shortestTurn = (from, to) => ((to - from + 180) % 360 + 360) % 360 - 180;
export class GridJourney {
  constructor(position, yaw, target) {
    this.start = { x: position.x, z: position.z };
    this.target = { x: target.x, z: target.z };
    this.yaw = yaw;
    const heading = Math.atan2(target.x - position.x, target.z - position.z) * 180 / Math.PI;
    this.turn = shortestTurn(yaw, heading);
    this.turnDuration = Math.abs(this.turn) > 0.01 ? 0.25 : 0;
    // Half gameplay's speed suits this small preview grid.
    this.moveDuration = (Math.hypot(target.x - position.x, target.z - position.z) + 1) / 3;
    this.time = 0;
  }
  tick(delta) {
    this.time += Math.max(0, delta);
    const turn = movementEase(this.turnDuration ? this.time / this.turnDuration : 1);
    const move = movementEase((this.time - this.turnDuration) / this.moveDuration);
    return { x: this.start.x + (this.target.x - this.start.x) * move,
      z: this.start.z + (this.target.z - this.start.z) * move,
      yaw: this.yaw + this.turn * turn, done: this.time >= this.turnDuration + this.moveDuration };
  }
}
// Snapshot the camera at arrival: this turn never tracks later camera movement.
export class ArrivalTurn {
  constructor(position, yaw, camera) {
    const dx = camera.x - position.x, dz = camera.z - position.z;
    const heading = Math.hypot(dx, dz) > 0.0001 ? Math.atan2(dx, dz) * 180 / Math.PI : yaw;
    this.yaw = yaw;
    this.turn = shortestTurn(yaw, heading);
    this.duration = Math.abs(this.turn) > 0.01 ? 0.45 : 0;
    this.time = 0;
  }
  tick(delta) {
    this.time += Math.max(0, delta);
    return { yaw: this.yaw + this.turn * movementEase(this.duration ? this.time / this.duration : 1), done: this.time >= this.duration };
  }
}
export function dragAngles(yaw, pitch, dx, dy, orbit = false) {
  return {
    yaw: yaw + dx * 0.2 * (orbit ? -1 : 1),
    pitch: clamp(pitch + dy * 0.2, orbit ? 0 : -30, orbit ? 89.9 : 30)
  };
}
const smoothstep = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

// Manual tilt holds for two seconds after interaction, then eases upright in one.
export class TiltReturn {
  constructor() { this.set(0); }
  set(angle) { this.start = this.value = angle; this.time = 0; }
  tick(delta, held = false) {
    if (held) { this.set(this.value); return this.value; }
    if (Number.isFinite(delta) && delta > 0) this.time += delta;
    this.value = this.start * (1 - movementEase(this.time - 2));
    return this.value;
  }
}

// Gameplay EggbotController.UpdateSway uses 0.1 radians and these two rates.
// Glances and shoulder corrections are occasional eased additions for the preview.
export class IdleMotion {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() {
    this.time = this.armTime = this.glanceTime = 0;
    this.stationary = false;
    this.glanceSign = 1;
    this.nextGlance(); this.nextArms();
  }
  nextGlance() {
    this.glanceDelay = 0.6 + this.random() * 0.7;
    this.glanceDuration = 1.4 + this.random() * 0.6;
    this.glanceAngle = this.glanceSign * (22 + this.random() * 10) * Math.PI / 180;
    this.glanceSign *= -1;
  }
  nextArms() {
    this.armDelay = 0.4 + this.random() * 0.9;
    this.armDuration = 1.5 + this.random() * 0.8;
  }
  pulse(time, delay, duration) {
    const phase = clamp((time - delay) / duration, 0, 1);
    return Math.sin(Math.PI * phase) ** 2;
  }
  tick(delta, stationary = true) {
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    this.time += delta;
    const pitch = 0.1 * Math.sin(7.8 * this.time) * Math.sin(1.8 * this.time);
    this.armTime += delta;
    while (this.armTime >= this.armDelay + this.armDuration) {
      this.armTime -= this.armDelay + this.armDuration; this.nextArms();
    }
    if (stationary) {
      this.glanceTime += delta;
      while (this.glanceTime >= this.glanceDelay + this.glanceDuration) {
        this.glanceTime -= this.glanceDelay + this.glanceDuration; this.nextGlance();
      }
    } else {
      this.glanceTime = 0;
      // Restart the wait once per interruption, rather than once per frame.
      if (this.stationary) this.nextGlance();
    }
    this.stationary = stationary;
    const arms = this.pulse(this.armTime, this.armDelay, this.armDuration);
    return { pitch,
      yaw: stationary ? this.glanceAngle * this.pulse(this.glanceTime, this.glanceDelay, this.glanceDuration) : 0,
      leftShoulder: arms * (-pitch * 0.65 + 0.075),
      rightShoulder: arms * (-pitch * 0.65 - 0.06),
      shoulderLift: arms * 0.09 };
  }
}

export class BlinkClock {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() { this.index = 0; this.blinking = false; this.time = 0; this.duration = this.waitDuration(); }
  waitDuration() { return (this.index === 0 ? 3 : 5) * (0.9 + this.random() * 0.2); }
  get hold() { return this.index === 0 ? 0.10 : 0.15; }
  tick(delta) {
    if (!Number.isFinite(delta) || delta < 0) return this.weight;
    this.time += delta;
    while (this.time >= this.duration) {
      this.time -= this.duration;
      this.blinking = !this.blinking;
      if (this.blinking) this.duration = (0.10 + this.hold) * 0.6;
      else { this.index = 1 - this.index; this.duration = this.waitDuration(); }
    }
    return this.weight;
  }
  get weight() {
    if (!this.blinking) return 0;
    const time = this.time / 0.6;
    if (time < 0.05) return smoothstep(time / 0.05);
    if (time < 0.05 + this.hold) return 1;
    return 1 - smoothstep((time - 0.05 - this.hold) / 0.05);
  }
}

// Values use Unity's bottom-origin V. The rendering adapter flips V for glTF.
export function lidOffset(pupilY, blink, direction, textureHeight = 512) {
  const clearance = 1 / textureHeight;
  const limit = 0.5 - clearance;
  const min = direction > 0 ? 0 : -limit;
  const max = direction > 0 ? limit : 0;
  const follow = pupilY * 0.724;
  const rest = clamp(0.025 * (direction > 0 ? 4.5 : 0) * direction + follow * (direction > 0 ? 1 : 0.5), min, max);
  const target = 0.25 * direction + follow + 0.1 * 0.724;
  const closed = direction > 0 ? clamp(target, 2 * clearance, limit) : clamp(target, -limit, -2 * clearance);
  return clamp(rest + (closed - rest) * blink + blink * Math.max(0.005, clearance) * direction, min, max);
}

export const SEQUENCE = ['Idle_01', 'Console_Start', 'Console_Loop', 'Console_End'];
export class SequenceClock {
  constructor(clips) {
    this.durations = SEQUENCE.map(name => {
      const clip = clips.find(item => item.name === name);
      if (!clip) throw new Error(`Sequence missing ${name}`);
      return name === 'Idle_01' ? 3 : name === 'Console_Loop' ? 2 : Math.max(clip.duration, 0.01);
    });
    this.step = 0; this.time = 0;
  }
  tick(delta) {
    if (!Number.isFinite(delta) || delta < 0) return this.current;
    this.time += delta;
    while (this.time >= this.durations[this.step]) {
      this.time -= this.durations[this.step];
      this.step = (this.step + 1) % SEQUENCE.length;
    }
    return this.current;
  }
  get current() { return { name: SEQUENCE[this.step], time: this.time, duration: this.durations[this.step] }; }
}
