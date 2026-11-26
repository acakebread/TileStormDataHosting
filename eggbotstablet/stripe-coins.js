// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';

const root = 'https://tilestorm-stripe.qrh.workers.dev';
const modulus = 'wurqFvjsstuoU8X/0AChbqycXXsdc5JSHDMqBG+M1ekJK+RcSELtjUxxg/xEFCwxSDF8jx8LS79FFFj9GxAEKehJ7t9TAWJGAkV2tJ9Z0pa7V18Sq1/KUZraTdickh8g+CXLrKA4ipZ1PcZfobbGRvKiiWKhnXMIs2CDebZfrkUDOC4AvcOUT864crIZJ2XuzIKxfcwxAjmnUqfLzKNpK7PeiMDLEEmZUgfYlvaK+P1DZ4r9mhA0iiJ/sDmQBQ/ekBM4EFnK7AOxZb68LHd5eyCTtUCPd+YX6zQHohkXW6qMzserzNxcL35sYG0vEy1n3iW7QY7/bO1BlsR6nYMqWQ==';
const packs = new Map([
  ['scratch_bling_5000', 5000],
  ['scratch_bling_30000', 30000],
  ['scratch_bling_75000', 75000],
  ['scratch_bling_200000', 200000],
  ['scratch_bling_500000', 500000],
  ['scratch_bling_1000000', 1000000],
  ['scratch_pro_6000', 6000],
  ['scratch_pro_25000', 25000],
  ['scratch_pro_80000', 80000],
  ['scratch_pro_250000', 250000],
  ['scratch_pro_450000', 450000],
  ['scratch_pro_1000000', 1000000]
]);
const memberships = new Map([
  ['scratch_pro_bronze', 1],
  ['scratch_pro_silver', 2],
  ['scratch_pro_gold', 3],
  ['scratch_pro_platinum', 4]
]);
const keyPattern = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const applying = new Set();
let verifyKey;

function profileKey() {
  const key = loadSetting('purchaseProfile', '');
  return keyPattern.test(key) ? key : '';
}

async function playerId(key) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(key))));
}

async function post(route, body, signal) {
  const response = await fetch(root + route, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)])
  });
  const reply = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(reply.message || 'Stripe checkout could not be opened. Try again shortly.'), {status: response.status});
  return reply;
}

async function publicKey() {
  if (!verifyKey) verifyKey = crypto.subtle.importKey('jwk', {
    kty: 'RSA', n: modulus.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), e: 'AQAB', alg: 'RS256', ext: true
  }, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  return verifyKey;
}

function productOf(grant) {
  const fields = grant?.payload?.split('|');
  return fields?.length === 5 && fields[0] === 'TSSTRIPE1' ? fields[2] : '';
}

async function verifiedOffer(grant, key) {
  const {payload, signature, checkout, state} = grant ?? {};
  if ((state !== 'paid' && state !== 'refunded') || typeof payload !== 'string' || payload.length > 256 ||
      typeof signature !== 'string' || signature.length > 512 || typeof checkout !== 'string') return null;
  const fields = payload.split('|');
  const product = fields.length === 5 ? fields[2] : '';
  const known = packs.has(product) || memberships.has(product);
  const coins = packs.has(product) ? packs.get(product) : memberships.has(product) ? 0 : null;
  const membership = memberships.get(product) || 0;
  if (!known || coins == null || fields.length !== 5 || fields[0] !== 'TSSTRIPE1' || fields[1] !== await playerId(key) ||
      (coins === 0 && membership === 0) || fields[3] !== checkout || fields[4] !== String(coins)) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(signature), value => value.charCodeAt(0)); }
  catch { return null; }
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await publicKey(), bytes, encoder.encode(payload))
    ? {coins, membership} : null;
}

function remembered(checkout) {
  const grants = loadSetting('stripeCoinGrants', {});
  return grants && typeof grants === 'object' ? grants[checkout] || 0 : 0;
}

function remember(checkout, value) {
  const grants = loadSetting('stripeCoinGrants', {});
  const next = grants && typeof grants === 'object' ? grants : {};
  next[checkout] = value;
  saveSetting('stripeCoinGrants', next);
  return loadSetting('stripeCoinGrants', {})[checkout] === value;
}

async function applyGrant(grant, key) {
  const checkout = grant?.checkout;
  const empty = {coins: 0, membership: 0, checkout};
  if (!checkout || applying.has(checkout)) return empty;
  applying.add(checkout);
  try {
    const offer = await verifiedOffer(grant, key);
    if (!offer) return empty;
    const applied = remembered(checkout);
    let sign = 0;
    if (grant.state === 'paid' && applied === 0) sign = remember(checkout, 1) ? 1 : 0;
    else if (grant.state === 'refunded' && applied === 1) sign = remember(checkout, 2) ? -1 : 0;
    else if (grant.state === 'refunded' && applied === 0) remember(checkout, 2);
    return {coins: sign * offer.coins, membership: sign * offer.membership, checkout};
  } finally {
    applying.delete(checkout);
  }
}

async function grantsFor(prefix, signal) {
  const key = profileKey();
  if (!key) return [];
  const {grants} = await post('/api/stripe/grants', {key}, signal);
  if (!Array.isArray(grants)) return [];
  const effects = [];
  for (const grant of grants) {
    if (!productOf(grant).startsWith(prefix)) continue;
    effects.push(await applyGrant(grant, key));
  }
  return effects;
}

export async function syncStripeCoins(signal) {
  try {
    const effects = await grantsFor('scratch_bling_', signal);
    return effects.reduce((sum, effect) => sum + effect.coins, 0);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return 0;
  }
}

export async function syncStripePro(signal) {
  try {
    const effects = await grantsFor('scratch_pro_', signal);
    return effects.filter(effect => effect.coins || effect.membership);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw error;
  }
}

export async function buyStripeCoins(product, tab, signal) {
  const key = profileKey();
  const game = String(product).startsWith('scratch_pro_') ? 'Scratch Pro' : 'Scratch Bling';
  if ((!packs.has(product) && !memberships.has(product)) || !key) {
    tab.close();
    return {delta: 0, membership: 0, message: 'This offer is not available.'};
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  let reply;
  try { reply = await post('/api/stripe/begin', {token, key, product}, signal); }
  catch (error) {
    tab.close();
    return {delta: 0, membership: 0, message: error.status ? error.message : 'Stripe checkout could not be opened. Try again shortly.'};
  }
  if (reply.url) {
    try { tab.location.replace(reply.url); }
    catch { return {delta: 0, membership: 0, message: 'Stripe checkout could not be opened. Try again shortly.'}; }
  } else tab.close();
  const deadline = Date.now() + 35 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal.aborted) return {delta: 0, membership: 0, message: ''};
    if (profileKey() !== key) return {delta: 0, membership: 0, message: 'Your player identity changed. Restore the original identity to receive the purchase.'};
    let status;
    try { status = await post('/api/stripe/status', {token, key, product}, signal); }
    catch (error) {
      if (error.name === 'AbortError') return {delta: 0, message: ''};
      if (error.status === 400 || error.status === 403 || error.status === 404)
        return {delta: 0, membership: 0, message: error.message || 'The purchase could not be matched. Keep your Stripe receipt.'};
      await wait(error.status === 429 ? 30000 : 4000, signal);
      continue;
    }
    if (status.state === 'paid' || status.state === 'refunded') {
      const already = remembered(status.checkout);
      const effect = await applyGrant(status, key);
      if (!effect.coins && !effect.membership && !already)
        return {delta: 0, membership: 0, checkout: status.checkout, message: status.state === 'refunded'
          ? 'The payment was refunded before the purchase was added.' : 'TileStorm could not confirm the Stripe receipt.'};
      return {delta: effect.coins, membership: effect.membership, checkout: status.checkout, message: ''};
    }
    if (status.state === 'cancelled') return {delta: 0, membership: 0, message: 'Checkout was cancelled.'};
    if (status.state === 'expired') return {delta: 0, membership: 0, message: 'The checkout timed out before Stripe confirmed payment.'};
    await wait(4000, signal);
  }
  return {delta: 0, membership: 0, message: 'The checkout timed out. If you paid, reopen ' + game + ' and the purchase will be added.'};
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => done(false), ms);
    const stop = () => done(true);
    function done(aborted) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (aborted || signal.aborted) reject(Object.assign(new Error('aborted'), {name: 'AbortError'}));
      else resolve();
    }
    if (signal.aborted) done(true);
    else signal.addEventListener('abort', stop, {once: true});
  });
}
