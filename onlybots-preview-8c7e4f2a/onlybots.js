// Copyright 2026 massivehadron.com ltd.

import {blobFromCanvas, fetchFile, pictures, shuffle} from '../tablet-preview/shared.js';
import {creatorPriceUsd, hasCreatorAccess, hasCreatorProduct, redeemCreatorCode} from '../eggbotstablet/premium.js?v=lovebot-credits';
import {createPurchaseForm} from './purchase-form.js?v=lovebot-credits';

const ui = Object.fromEntries([
  'latest', 'creators', 'creatorHeading', 'feedScroller', 'feedStatus', 'feed',
  'photoViewer', 'viewerCreator', 'viewerStage', 'viewerCaption', 'viewerStatus', 'closeViewer', 'notice',
  'galleryTabs', 'galleryVideos', 'galleryPhotos', 'galleryControls', 'galleryPrevious',
  'galleryPosition', 'galleryNext', 'galleryStop', 'profilePurchase', 'profilePurchaseHeading'
].map(id => [id, document.getElementById(id)]));

const state = {
  profiles: [], initial: [], updates: [], creators: [], round: [], lastCreator: null,
  selected: null, newPosts: 0, sequence: 0, timer: null, noticeTimer: null,
  cards: new Map(), views: new WeakMap(), activePointers: new Set(), pendingRender: false,
  gallery: null, viewerRequest: 0, settings: null, tabletPremium: false
};

function avoidRepeat(deck, previous, identity = item => item) {
  if (deck.length > 1 && identity(deck[deck.length - 1]) === previous) {
    [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
  }
  return deck;
}

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
  const creatorAction = card.querySelector('.subscribe');
  if (hasCreatorProduct(post.profile.id) || post.profile.videos.length) {
    creatorAction.textContent = 'View profile';
    creatorAction.addEventListener('click', () => openCreatorProfile(post.profile));
  } else {
    creatorAction.addEventListener('click', () => toast(
      post.profile.displayName + ': Extra voltage coming soon. Enjoy the preview for now.'
    ));
  }
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
  if (state.selected === null && ui.feedScroller.scrollTop <= 1) state.newPosts = 0;
  refreshLatest();
  refreshTimes();
}

function selectCreator(id) {
  state.selected = id;
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
    state.newPosts = Math.min(state.newPosts + 1, state.updates.length);
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
  const request = ++state.viewerRequest;
  const photo = await pictures.load(post.profile, post.source.photoId);
  if (request !== state.viewerRequest) return;
  state.gallery = null;
  ui.galleryTabs.hidden = ui.galleryControls.hidden = true;
  setViewerStatus('');
  releaseViewerMedia();
  ui.viewerCreator.textContent = post.profile.displayName;
  ui.viewerCaption.textContent = post.source.caption || '';
  ui.viewerStage.append(photoWindow(post, photo));
  if (!ui.photoViewer.open) ui.photoViewer.showModal();
  fitViewer();
}

function setViewerStatus(message) {
  ui.viewerStatus.textContent = message;
  ui.viewerStatus.hidden = !message;
}

function updateVideoPlaySurface(video) {
  const playSurface = video.parentElement.querySelector('.video-play-surface');
  playSurface.hidden = false;
  playSurface.setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video');
}

function releaseViewerMedia() {
  const video = ui.viewerStage.querySelector('video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  ui.viewerStage.replaceChildren();
}

function resetViewer() {
  state.viewerRequest++;
  state.gallery = null;
  releaseViewerMedia();
}

function openCreatorProfile(profile) {
  if (hasCreatorAccess(profile.id, state.tabletPremium)) {
    openGallery(profile);
    return;
  }

  const dialog = ui.profilePurchase;
  const price = creatorPriceUsd(profile.id);
  const form = createPurchaseForm({
    product: profile.id,
    buyLabel: price === undefined ? 'Buy profile' : `Buy profile · US$${price}`,
    redeem: code => redeemCreatorCode(profile.id, code),
    onAccepted: () => {
      dialog.close();
      openGallery(profile);
    },
    invalidMessage: 'That code does not match this profile. Check your purchase confirmation.'
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dialog.close());
  form.querySelector('.purchase-actions').prepend(cancel);
  ui.profilePurchaseHeading.textContent = 'Unlock ' + profile.displayName;
  dialog.replaceChildren(ui.profilePurchaseHeading, form);
  dialog.showModal();
  form.querySelector('input').focus();
}

function openGallery(profile) {
  const section = profile.videos.length ? 'videos' : 'photos';
  state.gallery = {profile, section, index: 0};
  ui.viewerCreator.textContent = profile.displayName;
  ui.galleryTabs.hidden = ui.galleryControls.hidden = false;
  ui.galleryPhotos.disabled = !profile.photos.length;
  ui.galleryVideos.disabled = !profile.videos.length;
  if (!ui.photoViewer.open) ui.photoViewer.showModal();
  renderGallery();
}

async function renderGallery(continuePlaying = false) {
  const gallery = state.gallery;
  const {profile, section, index} = gallery;
  const request = ++state.viewerRequest;
  // Keep the video element across automatic advances, including its browser playback permissions.
  const currentVideo = continuePlaying ? ui.viewerStage.querySelector('video') : null;
  if (!currentVideo) releaseViewerMedia();
  gallery.cycling = continuePlaying;
  setViewerStatus('');

  const items = profile[section];
  const item = items[index];
  const isVideo = section === 'videos';
  ui.galleryVideos.setAttribute('aria-pressed', String(isVideo));
  ui.galleryPhotos.setAttribute('aria-pressed', String(!isVideo));
  ui.viewerCaption.textContent = item?.description || '';
  ui.galleryPrevious.disabled = items.length < 2 || (isVideo && index === 0);
  ui.galleryNext.disabled = items.length < 2 || (isVideo && index === items.length - 1);
  ui.galleryPosition.value = items.length ? (index + 1) + ' / ' + items.length : '';
  ui.galleryStop.hidden = !isVideo;
  ui.galleryStop.disabled = !continuePlaying;
  if (!item) {
    setViewerStatus('No media is available for this profile.');
    return;
  }

  if (isVideo) {
    const video = currentVideo || document.createElement('video');
    const frame = currentVideo ? video.parentElement : document.createElement('div');
    const playSurface = currentVideo ? frame.querySelector('.video-play-surface') : document.createElement('button');
    if (!currentVideo) {
      frame.className = 'gallery-video';
      playSurface.className = 'video-play-surface';
      playSurface.type = 'button';
      playSurface.setAttribute('aria-label', 'Play video');
      frame.append(video, playSurface);
    }
    video.className = 'gallery-media';
    // On touch devices, changing the source with native controls enabled flashes them over the next clip.
    video.controls = !continuePlaying || !window.matchMedia('(pointer: coarse)').matches;
    video.loop = items.length === 1;
    video.playsInline = true;
    video.preload = 'none';
    video.setAttribute('aria-label', item.description || 'Video from ' + profile.displayName);
    playSurface.hidden = continuePlaying;
    const play = () => {
      video.play().catch(error => {
        if (request !== state.viewerRequest || error.name === 'AbortError') return;
        gallery.cycling = false;
        video.controls = true;
        updateVideoPlaySurface(video);
        ui.galleryStop.disabled = true;
        setViewerStatus(error.name === 'NotAllowedError' ? 'Press Play to continue.' : 'This video could not be played.');
      });
    };
    playSurface.onclick = () => {
      if (video.paused) play();
      else video.pause();
    };
    video.onplay = () => {
      if (request !== state.viewerRequest) return;
      gallery.cycling = true;
      updateVideoPlaySurface(video);
      ui.galleryStop.disabled = false;
      setViewerStatus('');
    };
    video.onpause = () => {
      if (request !== state.viewerRequest || !video.paused || video.ended) return;
      video.controls = true;
      updateVideoPlaySurface(video);
    };
    video.onerror = () => {
      if (request !== state.viewerRequest) return;
      gallery.cycling = false;
      video.controls = true;
      updateVideoPlaySurface(video);
      ui.galleryStop.disabled = true;
      setViewerStatus('This video could not be played.');
    };
    video.onended = () => {
      if (request !== state.viewerRequest || !ui.photoViewer.open || !gallery.cycling ||
          !video.ended || items.length < 2) return;
      gallery.index = (index + 1) % items.length;
      renderGallery(true);
    };
    const hasPoster = typeof item.posterUrl === 'string' && item.posterUrl.startsWith('Videos/');
    if (hasPoster) video.poster = new URL(item.posterUrl, profile.sourceUrl).href;
    else video.removeAttribute('poster');
    video.src = new URL(item.url, profile.sourceUrl).href;
    if (!currentVideo) ui.viewerStage.append(frame);
    if (continuePlaying) play();

    if (!hasPoster) {
      const poster = profile.photos.find(photo => photo.id === item.posterPhotoId) ||
        profile.photos.find(photo => photo.id === profile.portrait?.photoId);
      if (poster) {
        try {
          const picture = await pictures.load(profile, poster.id);
          if (request === state.viewerRequest) video.poster = picture.url;
        } catch { /* The video can play without its poster. */ }
      }
    }
    return;
  }

  setViewerStatus('Loading photo…');
  try {
    const picture = await pictures.load(profile, item.id);
    if (request !== state.viewerRequest) return;
    const image = document.createElement('img');
    image.className = 'gallery-media gallery-photo';
    image.src = picture.url;
    image.alt = item.description || profile.displayName;
    enablePhotoNavigation(image);
    ui.viewerStage.append(image);
    setViewerStatus('');
  } catch {
    if (request === state.viewerRequest) setViewerStatus('This photo could not be loaded.');
  }
}

function selectGallerySection(section) {
  const gallery = state.gallery;
  if (!gallery || section === gallery.section || !gallery.profile[section].length) return;
  gallery.section = section;
  gallery.index = 0;
  renderGallery();
}

function moveGallery(direction) {
  const gallery = state.gallery;
  if (!gallery) return;
  const count = gallery.profile[gallery.section].length;
  if (count < 2) return;
  let index = gallery.index + direction;
  if (gallery.section === 'photos') index = (index + count) % count;
  if (index < 0 || index >= count) return;
  gallery.index = index;
  renderGallery();
}

function enablePhotoNavigation(image) {
  let start;
  let tapped = false;
  image.draggable = false;
  image.onpointerdown = event => {
    if (start || !event.isPrimary || event.button !== 0) return;
    tapped = false;
    start = {id: event.pointerId, x: event.clientX, y: event.clientY};
    image.setPointerCapture(event.pointerId);
  };
  image.onlostpointercapture = event => {
    if (start?.id === event.pointerId) start = null;
  };
  image.onpointerup = event => {
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    const distance = Math.abs(dx);
    tapped = Math.hypot(dx, dy) <= 8;
    const threshold = Math.min(64, Math.max(24, image.clientWidth * 0.1));
    if (distance >= threshold && distance > Math.abs(dy) * 1.3) moveGallery(dx < 0 ? 1 : -1);
  };
  image.onclick = () => {
    if (tapped) moveGallery(1);
    tapped = false;
  };
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
  const videos = Array.isArray(profile.videos) ? profile.videos.filter(video =>
    video?.id && typeof video.url === 'string' && video.url.startsWith('Videos/')
  ) : [];
  return {...profile, videos};
}

ui.latest.addEventListener('click', () => selectCreator(null));
ui.closeViewer.addEventListener('click', () => ui.photoViewer.close());
ui.photoViewer.addEventListener('click', event => {
  if (event.target === ui.photoViewer || event.target === ui.viewerStage) ui.photoViewer.close();
});
ui.photoViewer.addEventListener('close', () => { if (!ui.photoViewer.open) resetViewer(); });
ui.profilePurchase.addEventListener('close', () => {
  if (!ui.profilePurchase.open) ui.profilePurchase.replaceChildren(ui.profilePurchaseHeading);
});
ui.galleryPhotos.addEventListener('click', () => selectGallerySection('photos'));
ui.galleryVideos.addEventListener('click', () => selectGallerySection('videos'));
ui.galleryPrevious.addEventListener('click', () => moveGallery(-1));
ui.galleryNext.addEventListener('click', () => moveGallery(1));
ui.galleryStop.addEventListener('click', () => {
  const video = ui.viewerStage.querySelector('video');
  if (!video || !state.gallery) return;
  state.gallery.cycling = false;
  video.pause();
  video.controls = true;
  video.load();
  updateVideoPlaySurface(video);
  ui.galleryStop.disabled = true;
  setViewerStatus('');
});
window.addEventListener('resize', fitViewer);
window.addEventListener('tilestorm-purchases-changed', () => {
  if (state.gallery && !hasCreatorAccess(state.gallery.profile.id, state.tabletPremium)) ui.photoViewer.close();
});
if (document.body.classList.contains('tablet-embedded')) {
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent ||
        event.data?.type !== 'eggbot-tablet-visibility') return;
    state.tabletPremium = event.data.premium === true;
    if (event.data.active) return;
    if (ui.photoViewer.open) ui.photoViewer.close();
    if (ui.profilePurchase.open) ui.profilePurchase.close();
  });
}
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
  if (state.selected === null && !state.pendingRender && ui.feedScroller.scrollTop <= 1 && state.newPosts) {
    state.newPosts = 0;
    refreshLatest();
  }
}, {passive: true});
window.addEventListener('pagehide', event => {
  if (state.gallery) {
    ui.photoViewer.close();
    resetViewer();
  }
  if (!event.persisted) { window.clearTimeout(state.timer); pictures.dispose(); imageObserver?.disconnect(); }
});

export async function start(tabletPremium) {
  state.tabletPremium = tabletPremium;
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
