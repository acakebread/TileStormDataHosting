// Copyright 2026 massivehadron.com ltd.
// Based on Scratch Pro, copyright 2016 massivehadron.com ltd. created 29/09/2016 by Andrew Cakebread

import {button, countdown, element, image, number} from './ui.js';
import {createWallet, money, random} from './scratch-pro-rules.js';
import {createAudio, createTicket, loadScratchProCatalogue, loadTicketArt, pin, sprite, wait} from './scratch-pro-art.js?v=2';
import {openBonus} from './scratch-pro-bonus.js';

const width = 1300, height = 975;
const prizeGlyphs = '$0123456789,';
const advances = [98, 102, 69, 108, 102, 104, 98, 102, 98, 108, 102, 51];
const sideActions = [
  ['VIP upgrade', [0, 0, 160, 160]], ['Free coins', [0, 160, 160, 160]],
  ['Get coins', [0, 320, 160, 160]], ['Earn coins', [0, 480, 160, 160]]
];

export function createScratchPro(view) {
  view.setAttribute('aria-label', 'Scratch Pro');
  const stage = element('div', 'sp-stage');
  view.append(stage);
  const wallet = createWallet();
  let lifetime, ticketRequest, catalogue, audio, timer, observer;
  let gallery, galleryTrack, cardsButton, cashText, levelText, progressRing, freeText, freeArt, status;
  let selected, ticketArt, foilName, ticket, overlay, galleryScroll = 0;
  let locks = [];
  const fit = new ResizeObserver(() => stage.style.setProperty('--sp-scale', Math.min(view.clientWidth / width, view.clientHeight / height)));

  function label(parent, text, x, y, w, h, klass = '') {
    return pin(parent, element('div', 'sp-label ' + klass, text), x, y, w, h);
  }

  function art(parent, asset, frame, x, y, w, h, aw, ah, klass = 'sp-decor') {
    return sprite(pin(parent, element('div', klass), x, y, w, h), catalogue.url(asset), frame, aw, ah);
  }

  function artButton(parent, name, action, asset, frame, x, y, w, h, aw, ah) {
    const url = catalogue.url(asset);
    const control = sprite(pin(parent, button(url ? '' : name, action, 'sp-art-button'), x, y, w, h), url, frame, aw, ah);
    control.setAttribute('aria-label', name);
    return control;
  }

  function open() {
    if (lifetime) return;
    lifetime = new AbortController();
    fit.observe(view);
    start();
  }

  async function start() {
    const {signal} = lifetime;
    stage.replaceChildren();
    label(stage, 'Loading Scratch Pro…', 274, 382, 1026, 96, 'sp-wait');
    try {
      const data = await loadScratchProCatalogue(signal);
      await Promise.all(['ui-main.png', 'grid.png'].map(name => data.image(name, signal)));
      if (signal.aborted) return;
      catalogue = data;
      audio = createAudio(catalogue, name => name === 'music'
        ? !wallet.state.muteMusic : !wallet.state.muteSound);
      const unlock = () => { audio.unlock(); audio.play('music', true); };
      stage.addEventListener('pointerdown', unlock, {capture: true, signal});
      stage.addEventListener('keydown', unlock, {capture: true, signal});
      build();
      timer = setInterval(refreshFree, 350);
    } catch {
      if (signal.aborted) return;
      stage.replaceChildren();
      label(stage, 'Could not load Scratch Pro.', 274, 380, 1026, 80, 'sp-wait');
      pin(stage, button('TRY AGAIN', start, 'sp-command'), 647, 472, 280, 65);
    }
  }

  function build() {
    stage.replaceChildren();
    const wallpaper = pin(stage, element('div', 'sp-wallpaper'), -170, -212.5, 1640, 1400);
    wallpaper.style.backgroundImage = 'url("' + catalogue.url('grid.png') + '")';
    pin(stage, element('div', 'sp-sidebar'), 0, 92, 274, 883);
    const actions = [membership, freeCoins, coinShop, earnCoins];
    sideActions.forEach(([name, frame], i) => artButton(stage, name, actions[i], 'ui-main.png', frame, 0, i * 244, 244, 244, 384, 640));
    freeArt = art(stage, 'ui-main.png', [168, 248, 208, 38], 14, 425, 214, 45, 384, 640);
    freeText = label(stage, '', 8, 425, 228, 46, 'sp-free-time');
    freeText.style.pointerEvents = 'none';
    pin(stage, element('div', 'sp-header'), 0, 0, width, 92);
    artButton(stage, 'Basic membership', membership, 'ui-main.png', [168, 0, 180, 75], 0, 0, 274, 114, 384, 640);
    artButton(stage, 'Options', options, 'ui-main.png', [168, 80, 64, 64], 318, 22, 48, 48, 384, 640);
    progressRing = pin(stage, element('div', 'sp-progress'), 404, 20, 49, 49);
    art(stage, 'ui-main.png', [236, 80, 64, 64], 404, 20, 49, 49, 384, 640);
    levelText = label(stage, '', 468, 7, 55, 76, 'sp-level');
    cashText = pin(stage, button('', coinShop, 'sp-balance'), 545, 7, 438, 76);
    cardsButton = artButton(stage, 'Cards', backToCards, 'ui-main.png', [168, 294, 208, 56], 1038, 12, 233, 68, 384, 640);
    gallery = pin(stage, element('div', 'sp-gallery'), 274, 92, 1026, 883);
    gallery.tabIndex = 0;
    gallery.setAttribute('aria-label', 'Card catalogue');
    galleryTrack = element('div', 'sp-card-strip');
    gallery.append(galleryTrack);
    status = pin(stage, element('div', 'sp-status'), 274, 380, 1026, 160);
    status.setAttribute('role', 'status');
    observer = new IntersectionObserver(entries => {
      for (const {target, isIntersecting} of entries) {
        const face = target.firstElementChild;
        if (isIntersecting) face.src = face.dataset.url;
        else { face.hidden = true; face.removeAttribute('src'); }
      }
    }, {root: gallery});
    locks = catalogue.cards.map(card => {
      const tile = button('', () => choose(card), 'sp-card-preview');
      tile.setAttribute('aria-label', card.name + ', ' + money(card.cost) + (card.level > 1 ? ', level ' + card.level : ''));
      const i = card.id - 1;
      sprite(tile, catalogue.url('cards.jpg'), [i % 4 * 252 + 2, Math.floor(i / 4) * 148 + 2, 248, 144], 1008, 740);
      const face = image('', '', 'sp-card-face');
      face.dataset.url = catalogue.url(card.art);
      face.hidden = true;
      face.addEventListener('load', () => { if (face.hasAttribute('src')) face.hidden = false; });
      tile.append(face, price(card.cost));
      const cover = element('div', 'sp-lock');
      art(cover, 'ui-main.png', [168, 150, 64, 92], 231, 190, 126, 118, 384, 640, 'sp-padlock');
      label(cover, 'LEVEL ' + card.level, 372, 118, 174, 72, 'sp-lock-level');
      tile.append(cover);
      galleryTrack.append(tile);
      observer.observe(tile);
      return {card, cover};
    });
    browseWithMouse();
    backToCards(false);
  }

  function browseWithMouse() {
    let drag, suppress = false;
    gallery.addEventListener('pointerdown', event => {
      suppress = false;
      if (event.pointerType === 'mouse' && event.button === 0)
        drag = {id: event.pointerId, at: event.clientX, scroll: gallery.scrollLeft};
    });
    gallery.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId || !(event.buttons & 1)) return;
      const delta = event.clientX - drag.at;
      if (!suppress && Math.abs(delta) < 7) return;
      suppress = true;
      gallery.setPointerCapture(event.pointerId);
      gallery.scrollLeft = drag.scroll - delta * gallery.offsetWidth / gallery.getBoundingClientRect().width;
    });
    const stop = () => { drag = null; };
    gallery.addEventListener('pointerup', stop);
    gallery.addEventListener('pointercancel', stop);
    gallery.addEventListener('click', event => {
      if (suppress && event.detail) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    gallery.addEventListener('wheel', event => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      gallery.scrollLeft += event.deltaY;
    }, {passive: false});
    gallery.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      gallery.scrollBy({left: event.key === 'ArrowLeft' ? -782 : 782, behavior: 'smooth'});
    });
  }

  function price(cost, playable = false) {
    const node = element('span', 'sp-price' + (playable ? ' sp-price-large' : ''), money(cost));
    node.style.width = (cost < 1000 ? .66 : cost < 10000 ? .87 : 1) * (playable ? 242 : 108) + 'px';
    return node;
  }

  function refresh() {
    cashText.textContent = money(wallet.state.balance);
    levelText.textContent = wallet.level;
    progressRing.style.setProperty('--sp-progress', wallet.progress * 360 + 'deg');
    locks.forEach(({card, cover}) => { cover.hidden = card.level <= wallet.level; });
    refreshFree();
  }

  function refreshFree() {
    const remaining = wallet.freeWait;
    freeText.hidden = !remaining;
    freeArt.hidden = !!remaining;
    freeText.textContent = 'IN  ' + countdown(remaining).padStart(5, '0');
  }

  function clearOverlay() {
    const close = overlay;
    overlay = null;
    close?.();
  }

  function showOverlay(view, close = () => view.remove()) {
    for (const child of stage.children) child.inert = child !== view;
    overlay = () => {
      close();
      for (const child of stage.children) child.inert = false;
    };
    view.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
  }

  function backToCards(play = true) {
    if (play) audio.play('click');
    clearOverlay();
    if (!gallery.hidden) galleryScroll = gallery.scrollLeft;
    ticketRequest?.abort();
    ticketRequest = null;
    ticket?.close();
    selected = ticket = ticketArt = null;
    wallet.settle();
    cardsButton.disabled = true;
    status.replaceChildren();
    stage.querySelector('.sp-loss')?.remove();
    gallery.hidden = false;
    gallery.scrollLeft = galleryScroll;
    refresh();
  }

  function choose(card) {
    audio.play('click');
    if (card.level > wallet.level) {
      popup(card.name, 'This ticket unlocks at level ' + card.level + '.');
      return;
    }
    galleryScroll = gallery.scrollLeft;
    selected = card;
    gallery.hidden = true;
    cardsButton.disabled = false;
    foilName = 'contour' + String(random(1, 11)).padStart(2, '0') + '.jpg';
    prepareTicket();
  }

  async function prepareTicket() {
    if (!selected || ticketRequest) return;
    const controller = ticketRequest = new AbortController();
    status.replaceChildren(element('p', '', 'Loading ' + selected.name + '…'));
    try {
      const textures = await loadTicketArt(catalogue, selected, foilName, controller.signal);
      if (controller.signal.aborted) return;
      ticketArt = textures;
      status.replaceChildren();
      deal();
    } catch {
      if (!controller.signal.aborted) {
        controller.abort();
        status.replaceChildren(element('p', '', 'Could not load this ticket.'), button('TRY AGAIN', prepareTicket, 'sp-command'));
      }
    } finally {
      if (ticketRequest === controller) ticketRequest = null;
    }
  }

  function needCoins() {
    popup('NOT ENOUGH COINS', 'Collect free coins when the timer is ready or choose a lower-cost ticket.',
      [['CARDS', backToCards], ['GET COINS', coinShop]]);
  }

  function deal() {
    if (!selected || !ticketArt) return;
    ticket?.close();
    ticket = null;
    if (wallet.state.balance < selected.cost) { needCoins(); return; }
    ticket = createTicket({catalogue, card: selected, artwork: ticketArt, foilName, audio, blocked: () => !!overlay,
      pay(cost, win) {
        if (!wallet.pay(cost, win)) { needCoins(); return false; }
        refresh();
        return true;
      }, revealResult});
    pin(stage, ticket.view, 283, 170.5, 1009, 586);
    ticket.view.append(price(selected.cost, true));
    audio.play('place');
  }

  async function revealResult(winnings) {
    const completed = ticket;
    const signal = lifetime.signal;
    while (overlay && !signal.aborted && ticket === completed) await wait(100, signal);
    if (signal.aborted || ticket !== completed) return;
    if (winnings) {
      audio.play('win');
      winner(winnings);
    } else resolveWinnings();
  }

  function resolveWinnings() {
    const won = wallet.state.pendingWin > 0;
    clearOverlay();
    const unlocked = wallet.settle();
    refresh();
    if (won) deal();
    else showLoss();
    if (unlocked && !overlay) popup('LEVEL ' + wallet.level + '!', 'Your level bonus has been added to your balance.');
  }

  async function showLoss() {
    const completed = ticket;
    const signal = lifetime.signal;
    const path = catalogue.url('result-unlucky.png');
    const banner = pin(stage, element('div', 'sp-loss', path ? image(path, 'Unlucky, try again!') : 'UNLUCKY, TRY AGAIN!'),
      347, 856, 880, 105);
    banner.setAttribute('role', 'status');
    audio.play('lose');
    if (!await wait(1250, signal)) return;
    while (overlay && ticket === completed) {
      if (!await wait(100, signal)) return;
    }
    banner.remove();
    if (ticket === completed) deal();
  }

  function winner(value) {
    const artwork = 'result-winner.png';
    const url = catalogue.url(artwork);
    const backdrop = pin(stage, element('div', 'sp-shade'), 0, 0, width, height);
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-label', 'Winner, ' + money(value));
    const marque = pin(backdrop, element('div', 'sp-winner-panel'), 207, 160, 886, 655);
    let bulbs;
    if (url) {
      const lights = art(marque, artwork, [0, 0, 568, 420], 0, 0, 886, 655, 1344, 848);
      art(marque, artwork, [576, 0, 650, 150], 132, 132, 622, 148, 1344, 848);
      const indices = Array.from(money(value), c => prizeGlyphs.indexOf(c));
      const total = indices.reduce((sum, i) => sum + advances[i], 0);
      const size = Math.min(.98, 654 / total);
      let x = 443 - (total / 2 + 7) * size;
      for (const i of indices) {
        art(marque, artwork, [576 + i % 6 * 124, 432 + Math.floor(i / 6) * 184, 124, 184],
          x, 370 - 92 * size, 124 * size, 184 * size, 1344, 848);
        x += advances[i] * size;
      }
      const shown = performance.now();
      bulbs = setInterval(() => {
        sprite(lights, url, [0, (performance.now() - shown) % (20000 / 12) >= 11000 / 12 ? 424 : 0, 568, 420], 1344, 848);
      }, 1000 / 12);
    } else {
      marque.classList.add('sp-winner-fallback');
      label(marque, 'WINNER', 132, 132, 622, 148, 'sp-winner-text');
      label(marque, money(value), 132, 282, 622, 176, 'sp-winner-amount');
    }
    const gamble = artButton(marque, 'GAMBLE', () => {
      audio.play('click');
      clearOverlay();
      const bonus = openBonus(stage, catalogue, wallet, audio, resolveWinnings);
      showOverlay(bonus.view, bonus.close);
    }, artwork, [576, 156, 360, 160], 267, 459, 357, 160, 1344, 848);
    const collect = artButton(backdrop, 'COLLECT', () => {
      audio.play('click');
      resolveWinnings();
    }, artwork, [576, 324, 336, 98], 940, 13, 336, 98, 1344, 848);
    gamble.classList.add('sp-win-gamble');
    collect.classList.add('sp-win-collect');
    showOverlay(backdrop, () => { clearInterval(bulbs); backdrop.remove(); });
  }

  function popup(title, message, choices = []) {
    clearOverlay();
    audio.play('click');
    const backdrop = pin(stage, element('div', 'sp-shade'), 0, 0, width, height);
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-label', title);
    const panel = pin(backdrop, element('div', 'sp-popup'), 260, 249.5, 780, 476);
    label(panel, title, 25, 20, 730, 66, 'sp-popup-title');
    const body = label(panel, message, 34, 90, 712, 78, 'sp-popup-body');
    choices.forEach(([name, action], i) => pin(panel, button(name, action, 'sp-option'),
      25 + i % 2 * 368, 171 + Math.floor(i / 2) * 55, 357, 48));
    pin(panel, button('CLOSE', clearOverlay, 'sp-command'), 245, 406, 290, 51);
    showOverlay(backdrop);
    return {panel, body};
  }

  function unavailable(feature) { popup(feature, 'Currently unavailable'); }
  function stub(title, labels) { popup(title, 'Currently unavailable', labels.map(name => [name.toUpperCase(), () => unavailable(name)])); }
  function membership() { stub('VIP UPGRADE', ['Bronze', 'Silver', 'Gold', 'Platinum', 'Restore purchases']); }
  function coinShop() { stub('GET COINS', ['6,000 coins', '25,000 coins', '80,000 coins', '250,000 coins', '450,000 coins', '1,000,000 coins', 'Restore purchases']); }
  function earnCoins() {
    popup('EARN COINS', 'Choose how to earn coins.', [
      ['WATCH A VIDEO', () => unavailable('Watch a video')], ['FOLLOW US', () => unavailable('Follow us')],
      ['VISIT SPONSOR', () => unavailable('Visit sponsor')], ['TAPPING FOR CASH', tapCash]
    ]);
  }

  function options() {
    popup('OPTIONS', 'Scratch Pro settings', [
      [wallet.state.muteMusic ? 'MUSIC OFF' : 'MUSIC ON', () => {
        wallet.state.muteMusic = !wallet.state.muteMusic;
        wallet.save();
        if (wallet.state.muteMusic) audio.stop('music'); else audio.play('music', true);
        options();
      }],
      [wallet.state.muteSound ? 'SOUND OFF' : 'SOUND ON', () => { wallet.state.muteSound = !wallet.state.muteSound; wallet.save(); options(); }],
      ['MORE GAMES', () => unavailable('More games')], ['VISIT WEBSITE', () => unavailable('Website')],
      ['ENTER CODE', () => unavailable('Redeem a code')]
    ]);
  }

  function freeCoins() {
    if (!wallet.collectFree()) { popup('FREE COINS', 'More coins in ' + countdown(wallet.freeWait) + '.'); return; }
    audio.play('coins');
    refresh();
    const action = selected && ticketArt && !ticket ? ['PLAY TICKET', () => { clearOverlay(); deal(); }] : ['OK', clearOverlay];
    popup('FREE COINS', '$1,000 added to your Scratch Pro balance.', [action]);
  }

  function tapCash() {
    const {panel, body} = popup('TAPPING FOR CASH', '');
    const pad = pin(panel, button('', tap, 'sp-tap'), 169, 183, 442, 203);
    const fill = element('span', 'sp-tap-fill');
    const peakMark = element('span', 'sp-tap-peak');
    const text = element('span', 'sp-tap-text');
    pad.append(fill, peakMark, text);
    let power = 0, peak = 0, until = 0, earned = 0, tappedAt = -Infinity, updated = performance.now(), frame;
    const previous = overlay;
    overlay = () => { cancelAnimationFrame(frame); previous(); };

    function decay(now) {
      const seconds = (now - updated) / 1000;
      const offset = .125 + .0007 * wallet.tapLevel / .002;
      power = Math.max(0, (power + offset) * .998 ** (seconds * 250) - offset);
      peak = Math.max(power, peak - Math.max(0, now - Math.max(updated, until)) / 1000);
      updated = now;
    }
    function tap() {
      const now = performance.now();
      if (wallet.tapWait || now - tappedAt < 50) return;
      tappedAt = now;
      decay(now);
      power = Math.min(1, Math.max(power, .15) + .1);
      if (power > peak) { peak = power; until = now + 1200; }
      if (power === 1) {
        earned = wallet.collectTap();
        if (earned) { audio.play('tap-cash-win'); refresh(); }
        power = peak = 0;
      } else audio.play('click');
    }
    function update(now) {
      decay(now);
      const remaining = wallet.tapWait;
      pad.disabled = !!remaining;
      if (!remaining) earned = 0;
      fill.style.height = power * 100 + '%';
      peakMark.style.bottom = Math.max(0, peak - .02) * 100 + '%';
      peakMark.hidden = !peak;
      const prompt = remaining ? 'PLAY AGAIN IN ' + countdown(remaining) :
        power > .75 ? 'YOU CAN DO IT!' : power > .5 ? 'KEEP TAPPING!' : power > .25 ? 'TAP FASTER!' : 'TAP';
      const message = earned ? 'Taptastic! ' + number.format(earned) + ' coins added to your balance.' :
        'Tap quickly to fill the meter and earn ' + number.format(wallet.tapLevel * 100) + ' coins.';
      if (text.textContent !== prompt) text.textContent = prompt;
      if (body.textContent !== message) body.textContent = message;
      frame = requestAnimationFrame(update);
    }
    update(updated);
  }

  return {view, open, close() {
    if (!lifetime) return;
    lifetime.abort();
    lifetime = null;
    fit.disconnect();
    clearInterval(timer);
    ticketRequest?.abort();
    ticketRequest = null;
    observer?.disconnect();
    if (gallery && !gallery.hidden) galleryScroll = gallery.scrollLeft;
    clearOverlay();
    ticket?.close();
    audio?.close();
    wallet.settle();
    selected = ticket = ticketArt = catalogue = audio = null;
    gallery = observer = null;
    galleryTrack = cardsButton = cashText = levelText = progressRing = freeText = freeArt = status = null;
    locks = [];
    stage.replaceChildren();
  }};
}
