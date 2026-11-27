// Copyright 2026 massivehadron.com ltd.

import {beachDeathSeconds, clamp, columnWidth, columns, footprintLifetime, height, mix, washoutSeconds, width, worldScale} from './turtle-time-round.js';

export const waveIcon = [868, 68, 64, 64];
const sand = [4, 4, 558, 744];
const dust = [828, 4, 56, 56];
const chevron = [936, 68, 46, 46];
const footprints = [868, 136, 92, 33];
const white = [1021, 1021, 2, 2];
const palmLeft = [568, 68, 146, 146];
const palmRight = [718, 68, 146, 146];
const drink = [868, 350, 96, 96];
const alerts = [[568, 4, 60, 60], [632, 4, 60, 60], [696, 4, 60, 60], [760, 4, 60, 60]];
const actors = {
  crab: [68, [568, 250, 96, 96]], heron: [75, [668, 250, 96, 96]], raccoon: [76, [768, 250, 96, 96]],
  shark: [110, [868, 250, 96, 96]], orca: [125, [568, 350, 96, 96]], chest: [42, [668, 350, 96, 96]],
  ghost: [58, [768, 350, 96, 96]]
};
const palms = [
  {x: 38, y: 69, size: 180, angle: 0, left: true}, {x: width - 38, y: 69, size: 180, angle: 0, left: false},
  {x: 102, y: 26, size: 154, angle: -8, left: true}, {x: width - 102, y: 26, size: 154, angle: 8, left: false}
];
const markerSpacing = 30 * worldScale;
const radians = Math.PI / 180;
const opaque = [1, 1, 1, 1];
const stride = 11;

const vertex = `
attribute vec2 position;
attribute vec2 uv;
attribute vec4 tint;
attribute vec3 effect;
varying mediump vec2 sampleUv;
varying mediump vec4 color;
varying mediump vec3 surface;
void main() {
  gl_Position = vec4(position / vec2(${width.toFixed(2)}, 750.0) * 2.0 - 1.0, 0.0, 1.0);
  sampleUv = uv;
  color = tint;
  surface = effect;
}`;

const fragment = `
precision mediump float;
uniform sampler2D atlas;
uniform float phase;
varying mediump vec2 sampleUv;
varying mediump vec4 color;
varying mediump vec3 surface;
float caustics(vec2 position) {
  return texture2D(atlas, (vec2(868.0, 243.0) + position * vec2(64.0, -64.0)) / 1024.0).r;
}
void main() {
  vec4 pixel = texture2D(atlas, sampleUv) * color;
  if (surface.z > 0.5) {
    vec2 offset = vec2(sin(phase), cos(phase)) * 0.25;
    float first = caustics(fract(surface.xy * 0.0073 + offset));
    float second = caustics(fract((surface.xy * 0.0059 - offset).yx));
    pixel.rgb = clamp(pixel.rgb + first * second * 0.22, 0.0, 1.0);
  } else if (surface.z < -0.5) {
    float shell = 1.0 - smoothstep(0.48, 1.0, dot(surface.xy, surface.xy));
    float brightness = min(1.0, max(pixel.r, max(pixel.g, pixel.b)) * 1.35);
    pixel.rgb = mix(pixel.rgb, brightness * vec3(1.0, 0.73, 0.18), shell);
  }
  gl_FragColor = vec4(pixel.rgb * pixel.a, pixel.a);
}`;

function useProgram(gl) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      gl.deleteProgram(program);
      throw new Error(message);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message);
  }
  gl.useProgram(program);
  return program;
}

function turtleFrame(motion, age) {
  let index = 0;
  if (motion === 'walk') index = 1 + Math.min(14, Math.floor((age % .6) * 25));
  if (motion === 'swim') index = 16 + Math.min(31, Math.floor((age % (4 / 3)) * 24));
  if (motion === 'hide') index = 48 + Math.min(16, Math.floor(age * 24));
  if (index < 42) return [4 + index % 14 * 72, 794 + Math.floor(index / 14) * 76, 70, 74];
  index -= 42;
  return [568 + index % 6 * 72, 486 + Math.floor(index / 6) * 76, 70, 74];
}

export function createBeach(canvas, atlas) {
  const gl = canvas.getContext('webgl', {alpha: false, antialias: false, depth: false, powerPreference: 'low-power'});
  if (!gl) throw new Error('WebGL is unavailable');
  const program = useProgram(gl);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, size, offset] of [['position', 2, 0], ['uv', 2, 2], ['tint', 4, 4], ['effect', 3, 8]]) {
    const attribute = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, stride * 4, offset * 4);
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const phase = gl.getUniformLocation(program, 'phase');
  let vertices = new Float32Array(stride * 4096);
  let used = 0;
  const wobble = palms.map(() => 0);

  function push(x, y, u, v, tint, effectX = 0, effectY = 0, effectMode = 0) {
    if (used + stride > vertices.length) {
      const larger = new Float32Array(vertices.length * 2);
      larger.set(vertices);
      vertices = larger;
    }
    vertices[used++] = x;
    vertices[used++] = y;
    vertices[used++] = u;
    vertices[used++] = v;
    vertices[used++] = tint[0];
    vertices[used++] = tint[1];
    vertices[used++] = tint[2];
    vertices[used++] = tint[3];
    vertices[used++] = effectX;
    vertices[used++] = effectY;
    vertices[used++] = effectMode;
  }

  function texturedQuad(corners, region, tint, shell = -1) {
    const [x, y, w, h] = region;
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const u = index < 2 ? 0 : 1;
      const v = index === 1 || index === 2 ? 1 : 0;
      push(corners[index][0], corners[index][1], (x + .5 + u * (w - 1)) / 1024, (y + .5 + (1 - v) * (h - 1)) / 1024,
        tint, (u - .5) / .13, (v - shell) / .15, shell >= 0 ? -1 : 0);
    }
  }

  function sprite(x, y, w, h, angle, region, tint = opaque, shell = -1) {
    if (tint[3] <= 0 || x + w < 0 || y + h < 0 || x - w > width || y - h > height) return;
    const cosine = Math.cos(angle * radians);
    const sine = Math.sin(angle * radians);
    const dx = cosine * w / 2, dy = sine * w / 2;
    const ux = -sine * h / 2, uy = cosine * h / 2;
    texturedQuad([[x - dx - ux, y - dy - uy], [x - dx + ux, y - dy + uy],
      [x + dx + ux, y + dy + uy], [x + dx - ux, y + dy - uy]], region, tint, shell);
  }

  function drawWater(sea) {
    const deep = 400 * worldScale;
    for (const wave of sea.waves) {
      const alpha = wave.alpha;
      if (alpha <= 0) continue;
      const foam = wave.foam;
      const coast = [1, 1, 1, alpha];
      const strips = wave.reach.map((_, column) => {
        const x = column * columnWidth;
        const front = sea.front(wave, column);
        const back = wave.tsunami ? height : Math.min(height, front + deep);
        const crest = Math.min(back, front + foam);
        function tinted(y) {
          const amount = clamp((y - front) / deep, 0, 1);
          return [x, y, [.4 * (1 - amount), mix(.9, .1, amount), mix(1, .95, amount), alpha]];
        }
        return [[x, front, coast], tinted(crest), tinted(back)];
      });
      for (let i = 0; i < columns - 1; i++) {
        const [a, b, c] = strips[i];
        const [d, e, f] = strips[i + 1];
        for (const [x, y, tint] of [a, b, e, a, e, d, b, c, f, b, f, e]) {
          push(x, y, (white[0] + 1) / 1024, (white[1] + 1) / 1024, tint, x / worldScale, y / worldScale, 1);
        }
      }
    }
  }

  function drawRoute(turtle, time, editing) {
    let distance = turtle.routeTravelled;
    const start = markerSpacing * .75;
    let marker = start + Math.max(0, Math.ceil((distance - start) / markerSpacing)) * markerSpacing;
    let previous = turtle;
    for (let i = turtle.nextPoint; i < turtle.route.length; i++) {
      const next = turtle.route[i];
      const dx = next.x - previous.x, dy = next.y - previous.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(-dx, dy) / radians;
      while (marker < distance + length) {
        const progress = clamp((time - turtle.released - (marker - turtle.routeTravelled) * .0003) * 4, 0, 1);
        const size = editing ? 17 : 17 * (1 + Math.sin(progress * Math.PI) * .55);
        const tint = editing ? [.8, .1, .8, .65] : [.3 * progress, mix(.6, .2, progress), mix(.9, .1, progress), mix(.85, .4, progress)];
        const fraction = (marker - distance) / length;
        sprite(previous.x + dx * fraction, previous.y + dy * fraction, size, size, angle, chevron, tint);
        marker += markerSpacing;
      }
      previous = next;
      distance += length;
    }
  }

  function drawDust(turtle, age) {
    if (age >= .93) return;
    for (let i = 0; i < 10; i++) {
      const progress = (age - (i % 4) * .07) / .72;
      if (progress <= 0 || progress >= 1) continue;
      const angle = turtle.born * 2.3 + i * 2.39996;
      const spread = mix(8, 35, 1 - (1 - progress) ** 2);
      const size = mix(15, 34, progress);
      const opacity = .66 * Math.min(1, progress * 8) * (1 - progress);
      sprite(turtle.hatch.x + Math.cos(angle) * spread, turtle.hatch.y + Math.sin(angle) * .72 * spread,
        size, size, angle / radians, dust, [.82, .66, .49, opacity]);
    }
  }

  function drawActor(actor, round, time) {
    const {x, y, angle, kind} = actor;
    const age = time - actor.born;
    if (kind === 'turtle') {
      const size = round.drawing === actor ? 84 : 73;
      const depth = (y - round.sea.waterAt(x)) / 100;
      const opacity = actor.swimming ? Math.min(clamp(.8 - depth, .4, .8), (10 - actor.swimmingFor) / 2) : clamp(age * 3, 0, 1);
      const shell = actor.golden ? (actor.swimming ? .69 : .5) : -1;
      sprite(x, y, size, size * 74 / 70, angle, turtleFrame(actor.motion, time - actor.motionAt), [1, 1, 1, opacity], shell);
      drawDust(actor, age);
      return;
    }
    const [size, art] = actors[kind];
    let region = actor.pickup === 'drink' ? drink : art;
    if (actor.alertUntil > time) region = alerts[(kind === 'heron' ? 0 : 2) + (actor.looksLeft ? 0 : 1)];
    let tint = opaque;
    if (kind === 'shark' || kind === 'orca') tint = [.76, .95, 1, .67];
    if (kind === 'ghost') tint = [1, 1, 1, clamp(1 - age / 1.4, 0, 1)];
    if (kind === 'chest') tint = [1, 1, 1, clamp((15 - age) / 2, 0, 1)];
    if (actor.sweptFor > 0) tint = [.6, .85, .97, clamp(1 - actor.sweptFor / washoutSeconds, 0, 1)];
    if (actor.dying) tint = [tint[0], tint[1], tint[2], tint[3] * (1 - clamp(actor.dyingFor / beachDeathSeconds, 0, 1))];
    const wobbleAngle = actor.moving && Math.floor((time + actor.born) * 9) % 2 === 0 ? 7 : 0;
    sprite(x, y, size, size, angle + wobbleAngle, region, tint);
    if (actor.pickup === 'wave') {
      const corners = [[.021, -.308], [.028, .082], [.406, .231], [.378, -.133]].map(([dx, dy]) => [x + dx * size, y + dy * size]);
      texturedQuad(corners, waveIcon, [.8, .92, .9, tint[3] * .9]);
    }
  }

  function shakeAt(x, y, round) {
    for (let i = palms.length - 1; i >= 0; i--) {
      const palm = palms[i];
      const angle = palm.angle * radians;
      const dx = (x - palm.x) / palm.size, dy = (y - palm.y) / palm.size;
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const side = palm.left ? 1 : -1;
      const canopy = localX ** 2 + (localY - .13) ** 2 <= .36 ** 2;
      const trunkX = mix(-.46 * side, 0, clamp((localY + .45) / .47, 0, 1));
      const trunk = localY >= -.48 && localY <= .02 && Math.abs(localX - trunkX) <= .10;
      if (!canopy && !trunk) continue;
      if (!wobble[i]) round?.dropDrink({x: palm.x, y: palm.y + palm.size * .32},
        {x: clamp(palm.x + 75 * side, 100, width - 100), y: Math.max(42, palm.y - 18)});
      wobble[i] = 2;
      break;
    }
  }

  function draw(sea, round, time, delta) {
    const {clientWidth, clientHeight} = canvas;
    if (!clientWidth || !clientHeight || gl.isContextLost()) return;
    const scale = Math.min(2, window.devicePixelRatio || 1, 1200 / clientHeight);
    const pixelWidth = Math.max(1, Math.round(clientWidth * scale));
    const pixelHeight = Math.max(1, Math.round(clientHeight * scale));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    used = 0;
    sprite(width / 2, height / 2, width, height, 0, sand);
    if (round) for (const print of round.footprints) {
      if (print.y < sea.waterAt(print.x)) sprite(print.x, print.y, 32, 9, print.angle, footprints,
        [1, 1, 1, clamp((footprintLifetime - (time - print.time)) / 2, 0, 1)]);
    }
    drawWater(sea);
    if (round) {
      for (const actor of round.actors) if (actor.kind === 'turtle') drawRoute(actor, time, actor === round.drawing);
      for (const actor of round.actors) if (actor.kind !== 'chest') drawActor(actor, round, time);
    }
    palms.forEach((palm, i) => {
      wobble[i] = Math.max(0, wobble[i] - delta);
      const angle = palm.angle + Math.sin(8 * Math.PI * wobble[i]) * 2 * wobble[i];
      const rootX = (palm.left ? -.42 : .42) * palm.size, rootY = -.4 * palm.size;
      const original = palm.angle * radians, rotated = angle * radians;
      const dx = rootX * (Math.cos(original) - Math.cos(rotated)) - rootY * (Math.sin(original) - Math.sin(rotated));
      const dy = rootX * (Math.sin(original) - Math.sin(rotated)) + rootY * (Math.cos(original) - Math.cos(rotated));
      sprite(palm.x + dx, palm.y + dy, palm.size, palm.size, angle, palm.left ? palmLeft : palmRight);
    });
    if (round) for (const actor of round.actors) if (actor.kind === 'chest') drawActor(actor, round, time);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(phase, time % (Math.PI * 2));
    gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, used), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, used / stride);
  }

  function release() {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  }

  return {draw, shakeAt, release};
}
