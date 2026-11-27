// Copyright 2026 massivehadron.com ltd.

import {button, element, image, loadSetting, saveSetting} from './ui.js';
import {playerId, playerMoniker, publicLabel, savePlayerMoniker, showNicknamePrompt, showScoreBoard, submitScore} from './high-scores.js?v=high-scores';

const contentHost = 'https://eggbot-content.qrh.workers.dev/';
const index = new URL('./turtle-time-media.json?v=unity', import.meta.url);
const crunch = new URL('./art/turtle-time-crunch.wav?v=pcm', import.meta.url);
const boards = {
  rescues: [4, 328, 250, 72], timer: [260, 328, 250, 72], start: [4, 406, 250, 76],
  instructions: [260, 406, 250, 76], dialog: [532, 4, 330, 504]
};
const scoresKey = 'turtleTimeHighScore';
const roundsKey = 'turtleTimeCompletedRounds';
const sharePage = 'https://www.massivehadron.com/eggbotstablet/turtle-time-share/';
const shareCard = new URL('./turtle-time-share/card.jpg', import.meta.url).href;
const shareCaption = "I have been playing Turtle Time on Eggbot's tablet.";

function pin(node, x, y, width, height, size, layoutWidth = 600, layoutHeight = 1080) {
  Object.assign(node.style, {left: `${x * 100 / layoutWidth}%`, top: `${y * 100 / layoutHeight}%`,
    width: `${width * 100 / layoutWidth}%`, height: `${height * 100 / layoutHeight}%`});
  if (size) node.style.fontSize = `${size / 8.1}cqw`;
  return node;
}

function region(node, [x, y, width, height], sheet, sheetHeight = 512) {
  node.style.backgroundImage = `var(--turtle-${sheet})`;
  node.style.backgroundSize = `${102400 / width}% ${sheetHeight * 100 / height}%`;
  node.style.backgroundPosition = `${100 * x / (1024 - width)}% ${100 * y / (sheetHeight - height)}%`;
  return node;
}

async function loadImage(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error('The artwork could not load');
  const blob = await response.blob();
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    signal.throwIfAborted();
    signal.addEventListener('abort', () => URL.revokeObjectURL(objectUrl), {once: true});
    return {image, objectUrl};
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function createAudio(signal) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  const buffers = new Map();
  const effects = new Set();
  let context, files, ambient, downloading = false;

  function play(name, volume = .45, delay = 0, rate = 1, loop = false) {
    const buffer = buffers.get(name);
    if (!buffer || context?.state !== 'running' || signal.aborted || document.hidden) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(context.destination);
    if (!loop) effects.add(source);
    source.onended = () => {
      effects.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(context.currentTime + delay);
    return source;
  }

  function surf() { ambient ??= play('surf', .18, 0, 1, true); }

  async function decode(url) {
    const response = await fetch(url, {signal});
    if (!response.ok) throw new Error(`Audio download failed (${response.status})`);
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const buffer = await context.decodeAudioData(bytes);
    if (!buffer.length) throw new Error('Decoded audio is empty');
    return buffer;
  }

  function download() {
    if (!context || !files || downloading) return;
    downloading = true;
    for (const name of ['surf', 'hatch', 'rescue', 'lost', 'pickup', 'tsunami']) {
      const original = files.get(`${name}.mp3`);
      // Use the original crunch as PCM to preserve the attack in Safari's Web Audio decoder.
      const clip = name === 'lost' ? decode(crunch).catch(() => {
        if (!signal.aborted) return decode(original);
      }) : decode(original);
      clip.then(buffer => {
        if (!buffer || signal.aborted) return;
        buffers.set(name, buffer);
        if (name === 'surf') surf();
      }).catch(error => {
        if (!signal.aborted) console.warn(`Turtle Time could not load the ${name} sound.`, error);
      });
    }
  }

  function unlock() {
    if (!Audio || signal.aborted) return;
    try {
      context ??= new Audio();
      if (context.state === 'running') surf();
      else context.resume().then(surf).catch(() => {});
      download();
    } catch {
      // Turtle Time remains playable when audio is unavailable.
    }
  }

  return {unlock, play, setFiles(urls) { files = urls; download(); },
    pause() { context?.suspend().catch(() => {}); },
    stopEffects() {
      for (const effect of effects) effect.stop();
      effects.clear();
    },
    close() {
      context?.close().catch(() => {});
      ambient = null;
      buffers.clear();
      effects.clear();
    }
  };
}

export function createTurtleTime(tablet) {
  const canvas = element('canvas', 'turtle-beach');
  canvas.setAttribute('aria-label', 'Turtle Time beach');
  const title = element('h2', 'turtle-title');
  title.setAttribute('aria-label', 'Turtle Time');
  const highScoreBoard = region(pin(button('', openScores, 'turtle-wood turtle-label'), 164, 921, 272, 76, 31), boards.rescues, 'ui');
  highScoreBoard.setAttribute('aria-label', 'High scores');
  const menu = element('div', 'turtle-overlay', title, highScoreBoard,
    region(pin(button('Start', startRound, 'turtle-wood'), 20, 484, 260, 96, 41), boards.start, 'ui'),
    region(pin(button('Instructions', instructions, 'turtle-wood'), 320, 484, 260, 96, 36), boards.instructions, 'ui'));

  const rescues = pin(element('span', 'turtle-label left'), 17, 9, 256, 41, 26, 290, 100);
  const chests = pin(element('span', 'turtle-label left'), 17, 48, 256, 41, 26, 290, 100);
  const rescueBoard = region(pin(button('', showTitle, 'turtle-wood'), 5, 5, 290, 100), boards.rescues, 'ui');
  rescueBoard.setAttribute('aria-label', 'Rescue totals. Return to the title screen');
  rescueBoard.append(rescues, chests);
  const time = pin(element('span', 'turtle-label left'), 22, 9, 246, 41, 28, 290, 100);
  const wave = pin(element('span', 'turtle-wave-icon'), 22, 49, 33, 35, null, 290, 100);
  const charges = pin(element('span', 'turtle-label left'), 64, 48, 208, 41, 25, 290, 100);
  const waveBoard = region(pin(button('', () => {
    round?.callWave();
    if (round) refreshHud();
  }, 'turtle-wood'), 305, 5, 290, 100), boards.timer, 'ui');
  waveBoard.append(time, wave, charges);
  const bonus = pin(element('span', 'turtle-label turtle-pop turtle-bonus'), 366, 106, 101, 42, 32);
  const penalty = pin(element('span', 'turtle-label turtle-pop turtle-loss'), 477, 106, 101, 42, 32);
  const streak = pin(element('span', 'turtle-label turtle-pop turtle-gold', 'Triple rescue!'), 131, 153, 338, 53, 36);
  const golden = pin(element('span', 'turtle-label turtle-pop turtle-gold'), 30, 207, 540, 106, 39);
  const hud = element('div', 'turtle-overlay', rescueBoard, waveBoard, bonus, penalty, streak, golden);
  const pops = new Map();

  const panelArt = region(pin(element('div', 'turtle-wood'), 56, 140, 488, 730), boards.dialog, 'ui');
  const panelTap = pin(button('', showTitle, 'turtle-score-tap'), 56, 140, 488, 730);
  panelTap.setAttribute('aria-label', 'Return to the title screen');
  const heading = pin(element('h2', 'turtle-label'), 88, 180, 424, 80, 50);
  const message = pin(element('p', 'turtle-label'), 105, 262, 390, 377, 31);
  const scores = region(pin(button('High scores', openScores, 'turtle-wood'), 161, 636, 278, 92, 37), boards.start, 'ui');
  scores.hidden = true;
  const action = region(pin(button('', () => dialogAction?.(), 'turtle-wood'), 161, 740, 278, 92, 37), boards.instructions, 'ui');
  const dialog = element('div', 'turtle-overlay', panelArt, panelTap, heading, message, scores, action);
  const loading = element('div', 'turtle-loading');
  loading.setAttribute('role', 'status');
  const stage = element('div', 'turtle-stage', canvas, menu, hud, dialog, loading);
  const view = element('section', 'turtle-app', stage);
  view.setAttribute('aria-label', 'Turtle Time');

  let session, game, beach, preview, round, pointer, dialogAction;
  let titleTime, previewTime, recordAt, lastFrame, frame, scorecard;
  let completedRounds = 0;
  let letters = [];
  const saved = Number(loadSetting(scoresKey, 0));
  let highScore = Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;

  function saveScore() {
    if (!round || round.saved <= highScore) return;
    const previous = Number(loadSetting(scoresKey, 0)) || 0;
    highScore = Math.max(round.saved, previous);
    if (highScore !== previous) saveSetting(scoresKey, highScore);
  }

  function openScores() {
    showScoreBoard(stage, 'turtle-time');
  }

  function screen(mode) {
    menu.hidden = mode !== 'title';
    hud.hidden = mode !== 'play';
    dialog.hidden = mode !== 'dialog';
    loading.hidden = mode !== 'loading';
  }

  function showTitle() {
    scorecard = false;
    saveScore();
    clearRound();
    session?.audio.stopEffects();
    titleTime = 0;
    highScoreBoard.textContent = `High score: ${highScore}`;
    animateTitle(0);
    screen('title');
  }

  function clearRound() {
    endPointer();
    round = null;
    preview = null;
  }

  function showDialog(name, text, label, callback, showingScores = false) {
    scorecard = showingScores;
    heading.textContent = name;
    message.textContent = text;
    action.textContent = label;
    panelTap.hidden = true;
    scores.hidden = !showingScores;
    dialogAction = callback;
    screen('dialog');
  }

  function instructions() {
    showDialog('Instructions', 'Drag from a hatchling to draw its route to the sea. Tap it to hide in its shell.\n\n' +
      'Guide hatchlings around predators. Wave crates add a charge. Tap the wave to call it. Energy drinks speed turtles up.', 'Back', showTitle);
  }

  function startRound() {
    scorecard = false;
    session.audio.stopEffects();
    pops.clear();
    recordAt = -Infinity;
    round = new game.Round(feedback);
    refreshHud();
    screen('play');
  }

  function showScore() {
    const saved = round.saved;
    const newBest = saved > highScore;
    saveScore();
    const seconds = Math.floor(round.elapsed);
    const timePlayed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const record = recordAt === -Infinity ? 'High score' : 'New high score';
    const summary = `Turtles saved: ${saved}\nTurtles lost: ${round.lost}\nTreasure chests: ${round.chests}\n` +
      `Survival time: ${timePlayed}\n${record}: ${highScore}`;
    showDialog("Time's up", summary, 'Play again', startRound, true);
    clearRound();
    const showRank = reply => {
      if (!scorecard) return;
      if (reply?.rank > 0) message.textContent = `${summary}\nRanking: ${reply.rank}`;
    };
    const send = (setMoniker, moniker) => submitScore('turtle-time', saved, {setMoniker, moniker}).then(showRank, () => {});
    if (newBest && !playerMoniker()) {
      playerId().then(id => {
        if (!session) return;
        showNicknamePrompt(stage, {
          playerLabel: publicLabel(id),
          onSave: moniker => send(true, savePlayerMoniker(moniker)),
          onCancel: () => send(false, '')
        });
      }, () => send(false, ''));
    } else send(true, playerMoniker());
    offerShare();
  }

  function offerShare() {
    const previous = loadSetting(roundsKey, completedRounds);
    completedRounds = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
    saveSetting(roundsKey, completedRounds);
    if (completedRounds !== 1 && completedRounds % 3 !== 0) return;

    const card = image(shareCard, 'Turtle Time logo, hatchlings on the beach, and a QR code to play on Eggbot’s tablet');
    card.width = 1200;
    card.height = 630;
    const share = element('a', 'action-link turtle-share-link', 'Share to Facebook');
    share.href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(sharePage);
    share.target = '_blank';
    share.rel = 'noopener noreferrer';
    share.addEventListener('click', () => share.closest('dialog')?.close());
    tablet.prompt('Share Turtle Time', element('div', 'turtle-share-card', card, element('p', '', shareCaption)), [share], 'Not now');
  }

  function feedback(sound, change, isGolden, triple) {
    const elapsed = round.elapsed;
    if (sound === 'rescue' || sound === 'lost') {
      const won = sound === 'rescue';
      const amount = `${won ? '+' : '−'}${Math.abs(change)}`;
      if (isGolden) {
        golden.textContent = `Golden turtle ${won ? 'saved!' : 'lost'}\n${amount} seconds`;
        golden.classList.toggle('turtle-loss', !won);
        pops.set(golden, [elapsed, 2]);
      } else {
        const pop = won ? bonus : penalty;
        pop.textContent = `${amount}s`;
        pops.set(pop, [elapsed, .95]);
      }
      if (won && round.saved > highScore && recordAt === -Infinity) recordAt = elapsed;
      if (triple) {
        pops.set(streak, [elapsed, 1.35]);
        for (let i = 0; i < 3; i++) session.audio.play(sound, .32, .12 * i, 1 + .15 * i);
        return;
      }
    }
    session.audio.play(sound);
  }

  function refreshHud() {
    const remaining = Math.ceil(round.timeLeft);
    const activeWave = round.sea.waveActive;
    const timeText = `Turtle time: ${remaining}`;
    const rescueText = `Turtle rescues: ${round.saved}`;
    const chestText = `Treasure chests: ${round.chests}`;
    const chargeText = `x${round.charges}${activeWave ? '  Wave active' : ''}`;
    if (time.textContent !== timeText) {
      time.textContent = timeText;
      time.classList.toggle('turtle-hurry', remaining <= 15);
    }
    if (rescues.textContent !== rescueText) rescues.textContent = rescueText;
    if (chests.textContent !== chestText) chests.textContent = chestText;
    if (charges.textContent !== chargeText) {
      charges.textContent = chargeText;
      waveBoard.setAttribute('aria-label', `Call tsunami. ${round.charges} remaining.${activeWave ? ' Wave active.' : ''}`);
    }
    waveBoard.disabled = !round.canCallWave;
    const age = round.elapsed - round.lastWavePickup;
    const pulse = age < .8 ? Math.sin(Math.PI * age / .8) : 0;
    wave.style.transform = `scale(${1 + .38 * pulse})`;
    wave.style.opacity = waveBoard.disabled ? .5 + .5 * pulse : 1;
    rescueBoard.style.setProperty('--turtle-record', Math.max(0, 1 - (round.elapsed - recordAt) / .75));
    for (const node of [bonus, penalty, streak, golden]) {
      const entry = pops.get(node);
      const left = entry ? entry[1] - (round.elapsed - entry[0]) : 0;
      node.hidden = left <= 0;
      node.style.opacity = Math.min(1, left / .3);
      if (entry && left <= 0) pops.delete(node);
    }
  }

  function animateTitle(delta) {
    titleTime = (titleTime + delta) % 6.5;
    for (const {node, delay} of letters) {
      const age = titleTime - 1.6 - delay;
      const swell = age > 0 && age < .7 ? Math.sin(Math.PI * age / .7) : 0;
      node.style.transform = `scale(${1 + .13 * swell * swell})`;
    }
  }

  function animate(now) {
    const delta = lastFrame && !document.hidden ? Math.min(.25, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (!menu.hidden) animateTitle(delta);
    if (round) {
      let remaining = delta;
      while (remaining > 0 && round.timeLeft > 0) {
        const step = Math.min(remaining, .04);
        round.step(step);
        remaining -= step;
      }
      refreshHud();
      if (round.timeLeft <= 0) showScore();
    }
    if (!round) {
      preview ??= new game.Sea();
      preview.step(delta, false);
      previewTime += delta;
    }
    beach.draw(round?.sea ?? preview, round, round?.elapsed ?? previewTime, delta);
    frame = requestAnimationFrame(animate);
  }

  function position(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * game.width;
    const y = Math.max(0, Math.min(1, (bounds.bottom - event.clientY) / bounds.height)) * game.height;
    return {x, y};
  }

  function extendPointer(event, final) {
    if (pointer?.id !== event.pointerId) return;
    const next = position(event);
    pointer.moved ||= (next.x - pointer.x) ** 2 + (next.y - pointer.y) ** 2 >= 64;
    if (pointer.moved) round?.extendRoute(next, final);
  }

  function endPointer() {
    if (!pointer) return;
    const {id} = pointer;
    pointer = null;
    round?.endRoute();
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  canvas.addEventListener('pointerdown', event => {
    if (!beach || pointer || event.button !== 0) return;
    const point = position(event);
    if (round?.timeLeft > 0 && round.beginRoute(point)) {
      pointer = {...point, id: event.pointerId, moved: false};
      canvas.setPointerCapture(event.pointerId);
    } else beach.shakeAt(point.x, point.y, round);
  });
  canvas.addEventListener('pointermove', event => extendPointer(event, false));
  canvas.addEventListener('pointerup', event => {
    if (pointer?.id !== event.pointerId) return;
    extendPointer(event, true);
    endPointer();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (pointer?.id === event.pointerId) endPointer();
  });
  for (const type of ['pointerdown', 'click', 'keydown']) view.addEventListener(type, () => session?.audio.unlock());

  function close() {
    if (!session) return;
    session.controller.abort();
    session.audio.close();
    session = null;
    cancelAnimationFrame(frame);
    saveScore();
    clearRound();
    beach?.release();
    beach = null;
    canvas.width = canvas.height = 1;
    title.replaceChildren();
    letters = [];
    stage.style.removeProperty('--turtle-ui');
    stage.style.removeProperty('--turtle-beach');
  }

  function showLoadError(text) {
    close();
    screen('loading');
    loading.replaceChildren(element('p', '', text), button('Try again', open));
  }

  async function loadAssets(active) {
    const {signal} = active.controller;
    try {
      const [metadata, rules, drawing] = await Promise.all([
        fetch(index, {signal}).then(response => {
          if (!response.ok) throw new Error('Turtle Time media list is unavailable');
          return response.json();
        }),
        import('./turtle-time-round.js'),
        import('./turtle-time-beach.js')
      ]);
      if (signal.aborted) return;
      if (metadata.schemaVersion !== 1 || !Array.isArray(metadata.media) || metadata.letters?.length !== 10) {
        throw new Error('Turtle Time media list is invalid');
      }
      const urls = new Map(metadata.media.map(({name, file}) => [name, new URL(file, contentHost)]));
      active.audio.setFiles(urls);
      const [atlas, interfaceAtlas] = await Promise.all([
        loadImage(urls.get('beach.png'), signal), loadImage(urls.get('interface.png'), signal)
      ]);
      if (signal.aborted) return;
      if (atlas.image.width !== 1024 || atlas.image.height !== 1024 ||
          interfaceAtlas.image.width !== 1024 || interfaceAtlas.image.height !== 512) {
        throw new Error('Unexpected Turtle Time atlas dimensions');
      }
      game = rules;
      stage.style.setProperty('--turtle-ui', `url("${interfaceAtlas.objectUrl}")`);
      stage.style.setProperty('--turtle-beach', `url("${atlas.objectUrl}")`);
      region(wave, drawing.waveIcon, 'beach', 1024);
      letters = metadata.letters.map(letter => {
        const {x, y, width, height, atlasX, atlasY} = letter;
        const node = pin(element('span'), 10 + x * 580 / 520, 42 + y * 385 / 316, width * 580 / 520, height * 385 / 316);
        node.setAttribute('aria-hidden', 'true');
        title.append(region(node, [atlasX, atlasY, width, height], 'ui'));
        return {node, delay: (x + width / 2) / 520};
      });
      try {
        beach = drawing.createBeach(canvas, atlas.image);
      } catch {
        showLoadError('The beach needs WebGL. Enable graphics acceleration in your browser to play.');
        return;
      }
      showTitle();
      frame = requestAnimationFrame(animate);
    } catch {
      if (!signal.aborted) showLoadError('The beach couldn’t load. Check your connection and try again.');
    }
  }

  function open() {
    if (session) return;
    const controller = new AbortController();
    const {signal} = controller;
    session = {controller, audio: createAudio(signal)};
    session.audio.unlock();
    lastFrame = previewTime = 0;
    screen('loading');
    loading.textContent = 'Loading the beach…';
    document.addEventListener('visibilitychange', () => {
      lastFrame = 0;
      if (document.hidden) {
        saveScore();
        endPointer();
        session.audio.pause();
      } else session.audio.unlock();
    }, {signal});
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      showLoadError('The beach lost its graphics connection.');
    }, {signal});
    loadAssets(session);
  }

  return {view, open, close};
}
