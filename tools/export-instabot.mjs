// Copyright 2026 massivehadron.com ltd.

import {copyFile, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const unity = path.resolve(process.argv[2] || path.join(repository, '..', 'TileStormEvolution'));
const application = path.join(unity, 'Assets', 'Application');
const resources = path.join(application, 'EggbotProfiles', 'Resources');
const source = path.join(resources, 'Eggbots');
const destination = path.join(repository, 'instabot-preview-d31b7e4c');
const copyright = 'Copyright 2026 massivehadron.com ltd.';

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function writeJson(filename, data) {
  await writeFile(filename, JSON.stringify(data, null, 2) + '\n');
}

async function copyPhotos(photos, sourceDirectory, target) {
  await mkdir(target, {recursive: true});
  if (!photos.length) return [];

  const files = await readdir(sourceDirectory, {withFileTypes: true});
  const images = files.filter(file => file.isFile() && /\.(jpe?g|png)$/i.test(file.name));
  const destinationPhotos = path.join(target, 'Photos');
  await mkdir(destinationPhotos, {recursive: true});

  const copied = [];
  for (const photo of photos) {
    const matches = images.filter(file => path.parse(file.name).name.toLowerCase() === photo.stem.toLowerCase());
    if (matches.length !== 1) throw new Error(`Expected one image for ${path.join(sourceDirectory, photo.stem)}.`);
    const filename = matches[0].name;
    await copyFile(path.join(sourceDirectory, filename), path.join(destinationPhotos, filename));
    const {stem, ...record} = photo;
    copied.push({...record, url: 'Photos/' + encodeURIComponent(filename)});
  }
  return copied;
}

const profiles = [];
const entries = await readdir(source, {withFileTypes: true});
for (const directory of entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const root = path.join(source, directory.name);
  const authored = await readJson(path.join(root, 'profile.json'));
  const social = authored.instabot;
  if (!social?.enabled) continue;
  if (authored.id !== directory.name || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(authored.id)) {
    throw new Error(`Unexpected profile ID in ${directory.name}.`);
  }

  const usedPhotos = new Set([...(social.posts ?? []), ...(social.updates ?? [])].map(post => post.photoId));
  if (social.showAvatar && authored.portrait?.photoId) usedPhotos.add(authored.portrait.photoId);
  const photoRecords = (authored.photos ?? []).filter(photo => usedPhotos.has(photo.id));
  if (photoRecords.length !== usedPhotos.size) throw new Error(`Missing photo reference in ${authored.id}.`);
  const target = path.join(destination, 'profiles', authored.id);
  const photos = await copyPhotos(photoRecords.map(photo => ({...photo, stem: path.basename(photo.resource)})),
    path.join(root, 'Photos'), target);
  await writeJson(path.join(target, 'profile.json'), {
    copyright: authored.copyright || copyright,
    schemaVersion: 1,
    id: authored.id,
    displayName: authored.displayName,
    handle: authored.handle || authored.id,
    location: authored.location,
    portrait: authored.portrait,
    maxImageDimension: authored.maxImageDimension,
    photos,
    instabot: social
  });
  profiles.push(`profiles/${authored.id}/profile.json`);
}

const tablet = await readJson(path.join(resources, 'EggbotTabletContent.json'));
const ownerPosts = (tablet.ownerPosts ?? []).map(({resource, ...post}) => ({...post, photoId: path.basename(resource)}));
const portraitId = path.basename(tablet.ownerPortraitResource);
const ownerPhotoIds = new Set([portraitId, ...ownerPosts.map(post => post.photoId)]);
const ownerTarget = path.join(destination, 'profiles', 'eggbot');
const ownerPhotos = await copyPhotos([...ownerPhotoIds].map(id => ({id, stem: id})),
  path.join(application, 'EggbotCrib', 'Resources', 'EggbotCrib'), ownerTarget);
await writeJson(path.join(ownerTarget, 'profile.json'), {
  copyright, schemaVersion: 1, id: 'eggbot', displayName: 'Eggbot', handle: 'eggbot',
  biography: tablet.ownerBiography,
  followers: tablet.followers ?? 4,
  following: tablet.following ?? 418,
  portrait: {photoId: portraitId, crop: tablet.ownerPortraitCrop},
  photos: ownerPhotos,
  instabot: {enabled: true, showAvatar: true, posts: ownerPosts}
});

await copyFile(path.join(application, 'Instabot', 'Resources', 'Instabot', 'Textures', 'icon.png'),
  path.join(destination, 'icon.png'));
await writeJson(path.join(destination, 'catalogue.json'), {
  copyright, schemaVersion: 1, owner: 'profiles/eggbot/profile.json', profiles,
  appActivityUpdates: tablet.appActivityUpdates ?? [],
  feed: {firstUpdateSeconds: 30, minUpdateSeconds: 45, maxUpdateSeconds: 90}
});
console.log(`Copied ${profiles.length} Instabot profiles and Eggbot's profile.`);
