// Unity testbed timings and UV values, kept independent of the rendering engine.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function dragAngles(yaw, pitch, dx, dy, orbit = false) {
  return {
    yaw: yaw + dx * 0.2 * (orbit ? -1 : 1),
    pitch: clamp(pitch + dy * 0.2, orbit ? 0 : -30, orbit ? 89.9 : 30)
  };
}
const smoothstep = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

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
