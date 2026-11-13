// Copyright 2026 massivehadron.com ltd.

import {onlyBotsShop} from '../eggbotstablet/premium.js?v=creator-access-2';

export function createPurchaseForm({buyLabel, redeem, onAccepted, invalidMessage}) {
  const form = document.getElementById('purchaseFormTemplate').content.firstElementChild.cloneNode(true);
  const code = form.querySelector('input');
  const status = form.querySelector('[role="status"]');
  const unlock = form.querySelector('[type="submit"]');
  const buy = form.querySelector('.shop-link');
  buy.textContent = buyLabel;
  buy.href = onlyBotsShop;

  code.addEventListener('input', () => {
    code.removeAttribute('aria-invalid');
    status.textContent = '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (unlock.disabled) return;
    const dialog = form.closest('dialog');
    const isOpen = () => form.isConnected && (!dialog || dialog.open);
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
