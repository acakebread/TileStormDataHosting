// Copyright 2026 massivehadron.com ltd.

import {loadCatalogue} from './catalogue.js';
import {createChat, createMail} from './messages.js?v=mail-layout';
import {createPhotos, createBank, createLove, createMarket, createStore} from './apps.js?v=creator-access-2';
import {createScratch, createFruit} from './games.js';
import {hasOnlyBotsAccess, hasPremiumAccess} from './premium.js?v=creator-access-2';
import {linkPurchaseProfile, purchaseStatus, refreshPurchases} from './purchases.js?v=linked-purchases';
import {createHomePager} from './home.js?v=onlybots-shop';
import {element, button, image, shortTime, loadSetting, saveSetting} from './ui.js';

const pages = [
  ['store', 'photos', 'scratch', 'fruit', 'bank', 'mail', 'chat', 'instabot'],
  ['love', 'onlybots', 'market', 'botflix']
];
const apps = {
  store: {name: 'BotStore', art: './art/store.png', mount: createStore},
  photos: {name: 'Photos', needsContent: true, mount: createPhotos},
  scratch: {name: 'Scratch Bling', art: './art/scratch.png', needsContent: true, mount: createScratch},
  fruit: {name: 'Fruit Burst', art: './art/fruit.png', mount: createFruit},
  bank: {name: 'Droid Bank', art: './art/bank.png', needsContent: true, mount: createBank},
  mail: {name: 'BotMail', art: './art/mail.png', needsContent: true, mount: createMail},
  chat: {name: 'BotsUp', art: './art/chat.png', needsContent: true, mount: createChat},
  instabot: {name: 'Instabot', art: '../instabot-preview-d31b7e4c/icon.png',
    frame: '../instabot-preview-d31b7e4c/?tablet=1'},
  love: {name: 'LoveBot', art: './art/love.png', needsContent: true, mount: createLove},
  onlybots: {name: 'OnlyBots', art: '../onlybots-preview-8c7e4f2a/icon.jpg',
    frame: '../onlybots-preview-8c7e4f2a/?tablet=1&v=creator-access-2'},
  market: {name: 'eBot', art: './art/market.jpg', needsContent: true, mount: createMarket},
  botflix: {name: 'BOTFLIX', art: './art/botflix.png'},
  snapbot: {name: 'SnapBot', art: './art/snapbot.jpg'},
  update: {name: 'Software update'}
};

const ui = Object.fromEntries([
  'display', 'home', 'home-pages', 'page-dots', 'loading', 'loading-status', 'retry', 'clock', 'app-name', 'tip-status',
  'home-button', 'notification', 'open-notification', 'dismiss-notification', 'toast',
  'prompt', 'prompt-title', 'prompt-text', 'prompt-actions'
].map(id => [id, document.getElementById(id)]));

const mounted = new Map();
const homePager = createHomePager(ui['home-pages'], ui['page-dots'], pages);
let data;
let loading;
let current = 'home';
let onlyBotsInstalled = loadSetting('onlyBotsInstalled', false) === true;
let storeRequest;
let toastTimer;
let notificationTimer;
let notificationAction;

const tablet = {
  apps, open, art, prompt, toast, notify, refreshBadges,
  get data() { return data; },
  get current() { return current; },
  get onlyBotsInstalled() { return onlyBotsInstalled; },
  installOnlyBots(installed) {
    if (installed && !hasOnlyBotsAccess()) return;
    onlyBotsInstalled = installed;
    saveSetting('onlyBotsInstalled', installed);
    if (installed) {
      mount('onlybots');
    } else {
      mounted.get('onlybots')?.view.remove();
      mounted.delete('onlybots');
    }
    if (current === 'home') renderHome();
  },
  takeStoreRequest() {
    const request = storeRequest;
    storeRequest = null;
    return request;
  }
};

function art(id, fallback = '', loading = 'lazy') {
  const app = apps[id];
  const src = id === 'photos' ? data?.photo(data.owner, data.owner?.photos?.[0]?.id) : app?.art;
  if (!src) return element('span', 'icon-art', fallback || (id === 'photos' ? '▧' : '?'));
  const photo = image(src, '', ['botflix', 'snapbot'].includes(id) ? id : '');
  photo.loading = loading;
  return element('span', 'icon-art', element('span', 'icon-image', photo));
}

function renderHome() {
  homePager.render(id => {
    if (id === 'onlybots' && !onlyBotsInstalled) return null;
    const offloaded = id === 'botflix';
    const icon = button('', () => open(id), 'app-icon' + (offloaded ? ' offloaded' : ''));
    const tile = art(id, '', 'eager');
    if (offloaded) {
      const cloud = element('span', 'cloud', '↓');
      cloud.title = 'Offloaded';
      cloud.setAttribute('aria-hidden', 'true');
      tile.append(cloud);
    }
    const badge = element('span', 'badge');
    badge.dataset.badge = id;
    badge.hidden = true;
    tile.append(badge);
    icon.append(tile, element('span', 'icon-label', apps[id].name));
    const locked = id === 'onlybots' && !hasOnlyBotsAccess();
    icon.setAttribute('aria-label', apps[id].name + (offloaded ? ', offloaded' : '') +
      (locked ? ', OnlyBots access required' : ''));
    return icon;
  });
  refreshBadges();
}

function refreshBadges() {
  for (const badge of ui['home-pages'].querySelectorAll('[data-badge]')) {
    const app = mounted.get(badge.dataset.badge);
    const count = app?.unread?.() ?? app?.count ?? 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 3200);
}

function dismissNotification() {
  ui.notification.hidden = true;
  notificationAction = null;
}

function notify(id, message, select) {
  if (current === id) return;
  clearTimeout(notificationTimer);
  notificationAction = () => {
    if (apps[id].frame || apps[id].mount) open(id);
    select?.();
  };
  ui['open-notification'].textContent = apps[id].name + '\n' + message;
  ui.notification.hidden = false;
  notificationTimer = setTimeout(dismissNotification, 5800);
}

function prompt(title, description, controls = [], dismissLabel = controls.length ? 'Cancel' : 'Close') {
  const dialog = ui.prompt;
  if (dialog.open) dialog.close();
  ui['prompt-title'].textContent = title;
  ui['prompt-text'].replaceChildren(description);
  const dismiss = element('button', '', dismissLabel);
  dismiss.value = 'dismiss';
  ui['prompt-actions'].replaceChildren(dismiss, ...controls);
  dialog.showModal();
}

function offerUpdate(release) {
  const version = 'BotOS 9.0.' + release;
  const size = (6.4 + (release - 1) * .3).toFixed(1) + ' GB';

  function install() {
    const progress = element('progress');
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute('aria-label', 'Update progress');
    prompt('Installing ' + version, element('div', '', element('p', '', 'Preparing update…'), progress));
    const started = performance.now();
    function advance(now) {
      if (!progress.isConnected || !ui.prompt.open) return;
      progress.value = Math.min(37, (now - started) / 2600 * 37);
      if (progress.value < 37) {
        requestAnimationFrame(advance);
        return;
      }
      const free = Math.max(1, (onlyBotsInstalled ? 8 : 12) - (release - 1));
      prompt('Not Enough Memory', version + ' needs ' + size + '. This tablet has ' + free + ' MB free.',
        [button('Try again', install, 'primary')], 'OK');
    }
    requestAnimationFrame(advance);
  }

  prompt(version, 'This update includes important security fixes, performance improvements and several exciting new bugs.\n\nDownload size: ' + size,
    [button('Install now', install, 'primary')], 'Later');
}

let updateRelease = 0;
function announceUpdate() {
  if (!ui.prompt.open && ui.notification.hidden) {
    const release = ++updateRelease;
    notify('update', 'BotOS 9.0.' + release + ' is available', () => offerUpdate(release));
  }
  setTimeout(announceUpdate, (150 + Math.random() * 150) * 1000);
}

function mount(id) {
  if (mounted.has(id)) return mounted.get(id);
  const config = apps[id];
  let instance;
  if (config.frame) {
    const frame = element('iframe', 'app-frame');
    frame.title = config.name;
    frame.src = config.frame;
    frame.allow = 'web-share';
    function visible(active) {
      const onlyBotsAccess = id === 'onlybots' && onlyBotsInstalled && hasOnlyBotsAccess();
      const premium = onlyBotsAccess && hasPremiumAccess();
      frame.contentWindow?.postMessage({type: 'eggbot-tablet-visibility', active, onlyBotsAccess, premium}, location.origin);
    }
    instance = {view: frame, count: 0, open() {
      instance.count = 0;
      visible(true);
    }, close() { visible(false); }};
    frame.addEventListener('load', () => visible(current === id));
  } else {
    instance = config.mount(tablet);
    instance.view.classList.add('app-view');
  }
  instance.view.hidden = true;
  ui.display.append(instance.view);
  mounted.set(id, instance);
  return instance;
}

function showCurrent() {
  ui['app-name'].textContent = apps[current]?.name ?? 'Home';
  ui.home.hidden = current !== 'home';
  for (const [id, app] of mounted) app.view.hidden = id !== current;
  ui.loading.hidden = true;
  if (current === 'home') {
    renderHome();
    return;
  }
  if (apps[current].needsContent && !data) {
    ui.loading.hidden = false;
    return;
  }
  const app = mount(current);
  app.view.hidden = false;
  app.open?.();
}

function open(id, replace = false) {
  if (id === 'botflix' || (id === 'onlybots' && (!onlyBotsInstalled || !hasOnlyBotsAccess()))) {
    storeRequest = id;
    id = 'store';
  }
  if (id !== 'home' && (!Object.hasOwn(apps, id) || (!apps[id].mount && !apps[id].frame))) id = 'home';
  const url = location.pathname + location.search + (id === 'home' ? '' : '#' + id);
  if (location.pathname + location.search + location.hash !== url) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
  if (current !== id) {
    if (current === 'home') homePager.cancelDrag();
    mounted.get(current)?.close?.();
    current = id;
    if (ui.prompt.open) ui.prompt.close();
    dismissNotification();
  }
  showCurrent();
}

function handleLocation() {
  const profile = new URLSearchParams(location.hash.slice(1)).get('purchase-profile');
  if (profile !== null) {
    history.replaceState(null, '', location.pathname + location.search);
    linkPurchaseProfile(profile);
  }
  const id = location.hash.slice(1) || 'home';
  if (id !== current) open(id, true);
  return profile !== null;
}

async function startContent() {
  if (loading) return;
  loading = true;
  ui['loading-status'].textContent = 'Loading Eggbot’s content…';
  ui.retry.hidden = true;
  try {
    data = await loadCatalogue();
    const wallpaper = data.photo(data.owner, data.owner?.photos?.[0]?.id);
    if (wallpaper) ui.home.style.setProperty('--wallpaper', 'url("' + wallpaper + '")');
    mount('mail');
    mount('chat');
    mount('instabot');
    if (apps[current]?.needsContent || current === 'home') showCurrent();
  } catch {
    ui['loading-status'].textContent = 'Eggbot’s content is unavailable.';
    ui.retry.hidden = false;
  } finally {
    loading = false;
  }
}

ui.retry.addEventListener('click', startContent);
ui['home-button'].addEventListener('click', () => {
  if (current === 'home') homePager.goTo(0);
  else open('home');
});
ui['open-notification'].addEventListener('click', () => {
  const action = notificationAction;
  dismissNotification();
  action?.();
});
ui['dismiss-notification'].addEventListener('click', dismissNotification);
document.addEventListener('keydown', event => {
  if (current !== 'home' || ui.prompt.open || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  homePager.step(event.key === 'ArrowRight' ? 1 : -1);
});
window.addEventListener('popstate', handleLocation);
window.addEventListener('hashchange', handleLocation);
window.addEventListener('message', event => {
  const instabot = mounted.get('instabot');
  if (!instabot || event.origin !== location.origin || event.source !== instabot.view.contentWindow ||
      event.data?.type !== 'eggbot-tablet-activity') return;
  instabot.count = current === 'instabot' ? 0 : Math.max(0, Number(event.data.count) || 0);
  refreshBadges();
  if (typeof event.data.message === 'string') notify('instabot', event.data.message);
});

function tick() {
  const now = Date.now();
  ui.clock.textContent = shortTime.format(now);
  mounted.get(current)?.tick?.(now);
}

function renderTipStatus() {
  const tipped = purchaseStatus('dollar_tip');
  ui['tip-status'].textContent = tipped === undefined ? '' : tipped ? 'Tip given' : 'No tip';
}

window.addEventListener('tilestorm-purchases-changed', renderTipStatus);
showCurrent();
if (!handleLocation()) refreshPurchases();
renderTipStatus();
if (onlyBotsInstalled && hasOnlyBotsAccess()) mount('onlybots');
tick();
setInterval(tick, 1000);
setTimeout(announceUpdate, 50000);
startContent();
