// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';
import {hasPurchase} from './purchases.js?v=linked-purchases';

export const onlyBotsPriceUsd = 30;

// SHA-256 of the shared codes after removing punctuation and converting to uppercase.
const appDigest = '4ac0e570e668ad6308c806426dbc260bdb79832e8c53c69590d794e3ff0b185f';
const premiumDigest = '7a5630c3b47a2c6e0f59990dc0f50788a81392749d6209413c68fdfd9076ce32';
const creatorProducts = new Map([
  ['goldibot', {priceUsd: 20, includedWithPremium: true, digest: '555b530d8d1f53ca8e2b387036ade13ebb70bfa8e87f762c25d4a6441393fbbc'}],
  ['kelly_and_lucy', {digest: '7eca5c295cdfd0baa06c844251abcc56305bfc7ad512ef9b3902be58f7132d24'}]
]);
const appReceipt = 'onlyBotsAccess';
const premiumReceipt = 'onlyBotsPremium';
const creatorReceipt = id => 'onlyBotsCreator.' + id;
const sessionReceipts = new Set();

function hasReceipt(key) {
  return sessionReceipts.has(key) || loadSetting(key, false) === true;
}

function register(key) {
  sessionReceipts.add(key);
  saveSetting(key, true);
  return true;
}

export function hasPremiumAccess() {
  return hasReceipt(premiumReceipt);
}

export function hasOnlyBotsAccess() {
  return hasPurchase('app') || hasReceipt(appReceipt) || hasPremiumAccess();
}

export function creatorPriceUsd(id) {
  return creatorProducts.get(id)?.priceUsd;
}

export function hasCreatorProduct(id) {
  return creatorProducts.has(id);
}

export function hasCreatorAccess(id, tabletPremium = false) {
  const product = creatorProducts.get(id);
  return !product || hasPurchase(id) || hasReceipt(creatorReceipt(id)) ||
    (product.includedWithPremium && (tabletPremium || hasPremiumAccess()));
}

async function digestCode(code) {
  const normalized = code.replace(/[^\p{L}\p{Nd}]/gu, '').toUpperCase();
  if (!normalized) return null;
  const bytes = new TextEncoder().encode(normalized);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function redeemOnlyBotsCode(code) {
  const digest = await digestCode(code);
  if (digest === premiumDigest) return register(premiumReceipt);
  return digest === appDigest && register(appReceipt);
}

export async function redeemCreatorCode(id, code) {
  const product = creatorProducts.get(id);
  return !!product && await digestCode(code) === product.digest && register(creatorReceipt(id));
}
