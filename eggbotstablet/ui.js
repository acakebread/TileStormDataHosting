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

export function watchSwipe(node, step, {canDrag = () => true, move = () => {}, settle = () => {}} = {}) {
  let gesture;
  let suppressClick = false;

  function release() {
    const drag = gesture;
    gesture = null;
    if (drag && node.hasPointerCapture(drag.id)) node.releasePointerCapture(drag.id);
    return drag;
  }

  function cancel() {
    if (release()?.axis === 'x') settle();
  }

  node.addEventListener('pointerdown', event => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    if (!canDrag()) return;
    const bounds = node.getBoundingClientRect();
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY, width: node.offsetWidth,
      tilt: event.clientY < bounds.top + bounds.height / 2 ? 1 : -1,
      lastX: event.clientX, lastMove: event.timeStamp, velocity: 0
    };
  });

  window.addEventListener('pointermove', event => {
    const drag = gesture;
    if (drag?.id !== event.pointerId) return;
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) {
      cancel();
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      suppressClick = true;
      if (drag.axis === 'x') node.setPointerCapture(drag.id);
    }
    if (drag.axis !== 'x') return;
    if (event.clientX !== drag.lastX && event.timeStamp > drag.lastMove) {
      const speed = (event.clientX - drag.lastX) / (event.timeStamp - drag.lastMove);
      drag.velocity = .4 * drag.velocity + .6 * speed;
      drag.lastX = event.clientX;
      drag.lastMove = event.timeStamp;
    }
    move(dx, dy, drag.tilt);
  });

  window.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const drag = release();
    if (drag.axis !== 'x') return;
    const dx = event.clientX - drag.x;
    const distance = Math.abs(dx);
    const flick = distance >= 20 && event.timeStamp - drag.lastMove <= 100 &&
      Math.sign(drag.velocity) === Math.sign(dx) && Math.abs(drag.velocity) > drag.width * .0018;
    if (distance >= Math.max(45, drag.width * .32) || flick) step(-Math.sign(dx));
    else settle();
  });
  window.addEventListener('pointercancel', event => {
    if (gesture?.id === event.pointerId) cancel();
  });
  node.addEventListener('lostpointercapture', event => {
    if (event.target === node && gesture?.id === event.pointerId) cancel();
  });
  window.addEventListener('blur', cancel);

  node.addEventListener('click', event => {
    if (!suppressClick || !event.detail) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  return cancel;
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
