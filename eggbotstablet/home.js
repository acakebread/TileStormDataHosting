// Copyright 2026 massivehadron.com ltd.

import {button, element} from './ui.js';

export function createHomePager(viewport, navigation, pages) {
  const grids = pages.map(() => element('div', 'app-grid'));
  const panels = grids.map(grid => element('div', 'home-page', grid));
  const track = element('div', 'home-track', ...panels);
  const dots = pages.map((_, index) => {
    const dot = button('', () => goTo(index));
    dot.setAttribute('aria-label', 'Home page ' + (index + 1));
    return dot;
  });
  let page = 0;
  let gesture;
  let suppressClick = false;

  viewport.append(track);
  navigation.append(...dots);
  updateActivePage();

  function updateActivePage() {
    panels.forEach((panel, index) => {
      panel.inert = index !== page;
      if (index === page) dots[index].setAttribute('aria-current', 'page');
      else dots[index].removeAttribute('aria-current');
    });
  }

  function goTo(index) {
    const next = Math.max(0, Math.min(pages.length - 1, index));
    const previous = page;
    const drag = gesture;
    gesture = null;
    const remaining = drag?.axis === 'x' ? Math.abs(drag.offset + next * drag.width) / drag.width : 1;
    const duration = 280 * Math.max(.35, Math.min(1, remaining));
    track.style.setProperty('--home-slide-duration', duration + 'ms');
    track.classList.remove('dragging');
    track.style.setProperty('--home-offset', -next * 100 + '%');
    if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);

    page = next;
    if (page === previous) return;
    const focused = document.activeElement;
    if (panels[previous].contains(focused) || focused === dots[previous]) {
      dots[page].focus({preventScroll: true});
    }
    updateActivePage();
  }

  function cancelDrag() {
    if (gesture) goTo(page);
  }

  viewport.addEventListener('pointerdown', event => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY,
      distance: 0, velocity: 0, movedAt: event.timeStamp};
  });

  window.addEventListener('pointermove', event => {
    const drag = gesture;
    if (drag?.id !== event.pointerId) return;
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) {
      cancelDrag();
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      suppressClick = true;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'y') return;

      const bounds = viewport.getBoundingClientRect();
      drag.width = bounds.width;
      // Pick up the displayed position if a previous slide is still settling.
      drag.start = track.getBoundingClientRect().left - bounds.left;
      track.classList.add('dragging');
      viewport.setPointerCapture(drag.id);
    }
    if (drag.axis !== 'x') return;

    const position = drag.start + Math.max(-drag.width, Math.min(drag.width, dx));
    const first = -(pages.length - 1) * drag.width;
    const bounded = Math.max(first, Math.min(0, position));
    drag.offset = bounded + (position - bounded) * .25;
    track.style.setProperty('--home-offset', drag.offset + 'px');

    if (dx !== drag.distance && event.timeStamp > drag.movedAt) {
      const speed = (dx - drag.distance) / (event.timeStamp - drag.movedAt);
      drag.velocity = drag.velocity * .4 + speed * .6;
      drag.movedAt = event.timeStamp;
    }
    drag.distance = dx;
  });

  window.addEventListener('pointerup', event => {
    const drag = gesture;
    if (drag?.id !== event.pointerId) return;
    if (drag.axis !== 'x') {
      cancelDrag();
      return;
    }
    const distance = Math.abs(drag.distance);
    const flick = distance >= 18 && event.timeStamp - drag.movedAt <= 100 &&
      Math.sign(drag.velocity) === Math.sign(drag.distance) && Math.abs(drag.velocity) > drag.width * .0007;
    const commit = distance > drag.width * .18 || flick;
    goTo(commit ? page - Math.sign(drag.distance) : page);
  });

  window.addEventListener('pointercancel', event => {
    if (event.pointerId === gesture?.id) cancelDrag();
  });
  viewport.addEventListener('lostpointercapture', event => {
    if (event.target === viewport && event.pointerId === gesture?.id) cancelDrag();
  });
  window.addEventListener('blur', cancelDrag);
  viewport.addEventListener('click', event => {
    if (!suppressClick || !event.detail) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  return {
    goTo, cancelDrag,
    step(direction) { goTo(page + direction); },
    render(createIcon) {
      grids.forEach((grid, index) => grid.replaceChildren(...pages[index].map(createIcon)));
    }
  };
}
