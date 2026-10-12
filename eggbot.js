import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EggbotRig } from './eggbot/rig.js';
import { clamp, dragAngles, GridJourney, SEQUENCE, SequenceClock } from './eggbot/behaviour.js';

const canvas = document.getElementById('scene');
const stage = document.getElementById('stage');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const status = document.getElementById('status');
const animationList = document.getElementById('animationList');
const sequenceButton = document.getElementById('sequence');
const resetButton = document.getElementById('resetView');
const fullscreenButton = document.getElementById('fullscreen');
const cameraDefaultDistance = 3 / Math.cos(THREE.MathUtils.degToRad(15));
const cameraTarget = new THREE.Vector3(0, 1.5 - 3 * Math.tan(THREE.MathUtils.degToRad(15)), 0);
const pointer = new THREE.Vector2();
const touches = new Map();
let renderer, scene, camera, model, mixer, rig, clips = [], activeAction = null, activeClip = null;
let sequence = null, selection = 'none', lastStatus = '', lastFrame = null, worldTime = 0;
let cameraYaw = 0, cameraPitch = 15, cameraDistance = cameraDefaultDistance;
let orb, dragged = false, touchGesture = null;
let ground, journey = null, tap = null, destination;
const bindPose = [];

function fail(message, error) {
  console.error('Eggbot playground:', error || message);
  loading.hidden = false;
  loading.classList.add('failed');
  loadingText.textContent = message;
  status.textContent = 'Eggbot could not start';
  document.getElementById('errorHome').hidden = false;
}

function describe(name) { return name.replaceAll('_', ' ').replace(/ 01$/, ''); }
function isLoop(clip) { return clip.userData?.loop ?? /^(Idle_01|Console_Loop)$/.test(clip.name); }
function setStatus(text) { if (lastStatus !== text) { status.textContent = text; lastStatus = text; } }

function restorePose() {
  mixer.stopAllAction();
  bindPose.forEach(pose => {
    pose.node.position.copy(pose.position);
    pose.node.quaternion.copy(pose.quaternion);
    pose.node.scale.copy(pose.scale);
  });
  if (rig) model.position.copy(rig.contact).negate();
}

function startClip(name) {
  restorePose();
  activeClip = clips.find(clip => clip.name === name) || null;
  activeAction = activeClip ? mixer.clipAction(activeClip).reset() : null;
  if (activeAction) {
    activeAction.setLoop(isLoop(activeClip) ? THREE.LoopRepeat : THREE.LoopOnce, isLoop(activeClip) ? Infinity : 1);
    activeAction.clampWhenFinished = true;
    activeAction.play();
    mixer.update(0);
  }
  if (rig) rig.sampledQuaternion = rig.actor.quaternion.clone();
}

function play(value) {
  sequence = value === 'sequence' ? new SequenceClock(clips) : null;
  selection = value;
  startClip(sequence ? SEQUENCE[0] : value === 'none' ? null : value);
  for (const button of animationList.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.animation === value));
  sequenceButton.setAttribute('aria-pressed', String(value === 'sequence'));
  sequenceButton.querySelector('.play-symbol').textContent = value === 'sequence' ? '↻' : '▶';
  updateStatus();
}

function updateStatus() {
  if (sequence) setStatus(`Sequence · ${describe(activeClip.name)}`);
  else if (!activeClip) setStatus('No animation · eyes awake');
  else setStatus(`${describe(activeClip.name)} · ${isLoop(activeClip) ? 'looping' : activeAction.paused ? 'holding last pose' : 'playing once'}`);
}

function applyCamera() {
  const yaw = THREE.MathUtils.degToRad(cameraYaw), pitch = THREE.MathUtils.degToRad(cameraPitch);
  camera.position.set(cameraTarget.x + Math.sin(yaw) * Math.cos(pitch) * cameraDistance,
    cameraTarget.y + Math.sin(pitch) * cameraDistance, cameraTarget.z + Math.cos(yaw) * Math.cos(pitch) * cameraDistance);
  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld();
}

function zoom(distance) { cameraDistance = clamp(distance, cameraDefaultDistance * 0.25, cameraDefaultDistance * 2); applyCamera(); }
function fitWorldTarget() {
  if (rig?.mode !== 'world') return;
  const verticalHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
  // The target's full orbit and bob fit inside a 1.55m sphere about the camera
  // look point. Pull back on entry/resize; subsequent manual zoom still works.
  const distance = 1.55 / Math.sin(Math.min(verticalHalf, horizontalHalf));
  if (cameraDistance < distance) zoom(distance);
}
function resetView() { journey = null; destination.visible = false; rig.turntable.position.set(0, 0, 0); cameraYaw = 0; cameraPitch = 15; cameraDistance = cameraDefaultDistance; rig.resetView(); applyCamera(); fitWorldTarget(); }

function walkTo(clientX, clientY) {
  const bounds = canvas.getBoundingClientRect();
  const point = new THREE.Vector2((clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2);
  const ray = new THREE.Raycaster(); ray.setFromCamera(point, camera);
  // Only visible grid hits count; clicking Eggbot doesn't send him elsewhere.
  const hit = ray.intersectObjects([ground, model], true)[0];
  if (hit?.object !== ground) return;
  const target = hit.point.clone(); target.y = 0;
  if (target.distanceTo(rig.turntable.position) < 0.01) return;
  journey = new GridJourney(rig.turntable.position, rig.yaw, target);
  destination.position.set(target.x, 0.008, target.z); destination.visible = true;
}
function resize() {
  const width = stage.clientWidth, height = stage.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  fitWorldTarget();
}

function move(dx, dy, orbit) {
  if (orbit) {
    const next = dragAngles(cameraYaw, cameraPitch, dx, dy, true);
    cameraYaw = next.yaw; cameraPitch = next.pitch; applyCamera();
  }
  else {
    journey = null; destination.visible = false;
    // Unity's front camera reverses screen X relative to Three.js, and DOM Y
    // points down rather than up. Convert Eggbot's drag in both directions.
    const next = dragAngles(rig.yaw, rig.tilt, dx, dy);
    rig.yaw = next.yaw; rig.tilt = next.pitch;
  }
}

function touchState() {
  const points = [...touches.values()];
  if (points.length < 2) return null;
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2,
    distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) };
}

function controls() {
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    tap = touches.size === 0 && event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY, orbit: event.button === 2 });
    touchGesture = touchState(); dragged = true;
  });
  canvas.addEventListener('pointermove', event => {
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    const previous = touches.get(event.pointerId);
    if (!previous) return;
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 5) tap = null;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY, orbit: previous.orbit });
    if (touches.size >= 2) {
      const next = touchState();
      if (touchGesture) {
        move(next.x - touchGesture.x, next.y - touchGesture.y, true);
        if (next.distance > 1 && touchGesture.distance > 1) zoom(cameraDistance * touchGesture.distance / next.distance);
      }
      touchGesture = next;
    } else if (!tap) move(event.clientX - previous.x, event.clientY - previous.y, previous.orbit);
  });
  const release = event => {
    if (event.type === 'pointerup' && tap?.id === event.pointerId) walkTo(event.clientX, event.clientY);
    tap = null; touches.delete(event.pointerId); touchGesture = touchState(); dragged = touches.size > 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
    zoom(cameraDistance + pixels * 0.0035);
  }, { passive: false });
  canvas.addEventListener('keydown', event => {
    const arrows = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] };
    if (arrows[event.key]) { event.preventDefault(); move(...arrows[event.key], event.shiftKey); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(cameraDistance - 0.2); }
    else if (event.key === '-') { event.preventDefault(); zoom(cameraDistance + 0.2); }
    else if (event.key === '0') { event.preventDefault(); resetView(); }
  });
  animationList.addEventListener('click', event => {
    const button = event.target.closest('[data-animation]');
    if (button) play(button.dataset.animation);
  });
  sequenceButton.addEventListener('click', () => play('sequence'));
  for (const input of document.querySelectorAll('input[name="gaze"]')) input.addEventListener('change', () => { rig.mode = input.value; fitWorldTarget(); });
  resetButton.addEventListener('click', resetView);
  for (const input of document.querySelectorAll('[data-eye-setting]')) input.addEventListener('input', () => {
    if (!Number.isFinite(input.valueAsNumber)) return;
    if (input.dataset.eyeSetting === 'strength') rig.gazeStrength = clamp(input.valueAsNumber, 0, 4);
    else rig.pupilUvBias[input.dataset.eyeSetting] = clamp(input.valueAsNumber, -0.32, 0.32);
  });
  fullscreenButton.hidden = !document.fullscreenEnabled;
  fullscreenButton.addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
    catch (error) { console.warn('Full screen unavailable:', error); }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Enter full screen');
    fullscreenButton.title = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    resize();
  });
  new ResizeObserver(resize).observe(stage);
  document.addEventListener('visibilitychange', () => { lastFrame = null; touches.clear(); dragged = false; touchGesture = null; });
  if (matchMedia('(pointer: coarse)').matches) document.getElementById('stageHint').innerHTML = '<span>Tap grid to move</span><span>Drag to turn</span><span>Two fingers to orbit</span>';
}

function animate(time) {
  requestAnimationFrame(animate);
  if (document.hidden) { lastFrame = null; return; }
  const delta = lastFrame === null ? 0 : Math.max(0, (time - lastFrame) / 1000);
  lastFrame = time;
  // Restore the actor's animation rotation before mixing: the rig extracts its
  // yaw after evaluation, so even a held frame must be evaluated afresh.
  if (activeAction) {
    if (rig.sampledQuaternion) rig.actor.quaternion.copy(rig.sampledQuaternion);
    if (sequence) {
      const next = sequence.tick(delta);
      if (activeClip.name !== next.name) startClip(next.name);
      // Explicit sampling carries time through sequence boundaries accurately.
      activeAction.paused = false;
      activeAction.time = isLoop(activeClip) ? next.time % activeClip.duration : Math.min(next.time, activeClip.duration);
      mixer.update(0);
    } else {
      mixer.update(delta);
      if (activeAction.paused) mixer.update(0);
    }
    rig.sampledQuaternion.copy(rig.actor.quaternion);
  } else {
    rig.actor.quaternion.copy(rig.actorQuaternion);
  }
  if (journey) {
    const next = journey.tick(delta);
    rig.turntable.position.set(next.x, 0, next.z); rig.yaw = next.yaw;
    if (next.done) { journey = null; destination.visible = false; }
  }
  rig.updatePose();
  orb.visible = rig.mode === 'world';
  if (orb.visible && !dragged) worldTime += delta;
  orb.position.set(Math.cos(worldTime * 0.7) * 1.25, 1.05 + Math.sin(worldTime * 1.6) * 0.45, Math.sin(worldTime * 0.7) * 1.25);
  rig.updateGaze(delta, camera, pointer, orb.position, activeClip?.name);
  updateStatus();
  renderer.render(scene, camera);
}

async function initialise() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  } catch (error) {
    fail('Eggbot needs WebGL2. Enable hardware acceleration in your browser, then reload this page.', error);
    return;
  }
  try {
    scene = new THREE.Scene(); scene.background = new THREE.Color('#293038');
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 30);
    applyCamera();
    scene.add(new THREE.HemisphereLight(0xc8e0ef, 0x59606a, 2.0));
    const key = new THREE.DirectionalLight(0xfff3db, 3.0);
    key.position.set(-2.0, 4.0, 3.0); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.1, far: 10 });
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x91d8ee, 1.4); rim.position.set(2, 2, -2); scene.add(rim);
    const groundTexture = await new THREE.TextureLoader().loadAsync('./eggbot/assets/ground.jpg');
    groundTexture.colorSpace = THREE.SRGBColorSpace;
    groundTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ map: groundTexture, color: 0x737f85, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    destination = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 32), new THREE.MeshBasicMaterial({ color: 0xf0c35b, depthWrite: false }));
    destination.rotation.x = -Math.PI / 2; destination.visible = false; scene.add(destination);
    orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 12), new THREE.MeshStandardMaterial({ color: 0xffd933, roughness: 0.4, emissive: 0x5b3e00, emissiveIntensity: 0.3 }));
    orb.visible = false; scene.add(orb);
    const asset = await new GLTFLoader().loadAsync('./eggbot/assets/eggbot.glb', progress => {
      if (progress.lengthComputable) loadingText.textContent = `Getting Eggbot ready… ${Math.round(progress.loaded / progress.total * 100)}%`;
    });
    model = asset.scene;
    const turntable = new THREE.Group(), animationYaw = new THREE.Group(), pitchPivot = new THREE.Group();
    scene.add(turntable); turntable.add(animationYaw); animationYaw.add(pitchPivot); pitchPivot.add(model);
    clips = asset.animations.filter(clip => !clip.name.startsWith('__preview__')).sort((a, b) => a.name.localeCompare(b.name));
    if (!clips.length) throw new Error('Eggbot asset contains no animation clips.');
    mixer = new THREE.AnimationMixer(model);
    model.traverse(node => bindPose.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
    rig = new EggbotRig(model, turntable, animationYaw, pitchPivot);
    for (const clip of clips) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.animation = clip.name;
      button.setAttribute('aria-pressed', 'false');
      const label = document.createElement('span'); label.textContent = describe(clip.name);
      const mode = document.createElement('small'); mode.textContent = isLoop(clip) ? 'loop' : 'once';
      button.append(label, mode); animationList.append(button);
    }
    document.getElementById('animationControls').disabled = false;
    document.getElementById('gazeControls').disabled = false;
    resetButton.disabled = false;
    sequenceButton.disabled = !SEQUENCE.every(name => clips.some(clip => clip.name === name));
    play('none');
    // restorePose resets the glTF wrapper too, so reapply its wheel anchor.
    model.position.copy(rig.contact).negate();
    controls(); resize();
    loading.hidden = true;
    stage.dataset.ready = 'true';
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The browser lost its graphics connection. Reload the page to bring Eggbot back.'); });
    canvas.addEventListener('webglcontextrestored', () => { loading.hidden = true; loading.classList.remove('failed'); lastFrame = null; });
    requestAnimationFrame(animate);
  } catch (error) { fail('Eggbot could not load. Please reload the page to try again.', error); }
}

initialise();
