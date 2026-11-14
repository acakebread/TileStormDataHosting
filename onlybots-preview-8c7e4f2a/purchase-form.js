// Copyright 2026 massivehadron.com ltd.

import {buyPurchase, hasPurchase} from '../eggbotstablet/purchases.js?v=lovebot-credits';

export function createPurchaseForm({product, buyLabel, redeem, onAccepted, invalidMessage}) {
  const form = document.getElementById('purchaseFormTemplate').content.firstElementChild.cloneNode(true);
  const code = form.querySelector('input');
  const status = form.querySelector('[role="status"]');
  const unlock = form.querySelector('[type="submit"]');
  const buy = form.querySelector('.shop-link');
  buy.textContent = buyLabel;
  const isOpen = () => {
    const dialog = form.closest('dialog');
    return form.isConnected && (!dialog || dialog.open);
  };
  buy.addEventListener('click', () => {
    if (!buyPurchase(product)) {
      status.textContent = 'Check your open checkout tab or allow popups to start checkout.';
      return;
    }
    status.textContent = 'Checkout opened in a new tab.';
    const controller = new AbortController();
    form.closest('dialog')?.addEventListener('close', () => controller.abort(), {once: true});
    window.addEventListener('tilestorm-purchases-changed', () => {
      if (!isOpen() || hasPurchase(product)) {
        controller.abort();
        if (isOpen()) onAccepted();
      }
    }, {signal: controller.signal});
    window.addEventListener('tilestorm-checkout-error', event => {
      if (event.detail === product && isOpen()) status.textContent = 'Checkout could not open. Try again.';
    }, {signal: controller.signal});
    setTimeout(() => controller.abort(), 35 * 60 * 1000);
  });

  code.addEventListener('input', () => {
    code.removeAttribute('aria-invalid');
    status.textContent = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (unlock.disabled) return;
    unlock.disabled = code.readOnly = true;
    status.textContent = 'Checking code…';
    let accepted;
    try {
      accepted = await redeem(code.value);
    } catch {
      if (isOpen()) status.textContent = 'Could not check the code. Reload the page and try again.';
      return;
    } finally {
      unlock.disabled = code.readOnly = false;
    }
    if (!isOpen()) return;
    if (accepted) {
      code.value = '';
      onAccepted();
      return;
    }
    code.setAttribute('aria-invalid', 'true');
    status.textContent = invalidMessage;
    code.focus();
    code.select();
  });
  return form;
}
