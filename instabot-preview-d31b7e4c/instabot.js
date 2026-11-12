// Copyright 2026 massivehadron.com ltd.

import {blobFromCanvas, fetchFile, pictures, shuffle} from '../tablet-preview/shared.js';

const ui = Object.fromEntries([
  'latest', 'profilePanel', 'profile', 'feedColumn', 'stories', 'status', 'feed',
  'activityPanel', 'activityCount', 'activity', 'viewer', 'viewerHeading', 'viewerBody',
  'closeViewer', 'notice'
].map(id => [id, document.getElementById(id)]));

const state = {
  owner: null, profiles: [], posts: [], ownerPosts: [], activity: [], arrivals: [], creators: [],
  watched: new Map(), cards: new Map(), unseen: 0, initialCount: 0, updateTimer: 0,
  storyFrame: 0, noticeTimer: 0, timeTimer: 0
};
const app = {handle: 'instabot'};
const avatarColours = ['#2d4f46', '#573d58', '#3a4665', '#664732', '#414f33'];
const fullCrop = {x: 0, y: 0, width: 1, height: 1};
const number = new Intl.NumberFormat('en-GB');
const embedded = window.parent !== window && new URLSearchParams(location.search).has('tablet');
let tabletActive = false;
let openedInTablet = false;
if (embedded) {
  document.body.classList.add('tablet-embedded');
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent ||
        event.data?.type !== 'eggbot-tablet-visibility') return;
    tabletActive = event.data.active;
    if (!tabletActive) {
      if (ui.viewer.open) ui.viewer.close();
      return;
    }
    if (!openedInTablet) {
      const wide = !window.matchMedia('(max-width: 960px)').matches;
      ui.profilePanel.open = wide;
      ui.activityPanel.open = wide;
      openedInTablet = true;
    }
    state.unseen = 0;
    refreshActivityCount();
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, action) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function ago(when) {
  const minutes = Math.max(0, Math.floor((Date.now() - when) / 60000));
  if (minutes === 0) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function timeLabel(when) {
  const time = element('time', '', ago(when));
  time.dateTime = new Date(when).toISOString();
  return time;
}

function authoredText(className, author, text) {
  const line = element('p', className);
  line.append(element('strong', '', author), ' ');
  for (const part of (text || '').split(/(#[\p{L}\p{N}_]+)/u)) {
    line.append(part.startsWith('#') ? element('span', 'tag', part) : part);
  }
  return line;
}

function squareCrop(photo, crop = fullCrop) {
  if (crop.width < .99 || crop.height < .99) return crop;
  const side = Math.min(photo.width, photo.height);
  const width = side / photo.width;
  const height = side / photo.height;
  return {x: (1 - width) / 2, y: (1 - height) / 2, width, height};
}

const photoJobs = new WeakMap();
const photoObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    photoObserver.unobserve(entry.target);
    photoJobs.get(entry.target)?.();
    photoJobs.delete(entry.target);
  }
}, {rootMargin: '450px 0px'}) : null;

function fillPhoto(frame, profile, photoId, crop, alt, lazy) {
  const load = async () => {
    try {
      const photo = await pictures.load(profile, photoId);
      if (!frame.isConnected) return;
      const rect = squareCrop(photo, crop);
      const image = new Image();
      image.src = photo.url;
      image.alt = alt;
      image.draggable = false;
      image.style.width = `${100 / rect.width}%`;
      image.style.height = `${100 / rect.height}%`;
      image.style.left = `${-100 * rect.x / rect.width}%`;
      image.style.top = `${-100 * (1 - rect.y - rect.height) / rect.height}%`;
      frame.replaceChildren(image);
    } catch {
      if (alt) frame.textContent = 'Photo unavailable';
    }
  };
  if (lazy && photoObserver) {
    photoJobs.set(frame, load);
    photoObserver.observe(frame);
  } else {
    load();
  }
}

function avatar(profile, lazy = false) {
  const name = profile.displayName || profile.handle;
  const frame = element('span', 'avatar', name.slice(0, 1).toUpperCase());
  frame.setAttribute('aria-hidden', 'true');
  const colour = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  frame.style.setProperty('--avatar-colour', avatarColours[colour % avatarColours.length]);
  if (profile.instabot?.showAvatar && profile.portrait?.photoId) {
    fillPhoto(frame, profile, profile.portrait.photoId, profile.portrait.crop, '', lazy);
  }
  return frame;
}

function postPhoto(post, lazy = false) {
  const frame = element('span', 'photo-frame', 'Loading photo…');
  fillPhoto(frame, post.profile, post.photoId, post.crop, `Photo by ${post.profile.handle}`, lazy);
  return frame;
}

function makePost(profile, source, when) {
  return {
    profile, when,
    place: source.place || profile.location || '',
    photoId: source.photoId,
    crop: source.crop || fullCrop,
    caption: source.caption || '',
    likes: source.likes || 0,
    liked: false,
    comments: (source.comments ?? []).filter(comment => comment?.text).map(comment => ({
      author: comment.author || 'eggbot', text: comment.text,
      when: Math.max(when, Date.now() - (comment.minutesAgo || 0) * 60000)
    }))
  };
}

function likesLabel(post) {
  if (!post.likes) return 'Be the first to like this';
  return `${number.format(post.likes)} ${post.likes === 1 ? 'like' : 'likes'}`;
}

function makeCard(post) {
  const card = element('article', 'post');
  const header = element('header', 'post-header');
  const name = element('div');
  name.append(element('h2', '', post.profile.handle));
  if (post.place) name.append(element('small', '', post.place));
  header.append(avatar(post.profile, true), name);

  const photo = button('', 'photo-button', () => openPost(post));
  photo.setAttribute('aria-label', `View photo by ${post.profile.handle}`);
  photo.append(postPhoto(post, true));

  const actions = element('div', 'post-actions');
  const likes = element('p', 'likes', likesLabel(post));
  const heart = element('span', 'heart', '♡');
  heart.setAttribute('aria-hidden', 'true');
  const likeLabel = element('span', '', 'Like');
  const like = button('', 'text-button like-button', () => {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    like.setAttribute('aria-pressed', String(post.liked));
    heart.textContent = post.liked ? '♥' : '♡';
    likeLabel.textContent = post.liked ? 'Liked' : 'Like';
    likes.textContent = likesLabel(post);
  });
  like.setAttribute('aria-pressed', 'false');
  like.append(heart, likeLabel);
  const share = button('Share', 'text-button', () => sharePhoto(post, share));
  actions.append(like, share);

  const body = element('div', 'post-body');
  body.append(actions, likes, authoredText('caption', post.profile.handle, post.caption));
  for (const comment of post.comments.slice(-2)) body.append(authoredText('comment', comment.author, comment.text));
  const commentsLabel = post.comments.length ? `View all ${post.comments.length} comments` : 'View comments';
  body.append(button(commentsLabel, 'text-button comments-button', () => openPost(post, true)), timeLabel(post.when));
  card.append(header, photo, body);
  return card;
}

function latestPost(profile) {
  return state.posts.find(post => post.profile === profile);
}

function refreshStoryRings() {
  for (const story of ui.stories.children) {
    const id = story.dataset.profile;
    const post = state.posts.find(item => item.profile.id === id);
    story.classList.toggle('seen', !post || state.watched.get(id) === post);
  }
}

function buildStories() {
  const storyProfiles = state.profiles.filter(profile => profile.instabot.showStory &&
    ((profile.instabot.posts?.length ?? 0) + (profile.instabot.updates?.length ?? 0) > 0));
  storyProfiles.sort((a, b) => (a.instabot.storyOrder || 0) - (b.instabot.storyOrder || 0));
  for (const profile of [state.owner, ...storyProfiles]) {
    const label = profile === state.owner ? 'Your story' : profile.handle;
    const story = button('', 'story', () => openStory(profile));
    story.dataset.profile = profile.id;
    story.setAttribute('aria-label', label);
    story.append(avatar(profile, true), element('span', '', label));
    ui.stories.append(story);
  }
  ui.stories.hidden = false;
  refreshStoryRings();
}

function buildProfile() {
  const portrait = button('', 'profile-portrait', () => openStory(state.owner));
  portrait.setAttribute('aria-label', 'Your story');
  portrait.append(avatar(state.owner));
  const stats = element('dl', 'profile-stats');
  for (const [label, value] of [
    ['posts', state.ownerPosts.length], ['followers', state.owner.followers], ['following', state.owner.following]
  ]) {
    const stat = element('div');
    const count = element('dd', '', number.format(value));
    if (label === 'followers') count.id = 'followers';
    stat.append(element('dt', '', label), count);
    stats.append(stat);
  }
  const gallery = element('div', 'profile-posts');
  for (const post of state.ownerPosts) {
    const thumb = button('', '', () => openPost(post));
    thumb.setAttribute('aria-label', `View Eggbot's post from ${post.place}`);
    thumb.append(postPhoto(post, true), element('small', 'profile-likes', `♥ ${number.format(post.likes)}`));
    gallery.append(thumb);
  }
  ui.profile.append(portrait, element('p', '', state.owner.biography || ''), stats, gallery);
}

function showViewer(title, content, timed = false) {
  window.cancelAnimationFrame(state.storyFrame);
  ui.viewerHeading.textContent = title;
  ui.viewerBody.replaceChildren(content);
  if (!ui.viewer.open) ui.viewer.showModal();
  ui.viewer.scrollTop = 0;
  if (!timed) return;

  const progress = element('progress', 'story-timer');
  progress.max = 5000;
  progress.value = 0;
  progress.setAttribute('aria-label', 'Story time remaining');
  ui.viewerBody.prepend(progress);
  const started = performance.now();
  function tick(now) {
    progress.value = Math.min(now - started, progress.max);
    if (progress.value >= progress.max) ui.viewer.close();
    else state.storyFrame = window.requestAnimationFrame(tick);
  }
  state.storyFrame = window.requestAnimationFrame(tick);
}

function openStory(profile) {
  if (profile === state.owner) {
    showViewer('Your story', element('p', 'caption', "You haven't added anything to your story.\n\nAdding to your story needs 1.2 GB free. This tablet has 12 MB."));
    return;
  }
  const post = latestPost(profile);
  if (!post) {
    const message = profile.instabot?.privateAccount ? ' is a private account.' : " hasn't posted anything yet.";
    toast(profile.handle + message);
    return;
  }
  state.watched.set(profile.id, post);
  refreshStoryRings();
  const content = element('div');
  content.append(postPhoto(post), authoredText('caption', profile.handle, post.caption));
  showViewer(profile.handle, content, true);
}

function openPost(post, jumpToComments = false) {
  const content = element('div');
  if (post.place) content.append(element('p', 'status', post.place));
  content.append(postPhoto(post), element('p', 'likes', likesLabel(post)),
    authoredText('caption', post.profile.handle, post.caption), timeLabel(post.when));
  const comments = element('section');
  comments.append(element('h3', '', 'Comments'));
  if (!post.comments.length) comments.append(element('p', 'comment', 'No comments yet.'));
  for (const comment of post.comments) {
    const line = authoredText('comment', comment.author, comment.text);
    line.append(' ', timeLabel(comment.when));
    comments.append(line);
  }
  content.append(comments);
  showViewer(post.profile.handle, content);
  if (jumpToComments) ui.viewer.scrollTop = ui.viewer.scrollHeight;
}

function toast(message) {
  window.clearTimeout(state.noticeTimer);
  ui.notice.textContent = message;
  ui.notice.hidden = false;
  state.noticeTimer = window.setTimeout(() => { ui.notice.hidden = true; }, 3000);
}

async function sharePhoto(post, control) {
  control.disabled = true;
  try {
    const photo = await pictures.load(post.profile, post.photoId);
    const crop = squareCrop(photo, post.crop);
    const image = new Image();
    image.src = photo.url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.width * crop.width));
    canvas.height = Math.max(1, Math.round(photo.height * crop.height));
    const context = canvas.getContext('2d');
    context.drawImage(image, crop.x * photo.width, (1 - crop.y - crop.height) * photo.height,
      crop.width * photo.width, crop.height * photo.height, 0, 0, canvas.width, canvas.height);
    const blob = await blobFromCanvas(canvas);
    canvas.width = canvas.height = 0;
    const file = new File([blob], `instabot-${post.profile.id}.jpg`, {type: 'image/jpeg'});
    const data = {title: `Instabot · ${post.profile.handle}`, text: post.caption, files: [file]};
    if (navigator.canShare?.(data)) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const download = element('a');
    download.href = url;
    download.download = file.name;
    document.body.append(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Photo download prepared.');
  } catch {
    toast('The photo could not be shared. Please try again.');
  } finally {
    control.disabled = false;
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function makeActivity(profile, source, when) {
  const text = source.text || '';
  const comment = source.comment || /^commented/i.test(text) ||
    ((source.kind ?? 'comment') === 'comment' && !/^(liked |started following|unfollowed)/i.test(text));
  let post = null;
  if (comment && state.ownerPosts.length) {
    post = state.ownerPosts[source.postIndex] || randomItem(state.ownerPosts);
    const colon = text.indexOf(':');
    post.comments.push({author: profile.handle, text: source.comment || text.slice(colon + 1).trim(), when});
  }
  return {profile, text, when, post};
}

function refreshActivityCount() {
  if (tabletActive) state.unseen = 0;
  ui.activityCount.hidden = state.unseen === 0;
  ui.activityCount.textContent = number.format(state.unseen);
  if (embedded) window.parent.postMessage({type: 'eggbot-tablet-activity', count: state.unseen}, location.origin);
}

function openActivity(item) {
  state.unseen = 0;
  refreshActivityCount();
  if (item.post) openPost(item.post, true);
  else if (item.profile === app) toast('Boost declined. Droid Bank says no.');
  else openStory(item.profile);
}

function renderActivity() {
  ui.activity.replaceChildren(...state.activity.slice(0, 9).map(item => {
    const row = button('', 'activity-item', () => openActivity(item));
    const details = element('span');
    details.append(element('strong', '', item.profile.handle), ' ', item.text, timeLabel(item.when));
    row.append(avatar(item.profile), details);
    return row;
  }));
  refreshActivityCount();
}

function seedFeed() {
  const now = Date.now();
  const groups = state.profiles.map(profile => shuffle((profile.instabot.posts ?? []).map(source => ({profile, source}))));
  const ages = groups.flat().map(item => item.source.minutesAgo || 0).sort((a, b) => a - b);
  const mixed = [];
  while (groups.some(group => group.length)) {
    const round = shuffle(groups.filter(group => group.length));
    if (round.length > 1 && round[0][0].profile === mixed.at(-1)?.profile) {
      [round[0], round[1]] = [round[1], round[0]];
    }
    for (const group of round) mixed.push(group.pop());
  }
  const featured = new Set(state.profiles.filter(profile => profile.instabot.featured));
  const opening = mixed.filter(item => featured.delete(item.profile));
  const featuredPosts = new Set(opening);
  const timeline = [...shuffle(opening), ...mixed.filter(item => !featuredPosts.has(item))];
  state.posts = timeline.map(({profile, source}, index) => makePost(profile, source, now - ages[index] * 60000));
  state.initialCount = state.posts.length;
  state.ownerPosts = state.owner.instabot.posts.map(source => makePost(state.owner, source, now - (source.minutesAgo || 0) * 60000));
  for (const profile of state.profiles) {
    for (const item of profile.instabot.activity ?? []) {
      state.activity.push(makeActivity(profile, item, now - (item.minutesAgo || 0) * 60000));
    }
  }
  state.activity.sort((a, b) => b.when - a.when);
  state.unseen = Math.min(state.activity.length, 9);
}

function weighted(items) {
  let roll = Math.random() * items.reduce((sum, item) => sum + item.weight, 0);
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items.at(-1);
}

function drawPost() {
  const alternatives = state.creators.filter(creator => creator.profile !== state.posts[0]?.profile);
  const creator = weighted(alternatives.length ? alternatives : state.creators);
  if (!creator.deck.length) {
    creator.deck = shuffle(creator.profile.instabot.updates);
    const lastIndex = creator.deck.length - 1;
    if (lastIndex > 0 && creator.deck[lastIndex] === creator.last) {
      [creator.deck[0], creator.deck[lastIndex]] = [creator.deck[lastIndex], creator.deck[0]];
    }
  }
  creator.last = creator.deck.pop();
  const post = makePost(creator.profile, creator.last, Date.now());
  state.posts.unshift(post);
  const card = makeCard(post);
  state.cards.set(post, card);
  ui.feed.prepend(card);
  if (state.posts.length > state.initialCount + 24) {
    const [removed] = state.posts.splice(24, 1);
    const removedCard = state.cards.get(removed);
    removedCard.querySelectorAll('.photo-frame, .avatar').forEach(frame => photoObserver?.unobserve(frame));
    removedCard.remove();
    state.cards.delete(removed);
  }
  refreshStoryRings();
}

function deliverActivity() {
  const {profile, source} = weighted(state.arrivals);
  if (source.kind === 'like' && state.ownerPosts.length) {
    const post = randomItem(state.ownerPosts);
    post.likes++;
    const count = ui.profile.querySelectorAll('.profile-likes')[state.ownerPosts.indexOf(post)];
    count.textContent = `♥ ${number.format(post.likes)}`;
  }
  if (source.kind === 'follow') state.owner.followers++;
  if (source.kind === 'unfollow') state.owner.followers = Math.max(0, state.owner.followers - 1);
  document.getElementById('followers').textContent = number.format(state.owner.followers);
  state.activity.unshift(makeActivity(profile, source, Date.now()));
  if (state.activity.length > 9) state.activity.length = 9;
  state.unseen = Math.min(state.unseen + 1, 9);
  renderActivity();
  if (embedded && !tabletActive) {
    window.parent.postMessage({type: 'eggbot-tablet-activity', count: state.unseen,
      message: profile.handle + ' · ' + source.text}, location.origin);
  }
}

function scheduleUpdates(feed, delay = feed.firstUpdateSeconds) {
  if (!state.creators.length && !state.arrivals.length) return;
  state.updateTimer = window.setTimeout(() => {
    if (state.creators.length && (!state.arrivals.length || Math.random() < .4)) drawPost();
    else deliverActivity();
    scheduleUpdates(feed, feed.minUpdateSeconds + Math.random() * (feed.maxUpdateSeconds - feed.minUpdateSeconds));
  }, delay * 1000);
}

async function loadProfile(relative) {
  const sourceUrl = new URL(relative, import.meta.url);
  const profile = await fetchFile(sourceUrl);
  if (profile?.schemaVersion !== 1 || !profile.id || !profile.handle || !profile.instabot?.enabled) {
    throw new Error('The catalogue contains an invalid profile.');
  }
  return {...profile, sourceUrl};
}

ui.latest.addEventListener('click', () => {
  ui.feedColumn.scrollIntoView({block: 'start'});
  ui.feedColumn.focus({preventScroll: true});
});
ui.closeViewer.addEventListener('click', () => ui.viewer.close());
ui.viewer.addEventListener('click', event => {
  if (event.target === ui.viewer) ui.viewer.close();
});
ui.viewer.addEventListener('close', () => {
  window.cancelAnimationFrame(state.storyFrame);
  ui.viewerBody.replaceChildren();
});
ui.activityPanel.addEventListener('toggle', () => {
  if (ui.activityPanel.open) {
    state.unseen = 0;
    refreshActivityCount();
  }
});
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  window.clearTimeout(state.updateTimer);
  window.clearInterval(state.timeTimer);
  photoObserver?.disconnect();
  pictures.dispose();
});

async function start() {
  try {
    if (!openedInTablet && window.matchMedia('(max-width: 960px)').matches) {
      ui.profilePanel.open = false;
      ui.activityPanel.open = false;
    }
    const catalogue = await fetchFile(new URL('./catalogue.json', import.meta.url));
    if (catalogue?.schemaVersion !== 1 || !catalogue.owner || !Array.isArray(catalogue.profiles)) {
      throw new Error('The feed catalogue is invalid.');
    }
    const [owner, ...profiles] = await Promise.all([catalogue.owner, ...catalogue.profiles].map(loadProfile));
    state.owner = owner;
    state.profiles = profiles;
    state.creators = profiles.filter(profile => profile.instabot.updates?.length && (profile.instabot.updateWeight ?? 1) > 0)
      .map(profile => ({profile, weight: profile.instabot.updateWeight ?? 1, deck: [], last: null}));
    state.arrivals = profiles.flatMap(profile => (profile.instabot.activityUpdates ?? []).map(source => ({profile, source})))
      .concat((catalogue.appActivityUpdates ?? []).map(source => ({profile: app, source})))
      .map(item => ({...item, weight: item.source.weight ?? 1})).filter(item => item.weight > 0);
    seedFeed();
    buildProfile();
    buildStories();
    renderActivity();
    for (const post of state.posts) {
      const card = makeCard(post);
      state.cards.set(post, card);
      ui.feed.append(card);
    }
    ui.status.hidden = state.posts.length > 0;
    ui.status.textContent = 'There are no posts yet.';
    ui.latest.disabled = false;
    scheduleUpdates({firstUpdateSeconds: 30, minUpdateSeconds: 45, maxUpdateSeconds: 90, ...catalogue.feed});
    state.timeTimer = window.setInterval(() => {
      for (const time of document.querySelectorAll('time[datetime]')) time.textContent = ago(Date.parse(time.dateTime));
    }, 15000);
  } catch (error) {
    ui.status.hidden = false;
    ui.status.setAttribute('role', 'alert');
    ui.status.textContent = `The feed could not load. ${error.name === 'AbortError' ? 'The request timed out.' : error.message} Reload to try again.`;
  }
}

start();
