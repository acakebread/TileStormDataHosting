// Copyright 2026 massivehadron.com ltd.

import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export async function loadCity(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error(`Electric Ambulance art returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', url).href);
  if (signal.aborted) {
    releaseCity(gltf.scene);
    signal.throwIfAborted();
  }
  return gltf.scene;
}

export function releaseCity(city) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const images = new Set();
  city.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of [object.material].flat()) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    images.add(texture.image);
    texture.dispose();
  }
  for (const image of images) image?.close?.();
  city.clear();
}

export function createCityRenderer(canvas, city) {
  const data = city.userData;
  const {fov, height, distance, targetHeight, xTracking} = data.camera;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'low-power'});
  renderer.setSize(400, 800, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xabc7d4);
  scene.fog = new THREE.Fog(0xabc7d4, 200, 500);
  const camera = new THREE.PerspectiveCamera(fov, .5, .3, 1000);
  const sky = new THREE.HemisphereLight(0xfff2d8, 0x756f67, 1.35);
  const sun = new THREE.DirectionalLight(0xe9e6d9, 2);
  sun.position.set(-25, 40, -40);
  scene.add(sky, sun);

  const templates = new Map(city.children.map(object => [object.name, object]));
  const vehicle = new THREE.Group();
  const ambulance = templates.get('ambulance').clone();
  const beacons = new Set();
  ambulance.traverse(object => {
    if (object.material?.name === 'LightBlue' || object.material?.name === 'LightRed') beacons.add(object.material);
  });
  const door = ambulance.getObjectByName('DoorL');
  const doorRest = door?.quaternion.clone();
  const doorRotation = new THREE.Quaternion();
  const doorAxis = new THREE.Vector3(0, 1, 0);
  vehicle.add(ambulance);
  scene.add(vehicle);

  const shadowMaterial = new THREE.MeshBasicMaterial({color: 0x08070a, transparent: true, opacity: .32, depthWrite: false});
  const shadowGeometry = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.scale.set(2, 1, 3.7);
  shadow.position.y = .032;
  scene.add(shadow);

  const sparkGeometry = new THREE.IcosahedronGeometry(1, 0);
  const sparkMaterial = new THREE.MeshBasicMaterial({color: 0xff9c35});
  const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, 24);
  sparks.frustumCulled = false;
  sparks.visible = false;
  const spark = new THREE.Object3D();
  scene.add(sparks);

  const street = new Map();
  const traffic = new Map();
  function getInstance(instances, key, id) {
    if (instances.has(key)) return instances.get(key);
    const object = templates.get(`entity-${id}`).clone();
    instances.set(key, object);
    scene.add(object);
    return object;
  }

  function discard(instances, visible) {
    for (const [key, object] of instances) {
      if (visible.has(key)) continue;
      object.removeFromParent();
      instances.delete(key);
    }
  }

  function draw(state) {
    const visibleStreet = new Set();
    for (const part of state.street) {
      if (part.end < state.position - data.settings.rearDistance) continue;
      const key = `${part.id}:${part.start}:${part.side}`;
      const placement = getInstance(street, key, part.id);
      visibleStreet.add(key);
      placement.rotation.y = part.side === -1 ? Math.PI : 0;
      placement.position.z = state.position - (part.side === -1 ? part.end : part.start);
    }
    discard(street, visibleStreet);

    const visibleTraffic = new Set();
    for (const entity of state.traffic) {
      if (entity.hidden || entity.z + entity.length / 2 > data.settings.distance) continue;
      const key = `${entity.key}:${entity.id}`;
      const placement = getInstance(traffic, key, entity.id);
      visibleTraffic.add(key);
      const {rotationSpeed, bounceSpeed, bounceDistance} = entity.shape;
      const time = state.elapsed + (state.position + entity.z) / 32;
      placement.position.set(entity.x, 0, -entity.z);
      if (rotationSpeed > 0) placement.rotation.y = -time / rotationSpeed * 2 * Math.PI;
      if (bounceSpeed > 0 && bounceDistance > 0) {
        const period = 2 * bounceDistance;
        const cycle = ((time / bounceSpeed % period) + period) % period;
        placement.position.y = bounceDistance - Math.abs(cycle - bounceDistance);
      }
    }
    discard(traffic, visibleTraffic);

    const lookX = state.x * xTracking;
    camera.position.set(lookX, height, distance);
    camera.lookAt(lookX, targetHeight, 0);
    const crash = state.reason === 'crash' ? state.crashTime : 0;
    vehicle.visible = shadow.visible = state.phase !== 'title';
    vehicle.position.set(state.x + state.crashSide * crash, Math.max(0, 4 * crash * (1.5 - crash)), -6 * crash);
    vehicle.rotation.set(crash * .24, -state.yaw + state.crashSide * crash * 1.6, state.crashSide * crash * 4);
    shadow.position.x = vehicle.position.x;
    shadow.position.z = vehicle.position.z;
    if (door) door.quaternion.copy(doorRest).multiply(doorRotation.setFromAxisAngle(doorAxis,
      Math.sin(state.elapsed * 8) * .1 - state.yaw * .65));
    for (const light of beacons) {
      const blue = light.name === 'LightBlue' ? 1 : 0;
      light.emissiveIntensity = Math.floor(state.elapsed * 6) % 2 === blue ? 1.35 : .55;
    }
    sparks.visible = crash > 0 && crash < .9;
    if (sparks.visible) {
      for (let i = 0; i < sparks.count; i++) {
        const angle = i * 2.4;
        const velocity = 5 + i % 5;
        spark.position.set(state.x + Math.cos(angle) * crash * velocity, 1 + Math.sin(crash * 3) * (i % 4 + 1),
          -3 + Math.sin(angle) * crash * velocity);
        spark.scale.setScalar(.17 * (1 - crash));
        spark.updateMatrix();
        sparks.setMatrixAt(i, spark.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  const projected = new THREE.Vector3();
  return {draw, playerScreenX(state) {
    return projected.set(state.x, 1, 0).project(camera).x * .5 + .5;
  }, crashPoint(state) {
    projected.set(state.x, 2, -data.player.size[2] / 2).project(camera);
    return {x: (projected.x + 1) * 50, y: (1 - projected.y) * 50};
  }, close() {
    scene.clear();
    street.clear();
    traffic.clear();
    shadowMaterial.dispose();
    shadowGeometry.dispose();
    sparkMaterial.dispose();
    sparkGeometry.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }};
}
