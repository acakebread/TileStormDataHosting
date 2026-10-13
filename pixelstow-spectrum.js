// Whole-image Fourier triage for the 4-pixel carrier / 6-pixel locator families.
// Heuristic evidence only: exact headers and frame CRC remain the acceptance test.
(function (root) {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const powerOfTwo = (value) => { let n = 1; while (n < value) n *= 2; return n; };

  function fft(real, imaginary) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
      }
    }
    for (let length = 2; length <= n; length *= 2) {
      const angle = -2 * Math.PI / length, cr = Math.cos(angle), ci = Math.sin(angle);
      for (let start = 0; start < n; start += length) {
        let wr = 1, wi = 0;
        for (let k = 0; k < length / 2; k++) {
          const a = start + k, b = a + length / 2;
          const tr = wr * real[b] - wi * imaginary[b], ti = wr * imaginary[b] + wi * real[b];
          real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
          real[a] += tr; imaginary[a] += ti;
          const next = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = next;
        }
      }
    }
  }

  function taper(position, span) {
    const edge = Math.min(position, span - 1 - position), ramp = Math.max(1, span * 0.08);
    // Retain evidence from the outer locator patches while reducing border leakage.
    return edge >= ramp ? 1 : 0.4 + 0.6 * (1 - Math.cos(Math.PI * edge / ramp)) / 2;
  }

  function wrap(value, length) { return ((value % length) + length) % length; }

  function contrast(power, width, height, x, y, floor) {
    let noise = 0;
    for (const [dx, dy] of [[-8, 0], [8, 0], [0, -8], [0, 8], [-6, -6], [-6, 6], [6, -6], [6, 6]]) {
      noise += power[wrap(x + dx, width) + wrap(y + dy, height) * width];
    }
    return power[x + y * width] / Math.max(floor, noise / 8);
  }

  function strongestNear(power, width, height, fx, fy, floor) {
    const x = wrap(Math.round(fx * width), width), y = wrap(Math.round(fy * height), height);
    let best = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      best = Math.max(best, contrast(power, width, height, wrap(x + dx, width), wrap(y + dy, height), floor));
    }
    return best;
  }

  function unalias(peak, stride) {
    const values = [], reach = Math.ceil(stride / 2);
    for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) {
      const fx = (peak.fx + x) / stride, fy = (peak.fy + y) / stride, radius = Math.hypot(fx, fy);
      if (radius >= 0.095 && radius <= 0.57 && Math.abs(fx) <= 0.5 && Math.abs(fy) <= 0.5) values.push({ ...peak, fx, fy });
    }
    return values;
  }

  function reducedBasis(basis) {
    // The common carrier has both axis and diagonal peaks. An axis/diagonal
    // pair describes the same lattice with a sheared basis. Reduce that lattice
    // before trying it, while retaining the unreduced estimate for real shear.
    let [ux, uy, vx, vy] = basis;
    for (let pass = 0; pass < 4; pass++) {
      if (ux * ux + uy * uy > vx * vx + vy * vy) [ux, uy, vx, vy] = [vx, vy, -ux, -uy];
      const multiple = Math.round((ux * vx + uy * vy) / (ux * ux + uy * uy));
      if (!multiple) break;
      vx -= multiple * ux; vy -= multiple * uy;
    }
    return [ux, uy, vx, vy];
  }

  function rotations([ux, uy, vx, vy]) {
    return [[ux, uy, vx, vy], [vx, vy, -ux, -uy], [-ux, -uy, -vx, -vy], [-vx, -vy, ux, uy]];
  }

  async function analyze(luma, width, height, options) {
    let stride = Math.max(1, Math.ceil(Math.max(width, height) / 2048));
    if (stride % 2 === 0) stride++; // Even decimation can erase a four-pixel lattice.
    const sampledWidth = Math.ceil(width / stride), sampledHeight = Math.ceil(height / stride);
    const fw = powerOfTwo(sampledWidth), fh = powerOfTwo(sampledHeight);
    const real = new Float32Array(fw * fh), imaginary = new Float32Array(real.length);
    options.onProgress?.("Checking the whole-image frequency signature…");
    for (let y = 0; y < sampledHeight; y++) {
      if ((y & 31) === 0) { options.check(); await pause(); }
      for (let x = 0; x < sampledWidth; x++) {
        const sx = Math.min(width - 1, x * stride), sy = Math.min(height - 1, y * stride), i = sx + sy * width;
        const neighbours = luma[Math.max(0, sx - 1) + sy * width] + luma[Math.min(width - 1, sx + 1) + sy * width] +
          luma[sx + Math.max(0, sy - 1) * width] + luma[sx + Math.min(height - 1, sy + 1) * width];
        real[x + y * fw] = (luma[i] * 4 - neighbours) * taper(x, sampledWidth) * taper(y, sampledHeight);
      }
    }
    for (let y = 0; y < fh; y++) {
      if ((y & 31) === 0) { options.check(); await pause(); }
      fft(real.subarray(y * fw, (y + 1) * fw), imaginary.subarray(y * fw, (y + 1) * fw));
    }
    const columnReal = new Float32Array(fh), columnImaginary = new Float32Array(fh);
    for (let x = 0; x < fw; x++) {
      if ((x & 31) === 0) { options.check(); await pause(); }
      for (let y = 0; y < fh; y++) { columnReal[y] = real[x + y * fw]; columnImaginary[y] = imaginary[x + y * fw]; }
      fft(columnReal, columnImaginary);
      for (let y = 0; y < fh; y++) { real[x + y * fw] = columnReal[y]; imaginary[x + y * fw] = columnImaginary[y]; }
    }
    let total = 0;
    for (let i = 0; i < real.length; i++) { real[i] = real[i] ** 2 + imaginary[i] ** 2; total += real[i]; }
    const mean = total / real.length, floor = Math.max(1e-8, mean * 0.01), peaks = [];
    for (let y = 0; y <= fh / 2; y++) {
      if ((y & 31) === 0) { options.check(); await pause(); }
      for (let x = 0; x < fw; x++) {
        const fx = (x <= fw / 2 ? x : x - fw) / fw, fy = y / fh, radius = Math.hypot(fx, fy);
        const value = real[x + y * fw];
        if ((y === 0 && fx <= 0) || radius < 0.075 || radius > 0.65 || value < mean * 6) continue;
        const ratio = contrast(real, fw, fh, x, y, floor);
        if (ratio < 7) continue;
        const score = value * Math.min(ratio, 80);
        if (peaks.length === 192 && score <= peaks[peaks.length - 1].score) continue;
        const peak = { x, y, fx, fy, score, contrast: ratio };
        const index = peaks.findIndex((p) => p.score < score);
        peaks.splice(index < 0 ? peaks.length : index, 0, peak);
        if (peaks.length > 192) peaks.pop();
      }
    }
    const distinct = [];
    for (const peak of peaks) {
      if (distinct.some((p) => Math.hypot((p.fx - peak.fx) * fw, (p.fy - peak.fy) * fh) < 5)) continue;
      // A small centroid corrects fractional FFT-bin rotation/scale estimates.
      let sum = 0, dx = 0, dy = 0;
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
        const value = real[wrap(peak.x + x, fw) + wrap(peak.y + y, fh) * fw];
        sum += value; dx += x * value; dy += y * value;
      }
      distinct.push({ ...peak, fx: peak.fx + dx / Math.max(sum, 1e-8) / fw, fy: peak.fy + dy / Math.max(sum, 1e-8) / fh });
      if (distinct.length === 12) break;
    }
    const expanded = distinct.flatMap((p) => unalias(p, stride)), candidates = [];
    for (let i = 0; i < expanded.length; i++) {
      if ((i & 7) === 0) { options.check(); await pause(); }
      for (let j = i + 1; j < expanded.length; j++) {
        const a = expanded[i], b = expanded[j];
        if (a.x === b.x && a.y === b.y) continue;
        let bx = b.fx, by = b.fy, determinant = a.fx * by - a.fy * bx;
        const separation = Math.abs(determinant) / (Math.hypot(a.fx, a.fy) * Math.hypot(bx, by));
        if (separation < 0.65) continue;
        if (determinant < 0) { bx = -bx; by = -by; determinant = -determinant; }
        const basis = [0.25 * by / determinant, -0.25 * bx / determinant, -0.25 * a.fy / determinant, 0.25 * a.fx / determinant];
        const u = Math.hypot(basis[0], basis[1]), v = Math.hypot(basis[2], basis[3]);
        if (u < 0.45 || v < 0.45 || u > 2.4 || v > 2.4) continue;
        const markerBand = [2 / 3, 4 / 5].some((ratio) => Math.max(
          strongestNear(real, fw, fh, a.fx * stride * ratio, a.fy * stride * ratio, floor),
          strongestNear(real, fw, fh, bx * stride * ratio, by * stride * ratio, floor)) >= 3);
        // Common carrier tiles have axis and diagonal peaks. Prefer an axis pair
        // supported by its sum/difference, rather than treating diagonals as axes.
        const diagonalBand = Math.max(strongestNear(real, fw, fh, (a.fx + bx) * stride, (a.fy + by) * stride, floor),
          strongestNear(real, fw, fh, (a.fx - bx) * stride, (a.fy - by) * stride, floor)) >= 7;
        const score = Math.sqrt(a.score * b.score) * separation * (markerBand ? 1.5 : 1) * (diagonalBand ? 2 : 1);
        // Ordinary photographs have many isolated FFT peaks. Require both
        // independent directions to stand above the whole-spectrum noise floor,
        // rather than accepting any pair of locally prominent texture peaks.
        const prominence = Math.min(a.score / Math.min(a.contrast, 80), b.score / Math.min(b.contrast, 80)) / Math.max(mean, 1e-8);
        if (prominence < 32 || !diagonalBand) continue;
        candidates.push({ basis, score, markerBand });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const bases = [], selected = [];
    for (const candidate of candidates) {
      for (const basis of [reducedBasis(candidate.basis), candidate.basis]) {
        const turns = rotations(basis);
        if (selected.some((b) => turns.some((t) => t.every((v, i) => Math.abs(v - b[i]) < 0.025)))) continue;
        selected.push(basis); bases.push(...turns);
        if (selected.length === 3) break;
      }
      if (selected.length === 3) break;
    }
    const likely = bases.length > 0;
    return { likely, confirmed: false, markerBand: Boolean(candidates[0]?.markerBand), bases, stride,
      message: likely ? "Possible carrier frequencies found. Checking marker headers; encoding is not yet confirmed."
        : (options.forceSearch || options.corners?.length) ? "No clear encoding frequency signature detected. Continuing with the precheck overridden."
          : "No clear encoding frequency signature detected at this scale." };
  }

  root.PixelStowSpectrum = { analyze };
})(typeof window !== "undefined" ? window : self);
