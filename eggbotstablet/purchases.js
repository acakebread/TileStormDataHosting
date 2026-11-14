// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';

const root = 'https://tilestorm-coffee-checkout.qrh.workers.dev';
const keyPattern = /^[a-f0-9]{64}$/;
const shopItems = new Set(['app', 'goldibot', 'kelly_and_lucy', 'lovebot']);
const keySetting = 'purchaseProfile';
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const randomKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
let key = loadSetting(keySetting, '');
if (!keyPattern.test(key)) key = randomKey();
saveSetting(keySetting, key);
let inFlight, inFlightProfile;
let linking;
const cachedPurchases = new Map();
const watching = new Map();
let lovebotBalance = 0;
let balanceProfile;
let swipePending = false;
let swipeRevision = 0;

export function hasPurchase(product) {
  return purchaseStatus(product) === true;
}

export function purchaseStatus(product) {
  return savedPurchases(key)?.includes(product);
}

function savedPurchases(profile) {
  const saved = cachedPurchases.get(profile) ?? loadSetting('purchases.' + profile, null);
  return Array.isArray(saved) ? saved : null;
}

async function post(route, body) {
  const response = await fetch(root + route, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body), signal: AbortSignal.timeout(12000)});
  const reply = await response.json();
  if (!response.ok) throw Object.assign(new Error(reply.message || 'Purchase service unavailable.'), {status: response.status});
  return reply;
}

export function paidLoveBotSwipes() {
  return balanceProfile === key ? lovebotBalance : 0;
}

function updateLoveBotBalance(profile, balance) {
  if (profile !== key) return;
  const previous = paidLoveBotSwipes();
  balanceProfile = profile;
  lovebotBalance = Number.isSafeInteger(balance) && balance > 0 ? balance : 0;
  if (previous !== lovebotBalance) window.dispatchEvent(new Event('tilestorm-lovebot-credits-changed'));
}

export async function spendLoveBotSwipe() {
  if (swipePending) return false;
  const profile = key;
  const swipe = randomKey();
  swipePending = true;
  swipeRevision++;
  try {
    let result;
    try { result = await post('/api/lovebot', {key: profile, swipe}); }
    catch (error) {
      if (error.status && error.status < 500) throw error;
      result = await post('/api/lovebot', {key: profile, swipe});
    }
    updateLoveBotBalance(profile, result.balance);
    return profile === key && result.spent;
  } finally {
    swipePending = false;
    swipeRevision++;
  }
}

export async function claimLoveBotPurchase(reference) {
  await retryLink();
  await post('/api/lovebot/claim', {key, reference});
  await refreshPurchases();
}

async function refresh(profile) {
  const revision = swipeRevision;
  const {receipts, lovebotBalance: balance} = await post('/api/purchases', {key: profile});
  if (profile !== key) return;
  if (!swipePending && revision === swipeRevision) updateLoveBotBalance(profile, balance);
  const unlocked = receipts.map(receipt => receipt.payload.split('|')[2]).sort();
  const saved = savedPurchases(profile);
  cachedPurchases.set(profile, unlocked);
  saveSetting('purchases.' + profile, unlocked);
  if (unlocked.join('|') !== saved?.join('|')) window.dispatchEvent(new Event('tilestorm-purchases-changed'));
}

export function refreshPurchases() {
  if (inFlight && inFlightProfile === key) return inFlight;
  inFlightProfile = key;
  const request = refresh(key).catch(() => {}).finally(() => { if (inFlight === request) inFlight = null; });
  return inFlight = request;
}

export async function linkPurchaseProfile(target) {
  if (!target || !keyPattern.test(target)) return;
  if (target === key) {
    await retryLink();
    await refreshPurchases();
    return;
  }
  const source = key;
  const previousLink = loadSetting('unlinkedPurchaseProfile', '');
  key = target;
  saveSetting(keySetting, key);
  // Move only purchases from this browser's generated identity. Switching Unity
  // identities should never transfer purchases between two Unity players.
  if (!loadSetting('linkedPurchaseProfile', false)) saveSetting('unlinkedPurchaseProfile', previousLink || source);
  saveSetting('linkedPurchaseProfile', true);
  window.dispatchEvent(new Event('tilestorm-purchases-changed'));
  await retryLink();
  await refreshPurchases();
}

async function retryLink() {
  if (linking) return linking;
  const source = loadSetting('unlinkedPurchaseProfile', '');
  if (!source) return;
  const target = key;
  linking = post('/api/link', {source, target}).then(() => {
    if (source === loadSetting('unlinkedPurchaseProfile', '')) saveSetting('unlinkedPurchaseProfile', '');
  }).catch(() => {}).finally(() => { linking = null; });
  return linking;
}

export function buyPurchase(product) {
  if (!shopItems.has(product)) return false;
  if (watching.has(product)) return false;
  const checkout = window.open('about:blank', '_blank');
  if (!checkout) return false;
  checkout.opener = null;
  const profile = key;
  const before = paidLoveBotSwipes();
  watching.set(product, null);
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(profile)).then(digest => {
    const args = new URLSearchParams({token: randomKey(), player: hex(new Uint8Array(digest)), product});
    checkout.location.replace(`${root}/#${args}`);
    const expires = Date.now() + 35 * 60 * 1000;
    watching.set(product, setInterval(() => {
      if (Date.now() >= expires || (product === 'lovebot' ? paidLoveBotSwipes() > before : hasPurchase(product)) || key !== profile) {
        clearInterval(watching.get(product));
        watching.delete(product);
      }
      refreshPurchases();
    }, 5000));
  }).catch(() => {
    watching.delete(product);
    checkout.close();
    window.dispatchEvent(new CustomEvent('tilestorm-checkout-error', {detail: product}));
  });
  return true;
}

window.addEventListener('focus', () => retryLink().then(refreshPurchases));
window.addEventListener('storage', event => {
  if (event.key === 'eggbot-tablet.' + keySetting) key = loadSetting(keySetting, key);
  if (event.key === 'eggbot-tablet.purchases.' + key) cachedPurchases.delete(key);
  if (event.key === 'eggbot-tablet.' + keySetting || event.key === 'eggbot-tablet.purchases.' + key)
    window.dispatchEvent(new Event('tilestorm-purchases-changed'));
});
