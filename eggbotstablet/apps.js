// Copyright 2026 massivehadron.com ltd.

import {element, button, image, tabs, watchSwipe, money, countdown, loadSetting, saveSetting} from './ui.js';
import {hasPremiumAccess, premiumShop, redeemPremiumCode} from './premium.js';

export function createPhotos({data}) {
  const photos = (data.owner?.photos ?? []).map(photo => ({
    ...photo, url: data.photo(data.owner, photo.id)
  })).filter(photo => photo.url);
  const view = element('section', 'gallery');
  if (!photos.length) {
    view.append(element('p', 'waiting', 'There are no photos to show.'));
    return {view};
  }
  let index = 0;
  const photo = image('');
  const stage = button('', () => step(1), 'gallery-stage');
  stage.append(photo);
  stage.setAttribute('aria-label', 'Show next photo');
  const position = element('output');
  const controls = element('div', 'gallery-controls',
    button('Previous', () => step(-1)), position, button('Next', () => step(1)));
  controls.hidden = photos.length < 2;
  view.append(stage, controls);

  function show() {
    photo.src = photos[index].url;
    photo.alt = photos[index].description || 'Eggbot’s photo';
    position.textContent = (index + 1) + ' / ' + photos.length;
  }

  function step(direction) {
    index = (index + direction + photos.length) % photos.length;
    show();
  }

  watchSwipe(view, step);
  view.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
  show();
  return {view};
}

export function createBank(tablet) {
  const {bankAccounts = [], bankStatement = [], openingCents = -1248055, overdraftCents = 25000} = tablet.data.tablet;
  const balance = element('output', 'negative');
  const over = element('p', 'muted');
  const heading = element('header', 'app-heading', element('h2', '', 'Droid Bank'));
  const accounts = element('div', 'accounts', ...bankAccounts.map(account =>
    element('article', 'row',
      element('h3', '', account.name),
      element('p', account.cents < 0 ? 'negative' : '', money.format(account.cents / 100)),
      element('small', account.urgent ? 'negative' : '', account.note))));
  const rows = element('tbody');
  const statement = element('table', 'statement',
    element('thead', '', element('tr', '',
      element('th', '', 'Date'), element('th', '', 'Transaction'), element('th', '', 'Amount'))), rows);
  const view = element('section', '', element('div', 'app-content', heading,
    element('div', 'balance', element('p', '', 'Current account'), balance,
      element('p', '', 'Overdraft limit ' + money.format(overdraftCents / 100)), over),
    accounts, element('h3', '', 'Statement'), statement));
  let openedAt;

  function tick(now) {
    const cents = openingCents - Math.floor((now - openedAt) / 1000);
    balance.textContent = money.format(cents / 100);
    over.textContent = 'Over your limit by ' + money.format(Math.max(0, -cents - overdraftCents) / 100);
  }

  function open() {
    openedAt = Date.now();
    tick(openedAt);
    const date = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short'});
    rows.replaceChildren(...bankStatement
      .filter(entry => !entry.requiresOnlyBots || tablet.onlyBotsInstalled)
      .map(entry => {
        const when = new Date(openedAt);
        when.setDate(when.getDate() - entry.daysAgo);
        return element('tr', '', element('td', '', entry.daysAgo ? date.format(when) : 'Today'),
          element('td', '', entry.description),
          element('td', entry.declined || entry.cents < 0 ? 'negative' : '',
            entry.declined ? 'Declined' : money.format(entry.cents / 100)));
      }));
  }
  return {view, open, tick};
}

export function createLove(tablet) {
  const {data} = tablet;
  const profiles = data.profiles.filter(profile => profile.loveBot?.enabled)
    .sort((a, b) => (a.loveBot.order ?? 0) - (b.loveBot.order ?? 0));
  const card = element('article', 'love-card');
  const credits = element('output', 'muted');
  const actions = element('div', 'actions love-actions');
  const view = element('section', '', element('div', 'app-content',
    element('header', 'app-heading', element('h2', '', 'LoveBot'), credits), card, actions));
  const refillDelay = 10 * 60 * 1000;
  const saved = loadSetting('loveCredits', {});
  let swipes = Number.isInteger(saved?.swipes) ? Math.min(5, Math.max(0, saved.swipes)) : 5;
  let refill = Number(saved?.refill) || 0;
  let index = 0;
  let photoIndex = 0;

  function tick(now) {
    if (swipes === 0 && refill <= now) {
      swipes = 5;
      refill = 0;
      saveSetting('loveCredits', {swipes, refill});
      render();
      return;
    }
    credits.textContent = swipes ? swipes + ' free ' + (swipes === 1 ? 'swipe' : 'swipes') :
      'Free swipes in ' + countdown(refill - now);
  }

  function swipe(like) {
    const profile = profiles[index];
    if (!profile || swipes === 0) return;
    swipes--;
    if (swipes === 0) refill = Date.now() + refillDelay;
    saveSetting('loveCredits', {swipes, refill});
    if (like && Math.random() < .35) tablet.toast('It’s a match with ' + profile.displayName + '!');
    index = (index + 1) % profiles.length;
    photoIndex = 0;
    render();
  }

  function render() {
    const profile = profiles[index];
    const now = Date.now();
    if (swipes === 0 && refill <= now) {
      tick(now);
      return;
    }
    tick(now);
    if (swipes === 0 || !profile) {
      card.replaceChildren(element('p', 'row-copy', profile ? 'You’re out of free swipes.' : 'There are no profiles nearby.'));
      actions.replaceChildren();
      if (profile) actions.append(button('Add credits', () => tablet.toast('Payment declined by Droid Bank.'), 'primary'));
      return;
    }
    const {loveBot} = profile;
    const ids = loveBot.photoIds?.length ? loveBot.photoIds : [profile.portrait?.photoId];
    const photo = data.photo(profile, ids[photoIndex]);
    const copy = element('div', 'row-copy', element('h3', '', profile.displayName),
      element('small', '', String(loveBot.tilesAway ?? 0) + ' tiles away'), element('p', '', loveBot.bio ?? ''));
    card.replaceChildren(photo ? image(photo, profile.displayName) : element('div', 'placeholder', data.avatar(profile, profile.displayName)), copy);
    const pass = button('Pass', () => swipe(false));
    const like = button('Like', () => swipe(true), 'primary');
    actions.replaceChildren(pass);
    if (ids.length > 1) actions.append(button('Next photo', () => {
      photoIndex = (photoIndex + 1) % ids.length;
      render();
    }));
    actions.append(like);
  }

  watchSwipe(card, direction => swipe(direction < 0));
  return {view, open: render, tick};
}

export function createMarket(tablet) {
  const {profiles} = tablet.data;
  const listings = profiles.filter(profile => profile.eBot?.enabled).flatMap(profile =>
    (profile.eBot.listings ?? []).map(item => ({...item, seller: profile.eBot.sellerSummary || profile.handle})))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const rival = profiles.find(profile => profile.eBot?.rivalBidder)?.displayName ?? 'eggb0t_2';
  const watched = new Set(listings.filter(item => item.watched));
  let available;
  let selected = 'Browse';
  const content = element('div', 'app-content market');
  const view = element('section', '', content);

  function refresh() {
    available = new Set(listings.filter(item => Math.random() < (item.availability ?? 1)));
    render();
  }

  function render() {
    const watchList = 'Watch list (' + watched.size + ')';
    const navigation = tabs(['Browse', watchList, 'Orders'], selected === 'Watch' ? watchList : selected, label => {
      selected = label === watchList ? 'Watch' : label;
      render();
    });
    const header = element('header', 'app-heading', element('h2', '', 'eBot'));
    if (selected === 'Browse') header.append(button('Fresh listings', refresh));
    const items = selected === 'Browse' ? listings.filter(item => available.has(item) || watched.has(item)) :
      listings.filter(item => selected === 'Watch' && watched.has(item));
    const rows = items.map(item => {
      const copy = element('div', 'row-copy', element('h3', '', item.title), element('small', '', item.seller),
        element('p', '', item.description), element('strong', 'price', item.price));
      const watch = button(watched.has(item) ? 'Unwatch' : 'Watch', () => {
        if (!watched.delete(item)) watched.add(item);
        render();
      });
      const buy = button(item.auction ? 'Bid' : 'Buy', () => tablet.toast(item.auction ?
        'Outbid instantly by ' + rival + '.' : 'Payment declined by Droid Bank.'), 'primary');
      return element('article', 'row', copy, element('div', 'actions', watch, buy));
    });
    const empty = {Browse: 'There are no listings right now.', Watch: 'Your watch list is empty.', Orders: 'No orders yet.'};
    content.replaceChildren(header, navigation, element('div', 'rows', ...(rows.length ? rows : [element('p', 'muted', empty[selected])])));
  }

  return {view, open() { if (available) render(); else refresh(); }};
}

const storeListings = [
  ['scratch', 'Scratch away your savings. Win enough to try again.'],
  ['fruit', 'Two minutes of matching fruit and ignoring your problems.'],
  ['love', 'Meet local bots. Run out of swipes. Try again later.'],
  ['bank', 'Your balance, updated with more bad news.'],
  ['mail', 'Bills, spam and messages that could have waited.'],
  ['chat', 'Seen. Typing. Still waiting for a useful answer.'],
  ['instabot', 'Everyone else’s perfect life. Your twelve-percent battery.'],
  ['onlybots', 'Premium polish. Requires OnlyBots premium access.', 4],
  ['market', 'Impossible gadgets. Dubious parts. Optimistic sellers.'],
  ['botflix', 'Your watchlist is waiting in the cloud.', 64],
  ['snapbot', 'Send snaps that vanish before your shift ends.', 32],
  ['FartBot Pro', 'Premium exhaust notes. Now with unnecessary surround sound.', 128, 'FB'],
  ['Silent But Botly', 'Stealth exhaust for bots who blame the charging station.', 256, 'SBD'],
  ['Whoopee Firmware', 'Turn any seat into a terrible workplace incident.', 512, 'WF'],
  ['Toot Tuner 9000', 'Tune your exhaust to concert pitch. Orchestra not included.', 1024, 'TT']
];

export function createStore(tablet) {
  const content = element('div', 'app-content');
  const view = element('section', '', content);
  const free = () => tablet.onlyBotsInstalled ? 8 : 12;

  function buyPremium() {
    const link = element('a', 'action-link', 'Buy premium');
    link.href = premiumShop;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function continueOnlyBots() {
    if (tablet.onlyBotsInstalled) {
      tablet.open('onlybots');
      return;
    }

    const progress = element('p', '', 'Downloading 4 MB…');
    progress.setAttribute('role', 'status');
    tablet.prompt('Installing OnlyBots', progress, [], 'Cancel');
    const dialog = progress.closest('dialog');
    setTimeout(() => {
      if (!dialog.open || !progress.isConnected) return;
      tablet.installOnlyBots(true);
      dialog.close();
      render();
      tablet.toast('OnlyBots installed.');
    }, 3000);
  }

  function askForPremiumCode() {
    const code = element('input');
    code.id = 'onlybots-premium-code';
    code.type = 'password';
    code.autocomplete = 'off';
    code.autocapitalize = 'off';
    code.spellcheck = false;
    code.maxLength = 128;
    const label = element('label', '', 'Premium code');
    label.htmlFor = code.id;
    const status = element('p', 'muted');
    status.id = 'onlybots-premium-status';
    status.setAttribute('role', 'status');
    code.setAttribute('aria-describedby', status.id);
    const entry = element('div', 'premium-entry',
      element('p', '', 'Enter the OnlyBots premium code from your Buy Me a Coffee purchase.'),
      label, code, status);
    const unlock = button('Unlock', async () => {
      const dialog = entry.closest('dialog');
      if (unlock.disabled || !dialog?.open) return;
      unlock.disabled = true;
      code.readOnly = true;
      status.textContent = 'Checking code…';
      try {
        const accepted = await redeemPremiumCode(code.value);
        if (!dialog.open || !entry.isConnected) return;
        if (accepted) {
          code.value = '';
          continueOnlyBots();
          return;
        }
        code.setAttribute('aria-invalid', 'true');
        status.textContent = 'That premium code was not recognised. Check your purchase receipt.';
      } catch {
        if (!dialog.open || !entry.isConnected) return;
        status.textContent = 'Could not check the code. Reload the tablet and try again.';
      } finally {
        unlock.disabled = false;
        code.readOnly = false;
      }
      code.focus();
      code.select();
    }, 'primary');
    code.addEventListener('input', () => {
      code.removeAttribute('aria-invalid');
      status.textContent = '';
    });
    code.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      unlock.click();
    });
    tablet.prompt('Enter premium code', entry, [buyPremium(), unlock]);
    code.focus();
  }

  function requestOnlyBots() {
    const registered = hasPremiumAccess();
    const action = button('Continue', registered ? continueOnlyBots : askForPremiumCode, 'primary');
    const purpose = tablet.onlyBotsInstalled ? 'open' : 'install';
    tablet.prompt('Premium access required', 'OnlyBots needs premium access to ' + purpose + '. ' +
      (registered ? 'Your premium access is registered on this browser.' :
        'Buy premium through Buy Me a Coffee, or continue to enter your purchase code.'),
    registered ? [action] : [buyPremium(), action]);
  }

  function request(id, size) {
    if (id === 'onlybots') {
      requestOnlyBots();
      return;
    }
    const name = tablet.apps[id]?.name ?? id;
    tablet.prompt('Insufficient memory', name + ' needs ' + size + ' MB. The tablet has ' + free() + ' MB free.',
      [button('Try again', () => request(id, size), 'primary')]);
  }

  function render() {
    const installed = tablet.onlyBotsInstalled;
    const header = element('header', 'app-heading', element('h2', '', 'BotStore'),
      element('p', 'store-capacity muted', (installed ? 9 : 8) + ' installed · ' + free() + ' MB free'));
    const rows = storeListings.map(([id, description, size, monogram]) => {
      const name = tablet.apps[id]?.name ?? id;
      const available = !size || (id === 'onlybots' && installed);
      const action = available ? button('Open', () => tablet.open(id), 'primary') :
        button(id === 'botflix' ? 'Reinstall' : 'Install', () => request(id, size));
      const controls = element('div', 'actions', action);
      if (id === 'onlybots' && installed) {
        const uninstall = button('Uninstall', () => tablet.prompt('Uninstall OnlyBots?', 'This frees 4 MB on the tablet.', [
          button('Uninstall', event => {
            tablet.installOnlyBots(false);
            event.currentTarget.closest('dialog').close();
            render();
          }, 'danger')
        ]), 'danger');
        controls.append(uninstall);
      }
      return element('article', 'row', tablet.art(id, monogram),
        element('div', 'row-copy', element('h3', '', name), element('p', 'muted', description)), controls);
    });
    content.replaceChildren(header, element('div', 'rows', ...rows));
  }

  return {view, open() {
    render();
    const id = tablet.takeStoreRequest();
    if (id) request(id, storeListings.find(item => item[0] === id)[2]);
  }};
}
