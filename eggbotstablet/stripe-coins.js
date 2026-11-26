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
  ['scratch_bling_1000000', 1000000]
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

async function verifiedCoins(grant, key) {
  const {payload, signature, checkout, state} = grant ?? {};
  if ((state !== 'paid' && state !== 'refunded') || typeof payload !== 'string' || payload.length > 256 ||
      typeof signature !== 'string' || signature.length > 512 || typeof checkout !== 'string') return 0;
  const fields = payload.split('|');
  const coins = packs.get(fields[2]) || 0;
  if (fields.length !== 5 || fields[0] !== 'TSSTRIPE1' || fields[1] !== await playerId(key) ||
      coins === 0 || fields[3] !== checkout || fields[4] !== String(coins)) return 0;
  let bytes;
  try { bytes = Uint8Array.from(atob(signature), value => value.charCodeAt(0)); }
  catch { return 0; }
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await publicKey(), bytes, encoder.encode(payload)) ? coins : 0;
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
  if (!checkout || applying.has(checkout)) return 0;
  applying.add(checkout);
  try {
    const coins = await verifiedCoins(grant, key);
    if (!coins) return 0;
    const applied = remembered(checkout);
    if (grant.state === 'paid' && applied === 0) return remember(checkout, 1) ? coins : 0;
    if (grant.state === 'refunded' && applied === 1) return remember(checkout, 2) ? -coins : 0;
    if (grant.state === 'refunded' && applied === 0) remember(checkout, 2);
    return 0;
  } finally {
    applying.delete(checkout);
  }
}

export async function syncStripeCoins(signal) {
  const key = profileKey();
  if (!key) return 0;
  try {
    const {grants} = await post('/api/stripe/grants', {key}, signal);
    if (!Array.isArray(grants)) return 0;
    let delta = 0;
    for (const grant of grants) delta += await applyGrant(grant, key);
    return delta;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return 0;
  }
}

export async function buyStripeCoins(product, tab, signal) {
  const key = profileKey();
  if (!packs.has(product) || !key) {
    tab.close();
    return {delta: 0, message: 'This coin pack is not available.'};
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  let reply;
  try { reply = await post('/api/stripe/begin', {token, key, product}, signal); }
  catch (error) {
    tab.close();
    return {delta: 0, message: error.status ? error.message : 'Stripe checkout could not be opened. Try again shortly.'};
  }
  if (reply.url) {
    try { tab.location.replace(reply.url); }
    catch { return {delta: 0, message: 'Stripe checkout could not be opened. Try again shortly.'}; }
  } else tab.close();
  const deadline = Date.now() + 35 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal.aborted) return {delta: 0, message: ''};
    if (profileKey() !== key) return {delta: 0, message: 'Your player identity changed. Restore the original identity to receive the coins.'};
    let status;
    try { status = await post('/api/stripe/status', {token, key, product}, signal); }
    catch (error) {
      if (error.name === 'AbortError') return {delta: 0, message: ''};
      if (error.status === 400 || error.status === 403 || error.status === 404)
        return {delta: 0, message: error.message || 'The purchase could not be matched. Keep your Stripe receipt.'};
      await wait(error.status === 429 ? 30000 : 4000, signal);
      continue;
    }
    if (status.state === 'paid' || status.state === 'refunded') {
      const already = remembered(status.checkout);
      const delta = await applyGrant(status, key);
      if (delta === 0 && !already)
        return {delta: 0, message: status.state === 'refunded' ? 'The payment was refunded before the coins were added.' : 'TileStorm could not confirm the Stripe receipt.'};
      return {delta, message: ''};
    }
    if (status.state === 'cancelled') return {delta: 0, message: 'Checkout was cancelled.'};
    if (status.state === 'expired') return {delta: 0, message: 'The checkout timed out before Stripe confirmed payment.'};
    await wait(4000, signal);
  }
  return {delta: 0, message: 'The checkout timed out. If you paid, reopen Scratch Bling and the coins will be added.'};
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
