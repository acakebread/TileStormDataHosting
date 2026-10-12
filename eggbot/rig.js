import * as THREE from './vendor/three/build/three.core.js';
import { BlinkClock, clamp, lidOffset } from './behaviour.js';

const vector = () => new THREE.Vector3();
const cleanName = name => name.toLowerCase().replace(/[ _.-]/g, '');

// Ports the procedural parts of EggbotAnimationTest and EggbotEyelidController.
// glTF's texture origin is at the top. Unity's FBX/camera handedness also
// reverses horizontal gaze relative to this +Z-facing glTF model. Convert both
// UV offsets at the rendering boundary; authored texture coordinates stay intact.
export class EggbotRig {
  constructor(model, turntable, animationYaw, pitchPivot) {
    this.model = model;
    this.turntable = turntable;
    this.animationYaw = animationYaw;
    this.pitchPivot = pitchPivot;
    this.meshes = [];
    this.wheels = [];
    this.lids = [];
    this.blink = new BlinkClock();
    this.leftGaze = new THREE.Vector2();
    this.rightGaze = new THREE.Vector2();
    this.sharedGaze = new THREE.Vector2();
    this.mode = 'camera';
    this.yaw = 0;
    this.tilt = 0;
    this.scratch = vector();
    this.scratch2 = vector();
    this.scratch3 = vector();
    model.updateWorldMatrix(true, true);
    model.traverse(node => {
      const name = cleanName(node.name);
      if (name === 'lefthand') this.leftHand = node;
      if (name === 'righthand') this.rightHand = node;
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.isSkinnedMesh) node.frustumCulled = false;
      this.meshes.push(node);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(material => cleanName(material.name) === 'eyes')) this.eyes = node;
      if (name.includes('wheel')) this.wheels.push(this.createWheel(node));
      const lidMaterial = materials.find(material => /eyelids?(top|bottom)?/.test(cleanName(material.name)));
      if (lidMaterial) {
        const direction = cleanName(lidMaterial.name).includes('bottom') || name.includes('bottom') ? -1 : 1;
        this.lids.push({ mesh: node, direction, textureHeight: lidMaterial.map?.image?.height || 512 });
        // The overlapping masks must not occlude one another's transparent half.
        lidMaterial.depthWrite = false;
        node.renderOrder = direction > 0 ? 3 : 2;
      }
    });
    if (!this.eyes || this.lids.length < 2 || this.wheels.length !== 2) {
      throw new Error('Eggbot asset is missing its eyes, eyelids or wheels.');
    }
    this.actor = this.meshes.find(node => cleanName(node.name) === 'eggbot');
    if (!this.actor) throw new Error('Eggbot asset is missing its animated body root.');
    this.actorPosition = this.actor.position.clone();
    this.actorQuaternion = this.actor.quaternion.clone();
    // Blender's conversion container is static. Express the root's twist about
    // world-up in that parent's coordinates before moving it outside user tilt.
    this.actorUp = vector().set(0, 1, 0).transformDirection(new THREE.Matrix4().copy(this.actor.parent.matrixWorld).invert());
    this.actorParentRotation = this.actor.parent.getWorldQuaternion(new THREE.Quaternion());
    this.eyeBinding = this.createUvBinding(this.eyes);
    for (const lid of this.lids) lid.binding = this.createUvBinding(lid.mesh);
    const eyeInverse = new THREE.Matrix4().copy(this.eyes.matrixWorld).invert();
    this.eyeRight = vector().set(1, 0, 0).transformDirection(model.matrixWorld).transformDirection(eyeInverse);
    this.eyeUp = vector().set(0, 1, 0).transformDirection(model.matrixWorld).transformDirection(eyeInverse);
    this.uvRadius = this.measureUvRadius();
    this.contact = this.findWheelContact();
    this.head = model.worldToLocal(this.eyes.localToWorld(this.eyeBinding.centers[0].clone().add(this.eyeBinding.centers[1]).multiplyScalar(0.5)));
    model.position.copy(this.contact).negate();
    this.applyPose();
  }

  createUvBinding(mesh) {
    mesh.geometry = mesh.geometry.clone();
    const positions = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    if (!uv) throw new Error(`Eggbot mesh ${mesh.name} has no texture coordinates.`);
    uv.setUsage(THREE.DynamicDrawUsage);
    const original = uv.array.slice();
    const sides = new Uint8Array(positions.count);
    const centers = [vector(), vector()];
    const counts = [0, 0];
    const point = vector();
    const modelInverse = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const toModel = new THREE.Matrix4().multiplyMatrices(modelInverse, mesh.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      const side = point.clone().applyMatrix4(toModel).x < 0 ? 0 : 1;
      sides[i] = side;
      centers[side].add(point);
      counts[side]++;
    }
    centers.forEach((center, side) => center.divideScalar(Math.max(1, counts[side])));
    return { uv, original, sides, centers };
  }

  measureUvRadius() {
    const mesh = this.eyes;
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    const index = mesh.geometry.index;
    const forward = vector().set(0, 0, 1).transformDirection(this.model.matrixWorld)
      .transformDirection(new THREE.Matrix4().copy(mesh.matrixWorld).invert());
    const min = [new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(Infinity, Infinity)];
    const max = [new THREE.Vector2(-Infinity, -Infinity), new THREE.Vector2(-Infinity, -Infinity)];
    const a = vector(), b = vector(), c = vector(), normal = vector(), edge = vector();
    const triangles = index ? index.count : pos.count;
    for (let i = 0; i < triangles; i += 3) {
      const ids = [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset);
      a.fromBufferAttribute(pos, ids[0]); b.fromBufferAttribute(pos, ids[1]); c.fromBufferAttribute(pos, ids[2]);
      normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize();
      if (normal.dot(forward) < 0.75) continue;
      for (const id of ids) {
        const side = this.eyeBinding.sides[id];
        const point = new THREE.Vector2(uv.getX(id), uv.getY(id));
        min[side].min(point); max[side].max(point);
      }
    }
    const radius = max[0].clone().sub(min[0]).add(max[1].clone().sub(min[1])).multiplyScalar(0.25);
    return Number.isFinite(radius.x) && Number.isFinite(radius.y) && radius.x > 0 && radius.y > 0 ? radius : new THREE.Vector2(0.2, 0.35);
  }

  createWheel(mesh) {
    mesh.geometry.computeBoundingBox();
    const extents = mesh.geometry.boundingBox.getSize(vector()).multiplyScalar(0.5);
    let axle, radius;
    if (extents.x <= extents.y && extents.x <= extents.z) { axle = new THREE.Vector3(1, 0, 0); radius = Math.max(extents.y, extents.z); }
    else if (extents.y <= extents.x && extents.y <= extents.z) { axle = new THREE.Vector3(0, 1, 0); radius = Math.max(extents.x, extents.z); }
    else { axle = new THREE.Vector3(0, 0, 1); radius = Math.max(extents.x, extents.y); }
    const worldAxle = axle.clone().transformDirection(mesh.matrixWorld);
    const right = vector().set(1, 0, 0).transformDirection(this.model.matrixWorld);
    const scale = mesh.getWorldScale(vector());
    const radialScale = axle.x ? Math.max(Math.abs(scale.y), Math.abs(scale.z)) : axle.y ? Math.max(Math.abs(scale.x), Math.abs(scale.z)) : Math.max(Math.abs(scale.x), Math.abs(scale.y));
    return { mesh, axle, radius: Math.max(0.01, radius * radialScale), sign: Math.sign(worldAxle.dot(right)) || 1, base: mesh.quaternion.clone(), spin: 0, lastGround: null };
  }

  findWheelContact() {
    let minimum = Infinity, count = 0;
    const sum = vector(), point = vector();
    const inverse = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    for (const wheel of this.wheels) {
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, wheel.mesh.matrixWorld);
      const positions = wheel.mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(transform);
        if (point.y < minimum - 0.0001) { minimum = point.y; sum.copy(point); count = 1; }
        else if (point.y <= minimum + 0.0001) { sum.add(point); count++; }
      }
    }
    return count ? sum.divideScalar(count) : vector();
  }

  applyPose() {
    this.turntable.rotation.y = THREE.MathUtils.degToRad(this.yaw);
    this.pitchPivot.rotation.x = THREE.MathUtils.degToRad(this.tilt);
    const rotated = this.head.clone().sub(this.contact).applyQuaternion(this.pitchPivot.quaternion).add(this.contact);
    this.pitchPivot.position.copy(this.contact);
    this.pitchPivot.position.z += this.head.z - rotated.z;
  }

  updatePose() {
    // Root translation is suppressed just as applyRootMotion=false and the
    // testbed's wheel anchor suppress it. Keep animated yaw outside user tilt.
    const rotation = this.actor.quaternion;
    const imaginary = vector().set(rotation.x, rotation.y, rotation.z).projectOnVector(this.actorUp);
    const yaw = new THREE.Quaternion(imaginary.x, imaginary.y, imaginary.z, rotation.w);
    if (yaw.lengthSq() < 0.000001) yaw.identity(); else yaw.normalize();
    const swing = rotation.clone().multiply(yaw.clone().invert());
    this.actor.quaternion.copy(swing);
    this.animationYaw.quaternion.copy(this.actorParentRotation).multiply(yaw).multiply(this.actorParentRotation.clone().invert());
    this.actor.position.copy(this.actorPosition);
    this.applyPose();
    this.model.updateWorldMatrix(true, true);
    let bottom = Infinity;
    const point = this.scratch;
    for (const mesh of this.meshes) {
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        // Antenna vertices live in skin bind space; use evaluated vertices so
        // they cannot incorrectly lift the entire robot off the ground.
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        bottom = Math.min(bottom, point.y);
      }
    }
    if (Number.isFinite(bottom)) this.pitchPivot.position.y -= bottom;
    this.model.updateWorldMatrix(true, true);
    const heading = this.scratch.set(0, 0, 1).applyQuaternion(this.turntable.quaternion);
    const ground = this.scratch2, delta = this.scratch3;
    for (const wheel of this.wheels) {
      wheel.mesh.getWorldPosition(ground); ground.y = 0;
      if (wheel.lastGround) {
        delta.subVectors(ground, wheel.lastGround);
        wheel.spin += wheel.sign * delta.dot(heading) / wheel.radius;
      } else wheel.lastGround = vector();
      wheel.lastGround.copy(ground);
      wheel.mesh.quaternion.copy(wheel.base).multiply(new THREE.Quaternion().setFromAxisAngle(wheel.axle, wheel.spin));
    }
    this.model.updateWorldMatrix(true, true);
  }

  gazeOffset(eye, target) {
    const inverse = new THREE.Matrix4().copy(this.eyes.matrixWorld).invert();
    const direction = vector().subVectors(target, eye).transformDirection(inverse);
    return new THREE.Vector2(clamp(direction.dot(this.eyeRight) * this.uvRadius.x * 0.65, -0.16, 0.16),
      clamp(-direction.dot(this.eyeUp) * this.uvRadius.y * 0.65, -0.32, 0.32));
  }

  screenTarget(camera, pointer, eyeCenter) {
    const forward = camera.getWorldDirection(vector());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, eyeCenter);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    const focus = ray.ray.intersectPlane(plane, vector());
    ray.setFromCamera(new THREE.Vector2(), camera);
    const center = ray.ray.intersectPlane(plane, vector());
    return focus && center ? focus.sub(center).add(camera.position) : camera.position.clone();
  }

  updateGaze(delta, camera, pointer, worldTarget, clipName) {
    const leftEye = this.eyes.localToWorld(this.eyeBinding.centers[0].clone());
    const rightEye = this.eyes.localToWorld(this.eyeBinding.centers[1].clone());
    const center = leftEye.clone().add(rightEye).multiplyScalar(0.5);
    let leftTarget = new THREE.Vector2(), rightTarget = new THREE.Vector2();
    if (this.mode === 'camera' || this.mode === 'mouse') {
      const focus = this.mode === 'camera' ? camera.position : this.screenTarget(camera, pointer, center);
      const target = this.gazeOffset(center, focus);
      this.sharedGaze.lerp(target, 1 - Math.exp(-28 * delta));
      this.leftGaze.copy(this.sharedGaze); this.rightGaze.copy(this.sharedGaze);
    } else {
      this.sharedGaze.set(0, 0);
      let focus = null;
      if (this.mode === 'world') focus = worldTarget;
      else if (this.mode === 'context' && clipName === 'Console_Loop') {
        focus = this.leftHand && this.rightHand ? this.leftHand.getWorldPosition(vector()).add(this.rightHand.getWorldPosition(vector())).multiplyScalar(0.5)
          : center.clone().add(vector().set(0, 0, 0.5).transformDirection(this.model.matrixWorld).multiplyScalar(0.5));
        focus.add(vector().set(0, 1, 0).transformDirection(this.model.matrixWorld).multiplyScalar(-0.25));
      }
      if (focus) {
        leftTarget = this.gazeOffset(leftEye, focus); rightTarget = this.gazeOffset(rightEye, focus);
        if (this.mode === 'context') { leftTarget.x += 0.03; rightTarget.x -= 0.03; }
      }
      this.leftGaze.lerp(leftTarget, 1 - Math.exp(-14 * delta));
      this.rightGaze.lerp(rightTarget, 1 - Math.exp(-14 * delta));
    }
    const left = this.leftGaze.clone().add(new THREE.Vector2(0, 0.07));
    const right = this.rightGaze.clone().add(new THREE.Vector2(0, 0.07));
    this.applyUvs(this.eyeBinding, left, right);
    const blink = this.blink.tick(delta);
    for (const lid of this.lids) {
      this.applyUvs(lid.binding, new THREE.Vector2(0, lidOffset(left.y, blink, lid.direction, lid.textureHeight)),
        new THREE.Vector2(0, lidOffset(right.y, blink, lid.direction, lid.textureHeight)));
    }
  }

  applyUvs(binding, left, right) {
    const { uv, original, sides } = binding;
    for (let i = 0; i < uv.count; i++) {
      const offset = sides[i] === 0 ? left : right;
      uv.setXY(i, original[i * 2] - offset.x, original[i * 2 + 1] - offset.y);
    }
    uv.needsUpdate = true;
  }

  resetView() {
    this.yaw = 0; this.tilt = 0;
    this.wheels.forEach(wheel => { wheel.spin = 0; wheel.lastGround = null; });
    this.applyPose();
  }
}
