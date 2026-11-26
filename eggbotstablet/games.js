// Copyright 2026 massivehadron.com ltd.
// Based on Scratch Bling, copyright 2016 massivehadron.com ltd. created 29/09/2016 by Andrew Cakebread

import {shuffle} from '../tablet-preview/shared.js';
import {dollars, loadScratchCard} from './scratch-card.js?v=scratch-prize-size';
import {button, countdown, element, loadSetting, saveSetting, weighted} from './ui.js';

const cost = 100;
const startingCash = 1000;
const refillDelay = 10 * 60 * 1000;
const prizes = [1, 2, 3, 5, 8, 10, 20, 50].map((multiplier, index) => ({
  amount: multiplier * cost, odds: 1 / [1, 2, 5, 10, 20, 50, 100, 200][index]
}));
const winChance = .55 * prizes.reduce((sum, prize) => sum + prize.odds, 0) /
  prizes.reduce((sum, prize) => sum + prize.amount / cost * prize.odds, 0);

function dealPrizes(winner) {
  const deck = shuffle(prizes.filter(prize => prize !== winner).flatMap(prize => [prize, prize]));
  // Inserting within the first seven positions keeps all three matches on the nine-cell card.
  if (winner) {
    for (let copy = 0; copy < 3; copy++) deck.splice(Math.floor(Math.random() * 7), 0, winner);
  }
  return deck.slice(0, 9);
}

function scratchAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  const clips = ['scratch', 'match', 'win_0', 'lose_0'];
  const downloads = Audio ? clips.map(clip => fetch(new URL('./art/scratch/' + clip + '.mp3', import.meta.url))
    .then(response => response.ok ? response.arrayBuffer() : null).catch(() => null)) : [];
  const playing = new Map();
  let context;
  let buffers;

  function unlock() {
    if (!Audio) return;
    try {
      context ??= new Audio();
      if (context.state !== 'running') context.resume().catch(() => {});
      buffers ??= Object.fromEntries(clips.map((clip, index) => [clip,
        downloads[index].then(bytes => bytes && context.decodeAudioData(bytes)).catch(() => null)
      ]));
    } catch {
      // The card stays playable when audio is unavailable.
    }
  }

  function stop(clip) {
    playing.get(clip)?.source?.stop();
    playing.delete(clip);
  }

  function play(clip, loop = false) {
    if (!buffers || (loop && playing.has(clip))) return;
    stop(clip);
    const request = {source: null};
    playing.set(clip, request);
    buffers[clip].then(buffer => {
      if (playing.get(clip) !== request) return;
      if (!buffer || context.state !== 'running') {
        playing.delete(clip);
        return;
      }
      const source = context.createBufferSource();
      request.source = source;
      source.buffer = buffer;
      source.loop = loop;
      source.connect(context.destination);
      source.onended = () => {
        if (playing.get(clip) === request) playing.delete(clip);
      };
      source.start();
    });
  }

  return {unlock, play, stop, stopAll() { for (const clip of playing.keys()) stop(clip); }};
}

export function createScratch({data, open: openApp}) {
  const saved = loadSetting('scratchWallet', {});
  let cash = Number.isInteger(saved?.cash) && saved.cash >= 0 ? saved.cash : startingCash;
  let refill = Number(saved?.refill) || 0;
  let card;
  let round;
  let panelMode;
  let active = false;
  let loading = false;
  let press;
  let holdTimer;
  let raspTimer;
  let revealTimer;
  let lossTimer;
  const audio = scratchAudio();

  const cardButton = button('', event => {
    if (event.detail !== 0 || !beginScratch()) return;
    reveal();
  }, 'scratch-card');
  cardButton.hidden = true;
  cardButton.setAttribute('aria-label', 'Mega Rich. Match three prizes to win. A card costs $100. ' +
    'Drag to scratch the foil or hold for one second to reveal the card. Press Enter to reveal with the keyboard.');
  const cashAmount = element('output', '', dollars(cash));
  const cashBar = element('div', 'scratch-cash', element('span', '', 'CASH'), cashAmount);
  cashBar.hidden = true;

  const title = element('h2', 'scratch-headline');
  const detail = element('p', 'scratch-detail');
  const retry = button('RETRY', load, 'scratch-play');
  const again = button('PLAY AGAIN', () => { deal(); cardButton.focus(); }, 'scratch-play');
  const moreCoins = element('p', 'scratch-countdown');
  const quit = button('QUIT', () => {
    if (card) deal();
    openApp('home');
  }, 'scratch-quit');
  const panel = element('div', 'scratch-panel',
    element('div', 'scratch-message', title, detail), retry, again, moreCoins, quit);
  panel.firstElementChild.setAttribute('role', 'status');
  const unlucky = element('p', 'scratch-unlucky', 'UNLUCKY, TRY AGAIN!');
  unlucky.hidden = true;
  cardButton.append(unlucky);
  const view = element('section', 'scratch-app', element('div', 'scratch-card-area', cardButton), panel, cashBar);
  view.setAttribute('aria-label', 'Scratch Bling');

  function saveWallet() {
    saveSetting('scratchWallet', {cash, refill});
  }

  function walletWait(now) {
    const oldCash = cash;
    const oldRefill = refill;
    if (cash >= cost) {
      refill = 0;
    } else if (!refill || refill - now > refillDelay) {
      refill = now + refillDelay;
    } else if (now >= refill) {
      cash = startingCash;
      refill = 0;
    }
    if (cash !== oldCash || refill !== oldRefill) saveWallet();
    return refill ? refill - now : 0;
  }

  function showWait(wait) {
    moreCoins.hidden = !wait;
    again.hidden = !!wait;
    if (wait) {
      const text = 'MORE COINS\nIN ' + countdown(wait);
      if (moreCoins.textContent !== text) moreCoins.textContent = text;
    }
  }

  function showPanel(mode, message, text = '', wait = 0) {
    const restoreFocus = active && view.contains(document.activeElement);
    panelMode = mode;
    const shaded = mode === 'result' || mode === 'out-of-cash';
    panel.classList.toggle('shaded', shaded);
    title.textContent = message;
    title.classList.toggle('gold', mode === 'result' && !!round.winner);
    detail.textContent = text;
    retry.hidden = mode !== 'error';
    if (shaded) showWait(wait);
    else moreCoins.hidden = again.hidden = true;
    panel.hidden = false;
    cardButton.inert = true;
    if (restoreFocus) {
      const action = [retry, again, quit].find(control => !control.hidden);
      action.focus();
    }
  }

  function hidePanel() {
    panelMode = null;
    panel.hidden = true;
    cardButton.inert = false;
  }

  function tick(now) {
    if (!round) return;
    if (!round.paid || round.phase === 'done') {
      const wait = walletWait(now);
      if (panelMode === 'out-of-cash' && !wait) {
        const restoreFocus = panel.contains(document.activeElement);
        hidePanel();
        if (restoreFocus) cardButton.focus();
      } else if (panelMode === 'result' || panelMode === 'out-of-cash') {
        showWait(wait);
      } else if (wait) {
        showPanel('out-of-cash', 'OUT OF CASH', 'Cards cost ' + dollars(cost), wait);
      }
    }
    const amount = dollars(cash);
    if (cashAmount.value !== amount) cashAmount.value = amount;
  }

  function hideUnlucky() {
    clearTimeout(lossTimer);
    unlucky.hidden = true;
  }

  function deal() {
    hideUnlucky();
    const winner = Math.random() < winChance ? weighted(prizes, prize => prize.odds) : null;
    const cells = dealPrizes(winner);
    const next = {winner, cells, paid: false, phase: 'playing', highlights: []};
    round = next;
    card.deal(cells.map(prize => prize.amount));
    // Restart the idle finger prompt for each fresh card.
    card.finger.hidden = true;
    requestAnimationFrame(() => {
      if (round === next && !next.paid) card.finger.hidden = false;
    });
    hidePanel();
    tick(Date.now());
  }

  async function load() {
    if (loading || card) return;
    loading = true;
    showPanel('loading', 'Loading scratch card…');
    try {
      card = await loadScratchCard(data);
      const restoreFocus = active && panel.contains(document.activeElement);
      cardButton.append(...card.layers);
      cardButton.hidden = cashBar.hidden = false;
      deal();
      if (restoreFocus) (panel.hidden ? cardButton : quit).focus();
    } catch {
      card = round = null;
      cardButton.replaceChildren();
      cardButton.hidden = cashBar.hidden = true;
      showPanel('error', 'Couldn’t load the scratch card.');
    } finally {
      loading = false;
    }
  }

  function beginScratch() {
    if (!active || panelMode || press || round?.phase !== 'playing') return false;
    if (!round.paid) {
      tick(Date.now());
      if (cash < cost) return false;
      cash -= cost;
      round.paid = true;
      saveWallet();
      tick(Date.now());
    }
    card.finger.hidden = true;
    audio.unlock();
    return true;
  }

  function scratch(from, to) {
    if (!card.stroke(from, to)) return;
    clearTimeout(raspTimer);
    audio.play('scratch', true);
    raspTimer = setTimeout(() => audio.stop('scratch'), 120);
  }

  function endPress() {
    const id = press?.id;
    press = null;
    clearTimeout(holdTimer);
    clearTimeout(raspTimer);
    audio.stop('scratch');
    if (id !== undefined && cardButton.hasPointerCapture(id)) cardButton.releasePointerCapture(id);
  }

  function reveal() {
    endPress();
    card.clear();
    round.phase = 'revealing';
    round.highlights = round.cells.flatMap((prize, index) => prize === round.winner ? [index] : []);
    showNextHighlight();
  }

  function showNextHighlight() {
    if (round.highlights.length) {
      revealTimer = setTimeout(() => {
        card.highlight(round.highlights.shift());
        audio.play('match');
        showNextHighlight();
      }, 200);
    } else {
      revealTimer = setTimeout(showResult, 500);
    }
  }

  function showResult() {
    const prize = round.winner;
    if (prize) {
      cash += prize.amount;
      saveWallet();
    }
    round.phase = 'done';
    audio.play(prize ? 'win_0' : 'lose_0');
    if (!prize) {
      unlucky.hidden = false;
      cardButton.inert = true;
      lossTimer = setTimeout(() => {
        if (!active) return;
        deal();
      }, 1200);
      return;
    }
    const now = Date.now();
    showPanel('result', 'WINNER', dollars(prize.amount), walletWait(now));
    tick(now);
  }

  function move(event) {
    if (press?.id !== event.pointerId) return;
    const point = card.point(event);
    if (Math.hypot(point.x - press.last.x, point.y - press.last.y) < .5 * card.moveTexel) return;
    scratch(press.last, point);
    press.last = point;
    if (Math.hypot(point.x - press.start.x, point.y - press.start.y) > 2 * card.moveTexel) clearTimeout(holdTimer);
  }

  cardButton.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || !beginScratch()) return;
    event.preventDefault();
    const point = card.point(event);
    press = {id: event.pointerId, start: point, last: point};
    cardButton.setPointerCapture(event.pointerId);
    scratch(point, point);
    holdTimer = setTimeout(reveal, 1000);
  });
  cardButton.addEventListener('pointermove', move);
  cardButton.addEventListener('pointerup', event => {
    if (press?.id !== event.pointerId) return;
    move(event);
    endPress();
    if (card.isBare()) reveal();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    cardButton.addEventListener(type, event => { if (press?.id === event.pointerId) endPress(); });
  }

  return {view, tick, open() {
    if (!active && round?.phase === 'revealing') showNextHighlight();
    active = true;
    if (!card && !panelMode) load();
    tick(Date.now());
  }, close() {
    active = false;
    clearTimeout(revealTimer);
    clearTimeout(lossTimer);
    endPress();
    audio.stopAll();
  }};
}
