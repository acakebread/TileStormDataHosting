// Copyright 2026 massivehadron.com ltd.
// Based on Scratch Pro, copyright 2016 massivehadron.com ltd. created 29/09/2016 by Andrew Cakebread

import {shuffle} from '../tablet-preview/shared.js';
import {loadSetting, number, saveSetting, weighted} from './ui.js';

export const money = amount => '$' + number.format(amount);
export const random = (min, max) => min + Math.floor(Math.random() * (max - min));
const deckOf = count => shuffle(Array.from({length: count}, (_, index) => index));
const prizeWeights = [1 / 3, 1 / 6, 1 / 12, 1 / 16, 1 / 24];
const maxCoins = 2147483647;
const handNames = ['HIGH CARD', 'PAIR', 'TWO PAIR', 'THREE OF A KIND', 'STRAIGHT',
  'STRAIGHT', 'FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH', 'STRAIGHT FLUSH'];

export function bonusMultiplier() {
  return Math.random() < .46 ? weighted([1, 2, 3, 4, 5], n => prizeWeights[n - 1]) : 0;
}

export function createWallet() {
  const key = 'scratchProWallet';
  const saved = loadSetting(key, {});
  const state = {balance: 2000, experience: 0, collectAt: Date.now() + 30000, pendingCost: 0, pendingWin: 0,
    bonusGame: 0, muteSound: false, muteMusic: false, tapLevel: 1, tapLastWin: 0, ...saved};
  let level, progress;
  const save = () => saveSetting(key, state);
  const credit = n => { state.balance = Math.min(maxCoins, state.balance + n); };
  const tapLevel = now => now - state.tapLastWin >= 1800000 ? 1 : state.tapLevel;

  function refreshLevel() {
    let available = state.experience;
    for (level = 1; level < 100; level++) {
      const required = Math.ceil(4000 + 3000 * level * (1.04 + (level - 1) / 600) ** (level - 1));
      if (available < required) {
        progress = available / required;
        return;
      }
      available -= required;
    }
    progress = 1;
  }

  function settle() {
    const oldLevel = level;
    if (!state.pendingCost) return false;
    credit(state.pendingWin);
    state.experience += Math.max(state.pendingCost, state.pendingWin);
    state.pendingCost = state.pendingWin = 0;
    refreshLevel();
    for (let n = oldLevel + 1; n <= level; n++) {
      credit(n >= 35 ? 10000 + (n - 35) * 5000 : n >= 19 ? 3000 + (n - 19) * 200 :
        n >= 7 ? 2000 + (n - 7) * 100 : 1000 + (n - 2) * 100);
    }
    save();
    return level > oldLevel;
  }

  refreshLevel();
  settle();
  save();
  return {
    state, save, settle,
    get level() { return level; },
    get progress() { return progress; },
    get freeWait() { return Math.max(0, state.collectAt - Date.now()); },
    get tapWait() { return Math.max(0, state.tapLastWin + 60000 - Date.now()); },
    get tapLevel() { return tapLevel(Date.now()); },
    pay(cost, win) {
      if (state.pendingCost || cost > state.balance) return false;
      state.balance -= cost;
      state.pendingCost = cost;
      state.pendingWin = win;
      save();
      return true;
    },
    wager(multiplier) {
      if (!state.pendingCost || !state.pendingWin) return false;
      state.pendingWin = Math.min(maxCoins, state.pendingWin * multiplier);
      save();
      return true;
    },
    collectFree() {
      if (this.freeWait) return false;
      credit(1000);
      state.collectAt = Date.now() + 3600000;
      save();
      return true;
    },
    collectTap() {
      if (this.tapWait) return 0;
      const now = Date.now();
      const earned = tapLevel(now) * 100;
      state.tapLevel = tapLevel(now) + 1;
      state.tapLastWin = now;
      credit(earned);
      save();
      return earned;
    }
  };
}

function pickPrize({odds, multipliers, payout}) {
  const probability = odds.reduce((sum, n) => sum + 1 / n, 0);
  const returned = odds.reduce((sum, n, index) => sum + multipliers[index] / n, 0);
  if (Math.random() >= payout / 100 * probability / returned) return -1;
  return weighted(odds.map((_, index) => index), index => 1 / odds[index]);
}

function rank(cards) {
  const counts = Array(13).fill(0);
  for (const card of cards) counts[card % 13]++;
  const flush = cards.every(card => Math.floor(card / 13) === Math.floor(cards[0] / 13));
  const pairs = counts.filter(count => count === 2).length;
  const most = Math.max(...counts);
  const lowStraight = most === 1 && counts[0] && counts[1] && counts[2] && counts[3] && counts[12];
  const straight = most === 1 && counts.lastIndexOf(1) - counts.indexOf(1) === 4;
  if (straight && flush) return 10;
  if (lowStraight && flush) return 9;
  if (most === 4) return 8;
  if (most === 3 && pairs === 1) return 7;
  if (flush) return 6;
  if (straight) return 5;
  if (lowStraight) return 4;
  if (most === 3) return 3;
  return pairs;
}

function poker(count, slot) {
  const hands = [];
  for (let attempt = 0; attempt < 128 && hands.length < count; attempt++) {
    hands.length = 0;
    const deck = deckOf(52);
    for (let offset = 0; offset <= 47 && hands.length < count; offset += 5) {
      const cards = deck.slice(offset, offset + 5);
      const value = rank(cards);
      if (!hands.some(hand => hand.value === value)) hands.push({cards, value});
    }
  }
  if (hands.length !== count) {
    const fallback = [[0, 3, 19, 35, 50], [1, 14, 20, 36, 49], [2, 15, 5, 18, 44], [4, 17, 30, 48, 51]];
    hands.splice(0, hands.length, ...fallback.slice(0, count).map(cards => ({cards, value: rank(cards)})));
  }
  hands.sort((a, b) => b.value - a.value);
  if (slot >= 0) {
    [hands[0], hands[1]] = [hands[1], hands[0]];
    [hands[1], hands[slot + 1]] = [hands[slot + 1], hands[1]];
  } else hands.splice(1, count - 1, ...shuffle(hands.slice(1)));
  return {
    symbols: hands.flatMap(hand => hand.cards.sort((a, b) => b % 13 - a % 13)),
    hands: hands.map(hand => handNames[hand.value])
  };
}

export function dealContest(game, frames) {
  const prize = pickPrize(game);
  const {cost, multipliers, rule} = game;
  const winnings = prize < 0 ? 0 : cost * multipliers[prize];
  const prizes = game.prizes.map(() => cost * multipliers[random(0, multipliers.length)]);
  const symbols = Array(game.symbols.length).fill(0);
  const wins = Array(game.wins.length).fill(false);
  let hands = [];
  if (rule === 'prize') {
    const deck = shuffle(multipliers.flatMap((_, i) => i === prize ? [] : [i, i]));
    if (prize >= 0) for (let i = 0; i < 3; i++) deck.splice(random(0, prizes.length - 2), 0, prize);
    prizes.forEach((_, i) => {
      prizes[i] = cost * multipliers[deck[i]];
      wins[i] = deck[i] === prize;
    });
    return {symbols, prizes, wins, hands, winnings};
  }

  const slot = prize < 0 ? -1 : random(0, prizes.length);
  if (slot >= 0) {
    prizes[slot] = winnings;
    if (rule !== 'symbol') wins[slot] = true;
  }
  if (rule === 'pair' || rule === 'triple') {
    const size = rule === 'pair' ? 2 : 3;
    prizes.forEach((_, i) => {
      const first = i === slot ? Math.min(prize, frames - 1) : random(0, frames);
      symbols[i * size] = first;
      for (let j = 1; j < size; j++) symbols[i * size + j] = i === slot ? first : (first + random(1, frames)) % frames;
    });
  } else if (rule === 'symbol') {
    const deck = deckOf(frames);
    [symbols[0], symbols[1]] = deck;
    prizes.forEach((_, i) => {
      const match = i === slot ? random(0, 2) : random(2, frames);
      symbols[i + 2] = deck[match];
      if (i === slot) wins[match] = wins[i + 2] = true;
    });
  } else if (rule === 'higher') {
    prizes.forEach((_, i) => {
      const theirs = random(0, i === slot ? frames - 2 : frames);
      symbols[i * 2] = theirs;
      symbols[i * 2 + 1] = i === slot ? random(theirs + 1, frames) : random(0, theirs);
    });
  } else if (rule === 'poker') {
    const deal = poker(symbols.length / 5, slot);
    symbols.splice(0, symbols.length, ...deal.symbols);
    hands = deal.hands;
  }
  return {symbols, prizes, wins, hands, winnings};
}
