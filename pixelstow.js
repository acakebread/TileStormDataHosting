// Browser PCF1 encode/decode. The byte layout matches PixelStow's PictureCodec.Core.
// Public frames are stored uncompressed. Compressed frames from the desktop app are still read.
(function () {
  const BLOCK = 4;
  const PREAMBLE_BLOCKS = 72 * 7;
  const MAX_TEXT = 16 * 1024;
  const MAX_FRAMED = 20 * 1024;
  const MAX_BLOCKS = 8 * 1024 * 1024;
  const MAX_PIXELS = 24000000;
  const HEADER = 20;
  const ENVELOPE = 60;
  const ITERATIONS = 600000;
  const STRENGTHS = [8, 12, 16, 24, 32];
  const WAVELET = [-19, -11, 5, 13, 5, -11, -19];
  const SEED = 0x50434631;
  const MAGIC = 0xC7;
  const FLAGS = 1;
  const ONE_PARITY = 2;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) {
        value = (value & 1) !== 0 ? (0xEDB88320 ^ (value >>> 1)) >>> 0 : (value >>> 1);
      }
      table[i] = value >>> 0;
    }
    return table;
  })();

  const WORD_BITS = (() => {
    const table = new Uint8Array(256 * 12);
    for (let value = 0; value < 256; value++) {
      const offset = value * 12;
      const d0 = (value >> 7) & 1;
      const d1 = (value >> 6) & 1;
      const d2 = (value >> 5) & 1;
      const d3 = (value >> 4) & 1;
      const d4 = (value >> 3) & 1;
      const d5 = (value >> 2) & 1;
      const d6 = (value >> 1) & 1;
      const d7 = value & 1;
      table[offset] = d0;
      table[offset + 1] = d1;
      table[offset + 2] = d2;
      table[offset + 3] = d3;
      table[offset + 4] = d4;
      table[offset + 5] = d5;
      table[offset + 6] = d6;
      table[offset + 7] = d7;
      table[offset + 8] = d0 ^ d1 ^ d3 ^ d4 ^ d6;
      table[offset + 9] = d0 ^ d2 ^ d3 ^ d5 ^ d6;
      table[offset + 10] = d1 ^ d2 ^ d3 ^ d7;
      table[offset + 11] = d4 ^ d5 ^ d6 ^ d7;
    }
    return table;
  })();

  const NOISE_KERNELS = (() => {
    const kernels = [];
    for (let v = 0; v < 4; v++) {
      for (let u = 0; u < 4; u++) {
        if ((v & 1) === (u & 1)) continue;
        const kernel = new Float64Array(16);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            kernel[x + y * 4] = (u === 0 ? 0.5 : Math.sqrt(0.5)) *
              (v === 0 ? 0.5 : Math.sqrt(0.5)) *
              Math.cos(Math.PI * u * (x + 0.5) / 4) *
              Math.cos(Math.PI * v * (y + 0.5) / 4);
          }
        }
        kernels.push(kernel);
      }
    }
    return kernels;
  })();

  function frameError(message) {
    const error = new Error(message);
    error.code = "frame";
    return error;
  }

  function yieldNow() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function roundHalfToEven(value) {
    const floor = Math.floor(value);
    const diff = value - floor;
    if (diff < 0.5) return floor;
    if (diff > 0.5) return floor + 1;
    return (floor % 2 === 0) ? floor : floor + 1;
  }

  function crc32(data, offset, count) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < count; i++) {
      crc = (CRC_TABLE[(crc ^ data[offset + i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function writeU32(buffer, offset, value) {
    buffer[offset] = value & 0xFF;
    buffer[offset + 1] = (value >>> 8) & 0xFF;
    buffer[offset + 2] = (value >>> 16) & 0xFF;
    buffer[offset + 3] = (value >>> 24) & 0xFF;
  }

  function readU32(buffer, offset) {
    return ((buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 24)) >>> 0);
  }

  function readU32be(buffer, offset) {
    return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
  }

  function xorshift32(state) {
    state = state >>> 0;
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  }

  function scramble(data, seed) {
    let state = seed >>> 0;
    for (let i = 0; i < data.length; i++) {
      state = xorshift32(state);
      data[i] ^= state & 0xFF;
    }
  }

  function strictUtf8(text) {
    if (typeof text !== "string") throw new Error("The message must be text.");
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0xD800 || code > 0xDFFF) continue;
      if (code <= 0xDBFF && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          i++;
          continue;
        }
      }
      throw new Error("The message is not valid text.");
    }
    return encoder.encode(text);
  }

  function decodeUtf8(bytes) {
    try {
      return decoder.decode(bytes);
    } catch {
      throw frameError("The fingerprint text is not valid.");
    }
  }

  function bytesEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
    return difference === 0;
  }

  function assertImage(pixels, width, height) {
    if (!pixels || width < 1 || height < 1 || width * height * 4 !== pixels.length) {
      throw new Error("The image dimensions are invalid.");
    }
    if (width < BLOCK || height < BLOCK) throw new Error("Use an image at least 4 by 4 pixels.");
    if (width * height > MAX_PIXELS) throw new Error("This image is too large for the browser tool.");
    const blocks = Math.floor(width / BLOCK) * Math.floor(height / BLOCK);
    if (blocks > MAX_BLOCKS) throw new Error("This image is too large for the browser tool.");
    return blocks;
  }

  function estimateBytes(width, height) {
    if (width < BLOCK || height < BLOCK || width * height > MAX_PIXELS) return 0;
    const blocks = Math.floor(width / BLOCK) * Math.floor(height / BLOCK);
    if (blocks <= PREAMBLE_BLOCKS || blocks > MAX_BLOCKS) return 0;
    let framed = Math.floor((blocks - PREAMBLE_BLOCKS) / 9);
    if (framed > MAX_FRAMED) framed = MAX_FRAMED;
    return Math.max(0, Math.min(MAX_TEXT, framed - HEADER));
  }

  function frameChecksum(header, payload) {
    const checked = new Uint8Array(16 + payload.length);
    checked.set(header.subarray(0, 16), 0);
    checked.set(payload, 16);
    return crc32(checked, 0, checked.length);
  }

  async function packFrame(payload, strength, passwordProtected) {
    const max = passwordProtected ? ENVELOPE + MAX_TEXT : MAX_TEXT;
    if (payload.length < 1 || payload.length > max) throw new Error("The message is too long to encode.");
    if (passwordProtected) validateEnvelope(payload);
    // Public text is DEFLATE-compressed when that is smaller, matching the desktop writer.
    // The checksum and declared length always cover the uncompressed bytes.
    let body = payload;
    let compressed = 0;
    if (!passwordProtected) {
      const deflated = await deflateRaw(payload);
      if (deflated.length > 0 && deflated.length < payload.length) {
        body = deflated;
        compressed = 1;
      }
    }
    const frame = new Uint8Array(HEADER + body.length);
    frame.set([0x50, 0x43, 0x46, 0x31], 0);
    frame[4] = passwordProtected ? 2 : 1;
    frame[5] = passwordProtected ? 2 : 1;
    frame[6] = compressed;
    frame[7] = strength;
    writeU32(frame, 8, payload.length);
    writeU32(frame, 12, body.length);
    writeU32(frame, 16, frameChecksum(frame, payload));
    frame.set(body, HEADER);
    scramble(frame, SEED);
    return frame;
  }

  async function inflateRaw(compressed, expectedLength) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot read a compressed fingerprint.");
    }
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      if (bytes.length !== expectedLength) throw frameError("Truncated fingerprint.");
      return bytes;
    } catch (error) {
      if (error && error.code === "frame") throw error;
      throw frameError("Truncated fingerprint.");
    }
  }

  async function unpackFrame(packed) {
    if (packed.length < HEADER) throw frameError("Incomplete fingerprint frame.");
    const frame = packed.slice();
    scramble(frame, SEED);
    const passwordProtected = frame[4] === 2 && frame[5] === 2;
    const magic = frame[0] === 0x50 && frame[1] === 0x43 && frame[2] === 0x46 && frame[3] === 0x31;
    if (!magic || !((frame[4] === 1 && frame[5] === 1) || passwordProtected) ||
      frame[6] > 1 || (passwordProtected && frame[6] !== 0) || frame[7] < 1 || frame[7] > 32) {
      throw frameError("Unsupported fingerprint frame.");
    }
    const rawLength = readU32(frame, 8);
    const bodyLength = readU32(frame, 12);
    const max = passwordProtected ? ENVELOPE + MAX_TEXT : MAX_TEXT;
    if (rawLength < 1 || rawLength > max || bodyLength < 1 || bodyLength !== frame.length - HEADER) {
      throw frameError("Invalid fingerprint lengths.");
    }
    const payload = frame[6] === 0
      ? frame.slice(HEADER)
      : await inflateRaw(frame.subarray(HEADER), rawLength);
    if (payload.length !== rawLength || frameChecksum(frame, payload) !== readU32(frame, 16)) {
      throw frameError("Fingerprint checksum failed.");
    }
    if (passwordProtected) validateEnvelope(payload);
    return { payload, strength: frame[7], passwordProtected };
  }

  function validateEnvelope(envelope) {
    const psp1 = envelope.length > ENVELOPE &&
      envelope[0] === 0x50 && envelope[1] === 0x53 && envelope[2] === 0x50 && envelope[3] === 0x31 &&
      envelope[4] === 1 && envelope[5] === 1 && envelope[6] === 1 && envelope[7] <= 1 &&
      readU32(envelope, 8) === ITERATIONS;
    const textLength = psp1 ? readU32(envelope, 12) : 0;
    const stored = envelope.length - ENVELOPE;
    if (!psp1 || envelope.length > ENVELOPE + MAX_TEXT || textLength < 1 || textLength > MAX_TEXT ||
      (envelope[7] === 0 ? stored !== textLength : stored >= textLength)) {
      throw frameError("Unsupported password-protected payload.");
    }
  }

  async function deriveKey(password, salt) {
    const passwordBytes = strictUtf8(password);
    const base = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
    passwordBytes.fill(0);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: ITERATIONS
    }, base, 256);
    return new Uint8Array(bits);
  }

  async function encryptEnvelope(textBytes, password) {
    let body = textBytes;
    let storedCompressed = 0;
    const deflated = await deflateRaw(textBytes);
    if (deflated.length > 0 && deflated.length < textBytes.length) {
      body = deflated;
      storedCompressed = 1;
    }
    const envelope = new Uint8Array(ENVELOPE + body.length);
    envelope.set([0x50, 0x53, 0x50, 0x31], 0);
    envelope[4] = 1;
    envelope[5] = 1;
    envelope[6] = 1;
    envelope[7] = storedCompressed;
    writeU32(envelope, 8, ITERATIONS);
    writeU32(envelope, 12, textBytes.length);
    crypto.getRandomValues(envelope.subarray(16, 32));
    crypto.getRandomValues(envelope.subarray(32, 44));
    const key = await deriveKey(password, envelope.subarray(16, 32));
    try {
      const aes = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
      const sealed = new Uint8Array(await crypto.subtle.encrypt({
        name: "AES-GCM",
        iv: envelope.subarray(32, 44),
        additionalData: envelope.subarray(0, 44),
        tagLength: 128
      }, aes, body));
      envelope.set(sealed.subarray(0, sealed.length - 16), ENVELOPE);
      envelope.set(sealed.subarray(sealed.length - 16), 44);
      return envelope;
    } finally {
      key.fill(0);
    }
  }

  async function decryptEnvelope(envelope, password) {
    validateEnvelope(envelope);
    const key = await deriveKey(password, envelope.subarray(16, 32));
    try {
      const aes = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
      const sealed = new Uint8Array(envelope.length - 44);
      sealed.set(envelope.subarray(ENVELOPE), 0);
      sealed.set(envelope.subarray(44, ENVELOPE), envelope.length - ENVELOPE);
      let plain;
      try {
        plain = new Uint8Array(await crypto.subtle.decrypt({
          name: "AES-GCM",
          iv: envelope.subarray(32, 44),
          additionalData: envelope.subarray(0, 44),
          tagLength: 128
        }, aes, sealed));
      } catch (error) {
        if (error && error.name === "OperationError") {
          const denied = new Error("The password is incorrect, or the locked message is damaged.");
          denied.code = "incorrect";
          throw denied;
        }
        throw error;
      }
      if (envelope[7] === 0) return plain;
      return inflateRaw(plain, readU32(envelope, 12));
    } finally {
      key.fill(0);
    }
  }

  function scaleWeight(amplitude, weight) {
    const product = amplitude * weight;
    if (product >= 0) return Math.trunc((product + 8) / 16);
    return -Math.trunc((-product + 8) / 16);
  }

  function shapeWeight(dx, dy, bit) {
    const distance = bit === 1 ? dx - dy : dx + dy - 3;
    return WAVELET[distance + 3];
  }

  function step(channel, delta) {
    if (channel + delta >= 0 && channel + delta <= 255) return delta;
    if (channel - delta >= 0 && channel - delta <= 255) return -delta;
    return 0;
  }

  function clampByte(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return value;
  }

  function tryFitShift(reference, width, originX, originY, bit, amplitude, channel) {
    let minShift = -2147483648;
    let maxShift = 2147483647;
    for (let dy = 0; dy < BLOCK; dy++) {
      for (let dx = 0; dx < BLOCK; dx++) {
        const delta = scaleWeight(amplitude, shapeWeight(dx, dy, bit));
        const sample = reference[(originX + dx + (originY + dy) * width) * 4 + channel];
        const floor = -sample - delta;
        const ceil = 255 - sample - delta;
        if (floor > minShift) minShift = floor;
        if (ceil < maxShift) maxShift = ceil;
      }
    }
    if (minShift > maxShift) return { ok: false, shift: 0 };
    if (minShift > 0) return { ok: true, shift: minShift };
    if (maxShift < 0) return { ok: true, shift: maxShift };
    return { ok: true, shift: 0 };
  }

  function fitBias(reference, width, originX, originY, bit, amplitude) {
    const fit = [false, false, false];
    const shift = [0, 0, 0];
    for (let channel = 0; channel < 3; channel++) {
      const fitted = tryFitShift(reference, width, originX, originY, bit, amplitude, channel);
      fit[channel] = fitted.ok;
      shift[channel] = fitted.shift;
    }
    return { fit, shift };
  }

  function appliedDelta(reference, index, dx, dy, bit, amplitude, channel, bias) {
    const ideal = scaleWeight(amplitude, shapeWeight(dx, dy, bit));
    if (bias.fit[channel]) return ideal + bias.shift[channel];
    return step(reference[index + channel], ideal);
  }

  function expectedLuma(reference, index, dx, dy, bit, amplitude, bias) {
    return appliedDelta(reference, index, dx, dy, bit, amplitude, 0, bias) +
      appliedDelta(reference, index, dx, dy, bit, amplitude, 1, bias) +
      appliedDelta(reference, index, dx, dy, bit, amplitude, 2, bias);
  }

  function simulatedScore(reference, width, originX, originY, writtenBit, amplitude) {
    const biasOne = fitBias(reference, width, originX, originY, 1, amplitude);
    const biasZero = fitBias(reference, width, originX, originY, 0, amplitude);
    let favorOne = 0;
    let favorZero = 0;
    for (let dy = 0; dy < BLOCK; dy++) {
      for (let dx = 0; dx < BLOCK; dx++) {
        const index = (originX + dx + (originY + dy) * width) * 4;
        const one = expectedLuma(reference, index, dx, dy, 1, amplitude, biasOne);
        const zero = expectedLuma(reference, index, dx, dy, 0, amplitude, biasZero);
        const observed = writtenBit === 1 ? one : zero;
        favorOne += observed * one;
        favorZero += observed * zero;
      }
    }
    return favorOne - favorZero;
  }

  function resolveAmplitude(reference, width, originX, originY, strength) {
    for (let candidate = strength; candidate >= 1; candidate--) {
      if (simulatedScore(reference, width, originX, originY, 1, candidate) > 0 &&
        simulatedScore(reference, width, originX, originY, 0, candidate) < 0) {
        return candidate;
      }
    }
    return 0;
  }

  function applyBit(reference, image, width, column, blockRow, bit, strength, amplitudeCache) {
    const originX = column * BLOCK;
    const originY = blockRow * BLOCK;
    const cacheIndex = amplitudeCache ? column + blockRow * (width / BLOCK | 0) : -1;
    let amplitude = cacheIndex >= 0 ? amplitudeCache[cacheIndex] : -1;
    if (amplitude < 0) {
      amplitude = resolveAmplitude(reference, width, originX, originY, strength);
      if (cacheIndex >= 0) amplitudeCache[cacheIndex] = amplitude;
    }
    if (amplitude === 0) return;
    const bias = fitBias(reference, width, originX, originY, bit, amplitude);
    for (let dy = 0; dy < BLOCK; dy++) {
      for (let dx = 0; dx < BLOCK; dx++) {
        const index = (originX + dx + (originY + dy) * width) * 4;
        image[index] = clampByte(reference[index] + appliedDelta(reference, index, dx, dy, bit, amplitude, 0, bias));
        image[index + 1] = clampByte(reference[index + 1] + appliedDelta(reference, index, dx, dy, bit, amplitude, 1, bias));
        image[index + 2] = clampByte(reference[index + 2] + appliedDelta(reference, index, dx, dy, bit, amplitude, 2, bias));
        image[index + 3] = reference[index + 3];
      }
    }
  }

  function scatterOrder(blockCount, seed) {
    const order = new Uint32Array(blockCount);
    for (let i = 0; i < blockCount; i++) order[i] = i;
    let state = (seed ^ 0x51F15E5D) >>> 0;
    for (let i = blockCount - 1; i > 0; i--) {
      state = xorshift32(state);
      const pick = state % (i + 1);
      const swap = order[i];
      order[i] = order[pick];
      order[pick] = swap;
    }
    return order;
  }

  async function writeBits(reference, image, width, columns, slots, bitAt, strength, amplitudeCache) {
    for (let slot = 0; slot < slots.length; slot++) {
      if ((slot & 8191) === 8191) await yieldNow();
      const bit = bitAt(slot);
      const block = slots[slot];
      applyBit(reference, image, width, block % columns, Math.floor(block / columns), bit, strength, amplitudeCache);
    }
  }

  async function writeSignal(reference, image, width, height, framed, strength) {
    const columns = Math.floor(width / BLOCK);
    const blockCount = columns * Math.floor(height / BLOCK);
    const payloadBlocks = blockCount - PREAMBLE_BLOCKS;
    if (payloadBlocks < 1 || framed.length > MAX_FRAMED) {
      throw new Error("This image is too small for that message. Use a larger picture or a shorter message.");
    }
    let bitsPerByte = 0;
    if (framed.length * 12 <= payloadBlocks) bitsPerByte = 12;
    else if (framed.length * 9 <= payloadBlocks) bitsPerByte = 9;
    if (bitsPerByte === 0) {
      throw new Error("This image is too small for that message. Use a larger picture or a shorter message.");
    }
    const parityBits = bitsPerByte === 12 ? 4 : 1;
    const flags = FLAGS | (parityBits === 1 ? ONE_PARITY : 0);
    const bytes = new Uint8Array(9);
    bytes[0] = MAGIC;
    bytes[1] = 1;
    bytes[2] = flags;
    writeU32(bytes, 3, framed.length);
    const crc = crc32(bytes, 0, 7) & 0xFFFF;
    bytes[7] = crc & 0xFF;
    bytes[8] = (crc >> 8) & 0xFF;
    const amplitudeCache = new Int16Array(blockCount);
    amplitudeCache.fill(-1);
    const preambleOrder = scatterOrder(PREAMBLE_BLOCKS, SEED);
    await writeBits(reference, image, width, columns, preambleOrder, (slot) => {
      const bitIndex = slot % 72;
      return (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    }, strength, amplitudeCache);
    const payloadOrder = scatterOrder(payloadBlocks, SEED);
    const payloadSlots = new Uint32Array(payloadBlocks);
    for (let slot = 0; slot < payloadBlocks; slot++) payloadSlots[slot] = PREAMBLE_BLOCKS + payloadOrder[slot];
    await writeBits(reference, image, width, columns, payloadSlots, (slot) => codedBit(framed, slot % (framed.length * bitsPerByte), bitsPerByte), strength, amplitudeCache);
    return {
      copies: Math.floor(payloadBlocks / (framed.length * bitsPerByte)),
      parityBits
    };
  }

  function codedBit(data, index, bitsPerByte) {
    if (bitsPerByte === 12) {
      const value = data[(index / 12) | 0];
      return WORD_BITS[value * 12 + (index % 12)];
    }
    const bit = index % 9;
    const value = data[(index / 9) | 0];
    if (bit === 8) return evenParity(value);
    return (value >> (7 - bit)) & 1;
  }

  function evenParity(value) {
    let parity = 0;
    for (let i = 0; i < 8; i++) parity ^= (value >> i) & 1;
    return parity;
  }

  function tryReadPreamble(scores) {
    if (!scores || scores.length < PREAMBLE_BLOCKS) return null;
    const order = scatterOrder(PREAMBLE_BLOCKS, SEED);
    const totals = new Int32Array(72);
    for (let slot = 0; slot < PREAMBLE_BLOCKS; slot++) {
      totals[slot % 72] = (totals[slot % 72] + scores[order[slot]]) | 0;
    }
    const bytes = new Uint8Array(9);
    for (let bit = 0; bit < 72; bit++) {
      if (totals[bit] > 0) bytes[bit >> 3] |= 1 << (7 - (bit & 7));
    }
    if (bytes[0] !== MAGIC) return null;
    const crc = crc32(bytes, 0, 7) & 0xFFFF;
    const stored = bytes[7] | (bytes[8] << 8);
    if (crc !== stored) return null;
    const framedLength = readU32(bytes, 3);
    if (framedLength < 1) return null;
    return { version: bytes[1], flags: bytes[2], framedLength };
  }

  function combineScores(blockScores, order, codedBits) {
    const combined = new Int32Array(codedBits);
    for (let slot = 0; slot < blockScores.length; slot++) {
      const index = slot % codedBits;
      combined[index] = (combined[index] + blockScores[order[slot]]) | 0;
    }
    return combined;
  }

  function decodeOneParity(scores, byteCount) {
    let corrections = 0;
    const output = new Uint8Array(byteCount);
    for (let byteIndex = 0; byteIndex < byteCount; byteIndex++) {
      const start = byteIndex * 9;
      let value = 0;
      let parity = 0;
      let weakest = 8;
      let weakestMag = Math.abs(scores[start + 8]);
      for (let bit = 0; bit < 8; bit++) {
        const score = scores[start + bit];
        const bitValue = score > 0 ? 1 : 0;
        value = (value << 1) | bitValue;
        parity ^= bitValue;
        const magnitude = Math.abs(score);
        if (magnitude < weakestMag) {
          weakestMag = magnitude;
          weakest = bit;
        }
      }
      const parityBit = scores[start + 8] > 0 ? 1 : 0;
      if (parity !== parityBit) {
        corrections++;
        if (weakest < 8) value ^= 1 << (7 - weakest);
      }
      output[byteIndex] = value;
    }
    return { bytes: output, corrections };
  }

  function decodeSoft(scores, byteCount) {
    let corrections = 0;
    const output = new Uint8Array(byteCount);
    for (let byteIndex = 0; byteIndex < byteCount; byteIndex++) {
      const start = byteIndex * 12;
      let bestValue = 0;
      let best = -Infinity;
      let bestMisses = 2147483647;
      for (let value = 0; value < 256; value++) {
        let match = 0;
        let misses = 0;
        const origin = value * 12;
        for (let bit = 0; bit < 12; bit++) {
          const hypothesis = WORD_BITS[origin + bit];
          const score = scores[start + bit];
          match += hypothesis === 1 ? score : -score;
          if ((score > 0 && hypothesis === 0) || (score < 0 && hypothesis === 1)) misses++;
        }
        if (match > best || (match === best && (misses < bestMisses || (misses === bestMisses && value < bestValue)))) {
          best = match;
          bestValue = value;
          bestMisses = misses;
        }
      }
      output[byteIndex] = bestValue;
      if (bestMisses > 0) corrections++;
    }
    return { bytes: output, corrections };
  }

  function readFramedScores(scores) {
    const preamble = tryReadPreamble(scores);
    if (!preamble) throw frameError("The image does not contain a matching carrier header.");
    if (preamble.version !== 1 || preamble.framedLength < HEADER || preamble.framedLength > MAX_FRAMED) {
      throw frameError("Unsupported image carrier.");
    }
    if ((preamble.flags & ~ONE_PARITY) !== FLAGS) throw frameError("The carrier flags do not match this profile.");
    const bitsPerByte = (preamble.flags & ONE_PARITY) !== 0 ? 9 : 12;
    const parityBits = bitsPerByte === 12 ? 4 : 1;
    const payloadBlocks = scores.length - PREAMBLE_BLOCKS;
    const codedBits = preamble.framedLength * bitsPerByte;
    if (payloadBlocks < codedBits) throw frameError("The image does not hold a complete copy of the payload.");
    const order = scatterOrder(payloadBlocks, SEED);
    const combined = combineScores(scores.subarray(PREAMBLE_BLOCKS), order, codedBits);
    const decoded = bitsPerByte === 12
      ? decodeSoft(combined, preamble.framedLength)
      : decodeOneParity(combined, preamble.framedLength);
    return {
      bytes: decoded.bytes,
      corrections: decoded.corrections,
      copies: Math.floor(payloadBlocks / codedBits),
      parityBits
    };
  }

  function buildShapes(strength) {
    const difference = new Float64Array(16);
    const common = new Float64Array(16);
    let mean = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const one = scaleWeight(strength, WAVELET[x - y + 3]);
        const zero = scaleWeight(strength, WAVELET[x + y]);
        const i = x + y * 4;
        difference[i] = one - zero;
        common[i] = (one + zero) / 2;
        mean += common[i] / 16;
      }
    }
    for (let i = 0; i < 16; i++) common[i] -= mean;
    return { difference, common };
  }

  async function scoreBlocks(pixels, width, columns, rows, difference, common) {
    let differenceEnergy = 0;
    for (let i = 0; i < 16; i++) differenceEnergy += difference[i] * difference[i];
    const scores = new Int32Array(columns * rows);
    const bounded = new Int32Array(scores.length);
    const block = new Float64Array(16);
    for (let row = 0; row < rows; row++) {
      if ((row & 15) === 15) await yieldNow();
      for (let column = 0; column < columns; column++) {
        let projection = 0;
        const originY = row * 4;
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const i = x + y * 4;
            const pixel = (column * 4 + x + (originY + y) * width) * 4;
            block[i] = (pixels[pixel] + pixels[pixel + 1] + pixels[pixel + 2]) / 3;
            projection += block[i] * difference[i];
          }
        }
        let noiseEnergy = 25;
        for (let k = 0; k < NOISE_KERNELS.length; k++) {
          let coefficient = 0;
          const kernel = NOISE_KERNELS[k];
          for (let i = 0; i < 16; i++) coefficient += block[i] * kernel[i];
          noiseEnergy += coefficient * coefficient;
        }
        const index = column + row * columns;
        scores[index] = roundHalfToEven(100 * projection / Math.sqrt(noiseEnergy));
        const bound = differenceEnergy / 2;
        const clamped = projection < -bound ? -bound : (projection > bound ? bound : projection);
        bounded[index] = roundHalfToEven(100 * clamped / 5);
      }
    }
    return { scores, bounded };
  }

  async function tryLayout(scores) {
    try {
      const framed = readFramedScores(scores);
      const unpacked = await unpackFrame(framed.bytes);
      return {
        payload: unpacked.payload,
        strength: unpacked.strength,
        corrections: framed.corrections,
        copies: framed.copies,
        parityBits: framed.parityBits,
        passwordProtected: unpacked.passwordProtected
      };
    } catch (error) {
      if (error && error.code === "frame") return null;
      throw error;
    }
  }

  async function tryReadAt(pixels, width, height, strength) {
    const columns = Math.floor(width / BLOCK);
    const rows = Math.floor(height / BLOCK);
    const blockCount = columns * rows;
    if (blockCount <= PREAMBLE_BLOCKS || blockCount > MAX_BLOCKS) return null;
    strength = Math.max(1, Math.min(32, strength | 0));
    const shapes = buildShapes(strength);
    const scored = await scoreBlocks(pixels, width, columns, rows, shapes.difference, shapes.common);
    return (await tryLayout(scored.scores)) || (await tryLayout(scored.bounded));
  }

  async function recover(pixels, width, height) {
    if (!pixels || width < BLOCK || height < BLOCK || pixels.length !== width * height * 4) return null;
    if (width * height > MAX_PIXELS) throw new Error("This image is too large for the browser tool.");
    for (let i = 0; i < STRENGTHS.length; i++) {
      const found = await tryReadAt(pixels, width, height, STRENGTHS[i]);
      if (found) return found;
    }
    return null;
  }

  async function inspect(pixels, width, height) {
    const recovery = await recover(pixels, width, height);
    if (!recovery) return { found: false };
    try {
      if (recovery.passwordProtected) validateEnvelope(recovery.payload);
      else decodeUtf8(recovery.payload);
    } catch {
      return { found: false };
    }
    return {
      found: true,
      passwordProtected: recovery.passwordProtected,
      strength: recovery.strength
    };
  }

  async function decode(pixels, width, height, password) {
    const recovery = await recover(pixels, width, height);
    if (!recovery) return { status: "none" };
    if (recovery.passwordProtected && !password) {
      return { status: "password", strength: recovery.strength };
    }
    try {
      const textBytes = recovery.passwordProtected
        ? await decryptEnvelope(recovery.payload, password)
        : recovery.payload;
      return {
        status: "success",
        text: decodeUtf8(textBytes),
        passwordProtected: recovery.passwordProtected,
        strength: recovery.strength
      };
    } catch (error) {
      if (error && error.code === "incorrect") return { status: "incorrect" };
      if (error && error.code === "frame") return { status: "none" };
      throw error;
    }
  }

  async function encodeAt(reference, width, height, payload, passwordProtected, strength, adaptive) {
    strength = Math.max(1, Math.min(32, strength));
    const probe = await packFrame(payload, 8, passwordProtected);
    const columns = Math.floor(width / BLOCK);
    const blockCount = columns * Math.floor(height / BLOCK);
    if (adaptive) {
      const available = blockCount - PREAMBLE_BLOCKS;
      let bitsPerByte = 0;
      if (probe.length * 12 <= available) bitsPerByte = 12;
      else if (probe.length * 9 <= available) bitsPerByte = 9;
      if (available <= 0 || bitsPerByte === 0) {
        throw new Error("This image is too small for that message. Use a larger picture or a shorter message.");
      }
      const copies = Math.max(1, Math.floor(available / (probe.length * bitsPerByte)));
      const multiplier = copies >= 4 ? 1 : copies === 3 ? 1.5 : copies === 2 ? 2 : 4;
      const adjusted = Math.min(32, Math.max(strength, roundHalfToEven(strength * multiplier)));
      if (adjusted !== strength) strength = adjusted;
    }
    const framed = await packFrame(payload, strength, passwordProtected);
    const pixels = reference.slice();
    const written = await writeSignal(reference, pixels, width, height, framed, strength);
    return {
      pixels,
      strength,
      copies: written.copies,
      parityBits: written.parityBits,
      passwordProtected
    };
  }

  async function encode(pixels, width, height, text, password) {
    assertImage(pixels, width, height);
    await yieldNow();
    const existing = await inspect(pixels, width, height);
    if (existing.found) {
      throw new Error("This image already contains a fingerprint. Choose a picture that does not have one.");
    }
    const textBytes = strictUtf8(text);
    if (textBytes.length < 1 || textBytes.length > MAX_TEXT) {
      throw new Error(textBytes.length < 1 ? "Enter a message to encode." : "The message is longer than 16 KiB.");
    }
    const locked = typeof password === "string" && password.length > 0;
    const payload = locked ? await encryptEnvelope(textBytes, password) : textBytes.slice();
    textBytes.fill(0);
    let encoded = await encodeAt(pixels, width, height, payload, locked, STRENGTHS[0], true);
    for (;;) {
      const recovery = await tryReadAt(encoded.pixels, width, height, encoded.strength);
      if (recovery && bytesEqual(recovery.payload, payload)) {
        return {
          pixels: encoded.pixels,
          width,
          height,
          strength: encoded.strength,
          copies: encoded.copies,
          parityBits: encoded.parityBits,
          passwordProtected: locked
        };
      }
      let next = 0;
      for (let i = 0; i < STRENGTHS.length; i++) {
        if (STRENGTHS[i] > encoded.strength) {
          next = STRENGTHS[i];
          break;
        }
      }
      if (next === 0) {
        throw new Error("The message could not be verified in this image. Try another picture or a shorter message.");
      }
      encoded = await encodeAt(pixels, width, height, payload, locked, next, false);
    }
  }

  function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const diagonal = Math.abs(estimate - upLeft);
    if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
    if (upDistance <= diagonal) return up;
    return upLeft;
  }

  async function inflateZlib(compressed) {
    if (typeof DecompressionStream !== "function") throw new Error("This browser cannot read PNG files.");
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function pngFallback(message) {
    const error = new Error(message || "Unsupported PNG.");
    error.code = "png-fallback";
    return error;
  }

  async function decodePng(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 8) throw new Error("Not a PNG.");
    for (let i = 0; i < 8; i++) if (bytes[i] !== signature[i]) throw new Error("Not a PNG.");
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let sawHeader = false;
    let sawEnd = false;
    const parts = [];
    while (offset + 12 <= bytes.length) {
      const length = readU32be(bytes, offset);
      if (offset + 12 + length > bytes.length) throw new Error("Truncated PNG.");
      const typeStart = offset + 4;
      const type = String.fromCharCode(bytes[typeStart], bytes[typeStart + 1], bytes[typeStart + 2], bytes[typeStart + 3]);
      if (crc32(bytes, typeStart, 4 + length) !== readU32be(bytes, typeStart + 4 + length)) {
        throw new Error("PNG checksum failed.");
      }
      const data = bytes.subarray(typeStart + 4, typeStart + 4 + length);
      if (type === "IHDR") {
        if (sawHeader || data.length !== 13) throw new Error("Invalid PNG header.");
        width = readU32be(data, 0);
        height = readU32be(data, 4);
        bitDepth = data[8];
        colorType = data[9];
        if (data[10] !== 0 || data[11] !== 0) throw pngFallback();
        interlace = data[12];
        sawHeader = true;
      } else if (type === "IDAT") {
        if (!sawHeader) throw new Error("Invalid PNG.");
        parts.push(data);
      } else if (type === "IEND") {
        sawEnd = true;
        break;
      } else if ((bytes[typeStart] & 32) === 0 && type !== "PLTE") {
        throw pngFallback();
      }
      offset = typeStart + 8 + length;
    }
    if (!sawHeader || parts.length === 0 || !sawEnd || width < 1 || height < 1) throw new Error("Incomplete PNG.");
    if (interlace !== 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw pngFallback();
    let size = 0;
    for (let i = 0; i < parts.length; i++) size += parts[i].length;
    const compressed = new Uint8Array(size);
    let cursor = 0;
    for (let i = 0; i < parts.length; i++) {
      compressed.set(parts[i], cursor);
      cursor += parts[i].length;
    }
    const channels = colorType === 6 ? 4 : 3;
    const rowSize = width * channels;
    const raw = await inflateZlib(compressed);
    if (raw.length !== height * (rowSize + 1)) throw new Error("Unexpected PNG image data.");
    const samples = new Uint8Array(height * rowSize);
    let source = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[source++];
      const dest = y * rowSize;
      const prior = dest - rowSize;
      for (let x = 0; x < rowSize; x++) {
        const left = x >= channels ? samples[dest + x - channels] : 0;
        const up = y > 0 ? samples[prior + x] : 0;
        const upLeft = y > 0 && x >= channels ? samples[prior + x - channels] : 0;
        const value = raw[source++];
        let decoded = value;
        if (filter === 1) decoded = value + left;
        else if (filter === 2) decoded = value + up;
        else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
        else if (filter === 4) decoded = value + paeth(left, up, upLeft);
        else if (filter !== 0) throw new Error("Unsupported PNG filter.");
        samples[dest + x] = decoded & 255;
      }
    }
    if (channels === 4) return { pixels: samples, width, height, exact: true };
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < samples.length; i += 3, j += 4) {
      pixels[j] = samples[i];
      pixels[j + 1] = samples[i + 1];
      pixels[j + 2] = samples[i + 2];
      pixels[j + 3] = 255;
    }
    return { pixels, width, height, exact: true };
  }

  async function deflateRaw(data) {
    if (typeof CompressionStream !== "function") return deflateStored(data);
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function deflateStored(data) {
    const chunks = [];
    for (let offset = 0; offset < data.length || offset === 0; offset += 65535) {
      const length = Math.min(65535, data.length - offset);
      const block = new Uint8Array(5 + Math.max(0, length));
      block[0] = offset + length >= data.length ? 1 : 0;
      block[1] = length & 255;
      block[2] = (length >> 8) & 255;
      const inverted = (~length) & 0xFFFF;
      block[3] = inverted & 255;
      block[4] = (inverted >> 8) & 255;
      if (length > 0) block.set(data.subarray(offset, offset + length), 5);
      chunks.push(block);
      if (data.length === 0) break;
    }
    let size = 0;
    for (let i = 0; i < chunks.length; i++) size += chunks[i].length;
    const out = new Uint8Array(size);
    let cursor = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], cursor);
      cursor += chunks[i].length;
    }
    return out;
  }

  function adler32(data) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < data.length; i++) {
      a += data[i];
      b += a;
      if ((i & 4095) === 4095) {
        a %= 65521;
        b %= 65521;
      }
    }
    a %= 65521;
    b %= 65521;
    return ((b << 16) | a) >>> 0;
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    writeU32be(out, 0, data.length);
    out.set(type, 4);
    out.set(data, 8);
    writeU32be(out, 8 + data.length, crc32(out, 4, 4 + data.length));
    return out;
  }

  function writeU32be(buffer, offset, value) {
    buffer[offset] = (value >>> 24) & 255;
    buffer[offset + 1] = (value >>> 16) & 255;
    buffer[offset + 2] = (value >>> 8) & 255;
    buffer[offset + 3] = value & 255;
  }

  async function writePng(pixels, width, height) {
    assertImage(pixels, width, height);
    const stride = width * 4;
    const raw = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      const dest = y * (stride + 1);
      raw[dest] = 0;
      raw.set(pixels.subarray(y * stride, y * stride + stride), dest + 1);
    }
    const compressed = await deflateRaw(raw);
    const zlib = new Uint8Array(2 + compressed.length + 4);
    zlib[0] = 0x78;
    zlib[1] = 0x9C;
    zlib.set(compressed, 2);
    writeU32be(zlib, zlib.length - 4, adler32(raw));
    const header = new Uint8Array(13);
    writeU32be(header, 0, width);
    writeU32be(header, 4, height);
    header[8] = 8;
    header[9] = 6;
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = chunk([73, 72, 68, 82], header);
    const idat = chunk([73, 68, 65, 84], zlib);
    const iend = chunk([73, 69, 78, 68], new Uint8Array(0));
    const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
    png.set(signature, 0);
    png.set(ihdr, signature.length);
    png.set(idat, signature.length + ihdr.length);
    png.set(iend, signature.length + ihdr.length + idat.length);
    return new Blob([png], { type: "image/png" });
  }

  async function writeJpeg(pixels, width, height) {
    assertImage(pixels, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const view = new Uint8ClampedArray(pixels.length);
    view.set(pixels);
    context.putImageData(new ImageData(view, width, height), 0, 0);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("The JPEG could not be saved."));
      }, "image/jpeg", 0.92);
    });
    return blob;
  }

  async function decodeWithCanvas(file) {
    if (typeof createImageBitmap !== "function") throw new Error("Could not read that image. Use a PNG or JPEG.");
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      return { pixels: new Uint8Array(image.data.buffer), width: bitmap.width, height: bitmap.height, exact: false };
    } finally {
      bitmap.close();
    }
  }

  function isPng(bytes) {
    return bytes.length > 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  }

  async function readImageFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isPng(bytes)) {
      try {
        return await decodePng(bytes);
      } catch (error) {
        if (!error || error.code !== "png-fallback") throw error;
      }
    }
    return decodeWithCanvas(file);
  }

  function clampRange(value, minimum, maximum) {
    if (value < minimum) return minimum;
    if (value > maximum) return maximum;
    return value;
  }

  function clampChannel(value) {
    const rounded = roundHalfToEven(value);
    if (rounded < 0) return 0;
    if (rounded > 255) return 255;
    return rounded;
  }

  async function extractCarrier(pixels, width, height, strength) {
    assertImage(pixels, width, height);
    strength = Math.max(1, Math.min(32, strength | 0));
    const common = new Float64Array(16);
    const difference = new Float64Array(16);
    let mean = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = x + y * 4;
        const one = scaleWeight(strength, WAVELET[x - y + 3]);
        const zero = scaleWeight(strength, WAVELET[x + y]);
        common[i] = (one + zero) / 2;
        difference[i] = one - zero;
        mean += common[i] / 16;
      }
    }
    let commonEnergy = 0;
    let differenceEnergy = 0;
    for (let i = 0; i < 16; i++) {
      common[i] -= mean;
      commonEnergy += common[i] * common[i];
      differenceEnergy += difference[i] * difference[i];
    }
    if (commonEnergy === 0 || differenceEnergy === 0) {
      throw new Error("The source image could not be recovered.");
    }
    const carrier = pixels.slice();
    const columns = Math.floor(width / BLOCK);
    const rows = Math.floor(height / BLOCK);
    for (let row = 0; row < rows; row++) {
      if ((row & 15) === 15) await yieldNow();
      for (let column = 0; column < columns; column++) {
        let marker = 0;
        let bit = 0;
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const pixel = (column * BLOCK + x + (row * BLOCK + y) * width) * 4;
            const brightness = (pixels[pixel] + pixels[pixel + 1] + pixels[pixel + 2]) / 3;
            const k = x + y * 4;
            marker += brightness * common[k];
            bit += brightness * difference[k];
          }
        }
        marker = clampRange(marker / commonEnergy, 0, 1);
        bit = clampRange(bit / differenceEnergy, -0.5, 0.5);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const k = x + y * 4;
            const signal = marker * common[k] + bit * difference[k];
            const pixel = (column * BLOCK + x + (row * BLOCK + y) * width) * 4;
            carrier[pixel] = clampChannel(pixels[pixel] - signal);
            carrier[pixel + 1] = clampChannel(pixels[pixel + 1] - signal);
            carrier[pixel + 2] = clampChannel(pixels[pixel + 2] - signal);
            carrier[pixel + 3] = pixels[pixel + 3];
          }
        }
      }
    }
    return carrier;
  }

  window.PixelStow = {
    estimateBytes,
    inspect,
    decode,
    encode,
    extractCarrier,
    readImageFile,
    decodePng,
    writePng,
    writeJpeg
  };
})();
