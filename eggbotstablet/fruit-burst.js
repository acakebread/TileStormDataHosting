// Copyright 2026 massivehadron.com ltd.
// Based on FruitBurst, massivehadron.com ltd.

import {button, countdown, element, loadSetting, number, saveSetting} from './ui.js';

const columns = 10;
const rows = 8;
const cellCount = columns * rows;
const cell = 100;
const border = 26;
const frameWidth = columns * cell + 2 * border;
const frameHeight = rows * cell + 2 * border;
const tileSize = .97 * cell;
const roundSeconds = 120;
const animationSeconds = 16 / 60;
const tileGravity = .02 * 60 * 60;
const starsPerTile = 8;
const starGravity = 1350;
const starFadeStart = .58;
const runScores = [0, 0, 0, 10, 30, 80, 200, 500, 1000, 2000, 4000];
const fruitNames = ['Bananas', 'Cherries', 'Eggplant', 'Lemon', 'Orange', 'Pear', 'Mangosteen'];
const highScoreKey = 'fruitHighScore';
const soundNames = ['select', 'destroy', 'combo', 'cascade'];

function rowOf(index) {
  return Math.floor(index / columns);
}

function columnOf(index) {
  return index % columns;
}

function scan(board, matched) {
  let points = 0;

  function line(start, length, step) {
    let runStart = 0;
    while (runStart < length) {
      const fruit = board[start + runStart * step];
      let end = runStart + 1;
      while (end < length && board[start + end * step] === fruit) end++;
      const run = end - runStart;
      if (fruit != null && run >= 3) {
        points += runScores[run];
        if (matched) {
          for (let i = runStart; i < end; i++) matched.add(start + i * step);
        }
      }
      runStart = end;
    }
  }

  for (let row = 0; row < rows; row++) line(row * columns, columns, 1);
  for (let col = 0; col < columns; col++) line(col, rows, columns);
  return points;
}

function swap(items, a, b) {
  [items[a], items[b]] = [items[b], items[a]];
}

function hasMove(board) {
  function trySwap(a, b) {
    swap(board, a, b);
    const result = scan(board) > 0;
    swap(board, a, b);
    return result;
  }

  for (let i = 0; i < board.length; i++) {
    if (columnOf(i) < columns - 1 && trySwap(i, i + 1)) return true;
    if (i < board.length - columns && trySwap(i, i + columns)) return true;
  }
  return false;
}

function fillBoard(board) {
  for (let i = board.length - 1; i >= 0; i--) {
    if (board[i] != null) continue;
    const neighbours = [board[i - columns], board[i + columns]];
    if (columnOf(i) > 0) neighbours.push(board[i - 1]);
    if (columnOf(i) < columns - 1) neighbours.push(board[i + 1]);
    const choices = fruitNames.map((_, type) => type).filter(type => !neighbours.includes(type));
    board[i] = choices[Math.floor(Math.random() * choices.length)];
  }
}

function readHighScore() {
  const saved = loadSetting(highScoreKey, 0);
  return Number.isSafeInteger(saved) && saved > 0 ? saved : 0;
}

function fruitSound() {
  const audioType = window.AudioContext || window.webkitAudioContext;
  let audio;
  let clips;

  return {
    unlock() {
      if (!audioType) return;
      if (!audio) {
        audio = new audioType();
        clips = Object.fromEntries(soundNames.map(name => {
          const url = new URL('./art/fruit-' + name + '.wav', import.meta.url);
          const clip = fetch(url)
            .then(response => response.ok ? response.arrayBuffer() : null)
            .then(bytes => bytes && audio.decodeAudioData(bytes))
            .catch(() => null);
          return [name, clip];
        }));
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    },
    play(name) {
      const started = performance.now();
      clips?.[name].then(buffer => {
        if (!buffer || audio.state !== 'running' || performance.now() - started > 200) return;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        source.start();
      });
    }
  };
}

function randomBetween(min, max) {
  return min + (max - min) * Math.random();
}

export function createFruit({open}) {
  const board = Array(cellCount);
  const tiles = Array(cellCount);
  const matched = new Set();
  const stars = [];
  const sound = fruitSound();
  let state = 'loading';
  let active = false;
  let frame = 0;
  let previousTime;
  let remaining = roundSeconds;
  let score = 0;
  let highScore = readHighScore();
  let selected = -1;
  let hover = -1;
  let drag;
  let pair;
  let phase = 0;
  let cascade = 0;
  let ranOutOfMoves = false;
  let width = 0;
  let height = 0;
  let scale = 1;
  let left = 0;
  let top = 0;
  let marble;

  const scoreText = element('output', 'fruit-value', '0');
  const highScoreText = element('output', 'fruit-value fruit-gold', number.format(highScore));
  const clock = element('output', 'fruit-value', countdown(roundSeconds * 1000));
  clock.setAttribute('role', 'timer');
  const stat = (label, value) => {
    value.setAttribute('aria-label', label);
    return element('div', 'fruit-stat', element('span', '', label), value);
  };
  const panel = element('header', 'fruit-panel',
    element('h2', 'fruit-gold', 'Fruit Burst'),
    element('div', 'fruit-stats', stat('Score', scoreText), stat('High Score', highScoreText), stat('Time', clock)));
  const canvas = element('canvas', 'fruit-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  const controls = Array.from({length: cellCount}, (_, index) => {
    const tile = button('', event => {
      if (event.detail === 0) {
        sound.unlock();
        select(index);
      }
    });
    return tile;
  });
  const grid = element('div', 'fruit-cells', ...controls);
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Fruit Burst board');
  grid.inert = true;
  const loading = element('p', 'fruit-loading', 'Loading Fruit Burst…');
  loading.setAttribute('role', 'status');
  const area = element('div', 'fruit-play-area', canvas, grid, loading);

  const headline = element('h3', 'fruit-gold');
  const detail = element('p', 'fruit-final-score');
  const record = element('p', 'fruit-gold');
  const again = button('Play again', () => {
    sound.unlock();
    deal();
  }, 'fruit-again');
  const quit = button('Quit', () => {
    open('home');
    deal();
  }, 'fruit-quit');
  const result = element('div', 'fruit-result', headline, detail, record,
    element('div', 'fruit-result-actions', again, quit));
  result.hidden = true;
  result.setAttribute('role', 'status');
  const view = element('section', 'fruit-app', element('div', 'fruit-layout', panel, area), result);

  const sheet = new Image();
  sheet.addEventListener('load', () => {
    if (active && state === 'loading') deal();
  });
  sheet.addEventListener('error', () => {
    loading.textContent = 'Fruit Burst artwork could not load.';
  });
  sheet.src = new URL('./art/fruit-sheet.png?v=glossy', import.meta.url).href;

  const frameArt = new Image();
  frameArt.addEventListener('load', () => {
    marble = context.createPattern(frameArt, 'repeat');
    marble?.setTransform({a: 256 / frameArt.naturalWidth, d: 256 / frameArt.naturalHeight});
    paint();
  });
  frameArt.src = new URL('./art/fruit-frame.png', import.meta.url).href;

  function updateCells() {
    for (let i = 0; i < cellCount; i++) {
      controls[i].setAttribute('aria-label', fruitNames[board[i]] + ', row ' + (rowOf(i) + 1) +
        ', column ' + (columnOf(i) + 1));
      controls[i].setAttribute('aria-pressed', String(i === selected || pair?.includes(i) === true));
    }
  }

  function updateScore() {
    scoreText.textContent = number.format(score);
    const stored = readHighScore();
    highScore = Math.max(highScore, stored, score);
    highScoreText.textContent = number.format(highScore);
    if (highScore > stored) saveSetting(highScoreKey, highScore);
  }

  function updateClock() {
    const value = countdown(remaining * 1000);
    if (clock.textContent === value) return;
    clock.textContent = value;
    clock.classList.toggle('fruit-hurry', remaining <= 10);
  }

  function dropNewTiles() {
    for (let i = cellCount - 1; i >= 0; i--) {
      if (tiles[i]) continue;
      // Unity's board coordinates start at the bottom, with new fruit above row 12.
      const below = tiles[i + columns];
      const spawnY = rows - 1 - columns * 1.2;
      const y = below ? Math.min(spawnY, below.y - 1) : spawnY;
      tiles[i] = {x: columnOf(i), y: y - randomBetween(0, 2), speed: 0, size: 1};
    }
  }

  function deal() {
    do {
      board.fill(null);
      fillBoard(board);
    } while (!hasMove(board));
    tiles.fill(null);
    dropNewTiles();
    stars.length = 0;
    selected = hover = -1;
    drag = pair = null;
    cascade = 0;
    matched.clear();
    score = 0;
    remaining = roundSeconds;
    previousTime = undefined;
    state = 'falling';
    loading.hidden = true;
    result.hidden = true;
    grid.inert = false;
    updateCells();
    updateScore();
    updateClock();
    paint();
    requestFrame();
  }

  function settle() {
    for (let col = 0; col < columns; col++) {
      let write = (rows - 1) * columns + col;
      for (let read = write; read >= 0; read -= columns) {
        if (matched.has(read)) continue;
        board[write] = board[read];
        tiles[write] = tiles[read];
        write -= columns;
      }
      for (; write >= 0; write -= columns) {
        board[write] = null;
        tiles[write] = null;
      }
    }
    fillBoard(board);
    dropNewTiles();
    updateCells();
    state = 'falling';
  }

  function fall(step) {
    let moving = false;
    for (const [index, tile] of tiles.entries()) {
      const target = rowOf(index);
      if (tile.y >= target) continue;
      tile.speed += tileGravity * step;
      tile.y = Math.min(target, tile.y + tile.speed * step);
      if (tile.y === target) tile.speed = 0;
      moving = true;
    }
    return moving;
  }

  function burst(tile) {
    const x = (tile.x + .5) * cell;
    const y = (tile.y + .5) * cell;
    for (let i = 0; i < starsPerTile; i++) {
      const launch = (-10 + 200 / (starsPerTile - 1) * i + randomBetween(-10, 10)) * Math.PI / 180;
      const speed = randomBetween(175, 310);
      stars.push({
        x, y, vx: Math.cos(launch) * speed, vy: -Math.sin(launch) * speed,
        radius: randomBetween(23, 32), rotation: randomBetween(0, 2 * Math.PI),
        spin: (Math.random() < .5 ? -1 : 1) * randomBetween(5, 16),
        age: 0, lifetime: randomBetween(.85, 1)
      });
    }
  }

  function advanceStars(step) {
    for (let i = stars.length - 1; i >= 0; i--) {
      const star = stars[i];
      star.age += step;
      if (star.age < star.lifetime) continue;
      stars[i] = stars[stars.length - 1];
      stars.pop();
    }
  }

  function detect() {
    matched.clear();
    const earned = scan(board, matched);
    if (earned) {
      score += earned;
      updateScore();
      for (const index of matched) burst(tiles[index]);
      sound.play('destroy');
      if (earned > 10) sound.play('combo');
      if (cascade > 0) sound.play('cascade');
      cascade++;
      phase = 0;
      state = 'clearing';
    } else if (!hasMove(board)) {
      end(true);
    } else {
      state = 'waiting';
    }
  }

  function beginSwap(a, b, nextState) {
    swap(board, a, b);
    swap(tiles, a, b);
    for (const i of [a, b]) {
      tiles[i].fromX = tiles[i].x;
      tiles[i].fromY = tiles[i].y;
    }
    pair = [a, b];
    selected = -1;
    phase = 0;
    state = nextState;
    updateCells();
  }

  function move(step) {
    phase += step;
    const progress = Math.min(1, phase / animationSeconds);
    for (const index of pair) {
      const tile = tiles[index];
      tile.x = tile.fromX + (columnOf(index) - tile.fromX) * progress;
      tile.y = tile.fromY + (rowOf(index) - tile.fromY) * progress;
    }
    if (progress < 1) return;
    if (state === 'swapping' && !scan(board)) {
      beginSwap(...pair, 'swappingBack');
      return;
    }
    pair = null;
    cascade = 0;
    updateCells();
    state = 'falling';
  }

  function end(stuck) {
    ranOutOfMoves = stuck;
    phase = stuck ? -1 : 0;
    selected = hover = -1;
    drag = null;
    state = 'emptying';
    grid.inert = true;
  }

  function showResult() {
    state = 'over';
    headline.textContent = ranOutOfMoves ? 'Game Over' : 'Time Up';
    detail.textContent = (ranOutOfMoves ? 'Out of moves. Score ' : 'Score ') + number.format(score);
    record.textContent = 'High score ' + number.format(highScore);
    result.hidden = false;
    again.focus({preventScroll: true});
  }

  function advance(step) {
    advanceStars(step);
    switch (state) {
      case 'falling':
        if (!fall(step)) detect();
        break;
      case 'swapping':
      case 'swappingBack':
        move(step);
        break;
      case 'clearing':
        phase += step;
        for (const index of matched) tiles[index].size = Math.max(0, 1 - phase / animationSeconds);
        if (phase >= animationSeconds) settle();
        break;
      case 'waiting':
        if (remaining <= 0) end(false);
        break;
      case 'emptying':
        phase += step;
        for (const tile of tiles) tile.size = Math.min(1, Math.max(0, 1 - phase / animationSeconds));
        if (phase >= animationSeconds) showResult();
        break;
    }
  }

  function resize() {
    width = area.clientWidth;
    height = area.clientHeight;
    if (!width || !height) return;
    const density = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    scale = .94 * Math.min(width / frameWidth, height / frameHeight);
    left = (width - frameWidth * scale) / 2;
    top = (height - frameHeight * scale) / 2;
    Object.assign(grid.style, {
      left: (left + border * scale) + 'px', top: (top + border * scale) + 'px',
      width: (columns * cell * scale) + 'px', height: (rows * cell * scale) + 'px'
    });
    paint();
  }

  function sprite(column, row, x, y, size) {
    if (size <= 0) return;
    // Match the Unity atlas crop, with two texels trimmed from the artwork edges.
    context.drawImage(sheet, column * 128 + 2, row * 128 + 2, 122, 122,
      x - size / 2, y - size / 2, size, size);
  }

  function paint() {
    if (!width || !height || state === 'loading') return;
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(left, top);
    context.scale(scale, scale);
    context.fillStyle = marble || '#97988f';
    context.fillRect(0, 0, frameWidth, frameHeight);
    context.translate(border, border);
    context.save();
    context.beginPath();
    context.rect(0, 0, columns * cell, rows * cell);
    context.clip();
    context.fillStyle = 'rgba(0,0,0,.35)';
    context.fillRect(0, 0, columns * cell, rows * cell);

    for (const [index, tile] of tiles.entries()) {
      const look = index === selected || pair?.includes(index) ? 2 : state === 'waiting' && index === hover ? 1 : 0;
      sprite(board[index], look, (tile.x + .5) * cell, (tile.y + .5) * cell, tileSize * tile.size);
    }
    context.restore();

    for (const star of stars) {
      const progress = star.age / star.lifetime;
      context.save();
      context.translate(star.x + star.vx * star.age, star.y + star.vy * star.age + .5 * starGravity * star.age ** 2);
      context.rotate(star.rotation + star.spin * star.age);
      context.globalAlpha = 1 - Math.max(0, (progress - starFadeStart) / (1 - starFadeStart));
      const size = 2 * star.radius * (.12 + .88 * progress ** .65);
      sprite(0, 4, 0, 0, size);
      context.restore();
    }
  }

  function animate(now) {
    frame = 0;
    const elapsed = previousTime === undefined ? 0 : (now - previousTime) / 1000;
    previousTime = now;
    if (state !== 'emptying' && state !== 'over') {
      remaining = Math.max(0, remaining - elapsed);
      updateClock();
    }
    const repaint = state !== 'waiting' || stars.length > 0;
    advance(Math.min(.05, elapsed));
    if (repaint || state !== 'waiting') paint();
    requestFrame();
  }

  function requestFrame() {
    if (active && !document.hidden && !frame && state !== 'loading' && (state !== 'over' || stars.length)) {
      frame = requestAnimationFrame(animate);
    }
  }

  function stopFrames() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = undefined;
    if (drag && grid.hasPointerCapture(drag.id)) grid.releasePointerCapture(drag.id);
    drag = null;
  }

  function select(index) {
    if (!active || state !== 'waiting' || remaining <= 0) return;
    sound.play('select');
    if (selected >= 0 &&
        Math.abs(columnOf(selected) - columnOf(index)) + Math.abs(rowOf(selected) - rowOf(index)) === 1) {
      beginSwap(selected, index, 'swapping');
    } else {
      selected = index;
      updateCells();
    }
    paint();
  }

  function locate(event, bounds) {
    const col = Math.floor((event.clientX - bounds.left) / (bounds.width / columns));
    const row = Math.floor((event.clientY - bounds.top) / (bounds.height / rows));
    return col >= 0 && col < columns && row >= 0 && row < rows ? row * columns + col : -1;
  }

  function pointerMove(event) {
    const bounds = grid.getBoundingClientRect();
    const index = locate(event, bounds);
    const nextHover = event.pointerType === 'mouse' ? index : -1;
    if (hover !== nextHover) {
      hover = nextHover;
      if (state === 'waiting') paint();
    }
    if (drag?.id !== event.pointerId || state !== 'waiting') return;

    // A short flick acts on one neighbour even if the pointer skipped past it between events.
    const dx = (event.clientX - drag.x) / (bounds.width / columns);
    const dy = (event.clientY - drag.y) / (bounds.height / rows);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < .3) return;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const col = columnOf(drag.index) + (horizontal ? Math.sign(dx) : 0);
    const row = rowOf(drag.index) + (horizontal ? 0 : Math.sign(dy));
    if (col < 0 || col >= columns || row < 0 || row >= rows) return;
    drag = null;
    select(row * columns + col);
  }

  function release(event) {
    if (drag?.id === event.pointerId) drag = null;
  }

  grid.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || state !== 'waiting') return;
    const index = locate(event, grid.getBoundingClientRect());
    if (index < 0) return;
    sound.unlock();
    select(index);
    if (state === 'waiting') {
      drag = {index, id: event.pointerId, x: event.clientX, y: event.clientY};
      grid.setPointerCapture(event.pointerId);
    }
  });
  grid.addEventListener('pointermove', pointerMove);
  grid.addEventListener('pointerup', event => {
    pointerMove(event);
    release(event);
  });
  grid.addEventListener('pointercancel', release);
  grid.addEventListener('lostpointercapture', event => {
    if (event.target === grid) release(event);
  });
  grid.addEventListener('pointerleave', () => {
    hover = -1;
    if (state === 'waiting') paint();
  });
  new ResizeObserver(resize).observe(area);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopFrames();
    else requestFrame();
  });

  return {
    view,
    open() {
      active = true;
      resize();
      if (state === 'loading' && sheet.naturalWidth) deal();
      else requestFrame();
    },
    close() {
      active = false;
      stopFrames();
      hover = -1;
      stars.length = 0;
    }
  };
}
