// Copyright 2026 massivehadron.com ltd.

// Copy a standalone content snapshot. The Unity checkout is only ever read.
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unity = path.resolve(process.argv[2] || path.join(repository, '..', 'TileStormEvolution'));
const source = path.join(unity, 'Assets', 'Application', 'EggbotProfiles', 'Editor', 'Content', 'Eggbots');
const destination = path.join(repository, 'onlybots-preview-8c7e4f2a');
const copyright = `Copyright ${new Date().getFullYear()} massivehadron.com ltd.`;
const catalogue = {
  copyright, schemaVersion: 1,
  feed: {firstUpdateSeconds: 20, minUpdateSeconds: 35, maxUpdateSeconds: 65, retainedUpdates: 24},
  profiles: []
};
let photoCount = 0;
let videoCount = 0;

async function copyVideoAsset(root, target, relative, extension, profileId) {
  const parts = typeof relative === 'string' ? relative.split('/') : [];
  if (parts.length < 2 || parts[0] !== 'Videos' ||
      parts.some(part => !part.trim() || part === '.' || part === '..' || /[\\:*?"<>|\x00-\x1f]/.test(part))) {
    throw new Error('Unexpected video asset path for ' + profileId);
  }
  const file = relative + extension;
  let bytes;
  try {
    bytes = await readFile(path.join(root, file));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.warn('Skipped missing OnlyBots video asset ' + profileId + '/' + file);
    return null;
  }
  const output = path.join(target, file);
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, bytes);
  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return file.split('/').map(encodeURIComponent).join('/') + '?v=' + version;
}

async function copyVideos(profile, root, target) {
  const videos = [];
  for (const video of profile.videos || []) {
    if (!video?.id) throw new Error('Missing video ID for ' + profile.id);
    const url = await copyVideoAsset(root, target, video.resource, '.mp4', profile.id);
    if (!url) continue;
    const posterUrl = video.posterResource && await copyVideoAsset(root, target, video.posterResource, '.png', profile.id);
    videos.push({...video, url, ...(posterUrl ? {posterUrl} : {})});
    videoCount++;
  }
  return videos;
}

for (const directory of await readdir(source, {withFileTypes: true})) {
  if (!directory.isDirectory()) continue;
  const root = path.join(source, directory.name);
  const authored = JSON.parse((await readFile(path.join(root, 'profile.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!authored.onlyBots?.enabled) continue;
  if (authored.id !== directory.name || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(authored.id)) throw new Error('Unexpected profile ID.');
  const target = path.join(destination, 'profiles', authored.id);
  await mkdir(path.join(target, 'Photos'), {recursive: true});
  const files = await readdir(path.join(root, 'Photos'), {withFileTypes: true});
  const photos = [];
  for (const photo of authored.photos || []) {
    const relative = photo.resource;
    if (typeof relative !== 'string' || !relative.startsWith('Photos/') || relative.includes('..') || relative.includes('\\')) throw new Error('Unexpected photo path.');
    const name = relative.substring(7);
    const matches = files.filter(file => file.isFile() && /\.(jpe?g|png)$/i.test(file.name) &&
      path.parse(file.name).name === name);
    if (matches.length !== 1) throw new Error('Expected one PNG or JPEG for ' + authored.id + '/' + relative);
    const filename = matches[0].name;
    const bytes = await readFile(path.join(root, 'Photos', filename));
    await writeFile(path.join(target, 'Photos', filename), bytes);
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    photos.push({...photo, url: 'Photos/' + encodeURIComponent(filename) + '?v=' + version});
    photoCount++;
  }
  const videos = await copyVideos(authored, root, target);
  const profile = {
    copyright: authored.copyright || copyright, schemaVersion: 1,
    id: authored.id, displayName: authored.displayName, handle: authored.handle,
    biography: authored.biography, maxImageDimension: authored.maxImageDimension ?? 2048,
    photos, ...(videos.length ? {videos} : {}), portrait: authored.portrait, onlyBots: authored.onlyBots
  };
  await writeFile(path.join(target, 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
  catalogue.profiles.push('profiles/' + authored.id + '/profile.json');
}

await copyFile(path.join(unity, 'Assets', 'Application', 'OnlyBots', 'Resources', 'OnlyBots', 'Textures', 'onlybots.jpg'), path.join(destination, 'icon.jpg'));
await writeFile(path.join(destination, 'catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');
console.log(`Copied ${catalogue.profiles.length} OnlyBots profiles, ${photoCount} photos and ${videoCount} ${videoCount === 1 ? 'video' : 'videos'} from Unity.`);
