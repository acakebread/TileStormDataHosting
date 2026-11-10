// Copyright 2026 massivehadron.com ltd.

const ui = Object.fromEntries([
  'latest', 'creators', 'creatorHeading', 'feedScroller', 'feedStatus', 'feed',
  'photoViewer', 'viewerCreator', 'viewerStage', 'viewerCaption', 'closeViewer', 'notice'
].map(id => [id, document.getElementById(id)]));

const state = {
  profiles: [], initial: [], updates: [], creators: [], round: [], lastCreator: null,
  selected: null, newPosts: 0, sequence: 0, timer: null, noticeTimer: null,
  cards: new Map(), views: new WeakMap(), activePointers: new Set(), pendingRender: false,
  viewerPost: null, settings: null
};

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const other = Math.floor(Math.random() * (i + 1));
    [result[i], result[other]] = [result[other], result[i]];
  }
  return result;
}

function avoidRepeat(deck, previous, identity = item => item) {
  if (deck.length > 1 && identity(deck[deck.length - 1]) === previous) {
    [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
  }
  return deck;
}

async function fetchFile(url, format = 'json') {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {signal: controller.signal, cache: 'no-cache', credentials: 'omit'});
    if (!response.ok) throw new Error('A preview file could not be loaded (HTTP ' + response.status + ').');
    return await response[format]();
  } finally {
    window.clearTimeout(timeout);
  }
}

function blobFromCanvas(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('The photo could not be prepared.')),
    'image/jpeg', .94
  ));
}

// All displayed and exported pictures use the resized copy. No Unity assets are loaded at runtime.
const pictures = {
  cache: new Map(),
  async load(profile, photoId) {
    const key = profile.id + '/' + photoId;
    if (this.cache.has(key)) return this.cache.get(key);
    const pending = this.read(profile, photoId);
    this.cache.set(key, pending);
    try { return await pending; }
    catch (error) { this.cache.delete(key); throw error; }
  },
  async read(profile, photoId) {
    const photo = profile.photos.find(item => item.id === photoId);
    if (!photo?.url) throw new Error('This photo is missing from the preview.');
    const blob = await fetchFile(new URL(photo.url, profile.sourceUrl), 'blob');
    const original = URL.createObjectURL(blob);
    const image = new Image();
    try {
      image.src = original;
      await image.decode();
      const requested = photo.maxImageDimension ?? profile.maxImageDimension ?? 512;
      const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 512;
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare the photo.');
      context.fillStyle = '#090e14';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const resized = await blobFromCanvas(canvas);
      const result = {url: URL.createObjectURL(resized), width: canvas.width, height: canvas.height};
      canvas.width = canvas.height = 0;
      return result;
    } finally {
      image.removeAttribute('src');
      URL.revokeObjectURL(original);
    }
  },
  dispose() {
    for (const pending of this.cache.values()) pending.then(photo => URL.revokeObjectURL(photo.url)).catch(() => {});
    this.cache.clear();
  }
};

function cropOf(source) {
  const crop = source.crop || {};
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const x = Math.max(0, Math.min(.9, finite(crop.x, 0)));
  const y = Math.max(0, Math.min(.9, finite(crop.y, 0)));
  return {
    x, y, width: Math.max(.1, Math.min(1 - x, finite(crop.width, 1))),
    height: Math.max(.1, Math.min(1 - y, finite(crop.height, 1)))
  };
}

function photoWindow(post, photo) {
  const crop = cropOf(post.source);
  const window = document.createElement('span');
  window.className = 'photo-window' + (post.source.flipHorizontal ? ' mirrored' : '');
  window.style.setProperty('--photo-aspect', String(photo.width * crop.width / (photo.height * crop.height)));
  const image = document.createElement('img');
  image.src = photo.url;
  image.alt = post.profile.photos.find(item => item.id === post.source.photoId)?.description || post.profile.displayName;
  image.draggable = false;
  image.style.width = (100 / crop.width) + '%';
  image.style.height = (100 / crop.height) + '%';
  image.style.left = (-100 * crop.x / crop.width) + '%';
  // Unity's authored crop Y is measured from the bottom of the image.
  image.style.top = (-100 * (1 - crop.y - crop.height) / crop.height) + '%';
  window.append(image);
  return window;
}

function publication(profile, source, postedAt) {
  return {id: 'post-' + (++state.sequence), profile, source, postedAt, liked: false};
}

function seedFeed() {
  const groups = state.profiles.map(profile => shuffle(
    [...(profile.onlyBots.posts || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(source => ({profile, source}))
  ));
  let previous = null;
  while (groups.some(group => group.length)) {
    const round = avoidRepeat(shuffle(groups.filter(group => group.length)), previous, group => group[0].profile.id);
    while (round.length) {
      const item = round.pop().pop();
      state.initial.push(publication(item.profile, item.source, Date.now() - (10 + state.initial.length * 13) * 60000));
      previous = item.profile.id;
    }
  }
  state.creators = state.profiles.filter(profile => profile.onlyBots.updates?.length)
    .map(profile => ({profile, deck: [], last: -1}));
  state.lastCreator = state.initial[0]?.profile.id || null;
}

function visiblePosts() {
  return [...state.updates, ...state.initial].filter(post => !state.selected || post.profile.id === state.selected);
}

function refreshLatest() {
  ui.latest.textContent = state.newPosts ? state.newPosts + (state.newPosts === 1 ? ' new post — view' : ' new posts — view') : 'Live feed — latest';
}

function refreshTimes() {
  for (const post of visiblePosts()) {
    const element = state.cards.get(post.id)?.querySelector('time');
    if (!element) continue;
    const minutes = Math.max(0, Math.floor((Date.now() - post.postedAt) / 60000));
    element.textContent = minutes === 0 ? 'Just now' : minutes < 60 ? minutes + 'm ago' : Math.floor(minutes / 60) + 'h ago';
  }
}

function toast(message) {
  window.clearTimeout(state.noticeTimer);
  ui.notice.textContent = message;
  ui.notice.hidden = false;
  state.noticeTimer = window.setTimeout(() => { ui.notice.hidden = true; }, 3500);
}

async function loadCardPhoto(card, post) {
  const button = card.querySelector('.photo-mat');
  if (button.dataset.loading === 'true' || button.dataset.loaded === 'true') return;
  button.dataset.loading = 'true';
  try {
    const photo = await pictures.load(post.profile, post.source.photoId);
    button.replaceChildren(photoWindow(post, photo));
    button.dataset.loaded = 'true';
    button.setAttribute('aria-label', 'Open photo from ' + post.profile.displayName);
  } catch {
    button.querySelector('.photo-loading').textContent = 'Photo unavailable. Tap to retry.';
  } finally {
    delete button.dataset.loading;
  }
}

const imageObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    imageObserver.unobserve(entry.target);
    const post = state.views.get(entry.target);
    if (post) loadCardPhoto(entry.target, post);
  }
}, {root: ui.feedScroller, rootMargin: '600px 0px'}) : null;

function makeCard(post) {
  const card = document.createElement('article');
  card.className = 'post';
  card.id = post.id;
  card.innerHTML = `
    <header class="post-header"><h3></h3><time class="post-time"></time></header>
    <button class="photo-mat" type="button"><span class="photo-loading">Loading photo…</span></button>
    <p class="post-caption"></p>
    <div class="post-actions">
      <button class="like" type="button" aria-pressed="false"><svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>Like</span></button>
      <button class="share" type="button"><svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/></svg>Share</button>
    </div>
    <button class="subscribe" type="button">Subscribe for more</button>`;
  card.querySelector('h3').textContent = post.profile.displayName;
  card.querySelector('time').dateTime = new Date(post.postedAt).toISOString();
  card.querySelector('.post-caption').textContent = post.source.caption || '';
  card.querySelector('.photo-mat').setAttribute('aria-label', 'Load photo from ' + post.profile.displayName);
  card.querySelector('.photo-mat').addEventListener('click', async () => {
    try { await openPhoto(post); } catch { await loadCardPhoto(card, post); }
  });
  card.querySelector('.like').addEventListener('click', event => {
    post.liked = !post.liked;
    event.currentTarget.classList.toggle('liked', post.liked);
    event.currentTarget.setAttribute('aria-pressed', String(post.liked));
    event.currentTarget.querySelector('span').textContent = post.liked ? 'Liked' : 'Like';
  });
  card.querySelector('.share').addEventListener('click', event => sharePost(post, event.currentTarget));
  card.querySelector('.subscribe').addEventListener('click', () => toast(
    post.profile.displayName + ': Extra voltage coming soon. Enjoy the preview for now.'
  ));
  state.views.set(card, post);
  state.cards.set(post.id, card);
  return card;
}

function renderFeed(preservePosition) {
  const scrollTop = ui.feedScroller.scrollTop;
  const viewportTop = ui.feedScroller.getBoundingClientRect().top;
  let anchor = null;
  let offset = 0;
  if (preservePosition && scrollTop > 1) {
    anchor = [...ui.feed.children].find(card => card.getBoundingClientRect().bottom > viewportTop);
    if (anchor) offset = anchor.getBoundingClientRect().top - viewportTop;
  }
  const posts = visiblePosts();
  const fragment = document.createDocumentFragment();
  for (const post of posts) fragment.append(state.cards.get(post.id) || makeCard(post));
  ui.feed.replaceChildren(fragment);
  if (preservePosition && anchor?.isConnected) {
    ui.feedScroller.scrollTop += anchor.getBoundingClientRect().top - viewportTop - offset;
  } else {
    ui.feedScroller.scrollTop = preservePosition ? scrollTop : 0;
  }
  const active = new Set([...state.initial, ...state.updates].map(post => post.id));
  for (const [id, card] of state.cards) {
    if (!active.has(id)) { imageObserver?.unobserve(card); state.cards.delete(id); }
  }
  for (const post of posts) {
    const card = state.cards.get(post.id);
    if (card.querySelector('.photo-mat').dataset.loaded !== 'true') {
      if (imageObserver) imageObserver.observe(card);
      else loadCardPhoto(card, post);
    }
  }
  ui.feedStatus.hidden = posts.length > 0;
  ui.feedStatus.textContent = 'No posts from this creator yet.';
  state.pendingRender = false;
  if (ui.feedScroller.scrollTop <= 1) state.newPosts = 0;
  refreshLatest();
  refreshTimes();
}

function selectCreator(id) {
  state.selected = id;
  state.newPosts = 0;
  ui.creatorHeading.textContent = state.profiles.find(profile => profile.id === id)?.displayName || 'All creators';
  for (const button of ui.creators.children) button.setAttribute('aria-pressed', String(button.dataset.creator === (id || '')));
  renderFeed(false);
}

function renderCreators() {
  const creators = [{id: '', displayName: 'All creators'}, ...state.profiles];
  for (const profile of creators) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.creator = profile.id;
    button.textContent = profile.displayName;
    button.addEventListener('click', () => selectCreator(profile.id || null));
    ui.creators.append(button);
  }
}

function scheduleUpdate(delay) {
  if (!state.creators.length) return;
  state.timer = window.setTimeout(() => {
    if (!state.round.length) state.round = avoidRepeat(shuffle(state.creators), state.lastCreator, creator => creator.profile.id);
    const creator = state.round.pop();
    if (!creator.deck.length) creator.deck = avoidRepeat(shuffle(
      creator.profile.onlyBots.updates.map((_, index) => index)
    ), creator.last);
    creator.last = creator.deck.pop();
    state.lastCreator = creator.profile.id;
    const post = publication(creator.profile, creator.profile.onlyBots.updates[creator.last], Date.now());
    state.updates.unshift(post);
    state.updates.length = Math.min(state.updates.length, state.settings.retainedUpdates);
    if (!state.selected || state.selected === post.profile.id) state.newPosts++;
    if (state.activePointers.size) { state.pendingRender = true; refreshLatest(); }
    else renderFeed(true);
    const seconds = state.settings.minUpdateSeconds + Math.random() * (state.settings.maxUpdateSeconds - state.settings.minUpdateSeconds);
    scheduleUpdate(seconds * 1000);
  }, delay);
}

function fitViewer() {
  const photo = ui.viewerStage.querySelector('.photo-window');
  if (!photo) return;
  const aspect = Number(photo.style.getPropertyValue('--photo-aspect'));
  const style = getComputedStyle(ui.viewerStage);
  const height = Math.max(1, ui.viewerStage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  const width = Math.min(ui.viewerStage.clientWidth, height * aspect);
  photo.style.width = width + 'px';
  photo.style.height = (width / aspect) + 'px';
}

async function openPhoto(post) {
  const photo = await pictures.load(post.profile, post.source.photoId);
  ui.viewerCreator.textContent = post.profile.displayName;
  ui.viewerCaption.textContent = post.source.caption || '';
  ui.viewerStage.replaceChildren(photoWindow(post, photo));
  state.viewerPost = post;
  if (!ui.photoViewer.open) ui.photoViewer.showModal();
  fitViewer();
}

async function sharePost(post, button) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const photo = await pictures.load(post.profile, post.source.photoId);
    const image = new Image();
    image.src = photo.url;
    await image.decode();
    const crop = cropOf(post.source);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.width * crop.width));
    canvas.height = Math.max(1, Math.round(photo.height * crop.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the photo.');
    if (post.source.flipHorizontal) { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(image, photo.width * crop.x, photo.height * (1 - crop.y - crop.height),
      photo.width * crop.width, photo.height * crop.height, 0, 0, canvas.width, canvas.height);
    const blob = await blobFromCanvas(canvas);
    canvas.width = canvas.height = 0;
    const file = new File([blob], 'onlybots-' + post.profile.id + '.jpg', {type: 'image/jpeg'});
    if (navigator.canShare?.({files: [file]})) {
      // The unlisted preview URL is deliberately absent from shared content.
      await navigator.share({title: 'OnlyBots — ' + post.profile.displayName, text: post.source.caption || '', files: [file]});
    } else {
      const url = URL.createObjectURL(file);
      const download = document.createElement('a');
      download.href = url;
      download.download = file.name;
      document.body.append(download);
      download.click();
      download.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('Photo download prepared.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast('The photo could not be shared. Please try again.');
  } finally {
    button.disabled = false;
  }
}

function validateProfile(profile) {
  if (!profile || profile.schemaVersion !== 1 || !profile.id || !profile.displayName ||
    !Array.isArray(profile.photos) || !profile.onlyBots?.enabled) throw new Error('A preview profile is invalid.');
  const photos = new Set(profile.photos.map(photo => photo.id));
  for (const source of [...(profile.onlyBots.posts || []), ...(profile.onlyBots.updates || [])]) {
    if (!source || !photos.has(source.photoId)) throw new Error('A preview post refers to a missing photo.');
  }
  return profile;
}

ui.latest.addEventListener('click', () => { state.newPosts = 0; renderFeed(false); });
ui.closeViewer.addEventListener('click', () => ui.photoViewer.close());
ui.photoViewer.addEventListener('click', event => {
  if (event.target === ui.photoViewer || event.target === ui.viewerStage) ui.photoViewer.close();
});
ui.photoViewer.addEventListener('close', () => { state.viewerPost = null; ui.viewerStage.replaceChildren(); });
window.addEventListener('resize', fitViewer);
if ('ResizeObserver' in window) new ResizeObserver(fitViewer).observe(ui.viewerStage);
ui.feedScroller.addEventListener('pointerdown', event => state.activePointers.add(event.pointerId));
function endDrag(event) {
  state.activePointers.delete(event.pointerId);
  if (!state.activePointers.size && state.pendingRender) renderFeed(true);
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', () => {
  state.activePointers.clear();
  if (state.pendingRender) renderFeed(true);
});
ui.feedScroller.addEventListener('scroll', () => {
  if (ui.feedScroller.scrollTop <= 1 && state.newPosts) { state.newPosts = 0; refreshLatest(); }
}, {passive: true});
window.addEventListener('pagehide', event => {
  if (!event.persisted) { window.clearTimeout(state.timer); pictures.dispose(); imageObserver?.disconnect(); }
});

async function start() {
  try {
    const catalogue = await fetchFile(new URL('./catalogue.json', import.meta.url));
    if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.profiles)) throw new Error('The preview catalogue is invalid.');
    state.settings = {
      minUpdateSeconds: 35, maxUpdateSeconds: 65, firstUpdateSeconds: 20, retainedUpdates: 24,
      ...catalogue.feed
    };
    state.profiles = await Promise.all(catalogue.profiles.map(async relative => {
      const sourceUrl = new URL(relative, import.meta.url);
      return {...validateProfile(await fetchFile(sourceUrl)), sourceUrl};
    }));
    state.profiles.sort((a, b) => (a.onlyBots.order || 0) - (b.onlyBots.order || 0) || a.id.localeCompare(b.id));
    seedFeed();
    renderCreators();
    selectCreator(null);
    ui.latest.disabled = false;
    scheduleUpdate(state.settings.firstUpdateSeconds * 1000);
    window.setInterval(refreshTimes, 15000);
  } catch (error) {
    ui.feedStatus.hidden = false;
    ui.feedStatus.textContent = 'The preview could not load. ' + (error.name === 'AbortError' ? 'The request timed out.' : error.message) + ' Reload the page to try again.';
    ui.feedStatus.setAttribute('role', 'alert');
  }
}

start();
