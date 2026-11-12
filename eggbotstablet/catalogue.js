// Copyright 2026 massivehadron.com ltd.

import {fetchFile} from '../tablet-preview/shared.js';
import {element, image} from './ui.js';

const source = new URL('https://eggbot-content.qrh.workers.dev/catalogue.json');

export async function loadCatalogue() {
  const data = await fetchFile(source);
  if (data.schemaVersion !== 1 || !Array.isArray(data.profiles) || !data.tablet) {
    throw new Error('Eggbot’s content catalogue is unavailable.');
  }
  const files = new Map([...(data.media ?? []), ...(data.scratchMedia ?? [])].map(item => [item.resource, item.file]));
  const profiles = new Map(data.profiles.map(profile => [profile.id, profile]));
  const owner = profiles.get('eggbot');

  function media(resource) {
    const file = files.get(resource);
    return file ? new URL(file, source).href : '';
  }

  function photo(profile, id) {
    const entry = profile?.photos?.find(item => item.id === id);
    return entry ? media('Eggbots/' + profile.id + '/' + entry.resource) : '';
  }

  function avatar(profile, name, colour = '#30514c') {
    const initials = name.startsWith('+') ? '?' : name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    const face = element('span', 'avatar', initials);
    face.style.backgroundColor = colour;
    const url = photo(profile, profile?.portrait?.photoId);
    if (url) {
      const portrait = image(url);
      portrait.loading = 'lazy';
      portrait.addEventListener('error', () => portrait.remove(), {once: true});
      const crop = profile.portrait.crop;
      if (crop?.width > 0 && crop.height > 0) {
        portrait.style.width = 100 / crop.width + '%';
        portrait.style.height = 100 / crop.height + '%';
        portrait.style.left = -100 * crop.x / crop.width + '%';
        portrait.style.top = -100 * (1 - crop.y - crop.height) / crop.height + '%';
      }
      face.append(portrait);
    }
    return face;
  }

  return {profiles: data.profiles, owner, tablet: data.tablet, media, photo, avatar,
    name: id => profiles.get(id)?.displayName ?? id};
}
