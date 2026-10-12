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

  function offsetMatrix(matrix, dx, dy) {
    const out = matrix.slice();
    for (let i = 0; i < 3; i++) { out[i] += dx * out[i + 6]; out[i + 3] += dy * out[i + 6]; }
    return out;
  }

  function basisMatrix(b, adapter, perspective = [0, 0]) {
    const c = centre(adapter);
    const [g, h] = perspective, d = 1 - g * c.x - h * c.y;
    return [b[2] + b[0] * g, b[4] + b[0] * h, b[0] * d - b[2] * c.x - b[4] * c.y,
      b[3] + b[1] * g, b[5] + b[1] * h, b[1] * d - b[3] * c.x - b[5] * c.y, g, h, d];
  }

  function matrixBasis(h, adapter) {
    const c = centre(adapter), p = point(h, c.x, c.y);
    const d = h[6] * c.x + h[7] * c.y + h[8];
    return [p.x, p.y, (h[0] - p.x * h[6]) / d, (h[3] - p.y * h[6]) / d,
      (h[1] - p.x * h[7]) / d, (h[4] - p.y * h[7]) / d];
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
    if (options.deadline && Date.now() > options.deadline) {
      const error = new Error("Search stopped at the 60-second limit. No exhaustive angle sweep was run.");
      error.name = "SearchLimit"; throw error;
    }
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
    const c = centre(adapter), h = candidate.matrix, d = h[6] * c.x + h[7] * c.y + h[8];
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
    // Keep any projective curvature supplied by the current plane estimate.
    // The centre and both local derivatives remain independently adjustable.
    const perspective = options.mode === "perspective" ? [h[6] / d, h[7] / d] : [0, 0];
    const toMatrix = (basis) => basisMatrix(basis, adapter, perspective);
    let basis = matrixBasis(candidate.matrix, adapter);
    let score = adapter.quality(toMatrix(basis), candidate.id, dimensions);
    const initial = basis.slice();
    if (wide) {
      // Multiple starting basins bridge the deliberately coarse angle/scale bank.
      for (const degrees of [0, -4, 4]) for (const scale of [1, 0.95, 1.05]) {
        const angle = degrees * Math.PI / 180, cos = Math.cos(angle) * scale, sin = Math.sin(angle) * scale;
        const b = initial.slice();
        b[2] = cos * initial[2] - sin * initial[3]; b[3] = sin * initial[2] + cos * initial[3];
        b[4] = cos * initial[4] - sin * initial[5]; b[5] = sin * initial[4] + cos * initial[5];
        const value = adapter.quality(toMatrix(b), candidate.id, dimensions);
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
            const value = adapter.quality(toMatrix(b), candidate.id, dimensions);
            if (value > bestScore) { bestScore = value; best = b; }
          }
          if (best !== basis) { basis = best; score = bestScore; changed = true; }
        }
        if (!changed) break;
      }
      check(options); await pause();
    }
    const matrix = toMatrix(basis);
    if (options.mode === "padding") {
      // Native padded pixels have an integer translation, even when the response
      // field used every second search position on a large input.
      matrix[2] = Math.round(matrix[2]); matrix[5] = Math.round(matrix[5]);
    }
    const read = dimensions ? adapter.confirm(matrix, candidate.id, dimensions) : adapter.read(matrix, candidate.id);
    if (!read || (dimensions && (read.originalWidth !== dimensions.originalWidth || read.originalHeight !== dimensions.originalHeight))) return null;
    return { ...read, localized: true };
  }

  function convexHull(points) {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const lower = [], upper = [];
    for (const p of points) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = points.length - 1; i >= 0; i--) { const p = points[i]; while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    while (hull.length > 4) {
      let index = 0, area = Infinity;
      for (let i = 0; i < hull.length; i++) {
        const value = Math.abs(cross(hull[(i + hull.length - 1) % hull.length], hull[i], hull[(i + 1) % hull.length]));
        if (value < area) { area = value; index = i; }
      }
      hull.splice(index, 1);
    }
    return hull;
  }

  async function paddingQuads(pixels, width, height, options) {
    // Fast proposal for visible padding, including the white/orange examples.
    // It only proposes geometry: it cannot establish that the picture is encoded.
    const colours = [], quads = [];
    const rgb = (x, y) => { const i = (Math.round(x) + Math.round(y) * width) * 4; return [pixels[i], pixels[i + 1], pixels[i + 2]]; };
    const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const edge = [];
    for (let i = 0; i < 16; i++) {
      const x = i * (width - 1) / 15, y = i * (height - 1) / 15;
      edge.push(rgb(x, 0), rgb(x, height - 1), rgb(0, y), rgb(width - 1, y));
    }
    for (const colour of edge) {
      if (colours.some((c) => distance(c, colour) < 20)) continue;
      if (edge.filter((c) => distance(c, colour) < 20).length >= 24) colours.push(colour);
    }
    const step = Math.max(1, Math.ceil(Math.max(width, height) / 640)), w = Math.ceil(width / step), h = Math.ceil(height / step);
    for (const colour of colours.slice(0, 2)) for (const tolerance of [22, 45]) {
      options.onProgress?.("Checking visible padding for an image outline…");
      const mask = new Uint8Array(w * h), visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
      for (let y = 0; y < h; y++) {
        if ((y & 31) === 0) { check(options); await pause(); }
        for (let x = 0; x < w; x++) mask[x + y * w] = distance(rgb(Math.min(width - 1, x * step), Math.min(height - 1, y * step)), colour) > tolerance ? 1 : 0;
      }
      let largest = 0, boundary = [];
      for (let start = 0; start < mask.length; start++) {
        if ((start & 8191) === 0) { check(options); await pause(); }
        if (!mask[start] || visited[start]) continue;
        let head = 0, tail = 1; queue[0] = start; visited[start] = 1;
        const outline = [];
        while (head < tail) {
          if ((head & 8191) === 8191) { check(options); await pause(); }
          const i = queue[head++], x = i % w, y = Math.floor(i / w);
          let onEdge = false;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx, ny = y + dy, n = nx + ny * w;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[n]) { onEdge = true; continue; }
            if (!visited[n]) { visited[n] = 1; queue[tail++] = n; }
          }
          if (onEdge) outline.push({ x: Math.min(width - 1, x * step), y: Math.min(height - 1, y * step) });
        }
        if (tail > largest) { largest = tail; boundary = outline; }
      }
      if (largest < mask.length * 0.06 || largest > mask.length * 0.995 || boundary.length < 4) continue;
      const hull = convexHull(boundary);
      if (hull.length === 4 && !quads.some((q) => q.every((p, i) => Math.hypot(p.x - hull[i].x, p.y - hull[i].y) < step * 2))) quads.push(hull);
    }
    return quads;
  }

  function quadFit(corners, width, height) {
    return fitPoints([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]
      .map(([x, y], i) => ({ source: { x, y }, target: corners[i] })), true);
  }

  async function seedFromQuads(quads, signature, adapter, options) {
    const scales = [[1, 1]], proposals = [];
    for (const basis of signature.bases || []) {
      const s = [Math.hypot(basis[0], basis[1]), Math.hypot(basis[2], basis[3])];
      if (!scales.some((v) => Math.abs(v[0] - s[0]) + Math.abs(v[1] - s[1]) < 0.04)) scales.push(s);
    }
    for (const scale of [0.95, 1.05, 0.75, 1.25, 0.5, 2]) scales.push([scale, scale]);
    for (const quad of quads) for (let turn = 0; turn < 4; turn++) {
      const corners = quad.slice(turn).concat(quad.slice(0, turn));
      const sideX = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const sideY = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
      for (const [sx, sy] of scales) {
        const ow = Math.round(sideX / sx) + 1, oh = Math.round(sideY / sy) + 1;
        const layout = adapter.layout(ow, oh), fit = quadFit(corners, ow, oh);
        if (!layout || !fit) continue;
        options.onProgress?.("Checking markers near the detected outline (orientation " + (turn + 1) + "/4)…");
        for (const id of [0, 2, 6, 8]) {
          check(options);
          const patch = layout.find((p) => p.id === id), matrix = patchMatrix(fit, patch);
          for (const dy of [0, -1.5, 1.5]) for (const dx of [0, -1.5, 1.5]) {
            const trial = offsetMatrix(matrix, dx, dy), score = adapter.quality(trial, id);
            if (score > 0.2) proposals.push({ matrix: trial, id, score, corners });
          }
        }
        await pause();
      }
    }
    proposals.sort((a, b) => b.score - a.score);
    for (const proposal of proposals.slice(0, 24)) {
      check(options);
      const direct = adapter.read(proposal.matrix, proposal.id);
      const seed = direct || await refine(proposal, adapter, null, options, true);
      if (seed) return { ...seed, initialMatrix: quadFit(proposal.corners, seed.originalWidth, seed.originalHeight) };
    }
    return null;
  }

  async function seedSearch(pixels, luma, width, height, adapter, options, signature) {
    if (options.mode !== "padding") {
      const quads = options.corners?.length === 4 ? [options.corners] : await paddingQuads(pixels, width, height, options);
      const seed = await seedFromQuads(quads, signature, adapter, options);
      if (seed) return seed;
    }
    const banks = options.mode === "padding" ? [[1, 0, 0, 1]] : signature.bases.slice(0, 12);
    if (options.forceSearch && !banks.length) banks.push([1, 0, 0, 1]);
    for (let bank = 0; bank < banks.length; bank++) {
      check(options);
      const basis = banks[bank];
      options.onProgress?.("Locating patches using the frequency estimate (" + (bank + 1) + "/" + banks.length + ")…");
      const peaks = await globalCandidates(luma, width, height, basis, adapter, options);
      for (const peak of peaks.slice(0, 32)) {
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
      const weight = Math.sqrt(pairs[i].weight || 1);
      rows.push((projective ? [x, y, 1, 0, 0, 0, -u * x, -u * y] : [x, y, 1, 0, 0, 0]).map((v) => v * weight)); values.push(u * weight);
      rows.push((projective ? [0, 0, 0, x, y, 1, -v * x, -v * y] : [0, 0, 0, x, y, 1]).map((v) => v * weight)); values.push(v * weight);
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
    // These interior points measure the locally fitted axes, not extra markers.
    // A prediction that merely passes a pattern threshold has no measured axes.
    const controls = marker.localized ? [[-c.x * 0.65, 0], [c.x * 0.65, 0], [0, -c.y * 0.65], [0, c.y * 0.65]]
      .map(([dx, dy]) => ({ source: { x: patch.x + c.x + dx, y: patch.y + c.y + dy },
        target: point(marker.matrix, c.x + dx, c.y + dy) })) : [];
    return { source: { x: patch.x + c.x, y: patch.y + c.y }, target: point(marker.matrix, c.x, c.y), marker, controls };
  }

  function separated(sample) {
    // Four centres cannot determine a homography if any three are collinear.
    // In particular, the three top patches plus the left midpoint are singular.
    for (const triple of subsets(sample, 3)) for (const side of ["source", "target"]) {
      const [a, b, c] = triple.map((p) => p[side]);
      const span = Math.max((a.x - b.x) ** 2 + (a.y - b.y) ** 2,
        (a.x - c.x) ** 2 + (a.y - c.y) ** 2, (b.x - c.x) ** 2 + (b.y - c.y) ** 2);
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area <= span * 0.001) return false;
    }
    return true;
  }

  function controlPairs(pairs) {
    return pairs.flatMap((pair) => [{ source: pair.source, target: pair.target, weight: 4 }, ...pair.controls]);
  }

  function measurementError(matrix, pair) {
    const distance = (p) => {
      const mapped = point(matrix, p.source.x, p.source.y);
      return Math.hypot(mapped.x - p.target.x, mapped.y - p.target.y);
    };
    return Math.max(distance(pair), pair.controls.length ? pair.controls.reduce((s, p) => s + distance(p), 0) / pair.controls.length : 0);
  }

  const searchMargin = (width, height) => Math.min(48, Math.max(12, Math.max(width, height) * 0.03));

  function chooseFit(markers, dimensions, adapter, projective, width, height) {
    const layout = adapter.layout(dimensions.originalWidth, dimensions.originalHeight);
    const pairs = markers.map((marker) => centrePair(marker, layout, adapter));
    const count = projective ? 4 : 3;
    if (pairs.length < count) return null;
    let best = null;
    const consider = (matrix, controls) => {
      if (!matrix || !validGeometry(matrix, dimensions.originalWidth, dimensions.originalHeight, width, height, searchMargin(width, height))) return;
      const inliers = pairs.filter((pair) => measurementError(matrix, pair) < 2.5);
      if (inliers.length < count) return;
      const error = inliers.reduce((s, pair) => s + measurementError(matrix, pair), 0);
      if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && error < best.error)) best = { matrix, inliers, error, controls };
    };
    for (const sample of subsets(pairs, count)) {
      if (separated(sample)) consider(fitPoints(sample, projective), false);
    }
    if (projective) {
      // Local directions remove the ambiguity of a centre-only fit. Use three
      // spatially separated, independently refined patches to propose it, then
      // require agreement from at least four whole patches, not four control points.
      const measured = pairs.filter((pair) => pair.controls.length);
      for (const sample of subsets(measured, 3)) {
        if (separated(sample)) consider(fitPoints(controlPairs(sample), true), true);
      }
    }
    if (!best) return null;
    const refitted = fitPoints(best.controls ? controlPairs(best.inliers) : best.inliers, projective);
    if (refitted && validGeometry(refitted, dimensions.originalWidth, dimensions.originalHeight, width, height, searchMargin(width, height)) &&
        best.inliers.every((pair) => measurementError(refitted, pair) < 2.5)) best.matrix = refitted;
    return best;
  }

  function rankMappings(candidates, markers, seed, adapter, width, height, minimum = 1) {
    const layout = adapter.layout(seed.originalWidth, seed.originalHeight);
    const pairs = markers.map((marker) => centrePair(marker, layout, adapter));
    const ranked = [];
    for (const candidate of candidates) {
      if (!validGeometry(candidate.matrix, seed.originalWidth, seed.originalHeight, width, height, searchMargin(width, height))) continue;
      let score = 0;
      for (const marker of markers) score += adapter.quality(patchMatrix(candidate.matrix, layout.find((p) => p.id === marker.id)), marker.id, seed);
      if (!Number.isFinite(score)) continue;
      const inliers = pairs.filter((pair) => measurementError(candidate.matrix, pair) < 2.5);
      if (inliers.length >= minimum) ranked.push({ ...candidate, score: score / markers.length, inliers });
    }
    ranked.sort((a, b) => b.score - a.score);
    const distinct = [];
    for (const candidate of ranked) {
      const corners = quad(candidate.matrix, seed.originalWidth, seed.originalHeight);
      if (distinct.some((other) => quad(other.matrix, seed.originalWidth, seed.originalHeight)
        .every((p, i) => Math.hypot(p.x - corners[i].x, p.y - corners[i].y) < 2))) continue;
      distinct.push(candidate);
      if (distinct.length === 3) break;
    }
    return distinct;
  }

  function fromSeed(seed, adapter) {
    const patch = adapter.layout(seed.originalWidth, seed.originalHeight).find((p) => p.id === seed.id);
    return multiply(seed.matrix, [1, 0, -patch.x, 0, 1, -patch.y, 0, 0, 1]);
  }

  async function findNear(matrix, patch, seed, adapter, options, radius) {
    const prediction = patchMatrix(matrix, patch), peaks = [];
    const direct = adapter.confirm(prediction, patch.id, seed);
    if (direct) return await refine(direct, adapter, seed, options) || direct;
    const stride = radius > 30 ? 4 : 2;
    for (let y = -radius; y <= radius; y += stride) {
      check(options);
      for (let x = -radius; x <= radius; x += stride) {
        const trial = offsetMatrix(prediction, x, y);
        const score = adapter.quality(trial, patch.id);
        if (score > 0.32) keepPeak(peaks, { matrix: trial, id: patch.id, x, y, score }, 12, 5);
      }
      await pause();
    }
    for (const peak of peaks) {
      const read = await refine(peak, adapter, seed, options, true);
      if (read) return read;
    }
    return null;
  }

  function quad(matrix, width, height) {
    return [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]].map(([x, y]) => point(matrix, x, y));
  }

  function validGeometry(matrix, originalWidth, originalHeight, width, height, margin = 3) {
    if (!matrix || matrix.some((v) => !Number.isFinite(v))) return false;
    const corners = quad(matrix, originalWidth, originalHeight);
    const denominators = [[0, 0], [originalWidth - 1, 0], [originalWidth - 1, originalHeight - 1], [0, originalHeight - 1]]
      .map(([x, y]) => matrix[6] * x + matrix[7] * y + matrix[8]);
    // Homographies are unchanged by multiplying all coefficients by a constant.
    // Test the denominator relative to its value at the image centre.
    const middle = denominators.reduce((s, d) => s + d, 0) / 4;
    if (!Number.isFinite(middle) || Math.abs(middle) < 1e-12 || denominators.some((d) => d / middle <= 0.05)) return false;
    if (corners.some((p) => !Number.isFinite(p.x + p.y) || p.x < -margin || p.y < -margin || p.x > width - 1 + margin || p.y > height - 1 + margin)) return false;
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
      // Coarse fits may overshoot an edge slightly. Allow refinement to approach
      // the boundary; the final result still has the stricter three-pixel check.
      if (!validGeometry(transform, seed.originalWidth, seed.originalHeight, width, height, searchMargin(width, height))) return -Infinity;
      let value = 0;
      for (const marker of markers) value += adapter.quality(patchMatrix(transform, layout.find((p) => p.id === marker.id)), marker.id, seed);
      return value / markers.length;
    };
    let score = quality(normalized);
    for (const pixels of [1.5, 0.75, 0.3, 0.12, 0.04]) {
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
    const options = { ...requested, deadline: Date.now() + 60000,
      mode: ["padding", "affine", "perspective"].includes(requested.mode) ? requested.mode : "padding" };
    options.check = () => check(options);
    let signature = null;
    const markers = [];
    try {
      const luma = new Float32Array(width * height);
      options.onProgress?.("Preparing wavelet search…");
      for (let i = 0; i < luma.length; i++) luma[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
      signature = await root.PixelStowSpectrum.analyze(luma, width, height, options);
      options.onSignature?.(signature);
      if (!signature.likely && !options.forceSearch && !options.corners?.length) return { geometry: null, markers, signature, reason: signature.message };
      let seed = await seedSearch(pixels, luma, width, height, adapter, options, signature);
      if (!seed) return { geometry: null, markers, signature, reason: "No checksum-valid wavelet patch was found using the outline/frequency estimates." };
      if (options.mode !== "padding") {
        const localized = await refine(seed, adapter, seed, options);
        if (localized) seed = { ...seed, ...localized };
      }
      markers.push(seed);
      let matrix = seed.initialMatrix || fromSeed(seed, adapter), model = "translation";
      const layout = adapter.layout(seed.originalWidth, seed.originalHeight);
      let predictions = [{ matrix, model }];
      if (seed.initialMatrix) predictions.push({ matrix: fromSeed(seed, adapter), model: "affine" });
      for (let round = 0; round < (options.mode === "padding" ? 1 : 2); round++) {
        const pending = layout.filter((patch) => !markers.some((m) => m.id === patch.id));
        const spread = (patch) => Math.min(...markers.map((marker) => {
          const other = layout.find((p) => p.id === marker.id);
          return ((patch.x - other.x) / seed.originalWidth) ** 2 + ((patch.y - other.y) / seed.originalHeight) ** 2;
        }));
        while (pending.length) {
          // Prefer distant confirmations rather than first collecting a whole row.
          if (options.mode !== "padding") pending.sort((a, b) => spread(b) - spread(a));
          const patch = pending.shift();
          options.onProgress?.("Found " + markers.length + "/8 markers. Locating marker " + patch.id + "…");
          let found = null;
          if (options.mode === "padding") {
            const expected = patchMatrix(matrix, patch);
            found = adapter.confirm(expected, patch.id, seed) || await refine({ matrix: expected, id: patch.id }, adapter, seed, options);
          } else {
            const radius = Math.min(64, Math.max(16, Math.round(Math.max(width, height) * (round ? 0.03 : 0.02))));
            // A local affine estimate remains a useful alternative while the
            // perspective estimate is still extrapolating from one side.
            for (const prediction of predictions) {
              found = await findNear(prediction.matrix, patch, seed, adapter, options, radius);
              if (found) break;
            }
          }
          if (!found) continue;
          markers.push(found);
          if (options.mode !== "padding") {
            const candidates = predictions.slice();
            const affine = chooseFit(markers, seed, adapter, false, width, height);
            if (affine) candidates.push({ matrix: affine.matrix, model: "affine" });
            if (options.mode === "perspective") {
              const projective = chooseFit(markers, seed, adapter, true, width, height);
              if (projective) candidates.push({ matrix: projective.matrix, model: "perspective" });
            }
            const ranked = rankMappings(candidates, markers, seed, adapter, width, height);
            if (ranked.length) { predictions = ranked; matrix = ranked[0].matrix; model = ranked[0].model; }
          }
        }
      }
      if (options.mode === "padding") {
        // In this first milestone there is no scale/angle estimation to extrapolate.
        // Match exact translations and require agreement from another distant patch.
        const translations = markers.map((m) => fromSeed(m, adapter));
        const agreeing = translations.filter((h) => Math.hypot(h[2] - translations[0][2], h[5] - translations[0][5]) < 0.6);
        if (agreeing.length < 2) return { geometry: null, markers, signature, reason: "A patch was found, but a second patch did not confirm the image bounds." };
        matrix = [1, 0, agreeing.reduce((s, h) => s + h[2], 0) / agreeing.length,
          0, 1, agreeing.reduce((s, h) => s + h[5], 0) / agreeing.length, 0, 0, 1];
        model = "translation";
      } else {
        const fit = chooseFit(markers, seed, adapter, options.mode === "perspective", width, height);
        if (!fit) return { geometry: null, markers, signature, reason: "The detected marker positions and local directions did not establish a stable " + options.mode + " transform." };
        const candidates = [{ matrix: fit.matrix, model: options.mode }];
        if (options.mode === "perspective") candidates.push(...predictions);
        const ranked = rankMappings(candidates,
          markers, seed, adapter, width, height, options.mode === "perspective" ? 4 : 3);
        if (!ranked.length) return { geometry: null, markers, signature, reason: "The fitted transform did not agree with enough independently measured markers." };
        matrix = ranked[0].matrix; model = options.mode;
        options.onProgress?.("Refining " + model + " alignment from " + ranked[0].inliers.length + " markers and their local directions…");
        matrix = await refineGlobal(matrix, ranked[0].inliers.map((p) => p.marker), seed, adapter, width, height, options);
      }
      if (!validGeometry(matrix, seed.originalWidth, seed.originalHeight, width, height)) return {
        geometry: null, markers, signature, reason: "The marker fit places image corners outside the supplied picture or folds the plane." };
      return { geometry: { matrix, originalWidth: seed.originalWidth, originalHeight: seed.originalHeight,
        model, markerCount: markers.length, headerCount: markers.filter((m) => m.verification === "header").length,
        patternCount: markers.filter((m) => m.verification === "pattern").length,
        expectedMarkers: layout.map((p) => ({ id: p.id, matrix: patchMatrix(matrix, p) })),
        corners: quad(matrix, seed.originalWidth, seed.originalHeight) }, markers, signature };
    } catch (error) {
      if (error?.name === "SearchLimit") return { geometry: null, markers, signature, reason: error.message };
      throw error;
    }
  }

  root.PixelStowTransform = { find, invert, point };
})(typeof window !== "undefined" ? window : self);
