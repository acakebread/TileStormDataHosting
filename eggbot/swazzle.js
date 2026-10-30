// Copyright 2026 massivehadron.com ltd.

// A playground rendering of the game's Swazzle voice: one reed, shaped into syllables.

const TEMPO = 1.1;
const SYLLABLE = 0.12;
const WORD_GAP = 0.055;
const SYLLABLE_GAP = 0.018;
const PUNCTUATION_PAUSE = 0.16;
const EXPRESSION = 7;
const GAIN = 0.22;
const WORDS = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const LIGHT = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'for', 'in', 'on', 'at', 'with',
  'i', 'me', 'my', 'you', 'your', 'he', 'she', 'it', 'we', 'they', 'is', 'am', 'are',
  'was', 'were', 'be', 'do', 'does', 'have', 'has'
]);
const KNOWN = {
  hello: ['hel', 'lo'], eggbot: ['egg', 'bot'], doing: ['do', 'ing'], really: ['real', 'ly'],
  little: ['lit', 'tle'], every: ['ev', 'ery'], okay: ['o', 'kay'], ok: ['o', 'kay']
};

function splitSyllables(word) {
  if (KNOWN[word]) return KNOWN[word];
  const vowels = [...word.matchAll(/[aeiouy]+/gi)];
  let count = vowels.length;
  if (count > 1 && word.length > 3 && word.endsWith('e') && !word.endsWith('le') && !word.endsWith('ee')) count--;
  if (count > 1 && word.length > 4 && word.endsWith('ed') && word.at(-3) !== 't' && word.at(-3) !== 'd') count--;
  count = Math.min(6, count);
  if (count <= 1) return [word];
  const result = [];
  let start = 0;
  for (let i = 0; i < count - 1; i++) {
    const endVowel = vowels[i].index + vowels[i][0].length;
    const split = endVowel + Math.floor((vowels[i + 1].index - endVowel) / 2);
    result.push(word.slice(start, split));
    start = split;
  }
  result.push(word.slice(start));
  return result;
}

function pauseWeight(punctuation) {
  if (/[.!?\n\r]/.test(punctuation)) return 2;
  if (/[;:]/.test(punctuation)) return 1.5;
  if (/[,—–-]/.test(punctuation)) return 0.8;
  return 0;
}

export function planSwazzle(text) {
  const source = text ?? '';
  const matches = [...source.matchAll(WORDS)];
  const words = matches.map((match, index) => {
    const end = match.index + match[0].length;
    const next = index + 1 < matches.length ? matches[index + 1].index : source.length;
    return { text: match[0], punctuation: source.slice(end, next) };
  });
  const beats = [];
  for (let first = 0; first < words.length;) {
    let last = first;
    while (last + 1 < words.length && !/[.?!:;\n\r]/.test(words[last].punctuation)) last++;
    const question = words[last].punctuation.includes('?');
    const exclamation = words[last].punctuation.includes('!');
    for (let index = first; index <= last; index++) {
      const word = words[index].text.replaceAll('’', "'").toLowerCase();
      const chunks = splitSyllables(word);
      const emphatic = words[index].text.length > 1 && words[index].text === words[index].text.toUpperCase() && words[index].text !== words[index].text.toLowerCase();
      const stress = !LIGHT.has(word) || emphatic;
      const position = (index - first) / Math.max(1, last - first);
      chunks.forEach((chunk, syllable) => {
        const pronounced = chunk.replace(/([bcdfghjklmnpqrstvwxz])\1+/gi, '$1').replace(/^(?:kn|wr)/i, match => match.slice(1));
        const consonants = Math.min(4, pronounced.match(/ch|sh|th|ph|ng|qu|ck|[bcdfghjklmnpqrstvwxz]/gi)?.length ?? 0);
        const strong = emphatic || (stress && syllable === 0);
        let strength = emphatic ? 1 : strong ? 0.88 : 0.62;
        let length = 1 + 0.12 * Math.max(0, consonants - 1);
        if ((chunk.match(/[aeiouy]+/i)?.[0].length ?? 0) > 1) length += 0.15;
        let from = 0.18 - position * 0.25 + (strong ? 0.22 : -0.1);
        if (word === 'no' || word === 'never') from -= 0.3;
        if (word === 'yes' || word === 'ok' || word === 'okay') from += 0.15;
        let to = from - 0.12;
        const lastSyllable = syllable === chunks.length - 1;
        if (index === last && lastSyllable) {
          to = question ? 0.85 : exclamation ? -0.35 : -0.55;
          length += 0.18;
          if (exclamation) strength = 1;
        }
        if (word === 'yes') to = from + 0.55;
        else if (word === 'no') to = from - 0.55;
        const duration = Math.max(0.05, SYLLABLE * length / TEMPO);
        const gap = syllable === chunks.length - 1
          ? WORD_GAP + pauseWeight(words[index].punctuation) * PUNCTUATION_PAUSE
          : SYLLABLE_GAP;
        beats.push({ duration, gap, strength, semitones: ((from + to) / 2) * EXPRESSION });
      });
    }
    first = last + 1;
  }
  if (beats.length) beats[beats.length - 1].gap = 0;
  return beats;
}

export class SwazzleVoice {
  constructor() {
    this.context = null;
    this.reed = null;
    this.sources = [];
    this.url = new URL('./assets/swazzle-reed.mp3', import.meta.url);
  }

  async unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.reed) return;
    const response = await fetch(this.url);
    if (!response.ok) throw new Error('Swazzle reed did not load.');
    this.reed = await this.context.decodeAudioData(await response.arrayBuffer());
  }

  stop() {
    for (const source of this.sources) try { source.stop(); } catch { /* already ended */ }
    this.sources = [];
  }

  speak(text) {
    const beats = planSwazzle(text);
    const duration = beats.reduce((sum, beat) => sum + beat.duration + beat.gap, 0) || 0.6;
    if (!this.context || !this.reed) return duration;
    this.stop();
    let time = this.context.currentTime + 0.04;
    for (const beat of beats) {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = this.reed;
      source.loop = true;
      source.playbackRate.value = 2 ** (beat.semitones / 12);
      const level = GAIN * beat.strength;
      const attack = Math.min(0.012, beat.duration / 3);
      const release = Math.min(0.016, beat.duration / 3);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(level, time + attack);
      if (beat.duration > attack + release) gain.gain.setValueAtTime(level, time + beat.duration - release);
      gain.gain.linearRampToValueAtTime(0, time + beat.duration);
      source.connect(gain).connect(this.context.destination);
      source.start(time);
      source.stop(time + beat.duration + 0.02);
      this.sources.push(source);
      time += beat.duration + beat.gap;
    }
    return duration;
  }
}
