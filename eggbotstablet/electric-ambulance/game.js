// Copyright 2026 massivehadron.com ltd.

import {button, element, image, loadSetting, saveSetting} from '../ui.js';
import {createAudio} from './audio.js?v=tablet-sound';
import {createDrive} from './drive.js';
import {createCityRenderer, loadCity, releaseCity} from './render.js';

const media = new URL('./media/', import.meta.url);
const key = 'electricAmbulance.';
const artwork = file => new URL(`${file}.png`, media).href;

export function createElectricAmbulance(view) {
  let session;

  function close() {
    if (!session) return;
    session.controller.abort();
    session.dispose?.();
    session = undefined;
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
  let effectsOn = loadSetting(key + 'sound', true) === true;
  let musicOn = loadSetting(key + 'music', true) === true;
  const audio = createAudio(media, {sound: () => effectsOn, music: () => musicOn});
  run.dispose = () => {
    cancelAnimationFrame(frame);
    audio.close();
    releaseCity(city);
    renderer.close();
  };

  let best = Math.max(0, Number(loadSetting(key + 'bestScore', 0)) || 0);
  const drive = createDrive(city.userData, cue => {
    audio.cue(cue);
    if ((cue === 'power' || cue === 'crash') && state.score > best) {
      best = state.score;
      saveSetting(key + 'bestScore', best);
    }
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
  const controls = element('p', 'ambulance-controls', 'Tap either side of the road, swipe or use the arrow keys to steer.');
  const bestLabel = value => `BEST ${value}`;
  const titleBest = element('p', 'ambulance-best', bestLabel(best));
  const title = element('div', 'ambulance-panel ambulance-title', image(artwork('Logo_Front'), 'Electric Ambulance', 'ambulance-logo'),
    button('PLAY', () => begin('same'), 'ambulance-primary'), titleBest, toggles());
  const resume = button('RESUME', () => { togglePause(); canvas.focus({preventScroll: true}); }, 'ambulance-primary');
  const paused = element('div', 'ambulance-panel', element('h2', '', 'PAUSED'), resume, toggles());
  const reason = element('h2', '', 'YOU CRASHED');
  const result = element('output', 'ambulance-result');
  const wasted = element('div', 'ambulance-panel', reason, result, element('div', 'ambulance-restarts',
    button('AGAIN?', () => begin('same')), button('NEXT?', () => begin('next')), button('CONTINUE', () => begin('continue'))), toggles());
  const blast = element('div', 'ambulance-blast');
  blast.hidden = true;
  blast.setAttribute('aria-hidden', 'true');
  const stage = element('div', 'ambulance-stage', canvas, blast, hud, title, paused, wasted);
  canvas.tabIndex = 0;
  view.replaceChildren(stage, controls);

  function refreshPanels() {
    title.hidden = state.phase !== 'title';
    paused.hidden = state.phase !== 'paused';
    wasted.hidden = state.phase !== 'wasted';
    hud.hidden = state.phase === 'title';
    pause.hidden = state.phase !== 'playing';
    controls.hidden = state.phase !== 'playing';
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

  let gesture;
  canvas.addEventListener('pointerdown', event => {
    if (state.phase !== 'playing' || !event.isPrimary || event.button !== 0) return;
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY};
    canvas.setPointerCapture(event.pointerId);
  }, {signal});
  canvas.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const bounds = canvas.getBoundingClientRect();
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture = undefined;
    if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) drive.steer(Math.sign(dx));
    else if (Math.abs(dx) < 16 && Math.abs(dy) < 16) {
      const pointerX = (event.clientX - bounds.left) / bounds.width;
      drive.steer(pointerX < renderer.playerScreenX(state) ? -1 : 1);
    }
  }, {signal});
  canvas.addEventListener('pointercancel', () => { gesture = undefined; }, {signal});
  document.addEventListener('keydown', event => {
    if (event.repeat || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key) && state.phase === 'playing') {
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
