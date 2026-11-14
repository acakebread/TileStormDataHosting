// Copyright 2026 massivehadron.com ltd.

import {claimShopPurchase, matchShopReturn} from './purchases.js?v=shop-return';

const items = new Map([
  ['basic', {name: 'TileStorm Evolution Basic Access', result: 'Return to TileStorm to use Basic Access.'}],
  ['onlybots', {name: 'OnlyBots', result: 'Open BotStore to install or open OnlyBots.'}],
  ['goldibot', {name: 'Goldibot', result: 'Open Goldibot in OnlyBots. OnlyBots access is required.'}],
  ['kelly_and_lucy', {name: 'Kelly and Lucy', result: 'Open Kelly and Lucy in OnlyBots. OnlyBots access is required.'}],
  ['lovebot', {name: '1,000 LoveBot swipes', result: 'Open LoveBot to use your swipes.'}]
]);
const product = new URLSearchParams(location.search).get('product') ?? 'lovebot';
const item = items.get(product);

const form = document.getElementById('claim');
const reference = document.getElementById('reference');
const status = document.getElementById('status');
const submit = form.querySelector('button');
const section = document.getElementById('claim-section');
const links = document.getElementById('app-links');

function showLinked() {
  section.hidden = true;
  links.hidden = false;
  status.textContent = `Purchase linked. ${item.result}`;
}

if (item) {
  document.getElementById('product-title').textContent = item.name;
  document.title = `${item.name} · TileStorm Evolution`;
  form.hidden = false;
  const tabletLink = document.getElementById('tablet-link');
  const gameHelp = document.getElementById('game-help');
  if (product === 'basic') {
    document.getElementById('profile-help').textContent = 'Before claiming, choose Help → Link Web Tablet from the TileStorm player profile that should receive Basic Access. Then return here in the same browser profile.';
    gameHelp.textContent = ', then choose Help → Link Web Tablet to sync Basic Access to your game profile.';
  } else {
    document.getElementById('tablet-option').hidden = false;
    if (product === 'lovebot') {
      submit.textContent = 'Claim swipes';
      tabletLink.href = './#love';
      tabletLink.textContent = 'Open LoveBot on Eggbot’s tablet';
      gameHelp.textContent = ', then open LoveBot on Eggbot’s tablet when he’s home.';
    } else {
      tabletLink.href = './#store';
      tabletLink.textContent = 'Open BotStore on Eggbot’s tablet';
      gameHelp.textContent = ', then open OnlyBots from BotStore on Eggbot’s tablet when he’s home.';
    }
  }
  resolveReturn();
} else {
  status.textContent = 'Open the claim link for your item from Buy Me a Coffee.';
}

async function resolveReturn() {
  const token = new URLSearchParams(location.hash.slice(1)).get('return');
  if (token) {
    try {
      // Give the payment webhook time to arrive if the browser returned first.
      for (let attempt = 0; attempt < 7; attempt++) {
        const state = await matchShopReturn(product, token);
        if (state === 'linked') {
          showLinked();
          return;
        }
        if (state === 'checkout') {
          status.textContent = 'Purchase confirmed. Return to the game or tablet where you started checkout.';
          status.tabIndex = -1;
          status.focus();
          const recovery = document.createElement('button');
          recovery.type = 'button';
          recovery.textContent = 'Find a different order';
          recovery.addEventListener('click', () => {
            section.hidden = false;
            reference.focus();
            recovery.remove();
          });
          status.after(recovery);
          return;
        }
        if (state !== 'pending') break;
        if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 4000));
      }
    } catch {
      status.textContent = 'The purchase service did not respond. Try again or use your transaction ID.';
      section.hidden = false;
      return;
    }
  }
  status.textContent = token ? 'We couldn’t match this order automatically. Use your transaction ID to link it.' :
    'If you started checkout in TileStorm or Eggbot’s tablet, return to that app for automatic delivery.';
  section.hidden = false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!item || submit.disabled) return;
  submit.disabled = reference.readOnly = true;
  status.textContent = 'Checking your Shop order…';
  try {
    await claimShopPurchase(product, reference.value);
    reference.value = '';
    showLinked();
  } catch (error) {
    status.textContent = error.status ? error.message : 'Could not reach the purchase service. Try again.';
  } finally {
    submit.disabled = reference.readOnly = false;
  }
});
