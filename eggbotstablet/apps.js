// Copyright 2026 massivehadron.com ltd.

import {element, button, image, tabs, watchSwipe, money, number, countdown, loadSetting, saveSetting} from './ui.js?v=lovebot-swipe';
import {hasOnlyBotsAccess, redeemOnlyBotsCode} from './premium.js?v=subscription-promo';
import {buyPurchase, catalogueProduct, paidLoveBotSwipes, refreshCatalogue, spendLoveBotSwipe} from './purchases.js?v=subscription-promo';
import {createSlideGesture} from './slide.js';
import {botOsPlusProduct, tabletProducts} from './settings.js?v=subscription-benefits';

export function createPhotos({data}) {
  const photos = (data.owner?.photos ?? []).map(photo => ({
    ...photo, url: data.photo(data.owner, photo.id)
  })).filter(photo => photo.url);
  const view = element('section', 'gallery');
  if (!photos.length) {
    view.append(element('p', 'waiting', 'There are no photos to show.'));
    return {view};
  }
  if (photos.length === 1) {
    const [photo] = photos;
    view.append(element('div', 'gallery-stage', image(photo.url, photo.description || 'Eggbot’s photo')));
    return {view};
  }

  let index = 0;
  let pending;
  const stage = button('', () => step(1), 'gallery-stage');
  const track = element('span', 'slide-track', image(''), image(''), image(''));
  track.setAttribute('aria-hidden', 'true');
  stage.append(track);
  const position = element('output');
  const controls = element('div', 'gallery-controls',
    button('Previous', () => step(-1)), position, button('Next', () => step(1)));
  view.append(stage, controls);

  const slider = createSlideGesture(stage, track, {
    step,
    canDrag: () => !pending,
    constrain: (offset, width) => Math.max(-2 * width, Math.min(0, offset))
  });

  function wrap(value) {
    return (value + photos.length) % photos.length;
  }

  function show() {
    for (const [slot, frame] of Array.from(track.children).entries()) {
      const {url} = photos[wrap(index + slot - 1)];
      if (frame.getAttribute('src') !== url) frame.src = url;
    }
    stage.setAttribute('aria-label', (photos[index].description || 'Eggbot’s photo') + ' — show next photo');
    position.textContent = (index + 1) + ' / ' + photos.length;
  }

  function finish(move) {
    if (pending !== move) return;
    pending = null;
    index = wrap(index + move.direction);
    // Keep the photo that slid into view and recycle the frame that left.
    if (move.direction > 0) track.append(track.firstElementChild);
    else track.prepend(track.lastElementChild);
    slider.jumpTo(-100);
    show();
  }

  function step(direction) {
    if (pending) return;
    if (!direction) {
      slider.slideTo(-100);
      return;
    }
    const move = {direction};
    pending = move;
    slider.slideTo(-100 * (1 + direction));
    const animation = track.getAnimations().find(item => item.transitionProperty === 'transform');
    if (animation) animation.finished.then(() => finish(move), () => finish(move));
    else finish(move);
  }

  view.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
  slider.jumpTo(-100);
  show();
  return {
    view,
    close() {
      if (pending) finish(pending);
      else slider.jumpTo(-100);
    }
  };
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
  const likeStamp = element('span', 'love-stamp like', 'Like');
  const passStamp = element('span', 'love-stamp pass', 'Nope');
  const stamps = element('div', 'love-stamps', likeStamp, passStamp);
  stamps.setAttribute('aria-hidden', 'true');
  const card = element('article', 'love-card love-front');
  const nextCard = element('article', 'love-card love-behind');
  nextCard.setAttribute('aria-hidden', 'true');
  const stage = element('div', 'love-stage', nextCard, card);

  function choice(label, kind, direction) {
    const control = button('', () => swipe(direction), 'love-choice ' + kind);
    control.append(element('span', 'love-choice-icon'));
    control.setAttribute('aria-label', label);
    control.title = label;
    return control;
  }

  const pass = choice('Pass', 'pass', -1);
  const like = choice('Like', 'like', 1);
  const deck = element('div', 'love-deck', pass, stage, like);
  const credits = element('output', 'muted');
  const previousPhoto = button('Previous photo', () => stepPhoto(-1));
  const nextPhoto = button('Next photo', () => stepPhoto(1));
  const photoControls = element('div', 'love-photo-controls', previousPhoto, nextPhoto);
  const emptyText = element('p');
  const buy = button('Add credits', () => {
    if (buyPurchase('lovebot')) tablet.toast('Continue in the checkout tab when ready.');
    else tablet.toast('Allow popups to open checkout.');
  }, 'primary');
  const empty = element('div', 'love-empty', emptyText, buy);
  const view = element('section', 'love-app', element('div', 'app-content',
    element('header', 'app-heading love-heading', image('./art/love.png'), element('h2', '', 'LoveBot'), credits),
    deck, photoControls, empty));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const refillDelay = 10 * 60 * 1000;
  const saved = loadSetting('loveCredits', {});
  let swipes = Number.isInteger(saved?.swipes) ? Math.min(5, Math.max(0, saved.swipes)) : 5;
  let refill = Number(saved?.refill) || 0;
  let index = 0;
  let photoIndex = 0;
  let displayedIndex = -1;
  let displayedPhoto = -1;
  let busy = false;
  let motion;
  let tilt = 1;
  const photoIds = profile => profile.loveBot.photoIds?.length ? profile.loveBot.photoIds : [profile.portrait?.photoId];
  const canSwipe = () => !view.hidden && !busy && !deck.hidden;

  function tick(now) {
    if (swipes === 0 && refill <= now) {
      swipes = 5;
      refill = 0;
      saveSetting('loveCredits', {swipes, refill});
      render();
    }
    const paid = paidLoveBotSwipes();
    credits.textContent = paid ? `${paid.toLocaleString()} paid ${paid === 1 ? 'swipe' : 'swipes'}` :
      swipes ? swipes + ' free ' + (swipes === 1 ? 'swipe' : 'swipes') :
      'Free swipes in ' + countdown(refill - now);
  }

  function positionCard(x, y) {
    const pull = x / Math.max(1, stage.clientWidth);
    const angle = Math.max(-32, Math.min(32, pull * 36 * tilt));
    card.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg)`;
    likeStamp.style.opacity = Math.min(1, Math.max(0, pull * 4));
    passStamp.style.opacity = Math.min(1, Math.max(0, -pull * 4));
  }

  async function animateCard(x, y, duration, leaving) {
    const from = getComputedStyle(card).transform;
    motion?.cancel();
    positionCard(x, y);
    if (reduceMotion.matches || view.hidden || typeof card.animate !== 'function') return;
    const animation = card.animate([
      {transform: from, opacity: 1},
      {transform: card.style.transform, opacity: leaving ? 0 : 1}
    ], {duration, easing: leaving ? 'cubic-bezier(.3,.65,.65,1)' : 'ease-out', fill: 'forwards'});
    motion = animation;
    try { await animation.finished; }
    catch { /* A new drag can interrupt the return animation. */ }
    finally {
      if (motion === animation) motion = null;
      animation.cancel();
    }
  }

  function settle() {
    if (!busy) animateCard(0, 0, 200, false);
  }

  async function swipe(direction) {
    const profile = profiles[index];
    if (!profile || !canSwipe()) return;
    busy = true;
    cancelDrag();
    setControlsBusy(true);
    let accepted = false;
    try {
      if (swipes > 0) {
        swipes--;
        if (swipes === 0) refill = Date.now() + refillDelay;
        saveSetting('loveCredits', {swipes, refill});
      } else if (!paidLoveBotSwipes() || !await spendLoveBotSwipe()) {
        return;
      }
      accepted = true;
      tick(Date.now());
      const distance = view.clientWidth / 2 + stage.clientWidth;
      await animateCard(direction * distance, -22, 320, true);
    } catch {
      if (!accepted && !view.hidden) tablet.toast('Could not use that swipe. Please try again.');
    } finally {
      busy = false;
      if (accepted) {
        index = (index + 1) % profiles.length;
        photoIndex = 0;
        displayedIndex = -1;
        positionCard(0, 0);
        if (!view.hidden && direction > 0 && Math.random() < .35)
          tablet.toast('It’s a match with ' + profile.displayName + '!');
      } else settle();
      setControlsBusy(false);
      render();
    }
  }

  function setControlsBusy(value) {
    for (const control of [pass, like, previousPhoto, nextPhoto]) control.setAttribute('aria-disabled', String(value));
  }

  function showCard(target, profile, selectedPhoto) {
    const {loveBot} = profile;
    const ids = photoIds(profile);
    const photo = data.photo(profile, ids[selectedPhoto]);
    const distance = loveBot.tilesAway > 0 ? loveBot.tilesAway + (loveBot.tilesAway === 1 ? ' tile away' : ' tiles away') : '';
    const copy = element('div', 'love-copy',
      element('h3', '', profile.displayName, profile.age > 0 ? element('span', '', ' ' + profile.age) : null),
      element('p', 'love-profile-detail', [profile.occupation, distance].filter(Boolean).join(', ')),
      element('p', '', loveBot.bio ?? ''));
    const bars = element('div', 'love-photo-bars', ...ids.map((_, slot) =>
      element('span', slot === selectedPhoto ? 'current' : '')));
    bars.hidden = ids.length < 2;
    bars.setAttribute('aria-hidden', 'true');
    target.replaceChildren(
      element('div', 'love-photo', photo ? image(photo, profile.displayName) : data.avatar(profile, profile.displayName)),
      bars, copy, ...(target === card ? [stamps] : []));
  }

  function render() {
    if (busy) return;
    const profile = profiles[index];
    deck.hidden = !profile || (!swipes && !paidLoveBotSwipes());
    empty.hidden = !deck.hidden;
    buy.hidden = !profile;
    emptyText.textContent = profile ? 'You’re out of swipes.' : 'There are no profiles nearby.';
    photoControls.hidden = deck.hidden || photoIds(profile).length < 2;
    if (deck.hidden) {
      cancelDrag();
      positionCard(0, 0);
      return;
    }
    if (index !== displayedIndex) {
      nextCard.hidden = profiles.length < 2;
      if (!nextCard.hidden) showCard(nextCard, profiles[(index + 1) % profiles.length], 0);
    }
    if (index !== displayedIndex || photoIndex !== displayedPhoto) showCard(card, profile, photoIndex);
    displayedIndex = index;
    displayedPhoto = photoIndex;
  }

  function stepPhoto(direction) {
    if (!canSwipe()) return;
    const count = photoIds(profiles[index]).length;
    if (count < 2) return;
    photoIndex = (photoIndex + direction + count) % count;
    render();
  }

  const cancelDrag = watchSwipe(card, direction => swipe(-direction), {
    canDrag: canSwipe,
    move(x, y, grip) {
      motion?.cancel();
      tilt = grip;
      positionCard(x, y);
    },
    settle
  });
  card.addEventListener('click', event => {
    const bounds = card.getBoundingClientRect();
    stepPhoto(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
  });
  function update() {
    tick(Date.now());
    render();
  }
  window.addEventListener('tilestorm-lovebot-credits-changed', update);
  window.addEventListener('tilestorm-purchases-changed', update);
  window.addEventListener('tilestorm-checkout-error', event => {
    if (event.detail === 'lovebot') tablet.toast('Checkout could not open. Try again.');
  });
  return {
    view, tick,
    open: update,
    close() {
      cancelDrag();
      motion?.finish();
    }
  };
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
  ['onlybots', 'Premium polish. Requires OnlyBots access.', 4],
  ['market', 'Impossible gadgets. Dubious parts. Optimistic sellers.'],
  ['botflix', 'Your watchlist is waiting in the cloud.', 64],
  ['firebot', 'Browse the BotWeb. Free download.'],
  ['snapbot', 'Send snaps that vanish before your shift ends.', 32],
  ['FartBot Pro', 'Premium exhaust notes. Now with unnecessary surround sound.', 128, 'FB'],
  ['Silent But Botly', 'Stealth exhaust for bots who blame the charging station.', 256, 'SBD'],
  ['Whoopee Firmware', 'Turn any seat into a terrible workplace incident.', 512, 'WF'],
  ['Toot Tuner 9000', 'Tune your exhaust to concert pitch. Orchestra not included.', 1024, 'TT']
];

export function createStore(tablet) {
  const content = element('div', 'app-content');
  const view = element('section', '', content);

  function buyOnlyBots() {
    const buy = button('Buy OnlyBots', event => {
      const control = event.currentTarget;
      const dialog = control.closest('dialog');
      if (!buyPurchase('app')) {
        tablet.toast('Allow popups to open checkout.');
        return;
      }
      const controller = new AbortController();
      const stillOpen = () => dialog.open && control.isConnected;
      dialog.addEventListener('close', () => { if (!stillOpen()) controller.abort(); }, {signal: controller.signal});
      window.addEventListener('tilestorm-purchases-changed', () => {
        if (!stillOpen() || hasOnlyBotsAccess()) {
          controller.abort();
          if (stillOpen()) continueOnlyBots();
        }
      }, {signal: controller.signal});
      window.addEventListener('tilestorm-checkout-error', event => {
        if (event.detail === 'app' && stillOpen()) tablet.toast('Checkout could not open. Try again.');
      }, {signal: controller.signal});
      window.addEventListener('tilestorm-checkout-cancelled', event => {
        if (event.detail === 'app') controller.abort();
      }, {signal: controller.signal});
      setTimeout(() => controller.abort(), 35 * 60 * 1000);
      tablet.toast('Continue in the checkout tab when ready.');
    }, 'action-link');
    refreshCatalogue().then(() => {
      const price = catalogueProduct('app')?.priceLabel;
      if (price) buy.textContent += ` · ${price}`;
    });
    return buy;
  }

  function download(name, size, install) {
    const progress = element('p', '', 'Downloading ' + size + ' MB…');
    progress.setAttribute('role', 'status');
    tablet.prompt('Installing ' + name, progress, [], 'Cancel');
    const dialog = progress.closest('dialog');
    setTimeout(() => {
      if (!dialog.open || !progress.isConnected) return;
      install();
      dialog.close();
      render();
      tablet.toast(name + ' installed. Find it on page two.');
    }, 3000);
  }

  function continueOnlyBots() {
    if (tablet.onlyBotsInstalled) tablet.open('onlybots');
    else download('OnlyBots', 4, () => tablet.installOnlyBots(true));
  }

  function requestFirebot() {
    const {name, downloadMb} = tablet.apps.firebot;
    const install = button('Install', () => download(name, downloadMb, tablet.installFirebot), 'primary');
    tablet.prompt('Download Firebot', 'Free · ' + downloadMb + ' MB', [install]);
  }

  function askForOnlyBotsCode() {
    const code = element('input');
    code.id = 'onlybots-app-code';
    code.type = 'password';
    code.autocomplete = 'off';
    code.autocapitalize = 'off';
    code.spellcheck = false;
    code.maxLength = 260;
    const label = element('label', '', 'OnlyBots code');
    label.htmlFor = code.id;
    const status = element('p', 'muted');
    status.id = 'onlybots-app-status';
    status.setAttribute('role', 'status');
    code.setAttribute('aria-describedby', status.id);
    const entry = element('div', 'premium-entry',
      element('p', '', 'Enter the four-digit PIN followed by the OnlyBots or premium code.'),
      label, code, status);
    const unlock = button('Unlock', async () => {
      const dialog = entry.closest('dialog');
      if (unlock.disabled || !dialog?.open) return;
      unlock.disabled = true;
      code.readOnly = true;
      status.textContent = 'Checking code…';
      try {
        const accepted = await redeemOnlyBotsCode(code.value);
        if (!dialog.open || !entry.isConnected) return;
        if (accepted) {
          code.value = '';
          continueOnlyBots();
          return;
        }
        code.setAttribute('aria-invalid', 'true');
        status.textContent = 'That OnlyBots code was not recognised. Check the PIN and code.';
      } catch (error) {
        if (!dialog.open || !entry.isConnected) return;
        status.textContent = error.status === 429 ? 'Too many code attempts. Try again later.' :
          'Could not check the code. Try again later.';
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
    tablet.prompt('Enter OnlyBots code', entry, [buyOnlyBots(), unlock]);
    code.focus();
  }

  function requestOnlyBots() {
    const registered = hasOnlyBotsAccess();
    const action = button('Continue', registered ? continueOnlyBots : askForOnlyBotsCode, 'primary');
    const description = registered ? 'Your access is registered on this browser.' :
      'Buy OnlyBots to unlock it automatically. Already have a code? Choose Continue.';
    tablet.prompt('OnlyBots access required', description, registered ? [action] : [buyOnlyBots(), action]);
  }

  function request(id, size) {
    if (id === 'onlybots') {
      requestOnlyBots();
      return;
    }
    if (id === 'firebot') {
      requestFirebot();
      return;
    }
    const name = tablet.apps[id]?.name ?? id;
    if (size <= tablet.freeSpaceMb) {
      tablet.prompt('Download unavailable', name + ' is currently unavailable for download.');
      return;
    }
    tablet.prompt('Insufficient memory',
      name + ' needs ' + number.format(size) + ' MB. The tablet has ' + number.format(tablet.freeSpaceMb) + ' MB free.',
      [button('Try again', () => request(id, size), 'primary')]);
  }

  function showProduct(id, fromSettings = false) {
    const product = tabletProducts[id];
    const controls = fromSettings ? [button('Back to Settings', () => tablet.open('settings'))] : [];
    const isOsUpgrade = id === botOsPlusProduct;
    const owned = () => isOsUpgrade ? tablet.preferences.hasOsUpgrade : tablet.preferences.hasCloudAccess;
    const installedMessage = isOsUpgrade ? 'Installed. Open Settings to pause notifications.' :
      'Activated. Open Settings to offload cached media.';
    const status = element('p', 'muted');
    status.setAttribute('role', 'status');
    const membershipInfo = isOsUpgrade ? null : element('p', '', 'Silver includes BotCloud. Verify your email to unlock it.');
    const details = element('div', `product-details upgrade-details${isOsUpgrade ? '' : ' botcloud-details'}`,
      element('p', '', product.description), membershipInfo, status);
    const join = isOsUpgrade ? null : button('Become a member', () => {
      if (!showOwned()) location.assign('../membership.html?offer=botcloud');
    });
    const buy = button('Continue to Shop', () => {
      if (showOwned()) return;
      status.textContent = buyPurchase(id) ? 'Continue in the checkout tab when ready.' :
        'Allow popups to open checkout.';
    }, 'primary');
    function showOwned() {
      if (!owned()) return false;
      buy.hidden = true;
      if (join) join.hidden = membershipInfo.hidden = true;
      status.textContent = installedMessage;
      return true;
    }

    buy.hidden = true;
    if (join) controls.push(join);
    controls.push(buy);
    tablet.prompt(product.name, details, controls, 'Close');
    const dialog = details.closest('dialog');
    const controller = new AbortController();
    dialog.addEventListener('close', () => controller.abort(), {once: true});
    window.addEventListener('tilestorm-checkout-cancelled', event => {
      if (event.detail === id && details.isConnected) status.textContent = 'Checkout cancelled.';
    }, {signal: controller.signal});
    window.addEventListener('tilestorm-purchases-changed', showOwned, {signal: controller.signal});
    if (showOwned()) return;
    status.textContent = 'Loading the Shop listing…';
    refreshCatalogue().then(() => {
      if (!dialog.open || !details.isConnected || showOwned()) return;
      const offer = catalogueProduct(id);
      if (!offer?.shopUrl) {
        status.textContent = 'The Shop listing is unavailable.';
        return;
      }
      const membership = offer.membership;
      const priceDetails = membership ? element('p', '', `${offer.priceLabel} regular. ${membership.tier} members save ${membership.savingsPercent}% and pay ${membership.priceLabel}.`) : null;
      const buyLabel = isOsUpgrade ? `Buy ${product.name}` : 'Buy once';
      buy.textContent = membership ? (isOsUpgrade ? 'Continue to Shop' : buyLabel) : `${buyLabel} · ${offer.priceLabel}`;
      status.textContent = '';
      if (priceDetails) details.insertBefore(priceDetails, status);
      buy.hidden = false;
    });
  }

  function render() {
    const installed = tablet.onlyBotsInstalled;
    const installedCount = 8 + Number(installed) + Number(tablet.firebotInstalled);
    const header = element('header', 'app-heading', element('h2', '', 'BotStore'),
      element('p', 'store-capacity muted', installedCount + ' installed · ' + number.format(tablet.freeSpaceMb) + ' MB free'));
    const rows = storeListings.map(([id, description, size, monogram]) => {
      const name = tablet.apps[id]?.name ?? id;
      const available = id === 'firebot' ? tablet.firebotInstalled : !size || (id === 'onlybots' && installed);
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
    const products = Object.entries(tabletProducts).map(([id, product]) =>
      element('article', 'row', product.art ? element('span', 'icon-art', image(product.art)) : tablet.art(product.icon),
        element('div', 'row-copy', element('h3', '', product.name),
          element('p', 'muted', product.description)),
        element('div', 'actions', button('Details', () => showProduct(id)))));
    content.replaceChildren(header, element('div', 'rows', ...rows, ...products));
  }

  return {view, open() {
    render();
    const id = tablet.takeStoreRequest();
    if (!id) return;
    const product = tabletProducts[id];
    if (product) showProduct(id, true);
    else request(id, storeListings.find(item => item[0] === id)[2]);
  }};
}
