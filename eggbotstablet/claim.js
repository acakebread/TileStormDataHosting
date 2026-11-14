// Copyright 2026 massivehadron.com ltd.

import {claimLoveBotPurchase} from './purchases.js?v=lovebot-credits';

const form = document.getElementById('claim');
const reference = document.getElementById('reference');
const status = document.getElementById('status');
const submit = form.querySelector('button');

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = reference.readOnly = true;
  status.textContent = 'Checking your Shop order…';
  try {
    await claimLoveBotPurchase(reference.value);
    reference.value = '';
    status.textContent = 'Purchase linked. Open LoveBot to use your swipes.';
  } catch (error) {
    status.textContent = error.status ? error.message : 'Could not reach the purchase service. Try again.';
  } finally {
    submit.disabled = reference.readOnly = false;
  }
});
