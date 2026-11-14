// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';
import {catalogueProduct, hasPurchase, verifyProductCode} from './purchases.js?v=shop-catalogue';

// SHA-256 of the shared codes after removing punctuation and converting to uppercase.
const premiumDigest = '7a5630c3b47a2c6e0f59990dc0f50788a81392749d6209413c68fdfd9076ce32';
const creatorProducts = new Set(['goldibot', 'kelly_and_lucy']);
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

export function hasCreatorProduct(id) {
  return creatorProducts.has(id);
}

export function hasCreatorAccess(id, tabletPremium = false) {
  return !hasCreatorProduct(id) || hasPurchase(id) || hasReceipt(creatorReceipt(id)) ||
    Boolean(catalogueProduct(id)?.includedWithPremium && (tabletPremium || hasPremiumAccess()));
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
  return Boolean(digest && await verifyProductCode('app', code) && register(appReceipt));
}

export async function redeemCreatorCode(id, code) {
  return hasCreatorProduct(id) && await verifyProductCode(id, code) && register(creatorReceipt(id));
}
