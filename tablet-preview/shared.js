// Copyright 2026 massivehadron.com ltd.

export function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const other = Math.floor(Math.random() * (i + 1));
    [result[i], result[other]] = [result[other], result[i]];
  }
  return result;
}

export async function fetchFile(url, format = 'json') {
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

export function blobFromCanvas(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('The photo could not be prepared.')),
    'image/jpeg', .94
  ));
}

// All displayed and exported pictures use the resized copy. No Unity assets are loaded at runtime.
export const pictures = {
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
