// Browser encoding preparation. Plans are cheap; source resampling happens once,
// on Encode, directly from the retained original. No encoded image is resized.
(function (root) {
  "use strict";
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function prognosis(data, quality = .8, version = data?.carrierVersion ?? 5) {
    if (!data?.fits || !Number.isFinite(data.repetitionRatio)) return .99;
    const ratio = data.repetitionRatio, weak = data.parityBits === 1;
    const base = weak ? .95 : ratio < 2 ? .7 + .3 * clamp(2 - ratio, 0, 1)
      : ratio < 5 ? .25 + .35 * (5 - ratio) / 3 : Math.max(.04, 1 / ratio);
    const gain = root.PixelStow.estimateSignalGain(ratio, quality, version);
    return clamp(base - .2 * Math.log2(gain), weak ? .75 : ratio < 2 ? .5 : .04, .98);
  }
  function qualityForTarget(data, target, version = data?.carrierVersion ?? 5) {
    // Match the real 0.01 quality steps, including flat portions at hard limits.
    const best = prognosis(data, 0, version), worst = prognosis(data, 1, version);
    target = clamp(target, best, worst);
    let quality = .8, error = Infinity;
    for (let step = 0; step <= 100; step++) {
      const candidate = step / 100, distance = Math.abs(prognosis(data, candidate, version) - target);
      if (distance < error - 1e-12 || (Math.abs(distance - error) < 1e-12 && Math.abs(candidate - .8) < Math.abs(quality - .8))) {
        error = distance; quality = candidate;
      }
    }
    return { quality, risk: prognosis(data, quality, version), min: best, max: worst };
  }
  function maxDimensions(width, height, maxPixels = root.PixelStow.getLimits().encodingPixels) {
    const scale = Math.min(Math.sqrt(maxPixels / (width * height)), 65535 / width, 65535 / height);
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
  }
  function plan(width, height, framedBytes, quality, target, version = 5, maxPixels) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
      throw new Error("Choose a source image before sizing it.");
    const maximum = maxDimensions(width, height, maxPixels);
    const at = (scale) => {
      const w = Math.max(1, Math.min(maximum.width, Math.ceil(width * scale)));
      const h = Math.max(1, Math.min(maximum.height, Math.ceil(height * scale)));
      const budget = root.PixelStow.repetitionForFrame(w, h, framedBytes, version);
      return budget?.fits ? { ...budget, risk: prognosis(budget, quality, version), scale } : null;
    };
    const largest = at(maximum.scale);
    if (!largest) return { fits: false, reason: "The payload cannot fit within the 24-megapixel encoding limit at this aspect ratio." };
    let low = 0, high = maximum.scale;
    for (let i = 0; i < 44; i++) {
      const middle = (low + high) / 2;
      if (at(middle)) high = middle; else low = middle;
    }
    const smallest = at(high), min = largest.risk, max = Math.max(min, smallest.risk);
    const requested = clamp(Number.isFinite(target) ? target : .2, .04, .99);
    const reachable = clamp(requested, min, max);
    low = high; high = maximum.scale;
    // Solve for the smallest image meeting the selected margin. Only scalar
    // budgets are tested; payload compression is never repeated in this search.
    for (let i = 0; i < 44; i++) {
      const middle = (low + high) / 2, candidate = at(middle);
      if (candidate && candidate.risk <= reachable + 1e-10) high = middle; else low = middle;
    }
    const selected = at(high) || largest;
    return { ...selected, min, max, requested, target: reachable,
      limited: requested < min - .001, achieved: selected.risk <= requested + .002 };
  }
  async function resize(image, width, height, { signal } = {}) {
    const { pixels, width: sourceWidth, height: sourceHeight } = image;
    if (!pixels || pixels.length !== sourceWidth * sourceHeight * 4 ||
      sourceWidth * sourceHeight > root.PixelStow.getLimits().inputPixels ||
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > root.PixelStow.getLimits().encodingPixels) throw new Error("Invalid source or output dimensions for encoding.");
    const check = () => { if (signal?.aborted) throw new DOMException("Image sizing cancelled.", "AbortError"); };
    check();
    if (width === sourceWidth && height === sourceHeight) return { ...image, pixels: pixels.slice() };
    const output = new Uint8Array(width * height * 4), row = new Float64Array(width * 4), sum = new Float64Array(width * 4);
    const sx = sourceWidth / width, sy = sourceHeight / height;
    const rows = new Map();
    const horizontal = (y) => {
      if (rows.has(y)) return rows.get(y);
      row.fill(0);
      for (let x = 0; x < width; x++) {
        const first = sx >= 1 ? x * sx : clamp((x + .5) * sx - .5, 0, sourceWidth - 1);
        const last = sx >= 1 ? Math.min(sourceWidth, (x + 1) * sx) : Math.min(sourceWidth - 1, Math.floor(first) + 1);
        const denominator = sx >= 1 ? last - first : 1;
        for (let sourceX = Math.floor(first); sourceX <= Math.min(sourceWidth - 1, Math.ceil(last)); sourceX++) {
          const weight = sx >= 1 ? Math.max(0, Math.min(last, sourceX + 1) - Math.max(first, sourceX)) / denominator
            : sourceX === Math.floor(first) ? 1 - (first % 1) : first % 1;
          if (!weight) continue;
          const input = (sourceX + y * sourceWidth) * 4, alpha = pixels[input + 3] / 255, index = x * 4;
          for (let channel = 0; channel < 3; channel++) row[index + channel] += pixels[input + channel] * alpha * weight;
          row[index + 3] += pixels[input + 3] * weight;
        }
      }
      const result = row.slice();rows.set(y, result);
      if (rows.size > 2) rows.delete(rows.keys().next().value);
      return result;
    };
    for (let y = 0; y < height; y++) {
      if ((y & 15) === 0) { check(); await new Promise(resolve => setTimeout(resolve, 0)); }
      sum.fill(0);
      const first = sy >= 1 ? y * sy : clamp((y + .5) * sy - .5, 0, sourceHeight - 1);
      const last = sy >= 1 ? Math.min(sourceHeight, (y + 1) * sy) : Math.min(sourceHeight - 1, Math.floor(first) + 1);
      const denominator = sy >= 1 ? last - first : 1;
      for (let sourceY = Math.floor(first); sourceY <= Math.min(sourceHeight - 1, Math.ceil(last)); sourceY++) {
        const weight = sy >= 1 ? Math.max(0, Math.min(last, sourceY + 1) - Math.max(first, sourceY)) / denominator
          : sourceY === Math.floor(first) ? 1 - (first % 1) : first % 1;
        if (!weight) continue;
        const values = horizontal(sourceY);
        for (let i = 0; i < sum.length; i++) sum[i] += values[i] * weight;
      }
      for (let x = 0; x < width; x++) {
        const index = x * 4, alpha = sum[index + 3], target = (x + y * width) * 4;
        for (let channel = 0; channel < 3; channel++) output[target + channel] = Math.round(alpha ? sum[index + channel] * 255 / alpha : 0);
        output[target + 3] = Math.round(alpha);
      }
    }
    check(); return { pixels: output, width, height, exact: true };
  }
  async function prepare(image, content, passwordProtected, quality, target, version = root.PixelStow.getCarrierVersion()) {
    const frame = await root.PixelStow.estimatePayloadFrame(content, passwordProtected);
    if (!frame) throw new Error("Enter a message or add a file before sizing the source.");
    // Protection is checked on the original grid, before resizing can obscure
    // an existing (including locked or older-format) fingerprint.
    const existing = await root.PixelStow.inspect(image.pixels, image.width, image.height, { quickOnly: true, includeLegacy: true });
    if (existing.found) throw new Error("This image already contains a fingerprint. Choose a source picture without one.");
    const selected = plan(image.width, image.height, frame.framedBytes, quality, target, version);
    if (!selected.fits) throw new Error(selected.reason);
    return { image: image.width === selected.width && image.height === selected.height ? image
      : await resize(image, selected.width, selected.height), plan: selected };
  }
  root.PixelStowSizing = { prognosis, qualityForTarget, maxDimensions, plan, resize, prepare };
})(typeof window !== "undefined" ? window : self);
