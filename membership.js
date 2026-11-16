// Copyright 2026 massivehadron.com ltd.

import {membershipRequest} from './eggbotstablet/purchases.js?v=membership-codes';

const parameters = new URLSearchParams(location.hash.slice(1));
const offer = new URLSearchParams(location.search).get('offer');
const botCloudOffer = offer === 'botcloud';
const selectedTier = offer === 'bronze' ? 'Bronze' : offer === 'silver' || botCloudOffer ? 'Silver' : null;
const suppliedProfile = parameters.get('purchase-profile');
let activationToken = parameters.get('activation');
const profile = suppliedProfile ?? history.state?.membershipProfile ?? undefined;
if (suppliedProfile !== null || activationToken !== null)
  history.replaceState(profile === undefined ? null : {membershipProfile: profile}, '', location.pathname + location.search);
if (profile !== undefined) {
  const back = document.getElementById('return');
  back.href = '/tilestorm/';
  back.textContent = 'Return to TileStorm Evolution';
}

const status = document.getElementById('status');
const activate = document.getElementById('activate');
const send = document.getElementById('send');
const verify = document.getElementById('verify');
const unregister = document.getElementById('unregister');
const chooseMembership = document.getElementById('choose-membership');
const checkMembership = document.getElementById('check-membership');
const email = document.getElementById('email');
const code = document.getElementById('code');
const buttons = [...document.querySelectorAll('button')];
let sentTo;
let busy = false;

if (selectedTier) {
  document.title = document.getElementById('title').textContent = botCloudOffer
    ? 'Unlock BotCloud with Silver' : `Subscribe to ${selectedTier}`;
  document.getElementById('introduction').textContent =
    `Choose ${selectedTier} on Buy Me a Coffee. Verify the same email here to link your subscription to TileStorm and Eggbot’s tablet.`;
  chooseMembership.textContent = 'Open Buy Me a Coffee memberships';
  chooseMembership.target = '_blank';
  chooseMembership.rel = 'noopener noreferrer';
}

function showRegistration(reply) {
  const hasBotCloud = reply.silverUntil * 1000 > Date.now();
  const activeTier = reply.subscriptionUntil * 1000 > Date.now() ? reply.subscriptionTier : null;
  const chosenTierActive = botCloudOffer ? hasBotCloud : Boolean(selectedTier && activeTier === selectedTier);
  send.hidden = !reply.available;
  unregister.hidden = !reply.registered;
  verify.hidden = true;
  code.value = '';
  sentTo = undefined;
  checkMembership.hidden = !selectedTier || !reply.registered || chosenTierActive;
  chooseMembership.hidden = chosenTierActive;
  if (hasBotCloud && (!selectedTier || chosenTierActive)) {
    status.textContent = `${reply.botCloudTier ?? 'Silver'} membership linked. BotCloud is available.`;
  } else if (chosenTierActive) {
    status.textContent = `${selectedTier} membership linked.`;
  } else if (selectedTier && reply.registered) {
    status.textContent = `Email linked. Choose ${selectedTier} using the same email, then return here to check membership.`;
  } else {
    status.textContent = activeTier ? `${activeTier} membership is active on this profile.` :
      reply.activeMemberships?.length ? 'Active membership linked.' :
      reply.registered ? 'Profile linked. No active membership is on record yet.' :
        reply.available ? 'Enter your Buy Me a Coffee email to get a verification code.' : 'Email verification is temporarily unavailable.';
  }
}

async function perform(message, action) {
  if (busy) return;
  busy = true;
  for (const button of buttons) button.disabled = true;
  status.textContent = message;
  try { await action(); }
  catch (error) { status.textContent = error.message || 'Could not reach TileStorm. Try again.'; }
  finally {
    busy = false;
    for (const button of buttons) button.disabled = false;
  }
}

function refreshMembership() {
  perform('Checking membership…', async () => showRegistration(await membershipRequest({action: 'status'}, profile)));
}

checkMembership.addEventListener('click', refreshMembership);
window.addEventListener('focus', () => {
  if (!checkMembership.hidden) refreshMembership();
});

send.addEventListener('submit', event => {
  event.preventDefault();
  const address = email.value;
  perform('Sending a code…', async () => {
    await membershipRequest({action: 'send', email: address}, profile);
    sentTo = address;
    status.textContent = 'Check your inbox, then enter the code here.';
    verify.hidden = false;
    checkMembership.hidden = true;
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

unregister.addEventListener('click', () => perform('Unlinking this profile…', async () => {
  showRegistration(await membershipRequest({action: 'unregister'}, profile));
}));

activate.addEventListener('submit', event => {
  event.preventDefault();
  perform('Linking your membership…', async () => {
    const reply = await membershipRequest({action: 'activate', token: activationToken}, profile);
    activationToken = null;
    activate.hidden = true;
    showRegistration(reply);
  });
});

if (activationToken !== null) {
  if (/^[a-f0-9]{32}$/.test(activationToken)) {
    status.textContent = 'Open this link in the browser you use for TileStorm, then link your membership.';
    activate.hidden = false;
  } else status.textContent = 'This membership activation link is invalid.';
} else refreshMembership();
