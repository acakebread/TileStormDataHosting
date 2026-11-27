// Copyright 2026 massivehadron.com ltd.

// Shared high score records for the tablet games. The name on a score is the player
// profile moniker. Nickname, handle and alias are that same string.

import {button, element, loadSetting, saveSetting} from './ui.js';
import {purchaseProfileKey} from './purchases.js?v=high-scores';

const root = 'https://tilestorm-high-scores.qrh.workers.dev';
const games = {
  'electric-ambulance': 'Electric Ambulance',
  'turtle-time': 'Turtle Time',
  'fruit-burst': 'Fruit Burst'
};
const monikerSetting = 'playerMoniker';
const revisionSetting = 'playerProfileRevision';
const encoder = new TextEncoder();

export function gameTitle(game) {
  return games[game] || 'High scores';
}

export function playerMoniker() {
  const stored = loadSetting(monikerSetting, '');
  return typeof stored === 'string' ? collapse(stored.trim()) : '';
}

export function savePlayerMoniker(value) {
  const moniker = acceptMoniker(value);
  if (!moniker) return '';
  saveSetting(monikerSetting, moniker);
  return moniker;
}

export function acceptMoniker(value) {
  const moniker = collapse(String(value ?? '').trim());
  if (!moniker || moniker.length > 48 || [...moniker].some(character => character < ' ' || character === '\u007f')) return '';
  return moniker;
}

export async function playerId() {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(purchaseProfileKey()));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function publicLabel(id, moniker = playerMoniker()) {
  return moniker || id.slice(0, 12);
}

export function registerEmailHref() {
  return '../membership.html#purchase-profile=' + purchaseProfileKey();
}

export async function submitScore(game, score, {setMoniker = false, moniker = playerMoniker()} = {}) {
  if (!games[game]) throw new Error('This game is not registered with the high score table.');
  const body = {key: purchaseProfileKey(), game, score};
  if (setMoniker && moniker) body.moniker = moniker;
  return post('/api/scores', body);
}

export function profileRevision() {
  const stored = Number(loadSetting(revisionSetting, 0));
  return Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
}

function rememberProfile(reply) {
  if (!reply) return reply;
  saveSetting(revisionSetting, reply.revision || 0);
  if (typeof reply.moniker === 'string') saveSetting(monikerSetting, reply.moniker);
  if (typeof reply.displayName === 'string') saveSetting('playerDisplayName', reply.displayName);
  return reply;
}

export async function loadPlayerProfile() {
  return rememberProfile(await post('/api/profile', {key: purchaseProfileKey(), baseRevision: profileRevision()}));
}

export async function savePlayerProfile({moniker, displayName} = {}) {
  await loadPlayerProfile();
  const body = {key: purchaseProfileKey(), baseRevision: profileRevision()};
  if (moniker) body.moniker = moniker;
  if (displayName !== undefined) body.displayName = displayName;
  return rememberProfile(await post('/api/profile', body));
}

export async function deletePlayerProfile() {
  const reply = await post('/api/profile/delete', {key: purchaseProfileKey()});
  saveSetting(monikerSetting, '');
  saveSetting('playerDisplayName', '');
  saveSetting(revisionSetting, 0);
  return reply;
}

export async function publishMoniker(moniker = playerMoniker()) {
  return savePlayerProfile({moniker});
}

export async function listScores(game) {
  const response = await fetch(`${root}/api/scores?game=${encodeURIComponent(game)}`, {signal: AbortSignal.timeout(20000)});
  const reply = await read(response);
  if (!response.ok || !reply) throw new Error(reply?.message || 'The high score table could not be reached.');
  return reply;
}

export function showNicknamePrompt(parent, {playerLabel, onSave, onCancel}) {
  const layer = openLayer(parent);
  const error = element('p', 'high-scores-error');
  const input = element('input', 'high-scores-name');
  input.maxLength = 48;
  input.placeholder = 'Nickname';
  input.autocomplete = 'nickname';
  input.setAttribute('aria-label', 'Nickname');
  const save = element('button', 'primary', 'Save nickname');
  save.type = 'submit';
  const form = element('form', 'high-scores-card',
    element('h2', '', 'New high score'),
    element('p', '', 'Add a nickname to your player profile for the high score table. Register with Massive Hadron if you have not already. Cancel places this score under your player id.'),
    element('p', 'high-scores-id', 'Player id ' + playerLabel),
    input, error, save,
    element('div', 'high-scores-actions',
      button('Register email', () => { window.open(registerEmailHref(), '_blank', 'noopener'); }, ''),
      button('Cancel', () => { layer.remove(); onCancel(); })));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const moniker = acceptMoniker(input.value);
    if (!moniker) {
      error.textContent = 'Enter a nickname of up to 48 characters.';
      return;
    }
    layer.remove();
    onSave(moniker);
  });
  layer.append(form);
  input.focus();
  return () => layer.remove();
}

export function showScoreBoard(parent, game) {
  const layer = openLayer(parent);
  const title = element('h2', '', gameTitle(game));
  const status = element('p', 'high-scores-status', 'Loading high scores…');
  const list = element('ol', 'high-scores-list');
  layer.append(element('section', 'high-scores-card', title, status, list, button('Close', () => layer.remove(), 'primary')));
  listScores(game).then(async table => {
    if (!layer.isConnected) return;
    title.textContent = table.title || title.textContent;
    if (!table.rows?.length) {
      status.textContent = 'No scores yet.';
      return;
    }
    status.hidden = true;
    const mine = await playerId();
    for (const row of table.rows) {
      const item = element('li', row.playerId === mine ? 'mine' : '',
        element('span', '', String(row.rank)),
        element('span', '', row.label),
        element('span', '', Number(row.score).toLocaleString('en-GB')));
      list.append(item);
    }
  }).catch(() => {
    if (layer.isConnected) status.textContent = 'The high score table could not be reached.';
  });
  return () => layer.remove();
}

function openLayer(parent) {
  parent.querySelector('.high-scores')?.remove();
  const layer = element('div', 'high-scores');
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  parent.append(layer);
  return layer;
}

async function post(path, body) {
  const response = await fetch(root + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const reply = await read(response);
  if (!response.ok || !reply) throw new Error(reply?.message || 'The high score table could not be reached.');
  return reply;
}

async function read(response) {
  try { return await response.json(); }
  catch { return null; }
}

function collapse(value) {
  return value.replace(/ +/g, ' ');
}
