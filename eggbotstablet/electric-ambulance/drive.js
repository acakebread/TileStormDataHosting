// Copyright 2026 massivehadron.com ltd.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, time) => start + (end - start) * time;

// LittleWorld uses the same seeded sequence independently for the street and traffic.
function randomSequence(seed) {
  let state = seed || 0x6e624eb7;
  function next() {
    const previous = state >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return previous;
  }
  next();
  return {
    integer: count => Math.floor(next() * count / 0x100000000),
    float: () => (next() >>> 9) / 0x800000
  };
}

export function createDrive(data, onEvent) {
  const {settings, difficultyTime, street, lanes, entities, player} = data;
  const partsByLength = new Map();
  for (const id of street) {
    const part = entities[id];
    if (!part.singleSide) continue;
    if (!partsByLength.has(part.length)) partsByLength.set(part.length, []);
    partsByLength.get(part.length).push(id);
  }
  const state = {phase: 'title', reason: '', time: 0, position: 0, elapsed: 0, crashTime: 0, crashSide: 1,
    targetLane: player.currentLane, lane: player.currentLane, drag: player.currentLane,
    x: lanes[player.currentLane].lanePosition, yaw: 0, battery: 1, score: 0, street: [], traffic: []};
  const slowestSpeed = settings.speed + Math.min(...lanes.map(lane => lane.speed));
  let seedIndex = settings.seedIndex;
  let roadRandom, trafficRandom, roadPosition, roadIndex, laneIndex, visits, schedule, nextId, clipCooldown;

  function pace(time) {
    return lerp(settings.startTimeScale, settings.endTimeScale, clamp(time / difficultyTime, 0, 1));
  }

  function generateStreet(far) {
    while (roadPosition < far) {
      roadIndex += 1 + roadRandom.float() * 3;
      const id = street[Math.floor(roadIndex) % street.length];
      const part = entities[id];
      state.street.push({id, start: roadPosition, end: roadPosition + part.length, side: part.singleSide ? 1 : 0});
      if (part.singleSide) {
        const opposite = partsByLength.get(part.length);
        let index = roadRandom.integer(opposite.length);
        if (opposite[index] === id) index = (index + 1) % opposite.length;
        state.street.push({id: opposite[index], start: roadPosition, end: roadPosition + part.length, side: -1});
      }
      roadPosition += part.length;
    }
  }

  function addEntity(index, forward) {
    const lane = lanes[index];
    const id = lane.objects[trafficRandom.integer(lane.objects.length)];
    const shape = entities[id];
    const x = lane.lanePosition + lerp(lane.offsetMin, lane.offsetMax, trafficRandom.float());
    const length = shape.size[2];
    const base = forward + length / 2;
    const speed = lane.speed + settings.speed;
    const offset = base + schedule.total * speed;
    const position = state.position + offset - state.time * speed;
    const side = index === 0 ? -1 : index === lanes.length - 1 ? 1 : 0;
    const hidden = side !== 0 && state.street.some(part => part.side !== -side && !entities[part.id].useSidewalks &&
      position >= part.start && position <= part.end);
    state.traffic.push({id, key: nextId++, shape, lane, x, offset, speed, length, z: position - state.position, hidden});
    return {length, base, speed};
  }

  function fillTraffic() {
    while (schedule.anchor + (schedule.total - state.time - schedule.advance) * slowestSpeed <= settings.distance) {
      const previous = laneIndex;
      if (previous === 0) laneIndex = 1;
      else if (previous === lanes.length - 1) laneIndex = previous - 1;
      else {
        const left = 1 / (visits[previous - 1] + 1);
        const right = 1 / (visits[previous + 1] + 1);
        laneIndex = trafficRandom.float() * (left + right) >= left ? previous + 1 : previous - 1;
      }
      visits[laneIndex]++;
      const spacing = schedule.length + settings.obstacleSpacing;
      if (trafficRandom.float() < pace(schedule.total)) {
        const remaining = lanes.map((_, index) => index).filter(index => index !== previous && index !== laneIndex);
        addEntity(remaining[trafficRandom.integer(remaining.length)], spacing);
      }
      const lead = addEntity(laneIndex, spacing);
      const advance = lead.base / lead.speed;
      schedule = {length: lead.length, anchor: 0, total: schedule.total + advance, advance};
    }
  }

  function updateWorld() {
    state.position = Math.max(settings.minPosition, state.time * settings.speed);
    generateStreet(state.position + settings.distance);
    fillTraffic();
    const rewind = Math.abs(settings.startTime) * settings.speed;
    state.street = state.street.filter(part => part.end >= state.position - settings.rearDistance - rewind);
    state.traffic = state.traffic.filter(entity => {
      entity.z = entity.offset - state.time * entity.speed;
      if (entity.z >= -settings.rearDistance) return true;
      if (state.phase === 'playing' && entity.lane.useAsScore) state.score++;
      return false;
    });
  }

  function resetWorld() {
    const seed = settings.gameSeeds[seedIndex];
    roadRandom = randomSequence(seed);
    trafficRandom = randomSequence(seed);
    roadIndex = roadRandom.integer(street.length);
    roadPosition = settings.minPosition;
    laneIndex = trafficRandom.integer(lanes.length);
    visits = lanes.map((_, index) => Number(index === laneIndex));
    schedule = {total: 0, advance: 0};
    nextId = 0;
    state.street = [];
    state.traffic = [];
    state.position = Math.max(settings.minPosition, state.time * settings.speed);
    generateStreet(state.position + settings.distance);
    const first = addEntity(laneIndex, 0);
    schedule.anchor = first.base;
    schedule.length = first.length;
  }

  function start(restart = 'same') {
    if (restart === 'next') seedIndex = Math.floor(performance.now()) % settings.gameSeeds.length;
    state.time = restart === 'continue' ? state.time + settings.startTime : settings.startTime;
    state.phase = 'playing';
    state.reason = '';
    state.crashTime = 0;
    state.battery = 1;
    state.score = 0;
    state.lane = state.drag = state.targetLane;
    state.x = lanes[state.lane].lanePosition;
    state.yaw = 0;
    clipCooldown = 0;
    if (restart !== 'continue') resetWorld();
    updateWorld();
    onEvent('start');
  }

  function steer(direction) {
    if (state.phase !== 'playing') return;
    const lane = clamp(state.targetLane + direction, 0, lanes.length - 1);
    if (lane === state.targetLane) return;
    state.targetLane = lane;
    onEvent(direction < 0 ? 'left' : 'right');
  }

  function overlap(entity, fatal) {
    const half = entity.shape.size.map(size => size / 2);
    const [cx, cy, cz] = entity.shape.center.map((centre, index) => centre - (fatal ? half[index] / 4 : 0));
    const [px, py, pz] = player.center;
    const [width, height, length] = player.size.map(size => size / 2);
    const sine = Math.sin(state.yaw);
    const cosine = Math.cos(state.yaw);
    const dx = entity.x + cx - state.x - px * cosine - pz * sine;
    const dz = entity.z + cz + px * sine - pz * cosine;
    return Math.abs(cy - py) <= half[1] + height &&
      Math.abs(dx) <= half[0] + width * Math.abs(cosine) + length * Math.abs(sine) &&
      Math.abs(dz) <= half[2] + width * Math.abs(sine) + length * Math.abs(cosine) &&
      Math.abs(dx * cosine - dz * sine) <= width + half[0] * Math.abs(cosine) + half[2] * Math.abs(sine) &&
      Math.abs(dx * sine + dz * cosine) <= length + half[0] * Math.abs(sine) + half[2] * Math.abs(cosine);
  }

  function end(reason, hit) {
    state.phase = 'crashing';
    state.reason = reason;
    state.crashSide = !hit || hit.x > state.x ? -1 : 1;
    onEvent(reason);
  }

  function advance(dt) {
    if (state.phase === 'crashing') {
      state.crashTime += dt;
      if (state.crashTime >= player.preWastedTime) state.phase = 'wasted';
      return;
    }
    if (state.phase !== 'title' && state.phase !== 'playing') return;
    state.elapsed += dt;
    state.time += dt * pace(state.phase === 'title' ? 0 : state.time);
    if (state.phase === 'playing') {
      const distance = state.targetLane - state.lane;
      state.lane += clamp(distance, -dt / player.changeLaneSpeed, dt / player.changeLaneSpeed);
      state.drag = lerp(state.drag, state.lane, Math.min(1, dt * 8));
      const index = Math.min(lanes.length - 2, Math.floor(state.lane));
      state.x = lerp(lanes[index].lanePosition, lanes[index + 1].lanePosition, state.lane - index);
      state.yaw = Math.atan(state.lane - state.drag);
    }
    updateWorld();
    if (state.phase !== 'playing') return;
    const previous = state.battery;
    state.battery = Math.max(0, state.battery - dt / settings.batteryDrainTime);
    if (previous >= .16 && state.battery < .16) onEvent('low');
    clipCooldown = Math.max(0, clipCooldown - dt);
    const nearby = state.traffic.filter(entity => !entity.hidden && Math.abs(entity.z - entity.length / 2) <= player.size[2] / 2 + 5);
    const pickup = nearby.find(entity => entity.shape.type === 2 && overlap(entity, false));
    if (pickup) {
      pickup.hidden = true;
      state.battery = 1;
      onEvent('pickup');
    }
    const collision = nearby.find(entity => !entity.hidden && overlap(entity, entity.lane.speed !== 0));
    if (collision || state.battery === 0) end(collision ? 'crash' : 'power', collision);
    else if (clipCooldown === 0 && nearby.some(entity => !entity.hidden && overlap(entity, false))) {
      clipCooldown = .35;
      onEvent('clip');
    }
  }

  resetWorld();
  updateWorld();
  return {state, start, steer, advance, togglePause() {
    if (state.phase === 'paused') state.phase = 'playing';
    else if (state.phase === 'playing') state.phase = 'paused';
  }};
}
