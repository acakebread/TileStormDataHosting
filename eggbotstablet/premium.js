// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';

export const onlyBotsShop = 'https://buymeacoffee.com/acakebread/extras';
export const onlyBotsPriceUsd = 30;

// SHA-256 of the shared codes after removing punctuation and converting to uppercase.
const appDigest = '4ac0e570e668ad6308c806426dbc260bdb79832e8c53c69590d794e3ff0b185f';
const premiumDigest = '7a5630c3b47a2c6e0f59990dc0f50788a81392749d6209413c68fdfd9076ce32';
const creatorProducts = new Map([
  ['goldibot', {priceUsd: 20, digest: '555b530d8d1f53ca8e2b387036ade13ebb70bfa8e87f762c25d4a6441393fbbc'}]
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
  return hasReceipt(appReceipt) || hasPremiumAccess();
}

export function creatorPriceUsd(id) {
  return creatorProducts.get(id)?.priceUsd;
}

export function hasCreatorAccess(id) {
  return !creatorProducts.has(id) || hasReceipt(creatorReceipt(id)) || hasPremiumAccess();
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
