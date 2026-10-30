import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ArrivalTurn, BlinkClock, dragAngles, GridJourney, IdleMotion, lidOffset, movementEase, SequenceClock, TiltReturn } from '../eggbot/behaviour.js';
import { currentTimeReply, interpret, tryGetReply, unrecognisedReply } from '../eggbot/speech.js';
import * as THREE from '../eggbot/vendor/three/build/three.core.js';
import { EggbotRig } from '../eggbot/rig.js';

const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
near(movementEase(0), 0); near(movementEase(0.5), 0.5); near(movementEase(1), 1);
const journey = new GridJourney({ x: 0, z: 0 }, 350, { x: 3, z: 0 });
near(journey.moveDuration, 4 / 3); // Half gameplay speed; turning is still 0.25s.
near(journey.turnDuration, 0.25);
const turning = journey.tick(0.125);
near(turning.yaw, 400); near(turning.x, 0);
const halfway = journey.tick(0.125 + journey.moveDuration / 2);
near(halfway.x, 1.5); near(halfway.yaw, 450);
const arrived = journey.tick(100);
near(arrived.x, 3); near(arrived.z, 0); assert.ok(arrived.done);

// Finish travel, then face the camera once using the shortest horizontal turn.
const arrivalCamera = { x: 3 + Math.sin(Math.PI / 18), y: 5, z: Math.cos(Math.PI / 18) };
const arrivalTurn = new ArrivalTurn(arrived, 350, arrivalCamera);
near(arrivalTurn.tick(0).yaw, 350);
const facingHalfway = arrivalTurn.tick(0.225);
near(facingHalfway.yaw, 360); assert.equal(facingHalfway.done, false);
const facingCamera = arrivalTurn.tick(0.225);
near(facingCamera.yaw, 370); assert.ok(facingCamera.done);
arrivalCamera.x = -30; arrivalCamera.z = -10;
near(arrivalTurn.tick(20).yaw, facingCamera.yaw); // No tracking after arrival.
const overheadTurn = new ArrivalTurn({ x: 1, z: 2 }, 45, { x: 1, y: 10, z: 2 });
near(overheadTurn.tick(0).yaw, 45); assert.ok(overheadTurn.tick(0).done);
const offCentre = new ArrivalTurn({ x: 1.2, z: -0.4 }, 90, { x: -2, y: 4, z: 3 });
const offCentreFacing = offCentre.tick(2).yaw * Math.PI / 180;
const expectedDirection = new THREE.Vector2(-3.2, 3.4).normalize();
near(Math.sin(offCentreFacing), expectedDirection.x); near(Math.cos(offCentreFacing), expectedDirection.y);
const fineTurn = new ArrivalTurn({ x: 0, z: 0 }, 90, { x: 0, z: 3 });
const coarseTurn = new ArrivalTurn({ x: 0, z: 0 }, 90, { x: 0, z: 3 });
let fineFacing;
for (let i = 0; i < 12; i++) fineFacing = fineTurn.tick(1 / 60);
near(fineFacing.yaw, coarseTurn.tick(0.2).yaw, 1e-9);

const procedural = new IdleMotion(() => 0.5);
const wobble = procedural.tick(0.3, false);
near(wobble.pitch, 0.1 * Math.sin(7.8 * 0.3) * Math.sin(1.8 * 0.3));
near(wobble.yaw, 0);
procedural.reset();
const glance = procedural.tick(procedural.glanceDelay + procedural.glanceDuration / 2, true);
near(glance.yaw, 27 * Math.PI / 180);
near(procedural.tick(0.1, false).yaw, 0, 1e-7);
const fineIdle = new IdleMotion(() => 0.5), coarseIdle = new IdleMotion(() => 0.5);
let finePose;
for (let i = 0; i < 1800; i++) finePose = fineIdle.tick(1 / 60);
const coarsePose = coarseIdle.tick(30);
for (const component of Object.keys(finePose)) near(finePose[component], coarsePose[component], 1e-9);

// Manual tilt waits after release, returns smoothly, and never fights a held drag.
const tiltReturn = new TiltReturn();
tiltReturn.set(24);
near(tiltReturn.tick(20, true), 24);
near(tiltReturn.tick(1.9), 24);
near(tiltReturn.tick(0.6), 12);
near(tiltReturn.tick(0.5), 0);
near(tiltReturn.tick(10), 0);
tiltReturn.set(-30);
near(tiltReturn.tick(2.5), -15);
near(tiltReturn.tick(10, true), -15); // Grab midway through recovery: no jump.
near(tiltReturn.tick(1.9), -15);
near(tiltReturn.tick(1.1), 0);
tiltReturn.set(20); tiltReturn.tick(2.3); tiltReturn.set(0);
near(tiltReturn.tick(0.2), 0); // A grid click or Reset must cancel the old lean.
const fineTilt = new TiltReturn(), coarseTilt = new TiltReturn();
fineTilt.set(25); coarseTilt.set(25);
for (let i = 0; i < 150; i++) fineTilt.tick(1 / 60);
near(fineTilt.value, coarseTilt.tick(2.5), 1e-9);

// Front-view dragging should move Eggbot's facing toward screen-right and
// lean his head toward screen-down. RMB retains its existing orbit direction.
const robotDrag = dragAngles(0, 0, 80, 60);
const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(robotDrag.yaw));
assert.ok(facing.x > 0, 'Dragging right must turn Eggbot right');
const head = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(robotDrag.pitch));
const screenUp = new THREE.Vector3(0, Math.cos(Math.PI / 12), -Math.sin(Math.PI / 12));
assert.ok(head.clone().sub(new THREE.Vector3(0, 1, 0)).dot(screenUp) < 0, 'Dragging down must lean Eggbot down on screen');
assert.deepEqual(dragAngles(0, 15, 80, 60, true), { yaw: -16, pitch: 27 });
assert.equal(dragAngles(0, 0, 0, -1000).pitch, -30);
assert.equal(dragAngles(0, 0, 0, 1000).pitch, 30);

// A skipped frame must carry through waits, close/hold/open and alternating
// intervals just as multiple small frames do. Neutral randomness fixes waits.
const smallFrames = new BlinkClock(() => 0.5);
const largeFrame = new BlinkClock(() => 0.5);
for (let i = 0; i < 1609; i++) smallFrames.tick(0.01);
largeFrame.tick(16.09);
near(smallFrames.time, largeFrame.time);
near(smallFrames.weight, largeFrame.weight);
assert.equal(smallFrames.index, largeFrame.index);
assert.equal(smallFrames.blinking, largeFrame.blinking);
const blink = new BlinkClock(() => 0.5);
near(blink.tick(3.015), 0.5);
near(blink.tick(0.015), 1);
near(blink.tick(0.06), 1);
near(blink.tick(0.015), 0.5);
near(blink.tick(0.015), 0);
assert.equal(blink.index, 1);

// At extreme gaze both masks must close without sampling into their clear
// half. At rest, upper/lower follow the pupil at different rates.
near(lidOffset(0.07, 0, 1), 0.025 * 4.5 + 0.07 * 0.724);
near(lidOffset(-0.07, 0, -1), -0.07 * 0.724 * 0.5);
for (const pupil of [-0.32, 0, 0.07, 0.39]) {
  const upper = lidOffset(pupil, 1, 1), lower = lidOffset(pupil, 1, -1);
  assert.ok(upper >= 0 && upper < 0.5);
  assert.ok(lower <= 0 && lower > -0.5);
  assert.ok(upper - lower > 0.49, `Blink leaves a gap at pupil V ${pupil}`);
}

const bytes = await readFile(process.argv[2] || new URL('../eggbot/assets/eggbot.glb', import.meta.url));
assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
const dataStart = 20 + jsonLength + 8;
assert.ok(gltf.buffers.every(buffer => !buffer.uri), 'GLB must be self-contained');
assert.ok(gltf.images.every(image => image.bufferView !== undefined), 'Textures must be embedded');
for (const name of ['Eyes', 'eyelids_top', 'eyelids_bottom', 'L_Wheel', 'R_Wheel', 'EggBot']) assert.ok(gltf.nodes.some(node => node.name === name), `Missing ${name}`);
assert.ok(gltf.nodes.some(node => node.name === 'Antenna' && node.skin !== undefined), 'Antenna skin lost');
for (const name of ['EyeLids_Top', 'EyeLids_Bottom']) assert.equal(gltf.materials.find(material => material.name === name)?.alphaMode, 'BLEND');
const metadata = JSON.parse(await readFile(new URL('../eggbot/assets/eggbot.json', import.meta.url), 'utf8'));
assert.equal(gltf.animations.length, metadata.clips.length);
const clips = gltf.animations.map(animation => {
  const spec = metadata.clips.find(clip => clip.name === animation.name);
  assert.ok(spec, `Unexpected animation ${animation.name}`);
  assert.equal(animation.extras.loop, spec.loop);
  const durations = animation.samplers.map(sampler => {
    const accessor = gltf.accessors[sampler.input];
    const view = gltf.bufferViews[accessor.bufferView];
    assert.equal(accessor.componentType, 5126);
    const start = dataStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const first = bytes.readFloatLE(start), last = bytes.readFloatLE(start + (accessor.count - 1) * 4);
    near(first, 0);
    near(last, (spec.lastFrame - spec.firstFrame) / metadata.fps, 1e-6);
    return last;
  });
  return { name: animation.name, duration: Math.max(...durations) };
});
const sequence = new SequenceClock(clips);
assert.equal(sequence.tick(3.05).name, 'Console_Start');
near(sequence.current.time, 0.05);
assert.equal(sequence.tick(0.2).name, 'Console_Loop');
near(sequence.current.time, 0.25 - clips.find(clip => clip.name === 'Console_Start').duration, 1e-7);
const cycle = 5 + clips.find(clip => clip.name === 'Console_Start').duration + clips.find(clip => clip.name === 'Console_End').duration;
const multiCycle = new SequenceClock(clips);
assert.equal(multiCycle.tick(cycle * 10 + 3.05).name, 'Console_Start');
near(multiCycle.current.time, 0.05, 1e-6);
assert.throws(() => new SequenceClock([]), /Sequence missing/);

// Regression for Blender's static antenna joint conversion: importing back
// into Blender concealed this bug; evaluate glTF's skin with Three.js itself.
function accessorData(id) {
  const accessor = gltf.accessors[id], view = gltf.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const formats = { 5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2], 5121: ['readUInt8', 1] };
  const [read, size] = formats[accessor.componentType];
  const start = dataStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = [];
  for (let i = 0; i < accessor.count; i++) for (let c = 0; c < components; c++) values.push(bytes[read](start + i * (view.byteStride || size * components) + c * size));
  return { values, components };
}
const materials = gltf.materials.map(def => {
  const material = new THREE.MeshStandardMaterial(); material.name = def.name;
  return material;
});
function meshGeometry(primitive) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, key] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0'], ['skinIndex', 'JOINTS_0'], ['skinWeight', 'WEIGHTS_0']]) {
    if (primitive.attributes[key] === undefined) continue;
    const data = accessorData(primitive.attributes[key]);
    const Attribute = name === 'skinIndex' ? THREE.Uint16BufferAttribute : THREE.Float32BufferAttribute;
    geometry.setAttribute(name, new Attribute(data.values, data.components));
  }
  if (primitive.indices !== undefined) geometry.setIndex(accessorData(primitive.indices).values);
  return geometry;
}
const joints = new Set(gltf.skins.flatMap(skin => skin.joints));
const nodes = gltf.nodes.map((def, id) => {
  let node;
  if (def.mesh !== undefined) {
    const primitive = gltf.meshes[def.mesh].primitives[0];
    const Mesh = def.skin !== undefined ? THREE.SkinnedMesh : THREE.Mesh;
    node = new Mesh(meshGeometry(primitive), materials[primitive.material]);
  } else node = joints.has(id) ? new THREE.Bone() : new THREE.Object3D();
  node.name = def.name;
  if (def.translation) node.position.fromArray(def.translation);
  if (def.rotation) node.quaternion.fromArray(def.rotation);
  if (def.scale) node.scale.fromArray(def.scale);
  return node;
});
gltf.nodes.forEach((def, id) => def.children?.forEach(child => nodes[id].add(nodes[child])));
const root = new THREE.Group(); gltf.scenes[gltf.scene || 0].nodes.forEach(id => root.add(nodes[id]));
root.updateMatrixWorld(true);
const antennaId = gltf.nodes.findIndex(node => node.name === 'Antenna');
const skeletons = gltf.skins.map(skin => {
  const inverse = accessorData(skin.inverseBindMatrices).values;
  return new THREE.Skeleton(skin.joints.map(id => nodes[id]), skin.joints.map((_, i) => new THREE.Matrix4().fromArray(inverse, i * 16)));
});
gltf.nodes.forEach((def, id) => { if (def.skin !== undefined) nodes[id].bind(skeletons[def.skin], new THREE.Matrix4()); });
const antenna = nodes[antennaId];
const geometry = antenna.geometry;
const rest = nodes.map(node => ({ position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
function checkAntenna(label) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) bounds.expandByPoint(antenna.getVertexPosition(i, point).applyMatrix4(antenna.matrixWorld));
  assert.ok(bounds.min.y > 0.8 && bounds.max.y < 1.35 && bounds.max.y > 1.05, `${label}: antenna displaced ${bounds.min.y}..${bounds.max.y}`);
}
checkAntenna('Bind pose');
function sampleAnimation(animation, fraction) {
    rest.forEach((pose, id) => { nodes[id].position.copy(pose.position); nodes[id].quaternion.copy(pose.quaternion); nodes[id].scale.copy(pose.scale); });
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      const times = accessorData(sampler.input).values, output = accessorData(sampler.output);
      const time = times.at(-1) * fraction;
      let next = times.findIndex(value => value >= time); if (next < 0) next = times.length - 1;
      const prev = Math.max(0, next - 1), weight = times[next] === times[prev] ? 0 : (time - times[prev]) / (times[next] - times[prev]);
      const node = nodes[channel.target.node];
      if (channel.target.path === 'rotation') {
        node.quaternion.fromArray(output.values, prev * 4).slerp(new THREE.Quaternion().fromArray(output.values, next * 4), weight);
      } else {
        const target = channel.target.path === 'translation' ? node.position : node.scale;
        target.fromArray(output.values, prev * 3).lerp(new THREE.Vector3().fromArray(output.values, next * 3), weight);
      }
    }
}
for (const animation of gltf.animations) {
  for (const fraction of [0, 0.5, 1]) {
    sampleAnimation(animation, fraction);
    checkAntenna(`${animation.name} at ${fraction}`);
  }
}

// Exercise the actual browser rig against the real asset. Idle must retain its
// authored turn without converting yaw to roll or lifting one wheel ~14cm.
rest.forEach((pose, id) => { nodes[id].position.copy(pose.position); nodes[id].quaternion.copy(pose.quaternion); nodes[id].scale.copy(pose.scale); });
const turntable = new THREE.Group(), animationYaw = new THREE.Group(), pitchPivot = new THREE.Group();
turntable.add(animationYaw); animationYaw.add(pitchPivot); pitchPivot.add(root);
const rig = new EggbotRig(root, turntable, animationYaw, pitchPivot);
// Exercise the actual UV adapter, not just the inspector constants.
const gazeEye = rig.eyes.getWorldPosition(new THREE.Vector3());
const gazeTarget = gazeEye.clone().add(new THREE.Vector3(0.5, 0.3, 1));
rig.gazeStrength = 0;
assert.deepEqual(rig.gazeOffset(gazeEye, gazeTarget).toArray(), [0, -0]);
rig.gazeStrength = 0.5;
const weakGaze = rig.gazeOffset(gazeEye, gazeTarget);
rig.gazeStrength = 1;
const strongGaze = rig.gazeOffset(gazeEye, gazeTarget);
near(strongGaze.x, weakGaze.x * 2); near(strongGaze.y, weakGaze.y * 2);
rig.mode = 'disabled'; rig.pupilUvBias.set(0.03, 0.07);
rig.updateGaze(0, new THREE.PerspectiveCamera(), new THREE.Vector2(), new THREE.Vector3(), null);
near(rig.eyeBinding.uv.getX(0), rig.eyeBinding.original[0] - 0.03, 1e-7);
near(rig.eyeBinding.uv.getY(0), rig.eyeBinding.original[1] - 0.07, 1e-7);
rig.gazeStrength = 1.3; rig.pupilUvBias.set(0, 0.07);
const idle = gltf.animations.find(animation => animation.name === 'Idle_01');
let maxWheelHeightDifference = 0, maxYaw = -Infinity, minYaw = Infinity;
for (const tilt of [-30, 0, 30]) {
  rig.tilt = tilt;
  for (let frame = 0; frame <= 34; frame++) {
    sampleAnimation(idle, frame / 34);
    rig.updatePose();
    const heights = rig.wheels.map(wheel => wheel.mesh.getWorldPosition(new THREE.Vector3()).y);
    maxWheelHeightDifference = Math.max(maxWheelHeightDifference, Math.abs(heights[0] - heights[1]));
    assert.ok(Math.abs(heights[0] - heights[1]) < 0.015, `Idle frame ${frame}, tilt ${tilt}: yaw incorrectly rolls the wheels`);
    near(animationYaw.quaternion.x, 0, 1e-6); near(animationYaw.quaternion.z, 0, 1e-6);
    const yaw = 2 * Math.atan2(animationYaw.quaternion.y, animationYaw.quaternion.w);
    maxYaw = Math.max(maxYaw, yaw); minYaw = Math.min(minYaw, yaw);
  }
}
assert.ok(maxYaw > 0.12 && minYaw < -0.12, 'Idle must keep its turning animation on the yaw parent');

// No-animation balance should never accumulate transforms or lift the wheels.
rest.forEach((pose, id) => { nodes[id].position.copy(pose.position); nodes[id].quaternion.copy(pose.quaternion); nodes[id].scale.copy(pose.scale); });
rig.resetView(); rig.idleMotion = new IdleMotion(() => 0.5);
assert.equal(rig.shoulders.length, 2, 'Both shoulder pivots must be available');
const fingers = nodes.filter(node => /finger|thumb/i.test(node.name)).map(node => ({ node, position: node.position.clone(), rotation: node.quaternion.clone() }));
const shoulderPositions = rig.shoulders.map(shoulder => shoulder.node.position.clone());
rig.updatePose();
const hands = [rig.leftHand, rig.rightHand];
const handPositions = hands.map(hand => rig.actor.worldToLocal(hand.getWorldPosition(new THREE.Vector3())));
let handTravel = 0, shoulderTravel = 0, glanceMinimum = 0, glanceMaximum = 0, glancePeaks = 0, lastGlanceMagnitude = 0, risingGlance = false;
for (let frame = 0; frame < 960; frame++) {
  rig.updateProceduralMotion(1 / 60, true, true);
  rig.actor.quaternion.copy(rig.actorQuaternion); rig.updatePose();
  near(rig.turntable.position.length(), 0);
  near(rig.yaw, 0); near(rig.tilt, 0);
  const heights = rig.wheels.map(wheel => wheel.mesh.getWorldPosition(new THREE.Vector3()).y);
  assert.ok(Math.abs(heights[0] - heights[1]) < 0.005, 'Forward/back wobble must not roll sideways');
  let bottom = Infinity;
  for (const mesh of rig.meshes) {
    const vertex = new THREE.Vector3();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      bottom = Math.min(bottom, mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld).y);
    }
  }
  // Spinning the polygonal wheels after seating can shift their lowest vertex
  // by a fraction of a millimetre; it must never accumulate or visibly float.
  near(bottom, 0, 0.001);
  rig.shoulders.forEach((shoulder, index) => {
    near(shoulder.node.position.distanceTo(shoulderPositions[index]), 0);
    const travel = shoulder.node.quaternion.angleTo(shoulder.base);
    assert.ok(travel < 0.17, 'Shoulder motion must stay below ten degrees'); shoulderTravel = Math.max(shoulderTravel, travel);
  });
  hands.forEach((hand, index) => {
    const local = rig.actor.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
    handTravel = Math.max(handTravel, local.distanceTo(handPositions[index]) * Math.abs(rig.actor.getWorldScale(new THREE.Vector3()).x));
  });
  for (const finger of fingers) {
    near(finger.node.position.distanceTo(finger.position), 0);
    near(finger.node.quaternion.angleTo(finger.rotation), 0, 1e-7);
  }
  glanceMinimum = Math.min(glanceMinimum, rig.proceduralPose.yaw);
  glanceMaximum = Math.max(glanceMaximum, rig.proceduralPose.yaw);
  const magnitude = Math.abs(rig.proceduralPose.yaw);
  if (risingGlance && magnitude < lastGlanceMagnitude && lastGlanceMagnitude > 0.4) { glancePeaks++; risingGlance = false; }
  else if (magnitude > lastGlanceMagnitude) risingGlance = true;
  lastGlanceMagnitude = magnitude;
}
assert.ok(shoulderTravel > 0.12 && handTravel > 0.015, 'Shoulder corrections must visibly move the hands');
assert.ok(glanceMinimum < -0.46 && glanceMaximum > 0.46, 'Stationary glances should look clearly both ways');
assert.ok(glancePeaks >= 5, 'Stationary glances should happen frequently');
rig.updateProceduralMotion(0, true, false);
near(rig.proceduralPose.yaw, 0);
rig.updateProceduralMotion(0, false, true);
rig.updatePose();
near(rig.balancePivot.quaternion.angleTo(new THREE.Quaternion()), 0);
for (const shoulder of rig.shoulders) assert.deepEqual(shoulder.node.quaternion.toArray(), shoulder.base.toArray());
// Disabled procedural motion must leave even held animation shoulder poses alone.
for (const animation of gltf.animations) {
  sampleAnimation(animation, 0.5);
  const authoredShoulders = rig.shoulders.map(shoulder => shoulder.node.quaternion.clone());
  rig.updateProceduralMotion(2, false, true);
  rig.updatePose();
  rig.shoulders.forEach((shoulder, index) => assert.deepEqual(shoulder.node.quaternion.toArray(), authoredShoulders[index].toArray()));
}

assert.equal(interpret('hello eggbot', false).greeting, true);
assert.equal(interpret('hey egg bought', false).greeting, true);
assert.equal(interpret('how are you', false).addressed, false);
assert.equal(interpret('how are you?', true).question, true);
assert.equal(tryGetReply('hello eggbot how are you'), "I'm fine");
assert.equal(tryGetReply("what's the time", new Date(2026, 0, 1, 15, 5)), "it's three oh five");
assert.equal(currentTimeReply(new Date(2026, 0, 1, 15, 0)), "it's three o'clock");
assert.equal(currentTimeReply(new Date(2026, 0, 1, 15, 25)), "it's three twenty five");
assert.equal(tryGetReply('can you help me'), "I'll try");
assert.equal(tryGetReply('why are you taking so long'), 'I am doing my best');
assert.equal(unrecognisedReply(() => 0), "I don't understand");

console.log(`Eggbot checks passed: one-shot camera-facing arrival, tilt recovery, procedural wobble, frequent stationary glances, visible shoulder-only balance and clip isolation; drag directions, Idle yaw/pitch hierarchy (wheel height difference ≤ ${(maxWheelHeightDifference * 1000).toFixed(1)}mm), blink timing, eyelid coverage, GLB structure, antenna skinning, animation ranges and sequence rollover.`);
