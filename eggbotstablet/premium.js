// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';
import {catalogueProduct, hasPurchase, verifyProductCode} from './purchases.js?v=purchase-sync';

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

export async function redeemOnlyBotsCode(code) {
  const {valid, premium} = await verifyProductCode('app', code);
  return valid === true && register(premium === true ? premiumReceipt : appReceipt);
}

export async function redeemCreatorCode(id, code) {
  if (!hasCreatorProduct(id)) return false;
  const {valid} = await verifyProductCode(id, code);
  return valid === true && register(creatorReceipt(id));
}
