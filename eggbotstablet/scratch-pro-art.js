// Copyright 2026 massivehadron.com ltd.

import {button, element, image} from './ui.js';
import {dealContest, money, random} from './scratch-pro-rules.js';

const host = new URL('https://eggbot-content.qrh.workers.dev/');
const full = {x: 0, y: 0, w: 1, h: 1};
const leading = ['ON', 'TW', 'TR', 'FR', 'FV', 'SX', 'SN', 'ET', 'NN', 'TN'];
const magnitude = ['TEN', 'HND', 'THOU', 'TTHO', 'HHOU', 'MIL', 'TMIL'];

export async function loadScratchCatalogue(file, title, signal) {
  const response = await fetch(new URL(file, host), {cache: 'no-cache', signal});
  if (!response.ok) throw new Error(title + ' catalogue unavailable');
  const data = await response.json();
  if (data.schemaVersion !== 1 || data.cards?.length !== 20 || !Array.isArray(data.sheets) || !Array.isArray(data.media))
    throw new Error('Invalid ' + title + ' catalogue');
  const files = new Map(data.media.filter(entry => /^media\/[a-f0-9]{64}\.(png|jpg|mp3)$/.test(entry.file))
    .map(entry => [entry.name, new URL(entry.file, host).href]));
  const sheets = new Map(data.sheets.map(sheet => [sheet.name, sheet]));
  return {cards: data.cards, sheets, url: name => files.get(name), image: (name, abort) => loadImage(files.get(name), abort)};
}

export function loadScratchProCatalogue(signal) {
  return loadScratchCatalogue('scratch-pro.json', 'Scratch Pro', signal);
}

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    if (!url || signal.aborted) {
      reject(new Error('Missing scratch artwork'));
      return;
    }
    const image = new Image();
    const timer = setTimeout(fail, 15000);
    image.crossOrigin = 'anonymous';
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener('abort', fail);
      image.onload = image.onerror = null;
    }
    function fail() {
      cleanup();
      image.removeAttribute('src');
      reject(new Error('Could not load scratch artwork'));
    }
    signal.addEventListener('abort', fail, {once: true});
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = fail;
    image.src = url;
  });
}

export function wait(milliseconds, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(false); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(true); }, milliseconds);
    function abort() { clearTimeout(timer); resolve(false); }
    signal.addEventListener('abort', abort, {once: true});
  });
}

export function pin(parent, node, x, y, width, height) {
  Object.assign(node.style, {position: 'absolute', left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px'});
  parent.append(node);
  return node;
}

export function sprite(node, url, [x, y, width, height], sheetWidth, sheetHeight) {
  if (!url) return node;
  Object.assign(node.style, {
    backgroundImage: 'url("' + url + '")', backgroundRepeat: 'no-repeat',
    backgroundSize: 100 * sheetWidth / width + '% ' + 100 * sheetHeight / height + '%',
    backgroundPosition: (sheetWidth === width ? 0 : 100 * x / (sheetWidth - width)) + '% ' +
      (sheetHeight === height ? 0 : 100 * y / (sheetHeight - height)) + '%'
  });
  return node;
}

export function createAudio(catalogue, allowed) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  const lifetime = new AbortController();
  const buffers = new Map();
  const playing = new Map();
  let context;

  function unlock() {
    if (!Audio || lifetime.signal.aborted) return;
    try {
      context ??= new Audio();
      if (context.state !== 'running') context.resume().catch(() => {});
    } catch {}
  }

  function stop(name) {
    const entry = playing.get(name);
    playing.delete(name);
    if (entry?.source) entry.source.stop();
  }

  function play(name, loop = false) {
    const url = catalogue.url(name + '.mp3');
    if (!context || !url || !allowed(name) || (loop && playing.has(name))) return;
    stop(name);
    if (!buffers.has(name)) {
      buffers.set(name, fetch(url, {signal: lifetime.signal}).then(r => r.ok ? r.arrayBuffer() : null)
        .then(bytes => bytes && context.decodeAudioData(bytes)).catch(() => null));
    }
    const entry = {};
    playing.set(name, entry);
    buffers.get(name).then(buffer => {
      if (playing.get(name) !== entry) return;
      if (!buffer || context.state !== 'running' || !allowed(name)) { playing.delete(name); return; }
      const source = context.createBufferSource();
      const volume = context.createGain();
      volume.gain.value = name === 'music' ? .48 : 1;
      source.buffer = buffer;
      source.loop = loop;
      source.connect(volume).connect(context.destination);
      source.onended = () => { if (playing.get(name) === entry) playing.delete(name); };
      entry.source = source;
      source.start();
    });
  }

  return {unlock, play, stop, close() {
    lifetime.abort();
    for (const name of playing.keys()) stop(name);
    buffers.clear();
    if (context && context.state !== 'closed') context.close().catch(() => {});
  }};
}

export async function loadTicketArt(catalogue, card, foilName, signal) {
  const sheetNames = new Set(card.games.flatMap(game => game.symbols.map(cell => catalogue.sheets.get(cell.sheet)?.file).filter(Boolean)));
  const files = [card.art, card.print, foilName, ...sheetNames];
  if (catalogue.url('ui-main.png')) files.push('ui-main.png');
  const loaded = await Promise.all(files.map(async file => [file, await catalogue.image(file, signal)]));
  const artwork = new Map(loaded);
  artwork.set('glow.png', await catalogue.image('glow.png', signal).catch(() => null));
  return artwork;
}

function draw(context, image, source, target, fit = false) {
  if (!image) return;
  const {width: w, height: h} = context.canvas;
  const sourceW = image.naturalWidth * source.w;
  const sourceH = image.naturalHeight * source.h;
  let width = target.w * w, height = target.h * h;
  let x = target.x * w, y = (1 - target.y - target.h) * h;
  if (fit) {
    const scale = Math.min(width / sourceW, height / sourceH);
    x += (width - sourceW * scale) / 2;
    y += (height - sourceH * scale) / 2;
    width = sourceW * scale;
    height = sourceH * scale;
  }
  context.drawImage(image, source.x * image.naturalWidth, (1 - source.y - source.h) * image.naturalHeight,
    sourceW, sourceH, x, y, width, height);
}

function drawWinHighlight(context, image, area) {
  const {width, height} = context.canvas;
  const w = area.w * width, h = area.h * height;
  const x = area.x * width, y = (1 - area.y - area.h) * height;
  context.save();
  context.globalCompositeOperation = 'lighter';
  context.globalAlpha = .391;
  if (image) {
    const edge = Math.min(9.375 * width / 1984, w / 2, h / 2);
    const source = [0, 48, 80, 128];
    const xs = [x, x + edge, x + w - edge, x + w];
    const ys = [y, y + edge, y + h - edge, y + h];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        context.drawImage(image, source[col], source[row], source[col + 1] - source[col], source[row + 1] - source[row],
          xs[col], ys[row], xs[col + 1] - xs[col], ys[row + 1] - ys[row]);
      }
    }
  } else {
    context.fillStyle = '#ffcc00';
    context.fillRect(x, y, w, h);
  }
  context.restore();
}

function drawSerial(context, atlas, serial) {
  const serialAdvance = digit => digit === '1' ? 20 : digit === '-' ? 30 : 35;
  const {width, height} = context.canvas;
  const sx = width / 1984, sy = height / 1152;
  if (!atlas) {
    context.fillStyle = '#111';
    context.font = `bold ${33 * sy}px Arial, sans-serif`;
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(serial, 1912 * sx, 1091 * sy);
    context.fillRect(1922 * sx, 1087 * sy, 35 * sx, 40 * sy);
    return;
  }
  const total = Array.from(serial).reduce((sum, digit) => sum + serialAdvance(digit), 0);
  let x = 1903 - total * 1.1;
  for (const digit of serial) {
    const index = digit === '-' ? 10 : Number(digit);
    context.drawImage(atlas, 168 + index % 6 * 36, 352 + Math.floor(index / 6) * 46, 36, 35,
      x * sx, 1089 * sy, 39.6 * sx, 38.5 * sy);
    x += serialAdvance(digit) * 1.1;
  }
  context.fillStyle = '#000';
  context.fillRect(1922 * sx, 1087 * sy, 35 * sx, 40 * sy);
}

function print(context, word, area, scale = .8) {
  if (!word || area.w <= 0 || area.h <= 0) return;
  const {width, height} = context.canvas;
  context.font = 'bold ' + Math.max(1, area.h * height * scale) + 'px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#15121a';
  context.fillText(word, (area.x + area.w / 2) * width, (1 - area.y - area.h / 2) * height, area.w * width);
}

// Classic Scratch draws the amount in bold, fitted to the box, then stretches it to twice the height.
function printAmount(context, word, area, sample) {
  if (!word || area.w <= 0 || area.h <= 0) return;
  const {width, height} = context.canvas;
  const boxW = area.w * width;
  const boxH = area.h * height;
  context.save();
  context.translate((area.x + area.w / 2) * width, (1 - area.y - area.h / 2) * height);
  let size = boxH * .8;
  context.font = `bold ${size}px Arial, sans-serif`;
  const measured = context.measureText(sample || word).width;
  if (measured > boxW) size *= boxW / measured;
  context.font = `bold ${size}px Arial, sans-serif`;
  context.fillStyle = '#15121a';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.scale(1, 2);
  context.fillText(word, 0, 0);
  context.restore();
}

function description(value) {
  const digits = String(value);
  const prefix = leading[Number(digits[0]) - 1];
  const suffix = magnitude[digits.length - 2];
  return prefix && suffix ? prefix + suffix : '';
}

export function createTicket({catalogue, card, artwork, foilName, pay, revealResult, audio, blocked, hint = true}) {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const paper = element('canvas');
  paper.width = 1280;
  paper.height = 744;
  const foil = element('canvas');
  foil.width = 960;
  foil.height = 558;
  const beneath = paper.getContext('2d');
  const mask = foil.getContext('2d', {willReadFrequently: true});
  const front = artwork.get(card.art);
  const matches = [];
  let winnings = 0, pointer, hold, rasp, paid = false, done = false;
  const view = button('', event => { if (!event.detail && begin()) reveal(); }, 'sp-ticket');
  view.setAttribute('aria-label', card.name + ', ' + money(card.cost) + '. Scratch, hold, or press Enter to reveal.');
  view.append(paper, foil);
  const hintUrl = hint ? catalogue.url('finger.png') : '';
  if (hintUrl) {
    const hint = image(hintUrl, '', 'sp-scratch-hint');
    const box = card.games[0].area;
    const height = .90, width = height * 1152 / 1984 * 588 / 616;
    const tipY = box.y + box.h * .35;
    Object.assign(hint.style, {
      left: (box.x + box.w / 2 - width / 2) * 100 + '%',
      top: (1 - tipY - height * .135) * 100 + '%',
      width: width * 100 + '%', height: height * 100 + '%'
    });
    hint.style.setProperty('--sp-scratch-travel', box.w * .30 / width * 100 + '%');
    view.append(hint);
  }
  draw(beneath, front, full, full);
  draw(mask, front, full, full);
  for (const {area} of card.games) draw(beneath, artwork.get(foilName), area, area);
  draw(beneath, artwork.get(card.print), full, full);
  const serial = String(random(0, 100000000)).padStart(8, '0') + '-' + String(random(0, 1000)).padStart(3, '0');
  const cabinet = artwork.get('ui-main.png');
  drawSerial(beneath, cabinet, serial);
  drawSerial(mask, cabinet, serial);
  const zones = [];
  for (const game of card.games) {
    const sheet = catalogue.sheets.get(game.symbols[0]?.sheet);
    const deal = dealContest(game, sheet?.frames.length ?? 0);
    winnings += deal.winnings;
    game.symbols.forEach((cell, i) => {
      const art = catalogue.sheets.get(cell.sheet);
      if (!art) return;
      const index = Math.max(0, Math.min(art.frames.length - 1, deal.symbols[i]));
      draw(beneath, artwork.get(art.file), art.frames[index], cell.value, true);
      print(beneath, art.captions[index], cell.caption);
    });
    const widest = money(game.cost * Math.max(...game.multipliers));
    game.prizes.forEach(({area, caption}, i) => {
      const value = {x: area.x + area.w * .04, y: area.y + area.h * .365, w: area.w * .92, h: area.h * .4665};
      printAmount(beneath, money(deal.prizes[i]), value, widest);
      print(beneath, description(deal.prizes[i]), caption);
    });
    game.hands.forEach((area, i) => print(beneath, deal.hands[i], area));
    game.wins.forEach((area, i) => { if (deal.wins[i]) matches.push(area); });
    zones.push(...[...game.symbols, ...game.prizes].map(({area}) => ({
      left: Math.max(0, Math.ceil(area.x * foil.width)),
      right: Math.min(foil.width, Math.floor((area.x + area.w) * foil.width)),
      top: Math.max(0, Math.ceil((1 - area.y - area.h) * foil.height)),
      bottom: Math.min(foil.height, Math.floor((1 - area.y) * foil.height))
    })));
  }

  function begin() {
    if (blocked() || done) return false;
    if (!paid) {
      paid = pay(card.cost, winnings);
      if (paid) view.classList.add('sp-scratched');
    }
    return paid;
  }

  function point(event) {
    const r = view.getBoundingClientRect();
    return {x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height};
  }

  function stroke(from, to) {
    const radius = foil.height * .093;
    mask.save();
    mask.globalCompositeOperation = 'destination-out';
    mask.beginPath();
    if (from === to) {
      mask.arc(to.x * foil.width, to.y * foil.height, radius, 0, Math.PI * 2);
      mask.fill();
    } else {
      mask.lineWidth = radius * 2;
      mask.lineCap = 'round';
      mask.moveTo(from.x * foil.width, from.y * foil.height);
      mask.lineTo(to.x * foil.width, to.y * foil.height);
      mask.stroke();
    }
    mask.restore();
    audio.play('scratch', true);
    clearTimeout(rasp);
    rasp = setTimeout(() => audio.stop('scratch'), 120);
  }

  function endStroke() {
    const id = pointer?.id;
    pointer = null;
    if (id != null && view.hasPointerCapture(id)) view.releasePointerCapture(id);
    clearTimeout(hold);
    clearTimeout(rasp);
    audio.stop('scratch');
  }

  async function reveal() {
    if (done) return;
    done = true;
    endStroke();
    foil.hidden = true;
    for (const area of matches) {
      if (!await wait(200, signal)) return;
      drawWinHighlight(beneath, artwork.get('glow.png'), area);
      audio.play('match');
    }
    if (await wait(350, signal)) revealResult(winnings);
  }

  view.addEventListener('pointerdown', event => {
    if (pointer || event.button !== 0 || !event.isPrimary) return;
    const p = point(event);
    if (!card.games.some(({area}) => p.x >= area.x && p.x <= area.x + area.w &&
      1 - p.y >= area.y && 1 - p.y <= area.y + area.h) || !begin()) return;
    event.preventDefault();
    view.setPointerCapture(event.pointerId);
    pointer = {id: event.pointerId, last: p, origin: p};
    stroke(p, p);
    hold = setTimeout(() => { if (!blocked()) reveal(); }, 1000);
  });
  view.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId || blocked()) return;
    const p = point(event);
    if (Math.hypot((p.x - pointer.origin.x) * foil.width, (p.y - pointer.origin.y) * foil.height) > 4) clearTimeout(hold);
    stroke(pointer.last, p);
    pointer.last = p;
  });
  view.addEventListener('pointerup', event => {
    if (pointer?.id !== event.pointerId) return;
    endStroke();
    const pixels = mask.getImageData(0, 0, foil.width, foil.height).data;
    let remaining = 0, total = 0;
    for (const {left, right, top, bottom} of zones) {
      total += (right - left) * (bottom - top);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) remaining += pixels[(y * foil.width + x) * 4 + 3];
    }
    if (!blocked() && remaining < total * 255 * .01) reveal();
  });
  view.addEventListener('pointercancel', endStroke);
  view.addEventListener('lostpointercapture', () => { if (pointer) endStroke(); });
  return {view, close() {
    lifetime.abort();
    endStroke();
    paper.width = foil.width = 0;
    view.remove();
  }};
}
