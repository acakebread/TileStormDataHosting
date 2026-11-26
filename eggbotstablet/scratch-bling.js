// Copyright 2026 massivehadron.com ltd.
// Based on Scratch Bling, copyright 2016 massivehadron.com ltd. created 29/09/2016 by Andrew Cakebread

import {button, element, loadSetting, number, saveSetting} from './ui.js';
import {money} from './scratch-pro-rules.js?v=level-bonus';
import {createAudio, createTicket, loadScratchCatalogue, loadTicketArt, pin, sliced, sprite, wait} from './scratch-pro-art.js?v=bling-cabinet';
import {buyStripeCoins, syncStripeCoins} from './stripe-coins.js?v=stripe-pro';

const width = 2048, height = 1536;
const packs = [
  ['5,000', 'scratch_bling_5000'],
  ['30,000', 'scratch_bling_30000'],
  ['75,000', 'scratch_bling_75000'],
  ['200,000', 'scratch_bling_200000'],
  ['500,000', 'scratch_bling_500000'],
  ['1,000,000', 'scratch_bling_1000000']
];
const previewFrames = [[2, 2, 508, 295], [514, 2, 508, 295], [2, 302, 508, 295], [514, 302, 508, 295]];
const chromeSize = [1024, 512];
const dotOn = [716, 164, 66, 66], dotOff = [786, 164, 66, 66];
const localAudio = new Map([
  ['scratch.mp3', new URL('./art/scratch/scratch.mp3', import.meta.url).href],
  ['match.mp3', new URL('./art/scratch/match.mp3', import.meta.url).href],
  ['win.mp3', new URL('./art/scratch/win_0.mp3', import.meta.url).href],
  ['lose.mp3', new URL('./art/scratch/lose_0.mp3', import.meta.url).href]
]);

function createWallet() {
  const saved = loadSetting('scratchBlingWallet', {});
  const state = {
    cash: Number.isInteger(saved.cash) && saved.cash >= 0 ? saved.cash : 2000,
    experience: Number.isFinite(saved.experience) && saved.experience >= 0 ? saved.experience : 0,
    collectAt: Number(saved.collectAt),
    refillAt: Number(saved.refillAt) || 0,
    pendingWin: Math.max(0, Number(saved.pendingWin) || 0),
    pendingCost: Math.max(0, Number(saved.pendingCost) || 0),
    muteMusic: !!saved.muteMusic,
    muteSound: !!saved.muteSound,
    page: Number.isInteger(saved.page) ? Math.min(4, Math.max(0, saved.page)) : 0
  };
  const now = Date.now();
  if (!Number.isFinite(state.collectAt) || state.collectAt > now + 4 * 60 * 60 * 1000) state.collectAt = now + 10000;
  let level = 1, progress = 0;
  const save = () => saveSetting('scratchBlingWallet', state);
  const credit = amount => { state.cash = Math.min(2147483647, state.cash + amount); };
  function refreshLevel() {
    let available = state.experience;
    for (level = 1; level < 99; level++) {
      const required = Math.ceil(2000 + 2000 * level * (1.04 + (level - 1) / 600) ** (level - 1));
      if (available < required) {
        progress = available / required;
        return;
      }
      available -= required;
    }
    progress = 1;
  }
  function addExperience(amount) {
    const previous = level;
    state.experience = Math.min(Number.MAX_VALUE, state.experience + amount);
    refreshLevel();
    for (let n = previous + 1; n <= level; n++) {
      credit(n >= 35 ? 10000 + (n - 35) * 5000 : n >= 19 ? 3000 + (n - 19) * 200 :
        n >= 7 ? 2000 + (n - 7) * 100 : 1000 + (n - 2) * 100);
    }
  }
  refreshLevel();
  if (state.pendingWin > 0) {
    credit(state.pendingWin);
    addExperience(Math.max(0, state.pendingWin - state.pendingCost));
    state.pendingWin = state.pendingCost = 0;
  }
  save();
  return {
    state, save,
    get level() { return level; },
    get progress() { return progress; },
    spend(amount) {
      if (state.cash < amount) return false;
      state.cash -= amount;
      addExperience(amount);
      save();
      return true;
    },
    recordWin(winnings, cost) {
      state.pendingWin = winnings;
      state.pendingCost = cost;
      save();
    },
    applyGamble(multiplier) {
      state.pendingWin = Math.min(2147483647, state.pendingWin * multiplier);
      if (!state.pendingWin) state.pendingCost = 0;
      save();
    },
    collectWinnings() {
      if (state.pendingWin <= 0) return;
      credit(state.pendingWin);
      addExperience(Math.max(0, state.pendingWin - state.pendingCost));
      state.pendingWin = state.pendingCost = 0;
      save();
    },
    collect() {
      if (Date.now() < state.collectAt) return false;
      state.collectAt = Date.now() + 4 * 60 * 60 * 1000;
      credit(1000);
      save();
      return true;
    },
    untilCollect() { return Math.max(0, state.collectAt - Date.now()); },
    applyPurchase(delta) {
      state.cash = Math.max(0, Math.min(2147483647, state.cash + delta));
      save();
    },
    untilRefill(cost) {
      if (state.cash >= cost) {
        if (state.refillAt) { state.refillAt = 0; save(); }
        return 0;
      }
      const now = Date.now();
      if (!state.refillAt || state.refillAt - now > 10 * 60 * 1000) {
        state.refillAt = now + 10 * 60 * 1000;
        save();
      }
      const remaining = state.refillAt - now;
      if (remaining > 0) return remaining;
      state.cash = Math.max(state.cash, 1000);
      state.refillAt = 0;
      save();
      return 0;
    }
  };
}

function formatWait(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function levelFrame(value) {
  const number = Math.max(1, Math.min(99, value));
  return [number % 10 * 80, 96 + Math.floor(number / 10) * 60, 80, 60];
}

function rollMultiplier() {
  if (Math.random() >= 1 / 2.1) return 0;
  const weights = [1 / 3, 1 / 3, 1 / 12, 1 / 20, 1 / 24];
  let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < weights.length - 1; i++) {
    roll -= weights[i];
    if (roll < 0) return i + 1;
  }
  return weights.length;
}

export function createScratchBling(view, quit) {
  view.setAttribute('aria-label', 'Scratch Bling');
  const stage = element('div', 'sb-stage');
  const fit = new ResizeObserver(() => stage.style.setProperty('--sb-scale', Math.min(view.clientWidth / width, view.clientHeight / height)));
  let lifetime, catalogue, audio, wallet, timer, overlay, ticket, ticketArt, ticketRequest, selected, foilName, lossTimer;
  let gallery, cardLayer, results, status, cashText, timerText, timerValue, collectButton, progressBar, levelImage;
  let previous, next, dots, slots, pageRequest = 0;
  let shownCash = -1, shownLevel = -1, shownSeconds = -1;
  const slotReels = [];

  function art(parent, file, frame, x, y, w, h, sheet = chromeSize) {
    return sprite(pin(parent, element('div', 'sb-decor'), x, y, w, h), catalogue.url(file), frame, sheet[0], sheet[1]);
  }

  function artButton(parent, name, action, file, frame, x, y, w, h, sheet = chromeSize) {
    const control = sprite(pin(parent, button('', action), x, y, w, h), catalogue.url(file), frame, sheet[0], sheet[1]);
    control.setAttribute('aria-label', name);
    control.classList.add('sb-art');
    return control;
  }

  function label(parent, text, x, y, w, h, className = '') {
    return pin(parent, element('p', 'sb-label ' + className, text), x, y, w, h);
  }

  function open() {
    if (lifetime) return;
    lifetime = new AbortController();
    fit.observe(view);
    view.replaceChildren(stage);
    start();
  }

  async function start() {
    const {signal} = lifetime;
    stage.replaceChildren(label(stage, 'Loading Scratch Bling…', 350, 680, 1348, 120, 'sb-status'));
    try {
      const hosted = await loadScratchCatalogue('scratch-bling.json', 'Scratch Bling', signal);
      if (signal.aborted) return;
      catalogue = {...hosted, url: name => hosted.url(name) || localAudio.get(name)};
      const faces = document.fonts ? Promise.all([
        document.fonts.load('16px "Brush Script Std"'),
        document.fonts.load('16px "Abadi Condensed Light"'),
        document.fonts.load('16px "Abadi Condensed Extra Bold"')
      ]).catch(() => {}) : Promise.resolve();
      await Promise.all([...['chrome.png', 'casino.jpg'].map(name => catalogue.image(name, signal)), faces]);
      if (signal.aborted) return;
      wallet = createWallet();
      audio = createAudio(catalogue, name => name === 'music' ? !wallet.state.muteMusic : !wallet.state.muteSound);
      const unlock = () => { audio.unlock(); refreshMusic(); };
      stage.addEventListener('pointerdown', unlock, {capture: true, signal});
      stage.addEventListener('keydown', unlock, {capture: true, signal});
      build();
      timer = setInterval(refreshHeader, 250);
      refreshHeader();
      showPage(wallet.state.page);
      const coins = await syncStripeCoins(signal);
      if (signal.aborted || !coins) return;
      wallet.applyPurchase(coins);
      refreshHeader();
      showMessage('SCRATCH BLING', coins > 0 ? number.format(coins) + ' coins added.'
        : 'The Stripe payment was refunded and ' + number.format(-coins) + ' coins were removed.');
    } catch {
      if (signal.aborted) return;
      stage.replaceChildren();
      label(stage, 'Could not load Scratch Bling.', 350, 640, 1348, 100, 'sb-status');
      pin(stage, button('TRY AGAIN', start, 'sb-status'), 724, 780, 600, 100);
    }
  }

  function build() {
    stage.replaceChildren();
    const wallpaper = pin(stage, element('div', 'sb-wallpaper'), 0, 0, width, height);
    wallpaper.style.backgroundImage = 'url("' + catalogue.url('casino.jpg') + '")';
    gallery = pin(stage, element('div'), 0, 0, width, height);
    gallery.tabIndex = 0;
    gallery.setAttribute('aria-label', 'Card pages');
    cardLayer = pin(stage, element('div'), 0, 0, width, height);
    cardLayer.hidden = true;
    buildGallery();
    buildHeader();
    buildResults();
    status = label(stage, '', 350, 700, 1348, 125, 'sb-status');
    let drag;
    gallery.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, swipe: false};
    });
    gallery.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.abs(dx) >= gallery.getBoundingClientRect().width * .065 && Math.abs(dx) > Math.abs(dy) * 1.25) drag.swipe = true;
    });
    let suppressClick = false;
    gallery.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const forward = event.clientX < drag.x;
      const swiped = drag.swipe;
      drag = null;
      if (!swiped) return;
      suppressClick = true;
      showPage(wallet.state.page + (forward ? 1 : -1));
    });
    gallery.addEventListener('click', event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function buildGallery() {
    slots = [0, 1, 2, 3].map(i => {
      const [x, y, w, h] = [219 + 823 * (i % 2), 336 + 489 * Math.floor(i / 2), 786, 457];
      const face = pin(gallery, button('', () => choose(i)), x, y, w, h);
      face.disabled = true;
      const price = pin(face, element('span', 'sb-price'), 0, 0, 144, 76);
      const lock = pin(face, element('div', 'sb-lock'), 0, 0, w, h);
      sprite(pin(lock, element('div'), 118, 162, 423, 88), catalogue.url('level-labels.png'), [0, 0, 460, 96], 1024, 768);
      art(lock, 'chrome.png', [504, 0, 128, 128], 542, 125, 149, 149);
      const required = pin(lock, element('div'), 566, 166, 108, 81);
      art(lock, 'chrome.png', [0, 296, 106, 152], 329, 269, 109, 156);
      lock.hidden = true;
      return {face, price, lock, required};
    });
    previous = artButton(gallery, 'Previous page', () => showPage(wallet.state.page - 1), 'chrome.png', [452, 164, 128, 128], 0, 535, 204, 535);
    next = artButton(gallery, 'Next page', () => showPage(wallet.state.page + 1), 'chrome.png', [584, 164, 128, 128], 1844, 535, 204, 535);
    previous.classList.add('sb-arrow');
    next.classList.add('sb-arrow');
    dots = [0, 1, 2, 3, 4].map(i => artButton(gallery, 'Page ' + (i + 1), () => showPage(i), 'chrome.png', dotOff, 705 + 128 * i, 1315, 128, 128));
  }

  function buildHeader() {
    const bar = pin(stage, element('div', 'sb-header'), 0, 0, width, height);
    art(bar, 'chrome.png', [0, 0, 64, 64], 0, 0, width, 96);
    pin(bar, element('div'), 0, 95, width, 2).style.background = '#737373';
    art(bar, 'chrome.png', [364, 390, 288, 119], 0, 0, 288, 119);
    const membershipHit = pin(bar, button('', membership), 0, 0, 288, 96);
    membershipHit.setAttribute('aria-label', 'Basic membership');
    const meter = pin(bar, element('div', 'sb-meter'), 371, 32, 230, 36);
    progressBar = pin(meter, element('div', 'sb-progress'), 0, 0, 0, 36);
    art(bar, 'chrome.png', [504, 0, 128, 128], 292, 0, 104, 111);
    levelImage = pin(bar, element('div'), 299, 24, 96, 72);
    cashText = pin(bar, button('', () => showMessage('BALANCE', money(wallet.state.cash))), 1300, 0, 748, 96);
    cashText.setAttribute('aria-label', 'Balance');
    cashText.append(element('span', 'sb-label sb-cash'));
    Object.assign(cashText.lastElementChild.style, {position: 'absolute', inset: '4px 120px 4px 0'});
    art(bar, 'chrome.png', [372, 0, 128, 128], 1928, 0, 112, 102);
    const buy = pin(bar, button('BUY COINS', showShop), 822, 0, 404, 96);
    buy.classList.add('sb-buy');
    timerText = label(bar, 'MORE COINS IN', 695, 101, 658, 78, 'sb-timer');
    timerValue = element('b');
    timerText.append(timerValue);
    collectButton = artButton(bar, 'Collect coins', collectFree, 'chrome.png', [0, 164, 448, 80], 800, 95, 448, 80);
    label(collectButton, 'COLLECT COINS', 0, 0, 448, 80, 'sb-collect');
    const back = pin(bar, button('‹ BACK', leaveCard), 20, 100, 260, 86);
    back.classList.add('sb-nav');
    const options = pin(bar, button('OPTIONS ›', showOptions), 1768, 100, 260, 86);
    options.classList.add('sb-nav');
  }

  function buildResults() {
    results = pin(stage, element('div', 'sb-results'), 0, 0, width, height);
    results.hidden = true;
    label(results, 'UNLUCKY, TRY AGAIN!', 400, 1380, 1248, 135, 'sb-unlucky');
    const bar = pin(results, element('div', 'sb-winbar'), 64, 1264, 1920, 195);
    const gambleButton = pin(bar, button('GAMBLE', gamble), 8, 16, 477, 164);
    gambleButton.dataset.role = 'gamble';
    const collect = pin(bar, button('COLLECT', () => redeal()), 1435, 16, 477, 164);
    collect.dataset.role = 'collect';
    const banner = pin(results, element('div', 'sb-plaque'), 559, 1209, 930, 300);
    banner.style.backgroundSize = '100% 100%';
    const amount = pin(banner, element('div', 'sb-plaque-amount'), 83, 62, 763, 152);
    const caption = pin(banner, element('div', 'sb-plaque-caption'), 133, 171, 664, 104);
    caption.hidden = true;
    results.win = {bar, banner, amount, caption};
  }

  async function showPage(index) {
    if (!catalogue || selected || index < 0 || index > 4) return;
    const request = ++pageRequest;
    wallet.state.page = index;
    wallet.save();
    previous.disabled = index === 0;
    next.disabled = index === 4;
    dots.forEach((dot, i) => sprite(dot, catalogue.url('chrome.png'), i === index ? dotOn : dotOff, 1024, 512));
    status.textContent = 'Loading cards…';
    try {
      const image = await catalogue.image('page-0' + (index + 1) + '.jpg', lifetime.signal);
      if (request !== pageRequest || lifetime.signal.aborted) return;
      slots.forEach((slot, i) => {
        const card = catalogue.cards[index * 4 + i];
        sprite(slot.face, image.src, previewFrames[i], 1024, 600);
        const tagWidth = 76 * (card.cost < 1000 ? 1.9 : card.cost < 10000 ? 2.5 : 2.85);
        slot.price.textContent = money(card.cost);
        slot.price.style.fontSize = '60px';
        Object.assign(slot.price.style, {left: 'auto', right: '0', width: tagWidth + 'px'});
        slot.face.setAttribute('aria-label', card.name + ', ' + money(card.cost));
        const locked = card.level > wallet.level;
        slot.lock.hidden = !locked;
        slot.face.disabled = locked;
        if (locked) sprite(slot.required, catalogue.url('level-labels.png'), levelFrame(card.level), 1024, 768);
      });
      status.textContent = '';
    } catch {
      if (request === pageRequest && !lifetime.signal.aborted) status.textContent = 'Couldn’t load this page.';
    }
  }

  function choose(slot) {
    const card = catalogue.cards[wallet.state.page * 4 + slot];
    if (!card || card.level > wallet.level || selected) return;
    audio.play('click');
    selected = card;
    gallery.hidden = true;
    cardLayer.hidden = false;
    foilName = 'contour' + String(1 + Math.floor(Math.random() * 10)).padStart(2, '0') + '.jpg';
    prepareTicket();
  }

  async function prepareTicket() {
    if (!selected || ticketRequest) return;
    const request = ticketRequest = new AbortController();
    status.textContent = 'Loading ' + selected.name + '…';
    try {
      ticketArt = await loadTicketArt(catalogue, selected, foilName, request.signal);
      if (request.signal.aborted) return;
      status.textContent = '';
      deal();
    } catch {
      if (!request.signal.aborted) status.textContent = 'Couldn’t load this card.';
    } finally {
      if (ticketRequest === request) ticketRequest = null;
    }
  }

  function deal() {
    ticket?.close();
    clearTimeout(lossTimer);
    results.hidden = true;
    stage.querySelector('.sb-slots')?.remove();
    slotReels.length = 0;
    ticket = createTicket({
      catalogue, card: selected, artwork: ticketArt, foilName, audio,
      hint: selected.id <= 4,
      blocked: () => !!overlay,
      pay(cost) {
        if (!wallet.spend(cost)) {
          showMessage('OUT OF CASH', 'This card costs ' + money(cost) + '.');
          return false;
        }
        refreshHeader();
        return true;
      },
      revealResult
    });
    pin(cardLayer, ticket.view, 32, 240, 1984, 1152);
    const tagWidth = 96 * (selected.cost < 1000 ? 1.9 : selected.cost < 10000 ? 2.5 : 2.85);
    const tag = pin(ticket.view, element('span', 'sb-price', money(selected.cost)), 1984 - tagWidth, 0, tagWidth, 96);
    tag.style.fontSize = '76px';
  }

  function revealResult(winnings) {
    if (lifetime.signal.aborted || !ticket) return;
    if (!winnings) {
      audio.play('lose');
      results.hidden = false;
      results.win.bar.hidden = results.win.banner.hidden = true;
      results.firstElementChild.hidden = false;
      lossTimer = setTimeout(() => { if (!lifetime.signal.aborted && selected) redeal(); }, 1200);
      return;
    }
    audio.play('win');
    wallet.recordWin(winnings, selected.cost);
    showWin(winnings, 6);
  }

  function showAmount(payout) {
    const text = money(payout);
    const node = results.win.amount;
    const boxWidth = 763, boxHeight = 152;
    const probe = showAmount.context ??= document.createElement('canvas').getContext('2d');
    let size = boxHeight * .92;
    probe.font = size + 'px "Brush Script Std"';
    const spacing = -0.04 * size;
    const measured = probe.measureText(text).width + Math.max(0, text.length - 1) * spacing;
    if (measured > boxWidth) size *= boxWidth / measured;
    node.textContent = text;
    node.style.fontSize = size + 'px';
    node.style.letterSpacing = (-0.04 * size) + 'px';
    node.style.webkitTextStroke = Math.max(3, size * 0.022) + 'px #fff';
  }

  function showWin(payout, outcome) {
    const ticketWin = outcome === 6;
    results.hidden = false;
    results.firstElementChild.hidden = true;
    results.win.bar.hidden = results.win.banner.hidden = false;
    results.win.banner.style.backgroundImage = 'url("' + (catalogue.url(ticketWin ? 'winner.png' : 'gamble-plaque.png') || '') + '")';
    showAmount(payout);
    const caption = results.win.caption;
    caption.hidden = ticketWin;
    if (!ticketWin) sprite(caption, catalogue.url('result-type.png'), [outcome % 2 * 512, Math.floor(outcome / 2) * 80, 512, 80], 1024, 512);
    const gambleButton = results.win.bar.querySelector('[data-role="gamble"]');
    const collect = results.win.bar.querySelector('[data-role="collect"]');
    gambleButton.hidden = outcome === 0;
    gambleButton.disabled = collect.disabled = false;
    gambleButton.textContent = outcome === 6 ? 'GAMBLE' : 'SPIN AGAIN';
    collect.textContent = outcome === 0 ? 'NEXT CARD' : 'COLLECT';
  }

  async function gamble() {
    if (!wallet.state.pendingWin || overlay) return;
    audio.play('click');
    const gambleButton = results.win.bar.querySelector('[data-role="gamble"]');
    const collect = results.win.bar.querySelector('[data-role="collect"]');
    gambleButton.disabled = collect.disabled = true;
    const multiplier = rollMultiplier();
    await spinSlots(multiplier);
    if (lifetime.signal.aborted) return;
    wallet.applyGamble(multiplier);
    showWin(wallet.state.pendingWin, multiplier);
    audio.play(multiplier ? 'win' : 'lose');
  }

  async function spinSlots(multiplier) {
    let machine = stage.querySelector('.sb-slots');
    if (!machine) {
      const cabinetWidth = 835;
      const reelWidthScale = cabinetWidth / 620;
      machine = pin(results, element('div', 'sb-slots'), (width - cabinetWidth) / 2, 543, cabinetWidth, 609);
      const backing = pin(machine, element('div', 'sb-decor'), 0, 0, cabinetWidth, 609);
      sliced(backing, catalogue.url('gamble-reels.png'), [800, 0, 128, 128], 1024, 512, 48, 15.36);
      backing.style.opacity = '.872';
      label(machine, 'MATCH 3 SYMBOLS', 5, 6, cabinetWidth - 10, 48);
      for (let reel = 0; reel < 3; reel++) {
        const column = pin(machine, element('div'), (9 + reel * 202.5) * reelWidthScale, 56, 203 * reelWidthScale, 533);
        const window = pin(column, element('div', 'sb-reel-window'), 4 * reelWidthScale, 7, 190 * reelWidthScale, 514);
        const cells = [-96, 159, 395].map(top => pin(window, element('div'), 11 * reelWidthScale, top, 169 * reelWidthScale, 178));
        const strip = pin(window, element('div', 'sb-strip'), 4 * reelWidthScale, 4, 187 * reelWidthScale, 511);
        strip.style.backgroundImage = 'url("' + catalogue.url('gamble-strip.jpg') + '")';
        strip.style.animationDelay = (-Math.random() * .333) + 's';
        art(column, 'gamble-reels.png', [656, 0, 136, 392], 0, 0, 203 * reelWidthScale, 533);
        slotReels.push({cells, strip});
      }
    }
    machine.hidden = false;
    const first = 1 + Math.floor(Math.random() * 5);
    const second = (first - 1 + 1 + Math.floor(Math.random() * 4)) % 5 + 1;
    const payline = [first, second, 1 + Math.floor(Math.random() * 5)];
    slotReels.forEach((reel, index) => {
      const symbols = [1 + Math.floor(Math.random() * 5), multiplier || payline[index], 1 + Math.floor(Math.random() * 5)];
      reel.cells.forEach((cell, row) => sprite(cell, catalogue.url('gamble-reels.png'), [(symbols[row] - 1) * 130, 0, 128, 86], 1024, 512));
      reel.strip.hidden = false;
    });
    audio.play('reel-spin', true);
    for (let reel = 0; reel < 3; reel++) {
      if (!await wait(500 + Math.random() * 700, lifetime.signal)) return;
      slotReels[reel].strip.hidden = true;
      audio.play('reel-stop');
    }
    audio.stop('reel-spin');
  }

  async function redeal() {
    clearTimeout(lossTimer);
    results.hidden = true;
    stage.querySelector('.sb-slots')?.remove();
    slotReels.length = 0;
    wallet.collectWinnings();
    refreshHeader();
    if (!selected) return;
    foilName = 'contour' + String(1 + Math.floor(Math.random() * 10)).padStart(2, '0') + '.jpg';
    try {
      ticketArt.set(foilName, await catalogue.image(foilName, lifetime.signal));
      if (!lifetime.signal.aborted) deal();
    } catch {
      if (!lifetime.signal.aborted) status.textContent = 'Couldn’t load the next card.';
    }
  }

  function leaveCard() {
    audio.play('click');
    if (!selected) { quit(); return; }
    ticketRequest?.abort();
    ticketRequest = null;
    clearTimeout(lossTimer);
    closeOverlay();
    wallet.collectWinnings();
    ticket?.close();
    ticket = ticketArt = selected = null;
    results.hidden = true;
    stage.querySelector('.sb-slots')?.remove();
    slotReels.length = 0;
    cardLayer.hidden = true;
    gallery.hidden = false;
    refreshHeader();
    showPage(wallet.state.page);
  }

  function collectFree() {
    if (!wallet.collect()) return;
    audio.play('click');
    refreshHeader();
  }

  function refreshHeader() {
    if (!wallet) return;
    const refill = wallet.untilRefill(100);
    let wait = wallet.untilCollect();
    if (refill > 0 && refill < wait) wait = refill;
    const seconds = Math.ceil(wait / 1000);
    if (seconds !== shownSeconds) {
      shownSeconds = seconds;
      timerValue.textContent = formatWait(wait);
      timerText.hidden = seconds === 0;
      collectButton.hidden = seconds !== 0;
    }
    if (wallet.state.cash !== shownCash) {
      shownCash = wallet.state.cash;
      cashText.lastElementChild.textContent = money(shownCash);
    }
    progressBar.style.width = wallet.progress * 230 + 'px';
    if (wallet.level !== shownLevel) {
      shownLevel = wallet.level;
      sprite(levelImage, catalogue.url('level-labels.png'), levelFrame(shownLevel), 1024, 768);
      if (gallery && !gallery.hidden) showPage(wallet.state.page);
    }
  }

  function refreshMusic() {
    if (wallet.state.muteMusic) audio.stop('music');
    else audio.play('music', true);
  }

  function membership() {
    showMessage('BASIC MEMBERSHIP', 'Collect 1,000 coins every four hours.');
  }

  let buying = false;

  function buyPack(product) {
    if (buying) {
      showMessage('BUY COINS', 'Finish or cancel checkout in your browser.');
      return;
    }
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      showMessage('BUY COINS', 'Allow pop-ups for this site, then choose the coin pack again.');
      return;
    }
    buying = true;
    closeOverlay();
    const signal = lifetime.signal;
    buyStripeCoins(product, tab, signal).then(result => {
      if (signal.aborted || !wallet) return;
      if (result.delta) {
        wallet.applyPurchase(result.delta);
        refreshHeader();
      }
      if (result.message) showMessage('BUY COINS', result.message);
      else if (result.delta > 0) showMessage('SCRATCH BLING', number.format(result.delta) + ' coins added.');
      else if (result.delta < 0) showMessage('SCRATCH BLING', 'The Stripe payment was refunded and ' + number.format(-result.delta) + ' coins were removed.');
    }).catch(() => {
      if (!signal.aborted) showMessage('BUY COINS', 'Stripe checkout could not be opened. Try again shortly.');
    }).finally(() => { buying = false; });
  }

  function showShop() {
    audio.play('click');
    closeOverlay();
    const backdrop = pin(stage, element('div', 'sb-shop-shade'), 0, 0, width, height);
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-label', 'Buy coins');
    const panel = pin(backdrop, element('div'), 210, 224, 1600, 1124);
    panel.style.background = 'url("' + catalogue.url('shop-coins.png') + '") center / 100% 100% no-repeat';
    packs.forEach(([pack, product], i) => {
      const choice = pin(panel, button(pack + ' COINS', () => buyPack(product)), 28 + i % 3 * 524, 32 + Math.floor(i / 3) * 548, 496, 512);
      choice.style.color = 'transparent';
    });
    artButton(panel, 'Close', closeOverlay, 'chrome.png', [566, 296, 64, 64], 1553, -51, 100, 100);
    holdOverlay(backdrop);
  }

  function showOptions() {
    audio.play('click');
    closeOverlay();
    const backdrop = pin(stage, element('div', 'sb-shade'), 0, 0, width, height);
    const panel = pin(backdrop, element('div'), 292, 439, 1508, 742);
    panel.style.background = catalogue.url('options.png') ? 'url("' + catalogue.url('options.png') + '") center / 100% 100% no-repeat' : '#111';
    artButton(panel, 'Close', closeOverlay, 'chrome.png', [566, 296, 64, 64], 1433, -34, 110, 110);
    option(panel, 'Music', 62, 72, () => { wallet.state.muteMusic = !wallet.state.muteMusic; wallet.save(); refreshMusic(); showOptions(); });
    option(panel, 'Sound', 62, 231, () => { wallet.state.muteSound = !wallet.state.muteSound; wallet.save(); showOptions(); });
    option(panel, 'Our games', 770, 72, () => showMessage('OUR GAMES', 'Currently unavailable'));
    option(panel, 'Visit us', 770, 231, () => showMessage('VISIT US', 'Currently unavailable'));
    option(panel, 'Enter code', 422, 514, () => showMessage('ENTER CODE', 'Currently unavailable'));
    panel.querySelectorAll('.sb-option')[0].textContent = wallet.state.muteMusic ? 'MUSIC: OFF' : 'MUSIC: ON';
    panel.querySelectorAll('.sb-option')[1].textContent = wallet.state.muteSound ? 'SOUND FX: OFF' : 'SOUND FX: ON';
    holdOverlay(backdrop);
  }

  function option(panel, name, x, y, action) {
    const control = artButton(panel, name, action, 'chrome.png', [110, 296, 450, 86], x, y, 664, 126);
    control.classList.add('sb-option');
    control.textContent = name;
  }

  function showMessage(title, detail) {
    audio.play('click');
    closeOverlay();
    const backdrop = pin(stage, element('div', 'sb-shade'), 0, 0, width, height);
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-label', title);
    const panel = pin(backdrop, element('div'), 292, 439, 1508, 742);
    panel.style.background = catalogue.url('options.png') ? 'url("' + catalogue.url('options.png') + '") center / 100% 100% no-repeat' : '#111';
    artButton(panel, 'Close', closeOverlay, 'chrome.png', [566, 296, 64, 64], 1433, -34, 110, 110);
    label(panel, title + '\n' + detail, 125, 236, 1258, 210, 'sb-message');
    holdOverlay(backdrop);
  }

  function holdOverlay(backdrop) {
    for (const child of stage.children) child.inert = child !== backdrop;
    overlay = backdrop;
  }

  function closeOverlay() {
    overlay?.remove();
    overlay = null;
    for (const child of stage.children) child.inert = false;
  }

  return {view, open, close() {
    if (!lifetime) return;
    lifetime.abort();
    lifetime = null;
    fit.disconnect();
    clearInterval(timer);
    clearTimeout(lossTimer);
    ticketRequest?.abort();
    closeOverlay();
    wallet?.collectWinnings();
    ticket?.close();
    audio?.close();
    stage.replaceChildren();
  }};
}
