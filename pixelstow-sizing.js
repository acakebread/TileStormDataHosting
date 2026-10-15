// Browser encoding preparation. Plans are cheap; source resampling happens once,
// on Encode, directly from the retained original. No encoded image is resized.
(function (root) {
  "use strict";
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const DEFAULT_REDUNDANCY = 2, MAX_REDUNDANCY = 3, DEFAULT_QUALITY = .8;
  function resolutionLoad(data) {
    // User-observed camera-friendly envelope, orientation independent. This is
    // a planning reference, not a hard codec limit or a calibrated probability.
    return Math.max(1, Math.sqrt((data?.width || 0) * (data?.height || 0) / (1200 * 800)));
  }
  function prognosis(data, quality = .8, version = data?.carrierVersion ?? 5) {
    if (!data?.fits || !Number.isFinite(data.repetitionRatio)) return .99;
    // Qualitative protection margin, not a camera success probability. Compare
    // coverage on the same 12-bit basis when reading reduced-parity carriers.
    const coverage = data.repetitionRatio * (data.parityBits === 1 ? 9 / 12 : 1);
    const anchor = (copies, base, floor) => {
      // Interpolate the nominal quality multiplier continuously; integer writer
      // strength steps must not create jumps when a quality bound is moving.
      const gain = [4, 5].includes(version) ? Math.min(2 ** (DEFAULT_QUALITY - quality),
        root.PixelStow.estimateSignalGain(copies, 0, version)) : 1;
      return clamp(base - .2 * Math.log2(gain), floor, .98);
    };
    const one = anchor(1, .9, .75), two = anchor(2, .6, .5), five = anchor(5, .2, .04);
    let protection;
    if (coverage < 1) protection = one + (1 - one) * .8 * clamp((1 - coverage) / .25, 0, 1);
    else if (coverage < 2) protection = one + (two - one) * (coverage - 1);
    else if (coverage < 5) protection = two + (five - two) * (coverage - 2) / 3;
    else protection = .04 + (five - .04) * 5 / coverage;
    // A denser native grid needs more captured samples. Even maximum signal
    // cannot buy back that sampling loss. Within the bounded 1x--3x size range,
    // repetition still helps, with diminishing returns beyond the reference.
    return clamp(1 - (1 - protection) / resolutionLoad(data), .04, .9999);
  }
  function scaledQuality(data, requested = DEFAULT_QUALITY, version = data?.carrierVersion ?? 5) {
    if (![4, 5].includes(version) || !data?.fits) return { quality: clamp(requested, 0, 1), min: 0, max: 1, strengthLimited: false };
    const coverage = data.repetitionRatio * (data.parityBits === 1 ? 9 / 12 : 1);
    // Conservative control envelope anchored at the accepted 2x / 80% setting.
    // Square-root repetition credit and linear native-pitch compensation are
    // heuristics, not optical measurements. Keep this envelope continuous;
    // expose real signal saturation separately rather than implying a guarantee.
    const requiredGain = Math.sqrt(DEFAULT_REDUNDANCY / Math.max(.01, coverage)) * resolutionLoad(data);
    const max = clamp(DEFAULT_QUALITY - Math.log2(requiredGain), 0, 1);
    return { quality: clamp(requested, 0, max), min: 0, max, requiredGain,
      strengthLimited: root.PixelStow.estimateSignalGain(data.repetitionRatio, 0, version) < requiredGain };
  }
  function qualityForTarget(data, target, version = data?.carrierVersion ?? 5) {
    // Search percentage-sized quality steps, including flat portions at limits.
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
  function sizeRange(width, height, framedBytes, version, maxPixels) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
      throw new Error("Choose a source image before sizing it.");
    const maximum = maxDimensions(width, height, maxPixels);
    if (maximum.width < 4 || maximum.height < 4) return null;
    const budgetAt = (scale) => {
      // Whole payload blocks avoid paying a resolution penalty for unused
      // border pixels, and keep the scale/quality envelope free of pixel seams.
      const w = Math.max(4, Math.min(Math.floor(maximum.width / 4) * 4, Math.ceil(width * scale / 4) * 4));
      const h = Math.max(4, Math.min(Math.floor(maximum.height / 4) * 4, Math.ceil(height * scale / 4) * 4));
      const budget = root.PixelStow.repetitionForFrame(w, h, framedBytes, version);
      return budget?.fits ? { ...budget, scale } : null;
    };
    const physicalMaximum = budgetAt(maximum.scale);
    if (!physicalMaximum) return null;
    // Keep the best parity available within the size limit throughout a size
    // gesture. Otherwise growing across the 9 -> 12-bit switch drops the raw
    // repeat count from ~1.33 to 1 despite adding error-correction protection.
    const at = (scale) => {
      const budget = budgetAt(scale);
      return budget?.parityBits === physicalMaximum.parityBits ? budget : null;
    };
    const forRedundancy = (target) => {
      if (target >= physicalMaximum.repetitionRatio) return physicalMaximum;
      let low = 0, high = maximum.scale;
      for (let i = 0; i < 44; i++) {
        const middle = (low + high) / 2, candidate = at(middle);
        if (candidate && candidate.repetitionRatio >= target) high = middle; else low = middle;
      }
      return at(high);
    };
    // These are the smallest native grids needed for each repeat budget, never
    // a percentage of the source's (possibly enormous) camera resolution.
    const smallest = forRedundancy(1), largest = forRedundancy(MAX_REDUNDANCY);
    return { at, forRedundancy, smallest, largest,
      recommended: forRedundancy(DEFAULT_REDUNDANCY), limited: physicalMaximum.repetitionRatio < MAX_REDUNDANCY };
  }
  function selection(range, scale) {
    const selected = range.at(clamp(Number.isFinite(scale) ? scale : 1, range.smallest.scale, range.largest.scale));
    return { ...selected, minimum: range.smallest, maximum: range.largest, recommended: range.recommended,
      forcedUpscale: selected.scale > 1, limited: range.limited };
  }
  function plan(width, height, framedBytes, redundancy = DEFAULT_REDUNDANCY, version = 5, maxPixels) {
    const range = sizeRange(width, height, framedBytes, version, maxPixels);
    const target = clamp(Number.isFinite(redundancy) ? redundancy : DEFAULT_REDUNDANCY, 1, MAX_REDUNDANCY);
    return range ? { ...selection(range, range.forRedundancy(target).scale), targetRedundancy: target } : { fits: false,
      reason: "The payload cannot fit within the 24-megapixel encoding limit at this aspect ratio." };
  }
  function planForTarget(width, height, framedBytes, quality, target, version = 5, maxPixels) {
    const range = sizeRange(width, height, framedBytes, version, maxPixels);
    if (!range) return plan(width, height, framedBytes, DEFAULT_REDUNDANCY, version, maxPixels);
    const riskAt = (data) => prognosis(data, scaledQuality(data, quality, version).quality, version);
    const min = riskAt(range.largest), max = riskAt(range.smallest);
    const reachable = clamp(Number.isFinite(target) ? target : max, min, max);
    if (reachable <= min) return selection(range, range.largest.scale);
    if (reachable >= max) return selection(range, range.smallest.scale);
    let low = range.smallest.scale, high = range.largest.scale;
    // Only this gesture selects resolution; quality changes keep the chosen
    // repeat target. Include its attainable intensity when reversing prognosis.
    for (let i = 0; i < 44; i++) {
      const middle = (low + high) / 2, candidate = range.at(middle);
      if (riskAt(candidate) > reachable) low = middle; else high = middle;
    }
    return selection(range, high);
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
  async function prepare(image, content, passwordProtected, redundancy = DEFAULT_REDUNDANCY, version = root.PixelStow.getCarrierVersion()) {
    const frame = await root.PixelStow.estimatePayloadFrame(content, passwordProtected);
    if (!frame) throw new Error("Enter a message or add a file before sizing the source.");
    // Protection is checked on the original grid, before resizing can obscure
    // an existing (including locked or older-format) fingerprint.
    const existing = await root.PixelStow.inspect(image.pixels, image.width, image.height, { quickOnly: true, includeLegacy: true });
    if (existing.found) throw new Error("This image already contains a fingerprint. Choose a source picture without one.");
    const selected = plan(image.width, image.height, frame.framedBytes, redundancy, version);
    if (!selected.fits) throw new Error(selected.reason);
    return { image: image.width === selected.width && image.height === selected.height ? image
      : await resize(image, selected.width, selected.height), plan: selected };
  }
  root.PixelStowSizing = { prognosis, scaledQuality, resolutionLoad, qualityForTarget, maxDimensions, plan, planForTarget, resize, prepare };
})(typeof window !== "undefined" ? window : self);
