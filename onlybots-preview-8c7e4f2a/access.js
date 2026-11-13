// Copyright 2026 massivehadron.com ltd.

import {hasOnlyBotsAccess, onlyBotsPriceUsd, redeemOnlyBotsCode} from '../eggbotstablet/premium.js?v=onlybots-shop';
import {createPurchaseForm} from './purchase-form.js?v=onlybots-shop';

const embedded = window.parent !== window && new URLSearchParams(location.search).has('tablet');
const gate = document.getElementById('accessGate');
const preview = document.getElementById('previewContent');

function openPreview(focus, tabletPremium = false) {
  gate.replaceWith(preview.content);
  preview.remove();
  if (focus) document.getElementById('feedScroller').focus();
  import('./onlybots.js?v=onlybots-shop').then(feed => feed.start(tabletPremium)).catch(() => {
    const status = document.getElementById('feedStatus');
    status.textContent = 'The preview could not load. Reload the page to try again.';
    status.setAttribute('role', 'alert');
  });
}

if (embedded) {
  document.body.classList.add('tablet-embedded');
  gate.firstElementChild.textContent = 'OnlyBots access required.';
  window.addEventListener('message', function onAccess(event) {
    if (event.origin !== location.origin || event.source !== window.parent ||
        event.data?.type !== 'eggbot-tablet-visibility' ||
        (event.data.onlyBotsAccess !== true && event.data.premium !== true)) return;
    window.removeEventListener('message', onAccess);
    openPreview(event.data.active === true, event.data.premium === true);
  });
} else if (hasOnlyBotsAccess()) {
  openPreview(true);
} else {
  const form = createPurchaseForm({
    buyLabel: `Buy OnlyBots · US$${onlyBotsPriceUsd}`,
    redeem: redeemOnlyBotsCode,
    onAccepted: () => openPreview(true),
    invalidMessage: 'That OnlyBots code was not recognised. Check your purchase confirmation.'
  });
  const heading = document.createElement('h1');
  heading.textContent = 'Unlock OnlyBots';
  form.prepend(heading);
  gate.replaceChildren(form);
}
