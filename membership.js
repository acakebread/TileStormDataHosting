// Copyright 2026 massivehadron.com ltd.

import {membershipRequest} from './eggbotstablet/purchases.js?v=checkout-continue';

const suppliedProfile = new URLSearchParams(location.hash.slice(1)).get('purchase-profile');
const profile = suppliedProfile ?? history.state?.membershipProfile ?? undefined;
if (suppliedProfile !== null)
  history.replaceState({membershipProfile: suppliedProfile}, '', location.pathname + location.search);
if (profile !== undefined) {
  const back = document.getElementById('return');
  back.href = '/tilestorm/';
  back.textContent = 'Return to TileStorm Evolution';
}

const status = document.getElementById('status');
const send = document.getElementById('send');
const verify = document.getElementById('verify');
const unregister = document.getElementById('unregister');
const email = document.getElementById('email');
const code = document.getElementById('code');
const buttons = [...document.querySelectorAll('button')];
let sentTo;

function showRegistration(reply) {
  send.hidden = !reply.available;
  unregister.hidden = !reply.registered;
  verify.hidden = true;
  code.value = '';
  sentTo = undefined;
  status.textContent = reply.silverUntil * 1000 > Date.now() ? 'Email verified. Silver membership includes BotCloud.' :
    reply.registered ? 'Email verified. No active Silver membership is on record yet.' :
      reply.available ? 'Enter your email to get a verification code.' : 'Email registration is temporarily unavailable.';
}

async function perform(message, action) {
  for (const button of buttons) button.disabled = true;
  status.textContent = message;
  try { await action(); }
  catch (error) { status.textContent = error.message || 'Could not reach TileStorm. Try again.'; }
  finally { for (const button of buttons) button.disabled = false; }
}

send.addEventListener('submit', event => {
  event.preventDefault();
  const address = email.value;
  perform('Sending a code…', async () => {
    await membershipRequest({action: 'send', email: address}, profile);
    sentTo = address;
    status.textContent = 'Check your inbox, then enter the code here.';
    verify.hidden = false;
    code.value = '';
    code.focus();
  });
});

verify.addEventListener('submit', event => {
  event.preventDefault();
  perform('Verifying your email…', async () => {
    const reply = await membershipRequest({action: 'verify', email: sentTo, code: code.value}, profile);
    email.value = '';
    showRegistration(reply);
  });
});

unregister.addEventListener('click', () => perform('Removing your email…', async () => {
  showRegistration(await membershipRequest({action: 'unregister'}, profile));
}));

perform('Checking registration…', async () => showRegistration(await membershipRequest({action: 'status'}, profile)));
