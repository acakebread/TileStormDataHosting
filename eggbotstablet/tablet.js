// Copyright 2026 massivehadron.com ltd.

import {loadCatalogue} from './catalogue.js';
import {createChat, createMail} from './messages.js?v=mail-layout';
import {createPhotos, createBank, createLove, createMarket, createStore} from './apps.js?v=electric-ambulance';
import {createFirebot} from './firebot.js?v=hosted';
import {createFruit} from './fruit-burst.js?v=unity';
import {createTurtleTime} from './turtle-time.js?v=profile-sync';
import {hasOnlyBotsAccess, hasPremiumAccess} from './premium.js?v=stripe-onlybots';
import {linkPurchaseProfile, linkWebGLProfiles, syncPurchases} from './purchases.js?v=high-scores';
import {createHomePager} from './home.js?v=onlybots-shop';
import {loadPlayerProfile} from './high-scores.js?v=profile-sync';
import {createSettings, createTabletPreferences, offloadSizeMb, osVersion} from './settings.js?v=player-profile';
import {element, button, image, shortTime, loadSetting, saveSetting} from './ui.js';

const pages = [
  ['settings', 'store', 'photos', 'fruit', 'bank', 'mail', 'chat', 'instabot'],
  ['scratch', 'love', 'onlybots', 'market', 'botflix', 'firebot', 'turtletime', 'scratchpro'],
  ['electricambulance']
];
const apps = {
  settings: {name: 'Settings', art: './art/settings.png', mount: createSettings},
  store: {name: 'BotStore', art: './art/store.png', mount: createStore},
  photos: {name: 'Photos', needsContent: true, mount: createPhotos},
  scratch: {name: 'Scratch Bling', art: './art/scratch.png', mount: mountScratchBling},
  scratchpro: {name: 'Scratch Pro', downloadMb: 2, mount: mountScratchPro,
    art: 'https://eggbot-content.qrh.workers.dev/media/0925f4b1259091edb6ce5669df6cd480cda2a91c44f97175ec76d3f6f68f64ec.png'},
  fruit: {name: 'Fruit Burst', art: './art/fruit.png', mount: createFruit},
  bank: {name: 'Droid Bank', art: './art/bank.png', needsContent: true, mount: createBank},
  mail: {name: 'BotMail', art: './art/mail.png', needsContent: true, mount: createMail},
  chat: {name: 'BotsUp', art: './art/chat.png', needsContent: true, mount: createChat},
  instabot: {name: 'Instabot', art: '../instabot-preview-d31b7e4c/icon.png',
    frame: '../instabot-preview-d31b7e4c/?tablet=1'},
  love: {name: 'LoveBot', art: './art/love.png', needsContent: true, mount: createLove},
  onlybots: {name: 'OnlyBots', art: '../onlybots-preview-8c7e4f2a/icon.jpg',
    frame: '../onlybots-preview-8c7e4f2a/?tablet=1&v=stripe-onlybots'},
  market: {name: 'eBot', art: './art/market.jpg', needsContent: true, mount: createMarket},
  botflix: {name: 'BOTFLIX', art: './art/botflix.png'},
  firebot: {name: 'Firebot', art: './art/firebot.jpg', downloadMb: 2, needsContent: true, mount: createFirebot},
  turtletime: {name: 'Turtle Time', art: './art/turtle-time.png', downloadMb: 2, mount: createTurtleTime},
  electricambulance: {name: 'Electric Ambulance', art: './electric-ambulance/icon.png', mount: mountElectricAmbulance},
  snapbot: {name: 'SnapBot', art: './art/snapbot.jpg'},
  update: {name: 'Software update'}
};

const ui = Object.fromEntries([
  'display', 'home', 'home-pages', 'page-dots', 'loading', 'loading-status', 'retry', 'clock', 'app-name',
  'home-button', 'notification', 'open-notification', 'dismiss-notification', 'toast',
  'prompt', 'prompt-title', 'prompt-text', 'prompt-actions'
].map(id => [id, document.getElementById(id)]));

const mounted = new Map();
const homePager = createHomePager(ui['home-pages'], ui['page-dots'], pages);
const preferences = createTabletPreferences();
const playChime = createNotificationChime();
let data;
let loading;
let current = 'home';
let onlyBotsInstalled = loadSetting('onlyBotsInstalled', false) === true;
let firebotInstalled = loadSetting('firebotInstalled', false) === true;
const gameInstallKeys = {turtletime: 'turtleTimeInstalled', scratchpro: 'scratchProInstalled'};
const gameInstalls = Object.fromEntries(Object.entries(gameInstallKeys).map(([id, key]) => [id, loadSetting(key, false) === true]));
let storeRequest;
let toastTimer;
let notificationTimer;
let notificationAction;

const tablet = {
  apps, preferences, open, art, prompt, toast, notify, dismissNotification, refreshBadges,
  get data() { return data; },
  get current() { return current; },
  get onlyBotsInstalled() { return onlyBotsInstalled; },
  get firebotInstalled() { return firebotInstalled; },
  gameInstalled(id) { return gameInstalls[id] === true; },
  get freeSpaceMb() {
    return 12 - (onlyBotsInstalled ? 4 : 0) - (firebotInstalled ? apps.firebot.downloadMb : 0) +
      (preferences.contentOffloaded ? offloadSizeMb : 0) -
      Object.keys(gameInstalls).reduce((total, id) => total + (gameInstalls[id] ? apps[id].downloadMb : 0), 0);
  },
  installFirebot() {
    firebotInstalled = true;
    saveSetting('firebotInstalled', true);
  },
  installGame(id, installed) {
    if (!Object.hasOwn(gameInstalls, id)) return false;
    if (installed === gameInstalls[id]) return true;
    if (installed && tablet.freeSpaceMb < apps[id].downloadMb) return false;
    gameInstalls[id] = installed;
    saveSetting(gameInstallKeys[id], installed);
    if (!installed) {
      if (current === id) open('home');
      mounted.get(id)?.view.remove();
      mounted.delete(id);
    }
    if (current === 'home') renderHome();
    return true;
  },
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
  openStoreListing(id) {
    storeRequest = id;
    open('store');
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
  const photo = image(src, '', ['botflix', 'snapbot', 'settings'].includes(id) ? id : '');
  photo.loading = loading;
  return element('span', 'icon-art', element('span', 'icon-image', photo));
}

function renderHome() {
  homePager.render(id => {
    if (id === 'onlybots' && !onlyBotsInstalled) return null;
    if (Object.hasOwn(gameInstalls, id) && !gameInstalls[id]) return null;
    const offloaded = id === 'botflix' || (id === 'firebot' && !firebotInstalled);
    const icon = button('', () => open(id), 'app-icon' + (offloaded ? ' offloaded' : ''));
    const tile = art(id, '', 'eager');
    if (offloaded) {
      const cloud = element('span', 'cloud', '↓');
      cloud.title = id === 'firebot' ? 'Free download' : 'Offloaded';
      cloud.setAttribute('aria-hidden', 'true');
      tile.append(cloud);
    }
    const badge = element('span', 'badge');
    badge.dataset.badge = id;
    badge.hidden = true;
    tile.append(badge);
    icon.append(tile, element('span', 'icon-label', apps[id].name));
    const locked = id === 'onlybots' && !hasOnlyBotsAccess();
    const download = id === 'firebot' ? ', free download' : ', offloaded';
    icon.setAttribute('aria-label', apps[id].name + (offloaded ? download : '') +
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
  clearTimeout(notificationTimer);
  ui.notification.hidden = true;
  notificationAction = null;
}

function createNotificationChime() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return () => {};
  let audio, clip, output;

  document.addEventListener('click', () => {
    if (!audio) {
      try { audio = new Audio(); }
      catch { return; }
      output = audio.createGain();
      output.gain.value = .7;
      output.connect(audio.destination);
      fetch(new URL('./art/notification.wav', import.meta.url))
        .then(response => response.ok ? response.arrayBuffer() : null)
        .then(bytes => bytes && audio.decodeAudioData(bytes))
        .then(decoded => { clip = decoded; })
        .catch(() => {});
    }
    if (audio.state !== 'running') audio.resume().catch(() => {});
  }, {capture: true});

  return () => {
    if (audio?.state !== 'running' || !clip) return;
    const source = audio.createBufferSource();
    source.buffer = clip;
    source.connect(output);
    source.start();
  };
}

function notify(id, message, select) {
  if (current === id || preferences.notificationsSuppressed) return;
  clearTimeout(notificationTimer);
  notificationAction = () => {
    if (apps[id].frame || apps[id].mount) open(id);
    select?.();
  };
  ui['open-notification'].textContent = apps[id].name + '\n' + message;
  ui.notification.dataset.position = preferences.bannerPosition;
  ui.notification.hidden = false;
  if (preferences.soundsEnabled) playChime();
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
  const version = 'BotOS ' + osVersion + '.' + release;
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
      const free = tablet.freeSpaceMb;
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
    notify('update', 'BotOS ' + osVersion + '.' + release + ' is available', () => offerUpdate(release));
  }
  setTimeout(announceUpdate, (150 + Math.random() * 150) * 1000);
}

function mountElectricAmbulance() {
  const view = element('section', 'ambulance-app');
  let app;
  let opening;
  function launch() {
    if (app) { app.open(); return; }
    if (opening) return;
    const controller = new AbortController();
    opening = controller;
    view.replaceChildren(element('p', 'ambulance-loading', 'Loading Electric Ambulance…'));
    import('./electric-ambulance/game.js?v=profile-sync').then(({createElectricAmbulance}) => {
      if (controller.signal.aborted) return;
      app = createElectricAmbulance(view);
      app.open();
    }).catch(error => {
      if (controller.signal.aborted) return;
      console.error('Electric Ambulance:', error);
      view.replaceChildren(element('div', 'ambulance-loading', element('p', '', 'Electric Ambulance could not load.'),
        button('Reload tablet', () => location.reload())));
    }).finally(() => { if (opening === controller) opening = undefined; });
  }
  return {view, open: launch, close() {
    opening?.abort();
    opening = undefined;
    app?.close();
    view.replaceChildren();
  }};
}

function mountScratchBling() {
  const view = element('section', 'scratch-bling-app');
  let app, opening, active = false;
  return {view, open() {
    active = true;
    if (app) { app.open(); return; }
    if (opening) return;
    view.replaceChildren(element('p', 'sb-launch', 'Loading Scratch Bling…'));
    opening = import('./scratch-bling.js?v=local-winner-lights').then(({createScratchBling}) => {
      if (!active) return;
      view.replaceChildren();
      app = createScratchBling(view, () => open('home'));
      app.open();
    }).catch(() => {
      if (active) view.replaceChildren(element('div', 'sb-launch', element('p', '', 'Could not open Scratch Bling.'),
        button('Reload tablet', () => location.reload())));
    }).finally(() => { opening = null; });
  }, close() {
    active = false;
    app?.close();
    app = null;
  }};
}

function mountScratchPro() {
  const view = element('section', 'scratch-pro-app');
  let app, opening, active = false;
  return {view, open() {
    active = true;
    if (app) { app.open(); return; }
    if (opening) return;
    view.replaceChildren(element('p', 'sp-launch', 'Loading Scratch Pro…'));
    opening = import('./scratch-pro.js?v=stripe-pro').then(({createScratchPro}) => {
      if (!active) return;
      view.replaceChildren();
      app = createScratchPro(view);
      app.open();
    }).catch(() => {
      if (active) view.replaceChildren(element('div', 'sp-launch', element('p', '', 'Could not open Scratch Pro.'),
        button('Reload tablet', () => location.reload())));
    }).finally(() => { opening = null; });
  }, close() {
    active = false;
    app?.close();
  }};
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
  if (id === 'botflix' || (id === 'firebot' && !firebotInstalled) ||
      (Object.hasOwn(gameInstalls, id) && !gameInstalls[id]) ||
      (id === 'onlybots' && (!onlyBotsInstalled || !hasOnlyBotsAccess()))) {
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
  const url = new URL(location.href);
  const linkAll = url.searchParams.has('link-profiles');
  if (linkAll) {
    url.searchParams.delete('link-profiles');
    history.replaceState(null, '', url);
    linkWebGLProfiles().then(state => {
      if (state === 'missing') {
        const game = element('a', '', 'Open TileStorm Evolution');
        game.href = '../tilestorm/';
        prompt('Link all profiles', element('div', 'product-details',
          element('p', '', 'Open the WebGL game in this browser and wait for your player to load. The tablet will pick up that profile.'), game));
      } else toast(state === 'linked' ? 'WebGL and tablet are using the same profile.' : 'The profile link is pending. Try again shortly.');
    });
  }
  const profile = new URLSearchParams(location.hash.slice(1)).get('purchase-profile');
  if (profile !== null) {
    history.replaceState(null, '', location.pathname + location.search);
    linkPurchaseProfile(profile);
  }
  const id = location.hash.slice(1) || 'home';
  if (id !== current) open(id, true);
  return profile !== null || linkAll;
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

function refreshProfile() { loadPlayerProfile().catch(() => {}); }
window.addEventListener('tilestorm-purchases-changed', () => {
  refreshProfile();
  if (current === 'home') renderHome();
  if (current === 'onlybots' && !hasOnlyBotsAccess()) open('onlybots');
});
showCurrent();
refreshProfile();
if (!handleLocation()) syncPurchases();
if (onlyBotsInstalled && hasOnlyBotsAccess()) mount('onlybots');
tick();
setInterval(tick, 1000);
setInterval(() => {
  if (!document.hidden) syncPurchases();
}, 20000);
setTimeout(announceUpdate, 50000);
startContent();
