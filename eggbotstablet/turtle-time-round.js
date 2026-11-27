// Copyright 2026 massivehadron.com ltd.

// The tablet's Unity rules use an upward Y axis and a 750-unit portrait beach.
export const height = 750;
export const width = height * 852 / 1136;
export const worldScale = height / 1136;
export const columns = 12;
export const columnWidth = width / (columns - 1);
export const footprintLifetime = 5;
export const washoutSeconds = 1.8;
export const beachDeathSeconds = 2.2;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const mix = (from, to, amount) => from + (to - from) * amount;

const hatchLine = 217;
const sharkEntry = 174 * worldScale;
const orcaEntry = height + 232 * worldScale;
const tick = .02;
const shoreDepth = 50 * worldScale;
const whaleRescueReach = 150;
const flopSpeed = 70;
const tsunamiDrag = 240;
const shallowDragDepth = 220;
const lastWaveDepth = 24;
const radians = Math.PI / 180;
const random = (min, max) => mix(min, max, Math.random());
const point = (x, y) => ({x, y});
const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const heading = (dx, dy) => Math.atan2(-dx, dy) / radians;
const angleDifference = (from, to) => ((to - from + 180) % 360 + 360) % 360 - 180;
const turn = (from, to, step) => from + clamp(angleDifference(from, to), -step, step);
const aquatic = kind => kind === 'shark' || kind === 'orca';
const beachPrey = turtle => !turtle.removed && !turtle.hidden && !turtle.swimming && turtle.y >= hatchLine;
const swimming = turtle => turtle.swimming;
const exposed = turtle => !turtle.hidden;

function move(actor, destination, step, face = true) {
  const dx = destination.x - actor.x;
  const dy = destination.y - actor.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  if (face) {
    actor.moving = true;
    actor.angle = heading(dx, dy);
  }
  if (step >= distance) {
    actor.x = destination.x;
    actor.y = destination.y;
  } else {
    actor.x += dx * step / distance;
    actor.y += dy * step / distance;
  }
}

class Wave {
  constructor(tsunami) {
    this.tsunami = tsunami;
    this.age = 0;
    this.duration = tsunami ? 29 : 20;
    const crest = random(0, Math.PI * 2);
    const spread = random(0, Math.PI * 2);
    this.reach = Array.from({length: columns}, (_, index) => 200 + Math.sin(crest + index * 4 / (columns - 1)) * 24);
    this.velocity = Array.from({length: columns}, (_, index) =>
      (1 + Math.sin(spread + index * 4 / (columns - 1)) * .04) * (tsunami ? .66 * 2.4 : .66));
  }

  get alpha() {
    return clamp(1 - (this.age - this.duration + (this.tsunami ? 3.5 : 4)) * (this.tsunami ? .2 : .3), 0, 1);
  }

  get foam() {
    return Math.max(0, this.tsunami ? (this.age - 2) * 2 : this.age - 11) * (400 * worldScale / this.duration);
  }

  advance() {
    this.age += tick;
    const braking = Math.max(0, this.age - this.duration + (this.tsunami ? 13 : 6)) * .004;
    const damping = this.tsunami && braking > 0 ? .993 : 1;
    for (let i = 0; i < columns; i++) {
      this.reach[i] += this.velocity[i];
      this.velocity[i] = (this.velocity[i] - braking) * damping;
    }
  }
}

export class Sea {
  waves = [];
  tide = 600;
  spawnIn = 0;
  current = 0;
  accumulated = 0;
  waveActive = false;

  constructor() {
    for (let i = 0; i < 750; i++) this.advance(false);
  }

  step(delta, playing) {
    this.accumulated += delta;
    while (this.accumulated >= tick) {
      this.accumulated -= tick;
      this.advance(playing);
    }
  }

  advance(playing) {
    const before = this.shore(width / 2);
    if (playing) this.tide = Math.min(900, this.tide + tick * 1.5);
    this.spawnIn -= tick;
    if (this.spawnIn <= 0) this.addWave();
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i];
      wave.advance();
      if (wave.age < wave.duration) continue;
      this.waves.splice(i, 1);
      if (wave.tsunami) this.waveActive = false;
    }
    this.current = mix(this.current, clamp((this.shore(width / 2) - before) / tick, -60, 100), .1);
  }

  addWave() {
    this.waves.push(new Wave(false));
    this.spawnIn = random(3, 6);
  }

  callWave() {
    this.waves.push(new Wave(true));
    this.waveActive = true;
    this.addWave();
  }

  front(wave, column) { return (this.tide + 568 - wave.reach[column]) * worldScale; }

  shore(x, tsunamiOnly = false) {
    const column = clamp(x / columnWidth, 0, columns - 1);
    const left = Math.min(Math.floor(column), columns - 2);
    let edge = height;
    for (const wave of this.waves) {
      if (wave.alpha <= 0 || (tsunamiOnly && !wave.tsunami)) continue;
      edge = Math.min(edge, mix(this.front(wave, left), this.front(wave, left + 1), column - left));
    }
    return edge;
  }

  waterAt(x) { return this.shore(x) + shoreDepth; }

  currentAt(actor) {
    const depth = Math.max(0, actor.y - this.waterAt(actor.x) - shoreDepth);
    return this.current / (1.3 + depth * .015);
  }

  tsunamiReaches(actor) { return this.waveActive && actor.y >= this.shore(actor.x, true) + shoreDepth; }
}

export class Round {
  sea = new Sea();
  actors = [];
  footprints = [];
  landWaiting = [];
  streak = [];
  drawing = null;
  elapsed = 0;
  deadline = 60;
  saved = 0;
  lost = 0;
  chests = 0;
  charges = 1;
  lastWavePickup = -Infinity;
  nextSpawn = 0;
  nextLandReturn = 0;

  constructor(feedback) { this.feedback = feedback; }

  get timeLeft() { return Math.max(0, this.deadline - this.elapsed); }
  get canCallWave() { return this.charges > 0 && !this.sea.waveActive && this.timeLeft > 0; }

  callWave() {
    if (!this.canCallWave) return;
    this.charges--;
    this.sea.callWave();
    this.feedback('tsunami');
  }

  add(kind, x, y, speed) {
    const actor = {kind, x, y, speed, born: this.elapsed, angle: 0, sweptFor: 0, alertUntil: 0, eatAgain: 0,
      beached: false, dying: false, beachedAt: 0, dyingFor: 0};
    this.actors.push(actor);
    return actor;
  }

  findTurtle(position, range, filter) {
    let nearest = null;
    let limit = range * range;
    for (const actor of this.actors) {
      if (actor.kind !== 'turtle' || actor.removed || (filter && !filter(actor))) continue;
      const squared = distanceSquared(actor, position);
      if (squared >= limit) continue;
      nearest = actor;
      limit = squared;
    }
    return nearest;
  }

  beginRoute(position) {
    const turtle = this.findTurtle(position, 45, actor => !actor.swimming);
    if (!turtle) return false;
    this.drawing = turtle;
    turtle.route = [point(turtle.x, turtle.y)];
    turtle.nextPoint = 1;
    turtle.routeTravelled = 0;
    return true;
  }

  extendRoute(position, final) {
    const turtle = this.drawing;
    if (!turtle) return;
    const spacing = final ? .5 : 12;
    if (turtle.route.length >= 128 || distanceSquared(turtle.route.at(-1), position) < spacing * spacing) return;
    turtle.route.push(position);
    turtle.hidden = false;
  }

  endRoute() {
    if (!this.drawing) return;
    this.drawing.hidden = this.drawing.route.length === 1;
    this.drawing.released = this.drawing.wakeAt = this.elapsed;
    this.drawing = null;
  }

  dropDrink(start, landing) {
    if (this.timeLeft <= 0 || Math.random() >= .2 || this.actors.filter(actor => actor.kind === 'chest').length >= 5) return;
    const drink = this.add('chest', start.x, start.y, 0);
    drink.pickup = 'drink';
    drink.landing = landing;
  }

  step(delta) {
    this.elapsed += delta;
    this.sea.step(delta, true);
    while (this.footprints.length && this.elapsed - this.footprints[0].time > footprintLifetime) this.footprints.shift();
    while (this.nextSpawn <= this.elapsed) this.spawn(this.nextSpawn++);
    const pressure = clamp((this.elapsed - 20) / 160, 0, 1) ** 2;
    for (const actor of this.actors) {
      switch (actor.kind) {
        case 'turtle': {
          this.moveTurtle(actor, delta);
          const motion = actor.swimming ? 'swim' : actor.hidden ? 'hide' : actor.moving ? 'walk' : 'idle';
          if (actor.motion !== motion) {
            actor.motion = motion;
            actor.motionAt = this.elapsed;
          }
          break;
        }
        case 'chest': this.moveChest(actor, delta); break;
        case 'ghost':
          actor.y += 55 * delta;
          actor.removed = this.elapsed - actor.born >= 1.4;
          break;
        default: this.movePredator(actor, delta, pressure); break;
      }
    }
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i];
      if (!actor.removed) continue;
      this.actors.splice(i, 1);
      if (actor === this.drawing) this.drawing = null;
      if (actor.eaten) this.add('ghost', actor.x, actor.y, 0).angle = actor.angle;
    }
  }

  spawn(second) {
    let turtles = 0, atHatch = 0, predators = 0, chests = 0;
    for (const actor of this.actors) {
      if (actor.kind === 'turtle') {
        turtles++;
        if (actor.y < hatchLine) atHatch++;
      } else if (actor.kind === 'chest') chests++;
      else if (actor.kind !== 'ghost' && actor.sweptFor === 0) predators++;
    }
    const limit = Math.min(6 + Math.floor(second / 60), 10);
    if (turtles < limit + 4 && (atHatch === 0 || (atHatch < limit && Math.random() < .5))) {
      const position = point(random(125, width - 125), random(85, hatchLine - 12));
      for (let i = 0; i < 8 && this.findTurtle(position, 54); i++) position.x = random(125, width - 125);
      const turtle = this.add('turtle', position.x, position.y, random(40, 53));
      turtle.hatch = position;
      turtle.golden = Math.random() < .05;
      if (turtle.golden) turtle.speed *= 1.25;
      Object.assign(turtle, {route: [], nextPoint: 0, wakeAt: this.elapsed + random(12, 16), motion: 'idle',
        motionAt: this.elapsed, swimmingFor: 0, routeTravelled: 0, released: 0, distanceSincePrint: 0});
      this.feedback('hatch');
    }
    this.spawnPredators(second, predators + this.landWaiting.length);
    if (chests < 5 && (second === 4 || Math.random() < .10)) {
      const x = random(90, width - 90);
      const chest = this.add('chest', x, random(45, Math.max(50, this.sea.waterAt(x) - 35)), 0);
      const roll = Math.random();
      chest.pickup = roll < 1 / 3 ? 'drink' : roll < 1 / 3 + 1 / (5 + 2 * this.charges) ? 'wave' : 'crate';
    }
  }

  spawnPredators(second, occupied) {
    switch (second) {
      case 0: this.addPredator('shark'); break;
      case 8: this.addPredator('orca'); break;
      case 10: this.scheduleLand('crab'); break;
      case 20: this.scheduleLand('heron'); break;
      case 30: this.scheduleLand('raccoon'); break;
      default: {
        const refill = second >= 35 && second % 5 === 0 && occupied < 4;
        const increase = second >= 50 && (second - 50) % 30 === 0 && occupied < 12;
        if (!refill && !increase) break;
        const kind = ['crab', 'heron', 'raccoon', 'shark', 'orca'][Math.floor(random(0, 5))];
        if (!aquatic(kind)) this.scheduleLand(kind);
        else if (this.actors.filter(actor => actor.kind === kind).length < 2) this.addPredator(kind);
      }
    }
    if (!this.sea.waveActive && this.landWaiting.length && second >= this.nextLandReturn) {
      this.addPredator(this.landWaiting.shift());
      this.nextLandReturn = second + 4;
    }
  }

  scheduleLand(kind) {
    if (this.sea.waveActive || this.landWaiting.length) this.landWaiting.push(kind);
    else this.addPredator(kind);
  }

  orcaLane() { return width / 2 + random(-200, 200) * worldScale; }

  patrolPoint() {
    const x = random(45, width - 45);
    const top = Math.max(45, this.sea.waterAt(x) - 24);
    return point(x, random(Math.min(hatchLine, top), top));
  }

  addPredator(kind) {
    if (kind === 'shark') {
      const near = this.sea.waterAt(0) + 40 * worldScale;
      this.add(kind, -sharkEntry, random(near, Math.max(near, height - 200 * worldScale)), 20 * worldScale);
    } else if (kind === 'orca') {
      this.add(kind, this.orcaLane(), orcaEntry, 30 * worldScale);
    } else {
      const offset = 74 * worldScale;
      const speed = {crab: 20, heron: 40, raccoon: 60}[kind];
      this.add(kind, Math.random() < .5 ? -offset : width + offset, height / 2 - 100 * worldScale,
        speed * worldScale).destination = this.patrolPoint();
    }
  }

  moveTurtle(turtle, delta) {
    if (turtle.removed) return;
    turtle.moving = false;
    if (turtle.y >= this.sea.waterAt(turtle.x)) {
      if (!turtle.swimming) {
        turtle.swimming = true;
        turtle.hidden = false;
        turtle.route.length = 0;
        turtle.nextPoint = 0;
        if (this.drawing === turtle) this.drawing = null;
      }
      turtle.swimmingFor += delta;
      const paddle = (2 + 60 * clamp(turtle.swimmingFor / 5, 0, 1)) * (turtle.golden ? 1.25 : 1);
      turtle.y += (paddle * worldScale + this.sea.currentAt(turtle)) * delta;
      turtle.angle = turn(turtle.angle, 0, delta * 70);
      if (turtle.y >= height - 12 || turtle.swimmingFor >= 10) {
        turtle.removed = true;
        this.recordRescue(turtle.golden);
      }
      return;
    }
    if (turtle.swimming) {
      turtle.swimming = false;
      turtle.swimmingFor = 0;
      turtle.wakeAt = this.elapsed + .6;
    }
    if (turtle.hidden) return;
    const previousX = turtle.x;
    const previousY = turtle.y;
    let remaining = turtle.speed * delta;
    while (turtle.nextPoint < turtle.route.length && remaining > 0) {
      const destination = turtle.route[turtle.nextPoint];
      const distance = Math.hypot(turtle.x - destination.x, turtle.y - destination.y);
      move(turtle, destination, remaining);
      const travelled = Math.min(distance, remaining);
      turtle.routeTravelled += travelled;
      remaining -= travelled;
      if (travelled < distance) break;
      turtle.nextPoint++;
    }
    if (turtle.nextPoint >= turtle.route.length && this.drawing !== turtle) {
      turtle.route.length = 0;
      turtle.nextPoint = 0;
      if (this.elapsed >= turtle.wakeAt && remaining > 0) move(turtle, point(turtle.x, height + 40), remaining);
    }
    turtle.distanceSincePrint += Math.hypot(turtle.x - previousX, turtle.y - previousY);
    if (turtle.distanceSincePrint >= 35 * worldScale) {
      turtle.distanceSincePrint -= 35 * worldScale;
      const angle = turtle.angle * radians;
      this.footprints.push({x: turtle.x + Math.sin(angle) * 13, y: turtle.y - Math.cos(angle) * 13,
        angle: turtle.angle, time: this.elapsed});
    }
  }

  recordRescue(golden) {
    this.saved++;
    const reward = golden ? 10 : 5;
    this.deadline += reward;
    while (this.streak.length && this.elapsed - this.streak[0] > 8) this.streak.shift();
    this.streak.push(this.elapsed);
    const triple = this.streak.length === 3;
    this.feedback('rescue', reward, golden, triple);
    if (triple) this.streak.length = 0;
  }

  moveChest(chest, delta) {
    if (chest.landing) {
      move(chest, chest.landing, 210 * delta, false);
      if (chest.x !== chest.landing.x || chest.y !== chest.landing.y) return;
      chest.landing = null;
      chest.born = this.elapsed;
    }
    if (chest.y >= this.sea.waterAt(chest.x)) chest.y += this.sea.currentAt(chest) * delta;
    if (this.elapsed - chest.born > 15 || chest.y >= height) {
      chest.removed = true;
      return;
    }
    const collector = this.findTurtle(chest, 32, exposed);
    if (!collector) return;
    chest.removed = true;
    this.chests++;
    if (chest.pickup === 'wave') {
      this.charges++;
      this.lastWavePickup = this.elapsed;
    } else collector.speed = Math.min(150, collector.speed * 1.5);
    this.feedback('pickup');
  }

  movePredator(predator, delta, pressure) {
    predator.moving = false;
    const inWater = aquatic(predator.kind);
    if (!inWater && this.sweepPredator(predator, delta)) return;
    if (predator.eatAgain > this.elapsed) {
      if (inWater && (predator.beached || this.sea.waveActive)) this.moveWaterPredator(predator, delta, 0, pressure);
      return;
    }
    const step = predator.speed * (1 + 4 * pressure) * delta;
    if (inWater) this.moveWaterPredator(predator, delta, step, pressure);
    else {
      const facing = predator.angle;
      const canBite = this.moveBeachPredator(predator, step, pressure);
      predator.angle = turn(facing, predator.angle, 540 * delta);
      if (!canBite) return;
    }
    if (predator.removed || predator.beached) return;
    const target = this.findTurtle(predator, inWater ? 27 : 33, inWater ? swimming : beachPrey);
    if (!target) return;
    target.removed = target.eaten = true;
    predator.prey = null;
    const recovery = inWater ? mix(4, 1, pressure) : mix(8, 1.5, pressure);
    predator.eatAgain = this.elapsed + recovery;
    this.lost++;
    const penalty = target.golden ? 6 : 3;
    this.deadline -= penalty;
    this.streak.length = 0;
    this.feedback('lost', -penalty, target.golden);
  }

  sweepPredator(predator, delta) {
    if (predator.sweptFor === 0) {
      if (!this.sea.tsunamiReaches(predator)) return false;
      this.landWaiting.push(predator.kind);
    }
    predator.sweptFor += delta;
    predator.prey = null;
    predator.alertUntil = 0;
    predator.y += (46 + this.sea.currentAt(predator) * .5) * delta;
    predator.angle += 60 * delta;
    predator.removed = predator.sweptFor >= washoutSeconds;
    return true;
  }

  moveWaterPredator(predator, delta, step, pressure) {
    if (predator.beached) {
      this.struggleOnBeach(predator, delta);
      return;
    }
    const water = this.sea.waterAt(predator.x);
    const detection = 280 * pressure;
    let chasing = false;
    if (detection > 27) {
      const prey = this.findTurtle(predator, detection, swimming);
      if (prey) {
        chasing = true;
        const goalY = Math.max(water + 4, prey.y);
        const chase = this.sea.waveActive && goalY < predator.y ? Math.max(step, tsunamiDrag * delta) : step;
        move(predator, point(prey.x, goalY), chase);
      }
    }
    if (!chasing && predator.kind === 'shark') {
      const edge = predator.returning ? -sharkEntry : width + sharkEntry;
      move(predator, point(edge, predator.y), step);
      if (predator.x === edge) predator.returning = !predator.returning;
    } else if (!chasing) {
      const bottom = water + 50 * worldScale;
      if (!(this.sea.waveActive && !predator.returning)) {
        const target = predator.returning ? orcaEntry : bottom;
        move(predator, point(predator.x, target), step);
        if (predator.y === target) {
          if (predator.returning) predator.x = this.orcaLane();
          predator.returning = !predator.returning;
        }
      }
    }
    this.followTide(predator, delta, pressure, chasing);
    if (!predator.beached && predator.kind === 'shark' && predator.y > height - 50 * worldScale) predator.removed = true;
  }

  // The surge drags shallow swimmers and hunters up the beach. They can only swim back at their own speed.
  followTide(predator, delta, pressure, chasing) {
    const water = this.sea.waterAt(predator.x);
    const margin = predator.kind === 'shark' ? 15 : 50 * worldScale;
    const floor = water + margin;
    const swim = predator.speed * (1 + 4 * pressure);
    const inTheWash = predator.y - floor < shallowDragDepth;
    if (this.sea.waveActive && predator.y > floor && (chasing || inTheWash))
      predator.y = Math.max(floor, predator.y - tsunamiDrag * delta);
    if (predator.y < water - lastWaveDepth) {
      this.strand(predator);
      return;
    }
    const deficit = floor - predator.y;
    if (deficit > 0) predator.y += this.sea.waveActive ? Math.min(deficit, swim * delta) : deficit;
    if (predator.kind === 'orca') predator.y = Math.min(predator.y, orcaEntry);
  }

  strand(predator) {
    if (predator.beached) return;
    predator.beached = true;
    predator.beachedAt = this.elapsed;
    predator.prey = null;
    predator.y = clamp(predator.y, 16, height - 24);
  }

  struggleOnBeach(predator, delta) {
    predator.moving = false;
    predator.prey = null;
    const water = this.sea.waterAt(predator.x);
    if (!predator.dying && predator.y >= water) {
      predator.beached = false;
      predator.y = Math.max(predator.y, water + 6);
      return;
    }
    const gap = water - predator.y;
    const canRecover = predator.kind === 'orca' && gap <= whaleRescueReach && !predator.dying;
    if (!canRecover) {
      if (!predator.dying) {
        predator.dying = true;
        predator.dyingFor = 0;
      }
      predator.dyingFor += delta;
      const side = Math.abs(predator.angle) < 20 || predator.angle >= 0 ? 1 : -1;
      predator.angle = turn(predator.angle, 92 * side, 140 * delta);
      predator.removed = predator.dyingFor >= beachDeathSeconds;
      return;
    }
    const thrash = this.elapsed - predator.beachedAt;
    predator.angle = Math.sin(thrash * 8.5) * 78;
    predator.y += flopSpeed * delta;
    predator.x = clamp(predator.x + Math.cos(thrash * 8.5) * 22 * delta, 18, width - 18);
    if (predator.y < water) return;
    predator.beached = false;
    predator.y = water + 8;
  }

  moveBeachPredator(predator, step, pressure) {
    const water = this.sea.waterAt(predator.x);
    if (predator.y >= water) predator.retreating = true;
    const dryY = Math.max(16, water - 42);
    if (predator.retreating && predator.y > dryY) {
      predator.prey = null;
      predator.alertUntil = 0;
      move(predator, point(predator.x, dryY), step);
      return false;
    }
    predator.retreating = false;
    const scanInterval = mix(5, .3, pressure);
    if (predator.prey && (this.elapsed >= predator.huntUntil || !beachPrey(predator.prey))) {
      predator.prey = null;
      predator.alertUntil = 0;
      predator.nextScan = this.elapsed + scanInterval;
      predator.destination = this.patrolPoint();
    }
    let destination = point(predator.destination.x,
      Math.min(predator.destination.y, this.sea.waterAt(predator.destination.x) - 18));
    const reached = distanceSquared(predator, destination) < 9;
    const onBeach = predator.x >= 0 && predator.x <= width;
    if (!predator.prey && (reached || (pressure > 0 && onBeach && this.elapsed >= (predator.nextScan ?? 0)))) {
      const range = {crab: 150, heron: 200, raccoon: 300}[predator.kind];
      predator.prey = this.findTurtle(predator, range * worldScale * (1 + 2.5 * pressure), beachPrey);
      predator.huntUntil = this.elapsed + mix(2, 8, pressure);
      predator.nextScan = this.elapsed + scanInterval;
      if (predator.prey && predator.kind !== 'crab') {
        const angle = heading(predator.prey.x - predator.x, predator.prey.y - predator.y);
        predator.looksLeft = angleDifference(predator.angle, angle) > 0;
        predator.alertUntil = this.elapsed + mix(.42, .24, pressure);
      }
      if (reached) destination = predator.destination = this.patrolPoint();
    }
    if (this.elapsed < predator.alertUntil) return false;
    if (predator.prey) destination = predator.prey;
    move(predator, point(destination.x, Math.min(destination.y, water - 18)), step);
    return predator.y < this.sea.waterAt(predator.x);
  }
}
