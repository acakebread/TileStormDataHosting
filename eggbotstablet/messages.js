// Copyright 2026 massivehadron.com ltd.

import {shuffle} from '../tablet-preview/shared.js';
import {button, element, shortTime, weighted} from './ui.js';

function splitView(name) {
  const items = element('div');
  const list = element('aside', 'split-list', element('h2', '', name), items);
  const detail = element('section', 'split-detail');
  const layout = element('div', 'split-view', list, detail);
  const view = element('section', '', layout);
  return {view, layout, items, detail};
}

function listRow(name, preview, active, unread, choose, avatar) {
  const row = button('', choose, 'row-button');
  const copy = element('span', 'row-copy', element('strong', '', name), element('small', 'excerpt', preview));
  row.append(...[avatar, copy, unread ? element('span', 'count', String(unread)) : null].filter(Boolean));
  row.setAttribute('aria-pressed', String(active));
  return row;
}

function empty(detail, text) {
  detail.replaceChildren(element('p', 'detail-empty', text));
}

function repeatAfter(action, first, min, max) {
  function deliver() {
    action();
    setTimeout(deliver, (min + Math.random() * (max - min)) * 1000);
  }
  setTimeout(deliver, first * 1000);
}

export function createChat(tablet) {
  const {data} = tablet;
  const {view, layout, items, detail} = splitView('BotsUp');
  const contacts = data.profiles.filter(profile => profile.botsUp?.enabled).map(profile => [profile.botsUp, profile]);
  const groups = (data.tablet.groups ?? []).filter(group => group.enabled).map(group => [group, null]);
  const started = Date.now();
  const threads = [...contacts, ...groups].map(([source, profile]) => {
    const name = profile?.displayName ?? source.name ?? 'Chat';
    const offset = Math.floor(Math.random() * 180);
    const messages = (source.history ?? []).filter(line => line.text).map(line => ({
      ...line, sender: line.mine || line.notice ? '' : data.name(line.sender || name),
      when: started - ((line.minutesAgo ?? 0) + offset) * 60000, seen: true
    }));
    const beats = [];
    let incoming = [];
    for (const line of source.dialogue ?? []) {
      if (!line.trim()) continue;
      if (line.startsWith('> ')) {
        if (incoming.length) beats.push({incoming, reply: line.slice(2)});
        incoming = [];
      } else incoming.push(line);
    }
    return {source, profile, name, messages, beats, beat: 0, arrival: 0, reply: 0,
      unread: messages.filter(line => line.unread).length, opened: false, waiting: false, typing: false};
  });
  let selected;
  let lastDelivery;
  const scroll = element('div', 'messages');
  const status = element('small', '', '');
  const draftText = element('p', 'muted');
  const send = button('Send', sendReply, 'primary');
  const compose = element('div', 'compose', draftText, send);

  function avatar(thread) {
    return data.avatar(thread.profile, thread.name, thread.source.colour);
  }

  function unread() {
    return threads.reduce((count, thread) => count + thread.unread, 0);
  }

  function pendingLine(thread) {
    for (let index = thread.messages.length - 1; index >= 0; index--) {
      const message = thread.messages[index];
      if (message.mine) break;
      if (!message.notice && !message.nudge) return message;
    }
  }

  function draft(thread) {
    const pending = pendingLine(thread);
    const replies = thread.source.replies ?? [];
    return pending ? pending.reply || (replies.length ? replies[thread.reply % replies.length] : '') : '';
  }

  function renderList() {
    const sorted = [...threads].sort((a, b) => (b.messages.at(-1)?.when ?? 0) - (a.messages.at(-1)?.when ?? 0));
    items.replaceChildren(...sorted.map(thread => listRow(thread.name, thread.messages.at(-1)?.text,
      selected === thread, thread.unread, () => show(thread), avatar(thread))));
    tablet.refreshBadges();
  }

  function info() {
    const {name, source, profile} = selected;
    const contact = element('div', 'contact-card', avatar(selected),
      element('p', '', [source.number, source.about, source.location || profile?.location || source.status].filter(Boolean).join('\n')));
    tablet.prompt(name, contact);
  }

  function hideDetail() {
    selected = null;
    layout.classList.remove('has-detail');
    empty(detail, 'Choose a conversation.');
    renderList();
  }

  function show(thread) {
    selected = thread;
    thread.opened = true;
    thread.unread = 0;
    layout.classList.add('has-detail');
    const contact = button('', info, 'contact');
    contact.append(avatar(thread), element('span', '', element('strong', '', thread.name), status));
    contact.title = 'Contact info';
    const back = button('Chats', hideDetail, 'back');
    detail.replaceChildren(element('header', 'detail-head', back, contact), scroll, compose);
    renderMessages(true);
    renderList();
  }

  function renderMessages(follow = false) {
    const thread = selected;
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 75;
    status.textContent = thread.typing ? 'typing…' : thread.source.status || 'Tap for contact info';
    scroll.replaceChildren(...thread.messages.map(line => {
      const note = element('div', 'message' + (line.mine ? ' mine' : line.notice ? ' notice' : ''));
      if (thread.source.group && line.sender) note.append(element('strong', 'sender', line.sender));
      note.append(line.text);
      if (!line.notice) note.append(element('small', line.mine && line.seen ? 'seen' : '',
        shortTime.format(line.when) + (line.mine ? (line.seen ? ' ✓✓' : ' ✓') : '')));
      return note;
    }));
    if (follow || nearBottom) scroll.scrollTop = scroll.scrollHeight;
    const reply = draft(thread);
    draftText.textContent = reply || 'Waiting for a message…';
    send.disabled = !reply;
  }

  function append(thread, lines) {
    thread.messages.push(...lines);
    const pending = pendingLine(thread);
    let unanswered = 0;
    for (let index = thread.messages.length - 1; index >= 0 && !thread.messages[index].mine; index--) {
      const line = thread.messages[index];
      if (!line.notice && ++unanswered > 4 && line !== pending) thread.messages.splice(index, 1);
    }
    if (thread.messages.length > 32) thread.messages.splice(0, thread.messages.length - 32);
    if (thread === selected && tablet.current === 'chat') {
      thread.unread = 0;
      renderMessages();
    } else thread.unread = Math.min(4, thread.unread + lines.filter(line => !line.mine).length);
    renderList();
  }

  function arrival(thread, answer) {
    if (answer && thread.beats.length) {
      const beat = thread.beats[thread.beat++ % thread.beats.length];
      return beat.incoming.map((text, index) => ({
        text, sender: thread.name, when: Date.now(), reply: index === beat.incoming.length - 1 ? beat.reply : ''
      }));
    }
    const arrivals = thread.source.arrivals ?? [];
    if (!arrivals.length) return [];
    const line = arrivals[thread.arrival++ % arrivals.length];
    return [{...line, sender: data.name(line.sender || thread.name), when: Date.now(),
      nudge: thread.beats.length > 0 && !answer && Boolean(draft(thread))}];
  }

  function sendReply() {
    const thread = selected;
    const text = draft(thread);
    if (!text) return;
    const sent = {text, mine: true, seen: false, when: Date.now()};
    thread.reply++;
    thread.waiting = true;
    append(thread, [sent]);
    renderMessages(true);
    setTimeout(() => {
      sent.seen = true;
      if (selected === thread && tablet.current === 'chat') renderMessages();
    }, 650);
    setTimeout(() => {
      thread.typing = Boolean(thread.beats.length || thread.source.arrivals?.length);
      if (selected === thread && tablet.current === 'chat') renderMessages();
    }, 1700);
    setTimeout(() => {
      thread.typing = false;
      thread.waiting = false;
      const lines = arrival(thread, true);
      if (lines.length) append(thread, lines);
      if (selected === thread && tablet.current === 'chat') renderMessages(true);
    }, 4400);
  }

  function deliver() {
    let candidates = threads.filter(thread => !thread.waiting && (thread.source.arrivalWeight ?? 1) > 0 &&
      (thread.opened ? thread.source.arrivals?.length : thread.messages.some(line => !line.mine && !line.notice)));
    if (candidates.length > 1) candidates = candidates.filter(thread => thread !== lastDelivery);
    const thread = weighted(candidates, item => item.source.arrivalWeight ?? 1);
    if (!thread) return;
    lastDelivery = thread;
    let latest;
    if (thread.opened) {
      const lines = arrival(thread, Boolean(thread.messages.at(-1)?.mine && thread.beats.length));
      if (!lines.length) return;
      latest = lines.at(-1);
      append(thread, lines);
    } else {
      latest = thread.messages.findLast(line => !line.mine && !line.notice);
      thread.unread = Math.max(1, thread.unread);
      renderList();
    }
    tablet.notify('chat', thread.name + ' · ' + latest.text, () => show(thread));
  }

  empty(detail, 'Choose a conversation.');
  renderList();
  repeatAfter(deliver, 20, 35, 70);
  return {view, unread, open() { if (selected) show(selected); else renderList(); }};
}

const folders = new Map([['Inbox', ''], ['Ugh, Work', 'Work'], ['Money Trouble', 'Bank'],
  ['Love, Maybe', 'Love'], ['Suspicious', 'Spam']]);

export function createMail(tablet) {
  const {data} = tablet;
  const unreadStatus = element('span', 'muted');
  const header = element('header', 'mail-header', tablet.art('mail'), element('h2', '', 'BotMail'), unreadStatus);
  const folderHeading = element('h3', '', 'Inbox');
  folderHeading.tabIndex = -1;
  const items = element('div', 'mail-messages');
  const filters = element('nav', 'mail-filters');
  filters.setAttribute('aria-label', 'Mail filters');
  const list = element('section', 'mail-list',
    element('header', 'mail-list-header', folderHeading, button('Filters', showFilters, 'mail-pane-nav')), items);
  const detail = element('section', 'mail-preview');
  detail.setAttribute('aria-label', 'Selected email');
  const layout = element('div', 'mail-columns', filters, list, detail);
  const view = element('section', 'mail-app', header, layout);
  const filterButtons = new Map([...folders].map(([label, kind]) => {
    const count = element('span', 'mail-filter-count');
    const control = button('', () => chooseFolder(label), 'mail-filter');
    control.append(element('span', '', label), count);
    return [label, {control, count, kind}];
  }));
  filters.append(
    button('Back to messages', showList, 'mail-pane-nav'),
    ...Array.from(filterButtons.values(), entry => entry.control)
  );
  const profiles = data.profiles.filter(profile => profile.botMail?.enabled);
  function authored(field, global) {
    return [...(data.tablet[global] ?? []), ...profiles.flatMap(profile => (profile.botMail[field] ?? []).map(letter => ({
      senderName: profile.botMail.senderName || profile.displayName, address: profile.botMail.address,
      signature: profile.botMail.signature, ...letter
    })))];
  }

  const started = Date.now();
  const messages = authored('messages', 'mail').map(letter => ({
    ...letter, when: started - (letter.minutesAgo ?? 0) * 60000
  })).sort((a, b) => b.when - a.when);
  const updates = authored('updates', 'mailUpdates');
  let deck = [];
  let folder = 'Inbox';
  let selected;
  let listScroll = 0;
  items.addEventListener('scroll', () => {
    if (items.clientHeight) listScroll = items.scrollTop;
  }, {passive: true});

  function unread() {
    return messages.filter(letter => letter.unread).length;
  }

  function renderList() {
    const kind = folders.get(folder);
    const total = unread();
    unreadStatus.textContent = total ? total + ' unread' : 'All read';
    folderHeading.textContent = folder;
    for (const [label, entry] of filterButtons) {
      const count = entry.kind ? messages.filter(letter => letter.unread && letter.kind === entry.kind).length : total;
      entry.count.textContent = count ? String(count) : '';
      entry.control.setAttribute('aria-pressed', String(folder === label));
      entry.control.setAttribute('aria-label', label + (count ? ', ' + count + ' unread' : ''));
    }
    const rows = messages.filter(letter => !kind || letter.kind === kind).map(letter =>
      listRow(letter.senderName || 'Unknown sender', letter.subject, selected === letter, letter.unread ? '●' : '',
        () => show(letter, true)));
    items.replaceChildren(...(rows.length ? rows : [element('p', 'mail-body muted', 'This folder is empty.')]));
    if (items.clientHeight) items.scrollTop = listScroll;
    tablet.refreshBadges();
  }

  function hideDetail() {
    selected = null;
    layout.dataset.pane = 'list';
    empty(detail, 'Choose a message.');
    renderList();
  }

  function showList() {
    hideDetail();
    folderHeading.focus({preventScroll: true});
  }

  function showFilters() {
    layout.dataset.pane = 'filters';
    filterButtons.get(folder).control.focus({preventScroll: true});
  }

  function chooseFolder(label) {
    if (folder !== label) listScroll = 0;
    folder = label;
    hideDetail();
    if (!filterButtons.get(label).control.getClientRects().length) folderHeading.focus({preventScroll: true});
  }

  function show(letter, moveFocus = false) {
    if (folders.get(folder) && folders.get(folder) !== letter.kind) {
      folder = 'Inbox';
      listScroll = 0;
    }
    selected = letter;
    letter.unread = false;
    layout.dataset.pane = 'detail';
    const text = element('p');
    for (const token of (letter.body || '').split(/(\[[^\]\n]+\])/)) {
      text.append(token.startsWith('[') && token.endsWith(']') ?
        button(token.slice(1, -1), () => tablet.toast('This link couldn’t load.'), 'link-button') : token);
    }
    const attachments = element('div', 'actions', ...(letter.attachments ?? []).map(file => {
      const control = button(file.name + ' · ' + file.size, () => {
        control.disabled = true;
        control.textContent = 'Downloading ' + file.name + '…';
        letter.downloading ??= new Set();
        letter.downloading.add(file);
      });
      if (letter.downloading?.has(file)) {
        control.disabled = true;
        control.textContent = 'Downloading ' + file.name + '…';
      }
      return control;
    }));
    const trash = button('Move to bin', () => {
      messages.splice(messages.indexOf(letter), 1);
      showList();
    }, 'danger');
    const subject = element('h3', '', letter.subject);
    subject.tabIndex = -1;
    const sentAt = new Date(letter.when);
    const date = element('time', 'muted', sentAt.toLocaleString('en-GB', {dateStyle: 'medium', timeStyle: 'short'}));
    date.dateTime = sentAt.toISOString();
    detail.replaceChildren(
      element('header', 'mail-preview-header', button('Back to messages', showList, 'mail-pane-nav'),
        element('div', 'mail-subject', subject, trash),
        element('div', 'mail-from', element('strong', '', letter.senderName || 'Unknown sender'), date),
        letter.address ? element('p', 'muted mail-address', letter.address) : null),
      element('article', 'mail-body', text,
        letter.signature ? element('p', 'muted', letter.signature) : null, attachments));
    renderList();
    if (moveFocus) subject.focus({preventScroll: true});
  }

  function deliver() {
    if (!updates.length) return;
    if (!deck.length) deck = shuffle(updates);
    const letter = {...deck.pop(), unread: true, when: Date.now()};
    messages.unshift(letter);
    renderList();
    tablet.notify('mail', letter.senderName + ' · ' + letter.subject, () => show(letter, true));
  }

  hideDetail();
  repeatAfter(deliver, 12, 40, 80);
  return {view, unread, open() { if (selected) show(selected); else renderList(); }};
}
