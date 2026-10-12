// Browser PCF1 encode/decode. The byte layout matches PixelStow's PictureCodec.Core.
// Text keeps v1/v2 compatibility. Attachment bundles use the v3 envelope.
(function (root) {
  const BLOCK = 4;
  const PREAMBLE_BLOCKS = 72 * 7;
  const MAX_TEXT = 16 * 1024;
  const MAX_BUNDLE = 1024 * 1024;
  const MAX_FILES = 8;
  const MAX_FRAMED = MAX_BUNDLE + 80;
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
  const CARRIER_V1 = 1;
  const CARRIER_V3 = 3;
  let preferredCarrier = CARRIER_V3;
  const codecScriptUrl = typeof document !== "undefined" ? document.currentScript?.src : null;
  // Store geometry and, for photographs, the rectified native pixel grid. Payload
  // bytes are never cached; every later read still verifies the carrier/frame.
  const visualMappings = new WeakMap();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
    return Math.min(MAX_TEXT, estimatePayloadBytes(width, height));
  }

  function estimatePayloadBytes(width, height, passwordProtected = false, carrierVersion = preferredCarrier) {
    if (width < BLOCK || height < BLOCK || width * height > MAX_PIXELS) return 0;
    const blocks = Math.floor(width / BLOCK) * Math.floor(height / BLOCK) -
      (carrierVersion === CARRIER_V3 && locatorFits(width, height) ? 8 * LOCATOR_WIDTH * LOCATOR_HEIGHT / 16 : 0);
    if (blocks <= PREAMBLE_BLOCKS || blocks > MAX_BLOCKS) return 0;
    let framed = Math.floor((blocks - PREAMBLE_BLOCKS) / 9);
    if (framed > MAX_FRAMED) framed = MAX_FRAMED;
    return Math.max(0, Math.min(MAX_BUNDLE, framed - HEADER - (passwordProtected ? ENVELOPE : 0)));
  }

  function attachmentMetadata(name, type) {
    const nameBytes = strictUtf8(name);
    const typeBytes = strictUtf8(type);
    if (!nameBytes.length || nameBytes.length > 255 || /[\x00-\x1f\x7f/\\:]/.test(name) || name === "." || name === "..") {
      throw frameError("Attachment names must be simple filenames of at most 255 UTF-8 bytes.");
    }
    if (!typeBytes.length || typeBytes.length > 127 || !/^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+(?:;[ -~]*)?$/i.test(type)) {
      throw frameError("Invalid attachment media type.");
    }
    return { nameBytes, typeBytes };
  }

  // PSB1: magic, version, reserved flags, uint16 count, uint32 text length,
  // then UTF-8 text and entries (uint16 name/type lengths, uint32 data length, bytes).
  function packBundle(text, attachments) {
    const textBytes = strictUtf8(text);
    if (textBytes.length > MAX_TEXT) throw new Error("The message is longer than 16 KiB.");
    if (!Array.isArray(attachments) || attachments.length < 1 || attachments.length > MAX_FILES) {
      throw new Error("Add between one and eight attachments.");
    }
    let size = 12 + textBytes.length;
    const entries = attachments.map((file) => {
      if (!(file.bytes instanceof Uint8Array)) throw new Error("Attachment data must be bytes.");
      const metadata = attachmentMetadata(file.name, file.type || "application/octet-stream");
      size += 8 + metadata.nameBytes.length + metadata.typeBytes.length + file.bytes.length;
      return { ...metadata, bytes: file.bytes };
    });
    if (size > MAX_BUNDLE) throw new Error("The message and attachments exceed the 1 MiB payload limit.");
    const bundle = new Uint8Array(size);
    const view = new DataView(bundle.buffer);
    bundle.set([0x50, 0x53, 0x42, 0x31, 1, 0]);
    view.setUint16(6, entries.length, true);
    view.setUint32(8, textBytes.length, true);
    bundle.set(textBytes, 12);
    let cursor = 12 + textBytes.length;
    for (const file of entries) {
      view.setUint16(cursor, file.nameBytes.length, true);
      view.setUint16(cursor + 2, file.typeBytes.length, true);
      view.setUint32(cursor + 4, file.bytes.length, true);
      cursor += 8;
      for (const bytes of [file.nameBytes, file.typeBytes, file.bytes]) {
        bundle.set(bytes, cursor);
        cursor += bytes.length;
      }
    }
    return bundle;
  }

  function unpackBundle(bundle) {
    if (bundle.length < 12 || bundle.length > MAX_BUNDLE ||
      !bytesEqual(bundle.subarray(0, 6), new Uint8Array([0x50, 0x53, 0x42, 0x31, 1, 0]))) {
      throw frameError("Unsupported attachment bundle.");
    }
    const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
    const count = view.getUint16(6, true);
    const textLength = view.getUint32(8, true);
    if (count < 1 || count > MAX_FILES || textLength > MAX_TEXT || 12 + textLength > bundle.length) {
      throw frameError("Invalid attachment bundle lengths.");
    }
    const text = decodeUtf8(bundle.subarray(12, 12 + textLength));
    let cursor = 12 + textLength;
    const attachments = [];
    for (let i = 0; i < count; i++) {
      if (cursor + 8 > bundle.length) throw frameError("Truncated attachment header.");
      const nameLength = view.getUint16(cursor, true);
      const typeLength = view.getUint16(cursor + 2, true);
      const dataLength = view.getUint32(cursor + 4, true);
      cursor += 8;
      if (nameLength < 1 || nameLength > 255 || typeLength < 1 || typeLength > 127 ||
        cursor + nameLength + typeLength + dataLength > bundle.length) {
        throw frameError("Invalid attachment lengths.");
      }
      const name = decodeUtf8(bundle.subarray(cursor, cursor += nameLength));
      const type = decodeUtf8(bundle.subarray(cursor, cursor += typeLength));
      attachmentMetadata(name, type);
      const bytes = bundle.slice(cursor, cursor += dataLength);
      attachments.push({ name, type, bytes });
    }
    if (cursor !== bundle.length) throw frameError("Unexpected attachment bundle data.");
    return { text, attachments };
  }

  function payloadSize(text, attachments = []) {
    return attachments.length ? packBundle(text, attachments).length : strictUtf8(text).length;
  }

  function payloadsEqual(left, right) {
    if (left.text !== right.text || left.attachments.length !== right.attachments.length) return false;
    return left.attachments.every((file, i) => file.name === right.attachments[i].name &&
      file.type === right.attachments[i].type && bytesEqual(file.bytes, right.attachments[i].bytes));
  }

  function frameChecksum(header, payload) {
    const checked = new Uint8Array(16 + payload.length);
    checked.set(header.subarray(0, 16), 0);
    checked.set(payload, 16);
    return crc32(checked, 0, checked.length);
  }

  async function packFrame(payload, strength, passwordProtected, bundle = false) {
    const limit = bundle ? MAX_BUNDLE : MAX_TEXT;
    const max = passwordProtected ? ENVELOPE + limit : limit;
    if (payload.length < 1 || payload.length > max) throw new Error("The message is too long to encode.");
    if (passwordProtected) validateEnvelope(payload, bundle);
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
    frame[4] = bundle ? 3 : passwordProtected ? 2 : 1;
    frame[5] = bundle ? (passwordProtected ? 4 : 3) : passwordProtected ? 2 : 1;
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
      // Stop expansion at the declared length, before allocating an unbounded result.
      const reader = stream.getReader();
      const bytes = new Uint8Array(expectedLength);
      let cursor = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (cursor + value.length > expectedLength) throw frameError("Fingerprint exceeds its declared length.");
          bytes.set(value, cursor);
          cursor += value.length;
        }
        if (cursor !== expectedLength) throw frameError("Truncated fingerprint.");
        return bytes;
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (error && error.code === "frame") throw error;
      throw frameError("Truncated fingerprint.");
    }
  }

  async function unpackFrame(packed) {
    if (packed.length < HEADER) throw frameError("Incomplete fingerprint frame.");
    const frame = packed.slice();
    scramble(frame, SEED);
    const bundle = frame[4] === 3 && (frame[5] === 3 || frame[5] === 4);
    const passwordProtected = (frame[4] === 2 && frame[5] === 2) || (bundle && frame[5] === 4);
    const magic = frame[0] === 0x50 && frame[1] === 0x43 && frame[2] === 0x46 && frame[3] === 0x31;
    if (!magic || !((frame[4] === 1 && frame[5] === 1) || (frame[4] === 2 && frame[5] === 2) || bundle) ||
      frame[6] > 1 || (passwordProtected && frame[6] !== 0) || frame[7] < 1 || frame[7] > 32) {
      throw frameError("Unsupported fingerprint frame.");
    }
    const rawLength = readU32(frame, 8);
    const bodyLength = readU32(frame, 12);
    const limit = bundle ? MAX_BUNDLE : MAX_TEXT;
    const max = passwordProtected ? ENVELOPE + limit : limit;
    if (rawLength < 1 || rawLength > max || bodyLength < 1 || bodyLength !== frame.length - HEADER) {
      throw frameError("Invalid fingerprint lengths.");
    }
    const payload = frame[6] === 0
      ? frame.slice(HEADER)
      : await inflateRaw(frame.subarray(HEADER), rawLength);
    if (payload.length !== rawLength || frameChecksum(frame, payload) !== readU32(frame, 16)) {
      throw frameError("Fingerprint checksum failed.");
    }
    if (passwordProtected) validateEnvelope(payload, bundle);
    else if (bundle) unpackBundle(payload);
    return { payload, strength: frame[7], passwordProtected, bundle, formatVersion: frame[4] };
  }

  function validateEnvelope(envelope, bundle = false) {
    const limit = bundle ? MAX_BUNDLE : MAX_TEXT;
    const psp1 = envelope.length > ENVELOPE &&
      envelope[0] === 0x50 && envelope[1] === 0x53 && envelope[2] === 0x50 && envelope[3] === 0x31 &&
      envelope[4] === (bundle ? 2 : 1) && envelope[5] === 1 && envelope[6] === 1 && envelope[7] <= 1 &&
      readU32(envelope, 8) === ITERATIONS;
    const textLength = psp1 ? readU32(envelope, 12) : 0;
    const stored = envelope.length - ENVELOPE;
    if (!psp1 || envelope.length > ENVELOPE + limit || textLength < 1 || textLength > limit ||
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

  async function encryptEnvelope(textBytes, password, bundle = false) {
    let body = textBytes;
    let storedCompressed = 0;
    const deflated = await deflateRaw(textBytes);
    if (deflated.length > 0 && deflated.length < textBytes.length) {
      body = deflated;
      storedCompressed = 1;
    }
    const envelope = new Uint8Array(ENVELOPE + body.length);
    envelope.set([0x50, 0x53, 0x50, 0x31], 0);
    envelope[4] = bundle ? 2 : 1;
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

  async function decryptEnvelope(envelope, password, bundle = false) {
    validateEnvelope(envelope, bundle);
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
      try { return await inflateRaw(plain, readU32(envelope, 12)); }
      finally { plain.fill(0); }
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

  // Carrier 3: eight local, coarse wavelet patches; no reserved border.
  // The locator header is independent of payload ordering, compression and passwords.
  const LOCATOR_CELL = 6;
  const LOCATOR_COLUMNS = 12;
  const LOCATOR_ROWS = 8;
  const LOCATOR_WIDTH = LOCATOR_CELL * LOCATOR_COLUMNS;
  const LOCATOR_HEIGHT = LOCATOR_CELL * LOCATOR_ROWS;
  const LOCATOR_INSET = 8;
  const LOCATOR_STRENGTH = 16;
  const LOCATOR_SEED = 0x50534C33;
  const locatorOrder = scatterOrder(96, LOCATOR_SEED);
  const locatorShape = buildShapes(LOCATOR_STRENGTH).difference;

  function locatorLayout(width, height) {
    if (width < 3 * LOCATOR_WIDTH + 2 * LOCATOR_INSET || height < 3 * LOCATOR_HEIGHT + 2 * LOCATOR_INSET) return null;
    const xs = [LOCATOR_INSET, Math.floor((width - LOCATOR_WIDTH) / 8) * 4, Math.floor((width - LOCATOR_WIDTH - LOCATOR_INSET) / 4) * 4];
    const ys = [LOCATOR_INSET, Math.floor((height - LOCATOR_HEIGHT) / 8) * 4, Math.floor((height - LOCATOR_HEIGHT - LOCATOR_INSET) / 4) * 4];
    return ys.flatMap((y, row) => xs.map((x, column) => ({ x, y, id: row * 3 + column }))).filter((patch) => patch.id !== 4);
  }

  function locatorFits(width, height) {
    // Small pictures use carrier 1 rather than sacrifice most of their capacity.
    return width <= 65535 && height <= 65535 && Boolean(locatorLayout(width, height)) &&
      width * height <= MAX_PIXELS && 8 * LOCATOR_WIDTH * LOCATOR_HEIGHT <= width * height * 0.3;
  }

  function locatorBlockMap(width, height) {
    const layout = locatorLayout(width, height);
    if (!layout) return null;
    const columns = Math.floor(width / BLOCK), rows = Math.floor(height / BLOCK);
    const map = new Uint32Array(columns * rows - 8 * LOCATOR_WIDTH * LOCATOR_HEIGHT / 16);
    let count = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = column * BLOCK, y = row * BLOCK;
        if (!layout.some((patch) => x >= patch.x && x < patch.x + LOCATOR_WIDTH && y >= patch.y && y < patch.y + LOCATOR_HEIGHT)) {
          map[count++] = column + row * columns;
        }
      }
    }
    return map;
  }

  function locatorHeader(width, height, id) {
    const bytes = new Uint8Array(8);
    bytes[0] = 0xD3;
    bytes[1] = 0x30 | id;
    bytes[2] = width & 255; bytes[3] = width >>> 8;
    bytes[4] = height & 255; bytes[5] = height >>> 8;
    const checksum = crc32(bytes, 0, 6) & 0xFFFF;
    bytes[6] = checksum & 255; bytes[7] = checksum >>> 8;
    scramble(bytes, LOCATOR_SEED);
    return bytes;
  }

  function paintLocators(reference, output, width, height, strength) {
    const amplitude = Math.min(LOCATOR_STRENGTH, strength);
    for (const patch of locatorLayout(width, height)) {
      const header = locatorHeader(width, height, patch.id);
      for (let slot = 0; slot < 96; slot++) {
        const cell = locatorOrder[slot];
        const bit = WORD_BITS[header[Math.floor(slot / 12)] * 12 + slot % 12];
        const x = patch.x + (cell % LOCATOR_COLUMNS) * LOCATOR_CELL;
        const y = patch.y + Math.floor(cell / LOCATOR_COLUMNS) * LOCATOR_CELL;
        for (let channel = 0; channel < 3; channel++) {
          let low = -Infinity, high = Infinity;
          for (let dy = 0; dy < LOCATOR_CELL; dy++) for (let dx = 0; dx < LOCATOR_CELL; dx++) {
            const delta = scaleWeight(amplitude, shapeWeight(Math.floor(dx * 4 / LOCATOR_CELL), Math.floor(dy * 4 / LOCATOR_CELL), bit));
            const value = reference[(x + dx + (y + dy) * width) * 4 + channel];
            low = Math.max(low, -value - delta);
            high = Math.min(high, 255 - value - delta);
          }
          const bias = low <= high ? Math.max(low, Math.min(high, 0)) : 0;
          for (let dy = 0; dy < LOCATOR_CELL; dy++) for (let dx = 0; dx < LOCATOR_CELL; dx++) {
            const index = (x + dx + (y + dy) * width) * 4 + channel;
            output[index] = clampByte(reference[index] + bias + scaleWeight(amplitude, shapeWeight(Math.floor(dx * 4 / LOCATOR_CELL), Math.floor(dy * 4 / LOCATOR_CELL), bit)));
          }
        }
      }
    }
  }

  function sampleLuma(pixels, width, height, x, y) {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = (x0 + y0 * width) * 4, b = (x1 + y0 * width) * 4;
    const c = (x0 + y1 * width) * 4, d = (x1 + y1 * width) * 4;
    return ((pixels[a] + pixels[a + 1] + pixels[a + 2]) * (1 - fx) * (1 - fy) +
      (pixels[b] + pixels[b + 1] + pixels[b + 2]) * fx * (1 - fy) +
      (pixels[c] + pixels[c + 1] + pixels[c + 2]) * (1 - fx) * fy +
      (pixels[d] + pixels[d + 1] + pixels[d + 2]) * fx * fy) / 3;
  }

  function readLocator(pixels, width, height, x, y, scaleX, scaleY, id) {
    if (x < -2 || y < -2 || x + (LOCATOR_WIDTH - 1) * scaleX > width + 1 || y + (LOCATOR_HEIGHT - 1) * scaleY > height + 1) return null;
    const known = locatorHeader(0, 0, id);
    const scores = new Float64Array(96);
    let pilot = 0, pilotEnergy = 0;
    for (let slot = 0; slot < 96; slot++) {
      const cell = locatorOrder[slot];
      const originX = x + cell % LOCATOR_COLUMNS * LOCATOR_CELL * scaleX;
      const originY = y + Math.floor(cell / LOCATOR_COLUMNS) * LOCATOR_CELL * scaleY;
      let projection = 0, sum = 0, squares = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const value = sampleLuma(pixels, width, height, originX + (1.5 * dx + 0.5) * scaleX, originY + (1.5 * dy + 0.5) * scaleY);
        projection += value * locatorShape[dx + dy * 4]; sum += value; squares += value * value;
      }
      const score = projection / Math.sqrt(400 + Math.max(0, squares - sum * sum / 16));
      scores[slot] = score;
      if (slot < 24) {
        pilot += score * (WORD_BITS[known[Math.floor(slot / 12)] * 12 + slot % 12] ? 1 : -1);
        pilotEnergy += Math.abs(score);
        if (slot === 23 && (pilotEnergy === 0 || pilot / pilotEnergy < 0.55)) return null;
      }
    }
    const bytes = decodeSoft(scores, 8).bytes;
    scramble(bytes, LOCATOR_SEED);
    if (bytes[0] !== 0xD3 || bytes[1] !== (0x30 | id) || (crc32(bytes, 0, 6) & 0xFFFF) !== (bytes[6] | bytes[7] << 8)) return null;
    const originalWidth = bytes[2] | bytes[3] << 8, originalHeight = bytes[4] | bytes[5] << 8;
    if (!locatorFits(originalWidth, originalHeight)) return null;
    const actualX = width / originalWidth, actualY = height / originalHeight;
    if (actualX < 0.49 || actualX > 2.01 || actualY < 0.49 || actualY > 2.01 ||
      Math.abs(actualX - scaleX) > 0.04 || Math.abs(actualY - scaleY) > 0.04) return null;
    return { originalWidth, originalHeight, id, quality: pilot / pilotEnergy };
  }

  function mappedPoint(matrix, x, y) {
    const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
    return { x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
      y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator };
  }

  function locatorScores(pixels, width, height, matrix, count = 96) {
    // The patch matrix maps its own pixel centres into the supplied image.
    for (const [x, y] of [[0, 0], [LOCATOR_WIDTH - 1, 0], [0, LOCATOR_HEIGHT - 1], [LOCATOR_WIDTH - 1, LOCATOR_HEIGHT - 1]]) {
      const point = mappedPoint(matrix, x, y);
      if (!Number.isFinite(point.x + point.y) || point.x < -0.5 || point.y < -0.5 || point.x > width - 0.5 || point.y > height - 0.5) return null;
    }
    const scores = new Float64Array(count);
    for (let slot = 0; slot < count; slot++) {
      const cell = locatorOrder[slot], x = cell % LOCATOR_COLUMNS * LOCATOR_CELL, y = Math.floor(cell / LOCATOR_COLUMNS) * LOCATOR_CELL;
      let projection = 0, sum = 0, squares = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const point = mappedPoint(matrix, x + 1.5 * dx + 0.5, y + 1.5 * dy + 0.5);
        const value = sampleLuma(pixels, width, height, point.x, point.y);
        projection += value * locatorShape[dx + dy * 4]; sum += value; squares += value * value;
      }
      scores[slot] = projection / Math.sqrt(400 + Math.max(0, squares - sum * sum / 16));
    }
    return scores;
  }

  function locatorAgreement(scores, header) {
    if (!scores) return -Infinity;
    let agreement = 0, energy = 0;
    for (let slot = 0; slot < scores.length; slot++) {
      agreement += scores[slot] * (WORD_BITS[header[Math.floor(slot / 12)] * 12 + slot % 12] ? 1 : -1);
      energy += Math.abs(scores[slot]);
    }
    // Do not reward an almost empty response just because its signs agree.
    return energy ? agreement / energy * Math.min(1, energy / (scores.length * 12)) : -Infinity;
  }

  function readVisualLocator(pixels, width, height, matrix, id) {
    const scores = locatorScores(pixels, width, height, matrix);
    if (!scores || locatorAgreement(scores.subarray(0, 24), locatorHeader(0, 0, id)) < 0.55) return null;
    const bytes = decodeSoft(scores, 8).bytes;
    scramble(bytes, LOCATOR_SEED);
    if (bytes[0] !== 0xD3 || bytes[1] !== (0x30 | id) || (crc32(bytes, 0, 6) & 0xFFFF) !== (bytes[6] | bytes[7] << 8)) return null;
    const originalWidth = bytes[2] | bytes[3] << 8, originalHeight = bytes[4] | bytes[5] << 8;
    if (!locatorFits(originalWidth, originalHeight)) return null;
    // Supplied image bounds say nothing about encoded bounds once there is padding.
    return { originalWidth, originalHeight, id, matrix: Array.from(matrix),
      verification: "header", quality: locatorAgreement(scores, locatorHeader(originalWidth, originalHeight, id)) };
  }

  function visualAdapter(pixels, width, height) {
    const ids = [0, 2, 6, 8, 1, 3, 5, 7];
    return {
      patchWidth: LOCATOR_WIDTH, patchHeight: LOCATOR_HEIGHT,
      shape: Array.from(locatorShape), ids,
      pilots: ids.map((id) => {
        const header = locatorHeader(0, 0, id);
        return { id, points: Array.from({ length: 24 }, (_, slot) => {
          const cell = locatorOrder[slot];
          return { x: cell % LOCATOR_COLUMNS * LOCATOR_CELL, y: Math.floor(cell / LOCATOR_COLUMNS) * LOCATOR_CELL,
            sign: WORD_BITS[header[Math.floor(slot / 12)] * 12 + slot % 12] ? 1 : -1 };
        }) };
      }),
      layout: locatorLayout,
      read: (matrix, id) => readVisualLocator(pixels, width, height, matrix, id),
      confirm: (matrix, id, dimensions) => {
        const read = readVisualLocator(pixels, width, height, matrix, id);
        if (read && read.originalWidth === dimensions.originalWidth && read.originalHeight === dimensions.originalHeight) return read;
        // Once dimensions are known, compare all 96 expected symbols. A damaged
        // header can still supply geometry; acceptance of contents needs frame CRC.
        const scores = locatorScores(pixels, width, height, matrix);
        const header = locatorHeader(dimensions.originalWidth, dimensions.originalHeight, id);
        const quality = locatorAgreement(scores, header);
        if (quality < 0.58 || !scores || locatorAgreement(scores.subarray(0, 24), header) < 0.4) return null;
        return { originalWidth: dimensions.originalWidth, originalHeight: dimensions.originalHeight,
          id, matrix: Array.from(matrix), quality, verification: "pattern" };
      },
      quality: (matrix, id, dimensions) => locatorAgreement(locatorScores(pixels, width, height, matrix, dimensions ? 96 : 24),
        locatorHeader(dimensions?.originalWidth || 0, dimensions?.originalHeight || 0, id)),
      verifyGeometry: async (geometry, signal) => {
        const recovered = await readVisualMapping(pixels, width, height, geometry, signal);
        const inspection = describeRecovery(recovered);
        // Only geometry and inspection metadata leave the worker. A plausible
        // simple fit never short-circuits search without complete frame validation.
        return inspection.found && !inspection.unreadable ? { ...inspection, geometry: recovered.geometry } : null;
      }
    };
  }

  async function findLocator(pixels, width, height, nativeOnly = false, quickOnly = false, signal) {
    const scales = nativeOnly ? [1] : quickOnly ? [0.95, 2, 0.5, 1.05, 0.75, 1.5, 1.25] : [0.95, 2, 0.5, 1.05, 0.75, 1.5, 1.25, 1];
    if (!nativeOnly && !quickOnly) {
      for (let i = 20; i <= 80; i++) {
        const scale = i / 40;
        if (!scales.includes(scale)) scales.push(scale);
      }
    }
    const offsets = nativeOnly ? [0] : quickOnly ? [0, -0.5, 0.5] : [0, -0.5, 0.5, -1, 1];
    const ids = [0, 2, 6, 8, 1, 3, 5, 7];
    for (const scale of scales) {
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      const guessedWidth = Math.round(width / scale), guessedHeight = Math.round(height / scale);
      const layout = locatorLayout(guessedWidth, guessedHeight);
      if (!layout || !locatorFits(guessedWidth, guessedHeight)) continue;
      for (const id of ids) {
        const patch = layout.find((patch) => patch.id === id);
        for (const oy of offsets) for (const ox of offsets) {
          const found = readLocator(pixels, width, height, patch.x * scale + (scale - 1) / 2 + ox, patch.y * scale + (scale - 1) / 2 + oy, scale, scale, id);
          if (found && (!nativeOnly || (found.originalWidth === width && found.originalHeight === height))) return found;
        }
      }
      await yieldNow();
    }
    return null;
  }

  async function scoreMapped(pixels, width, height, map, originalWidth, strength, fit, limit = map.length) {
    const scores = new Int32Array(limit), bounded = new Int32Array(limit);
    const difference = buildShapes(strength).difference;
    const columns = Math.floor(originalWidth / BLOCK);
    let differenceEnergy = 0;
    for (const value of difference) differenceEnergy += value * value;
    const block = new Float64Array(16);
    const half = fit && !fit.matrix && Math.abs(fit.scaleX - 0.5) < 0.001 && Math.abs(fit.scaleY - 0.5) < 0.001;
    for (let i = 0; i < limit; i++) {
      if ((i & 8191) === 8191) {
        if (fit?.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
        await yieldNow();
      }
      const x = (map[i] % columns) * BLOCK, y = Math.floor(map[i] / columns) * BLOCK;
      if (half) {
        // An aligned 2x2 average retains the two diagonal signs. Score that
        // reduced symbol directly instead of blurring it back into 4x4 pixels.
        let projection = 0, sum = 0, squares = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const value = sampleLuma(pixels, width, height, fit.scaleX * (x + 2 * dx + 0.5) + fit.phaseX, fit.scaleY * (y + 2 * dy + 0.5) + fit.phaseY);
          projection += value * (dx === dy ? 1 : -1); sum += value; squares += value * value;
        }
        scores[i] = bounded[i] = roundHalfToEven(100 * projection / Math.sqrt(25 + Math.max(0, squares - sum * sum / 4)));
        continue;
      }
      let projection = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const k = dx + dy * 4;
        const pixel = (x + dx + (y + dy) * width) * 4;
        if (fit?.matrix) {
          const point = mappedPoint(fit.matrix, x + dx, y + dy);
          block[k] = sampleLuma(pixels, width, height, point.x, point.y);
        } else {
          block[k] = fit ? sampleLuma(pixels, width, height, fit.scaleX * (x + dx) + fit.phaseX, fit.scaleY * (y + dy) + fit.phaseY)
            : (pixels[pixel] + pixels[pixel + 1] + pixels[pixel + 2]) / 3;
        }
        projection += block[k] * difference[k];
      }
      let noiseEnergy = 25;
      for (const kernel of NOISE_KERNELS) {
        let coefficient = 0;
        for (let k = 0; k < 16; k++) coefficient += block[k] * kernel[k];
        noiseEnergy += coefficient * coefficient;
      }
      scores[i] = roundHalfToEven(100 * projection / Math.sqrt(noiseEnergy));
      bounded[i] = roundHalfToEven(100 * Math.max(-differenceEnergy / 2, Math.min(differenceEnergy / 2, projection)) / 5);
    }
    return { scores, bounded };
  }

  async function readMapped(pixels, width, height, record, native = false, signal) {
    const originalWidth = record.originalWidth, originalHeight = record.originalHeight;
    const map = locatorBlockMap(originalWidth, originalHeight);
    const scaleX = width / originalWidth, scaleY = height / originalHeight;
    const offsets = native ? [0] : [0, -0.25, 0.25, -0.5, 0.5, -1, 1];
    for (const oy of offsets) for (const ox of offsets) {
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      const fit = native ? null : { scaleX, scaleY, phaseX: (scaleX - 1) / 2 + ox, phaseY: (scaleY - 1) / 2 + oy, signal };
      for (const strength of STRENGTHS) {
        const probe = await scoreMapped(pixels, width, height, map, originalWidth, strength, fit, PREAMBLE_BLOCKS);
        const preamble = tryReadPreamble(probe.scores) || tryReadPreamble(probe.bounded);
        if (!preamble || preamble.version !== CARRIER_V3) continue;
        const scored = await scoreMapped(pixels, width, height, map, originalWidth, strength, fit);
        const found = (await tryLayout(scored.scores)) || (await tryLayout(scored.bounded));
        if (found && found.carrierVersion === CARRIER_V3) return {
          ...found, origWidth: originalWidth, origHeight: originalHeight,
          scaleX, scaleY, phaseX: fit?.phaseX || 0, phaseY: fit?.phaseY || 0
        };
      }
      if (!native) await yieldNow();
    }
    return { locatorOnly: true, origWidth: originalWidth, origHeight: originalHeight, scaleX, scaleY };
  }

  async function readVisualMapping(pixels, width, height, geometry, signal) {
    const map = locatorBlockMap(geometry.originalWidth, geometry.originalHeight);
    const offsets = [0, -0.25, 0.25, -0.5, 0.5];
    for (const oy of offsets) for (const ox of offsets) {
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      const matrix = geometry.matrix.slice();
      // Offset in observed space, including the projective denominator.
      for (let i = 0; i < 3; i++) { matrix[i] += ox * matrix[i + 6]; matrix[i + 3] += oy * matrix[i + 6]; }
      let fit = { matrix, signal };
      if (Math.abs(matrix[1]) < 1e-12 && Math.abs(matrix[3]) < 1e-12 && Math.abs(matrix[6]) + Math.abs(matrix[7]) < 1e-12) {
        fit = { scaleX: matrix[0] / matrix[8], scaleY: matrix[4] / matrix[8], phaseX: matrix[2] / matrix[8], phaseY: matrix[5] / matrix[8], signal };
      }
      for (const strength of STRENGTHS) {
        const probe = await scoreMapped(pixels, width, height, map, geometry.originalWidth, strength, fit, PREAMBLE_BLOCKS);
        const preamble = tryReadPreamble(probe.scores) || tryReadPreamble(probe.bounded);
        if (!preamble || preamble.version !== CARRIER_V3) continue;
        const scored = await scoreMapped(pixels, width, height, map, geometry.originalWidth, strength, fit);
        const found = (await tryLayout(scored.scores)) || (await tryLayout(scored.bounded));
        if (found && found.carrierVersion === CARRIER_V3) return {
          ...found, origWidth: geometry.originalWidth, origHeight: geometry.originalHeight,
          matrix, geometry: { ...geometry, matrix,
            corners: [[0, 0], [geometry.originalWidth - 1, 0], [geometry.originalWidth - 1, geometry.originalHeight - 1], [0, geometry.originalHeight - 1]]
              .map(([x, y]) => mappedPoint(matrix, x, y)) }, visualTransform: geometry.model
        };
      }
      await yieldNow();
    }
    return { locatorOnly: true, origWidth: geometry.originalWidth, origHeight: geometry.originalHeight,
      matrix: geometry.matrix, geometry, visualTransform: geometry.model };
  }

  function canUseReaderWorker(options) {
    return typeof Worker !== "undefined" && codecScriptUrl &&
      ["http:", "https:"].includes(new URL(codecScriptUrl).protocol) && options.worker !== false;
  }

  function searchInWorker(pixels, width, height, options, operation = "geometry") {
    return new Promise((resolve, reject) => {
      const url = new URL("pixelstow-transform-worker.js?v=20261012-photo-pyramid1", codecScriptUrl);
      const worker = new Worker(url);
      const abort = () => { cleanup(); reject(new DOMException("Search cancelled.", "AbortError")); };
      const cleanup = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
      worker.onmessage = ({ data }) => {
        if (data.signature) { options.onSignature?.(data.signature); return; }
        if (data.progress) { options.onProgress?.(data.progress); return; }
        cleanup();
        if (data.error) reject(new Error(data.error)); else resolve(data.result);
      };
      worker.onerror = () => { cleanup(); reject(new Error("The visual reader could not start. Reload the local page and check that its worker scripts are available.")); };
      if (options.signal?.aborted) { abort(); return; }
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        const copy = new Uint8Array(pixels);
        worker.postMessage({ pixels: copy, width, height, operation, mode: options.mode, forceSearch: options.forceSearch,
          corners: options.corners, simplerFirst: options.simplerFirst, deadline: options.deadline,
          seedDeadline: options.seedDeadline }, [copy.buffer]);
      } catch (error) { cleanup(); reject(error); }
    });
  }

  async function findVisualTransform(pixels, width, height, options = {}) {
    assertImage(pixels, width, height);
    if (!root.PixelStowTransform) throw new Error("The visual transform reader script is missing. Reload this page.");
    // A high-resolution camera image can enlarge the stored six-pixel symbols
    // beyond the local reader's scale range. Locate on smaller working rasters,
    // then rectify the full capture onto the dimensions recorded in the markers.
    if (!options.geometryOnly && !options.singleResolution && options.mode !== "padding" && Math.max(width, height) > 1800) {
      return findPhotoTransform(pixels, width, height, options);
    }
    // A page opened from disk has an opaque origin and cannot start this worker.
    // The same detector can run on the page, yielding between chunks for cancel/UI.
    const search = canUseReaderWorker(options)
      ? await searchInWorker(pixels, width, height, options)
      : await root.PixelStowTransform.find(pixels, width, height, options, visualAdapter(pixels, width, height));
    if (options.geometryOnly) return search;
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    if (!search?.geometry) {
      const found = Boolean(search?.markers?.length);
      if (found) visualMappings.set(pixels, { width, height, unreadable: true });
      return { found, unreadable: found, markers: search?.markers || [], reason: search?.reason, signature: search?.signature };
    }
    if (search.payloadVerified) {
      visualMappings.set(pixels, { width, height, geometry: search.geometry });
      return search;
    }
    options.onProgress?.("Checking the recovered pixel grid…");
    const recovered = await readVisualMapping(pixels, width, height, search.geometry, options.signal);
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    visualMappings.set(pixels, { width, height, geometry: recovered.geometry });
    const inspection = describeRecovery(recovered);
    return { ...inspection, found: true, unreadable: Boolean(recovered.locatorOnly) || !inspection.found,
      carrierVersion: CARRIER_V3, geometry: recovered.geometry, markers: search.markers, signature: search.signature };
  }

  async function reducePhoto(pixels, width, height, targetWidth, targetHeight, signal) {
    // Area averaging suppresses screen/sensor moire. Sampling a few bilinear
    // points when shrinking by 3x would alias the very texture being removed.
    // One row accumulator avoids a full-size floating-point intermediate raster.
    const rx = width / targetWidth, ry = height / targetHeight;
    const columns = Array.from({ length: targetWidth }, (_, x) => {
      const left = x * rx, right = (x + 1) * rx, first = Math.floor(left);
      const last = Math.min(width - 1, Math.ceil(right) - 1);
      return { first, weights: Float64Array.from({ length: last - first + 1 }, (_, i) =>
        Math.max(0, Math.min(right, first + i + 1) - Math.max(left, first + i)) / rx) };
    });
    const out = new Uint8Array(targetWidth * targetHeight * 4), row = new Float64Array(targetWidth * 4);
    for (let y = 0; y < targetHeight; y++) {
      if ((y & 7) === 0) {
        if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
        await yieldNow();
      }
      row.fill(0);
      const top = y * ry, bottom = (y + 1) * ry;
      for (let sy = Math.floor(top); sy < Math.min(height, Math.ceil(bottom)); sy++) {
        const wy = Math.max(0, Math.min(bottom, sy + 1) - Math.max(top, sy)) / ry;
        for (let x = 0; x < targetWidth; x++) {
          const { first, weights } = columns[x], dest = x * 4;
          for (let k = 0; k < weights.length; k++) {
            const src = (first + k + sy * width) * 4, weight = weights[k] * wy;
            row[dest] += pixels[src] * weight;
            row[dest + 1] += pixels[src + 1] * weight;
            row[dest + 2] += pixels[src + 2] * weight;
            row[dest + 3] += pixels[src + 3] * weight;
          }
        }
      }
      for (let i = 0; i < row.length; i++) out[y * row.length + i] = roundHalfToEven(row[i]);
    }
    return { pixels: out, width: targetWidth, height: targetHeight };
  }

  function liftPhotoResult(result, width, height, readWidth, readHeight) {
    const sx = width / readWidth, sy = height / readHeight, ox = (sx - 1) / 2, oy = (sy - 1) / 2;
    const lift = (h) => [sx * h[0] + ox * h[6], sx * h[1] + ox * h[7], sx * h[2] + ox * h[8],
      sy * h[3] + oy * h[6], sy * h[4] + oy * h[7], sy * h[5] + oy * h[8], h[6], h[7], h[8]];
    const geometry = result.geometry ? { ...result.geometry, matrix: lift(result.geometry.matrix),
      corners: result.geometry.corners.map((p) => ({ x: sx * p.x + ox, y: sy * p.y + oy })),
      expectedMarkers: result.geometry.expectedMarkers.map((m) => ({ ...m, matrix: lift(m.matrix) })) } : undefined;
    return { ...result, geometry, markers: result.markers?.map((m) => ({ ...m, matrix: lift(m.matrix) })),
      localizationResolution: { width: readWidth, height: readHeight } };
  }

  function geometryAt(geometry, matrix) {
    const { originalWidth: w, originalHeight: h } = geometry;
    return { ...geometry, matrix,
      corners: [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]].map(([x, y]) => mappedPoint(matrix, x, y)),
      expectedMarkers: locatorLayout(w, h).map((p) => ({ id: p.id, matrix: [
        matrix[0], matrix[1], matrix[2] + matrix[0] * p.x + matrix[1] * p.y,
        matrix[3], matrix[4], matrix[5] + matrix[3] * p.x + matrix[4] * p.y,
        matrix[6], matrix[7], matrix[8] + matrix[6] * p.x + matrix[7] * p.y] })) };
  }

  async function rectifyPhoto(pixels, width, height, nativeWidth, nativeHeight, matrix, signal) {
    // Each output pixel is on the original carrier lattice. A single homography
    // maps its footprint into the full capture; no triangles or preview resize.
    const out = new Uint8Array(nativeWidth * nativeHeight * 4), sum = new Float64Array(4);
    for (let y = 0; y < nativeHeight; y++) {
      if ((y & 7) === 0) {
        if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
        await yieldNow();
      }
      for (let x = 0; x < nativeWidth; x++) {
        const d = matrix[6] * x + matrix[7] * y + matrix[8];
        const cx = (matrix[0] * x + matrix[1] * y + matrix[2]) / d;
        const cy = (matrix[3] * x + matrix[4] * y + matrix[5]) / d;
        // Local derivatives determine quadrature density, not the mapping itself.
        // Subsamples still use the exact projective denominator at their position.
        const nx = Math.min(8, Math.max(1, Math.ceil(Math.hypot(matrix[0] - cx * matrix[6], matrix[3] - cy * matrix[6]) / Math.abs(d))));
        const ny = Math.min(8, Math.max(1, Math.ceil(Math.hypot(matrix[1] - cx * matrix[7], matrix[4] - cy * matrix[7]) / Math.abs(d))));
        sum.fill(0);
        for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
          const px = x + (ix + 0.5) / nx - 0.5, py = y + (iy + 0.5) / ny - 0.5;
          const divisor = matrix[6] * px + matrix[7] * py + matrix[8];
          const sx = Math.max(0, Math.min(width - 1, (matrix[0] * px + matrix[1] * py + matrix[2]) / divisor));
          const sy = Math.max(0, Math.min(height - 1, (matrix[3] * px + matrix[4] * py + matrix[5]) / divisor));
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          const a = (x0 + y0 * width) * 4, b = (Math.min(width - 1, x0 + 1) + y0 * width) * 4;
          const c = (x0 + Math.min(height - 1, y0 + 1) * width) * 4, e = (Math.min(width - 1, x0 + 1) + Math.min(height - 1, y0 + 1) * width) * 4;
          for (let channel = 0; channel < 4; channel++) {
            sum[channel] += (pixels[a + channel] * (1 - fx) + pixels[b + channel] * fx) * (1 - fy) +
              (pixels[c + channel] * (1 - fx) + pixels[e + channel] * fx) * fy;
          }
        }
        const dest = (x + y * nativeWidth) * 4;
        for (let channel = 0; channel < 4; channel++) out[dest + channel] = clampChannel(sum[channel] / (nx * ny));
      }
    }
    return { pixels: out, width: nativeWidth, height: nativeHeight };
  }

  function photoReadResult(recovered, image, photoGeometry) {
    // The small phase refinement is now in native read space. Compose it on the
    // right of the photo transform, rather than shifting camera pixels linearly.
    const h = photoGeometry.matrix, q = recovered.matrix, matrix = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) matrix[r * 3 + c] += h[r * 3 + k] * q[k * 3 + c];
    }
    return { ...recovered, matrix, geometry: geometryAt(photoGeometry, matrix),
      readResolution: { width: image.width, height: image.height, geometry: recovered.geometry, photoMatrix: h },
      readImage: { ...image, matrix: q } };
  }

  async function readPhotoMapping(pixels, width, height, geometry, signal) {
    const image = await rectifyPhoto(pixels, width, height, geometry.originalWidth, geometry.originalHeight, geometry.matrix, signal);
    const nativeGeometry = geometryAt(geometry, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const recovered = await readVisualMapping(image.pixels, image.width, image.height, nativeGeometry, signal);
    return photoReadResult(recovered, image, geometry);
  }

  function retainVisualResult(pixels, width, height, result, workingImage) {
    if (!result) return;
    if (result.geometry) visualMappings.set(pixels, { width, height, geometry: result.geometry,
      readResolution: result.readResolution, workingImage });
    else if (result.unreadable) visualMappings.set(pixels, { width, height, unreadable: true });
  }

  async function findPhotoTransform(pixels, width, height, options) {
    const deadline = Math.min(options.deadline || Infinity, Date.now() + 60000);
    let best = null, bestImage = null;
    // Start with cheap coarse images, then double the working resolution. A
    // missing spectral signature or marker at one scale does not reject another.
    // Every level comes directly from the full capture, without accumulated blur.
    const sizes = [16, 8, 4, 2, 1].map((divisor) => ({ divisor,
      width: Math.round(width / divisor), height: Math.round(height / divisor) }))
      .filter((size, i, all) => size.width >= BLOCK && size.height >= BLOCK &&
        all.findIndex((s) => s.width === size.width && s.height === size.height) === i);
    for (let pass = 0; pass < sizes.length; pass++) {
      if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      if (Date.now() >= deadline) {
        best = { ...(best || { found: false }), reason: "Image recovery stopped at the shared 60-second limit. Retry a specific search if needed." };
        break;
      }
      const { width: rw, height: rh, divisor } = sizes[pass], full = divisor === 1;
      const label = (full ? "Full size" : "1/" + divisor + " size") + " (" + rw + " × " + rh + ")";
      options.onProgress?.("Locating photo markers: " + label + "…");
      const image = full ? { pixels, width, height } : await reducePhoto(pixels, width, height, rw, rh, options.signal);
      const corners = options.corners?.map((p) => ({ x: (p.x + 0.5) * rw / width - 0.5, y: (p.y + 0.5) * rh / height - 0.5 }));
      // Limit unproductive seed searches so they cannot starve later levels.
      // A checksum-valid marker earns the rest of the shared budget to fit the
      // plane, rather than throwing away a promising search at a scale timeout.
      const remaining = deadline - Date.now();
      const seedBudget = divisor >= 8 ? (divisor === 16 ? 5000 : 8000)
        : Math.max(5000, remaining * (divisor === 4 ? 0.7 : divisor === 2 ? 0.7 : 1));
      const result = await findVisualTransform(image.pixels, rw, rh, { ...options, corners, singleResolution: true,
        geometryOnly: true, simplerFirst: options.simplerFirst !== false, deadline,
        seedDeadline: Math.min(deadline, Date.now() + seedBudget),
        onProgress: (text) => options.onProgress?.(label + ": " + text) });
      const lifted = full ? result : liftPhotoResult(result, width, height, rw, rh);
      let candidate = { ...lifted, found: Boolean(lifted.geometry || lifted.markers?.length), unreadable: Boolean(lifted.geometry || lifted.markers?.length) };
      let nativeImage;
      if (lifted.geometry) {
        options.onProgress?.("Rectifying the full capture to its original " + lifted.geometry.originalWidth + " × " + lifted.geometry.originalHeight + " pixel grid…");
        const recovered = await readPhotoMapping(pixels, width, height, lifted.geometry, options.signal);
        if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
        const inspection = describeRecovery(recovered);
        nativeImage = recovered.readImage;
        candidate = { ...lifted, ...inspection, found: true, unreadable: Boolean(recovered.locatorOnly) || !inspection.found,
          carrierVersion: CARRIER_V3, geometry: recovered.geometry, readResolution: recovered.readResolution };
        if (!candidate.unreadable) {
          retainVisualResult(pixels, width, height, candidate, nativeImage);
          return candidate;
        }
      }
      const rank = (r) => (r?.geometry ? 16 : 0) + (r?.markers?.length || 0);
      if (!best || rank(candidate) >= rank(best)) { best = candidate; bestImage = nativeImage; }
    }
    retainVisualResult(pixels, width, height, best, bestImage);
    return best;
  }

  function bilinearSample(pixels, width, height, x, y) {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const sample = [0, 0, 0, 255];
    for (let channel = 0; channel < 4; channel++) {
      const a = pixels[(x0 + y0 * width) * 4 + channel], b = pixels[(x1 + y0 * width) * 4 + channel];
      const c = pixels[(x0 + y1 * width) * 4 + channel], d = pixels[(x1 + y1 * width) * 4 + channel];
      sample[channel] = roundHalfToEven(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy);
    }
    return sample;
  }

  async function resampleReadSpace(pixels, width, height, origW, origH, scaleX, scaleY, phaseX, phaseY) {
    const out = new Uint8Array(origW * origH * 4);
    for (let y = 0; y < origH; y++) {
      if ((y & 31) === 31) await yieldNow();
      for (let x = 0; x < origW; x++) {
        out.set(bilinearSample(pixels, width, height, phaseX + scaleX * x, phaseY + scaleY * y), (x + y * origW) * 4);
      }
    }
    return out;
  }

  function cleanLocators(pixels, width, height, output) {
    for (const patch of locatorLayout(width, height)) {
      const header = locatorHeader(width, height, patch.id);
      for (let slot = 0; slot < 96; slot++) {
        const cell = locatorOrder[slot], bit = WORD_BITS[header[Math.floor(slot / 12)] * 12 + slot % 12];
        const x = patch.x + cell % LOCATOR_COLUMNS * LOCATOR_CELL, y = patch.y + Math.floor(cell / LOCATOR_COLUMNS) * LOCATOR_CELL;
        let projection = 0, energy = 0;
        for (let dy = 0; dy < LOCATOR_CELL; dy++) for (let dx = 0; dx < LOCATOR_CELL; dx++) {
          const k = scaleWeight(LOCATOR_STRENGTH, shapeWeight(Math.floor(dx * 4 / LOCATOR_CELL), Math.floor(dy * 4 / LOCATOR_CELL), bit));
          const p = (x + dx + (y + dy) * width) * 4;
          projection += (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3 * k; energy += k * k;
        }
        const amount = Math.max(0, Math.min(1, projection / energy));
        for (let dy = 0; dy < LOCATOR_CELL; dy++) for (let dx = 0; dx < LOCATOR_CELL; dx++) {
          const delta = amount * scaleWeight(LOCATOR_STRENGTH, shapeWeight(Math.floor(dx * 4 / LOCATOR_CELL), Math.floor(dy * 4 / LOCATOR_CELL), bit));
          const p = (x + dx + (y + dy) * width) * 4;
          for (let c = 0; c < 3; c++) output[p + c] = clampChannel(pixels[p + c] - delta);
        }
      }
    }
  }

  async function writeSignal(reference, image, width, height, framed, strength, version, map = null) {
    const columns = Math.floor(width / BLOCK);
    const blockCount = map ? map.length : columns * Math.floor(height / BLOCK);
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
    bytes[1] = version === CARRIER_V3 ? CARRIER_V3 : CARRIER_V1;
    bytes[2] = flags;
    writeU32(bytes, 3, framed.length);
    const crc = crc32(bytes, 0, 7) & 0xFFFF;
    bytes[7] = crc & 0xFF;
    bytes[8] = (crc >> 8) & 0xFF;
    const amplitudeCache = new Int16Array(columns * Math.floor(height / BLOCK));
    amplitudeCache.fill(-1);
    const preambleOrder = scatterOrder(PREAMBLE_BLOCKS, SEED);
    await writeBits(reference, image, width, columns, map ? preambleOrder.map((block) => map[block]) : preambleOrder, (slot) => {
      const bitIndex = slot % 72;
      return (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    }, strength, amplitudeCache);
    const payloadOrder = scatterOrder(payloadBlocks, SEED);
    const payloadSlots = new Uint32Array(payloadBlocks);
    for (let slot = 0; slot < payloadBlocks; slot++) {
      const block = PREAMBLE_BLOCKS + payloadOrder[slot];
      payloadSlots[slot] = map ? map[block] : block;
    }
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
    if ((preamble.version !== CARRIER_V1 && preamble.version !== CARRIER_V3) ||
      preamble.framedLength < HEADER || preamble.framedLength > MAX_FRAMED) {
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
      parityBits,
      carrierVersion: preamble.version
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
        passwordProtected: unpacked.passwordProtected,
        bundle: unpacked.bundle,
        formatVersion: unpacked.formatVersion,
        carrierVersion: framed.carrierVersion
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

  async function recoverScan(pixels, width, height) {
    if (!pixels || width < BLOCK || height < BLOCK || pixels.length !== width * height * 4) return null;
    if (width * height > MAX_PIXELS) throw new Error("This image is too large for the browser tool.");
    if (Math.floor(width / BLOCK) * Math.floor(height / BLOCK) <= PREAMBLE_BLOCKS) return null;
    const preambleMap = Uint32Array.from({ length: PREAMBLE_BLOCKS }, (_, i) => i);
    for (let i = 0; i < STRENGTHS.length; i++) {
      // Reject wrong grids on the small repeated header before scoring a whole
      // photograph. This leaves the previous carrier's decoder unchanged.
      const probe = await scoreMapped(pixels, width, height, preambleMap, width, STRENGTHS[i], null);
      const preamble = tryReadPreamble(probe.scores) || tryReadPreamble(probe.bounded);
      if (!preamble || preamble.version !== CARRIER_V1) continue;
      const found = await tryReadAt(pixels, width, height, STRENGTHS[i]);
      if (found) return found;
    }
    return null;
  }

  async function recover(pixels, width, height, options = {}) {
    if (!pixels || pixels.length !== width * height * 4 || width < BLOCK || height < BLOCK) return null;
    if (width * height > MAX_PIXELS) throw new Error("This image is too large for the browser tool.");
    const visual = visualMappings.get(pixels);
    if (visual && visual.width === width && visual.height === height) {
      if (visual.unreadable) return { locatorOnly: true, carrierVersion: CARRIER_V3 };
      if (visual.readResolution) {
        const resolution = visual.readResolution;
        const image = visual.workingImage || await rectifyPhoto(pixels, width, height, resolution.width, resolution.height, resolution.photoMatrix, options.signal);
        visual.workingImage = image;
        const recovered = await readVisualMapping(image.pixels, image.width, image.height, resolution.geometry, options.signal);
        return photoReadResult(recovered, image, geometryAt(visual.geometry, resolution.photoMatrix));
      }
      return readVisualMapping(pixels, width, height, visual.geometry, options.signal);
    }
    const native = await findLocator(pixels, width, height, true, false, options.signal);
    if (native) {
      const found = await readMapped(pixels, width, height, native, true, options.signal);
      if (!found.locatorOnly) return found;
      return readMapped(pixels, width, height, native, false, options.signal);
    }
    const previous = await recoverScan(pixels, width, height);
    if (previous && previous.carrierVersion === CARRIER_V1) return previous;
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    options.onProgress?.("Checking common image resize ratios…");
    const locator = await findLocator(pixels, width, height, false, options.quickOnly, options.signal);
    return locator ? readMapped(pixels, width, height, locator, false, options.signal) : null;
  }

  function describeRecovery(recovery) {
    if (!recovery) return { found: false };
    if (recovery.locatorOnly) return { found: true, unreadable: true, carrierVersion: CARRIER_V3, geometry: recovery.geometry };
    try {
      if (recovery.passwordProtected) validateEnvelope(recovery.payload, recovery.bundle);
      else if (recovery.bundle) unpackBundle(recovery.payload);
      else decodeUtf8(recovery.payload);
    } catch {
      return { found: false };
    }
    return {
      found: true,
      passwordProtected: recovery.passwordProtected,
      formatVersion: recovery.formatVersion,
      hasAttachments: recovery.bundle,
      carrierVersion: recovery.carrierVersion,
      geometry: recovery.geometry,
      readResolution: recovery.readResolution,
      strength: recovery.strength
    };
  }

  async function inspect(pixels, width, height, options = {}) {
    assertImage(pixels, width, height);
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    // Camera frames run the entire inspection off the page, including native
    // reads and final frame checks. Later decoding uses the same captured pixels
    // and the recovered geometry, and still validates the payload again.
    if (options.background && canUseReaderWorker(options)) {
      const result = await searchInWorker(pixels, width, height, options, "inspect");
      if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      retainVisualResult(pixels, width, height, result);
      return result;
    }
    options.onProgress?.("Reading the image at its original size…");
    const recovery = await recover(pixels, width, height, { ...options, quickOnly: options.automatic === true });
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    const direct = describeRecovery(recovery);
    if (!options.automatic || (direct.found && !direct.unreadable)) return direct;
    // One perspective search also retains translation/affine estimates. Running
    // the three manual modes in sequence would repeat the FFT and seed searches.
    options.onProgress?.("Looking for encoded contents in a resized, padded or photographed image…");
    const transformed = await findVisualTransform(pixels, width, height, { ...options, mode: "perspective", simplerFirst: true });
    if (transformed.found || !direct.found) return transformed;
    // A weak spectral signature must not erase a checksum-valid native marker.
    return { ...transformed, ...direct };
  }

  async function decode(pixels, width, height, password) {
    const recovery = await recover(pixels, width, height);
    if (!recovery) return { status: "none" };
    if (recovery.locatorOnly) return { status: "markers", carrierVersion: CARRIER_V3, geometry: recovery.geometry, scaleX: recovery.scaleX, scaleY: recovery.scaleY };
    if (recovery.passwordProtected && !password) {
      return { status: "password", strength: recovery.strength };
    }
    try {
      const textBytes = recovery.passwordProtected
        ? await decryptEnvelope(recovery.payload, password, recovery.bundle)
        : recovery.payload;
      try {
        const content = recovery.bundle ? unpackBundle(textBytes) : { text: decodeUtf8(textBytes), attachments: [] };
        return {
          status: "success",
          ...content,
          formatVersion: recovery.formatVersion,
          carrierVersion: recovery.carrierVersion,
          geometry: recovery.geometry,
          readResolution: recovery.readResolution,
          visualTransform: recovery.visualTransform,
          scaleX: recovery.scaleX,
          scaleY: recovery.scaleY,
          passwordProtected: recovery.passwordProtected,
          strength: recovery.strength
        };
      } finally { textBytes.fill(0); }
    } catch (error) {
      if (error && error.code === "incorrect") return { status: "incorrect" };
      if (error && error.code === "frame") return { status: "none" };
      throw error;
    }
  }

  async function encodeAt(reference, width, height, payload, passwordProtected, strength, adaptive, bundle, carrierVersion) {
    strength = Math.max(1, Math.min(32, strength));
    const version = carrierVersion === CARRIER_V3 ? CARRIER_V3 : CARRIER_V1;
    const map = version === CARRIER_V3 ? locatorBlockMap(width, height) : null;
    const probe = await packFrame(payload, 8, passwordProtected, bundle);
    const columns = Math.floor(width / BLOCK);
    const blockCount = map ? map.length : columns * Math.floor(height / BLOCK);
    if (adaptive) {
      const available = blockCount - PREAMBLE_BLOCKS;
      let bitsPerByte = 0;
      if (probe.length * 12 <= available) bitsPerByte = 12;
      else if (probe.length * 9 <= available) bitsPerByte = 9;
      if (available <= 0 || bitsPerByte === 0) {
        throw new Error("This image is too small for this payload. Use a larger picture, smaller files or a shorter recording.");
      }
      const copies = Math.max(1, Math.floor(available / (probe.length * bitsPerByte)));
      const multiplier = copies >= 4 ? 1 : copies === 3 ? 1.5 : copies === 2 ? 2 : 4;
      const adjusted = Math.min(32, Math.max(strength, roundHalfToEven(strength * multiplier)));
      if (adjusted !== strength) strength = adjusted;
    }
    const framed = await packFrame(payload, strength, passwordProtected, bundle);
    const output = reference.slice();
    const written = await writeSignal(reference, output, width, height, framed, strength, version, map);
    if (map) paintLocators(reference, output, width, height, strength);
    return {
      pixels: output,
      strength,
      copies: written.copies,
      parityBits: written.parityBits,
      passwordProtected,
      carrierVersion: version
    };
  }

  async function encode(pixels, width, height, text, password) {
    return encodePayload(pixels, width, height, { text, attachments: [] }, password);
  }

  async function encodePayload(pixels, width, height, content, password) {
    const { text = "", attachments = [] } = content;
    const bundle = attachments.length > 0;
    const plain = bundle ? packBundle(text, attachments) : strictUtf8(text);
    if (!bundle && (plain.length < 1 || plain.length > MAX_TEXT)) {
      throw new Error(plain.length < 1 ? "Enter a message or add an attachment to encode." : "The message is longer than 16 KiB.");
    }
    try {
      assertImage(pixels, width, height);
      await yieldNow();
      const existing = await inspect(pixels, width, height);
      if (existing.found) {
        throw new Error("This image already contains a fingerprint. Choose a picture that does not have one.");
      }
      const locked = typeof password === "string" && password.length > 0;
      const wantLocators = preferredCarrier === CARRIER_V3;
      const usedVersion = wantLocators && locatorFits(width, height) ? CARRIER_V3 : CARRIER_V1;
      const payload = locked ? await encryptEnvelope(plain, password, bundle) : plain.slice();
      try {
        let encoded = await encodeAt(pixels, width, height, payload, locked, STRENGTHS[0], true, bundle, usedVersion);
        for (;;) {
          const recovery = usedVersion === CARRIER_V3
            ? await recover(encoded.pixels, width, height)
            : await tryReadAt(encoded.pixels, width, height, encoded.strength);
          if (recovery && !recovery.locatorOnly && recovery.carrierVersion === usedVersion &&
            recovery.bundle === bundle && recovery.passwordProtected === locked && bytesEqual(recovery.payload, payload)) {
            return {
              pixels: encoded.pixels,
              width,
              height,
              strength: encoded.strength,
              copies: encoded.copies,
              parityBits: encoded.parityBits,
              passwordProtected: locked,
              carrierVersion: usedVersion,
              locatorFallback: wantLocators && usedVersion === CARRIER_V1
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
          encoded = await encodeAt(pixels, width, height, payload, locked, next, false, bundle, usedVersion);
        }
      } finally { payload.fill(0); }
    } finally { plain.fill(0); }
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
    let compressor;
    try { compressor = new CompressionStream("deflate-raw"); }
    catch { return deflateStored(data); }
    const stream = new Blob([data]).stream().pipeThrough(compressor);
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

  async function forwardSample(source, sourceW, sourceH, pixels, width, height, fit) {
    const out = pixels.slice();
    const inverse = fit.matrix ? root.PixelStowTransform.invert(fit.matrix) : null;
    for (let y = 0; y < height; y++) {
      if ((y & 15) === 15) await yieldNow();
      const originY = inverse ? 0 : (y - fit.phaseY) / fit.scaleY;
      for (let x = 0; x < width; x++) {
        const point = inverse ? mappedPoint(inverse, x, y) : { x: (x - fit.phaseX) / fit.scaleX, y: originY };
        if (point.x < 0 || point.y < 0 || point.x > sourceW - 1 || point.y > sourceH - 1) continue;
        const sample = bilinearSample(source, sourceW, sourceH, point.x, point.y);
        const index = (x + y * width) * 4;
        out[index] = sample[0];
        out[index + 1] = sample[1];
        out[index + 2] = sample[2];
        out[index + 3] = pixels[index + 3];
      }
    }
    return out;
  }

  async function extractCarrier(pixels, width, height, strength) {
    const fit = await recover(pixels, width, height);
    if (!fit || fit.locatorOnly || fit.carrierVersion !== CARRIER_V3) return extractBlind(pixels, width, height, strength);
    const origW = fit.origWidth, origH = fit.origHeight;
    const identity = !fit.matrix && origW === width && origH === height && fit.phaseX === 0 && fit.phaseY === 0;
    let restored;
    if (fit.matrix) {
      const read = fit.readImage || { pixels, width, height, matrix: fit.matrix };
      restored = new Uint8Array(origW * origH * 4);
      for (let y = 0; y < origH; y++) {
        if ((y & 31) === 31) await yieldNow();
        for (let x = 0; x < origW; x++) {
          const point = mappedPoint(read.matrix, x, y);
          restored.set(bilinearSample(read.pixels, read.width, read.height, point.x, point.y), (x + y * origW) * 4);
        }
      }
    } else restored = identity
      ? pixels.slice()
      : await resampleReadSpace(pixels, width, height, origW, origH, fit.scaleX, fit.scaleY, fit.phaseX, fit.phaseY);
    const cleaned = await extractBlind(restored, origW, origH, fit.strength, locatorBlockMap(origW, origH));
    cleanLocators(restored, origW, origH, cleaned);
    if (identity) return cleaned;
    return forwardSample(cleaned, origW, origH, pixels, width, height, fit);
  }

  async function extractBlind(pixels, width, height, strength, map = null) {
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
    const included = map ? new Uint8Array(columns * rows) : null;
    if (included) for (const block of map) included[block] = 1;
    for (let row = 0; row < rows; row++) {
      if ((row & 15) === 15) await yieldNow();
      for (let column = 0; column < columns; column++) {
        if (included && !included[column + row * columns]) continue;
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

  root.PixelStow = {
    estimateBytes,
    estimatePayloadBytes,
    payloadSize,
    payloadsEqual,
    inspect,
    decode,
    encode,
    encodePayload,
    extractCarrier,
    findVisualTransform,
    clearVisualTransform(pixels) { visualMappings.delete(pixels); },
    setCarrierVersion(version) { preferredCarrier = version === CARRIER_V1 ? CARRIER_V1 : CARRIER_V3; },
    getCarrierVersion() { return preferredCarrier; },
    readImageFile,
    decodePng,
    writePng,
    writeJpeg
  };
})(typeof window !== "undefined" ? window : self);
