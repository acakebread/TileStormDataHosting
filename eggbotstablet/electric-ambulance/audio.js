// Copyright 2026 massivehadron.com ltd.

const cues = {
  start: 'start-game', left: 'car-swerve-v2-01', right: 'car-swerve-v2-02', clip: 'car-clipping',
  pickup: 'pickup-04', low: 'battery-low', power: 'battery-died', crash: 'explosion',
  pause: 'pause-button', toggle: 'mute-unmute'
};
const spots = ['amb-siren-spotsound-01', ...[1, 2, 3, 4, 6].map(n => `amb-siren-spotsound-doppler-final-0${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `amb-horn-spotsound-0${n}`)];

export function createAudio(media, preferences) {
  const tracks = new Map();
  let context, filter, music, effects;
  let unlocked = false;
  let phase = 'title';
  let spotAt = 0;

  function ensureContext() {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext || context) return;
    try {
      context = new AudioContext();
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.connect(context.destination);
      music = context.createGain();
      effects = context.createGain();
      music.connect(filter);
      effects.connect(filter);
    } catch {
      context?.close().catch(() => {});
      context = undefined;
    }
  }

  function track(name, group, volume, loop = false) {
    if (!tracks.has(name)) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = new URL(`${name}.mp3`, media).href;
      audio.loop = loop;
      if (context) {
        const level = context.createGain();
        level.gain.value = volume;
        context.createMediaElementSource(audio).connect(level).connect(group === 'music' ? music : effects);
      }
      tracks.set(name, {audio, group, volume, loop});
    }
    return tracks.get(name);
  }

  function enabled(group) {
    return group === 'music' ? preferences.music() : preferences.sound();
  }

  function play(name, volume = .65) {
    if (!unlocked || !enabled('effects')) return;
    const {audio} = track(name, 'effects', volume);
    audio.currentTime = 0;
    audio.volume = context ? 1 : volume;
    audio.play().catch(() => {});
  }

  function loop(name, group, volume, active) {
    if (!active || !enabled(group)) {
      tracks.get(name)?.audio.pause();
      return;
    }
    const {audio} = track(name, group, volume, true);
    audio.volume = context ? 1 : volume * (phase === 'playing' ? 1 : .45);
    if (audio.paused) audio.play().catch(() => {});
  }

  function mix() {
    if (!unlocked) return;
    const paused = phase === 'paused' || phase === 'wasted' || phase === 'title';
    if (context) {
      const now = context.currentTime;
      filter.frequency.setTargetAtTime(paused ? 1000 : 22000, now, .12);
      music.gain.setTargetAtTime(enabled('music') ? (paused ? .45 : 1) : 0, now, .08);
      effects.gain.setTargetAtTime(enabled('effects') ? (paused ? .45 : 1) : 0, now, .08);
    } else {
      for (const {audio, group} of tracks.values()) if (!enabled(group)) audio.pause();
    }
    loop('covid-19-emergency-track1', 'music', .35, !document.hidden);
    loop('amb-street', 'effects', .5, !document.hidden);
    loop('amb-traffic-loop', 'effects', .27, !document.hidden);
    loop('ambulance-engine', 'effects', .25, phase === 'playing' && !document.hidden);
  }

  return {unlock() {
    if (!unlocked) {
      ensureContext();
      unlocked = true;
    }
    context?.resume().catch(() => {});
    mix();
  }, phase(value) { phase = value; mix(); }, mix,
  cue(name) { if (cues[name]) play(cues[name], name === 'pickup' ? .7 : .65); },
  advance(elapsed) {
    if (phase !== 'playing' || !unlocked || !enabled('effects') || elapsed < spotAt) return;
    spotAt = elapsed + 4 + Math.random() * 6;
    play(spots[Math.floor(Math.random() * spots.length)], .26);
  }, close() {
    for (const {audio} of tracks.values()) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    tracks.clear();
    context?.close().catch(() => {});
  }};
}
