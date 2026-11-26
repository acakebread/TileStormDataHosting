// Copyright 2026 massivehadron.com ltd.

import {membershipRequest} from './eggbotstablet/purchases.js?v=stripe-shop';
import {buyStripeCoins} from './eggbotstablet/stripe-coins.js?v=stripe-shop';
import {saveSetting} from './eggbotstablet/ui.js?v=stripe-shop';

const parameters = new URLSearchParams(location.hash.slice(1));
const offer = new URLSearchParams(location.search).get('offer');
const botCloudOffer = offer === 'botcloud';
const tierByOffer = {bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', botcloud: 'Silver'};
const selectedTier = tierByOffer[offer] ?? null;
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
    `Subscribe to ${selectedTier} for ${selectedTier === 'Bronze' ? '£5' : selectedTier === 'Silver' ? '£10' : selectedTier === 'Gold' ? '£15' : '£25'} a month. The subscription renews until you cancel it in Stripe.`;
  chooseMembership.textContent = `Subscribe to ${selectedTier}`;
  chooseMembership.href = '#';
  if (profile) saveSetting('purchaseProfile', profile);
  chooseMembership.addEventListener('click', event => {
    event.preventDefault();
    const product = 'membership_' + (botCloudOffer ? 'silver' : selectedTier.toLowerCase());
    const tab = window.open('about:blank', '_blank');
    if (!tab) { status.textContent = 'Allow popups to open checkout.'; return; }
    buyStripeCoins(product, tab, AbortSignal.timeout(35 * 60 * 1000)).then(result => {
      status.textContent = result.message || (result.unlocked ? `${selectedTier} membership is active.` : 'Return here after Stripe confirms the subscription.');
    });
  });
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
