// Copyright 2026 massivehadron.com ltd.

import {claimShopPurchase} from './purchases.js?v=shop-claims';

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

if (item) {
  document.getElementById('product-title').textContent = item.name;
  document.title = `${item.name} · TileStorm Evolution`;
  form.hidden = false;
  const tabletLink = document.getElementById('tablet-link');
  const gameHelp = document.getElementById('game-help');
  if (product === 'basic') {
    document.getElementById('profile-help').textContent = 'Before claiming, choose Help → Link Web Tablet from the TileStorm player profile that should receive Basic Access. Then return here in the same browser profile.';
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
} else {
  status.textContent = 'Open the claim link for your item from Buy Me a Coffee.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!item || submit.disabled) return;
  submit.disabled = reference.readOnly = true;
  status.textContent = 'Checking your Shop order…';
  try {
    await claimShopPurchase(product, reference.value);
    reference.value = '';
    status.textContent = `Purchase linked. ${item.result}`;
  } catch (error) {
    status.textContent = error.status ? error.message : 'Could not reach the purchase service. Try again.';
  } finally {
    submit.disabled = reference.readOnly = false;
  }
});
