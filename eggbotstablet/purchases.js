// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';
import {buyStripeCoins, hasStripeAccess, stripeAccessKey, stripeIncludesBotCloud, stripeLoveBotBalance, stripeMembershipTier, stripePrices, stripeSpendLoveBotSwipe, syncStripeAccess} from './stripe-coins.js?v=stripe-shop';

const root = 'https://tilestorm-coffee-checkout.qrh.workers.dev';
const keyPattern = /^[a-f0-9]{64}$/;
const shopItems = new Set(['app', 'goldibot', 'kelly_and_lucy', 'lovebot', 'botosplus', 'botcloud']);
const keySetting = 'purchaseProfile';
const webglSetting = 'webglPurchaseProfile';
const explicitProfileSetting = 'explicitPurchaseProfile';
const pendingLinkSetting = 'unlinkedPurchaseProfile';
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const randomKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
let key = loadSetting(keySetting, '');
if (!keyPattern.test(key)) key = randomKey();
saveSetting(keySetting, key);
let inFlight, inFlightProfile;
let linking;
let catalogue = new Map();
let catalogueRequest;
let catalogueExpires = 0;
const cachedPurchases = new Map();
const checkouts = new Map();
let lovebotBalance = 0;
let balanceProfile;
let swipePending = false;
let swipeRevision = 0;
let memberStatus, memberProfile, memberCheckedUntil = 0;

export function purchaseProfileKey() {
  return key;
}

export function hasPurchase(product) {
  return purchaseStatus(product) === true || hasStripeAccess(product);
}

export function stripePrice(product) {
  return stripePrices[product] || '';
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
  if (!response.ok) throw Object.assign(new Error(reply.message || 'Purchase service unavailable.'), {
    status: response.status, state: reply.state
  });
  return reply;
}

export function membershipRegistered() {
  return memberProfile === key && memberStatus?.registered === true;
}

function hasMembershipUntil(expiry) {
  return memberProfile === key && Date.now() < Math.min(memberCheckedUntil, expiry * 1000);
}

export function hasSilverBotCloud() {
  return stripeIncludesBotCloud();
}

export function subscriptionTier() {
  return stripeMembershipTier();
}

export async function membershipRequest(data, profile = key) {
  if (!keyPattern.test(profile)) throw new Error('Open email registration from the intended player profile.');
  await retryLink();
  return post('/api/membership', {...data, key: profile});
}

export function catalogueProduct(product) {
  return catalogue.get(product);
}

export function refreshCatalogue() {
  if (catalogueRequest) return catalogueRequest;
  if (Date.now() < catalogueExpires) return Promise.resolve();
  catalogueRequest = fetch(root + '/api/catalogue', {signal: AbortSignal.timeout(12000)})
    .then(async response => {
      if (!response.ok) return;
      const {products} = await response.json();
      if (!Array.isArray(products)) return;
      catalogue = new Map(products.map(item => [item.product, item]));
      catalogueExpires = Date.now() + 60000;
    }).catch(() => {}).finally(() => { catalogueRequest = null; });
  return catalogueRequest;
}

export function verifyProductCode(product, code) {
  return post('/api/redeem-code', {product, code});
}

export async function redeemPromotionCode(code) {
  followWebGLProfile();
  const profile = key;
  if (!await retryLink() || key !== profile) throw new Error('Sync purchases for this profile and try again.');
  const {message} = await post('/api/redeem-promotion', {key: profile, code});
  await inFlight;
  if (key === profile && await refreshPurchases()) return message;
  return 'Code saved. Sync purchases to apply it.';
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
    try { result = await stripeSpendLoveBotSwipe(); }
    catch (error) {
      if (error.status && error.status < 500) throw error;
      result = await stripeSpendLoveBotSwipe();
    }
    updateLoveBotBalance(profile, result.balance);
    return profile === key && result.spent;
  } finally {
    swipePending = false;
    swipeRevision++;
  }
}

export async function claimShopPurchase(product, reference) {
  followWebGLProfile();
  const profile = key;
  await retryLink();
  if (key !== profile) throw Object.assign(new Error('Your purchase profile changed. Confirm the profile and try again.'), {status: 409});
  await post('/api/claim', {key: profile, product, reference});
  await refreshPurchases();
}

export async function matchShopReturn(product, token) {
  followWebGLProfile();
  const profile = key;
  await retryLink();
  if (profile !== key) return 'manual';
  const {state} = await post('/api/shop-return', {key: profile, product, token});
  return profile === key ? state : 'manual';
}

export function claimLoveBotPurchase(reference) {
  return claimShopPurchase('lovebot', reference);
}

async function refresh(profile) {
  const revision = swipeRevision;
  const {receipts, lovebotBalance: balance, membership} = await post('/api/purchases', {key: profile});
  if (profile !== key) return false;
  const hadSilver = hasSilverBotCloud();
  const wasRegistered = membershipRegistered();
  const previousTier = subscriptionTier();
  memberProfile = profile;
  memberStatus = membership;
  memberCheckedUntil = Date.now() + 150000;
  if (!swipePending && revision === swipeRevision) {
    try { updateLoveBotBalance(profile, await stripeLoveBotBalance()); }
    catch { updateLoveBotBalance(profile, balance); }
  }
  const unlocked = receipts.map(receipt => receipt.payload.split('|')[2]).sort();
  const saved = savedPurchases(profile);
  cachedPurchases.set(profile, unlocked);
  saveSetting('purchases.' + profile, unlocked);
  let accessChanged = false;
  try {
    const effects = await syncStripeAccess();
    accessChanged = effects.length > 0;
  } catch { /* Stripe access is checked again the next time purchases refresh. */ }
  if (accessChanged || unlocked.join('|') !== saved?.join('|') || hadSilver !== hasSilverBotCloud() ||
      wasRegistered !== membershipRegistered() || previousTier !== subscriptionTier())
    window.dispatchEvent(new Event('tilestorm-purchases-changed'));
  return true;
}

export function refreshPurchases() {
  if (inFlight && inFlightProfile === key) return inFlight;
  inFlightProfile = key;
  const request = refresh(key).catch(() => false).finally(() => { if (inFlight === request) inFlight = null; });
  return inFlight = request;
}

export function linkPurchaseProfile(target) {
  if (typeof target !== 'string' || !keyPattern.test(target)) return Promise.resolve(false);
  const published = webglProfile();
  saveSetting(explicitProfileSetting, published && published !== target ? {published, target} : null);
  return usePurchaseProfile(target);
}

function usePurchaseProfile(target) {
  if (target !== key) {
    const pending = pendingLink();
    // Merge this browser's independent purchases once. Changing game profiles only switches the view.
    if (!loadSetting('linkedPurchaseProfile', false))
      saveSetting(pendingLinkSetting, pending || {source: key, target});
    saveSetting('linkedPurchaseProfile', true);
    key = target;
    saveSetting(keySetting, key);
    window.dispatchEvent(new Event('tilestorm-purchases-changed'));
  }
  return refreshLinkedPurchases();
}

function webglProfile() {
  const profile = loadSetting(webglSetting, null);
  return typeof profile === 'string' && keyPattern.test(profile) ? profile : null;
}

export async function linkWebGLProfiles() {
  const profile = webglProfile();
  if (!profile) return 'missing';
  return await syncPurchases({preferWebGL: true}) ? 'linked' : 'pending';
}

function followWebGLProfile() {
  const profile = webglProfile();
  if (!profile || profile === key) return null;
  const explicit = loadSetting(explicitProfileSetting, null);
  if (explicit?.published === profile && explicit.target === key) return null;
  saveSetting(explicitProfileSetting, null);
  return usePurchaseProfile(profile);
}

async function refreshLinkedPurchases() {
  const linked = await retryLink();
  const refreshed = await refreshPurchases();
  return linked && refreshed;
}

export function syncPurchases({preferWebGL = false} = {}) {
  if (preferWebGL && webglProfile()) saveSetting(explicitProfileSetting, null);
  return followWebGLProfile() ?? refreshLinkedPurchases();
}

function pendingLink() {
  const saved = loadSetting(pendingLinkSetting, null);
  if (typeof saved !== 'string') {
    return saved && typeof saved.source === 'string' && typeof saved.target === 'string' &&
      keyPattern.test(saved.source) && keyPattern.test(saved.target) ? saved : null;
  }
  if (!keyPattern.test(saved)) return null;
  // An older client stored only the origin. Capture the existing destination before changing profiles.
  const migrated = {source: saved, target: key};
  saveSetting(pendingLinkSetting, migrated);
  return migrated;
}

async function retryLink() {
  if (linking) return linking;
  const pending = pendingLink();
  if (!pending) return true;
  linking = post('/api/link', pending).then(() => {
    const latest = pendingLink();
    if (latest?.source === pending.source && latest?.target === pending.target) saveSetting(pendingLinkSetting, null);
    return true;
  }).catch(() => false).finally(() => { linking = null; });
  return linking;
}

function buyStripeAccess(product) {
  followWebGLProfile();
  const existing = checkouts.get(product);
  if (existing && !existing.tab.closed) {
    existing.tab.focus();
    return true;
  }
  const tab = window.open('about:blank', '_blank');
  if (!tab) return false;
  checkouts.set(product, {tab, product, profile: key});
  const signal = AbortSignal.timeout(35 * 60 * 1000);
  buyStripeCoins(stripeAccessKey(product), tab, signal).then(result => {
    if (checkouts.get(product)?.tab === tab) checkouts.delete(product);
    if (result.unlocked || result.removed) window.dispatchEvent(new Event('tilestorm-purchases-changed'));
    else if (result.message === 'Checkout was cancelled.')
      window.dispatchEvent(new CustomEvent('tilestorm-checkout-cancelled', {detail: product}));
    else if (result.message)
      window.dispatchEvent(new CustomEvent('tilestorm-checkout-error', {detail: product}));
  }).catch(() => {
    if (checkouts.get(product)?.tab === tab) checkouts.delete(product);
    window.dispatchEvent(new CustomEvent('tilestorm-checkout-error', {detail: product}));
  });
  return true;
}

export function buyPurchase(product) {
  if (product === 'lovebot') return buyStripeAccess('lovebot');
  if (product === 'botcloud' && stripeMembershipTier() === 'Bronze') return buyStripeAccess('botcloud_member');
  if (stripeAccessKey(product)) return buyStripeAccess(product);
  if (!shopItems.has(product)) return false;
  followWebGLProfile();
  const existing = checkouts.get(product);
  if (existing?.profile === key && !existing.tab.closed) {
    existing.tab.focus();
    return true;
  }
  if (existing?.profile === key && existing.active) {
    const tab = window.open(checkoutUrl(existing, true), '_blank');
    if (!tab) return false;
    existing.tab = tab;
    return true;
  }
  const tab = window.open('about:blank', '_blank');
  if (!tab) return false;
  if (existing) stopCheckout(existing);
  const attempt = {tab, product, profile: key, token: randomKey()};
  checkouts.set(product, attempt);
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(attempt.profile)).then(digest => {
    if (attempt.tab.closed || checkouts.get(product) !== attempt) {
      stopCheckout(attempt);
      return;
    }
    attempt.player = hex(new Uint8Array(digest));
    attempt.tab.location.replace(checkoutUrl(attempt));
  }).catch(() => {
    stopCheckout(attempt);
    attempt.tab.close();
    window.dispatchEvent(new CustomEvent('tilestorm-checkout-error', {detail: product}));
  });
  return true;
}

function checkoutUrl({token, player, product}, resume = false) {
  const args = new URLSearchParams({token, player, product, source: location.origin});
  if (resume) args.set('resume', '1');
  return `${root}/#${args}`;
}

function stopCheckout(attempt, cancelled = false) {
  clearTimeout(attempt.timer);
  if (checkouts.get(attempt.product) !== attempt) return;
  checkouts.delete(attempt.product);
  if (cancelled) window.dispatchEvent(new CustomEvent('tilestorm-checkout-cancelled', {detail: attempt.product}));
}

async function watchCheckout(attempt) {
  const {product, profile, token, expires} = attempt;
  if (checkouts.get(product) !== attempt) return;
  if (key !== profile || Date.now() >= expires) {
    stopCheckout(attempt);
    return;
  }
  try {
    const receipt = await post('/api/status', {token});
    if (receipt.payload) {
      stopCheckout(attempt);
      await refreshPurchases();
      return;
    }
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      stopCheckout(attempt, error.state === 'cancelled');
      return;
    }
  }
  if (checkouts.get(product) === attempt)
    attempt.timer = setTimeout(() => watchCheckout(attempt), 5000);
}

window.addEventListener('message', event => {
  if (event.origin !== root || event.data?.type !== 'tilestorm-checkout') return;
  const {product, token, state} = event.data;
  const attempt = checkouts.get(product);
  if (!attempt || event.source !== attempt.tab || token !== attempt.token) return;
  if (state === 'cancelled') stopCheckout(attempt, true);
  if (state === 'active' && !attempt.active) {
    attempt.active = true;
    attempt.expires = Date.now() + 35 * 60 * 1000;
    watchCheckout(attempt);
  }
});

if (!new URLSearchParams(location.hash.slice(1)).has('purchase-profile')) followWebGLProfile();
window.addEventListener('focus', () => {
  for (const attempt of checkouts.values()) {
    if (attempt.tab.closed && !attempt.active) stopCheckout(attempt, true);
  }
  syncPurchases();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncPurchases();
});
window.addEventListener('storage', event => {
  if (event.key === 'eggbot-tablet.' + webglSetting) followWebGLProfile();
  if (event.key === 'eggbot-tablet.' + keySetting) {
    const profile = loadSetting(keySetting, key);
    if (typeof profile !== 'string' || !keyPattern.test(profile)) return;
    key = profile;
    syncPurchases();
  }
  if (event.key === 'eggbot-tablet.purchases.' + key) cachedPurchases.delete(key);
  if (event.key === 'eggbot-tablet.' + keySetting || event.key === 'eggbot-tablet.purchases.' + key)
    window.dispatchEvent(new Event('tilestorm-purchases-changed'));
});
