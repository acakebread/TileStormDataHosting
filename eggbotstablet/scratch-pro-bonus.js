// Copyright 2026 massivehadron.com ltd.
// Based on Scratch Pro, copyright 2016 massivehadron.com ltd. created 29/09/2016 by Andrew Cakebread

import {button, element} from './ui.js';
import {money, bonusMultiplier, random} from './scratch-pro-rules.js';
import {pin, sprite, wait} from './scratch-pro-art.js?v=2';

const games = ['Slots', 'Flip Coin', 'Link Dink', 'High or Low'];
const linkPrizes = [0, 2, 0, 3, 5, 4, 2, 1, 2];

export function openBonus(stage, catalogue, wallet, audio, finish) {
  const lifetime = new AbortController();
  const {signal} = lifetime;
  const overlay = pin(stage, element('div', 'sp-shade'), 0, 0, 1300, 975);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Gamble winnings');
  const chrome = catalogue.url('bonus-cabinet.png');
  const cabinet = (node, frame) => sprite(node, chrome, frame, 1024, 768);
  const tabs = games.map((name, index) => {
    const control = pin(overlay, button(chrome ? '' : name, () => {
      if (index === game || busy) return;
      audio.play('click');
      select(index);
    }, 'sp-tab'), 27, 176 + index * 179, 205, 155);
    control.setAttribute('aria-label', name);
    return control;
  });
  const panel = cabinet(pin(overlay, element('div', 'sp-bonus-panel'), 221, 129, 1057, 777), [0, 0, 512, 328]);
  const title = pin(panel, element('div', 'sp-bonus-title', 'CHOOSE GAME..'), 42, 24, 535, 80);
  const amount = cabinet(pin(panel, element('output', 'sp-bonus-amount'), 610, 13, 434, 98), [0, 336, 128, 128]);
  const collect = pin(overlay, button('', () => {
    if (busy) return;
    audio.play('click');
    finish();
  }, 'sp-collect'), 1029, 12, 253, 99);
  collect.append(element('span', 'sp-collect-label', 'COLLECT'));
  collect.setAttribute('aria-label', 'Collect');
  const area = pin(panel, element('div'), 24, 117, 1014, 641);
  let game, busy = false, controls = [];

  function refresh() {
    const canPlay = !busy && wallet.state.pendingWin > 0;
    if (!busy) amount.textContent = money(wallet.state.pendingWin);
    collect.hidden = !canPlay;
    for (const control of [...tabs, ...controls]) control.disabled = !canPlay;
  }

  function select(index) {
    game = index;
    wallet.state.bonusGame = index;
    wallet.save();
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-pressed', String(i === index));
      cabinet(tab, [i === index ? 512 : 664, i * 116, 148, 112]);
    });
    area.replaceChildren();
    controls = [];
    title.textContent = 'CHOOSE GAME..';
    [slots, coin, link, highLow][index]();
    refresh();
  }

  function command(label, action, x, y, width, height, className = 'sp-command') {
    const control = pin(area, button(label, action, className), x, y, width, height);
    controls.push(control);
    return control;
  }

  function frame(node, art, index, columns, rows, fallback) {
    const url = catalogue.url(art);
    if (!url) {
      node.textContent = fallback;
      return;
    }
    sprite(node, url, [index % columns, Math.floor(index / columns), 1, 1], columns, rows);
  }

  async function run(multiplier, message, reveal) {
    if (busy || !wallet.wager(multiplier)) return;
    busy = true;
    refresh();
    audio.play('click');
    title.textContent = message;
    await reveal();
    if (signal.aborted) return;
    busy = false;
    title.textContent = multiplier === 0 ? 'UNLUCKY!' : multiplier === 1 ? 'PLAY AGAIN OR COLLECT' : 'YOU WON ×' + multiplier + '!';
    refresh();
    if (multiplier > 0) audio.play('win');
    else if (await wait(650, signal)) finish();
  }

  function slots() {
    const board = pin(area, element('div', 'sp-slot-board'), 42, 8, 708, 624);
    const columns = Array.from({length: 3}, (_, column) => {
      const reel = pin(board, element('div'), 10 + column * 232, 9, 224, 538);
      const window = pin(reel, element('div', 'sp-reel-window'), 9, 11, 206, 516);
      cabinet(pin(window, element('div'), 0, 0, 206, 516), [144, 472, 128, 256]);
      const symbols = Array.from({length: 3}, (_, row) => pin(window, element('div', 'sp-reel-symbol'), 11, -122 + row * 253, 184, 229));
      const strip = pin(window, element('div', 'sp-reel-strip'), 0, 0, 206, 516);
      const stripUrl = catalogue.url('bonus-reel-strip.jpg');
      if (stripUrl) strip.style.backgroundImage = 'url("' + stripUrl + '")';
      strip.hidden = true;
      cabinet(pin(reel, element('div', 'sp-decor'), 0, 0, 224, 538), [0, 472, 138, 268]);
      return {symbols, strip, stripUrl};
    });
    const set = (cell, symbol) => frame(cell, 'bonus-slots.png', symbol, 2, 3, symbol === 1 ? 'AGAIN' : '×' + symbol);
    for (const reel of columns) for (const cell of reel.symbols) set(cell, random(1, 6));
    const tag = pin(board, element('div', 'sp-bonus-tag', chrome ? '' : 'MATCH 3 SYMBOLS'), 55, 551, 598, 66);
    cabinet(tag, [400, 480, 490, 64]);
    const spin = command('', () => {
      const prize = bonusMultiplier();
      run(prize, 'SPINNING…', async () => {
        const outcomes = columns.map(() => [random(1, 6), prize || random(1, 6), random(1, 6)]);
        if (!prize && outcomes.every(col => col[1] === outcomes[0][1])) outcomes[2][1] = outcomes[2][1] % 5 + 1;
        for (const {strip, stripUrl} of columns) strip.hidden = !stripUrl;
        audio.play('bonus-reel-spin');
        for (let i = 0; i < columns.length; i++) {
          if (!await wait(i ? random(350, 465) : random(520, 700), signal)) return;
          const {strip, symbols} = columns[i];
          strip.hidden = true;
          symbols.forEach((cell, row) => set(cell, outcomes[i][row]));
          audio.play('bonus-reel-stop');
        }
      });
    }, 809, 446, 199, 192, 'sp-spin');
    spin.append(element('span', 'sp-spin-label', 'SPIN'));
    spin.setAttribute('aria-label', 'Spin');
  }

  function coin() {
    const display = pin(area, element('div', 'sp-bonus-tag'), 300, 46, 415, 415);
    const set = (index, fallback) => frame(display, 'bonus-coin.png', index, 8, 8, fallback);
    set(30, 'DOUBLE');
    command('FLIP', () => {
      const won = Math.random() < .46;
      run(won ? 2 : 0, 'FLIPPING…', async () => {
        audio.play('bonus-toss');
        let spin = random(240, 480);
        while (spin > 0) {
          spin = Math.max(0, spin - Math.sqrt(spin) * .4 - 1);
          set(((won ? 30 : 0) + Math.floor(spin)) % 60, 'FLIPPING');
          if (!await wait(20, signal)) return;
        }
        set(won ? 30 : 0, won ? 'DOUBLE' : 'NOTHING');
      });
    }, 370, 498, 274, 78);
  }

  function link() {
    const cells = linkPrizes.map((prize, index) => {
      const cell = pin(area, element('div', 'sp-link-cell'), 270 + index % 3 * 159, 26 + Math.floor(index / 3) * 144, 154, 139);
      frame(pin(cell, element('div'), 10, 6, 134, 127), 'bonus-link.png', prize, 2, 3, prize ? '×' + prize : 'BAD LUCK');
      return cell;
    });
    command('PLAY', () => {
      const prize = bonusMultiplier();
      run(prize, 'PICKING A PRIZE…', async () => {
        const matching = linkPrizes.flatMap((value, i) => value === prize ? [i] : []);
        const winner = matching[random(0, matching.length)];
        let index = random(0, cells.length);
        cells.forEach(cell => cell.classList.remove('sp-lit'));
        for (let step = 0; step < 9; step++) {
          cells[index].classList.add('sp-lit');
          audio.play('match');
          if (!await wait(110 + step * 20, signal)) return;
          cells[index].classList.remove('sp-lit');
          const choices = cells.flatMap((_, i) => i !== index && (step !== 7 || i !== winner) ? [i] : []);
          index = choices[random(0, choices.length)];
        }
        cells[winner].classList.add('sp-lit');
        audio.play('match');
      });
    }, 370, 498, 274, 78);
  }

  function highLow() {
    const displays = ['DEALER', 'YOUR CARD'].map((label, index) => {
      pin(area, element('div', 'sp-bonus-tag', label), 218 + index * 355, 14, 220, 48);
      return pin(area, element('div', 'sp-playing-card'), 218 + index * 355, 67, 220, 304);
    });
    const set = (side, rank) => frame(displays[side], 'bonus-cards.png', rank, 5, 3,
      ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][rank] || '?');
    [0, 1].forEach(side => set(side, 0));
    ['HIGHER', 'LOWER'].forEach((label, i) => {
      command(label, () => {
        const won = Math.random() < .46;
        const higher = (i === 0) === won;
        run(won ? 2 : 0, 'DEALING…', async () => {
          const dealer = higher ? random(2, 13) : random(3, 14);
          const player = higher ? random(dealer + 1, 14) : random(2, dealer);
          [0, 1].forEach(side => set(side, 0));
          audio.play('bonus-card-deal');
          if (!await wait(550, signal)) return;
          set(0, dealer);
          audio.play('bonus-card-turn');
          if (!await wait(550, signal)) return;
          set(1, player);
          audio.play('bonus-card-turn');
          await wait(300, signal);
        });
      }, 234 + i * 280, 440, 266, 76);
    });
  }

  select(Math.min(3, Math.max(0, wallet.state.bonusGame)));
  return {view: overlay, close() {
    lifetime.abort();
    audio.stop('bonus-reel-spin');
    overlay.remove();
  }};
}
