// Copyright 2026 massivehadron.com ltd.

import {button, element, image, loadSetting, saveSetting} from '../ui.js';
import {loadPlayerProfile, playerId, playerMoniker, publicLabel, savePlayerMoniker, savePlayerProfile, showNicknamePrompt, showScoreBoard, submitScore} from '../high-scores.js?v=profile-keep';
import {createAudio} from './audio.js?v=tablet-sound';
import {createDrive} from './drive.js';
import {createCityRenderer, loadCity, releaseCity} from './render.js';

const media = new URL('./media/', import.meta.url);
const key = 'electricAmbulance.';
const swipeDistance = 16;
const swipeRepeatDelay = 100;
const laneSettleDistance = .05;
const artwork = file => new URL(`${file}.png`, media).href;

export function createElectricAmbulance(view) {
  let session;

  function close() {
    if (!session) return;
    session.controller.abort();
    session.dispose?.();
    session = undefined;
    view.classList.remove('ambulance-playing');
    view.replaceChildren();
  }

  async function open() {
    if (session) return;
    const run = {controller: new AbortController()};
    const {signal} = run.controller;
    session = run;
    const loading = element('p', 'ambulance-loading', 'Loading Electric Ambulance…');
    loading.setAttribute('role', 'status');
    view.replaceChildren(loading);
    try {
      const city = await loadCity(new URL('city.glb', media), signal);
      run.dispose = () => releaseCity(city);
      signal.throwIfAborted();
      startGame(view, city, run);
    } catch (error) {
      run.dispose?.();
      if (session !== run) return;
      run.controller.abort();
      session = undefined;
      console.error('Electric Ambulance:', error);
      view.replaceChildren(element('div', 'ambulance-loading',
        element('p', '', 'Electric Ambulance could not load.'), button('Try again', open)));
    }
  }

  return {open, close};
}

function startGame(view, city, run) {
  const {signal} = run.controller;
  const canvas = element('canvas', 'ambulance-road');
  canvas.setAttribute('aria-label', 'Electric Ambulance road');
  const renderer = createCityRenderer(canvas, city);
  let frame;
  let gesture;
  let effectsOn = loadSetting(key + 'sound', true) === true;
  let musicOn = loadSetting(key + 'music', true) === true;
  const audio = createAudio(media, {sound: () => effectsOn, music: () => musicOn});
  run.dispose = () => {
    cancelAnimationFrame(frame);
    clearGesture();
    audio.close();
    releaseCity(city);
    renderer.close();
  };

  let best = Math.max(0, Number(loadSetting(key + 'bestScore', 0)) || 0);
  let ranking = '';
  const drive = createDrive(city.userData, cue => {
    audio.cue(cue);
    if (cue !== 'power' && cue !== 'crash') return;
    const score = state.score;
    const newBest = score > best;
    if (newBest) {
      best = score;
      saveSetting(key + 'bestScore', best);
    }
    const showRank = reply => {
      ranking = reply?.rank > 0 ? `RANKING ${reply.rank}` : '';
      titleBest.textContent = ranking || bestLabel(best);
      if (state.phase === 'wasted') result.textContent = `${score} · ${titleBest.textContent}`;
    };
    const send = () => submitScore('electric-ambulance', score, {setMoniker: false}).then(showRank, () => {});
    loadPlayerProfile().then(() => {
      if (signal.aborted) return;
      if (newBest && !playerMoniker()) {
        playerId().then(id => {
          if (signal.aborted) return;
          showNicknamePrompt(view, {
            playerLabel: publicLabel(id),
            onSave: moniker => { savePlayerProfile({moniker: savePlayerMoniker(moniker)}).finally(send); },
            onCancel: send
          });
        }, send);
        return;
      }
      send();
    }, () => { if (!signal.aborted) send(); });
  });
  const {state} = drive;
  const batterySprites = city.userData.batterySprites.map(file => image(artwork(file), '', 'ambulance-meter'));
  const score = element('output', 'ambulance-score', '0');
  score.setAttribute('aria-label', 'Score');
  const meter = element('div', 'ambulance-battery', ...batterySprites);
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', 'Ambulance battery');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');

  function togglePause() {
    if (state.phase !== 'playing' && state.phase !== 'paused') return;
    audio.cue('pause');
    drive.togglePause();
    refreshPanels();
  }

  function icon(label, file, action) {
    const control = button('', action, 'ambulance-icon');
    control.title = label;
    control.setAttribute('aria-label', label);
    control.append(image(artwork(file)));
    return control;
  }

  function begin(mode) {
    audio.unlock();
    drive.start(mode);
    refreshPanels();
    canvas.focus({preventScroll: true});
  }

  function soundToggle(name, on, off) {
    const setting = name.toLowerCase();
    const control = icon(name, on, () => {
      audio.unlock();
      audio.cue('toggle');
      if (setting === 'music') musicOn = !musicOn;
      else effectsOn = !effectsOn;
      const active = setting === 'music' ? musicOn : effectsOn;
      saveSetting(key + setting, active);
      for (const toggle of view.querySelectorAll(`[data-option="${setting}"]`)) updateToggle(toggle, active, on, off);
      audio.mix();
    });
    control.dataset.option = setting;
    updateToggle(control, setting === 'music' ? musicOn : effectsOn, on, off);
    return control;
  }

  function updateToggle(control, active, on, off) {
    control.setAttribute('aria-pressed', String(active));
    control.firstElementChild.src = artwork(active ? on : off);
  }

  const toggles = () => element('div', 'ambulance-options',
    soundToggle('Sound', 'Symbol0003', 'Symbol0004'), soundToggle('Music', 'Symbol0005', 'Symbol0006'));
  const pause = icon('Pause', 'Symbol0001', togglePause);
  const hud = element('div', 'ambulance-hud', score, meter, pause);
  const controls = element('p', 'ambulance-controls', 'Tap the road, hold and drag left or right, or use the arrow keys to steer.');
  const bestLabel = value => ranking || `BEST ${value}`;
  const openScores = () => showScoreBoard(view, 'electric-ambulance');
  const titleBest = element('p', 'ambulance-best', bestLabel(best));
  const title = element('div', 'ambulance-panel ambulance-title', image(artwork('Logo_Front'), 'Electric Ambulance', 'ambulance-logo'),
    button('PLAY', () => begin('same'), 'ambulance-primary'), titleBest,
    button('HIGH SCORES', openScores), toggles());
  const resume = button('RESUME', () => { togglePause(); canvas.focus({preventScroll: true}); }, 'ambulance-primary');
  const paused = element('div', 'ambulance-panel', element('h2', '', 'PAUSED'), resume, toggles());
  const reason = element('h2', '', 'YOU CRASHED');
  const result = element('output', 'ambulance-result');
  const wasted = element('div', 'ambulance-panel', reason, result, button('HIGH SCORES', openScores), element('div', 'ambulance-restarts',
    button('AGAIN?', () => begin('same')), button('NEXT?', () => begin('next')), button('CONTINUE', () => begin('continue'))), toggles());
  const blast = element('div', 'ambulance-blast');
  blast.hidden = true;
  blast.setAttribute('aria-hidden', 'true');
  const stage = element('div', 'ambulance-stage', canvas, blast, hud, title, paused, wasted);
  canvas.tabIndex = 0;
  view.replaceChildren(stage, controls);

  function refreshPanels() {
    const playing = state.phase === 'playing';
    view.classList.toggle('ambulance-playing', playing);
    if (!playing) clearGesture();
    title.hidden = state.phase !== 'title';
    paused.hidden = state.phase !== 'paused';
    wasted.hidden = state.phase !== 'wasted';
    hud.hidden = state.phase === 'title';
    pause.hidden = controls.hidden = !playing;
    if (state.phase === 'wasted') {
      reason.textContent = state.reason === 'crash' ? 'YOU CRASHED' : 'POWER DEAD';
      result.textContent = `${state.score} · ${bestLabel(best)}`;
    }
    if (state.phase === 'paused') resume.focus({preventScroll: true});
    audio.phase(state.phase);
  }

  let shownBattery = -1;
  let shownCharge = -1;
  let shownScore = -1;
  let previousTime;
  function draw(now) {
    const dt = previousTime === undefined ? 0 : Math.min(.1, (now - previousTime) / 1000);
    previousTime = now;
    const phase = state.phase;
    for (let remaining = dt; remaining > 0; remaining -= .02) drive.advance(Math.min(remaining, .02));
    if (phase !== state.phase) refreshPanels();
    if (gesture?.nextSwipeAt && now >= gesture.nextSwipeAt && Math.abs(state.lane - state.targetLane) < laneSettleDistance) {
      gesture.originX = gesture.lastX;
      gesture.originY = gesture.lastY;
      gesture.nextSwipeAt = 0;
    }
    if (shownScore !== state.score) {
      shownScore = state.score;
      score.value = String(state.score);
    }
    const batteryIndex = Math.min(batterySprites.length - 1, Math.floor(state.battery * batterySprites.length));
    if (shownBattery !== batteryIndex) {
      shownBattery = batteryIndex;
      batterySprites.forEach((sprite, i) => { sprite.hidden = i !== batteryIndex; });
    }
    const charge = Math.round(state.battery * 100);
    if (shownCharge !== charge) {
      shownCharge = charge;
      meter.setAttribute('aria-valuenow', String(charge));
    }
    meter.classList.toggle('ambulance-battery-low', batteryIndex === 0 && state.elapsed % 2 < 1);
    audio.advance(state.elapsed);
    if (state.phase !== 'paused' && (state.phase !== 'wasted' || phase !== state.phase)) renderer.draw(state);
    const showBlast = state.reason === 'crash' && state.crashTime > 0 && state.crashTime < 1.1;
    blast.hidden = !showBlast;
    if (showBlast) {
      const {x, y} = renderer.crashPoint(state);
      const tile = Math.min(35, Math.floor(state.crashTime / 1.1 * 36));
      blast.style.left = `${x}%`;
      blast.style.top = `${y}%`;
      blast.style.backgroundPosition = `${tile % 6 * 20}% ${Math.floor(tile / 6) * 20}%`;
    }
    frame = requestAnimationFrame(draw);
  }

  function clearGesture() {
    if (!gesture) return;
    const id = gesture.id;
    gesture = undefined;
    if (view.hasPointerCapture(id)) view.releasePointerCapture(id);
  }

  view.addEventListener('pointerdown', event => {
    if (state.phase !== 'playing' || gesture || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
    const {clientX, clientY} = event;
    gesture = {id: event.pointerId, originX: clientX, originY: clientY, lastX: clientX, lastY: clientY,
      onRoad: event.target === canvas, swiped: false, nextSwipeAt: 0};
    view.setPointerCapture(event.pointerId);
  }, {signal});

  function steerOnSwipe(event) {
    if (gesture?.id !== event.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    const dx = gesture.lastX - gesture.originX;
    const dy = gesture.lastY - gesture.originY;
    if (gesture.nextSwipeAt || Math.abs(dx) <= swipeDistance || Math.abs(dx) <= Math.abs(dy)) return;
    gesture.swiped = true;
    gesture.nextSwipeAt = performance.now() + swipeRepeatDelay;
    drive.steer(Math.sign(dx));
  }

  view.addEventListener('pointermove', steerOnSwipe, {signal});
  view.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    steerOnSwipe(event);
    const {clientX, clientY} = event;
    const {originX, originY, onRoad, swiped} = gesture;
    clearGesture();
    if (!swiped && onRoad && Math.abs(clientX - originX) < swipeDistance && Math.abs(clientY - originY) < swipeDistance) {
      const bounds = canvas.getBoundingClientRect();
      if (clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top && clientY < bounds.bottom) {
        const pointerX = (clientX - bounds.left) / bounds.width;
        drive.steer(pointerX < renderer.playerScreenX(state) ? -1 : 1);
      }
    }
  }, {signal});
  function cancelGesture(event) {
    if (gesture?.id === event.pointerId) clearGesture();
  }
  view.addEventListener('pointercancel', cancelGesture, {signal});
  view.addEventListener('lostpointercapture', cancelGesture, {signal});
  window.addEventListener('blur', clearGesture, {signal});
  document.addEventListener('keydown', event => {
    if (event.repeat || event.defaultPrevented || document.querySelector('dialog[open], .high-scores')) return;
    if ((state.phase === 'title' || state.phase === 'wasted') && (event.key === ' ' || event.key === 'Enter')) {
      if (event.target.closest('button, a[href], input, select, textarea, [contenteditable]')) return;
      event.preventDefault();
      begin('same');
    } else if (['ArrowLeft', 'ArrowRight'].includes(event.key) && state.phase === 'playing') {
      event.preventDefault();
      drive.steer(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (['Escape', 'p', 'P'].includes(event.key)) {
      event.preventDefault();
      togglePause();
    }
  }, {signal});
  document.addEventListener('visibilitychange', () => {
    previousTime = undefined;
    if (document.hidden && state.phase === 'playing') {
      drive.togglePause();
      refreshPanels();
    } else audio.mix();
  }, {signal});

  refreshPanels();
  frame = requestAnimationFrame(draw);
}
