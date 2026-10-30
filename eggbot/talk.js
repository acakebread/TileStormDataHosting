// Copyright 2026 massivehadron.com ltd.

import { interpret, tryGetReply, unrecognisedReply } from './speech.js';
import { SwazzleVoice } from './swazzle.js';

const SILENCE = 4;
const ECHO = 0.15;
const NAMED_DELAY = 0.2;
const UNKNOWN_DELAY = 1;
const INTERIM_SETTLE = 0.6;
const STITCH = 2.5;

export function browserCanListen() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createTalk({ face }) {
  const box = document.getElementById('talkToEggbot');
  const state = document.getElementById('talkState');
  const voice = new SwazzleVoice();
  const supported = browserCanListen();
  let recognition = null;
  let generation = 0;
  let attentive = false;
  let silence = 0;
  let busyUntil = 0;
  let hearing = false;
  let greetingKey = null;
  let spokenKey = null;
  let pendingKey = null;
  let recent = '';
  let recentAt = 0;
  let interimText = '';
  let interimAt = 0;
  let pending = null;
  let pendingAt = 0;

  function show(text) {
    state.hidden = false;
    state.textContent = text;
  }

  function speak(line) {
    const duration = voice.speak(line);
    busyUntil = performance.now() + (duration + ECHO) * 1000;
    silence = 0;
    show(`Eggbot: ${line}`);
  }

  function answer(text, key) {
    if (key && key === spokenKey) return;
    spokenKey = key ?? spokenKey;
    pending = null;
    speak(tryGetReply(text) || unrecognisedReply());
  }

  function queue(text, key, named) {
    if (key && key === spokenKey) return;
    pending = text;
    pendingKey = key;
    pendingAt = performance.now() + (named ? NAMED_DELAY : UNKNOWN_DELAY) * 1000;
    silence = 0;
  }

  function consider(alternatives, final, key) {
    alternatives = alternatives.map(text => text.trim()).filter(Boolean);
    if (!box.checked || !alternatives.length) return;
    let chosen = alternatives[0];
    for (const alternative of alternatives)
      if (interpret(alternative, false).greeting) { chosen = alternative; break; }
    if (attentive && !interpret(chosen, false).greeting)
      for (const alternative of alternatives)
        if (tryGetReply(alternative)) { chosen = alternative; break; }
    const now = performance.now();
    let heard = interpret(chosen, attentive);
    let spoken = chosen;
    if (!heard.greeting && recent && now - recentAt <= STITCH * 1000) {
      const joined = interpret(`${recent} ${chosen}`, attentive);
      if (joined.greeting && !interpret(recent, false).greeting) { heard = joined; spoken = `${recent} ${chosen}`; }
    }
    if (final) {
      recent = heard.greeting ? '' : chosen;
      recentAt = now;
    }
    if (!heard.addressed) return;
    if (!attentive) {
      attentive = true;
      silence = 0;
      face();
    }
    if (now < busyUntil) {
      if (tryGetReply(spoken)) { pending = spoken; pendingKey = key; pendingAt = busyUntil; }
      return;
    }
    if (heard.greeting && !heard.question) {
      if (greetingKey === key) return;
      greetingKey = key;
      pending = null;
      speak('hello');
      return;
    }
    if (!final) {
      if (!tryGetReply(spoken)) { interimText = ''; return; }
      if (interimText !== spoken) { interimText = spoken; interimAt = now; return; }
      if (now - interimAt < INTERIM_SETTLE * 1000) return;
      answer(spoken, key);
      return;
    }
    interimText = '';
    queue(spoken, key, !!tryGetReply(spoken));
  }

  function stopListening() {
    const current = recognition;
    recognition = null;
    if (!current) return;
    current.onend = null;
    try { current.abort(); } catch { /* already closed */ }
  }

  function startListening() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const session = ++generation;
    const rec = new Ctor();
    recognition = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.lang = /^en\b/i.test(navigator.language || '') ? navigator.language : 'en-GB';
    rec.onspeechstart = () => { hearing = true; silence = 0; };
    rec.onspeechend = () => { hearing = false; };
    rec.onresult = event => {
      hearing = true;
      silence = 0;
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        consider([...result].map(alternative => alternative.transcript), result.isFinal, `${session}:${index}`);
      }
    };
    rec.onerror = event => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        box.checked = false;
        stopListening();
        show(event.error === 'not-allowed'
          ? 'The microphone is blocked. Allow it for this site, then tick Talk to Eggbot again.'
          : 'Speech recognition is blocked in this browser.');
        return;
      }
      if (event.error === 'audio-capture') show('No microphone was found.');
      else if (event.error === 'network') show('Speech recognition needs a network connection.');
    };
    rec.onend = () => {
      if (recognition !== rec || !box.checked) return;
      window.setTimeout(() => { if (box.checked && recognition === rec) startListening(); }, 250);
    };
    try { rec.start(); show(attentive ? 'Ask Eggbot a question.' : 'Listening. Say Hello Eggbot.'); }
    catch { show('Speech recognition did not start. Tick the box again.'); }
  }

  box.disabled = !supported;
  if (!supported) show('This browser cannot listen. Use Chrome, Edge or Safari.');
  document.addEventListener('visibilitychange', () => {
    if (!box.checked) return;
    if (document.hidden) stopListening();
    else startListening();
  });
  box.addEventListener('change', () => {
    if (!box.checked) {
      stopListening();
      voice.stop();
      attentive = false;
      pending = null;
      state.hidden = true;
      return;
    }
    // Chrome only shows the microphone prompt when listening starts inside the tick itself.
    show('Listening. Say Hello Eggbot. Allow the microphone if the browser asks.');
    startListening();
    voice.unlock().catch(error => console.warn('Swazzle reed unavailable:', error));
  });

  return {
    get attentive() { return attentive; },
    tick(delta) {
      if (!attentive) return;
      const now = performance.now();
      if (pending && now >= busyUntil && now >= pendingAt) answer(pending, pendingKey);
      if (now < busyUntil || hearing) silence = 0;
      else silence += delta;
      if (silence >= SILENCE && now >= busyUntil) {
        attentive = false;
        pending = null;
        greetingKey = null;
        spokenKey = null;
        show('Listening. Say Hello Eggbot.');
      }
    }
  };
}
