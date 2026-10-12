// Experimental carrier-3 geometry discovery. No canvas, DOM or server dependency.
// Pixel-centre coordinates are used throughout; payload validation lives in the codec.
(function (root) {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const centre = (adapter) => ({ x: (adapter.patchWidth - 1) / 2, y: (adapter.patchHeight - 1) / 2 });

  function point(h, x, y) {
    const d = h[6] * x + h[7] * y + h[8];
    return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
  }

  function multiply(a, b) {
    const out = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    return out;
  }

  function invert(h) {
    const [a, b, c, d, e, f, g, j, k] = h;
    const out = [e * k - f * j, c * j - b * k, b * f - c * e,
      f * g - d * k, a * k - c * g, c * d - a * f,
      d * j - e * g, b * g - a * j, a * e - b * d];
    const determinant = a * out[0] + b * out[3] + c * out[6];
    if (Math.abs(determinant) < 1e-12) throw new Error("The recovered transform is singular.");
    return out.map((value) => value / determinant);
  }

  function patchMatrix(h, patch) {
    return multiply(h, [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1]);
  }

  function basisMatrix(b, adapter) {
    const c = centre(adapter);
    return [b[2], b[4], b[0] - b[2] * c.x - b[4] * c.y,
      b[3], b[5], b[1] - b[3] * c.x - b[5] * c.y, 0, 0, 1];
  }

  function matrixBasis(h, adapter) {
    const c = centre(adapter), p = point(h, c.x, c.y);
    const u = point(h, c.x + 1, c.y), v = point(h, c.x, c.y + 1);
    return [p.x, p.y, u.x - p.x, u.y - p.y, v.x - p.x, v.y - p.y];
  }

  function reasonableBasis(b) {
    const u = Math.hypot(b[2], b[3]), v = Math.hypot(b[4], b[5]);
    return u >= 0.4 && v >= 0.4 && u <= 2.6 && v <= 2.6 &&
      (b[2] * b[5] - b[3] * b[4]) / (u * v) > 0.35;
  }

  function bilinear(values, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const x1 = Math.min(w - 1, ix + 1), y1 = Math.min(h - 1, iy + 1);
    return values[ix + iy * w] * (1 - fx) * (1 - fy) + values[x1 + iy * w] * fx * (1 - fy) +
      values[ix + y1 * w] * (1 - fx) * fy + values[x1 + y1 * w] * fx * fy;
  }

  function keepPeak(peaks, candidate, maximum = 24, separation = 5) {
    const near = peaks.findIndex((other) => other.id === candidate.id && Math.hypot(candidate.x - other.x, candidate.y - other.y) < separation);
    if (near >= 0) {
      if (peaks[near].score >= candidate.score) return;
      peaks.splice(near, 1);
    }
    if (peaks.length >= maximum && candidate.score <= peaks[peaks.length - 1].score) return;
    const index = peaks.findIndex((other) => other.score < candidate.score);
    peaks.splice(index < 0 ? peaks.length : index, 0, candidate);
    if (peaks.length > maximum) peaks.length = maximum;
  }

  function check(options) {
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
  }

  async function responseField(luma, width, height, basis, adapter, options) {
    // Preserve the locator's six-pixel wavelet. This is a response field, not a
    // reduced photograph: sample original pixels before reducing search positions.
    const step = Math.max(1, Math.ceil(Math.sqrt(width * height / 6000000)));
    const w = Math.ceil(width / step), h = Math.ceil(height / step);
    const values = new Float32Array(w * h);
    const taps = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      taps.push({ x: basis[0] * (1.5 * x + 0.5) + basis[2] * (1.5 * y + 0.5),
        y: basis[1] * (1.5 * x + 0.5) + basis[3] * (1.5 * y + 0.5), weight: adapter.shape[x + y * 4] });
    }
    for (let y = 0; y < h; y++) {
      if ((y & 31) === 31) { check(options); await pause(); }
      for (let x = 0; x < w; x++) {
        let sum = 0, squares = 0, projection = 0;
        for (const tap of taps) {
          const value = bilinear(luma, width, height, x * step + tap.x, y * step + tap.y);
          sum += value; squares += value * value; projection += value * tap.weight;
        }
        values[x + y * w] = projection / Math.sqrt(400 + Math.max(0, squares - sum * sum / 16));
      }
    }
    return { values, width: w, height: h, step };
  }

  async function globalCandidates(luma, width, height, basis, adapter, options) {
    const field = await responseField(luma, width, height, basis, adapter, options);
    const points = adapter.pilots[0].points.map((p) => ({ x: (basis[0] * p.x + basis[2] * p.y) / field.step,
      y: (basis[1] * p.x + basis[3] * p.y) / field.step }));
    const scores = new Float64Array(24), peaks = adapter.ids.map(() => []);
    const scanStep = options.mode === "padding" ? 1 : 2;
    for (let y = 0; y < field.height; y += scanStep) {
      if ((y & 31) === 0) { check(options); await pause(); }
      for (let x = 0; x < field.width; x += scanStep) {
        let agreement = 0, energy = 0;
        for (let slot = 0; slot < 12; slot++) {
          const p = points[slot];
          scores[slot] = bilinear(field.values, field.width, field.height, x + p.x, y + p.y);
          agreement += scores[slot] * adapter.pilots[0].points[slot].sign;
          energy += Math.abs(scores[slot]);
        }
        if (energy < 12 * 8 || agreement / energy < 0.45) continue;
        for (let slot = 12; slot < 24; slot++) {
          const p = points[slot];
          scores[slot] = bilinear(field.values, field.width, field.height, x + p.x, y + p.y);
          energy += Math.abs(scores[slot]);
        }
        if (energy < 24 * 8) continue;
        for (let id = 0; id < adapter.ids.length; id++) {
          let combined = agreement;
          for (let slot = 12; slot < 24; slot++) combined += scores[slot] * adapter.pilots[id].points[slot].sign;
          const quality = combined / energy;
          if (quality < 0.58) continue;
          keepPeak(peaks[id], { id: adapter.ids[id], x: x * field.step, y: y * field.step,
            score: quality * Math.min(1, energy / (24 * 12)), matrix: [basis[0], basis[2], x * field.step, basis[1], basis[3], y * field.step, 0, 0, 1] });
        }
      }
    }
    return peaks.flat().sort((a, b) => b.score - a.score);
  }

  async function refine(candidate, adapter, dimensions, options, wide = false) {
    // Fit a small patch locally before attempting a global affine/projective fit.
    let basis = matrixBasis(candidate.matrix, adapter);
    let score = adapter.quality(basisMatrix(basis, adapter), candidate.id, dimensions);
    const initial = basis.slice();
    if (wide) {
      // Multiple starting basins bridge the deliberately coarse angle/scale bank.
      for (const degrees of [0, -4, 4]) for (const scale of [1, 0.95, 1.05]) {
        const angle = degrees * Math.PI / 180, cos = Math.cos(angle) * scale, sin = Math.sin(angle) * scale;
        const b = initial.slice();
        b[2] = cos * initial[2] - sin * initial[3]; b[3] = sin * initial[2] + cos * initial[3];
        b[4] = cos * initial[4] - sin * initial[5]; b[5] = sin * initial[4] + cos * initial[5];
        const value = adapter.quality(basisMatrix(b, adapter), candidate.id, dimensions);
        if (value > score) { score = value; basis = b; }
      }
    }
    for (const size of [1.5, 0.75, 0.35, 0.15, 0.06]) {
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (let axis = 0; axis < (options.mode === "padding" ? 2 : 6); axis++) {
          const delta = axis < 2 ? size : size / Math.max(adapter.patchWidth, adapter.patchHeight) * 2;
          let best = basis, bestScore = score;
          for (const sign of [-1, 1]) {
            const b = basis.slice(); b[axis] += delta * sign;
            if (!reasonableBasis(b)) continue;
            const value = adapter.quality(basisMatrix(b, adapter), candidate.id, dimensions);
            if (value > bestScore) { bestScore = value; best = b; }
          }
          if (best !== basis) { basis = best; score = bestScore; changed = true; }
        }
        if (!changed) break;
      }
      check(options); await pause();
    }
    const matrix = basisMatrix(basis, adapter);
    if (options.mode === "padding") {
      // Native padded pixels have an integer translation, even when the response
      // field used every second search position on a large input.
      matrix[2] = Math.round(matrix[2]); matrix[5] = Math.round(matrix[5]);
    }
    const read = adapter.read(matrix, candidate.id);
    if (!read || (dimensions && (read.originalWidth !== dimensions.originalWidth || read.originalHeight !== dimensions.originalHeight))) return null;
    return read;
  }

  async function seedSearch(luma, width, height, adapter, options) {
    const banks = [{ scale: 1, angle: 0 }];
    if (options.mode !== "padding") {
      // Wider searches are explicit. A fine local fit follows each coarse peak.
      const angles = [0];
      for (let a = 10; a < 180; a += 10) angles.push(a, -a);
      angles.push(180);
      for (const scale of [1, 0.95, 1.05, 0.75, 1.25, 0.5, 1.5, 2, 0.6, 0.85, 1.1, 1.7]) {
        for (const angle of angles) if (scale !== 1 || angle !== 0) banks.push({ scale, angle });
      }
    }
    for (let bank = 0; bank < banks.length; bank++) {
      check(options);
      const { scale, angle } = banks[bank], radians = angle * Math.PI / 180;
      options.onProgress?.("Searching wavelet patches: " + angle + "°, " + Math.round(scale * 100) + "% (" + (bank + 1) + "/" + banks.length + ")…");
      const basis = [Math.cos(radians) * scale, Math.sin(radians) * scale, -Math.sin(radians) * scale, Math.cos(radians) * scale];
      const peaks = await globalCandidates(luma, width, height, basis, adapter, options);
      for (const peak of peaks) {
        // Read the exact native lattice first. Refinement must not spoil it.
        const direct = adapter.read(peak.matrix, peak.id);
        if (direct) return direct;
        const refined = await refine(peak, adapter, null, options, options.mode !== "padding");
        if (refined) return refined;
      }
    }
    return null;
  }

  function solve(rows, values, unknowns) {
    const matrix = Array.from({ length: unknowns }, () => new Float64Array(unknowns + 1));
    for (let i = 0; i < rows.length; i++) for (let a = 0; a < unknowns; a++) {
      matrix[a][unknowns] += rows[i][a] * values[i];
      for (let b = 0; b < unknowns; b++) matrix[a][b] += rows[i][a] * rows[i][b];
    }
    for (let c = 0; c < unknowns; c++) {
      let pivot = c;
      for (let r = c + 1; r < unknowns; r++) if (Math.abs(matrix[r][c]) > Math.abs(matrix[pivot][c])) pivot = r;
      if (Math.abs(matrix[pivot][c]) < 1e-10) return null;
      [matrix[pivot], matrix[c]] = [matrix[c], matrix[pivot]];
      const divisor = matrix[c][c];
      for (let k = c; k <= unknowns; k++) matrix[c][k] /= divisor;
      for (let r = 0; r < unknowns; r++) if (r !== c) {
        const factor = matrix[r][c];
        for (let k = c; k <= unknowns; k++) matrix[r][k] -= factor * matrix[c][k];
      }
    }
    return matrix.map((row) => row[unknowns]);
  }

  function normalize(points) {
    const x = points.reduce((s, p) => s + p.x, 0) / points.length, y = points.reduce((s, p) => s + p.y, 0) / points.length;
    const radius = Math.sqrt(points.reduce((s, p) => s + (p.x - x) ** 2 + (p.y - y) ** 2, 0) / points.length);
    if (radius < 1e-6) return null;
    const scale = Math.SQRT2 / radius;
    const matrix = [scale, 0, -scale * x, 0, scale, -scale * y, 0, 0, 1];
    return { matrix, points: points.map((p) => point(matrix, p.x, p.y)) };
  }

  function fitPoints(pairs, projective) {
    if (pairs.length < (projective ? 4 : 3)) return null;
    const source = normalize(pairs.map((p) => p.source)), target = normalize(pairs.map((p) => p.target));
    if (!source || !target) return null;
    const rows = [], values = [];
    for (let i = 0; i < pairs.length; i++) {
      const { x, y } = source.points[i], { x: u, y: v } = target.points[i];
      rows.push(projective ? [x, y, 1, 0, 0, 0, -u * x, -u * y] : [x, y, 1, 0, 0, 0]); values.push(u);
      rows.push(projective ? [0, 0, 0, x, y, 1, -v * x, -v * y] : [0, 0, 0, x, y, 1]); values.push(v);
    }
    const fit = solve(rows, values, projective ? 8 : 6);
    if (!fit) return null;
    const h = fit.slice(0, 6).concat(projective ? fit.slice(6) : [0, 0], [1]);
    const matrix = multiply(invert(target.matrix), multiply(h, source.matrix));
    if (!Number.isFinite(matrix[8]) || Math.abs(matrix[8]) < 1e-10) return null;
    return matrix.map((v) => v / matrix[8]);
  }

  function subsets(items, size, start = 0, previous = [], output = []) {
    if (previous.length === size) { output.push(previous); return output; }
    for (let i = start; i <= items.length - (size - previous.length); i++) subsets(items, size, i + 1, previous.concat(items[i]), output);
    return output;
  }

  function centrePair(marker, layout, adapter) {
    const patch = layout.find((p) => p.id === marker.id), c = centre(adapter);
    return { source: { x: patch.x + c.x, y: patch.y + c.y }, target: point(marker.matrix, c.x, c.y), marker };
  }

  function chooseFit(markers, dimensions, adapter, projective) {
    const layout = adapter.layout(dimensions.originalWidth, dimensions.originalHeight);
    const pairs = markers.map((marker) => centrePair(marker, layout, adapter));
    const count = projective ? 4 : 3;
    if (pairs.length < count) return null;
    let best = null;
    for (const sample of subsets(pairs, count)) {
      const matrix = fitPoints(sample, projective);
      if (!matrix) continue;
      const inliers = pairs.filter((pair) => {
        const p = point(matrix, pair.source.x, pair.source.y);
        return Math.hypot(p.x - pair.target.x, p.y - pair.target.y) < 2.5;
      });
      if (inliers.length < count) continue;
      const error = inliers.reduce((s, pair) => {
        const p = point(matrix, pair.source.x, pair.source.y);
        return s + Math.hypot(p.x - pair.target.x, p.y - pair.target.y);
      }, 0);
      if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && error < best.error)) best = { matrix, inliers, error };
    }
    if (!best) return null;
    best.matrix = fitPoints(best.inliers, projective);
    return best;
  }

  function fromSeed(seed, adapter) {
    const patch = adapter.layout(seed.originalWidth, seed.originalHeight).find((p) => p.id === seed.id);
    return multiply(seed.matrix, [1, 0, -patch.x, 0, 1, -patch.y, 0, 0, 1]);
  }

  async function findNear(matrix, patch, seed, adapter, options, radius) {
    const prediction = patchMatrix(matrix, patch), peaks = [];
    const stride = radius > 30 ? 4 : 2;
    for (let y = -radius; y <= radius; y += stride) {
      check(options);
      for (let x = -radius; x <= radius; x += stride) {
        const trial = prediction.slice(); trial[2] += x; trial[5] += y;
        const score = adapter.quality(trial, patch.id, seed);
        if (score > 0.32) keepPeak(peaks, { matrix: trial, id: patch.id, x, y, score }, 12, 5);
      }
      await pause();
    }
    const direct = adapter.read(prediction, patch.id);
    if (direct && direct.originalWidth === seed.originalWidth && direct.originalHeight === seed.originalHeight) return direct;
    for (const peak of peaks) {
      const read = await refine(peak, adapter, seed, options, true);
      if (read) return read;
    }
    return null;
  }

  function quad(matrix, width, height) {
    return [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]].map(([x, y]) => point(matrix, x, y));
  }

  function validGeometry(matrix, originalWidth, originalHeight, width, height) {
    const corners = quad(matrix, originalWidth, originalHeight);
    const denominators = [[0, 0], [originalWidth - 1, 0], [originalWidth - 1, originalHeight - 1], [0, originalHeight - 1]]
      .map(([x, y]) => matrix[6] * x + matrix[7] * y + matrix[8]);
    if (denominators.some((d) => !Number.isFinite(d) || d <= 0.1)) return false;
    if (corners.some((p) => !Number.isFinite(p.x + p.y) || p.x < -3 || p.y < -3 || p.x > width + 2 || p.y > height + 2)) return false;
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
      if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
    }
    return true;
  }

  async function refineGlobal(matrix, markers, seed, adapter, width, height, options) {
    const source = [seed.originalWidth / 2, 0, seed.originalWidth / 2, 0, seed.originalHeight / 2, seed.originalHeight / 2, 0, 0, 1];
    const target = [width / 2, 0, width / 2, 0, height / 2, height / 2, 0, 0, 1];
    let normalized = multiply(invert(target), multiply(matrix, source));
    normalized = normalized.map((v) => v / normalized[8]);
    const layout = adapter.layout(seed.originalWidth, seed.originalHeight);
    const toImage = (h) => multiply(target, multiply(h, invert(source)));
    const quality = (h) => {
      const transform = toImage(h);
      if (!validGeometry(transform, seed.originalWidth, seed.originalHeight, width, height)) return -Infinity;
      let value = 0;
      for (const marker of markers) value += adapter.quality(patchMatrix(transform, layout.find((p) => p.id === marker.id)), marker.id, seed);
      return value / markers.length;
    };
    let score = quality(normalized);
    for (const pixels of [0.75, 0.3, 0.12, 0.04]) {
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let axis = 0; axis < (options.mode === "perspective" ? 8 : 6); axis++) {
          const step = pixels * 2 / Math.max(width, height);
          let best = normalized, bestScore = score;
          for (const sign of [-1, 1]) {
            const trial = normalized.slice(); trial[axis] += sign * step;
            const value = quality(trial);
            if (value > bestScore) { best = trial; bestScore = value; }
          }
          if (best !== normalized) { changed = true; normalized = best; score = bestScore; }
        }
        check(options); await pause();
        if (!changed) break;
      }
    }
    return toImage(normalized);
  }

  async function find(pixels, width, height, requested, adapter) {
    const options = { ...requested, mode: ["padding", "affine", "perspective"].includes(requested.mode) ? requested.mode : "padding" };
    const luma = new Float32Array(width * height);
    options.onProgress?.("Preparing wavelet search…");
    for (let i = 0; i < luma.length; i++) luma[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
    const seed = await seedSearch(luma, width, height, adapter, options);
    if (!seed) return { geometry: null, markers: [], reason: "No checksum-valid wavelet patch was found." };
    const markers = [seed];
    let matrix = fromSeed(seed, adapter), model = "translation";
    const layout = adapter.layout(seed.originalWidth, seed.originalHeight);
    for (let round = 0; round < (options.mode === "padding" ? 1 : 2); round++) {
      for (const patch of layout) {
        if (markers.some((m) => m.id === patch.id)) continue;
        options.onProgress?.("Found " + markers.length + "/8 markers. Locating marker " + patch.id + "…");
        const expected = patchMatrix(matrix, patch), direct = adapter.read(expected, patch.id);
        let found = direct && direct.originalWidth === seed.originalWidth && direct.originalHeight === seed.originalHeight ? direct : null;
        if (!found && options.mode !== "padding") {
          const radius = Math.min(180, Math.max(12, Math.round(Math.max(seed.originalWidth, seed.originalHeight) * (round ? 0.015 : 0.07))));
          found = await findNear(matrix, patch, seed, adapter, options, radius);
        }
        if (found) markers.push(found);
        const affine = chooseFit(markers, seed, adapter, false);
        if (affine) { matrix = affine.matrix; model = "affine"; }
        if (options.mode === "perspective") {
          const projective = chooseFit(markers, seed, adapter, true);
          if (projective) { matrix = projective.matrix; model = "perspective"; }
        }
      }
    }
    if (options.mode === "padding") {
      // In this first milestone there is no scale/angle estimation to extrapolate.
      // Match exact translations and require agreement from another distant patch.
      const translations = markers.map((m) => fromSeed(m, adapter));
      const agreeing = translations.filter((h) => Math.hypot(h[2] - translations[0][2], h[5] - translations[0][5]) < 0.6);
      if (agreeing.length < 2) return { geometry: null, markers, reason: "A patch was found, but a second patch did not confirm the image bounds." };
      matrix = [1, 0, agreeing.reduce((s, h) => s + h[2], 0) / agreeing.length,
        0, 1, agreeing.reduce((s, h) => s + h[5], 0) / agreeing.length, 0, 0, 1];
      model = "translation";
    } else {
      const fit = chooseFit(markers, seed, adapter, options.mode === "perspective");
      if (!fit) return { geometry: null, markers, reason: "Not enough separated markers confirmed a " + options.mode + " transform." };
      matrix = fit.matrix; model = options.mode;
      options.onProgress?.("Refining the pixel alignment from " + fit.inliers.length + " markers…");
      matrix = await refineGlobal(matrix, fit.inliers.map((p) => p.marker), seed, adapter, width, height, options);
    }
    if (!validGeometry(matrix, seed.originalWidth, seed.originalHeight, width, height)) return {
      geometry: null, markers, reason: "The marker fit places image corners outside the supplied picture or folds the plane." };
    return { geometry: { matrix, originalWidth: seed.originalWidth, originalHeight: seed.originalHeight,
      model, markerCount: markers.length, corners: quad(matrix, seed.originalWidth, seed.originalHeight) }, markers };
  }

  root.PixelStowTransform = { find, invert, point };
})(typeof window !== "undefined" ? window : self);
