// Copyright 2026 massivehadron.com ltd.

export function createSlideGesture(viewport, track, {step, constrain, canDrag = () => true}) {
  let gesture;
  let suppressClick = false;

  function release() {
    const drag = gesture;
    gesture = null;
    if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
    return drag;
  }

  function slideTo(percent) {
    const drag = release();
    const remaining = drag?.axis === 'x' ? Math.abs(drag.offset / drag.width - percent / 100) : 1;
    const duration = 280 * Math.max(.35, Math.min(1, remaining));
    track.style.setProperty('--slide-duration', duration + 'ms');
    track.classList.remove('instant');
    track.style.setProperty('--slide-offset', percent + '%');
  }

  function jumpTo(percent) {
    release();
    track.classList.add('instant');
    track.style.setProperty('--slide-offset', percent + '%');
  }

  function cancel() {
    if (gesture?.axis === 'x') step(0);
    else release();
  }

  viewport.addEventListener('pointerdown', event => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    if (!canDrag()) return;
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY,
      distance: 0, velocity: 0, movedAt: event.timeStamp};
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
      suppressClick = true;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'y') return;

      const bounds = viewport.getBoundingClientRect();
      drag.width = bounds.width;
      // Pick up the displayed position if a previous slide is still settling.
      drag.start = track.getBoundingClientRect().left - bounds.left;
      track.classList.add('instant');
      viewport.setPointerCapture(drag.id);
    }
    if (drag.axis !== 'x') return;

    const position = drag.start + Math.max(-drag.width, Math.min(drag.width, dx));
    drag.offset = constrain(position, drag.width);
    track.style.setProperty('--slide-offset', drag.offset + 'px');

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
      release();
      return;
    }
    const distance = Math.abs(drag.distance);
    const flick = distance >= 18 && event.timeStamp - drag.movedAt <= 100 &&
      Math.sign(drag.velocity) === Math.sign(drag.distance) && Math.abs(drag.velocity) > drag.width * .0007;
    const commit = distance > drag.width * .18 || flick;
    step(commit ? -Math.sign(drag.distance) : 0);
  });

  window.addEventListener('pointercancel', event => {
    if (event.pointerId === gesture?.id) cancel();
  });
  viewport.addEventListener('lostpointercapture', event => {
    if (event.target === viewport && event.pointerId === gesture?.id) cancel();
  });
  window.addEventListener('blur', cancel);
  viewport.addEventListener('click', event => {
    if (!suppressClick || !event.detail) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  return {slideTo, jumpTo, cancel};
}
