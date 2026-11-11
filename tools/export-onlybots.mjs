// Copyright 2026 massivehadron.com ltd.

// Copy a standalone content snapshot. The Unity checkout is only ever read.
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unity = path.resolve(process.argv[2] || path.join(repository, '..', 'TileStormEvolution'));
const source = path.join(unity, 'Assets', 'Application', 'EggbotProfiles', 'Resources', 'Eggbots');
const destination = path.join(repository, 'onlybots-preview-8c7e4f2a');
const copyright = 'Copyright 2026 massivehadron.com ltd.';
// These profiles are authored in the web preview and survive a Unity snapshot refresh.
const webOnlyProfileIds = new Set(['kelly_bot']);
const catalogue = {
  copyright, schemaVersion: 1,
  feed: {firstUpdateSeconds: 20, minUpdateSeconds: 35, maxUpdateSeconds: 65, retainedUpdates: 24},
  profiles: []
};
let photoCount = 0;

for (const directory of await readdir(source, {withFileTypes: true})) {
  if (!directory.isDirectory()) continue;
  const root = path.join(source, directory.name);
  const authored = JSON.parse(await readFile(path.join(root, 'profile.json'), 'utf8'));
  if (!authored.onlyBots?.enabled || webOnlyProfileIds.has(authored.id)) continue;
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
    await copyFile(path.join(root, 'Photos', filename), path.join(target, 'Photos', filename));
    photos.push({...photo, url: 'Photos/' + filename});
    photoCount++;
  }
  const profile = {
    copyright: authored.copyright || copyright, schemaVersion: 1,
    id: authored.id, displayName: authored.displayName, handle: authored.handle,
    biography: authored.biography, maxImageDimension: authored.maxImageDimension ?? 2048,
    photos, portrait: authored.portrait, onlyBots: authored.onlyBots
  };
  await writeFile(path.join(target, 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
  catalogue.profiles.push('profiles/' + authored.id + '/profile.json');
}

await copyFile(path.join(unity, 'Assets', 'Application', 'OnlyBots', 'Resources', 'OnlyBots', 'Textures', 'onlybots.jpg'), path.join(destination, 'icon.jpg'));
for (const id of webOnlyProfileIds) catalogue.profiles.push('profiles/' + id + '/profile.json');
await writeFile(path.join(destination, 'catalogue.json'), JSON.stringify(catalogue, null, 2) + '\n');
console.log('Copied ' + (catalogue.profiles.length - webOnlyProfileIds.size) + ' OnlyBots profiles and ' + photoCount + ' photos from Unity.');
