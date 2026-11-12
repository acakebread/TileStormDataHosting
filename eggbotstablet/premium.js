// Copyright 2026 massivehadron.com ltd.

import {loadSetting, saveSetting} from './ui.js';

export const premiumShop = 'https://buymeacoffee.com/acakebread/extras';

// SHA-256 of the normalised premium supporter code configured in the Unity scene.
const premiumCodeDigest = '7a5630c3b47a2c6e0f59990dc0f50788a81392749d6209413c68fdfd9076ce32';
const receiptKey = 'onlyBotsPremium';
let registered = loadSetting(receiptKey, false) === true;

export function hasPremiumAccess() {
  return registered;
}

export async function redeemPremiumCode(code) {
  const normalized = code.replace(/[^\p{L}\p{Nd}]/gu, '').toUpperCase();
  if (!normalized) return false;
  const bytes = new TextEncoder().encode(normalized);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== premiumCodeDigest) return false;
  registered = true;
  saveSetting(receiptKey, registered);
  return true;
}
