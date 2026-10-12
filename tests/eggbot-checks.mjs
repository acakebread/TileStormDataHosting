import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlinkClock, dragAngles, lidOffset, SequenceClock } from '../eggbot/behaviour.js';
import * as THREE from '../eggbot/vendor/three/build/three.core.js';
import { EggbotRig } from '../eggbot/rig.js';

const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

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

console.log(`Eggbot checks passed: drag directions, Idle yaw/pitch hierarchy (wheel height difference ≤ ${(maxWheelHeightDifference * 1000).toFixed(1)}mm), blink timing, eyelid coverage, GLB structure, antenna skinning, animation ranges and sequence rollover.`);
