// Copyright 2026 massivehadron.com ltd.

export function element(tag, className = '', ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.filter(child => child != null));
  return node;
}

export function button(label, action, className = '') {
  const control = element('button', className, label);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

export function image(src, alt = '', className = '') {
  const node = element('img', className);
  if (src) node.src = src;
  node.alt = alt;
  node.draggable = false;
  return node;
}

export function tabs(labels, selected, choose) {
  return element('nav', 'tabs', ...labels.map(label => {
    const tab = button(label, () => choose(label));
    tab.setAttribute('aria-pressed', String(label === selected));
    return tab;
  }));
}

export function watchSwipe(node, step) {
  let start;
  let suppress = false;
  node.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppress = false;
    start = {x: event.clientX, y: event.clientY, id: event.pointerId};
  });
  node.addEventListener('pointercancel', () => { start = null; });
  node.addEventListener('pointerup', event => {
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    suppress = true;
    step(dx < 0 ? 1 : -1);
  });
  node.addEventListener('click', event => {
    if (suppress && event.detail) {
      event.preventDefault();
      event.stopPropagation();
      suppress = false;
    }
  }, true);
}

export const money = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
export const number = new Intl.NumberFormat('en-GB');
export const shortTime = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit'});

export function countdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function loadSetting(key, fallback) {
  try {
    const stored = localStorage.getItem('eggbot-tablet.' + key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch {
    return fallback;
  }
}

export function saveSetting(key, value) {
  try {
    localStorage.setItem('eggbot-tablet.' + key, JSON.stringify(value));
  } catch {
    // The current tablet session still works if browser storage is unavailable.
  }
}

export function weighted(items, weight) {
  let roll = Math.random() * items.reduce((sum, item) => sum + weight(item), 0);
  return items.find(item => (roll -= weight(item)) < 0);
}
