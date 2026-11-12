// Copyright 2026 massivehadron.com ltd.
// Game rules based on Scratch Bling and FruitBurst by massivehadron.com ltd.

import {shuffle} from '../tablet-preview/shared.js';
import {element, button, countdown, number, loadSetting, saveSetting, weighted} from './ui.js';

export function createScratch({data}) {
  const cost = 100;
  const refillDelay = 10 * 60 * 1000;
  const prizes = [1, 2, 3, 5, 8, 10, 20, 50].map((multiplier, index) => ({
    amount: multiplier * cost, odds: 1 / [1, 2, 5, 10, 20, 50, 100, 200][index]
  }));
  const chance = .55 * prizes.reduce((total, prize) => total + prize.odds, 0) /
    prizes.reduce((total, prize) => total + prize.amount / cost * prize.odds, 0);
  const saved = loadSetting('scratchWallet', {});
  let cash = Number.isInteger(saved?.cash) && saved.cash >= 0 ? saved.cash : 1000;
  let refill = Number(saved?.refill) || 0;
  let cells;
  let winning;
  let remaining;
  let paid;
  let pointer;

  const wallet = element('output', 'muted');
  const status = element('p', '', 'Match three prizes to win. First scratch costs 100 coins.');
  status.setAttribute('role', 'status');
  const grid = element('div', 'scratch-grid');
  grid.setAttribute('aria-label', 'Scratch card prizes');
  const card = element('div', 'scratch-card', grid);
  const artwork = data.media('MHScratch/Textures/cards/card01');
  if (artwork) card.style.backgroundImage = 'url("' + artwork + '")';
  const again = button('New card · 100 coins', deal, 'primary');
  again.hidden = true;
  const view = element('section', '', element('div', 'app-content',
    element('header', 'app-heading', element('h2', '', 'Scratch Bling'), wallet), status, card, again));

  function tick(now) {
    if (refill && now >= refill) {
      cash = Math.max(cash, 1000);
      refill = 0;
      saveSetting('scratchWallet', {cash, refill});
    }
    wallet.textContent = number.format(cash) + ' coins' + (refill ? ' · Refill in ' + countdown(refill - now) : '');
    for (const [index, control] of Array.from(grid.children).entries()) {
      control.disabled = !paid && cash < cost && cells[index] != null;
    }
    again.disabled = cash < cost;
  }

  function deal() {
    winning = Math.random() < chance ? weighted(prizes, prize => prize.odds) : null;
    const matches = winning ? [winning, winning, winning] : [];
    const fillers = shuffle(prizes.filter(prize => prize !== winning).flatMap(prize => [prize, prize]));
    cells = shuffle([...matches, ...fillers.slice(0, 9 - matches.length)]);
    paid = false;
    remaining = cells.length;
    again.hidden = true;
    status.textContent = 'Match three prizes to win. First scratch costs 100 coins.';
    grid.replaceChildren(...cells.map((_, index) => {
      const control = button('PRIZE', () => reveal(index));
      control.dataset.cell = index;
      control.setAttribute('aria-label', 'Scratch prize ' + (index + 1));
      return control;
    }));
    tick(Date.now());
  }

  function reveal(index) {
    const prize = cells[index];
    if (!prize || (!paid && cash < cost)) return;
    if (!paid) {
      paid = true;
      cash -= cost;
      if (cash < cost) refill = Date.now() + refillDelay;
      saveSetting('scratchWallet', {cash, refill});
    }
    cells[index] = null;
    remaining--;
    const control = grid.children[index];
    control.textContent = '$' + number.format(prize.amount);
    control.setAttribute('aria-label', 'Prize ' + (index + 1) + ', ' + control.textContent);
    control.setAttribute('aria-disabled', 'true');
    control.classList.add('revealed');
    if (prize === winning) control.dataset.match = '';
    if (remaining === 0) {
      if (winning) {
        cash += winning.amount;
        if (cash >= cost) refill = 0;
        saveSetting('scratchWallet', {cash, refill});
        for (const match of grid.querySelectorAll('[data-match]')) match.classList.add('winner');
      }
      status.textContent = winning ? 'You won ' + number.format(winning.amount) + ' coins!' : 'No win. One day.';
      again.hidden = false;
    }
    tick(Date.now());
  }

  grid.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const control = event.target.closest('[data-cell]');
    if (!control) return;
    pointer = event.pointerId;
    grid.setPointerCapture(pointer);
    reveal(Number(control.dataset.cell));
  });
  grid.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const control = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cell]');
    if (control && grid.contains(control)) reveal(Number(control.dataset.cell));
  });
  grid.addEventListener('lostpointercapture', () => { pointer = undefined; });
  deal();
  return {view, open() { tick(Date.now()); }, tick};
}

const columns = 10;
const rows = 8;
const fruitTypes = 7;
const runScores = [0, 0, 0, 10, 30, 80, 200, 500, 1000, 2000, 4000];

function scan(board) {
  const matched = new Set();
  let points = 0;

  function line(start, length, step) {
    let runStart = 0;
    while (runStart < length) {
      const fruit = board[start + runStart * step];
      let end = runStart + 1;
      while (end < length && board[start + end * step] === fruit) end++;
      if (end - runStart >= 3) {
        points += runScores[end - runStart];
        for (let i = runStart; i < end; i++) matched.add(start + i * step);
      }
      runStart = end;
    }
  }

  for (let row = 0; row < rows; row++) line(row * columns, columns, 1);
  for (let col = 0; col < columns; col++) line(col, rows, columns);
  return {matched, points};
}

function swap(board, a, b) {
  [board[a], board[b]] = [board[b], board[a]];
}

function hasMove(board) {
  function trySwap(a, b) {
    swap(board, a, b);
    const result = scan(board).points > 0;
    swap(board, a, b);
    return result;
  }
  for (let i = 0; i < board.length; i++) {
    if (i % columns < columns - 1 && trySwap(i, i + 1)) return true;
    if (i < board.length - columns && trySwap(i, i + columns)) return true;
  }
  return false;
}

function randomFruit(board, index) {
  const neighbours = [board[index - columns], board[index + columns]];
  if (index % columns > 0) neighbours.push(board[index - 1]);
  if (index % columns < columns - 1) neighbours.push(board[index + 1]);
  const options = Array.from({length: fruitTypes}, (_, fruit) => fruit).filter(fruit => !neighbours.includes(fruit));
  return options[Math.floor(Math.random() * options.length)];
}

function refillBoard(board) {
  for (let i = board.length - 1; i >= 0; i--) {
    if (board[i] == null) board[i] = randomFruit(board, i);
  }
}

function settleBoard(board, matched) {
  for (let col = 0; col < columns; col++) {
    let write = (rows - 1) * columns + col;
    for (let read = write; read >= 0; read -= columns) {
      if (matched.has(read)) continue;
      board[write] = board[read];
      write -= columns;
    }
    for (; write >= 0; write -= columns) board[write] = null;
  }
  refillBoard(board);
}

export function createFruit() {
  let board;
  let first;
  let score = 0;
  let deadline = 0;
  let remaining = 120000;
  let busy = false;
  let active = false;
  let playing = false;
  let drag;
  let dragged = false;
  let resolution;

  const time = element('output', 'muted');
  const points = element('output', 'muted');
  const status = element('p', 'fruit-status', 'Swap adjacent fruit to match three or more.');
  status.setAttribute('role', 'status');
  const grid = element('div', 'fruit-board');
  grid.setAttribute('aria-label', 'Fruit Burst board');
  grid.hidden = true;
  const controls = Array.from({length: rows * columns}, (_, index) => {
    const control = button('', event => {
      if (dragged && event.detail) return;
      select(index);
    });
    control.dataset.cell = index;
    control.append(element('span'));
    return control;
  });
  grid.append(...controls);
  const again = button('Play', start, 'primary');
  const view = element('section', '', element('div', 'app-content',
    element('header', 'app-heading', element('h2', '', 'Fruit Burst'), points, time),
    grid, status, element('div', 'actions love-actions', again)));

  function draw(matched = new Set()) {
    for (const [index, control] of controls.entries()) {
      const fruit = board[index];
      control.style.setProperty('--fruit-position', fruit / 7 * 100 + '%');
      control.setAttribute('aria-label', 'Fruit ' + (fruit + 1) + ', row ' + (Math.floor(index / columns) + 1) +
        ', column ' + (index % columns + 1));
      control.setAttribute('aria-pressed', String(first === index));
      control.classList.toggle('matched', matched.has(index));
    }
    points.textContent = 'Score ' + number.format(score);
  }

  function tick(now) {
    if (playing && active) {
      remaining = Math.max(0, deadline - now);
      if (remaining === 0) end('Time’s up.');
    }
    time.textContent = countdown(remaining);
  }

  function end(message) {
    playing = false;
    busy = false;
    first = null;
    clearTimeout(resolution);
    draw();
    for (const control of controls) control.disabled = true;
    again.hidden = false;
    again.textContent = 'Play again';
    status.textContent = message;
  }

  function start() {
    do {
      board = Array(rows * columns).fill(null);
      refillBoard(board);
    } while (!hasMove(board));
    first = null;
    score = 0;
    remaining = 120000;
    deadline = Date.now() + remaining;
    playing = true;
    busy = false;
    for (const control of controls) control.disabled = false;
    grid.hidden = false;
    again.hidden = true;
    status.textContent = 'Swap adjacent fruit to match three or more.';
    draw();
    tick(Date.now());
  }

  function adjacent(a, b) {
    return Math.abs(a - b) === columns || (Math.abs(a - b) === 1 && Math.floor(a / columns) === Math.floor(b / columns));
  }

  function resolve(combo = 0) {
    const {matched, points: earned} = scan(board);
    if (!earned) {
      busy = false;
      draw();
      if (!hasMove(board)) end('No moves left.');
      return;
    }
    score += earned + combo * 10;
    draw(matched);
    resolution = setTimeout(() => {
      settleBoard(board, matched);
      resolve(combo + 1);
    }, 190);
  }

  function move(from, to) {
    if (!playing || busy || !adjacent(from, to)) return;
    tick(Date.now());
    if (!playing) return;
    first = null;
    swap(board, from, to);
    if (!scan(board).points) {
      swap(board, from, to);
      status.textContent = 'That swap didn’t make a match.';
      draw();
      return;
    }
    status.textContent = '';
    busy = true;
    resolve();
  }

  function select(index) {
    if (!playing || busy) return;
    if (first != null && adjacent(first, index)) {
      move(first, index);
      return;
    }
    first = first === index ? null : index;
    draw();
  }

  grid.addEventListener('pointerdown', event => {
    dragged = false;
    const cell = event.target.closest('[data-cell]');
    if (!cell || event.button !== 0 || !event.isPrimary) return;
    drag = {index: Number(cell.dataset.cell), x: event.clientX, y: event.clientY, id: event.pointerId};
  });
  grid.addEventListener('pointercancel', () => { drag = null; });
  grid.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const {index, x, y} = drag;
    drag = null;
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 15) return;
    const to = index + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * columns);
    dragged = true;
    if (to >= 0 && to < controls.length) move(index, to);
  });

  return {view, tick, open() {
    if (!active) deadline = Date.now() + remaining;
    active = true;
    tick(Date.now());
  }, close() {
    tick(Date.now());
    active = false;
    drag = null;
  }};
}
