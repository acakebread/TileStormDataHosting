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
  const MAX_INPUT_PIXELS = 32000000;
  const MAX_MARKER_PIXELS = 8000000;
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
  const CARRIER_V4 = 4;
  const CARRIER_V5 = 5;
  const V4_PAYLOAD_PEAK = 64;
  const V4_MARKER_PEAK = 32;
  const V5_MARKER_PEAK = 32;
  const REDUNDANCY_UPLIFT_AT_TWO = 0.15;
  const REDUNDANCY_UPLIFT_DENOMINATOR = 1;
  const DEFAULT_QUALITY = 0.8;
  let preferredCarrier = CARRIER_V5;
  let legacyRecovery = false;
  const RECOVERY_CARRIERS = [CARRIER_V5, CARRIER_V4, CARRIER_V3];
  function recoveryVersions(options = {}) {
    if (options.carrierVersion !== undefined)
      return [CARRIER_V1, ...RECOVERY_CARRIERS].includes(options.carrierVersion) ? [options.carrierVersion] : [];
    return (options.includeLegacy ?? legacyRecovery) ? [...RECOVERY_CARRIERS, CARRIER_V1] : [CARRIER_V5];
  }
  function recoveryOptions(options) {
    const selected = recoveryVersions(options);
    return { ...options, includeLegacy: options.includeLegacy ?? legacyRecovery,
      seed: selected.includes(options.seed?.carrierVersion) ? options.seed : undefined,
      searchState: !options.searchState?.seed || selected.includes(options.searchState.seed.carrierVersion) ? options.searchState : undefined };
  }
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

  function checkCancelled(signal) {
    if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
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

  function assertImage(pixels, width, height, limit = MAX_INPUT_PIXELS) {
    if (!pixels || width < 1 || height < 1 || width * height * 4 !== pixels.length) {
      throw new Error("The image dimensions are invalid.");
    }
    if (width < BLOCK || height < BLOCK) throw new Error("Use an image at least 4 by 4 pixels.");
    if (width * height > limit) throw new Error("This image exceeds the " + (limit / 1000000) + " megapixel " +
      (limit === MAX_PIXELS ? "encoding" : "photo input") + " limit.");
    const blocks = Math.floor(width / BLOCK) * Math.floor(height / BLOCK);
    if (blocks > MAX_BLOCKS) throw new Error("This image is too large for the browser tool.");
    return blocks;
  }

  function estimateBytes(width, height) {
    return Math.min(MAX_TEXT, estimatePayloadBytes(width, height));
  }

  function estimatePayloadBytes(width, height, passwordProtected = false, carrierVersion = preferredCarrier) {
    if (width < BLOCK || height < BLOCK || width * height > MAX_PIXELS) return 0;
    const profile = locatorProfile(carrierVersion);
    if (carrierVersion === CARRIER_V5 && !locatorFits(width, height, carrierVersion)) return 0;
    const blocks = Math.floor(width / BLOCK) * Math.floor(height / BLOCK) -
      (profile && locatorFits(width, height, carrierVersion) ? locatorArea(carrierVersion) / 16 : 0);
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

  function repetitionBudget(payloadBlocks, framedBytes, bitsPerByte) {
    const codedBits = framedBytes * bitsPerByte;
    return { repetitionRatio: payloadBlocks / codedBits, copies: Math.floor(payloadBlocks / codedBits),
      parityBits: bitsPerByte - 8, framedBytes, fits: codedBits <= payloadBlocks };
  }

  async function estimatePayloadFrame(content, passwordProtected = false) {
    const { text = "", attachments = [] } = content, bundle = attachments.length > 0;
    const plain = bundle ? packBundle(text, attachments) : strictUtf8(text);
    try {
      if (!plain.length) return null;
      // Both paths compress before framing/encryption. The encrypted envelope
      // then adds fixed overhead; no password or encryption is needed here.
      const compressed = await deflateRaw(plain);
      const framedBytes = HEADER + (passwordProtected ? ENVELOPE : 0) + Math.min(plain.length, compressed.length || Infinity);
      compressed.fill(0);
      return { framedBytes };
    } finally { plain.fill(0); }
  }

  function repetitionForFrame(width, height, framedBytes, version = preferredCarrier) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < BLOCK || height < BLOCK ||
      width * height > MAX_PIXELS || !Number.isSafeInteger(framedBytes) || framedBytes < HEADER || framedBytes > MAX_FRAMED) return null;
    if (locatorProfile(version) && !locatorFits(width, height, version)) return null;
    if (![CARRIER_V1, ...RECOVERY_CARRIERS].includes(version)) return null;
    const payloadBlocks = Math.floor(width / BLOCK) * Math.floor(height / BLOCK) - PREAMBLE_BLOCKS -
      (locatorProfile(version) ? locatorArea(version) / 16 : 0);
    const bitsPerByte = framedBytes * 12 <= payloadBlocks ? 12 : 9;
    return { ...repetitionBudget(Math.max(0, payloadBlocks), framedBytes, bitsPerByte), carrierVersion: version, width, height };
  }

  async function estimateRepetition(width, height, content, passwordProtected = false) {
    if (preferredCarrier === CARRIER_V5 && !locatorFits(width, height, preferredCarrier)) return null;
    const frame = await estimatePayloadFrame(content, passwordProtected);
    if (!frame) return null;
    const version = locatorProfile(preferredCarrier) && locatorFits(width, height, preferredCarrier) ? preferredCarrier : CARRIER_V1;
    return repetitionForFrame(width, height, frame.framedBytes, version);
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

  function v4SignalPolicy(ratio, strength) {
    // Use the actual fractional repetition budget, not its rounded copy count.
    // Five copies is the restrained case; near one copy spends more contrast.
    const pressure = Math.max(0, Math.min(1, (5 - ratio) / 4));
    const shortfall = Math.max(0, Math.min(1, 2 - ratio));
    const urgency = shortfall * (2 - shortfall);
    // A reciprocal uplift raises the existing curve by 15% at 2x, tapering
    // smoothly with more copies. The positive denominator and existing ceilings
    // keep low-redundancy pictures bounded. Quantise only after applying it.
    const uplift = redundancyUplift(ratio);
    return { strength: Math.max(strength, Math.min(32, Math.round((8 + 12 * pressure + 12 * urgency) * uplift))),
      textureGain: (0.175 + 0.825 * pressure) * (1 + urgency) * uplift,
      payloadPeak: Math.min(V4_PAYLOAD_PEAK, Math.round((48 + 16 * urgency) * uplift)),
      markerPeak: Math.min(V4_MARKER_PEAK, Math.round((24 + 8 * urgency) * uplift)),
      biasLimit: Math.round(4 + 8 * urgency) };
  }

  function redundancyUplift(ratio) {
    return 1 + REDUNDANCY_UPLIFT_AT_TWO * (2 + REDUNDANCY_UPLIFT_DENOMINATOR) /
      (Math.max(1, ratio) + REDUNDANCY_UPLIFT_DENOMINATOR);
  }

  function encodingQuality(value = DEFAULT_QUALITY) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_QUALITY;
  }

  function qualitySignalPolicy(policy, quality) {
    // Left spends more contrast on recovery. 0.8 preserves the accepted curve;
    // 1.0 is about 13% gentler and 0.0 about 74% stronger, before hard ceilings.
    const gain = Math.pow(2, DEFAULT_QUALITY - quality);
    return { ...policy,
      strength: Math.max(8, Math.min(32, Math.round(policy.strength * gain))),
      textureGain: policy.textureGain * gain,
      payloadPeak: Math.min(V4_PAYLOAD_PEAK, Math.round(policy.payloadPeak * gain)),
      markerPeak: Math.min(V4_MARKER_PEAK, Math.round(policy.markerPeak * gain)),
      biasLimit: Math.min(16, Math.round(policy.biasLimit * gain)),
      markerMinimum: Math.max(8, Math.round(12 * gain)),
      markerTextureMinimum: 0.5 * gain };
  }

  function estimateSignalGain(ratio, quality = DEFAULT_QUALITY, version = preferredCarrier) {
    if (![CARRIER_V4, CARRIER_V5].includes(version) || !Number.isFinite(ratio) || ratio < 1) return 1;
    const baseline = v4SignalPolicy(ratio, STRENGTHS[0]);
    const selected = qualitySignalPolicy(baseline, encodingQuality(quality));
    // A relative strength hint for the UI, including hard ceilings. It is not
    // a measured optical success probability or a replacement for redundancy.
    return 0.5 * selected.strength / baseline.strength +
      0.35 * selected.textureGain / baseline.textureGain + 0.15 * selected.markerPeak / baseline.markerPeak;
  }

  function linearRange(pixels, headroom, inverse = false) {
    // One symmetric RGB map over the entire image: midpoint stays fixed,
    // including untouched edge pixels and marker reservations. Alpha is unchanged.
    const output = pixels.slice(), scale = (255 - 2 * headroom) / 255;
    for (let i = 0; i < output.length; i += 4) for (let channel = 0; channel < 3; channel++)
      output[i + channel] = clampChannel(inverse
        ? (pixels[i + channel] - headroom) / scale
        : headroom + pixels[i + channel] * scale);
    return output;
  }

  function linearAmplitude(reference, width, x, y, requested) {
    const fits = (amplitude) => [0, 1].every((bit) => {
      const bias = fitBias(reference, width, x, y, bit, amplitude);
      return bias.fit.every(Boolean) && bias.shift.every((shift) => shift === 0);
    });
    if (fits(requested)) return requested;
    let low = 0, high = requested;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (fits(middle)) low = middle; else high = middle;
    }
    return low;
  }

  function linearMarkerGain(reference, width, x, y, grid, requested) {
    let gain = requested;
    for (const kernel of grid.kernels) for (let i = 0; i < kernel.length; i++) {
      if (kernel[i] === 0) continue;
      const index = (x + i % grid.cell + (y + Math.floor(i / grid.cell)) * width) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const sample = reference[index + channel];
        gain = Math.min(gain, kernel[i] > 0 ? (255 - sample) / kernel[i] : sample / -kernel[i]);
      }
    }
    return Math.max(0, gain);
  }

  function textureAmplitude(reference, width, x, y, side, policy, ceiling) {
    // Measure source detail after removing a plane. A smooth slope or a bright
    // flat sky is not noise. No encoded pixels or payload bits enter this test.
    let sum = 0, squares = 0, slopeX = 0, slopeY = 0;
    const middle = (side - 1) / 2, count = side * side;
    for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) {
      const index = (x + dx + (y + dy) * width) * 4;
      const value = (reference[index] + reference[index + 1] + reference[index + 2]) / 3;
      sum += value; squares += value * value;
      slopeX += value * (dx - middle); slopeY += value * (dy - middle);
    }
    const axisEnergy = count * (side * side - 1) / 12;
    const residual = Math.max(0, squares - sum * sum / count - (slopeX * slopeX + slopeY * slopeY) / axisEnergy);
    const rms = Math.sqrt(residual / count);
    return Math.min(ceiling, policy.strength + Math.round(rms * policy.textureGain));
  }

  function limitBoostHeadroom(reference, width, x, y, requested, nominal, biasLimit = 4) {
    if (requested <= nominal) return requested;
    const raised = [0, 1].map((bit) => fitBias(reference, width, x, y, bit, requested));
    // Ordinary unclipped blocks need no further work. Increasing amplitude
    // cannot reduce an already-required shift to zero, so their nominal fit
    // will also be neutral.
    if (raised.every((bias) => bias.fit.every(Boolean) && bias.shift.every((value) => value === 0))) return requested;
    const baseline = [0, 1].map((bit) => fitBias(reference, width, x, y, bit, nominal));
    // A per-channel sign flip is the legacy last resort on extreme colours.
    // Never increase its amplitude as a texture boost.
    if (baseline.some((bias) => bias.fit.some((value) => !value))) return nominal;
    const acceptable = (biases) => biases.every((bias, bit) => {
      if (bias.fit.some((value) => !value)) return false;
      const added = bias.shift.map((value, channel) => value - baseline[bit].shift[channel]);
      return added.every((value) => Math.abs(value) <= biasLimit) && Math.max(...added) - Math.min(...added) <= 2;
    });
    if (acceptable(raised)) return requested;
    // Select a conservative valid amplitude without a long decrement sweep.
    let low = nominal, high = requested;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (acceptable([0, 1].map((bit) => fitBias(reference, width, x, y, bit, middle)))) low = middle;
      else high = middle;
    }
    return low;
  }

  function applyBit(reference, image, width, column, blockRow, bit, strength, amplitudeCache, signalPolicy) {
    const originX = column * BLOCK;
    const originY = blockRow * BLOCK;
    const cacheIndex = amplitudeCache ? column + blockRow * (width / BLOCK | 0) : -1;
    let amplitude = cacheIndex >= 0 ? amplitudeCache[cacheIndex] : -1;
    if (amplitude < 0) {
      const texture = signalPolicy ? textureAmplitude(signalPolicy.textureSource || reference, width, originX, originY,
        BLOCK, signalPolicy, signalPolicy.payloadPeak) : strength;
      const requested = signalPolicy?.linearHeadroom ? texture : signalPolicy
        ? limitBoostHeadroom(reference, width, originX, originY, texture, strength, signalPolicy.biasLimit) : strength;
      amplitude = signalPolicy?.linearHeadroom ? linearAmplitude(reference, width, originX, originY, requested)
        : resolveAmplitude(reference, width, originX, originY, requested);
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

  async function writeBits(reference, image, width, columns, slots, bitAt, strength, amplitudeCache, signalPolicy) {
    for (let slot = 0; slot < slots.length; slot++) {
      if ((slot & 8191) === 8191) await yieldNow();
      const bit = bitAt(slot);
      const block = slots[slot];
      applyBit(reference, image, width, block % columns, Math.floor(block / columns), bit, strength, amplitudeCache, signalPolicy);
    }
  }

  // Versioned geometry profiles. Payload/encryption envelopes are independent.
  // V3 is frozen. V4 keeps its eight patches and wavelets, balances brightness
  // and adapts contrast to source detail/redundancy. V5 experiments with smaller patches.
  const LOCATOR_INSET = 8;
  const LOCATOR_STRENGTH = 16;
  const LOCATOR_PROFILES = new Map([
    [3, { version: 3, cell: 6, columns: 12, rows: 8, width: 72, height: 48,
      magic: 0xD3, tag: 0x30, seed: 0x50534C33, ids: [0, 2, 6, 8, 1, 3, 5, 7], sampleStep: 1.5, sampleOffset: 0.5 }],
    [4, { version: 4, cell: 6, columns: 12, rows: 8, width: 72, height: 48,
      magic: 0xD4, tag: 0x40, seed: 0x50534C34, ids: [0, 2, 6, 8, 1, 3, 5, 7], sampleStep: 1.5, sampleOffset: 0.5 }],
    [5, { version: 5, cell: 5, columns: 10, rows: 10, width: 50, height: 50,
      magic: 0xD5, tag: 0x50, seed: 0x50534C35, ids: [0, 2, 6, 8], sampleStep: 1.25, sampleOffset: 0.125 }]
  ]);
  for (const p of LOCATOR_PROFILES.values()) {
    p.reserveWidth = Math.ceil(p.width / 4) * 4;
    p.reserveHeight = Math.ceil(p.height / 4) * 4;
    p.order = scatterOrder(p.columns * p.rows, p.seed);
    p.shape = buildShapes(LOCATOR_STRENGTH).difference;
    if (p.version !== CARRIER_V3) {
      // Retain V3's expansion for V4; V5 interpolates a smaller cell. Remove
      // DC before writing so the bit does not set the local background brightness.
      p.kernels = [0, 1].map((bit) => {
        const weights = new Float64Array(p.cell * p.cell);
        for (let y = 0; y < p.cell; y++) for (let x = 0; x < p.cell; x++) {
          if (p.version === CARRIER_V4) {
            // Keep V3's six-pixel expansion and full contrast. Only its DC
            // component changes; the diagonal difference reader rejects DC.
            weights[x + y * p.cell] = shapeWeight(Math.floor(x * 4 / p.cell), Math.floor(y * 4 / p.cell), bit);
            continue;
          }
          const sx = Math.max(0, Math.min(3, (x + 0.5) * 4 / p.cell - 0.5));
          const sy = Math.max(0, Math.min(3, (y + 0.5) * 4 / p.cell - 0.5));
          const ix = Math.floor(sx), iy = Math.floor(sy), jx = Math.min(3, ix + 1), jy = Math.min(3, iy + 1);
          const fx = sx - ix, fy = sy - iy;
          weights[x + y * p.cell] = (shapeWeight(ix, iy, bit) * (1 - fx) + shapeWeight(jx, iy, bit) * fx) * (1 - fy) +
            (shapeWeight(ix, jy, bit) * (1 - fx) + shapeWeight(jx, jy, bit) * fx) * fy;
        }
        const mean = weights.reduce((sum, value) => sum + value, 0) / weights.length;
        return weights.map((value) => value - mean);
      });
    }
  }

  function locatorProfile(version = CARRIER_V3) { return LOCATOR_PROFILES.get(version); }

  function referenceLayout(width, height) {
    const middleX = Math.floor((width - 24) / 8) * 4, middleY = Math.floor((height - 16) / 8) * 4;
    return [{ id: 1, x: middleX, y: 8 }, { id: 3, x: 8, y: middleY },
      { id: 5, x: Math.floor((width - 32) / 4) * 4, y: middleY },
      { id: 7, x: middleX, y: Math.floor((height - 24) / 4) * 4 }];
  }

  function locatorArea(version) {
    const p = locatorProfile(version);
    return p.ids.length * p.reserveWidth * p.reserveHeight + (version === CARRIER_V5 ? 4 * 24 * 16 : 0);
  }

  function reservedLocators(width, height, version) {
    const p = locatorProfile(version);
    return locatorLayout(width, height, version).map((patch) => ({ ...patch, width: p.reserveWidth, height: p.reserveHeight }))
      .concat(version === CARRIER_V5 ? referenceLayout(width, height).map((patch) => ({ ...patch, width: 24, height: 16 })) : []);
  }

  function locatorLayout(width, height, version = CARRIER_V3) {
    const p = locatorProfile(version), span = version === CARRIER_V5 ? 2 : 3;
    // V5 also leaves room between corners for the small side references.
    if (!p || width < span * p.reserveWidth + 2 * LOCATOR_INSET + (version === CARRIER_V5 ? 24 : 0) ||
      height < span * p.reserveHeight + 2 * LOCATOR_INSET + (version === CARRIER_V5 ? 16 : 0)) return null;
    const xs = [LOCATOR_INSET, Math.floor((width - p.reserveWidth) / 8) * 4, Math.floor((width - p.reserveWidth - LOCATOR_INSET) / 4) * 4];
    const ys = [LOCATOR_INSET, Math.floor((height - p.reserveHeight) / 8) * 4, Math.floor((height - p.reserveHeight - LOCATOR_INSET) / 4) * 4];
    return p.ids.map((id) => ({ x: xs[id % 3], y: ys[Math.floor(id / 3)], id }));
  }

  function locatorFits(width, height, version = CARRIER_V3) {
    const p = locatorProfile(version);
    // Small pictures use carrier 1 rather than sacrifice most of their capacity.
    return Boolean(p) && width <= 65535 && height <= 65535 && Boolean(locatorLayout(width, height, version)) &&
      width * height <= MAX_PIXELS && locatorArea(version) <= width * height * 0.3;
  }

  function locatorBlockMap(width, height, limit = Infinity, version = CARRIER_V3) {
    const layout = locatorLayout(width, height, version);
    if (!layout) return null;
    const reserved = reservedLocators(width, height, version);
    const columns = Math.floor(width / BLOCK), rows = Math.floor(height / BLOCK);
    const map = new Uint32Array(Math.min(limit, columns * rows - locatorArea(version) / 16));
    let count = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = column * BLOCK, y = row * BLOCK;
        if (!reserved.some((patch) => x >= patch.x && x < patch.x + patch.width && y >= patch.y && y < patch.y + patch.height)) {
          map[count++] = column + row * columns;
          if (count === map.length) return map;
        }
      }
    }
    return map;
  }

  function locatorHeader(width, height, id, version = CARRIER_V3) {
    const p = locatorProfile(version);
    const bytes = new Uint8Array(8);
    bytes[0] = p.magic;
    bytes[1] = p.tag | id;
    bytes[2] = width & 255; bytes[3] = width >>> 8;
    bytes[4] = height & 255; bytes[5] = height >>> 8;
    const checksum = crc32(bytes, 0, 6) & 0xFFFF;
    bytes[6] = checksum & 255; bytes[7] = checksum >>> 8;
    scramble(bytes, p.seed);
    return bytes;
  }

  function paintLocators(reference, output, width, height, strength, version = CARRIER_V3, signalPolicy) {
    if (version !== CARRIER_V3) return paintBlendedLocators(reference, output, width, height, strength, version, signalPolicy);
    const p = locatorProfile(version);
    const amplitude = Math.min(LOCATOR_STRENGTH, strength);
    for (const patch of locatorLayout(width, height, version)) {
      const header = locatorHeader(width, height, patch.id, version);
      for (let slot = 0; slot < 96; slot++) {
        const cell = p.order[slot];
        const bit = WORD_BITS[header[Math.floor(slot / 12)] * 12 + slot % 12];
        const x = patch.x + (cell % p.columns) * p.cell;
        const y = patch.y + Math.floor(cell / p.columns) * p.cell;
        for (let channel = 0; channel < 3; channel++) {
          let low = -Infinity, high = Infinity;
          for (let dy = 0; dy < p.cell; dy++) for (let dx = 0; dx < p.cell; dx++) {
            const delta = scaleWeight(amplitude, shapeWeight(Math.floor(dx * 4 / p.cell), Math.floor(dy * 4 / p.cell), bit));
            const value = reference[(x + dx + (y + dy) * width) * 4 + channel];
            low = Math.max(low, -value - delta);
            high = Math.min(high, 255 - value - delta);
          }
          const bias = low <= high ? Math.max(low, Math.min(high, 0)) : 0;
          for (let dy = 0; dy < p.cell; dy++) for (let dx = 0; dx < p.cell; dx++) {
            const index = (x + dx + (y + dy) * width) * 4 + channel;
            output[index] = clampByte(reference[index] + bias + scaleWeight(amplitude, shapeWeight(Math.floor(dx * 4 / p.cell), Math.floor(dy * 4 / p.cell), bit)));
          }
        }
      }
    }
  }

  function locatorGain(p, cell) {
    const x = cell % p.columns, y = Math.floor(cell / p.columns);
    return (x === 0 || x === p.columns - 1 ? 0.7 : 1) * (y === 0 || y === p.rows - 1 ? 0.7 : 1);
  }

  let sideReferenceProfile;
  function referenceProfile() {
    return sideReferenceProfile ||= { cell: 4, columns: 6, rows: 4, width: 24, height: 16,
      order: scatterOrder(24, locatorProfile(CARRIER_V5).seed), sampleStep: 1, sampleOffset: 0,
      shape: buildShapes(16).difference,
      kernels: [0, 1].map((bit) => Float64Array.from({ length: 16 }, (_, i) => shapeWeight(i % 4, Math.floor(i / 4), bit))) };
  }

  function patchTransform(matrix, patch) {
    return [matrix[0], matrix[1], matrix[2] + matrix[0] * patch.x + matrix[1] * patch.y,
      matrix[3], matrix[4], matrix[5] + matrix[3] * patch.x + matrix[4] * patch.y,
      matrix[6], matrix[7], matrix[8] + matrix[6] * patch.x + matrix[7] * patch.y];
  }

  function checkReferences(pixels, width, height, matrix, dimensions, nativeOnly = false) {
    // References are checked only near positions predicted by verified corner
    // geometry. They carry no independent dimensions or checksum and must never
    // be used to claim that an image is encoded, or to accept its payload.
    const found = [];
    for (const patch of referenceLayout(dimensions.originalWidth, dimensions.originalHeight)) {
      const header = locatorHeader(0, 0, patch.id, CARRIER_V5);
      const quality = (x, y) => locatorAgreement(locatorScores(pixels, width, height,
        patchTransform(matrix, { x: patch.x + x, y: patch.y + y }), 24, CARRIER_V5, true), header);
      let best = { x: 0, y: 0, quality: quality(0, 0) };
      if (!nativeOnly) {
        for (const y of [-6, -4, -2, 0, 2, 4, 6]) for (const x of [-6, -4, -2, 0, 2, 4, 6]) {
          const q = quality(x, y);
          if (q > best.quality) best = { x, y, quality: q };
        }
        for (const step of [0.5, 0.125]) {
          const start = best;
          for (const y of [-step, 0, step]) for (const x of [-step, 0, step]) {
            const q = quality(start.x + x, start.y + y);
            if (q > best.quality) best = { x: start.x + x, y: start.y + y, quality: q };
          }
        }
      }
      if (best.quality >= 0.82) found.push({ id: patch.id, verification: "reference", quality: best.quality,
        carrierVersion: CARRIER_V5, patchWidth: 24, patchHeight: 16,
        matrix: patchTransform(matrix, { x: patch.x + best.x, y: patch.y + best.y }),
        expectedMatrix: patchTransform(matrix, patch), displacement: { x: best.x, y: best.y } });
    }
    return found;
  }

  function blendedLocatorGain(version, grid, cell, main = true) {
    return version === CARRIER_V4 ? 1 : locatorGain(grid, cell) * (main ? 1 : 0.65);
  }

  function paintBlendedLocators(reference, output, width, height, strength, version, signalPolicy) {
    const p = locatorProfile(version), amplitude = Math.min(version === CARRIER_V4 ? LOCATOR_STRENGTH : 12, strength) / 16;
    // Header symbols are not repeated as often as the data. Keep the small V5
    // patch readable in source texture even when the payload has ample copies.
    const markerPolicy = signalPolicy && version === CARRIER_V5 ? { ...signalPolicy,
      strength: Math.max(signalPolicy.markerMinimum ?? 12, signalPolicy.strength),
      textureGain: Math.max(signalPolicy.markerTextureMinimum ?? 0.5, signalPolicy.textureGain) } : signalPolicy;
    const side = referenceProfile();
    const reserved = reservedLocators(width, height, version);
    // Match the surrounding carrier's DC correction on clipped colours (pure
    // black/white cannot carry a zero-mean mark). Measure only payload pixels,
    // before painting any markers, so patch order never changes the result.
    const backgrounds = new Map(reserved.map((patch) => {
      const bias = [0, 0, 0]; let count = 0;
      for (let y = Math.max(0, patch.y - 12); y < Math.min(height, patch.y + patch.height + 12); y++) {
        for (let x = Math.max(0, patch.x - 12); x < Math.min(width, patch.x + patch.width + 12); x++) {
          if (reserved.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) continue;
          const index = (x + y * width) * 4;
          for (let c = 0; c < 3; c++) bias[c] += output[index + c] - reference[index + c];
          count++;
        }
      }
      return [patch.id, bias.map((value) => count ? value / count : 0)];
    }));
    // Give any aligned reservation margin the same background correction,
    // avoiding a bright/dark outline; cells below supply the actual signal.
    for (const patch of reserved) for (let y = patch.y; y < patch.y + patch.height; y++) {
      for (let x = patch.x; x < patch.x + patch.width; x++) {
        const index = (x + y * width) * 4;
        for (let c = 0; c < 3; c++) output[index + c] = Math.round(clampByte(reference[index + c] + backgrounds.get(patch.id)[c]));
      }
    }
    const patches = locatorLayout(width, height, version).concat(version === CARRIER_V5 ? referenceLayout(width, height) : []);
    for (const patch of patches) {
      const main = p.ids.includes(patch.id), grid = main ? p : side, count = grid.cell ** 2;
      const samples = new Float64Array(count), values = new Float64Array(count);
      const header = locatorHeader(width, height, patch.id, version);
      for (let slot = 0; slot < grid.order.length; slot++) {
        const cell = grid.order[slot], coded = slot % (main ? 96 : 24);
        const bit = WORD_BITS[header[Math.floor(coded / 12)] * 12 + coded % 12];
        const x = patch.x + cell % grid.columns * grid.cell, y = patch.y + Math.floor(cell / grid.columns) * grid.cell;
        const localAmplitude = markerPolicy ? textureAmplitude(markerPolicy.textureSource || reference, width, x, y,
          grid.cell, markerPolicy, markerPolicy.markerPeak) / 16 : amplitude;
        let gain = localAmplitude * blendedLocatorGain(version, grid, cell, main);
        if (signalPolicy?.linearHeadroom) gain = linearMarkerGain(reference, width, x, y, grid, gain);
        const kernel = grid.kernels[bit];
        for (let channel = 0; channel < 3; channel++) {
          let target = 0;
          for (let i = 0; i < count; i++) {
            samples[i] = reference[(x + i % grid.cell + (y + Math.floor(i / grid.cell)) * width) * 4 + channel];
            target += samples[i];
          }
          target = Math.max(0, Math.min(count * 255, Math.round(target + count * backgrounds.get(patch.id)[channel])));
          // Saturated pixels have no symmetric headroom. Solve the clamped mean
          // rather than shifting the whole patch lighter/darker to fit a lobe.
          let low = -64, high = 64;
          for (let pass = 0; !signalPolicy?.linearHeadroom && pass < 18; pass++) {
            const shift = (low + high) / 2;
            let total = 0;
            for (let i = 0; i < count; i++) total += clampByte(samples[i] + gain * kernel[i] + shift);
            if (total < target) low = shift; else high = shift;
          }
          const shift = signalPolicy?.linearHeadroom ? 0 : (low + high) / 2;
          let written = 0;
          for (let i = 0; i < count; i++) {
            values[i] = clampByte(samples[i] + gain * kernel[i] + shift);
            const index = (x + i % grid.cell + (y + Math.floor(i / grid.cell)) * width) * 4 + channel;
            output[index] = Math.round(values[i]); written += output[index];
          }
          // Quantisation also preserves the chosen local background average.
          while (written !== target) {
            const step = written < target ? 1 : -1;
            let best = -1, error = -Infinity;
            for (let i = 0; i < count; i++) {
              const index = (x + i % grid.cell + (y + Math.floor(i / grid.cell)) * width) * 4 + channel;
              if (output[index] + step < 0 || output[index] + step > 255) continue;
              const residual = step * (values[i] - output[index]);
              if (residual > error) { best = index; error = residual; }
            }
            if (best < 0) break;
            output[best] += step; written += step;
          }
        }
      }
    }
  }

  function sampleLuma(pixels, width, height, x, y, channel) {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = (x0 + y0 * width) * 4, b = (x1 + y0 * width) * 4;
    const c = (x0 + y1 * width) * 4, d = (x1 + y1 * width) * 4;
    if (channel !== undefined) return pixels[a + channel] * (1 - fx) * (1 - fy) + pixels[b + channel] * fx * (1 - fy) +
      pixels[c + channel] * (1 - fx) * fy + pixels[d + channel] * fx * fy;
    return ((pixels[a] + pixels[a + 1] + pixels[a + 2]) * (1 - fx) * (1 - fy) +
      (pixels[b] + pixels[b + 1] + pixels[b + 2]) * fx * (1 - fy) +
      (pixels[c] + pixels[c + 1] + pixels[c + 2]) * (1 - fx) * fy +
      (pixels[d] + pixels[d + 1] + pixels[d + 2]) * fx * fy) / 3;
  }

  function readLocator(pixels, width, height, x, y, scaleX, scaleY, id, version = CARRIER_V3) {
    const p = locatorProfile(version);
    if (x < -2 || y < -2 || x + (p.width - 1) * scaleX > width + 1 || y + (p.height - 1) * scaleY > height + 1) return null;
    const known = locatorHeader(0, 0, id, version);
    const scores = new Float64Array(96);
    let pilot = 0, pilotEnergy = 0;
    for (let slot = 0; slot < 96; slot++) {
      const cell = p.order[slot];
      const originX = x + cell % p.columns * p.cell * scaleX;
      const originY = y + Math.floor(cell / p.columns) * p.cell * scaleY;
      let projection = 0, sum = 0, squares = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const value = sampleLuma(pixels, width, height, originX + (p.sampleStep * dx + p.sampleOffset) * scaleX, originY + (p.sampleStep * dy + p.sampleOffset) * scaleY);
        projection += value * p.shape[dx + dy * 4]; sum += value; squares += value * value;
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
    scramble(bytes, p.seed);
    if (bytes[0] !== p.magic || bytes[1] !== (p.tag | id) || (crc32(bytes, 0, 6) & 0xFFFF) !== (bytes[6] | bytes[7] << 8)) return null;
    const originalWidth = bytes[2] | bytes[3] << 8, originalHeight = bytes[4] | bytes[5] << 8;
    if (!locatorFits(originalWidth, originalHeight, version)) return null;
    const actualX = width / originalWidth, actualY = height / originalHeight;
    if (actualX < 0.49 || actualX > 2.01 || actualY < 0.49 || actualY > 2.01 ||
      Math.abs(actualX - scaleX) > 0.04 || Math.abs(actualY - scaleY) > 0.04) return null;
    return { originalWidth, originalHeight, carrierVersion: version, id, quality: pilot / pilotEnergy };
  }

  function mappedPoint(matrix, x, y) {
    const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
    return { x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
      y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator };
  }

  function locatorScores(pixels, width, height, matrix, count = 96, version = CARRIER_V3, reference = false) {
    const p = reference ? referenceProfile() : locatorProfile(version);
    // The patch matrix maps its own pixel centres into the supplied image.
    for (const [x, y] of [[0, 0], [p.width - 1, 0], [0, p.height - 1], [p.width - 1, p.height - 1]]) {
      const point = mappedPoint(matrix, x, y);
      if (!Number.isFinite(point.x + point.y) || point.x < -0.5 || point.y < -0.5 || point.x > width - 0.5 || point.y > height - 0.5) return null;
    }
    const scores = new Float64Array(count);
    for (let slot = 0; slot < count; slot++) {
      const cell = p.order[slot], x = cell % p.columns * p.cell, y = Math.floor(cell / p.columns) * p.cell;
      let projection = 0, sum = 0, squares = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const point = mappedPoint(matrix, x + p.sampleStep * dx + p.sampleOffset, y + p.sampleStep * dy + p.sampleOffset);
        const value = sampleLuma(pixels, width, height, point.x, point.y);
        projection += value * p.shape[dx + dy * 4]; sum += value; squares += value * value;
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

  function readVisualLocator(pixels, width, height, matrix, id, version = CARRIER_V3) {
    const p = locatorProfile(version);
    const scores = locatorScores(pixels, width, height, matrix, 96, version);
    if (!scores || locatorAgreement(scores.subarray(0, 24), locatorHeader(0, 0, id, version)) < 0.55) return null;
    const bytes = decodeSoft(scores, 8).bytes;
    scramble(bytes, p.seed);
    if (bytes[0] !== p.magic || bytes[1] !== (p.tag | id) || (crc32(bytes, 0, 6) & 0xFFFF) !== (bytes[6] | bytes[7] << 8)) return null;
    const originalWidth = bytes[2] | bytes[3] << 8, originalHeight = bytes[4] | bytes[5] << 8;
    if (!locatorFits(originalWidth, originalHeight, version)) return null;
    // Supplied image bounds say nothing about encoded bounds once there is padding.
    return { originalWidth, originalHeight, carrierVersion: version, patchWidth: p.width, patchHeight: p.height, id, matrix: Array.from(matrix),
      verification: "header", quality: locatorAgreement(scores, locatorHeader(originalWidth, originalHeight, id, version)) };
  }

  function visualAdapter(pixels, width, height, version = CARRIER_V3) {
    const p = locatorProfile(version), ids = p.ids;
    return {
      carrierVersion: version, patchWidth: p.width, patchHeight: p.height,
      sampleStep: p.sampleStep, sampleOffset: p.sampleOffset,
      shape: Array.from(p.shape), ids,
      pilots: ids.map((id) => {
        const header = locatorHeader(0, 0, id, version);
        return { id, points: Array.from({ length: 24 }, (_, slot) => {
          const cell = p.order[slot];
          return { x: cell % p.columns * p.cell, y: Math.floor(cell / p.columns) * p.cell,
            sign: WORD_BITS[header[Math.floor(slot / 12)] * 12 + slot % 12] ? 1 : -1 };
        }) };
      }),
      layout: (w, h) => locatorLayout(w, h, version),
      references: version === CARRIER_V5 ? (matrix, dimensions) => checkReferences(pixels, width, height, matrix, dimensions) : undefined,
      read: (matrix, id) => readVisualLocator(pixels, width, height, matrix, id, version),
      confirm: (matrix, id, dimensions) => {
        const read = readVisualLocator(pixels, width, height, matrix, id, version);
        if (read && read.originalWidth === dimensions.originalWidth && read.originalHeight === dimensions.originalHeight) return read;
        // Once dimensions are known, compare all 96 expected symbols. A damaged
        // header can still supply geometry; acceptance of contents needs frame CRC.
        const scores = locatorScores(pixels, width, height, matrix, 96, version);
        const header = locatorHeader(dimensions.originalWidth, dimensions.originalHeight, id, version);
        const quality = locatorAgreement(scores, header);
        if (quality < 0.58 || !scores || locatorAgreement(scores.subarray(0, 24), header) < 0.4) return null;
        return { originalWidth: dimensions.originalWidth, originalHeight: dimensions.originalHeight,
          carrierVersion: version, patchWidth: p.width, patchHeight: p.height, id, matrix: Array.from(matrix), quality, verification: "pattern" };
      },
      quality: (matrix, id, dimensions) => locatorAgreement(locatorScores(pixels, width, height, matrix, dimensions ? 96 : 24, version),
        locatorHeader(dimensions?.originalWidth || 0, dimensions?.originalHeight || 0, id, version))
    };
  }

  async function findLocator(pixels, width, height, nativeOnly = false, quickOnly = false, signal, options = {}) {
    const scales = nativeOnly ? [1] : quickOnly ? [0.95, 2, 0.5, 1.05, 0.75, 1.5, 1.25] : [0.95, 2, 0.5, 1.05, 0.75, 1.5, 1.25, 1];
    if (!nativeOnly && !quickOnly) {
      for (let i = 20; i <= 80; i++) {
        const scale = i / 40;
        if (!scales.includes(scale)) scales.push(scale);
      }
    }
    const offsets = nativeOnly ? [0] : quickOnly ? [0, -0.5, 0.5] : [0, -0.5, 0.5, -1, 1];
    for (const version of recoveryVersions(options).filter((version) => locatorProfile(version))) for (const scale of scales) {
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      const guessedWidth = Math.round(width / scale), guessedHeight = Math.round(height / scale);
      const layout = locatorLayout(guessedWidth, guessedHeight, version);
      if (!layout || !locatorFits(guessedWidth, guessedHeight, version)) continue;
      for (const id of locatorProfile(version).ids) {
        const patch = layout.find((patch) => patch.id === id);
        for (const oy of offsets) for (const ox of offsets) {
          const found = readLocator(pixels, width, height, patch.x * scale + (scale - 1) / 2 + ox, patch.y * scale + (scale - 1) / 2 + oy, scale, scale, id, version);
          if (found && (!nativeOnly || (found.originalWidth === width && found.originalHeight === height))) return found;
        }
      }
      await yieldNow();
    }
    return null;
  }

  async function scoreMapped(pixels, width, height, map, originalWidth, strength, fit, limit = map.length, signal = fit?.signal) {
    checkCancelled(signal);
    const scores = new Int32Array(limit), bounded = new Int32Array(limit);
    const difference = buildShapes(strength).difference;
    const columns = Math.floor(originalWidth / BLOCK);
    let differenceEnergy = 0;
    for (const value of difference) differenceEnergy += value * value;
    const block = new Float64Array(16);
    const half = fit && !fit.matrix && Math.abs(fit.scaleX - 0.5) < 0.001 && Math.abs(fit.scaleY - 0.5) < 0.001;
    for (let i = 0; i < limit; i++) {
      if ((i & 8191) === 8191) {
        await yieldNow();
        checkCancelled(signal);
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
          block[k] = sampleLuma(pixels, width, height, point.x, point.y, fit.channel);
        } else {
          block[k] = fit ? sampleLuma(pixels, width, height, fit.scaleX * (x + dx) + fit.phaseX, fit.scaleY * (y + dy) + fit.phaseY, fit.channel)
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
    const version = record.carrierVersion || CARRIER_V3;
    const map = locatorBlockMap(originalWidth, originalHeight, Infinity, version);
    const scaleX = width / originalWidth, scaleY = height / originalHeight;
    const offsets = native ? [0] : [0, -0.25, 0.25, -0.5, 0.5, -1, 1];
    for (const oy of offsets) for (const ox of offsets) {
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      const fit = native ? null : { scaleX, scaleY, phaseX: (scaleX - 1) / 2 + ox, phaseY: (scaleY - 1) / 2 + oy, signal };
      for (const strength of STRENGTHS) {
        const probe = await scoreMapped(pixels, width, height, map, originalWidth, strength, fit, PREAMBLE_BLOCKS, signal);
        const preamble = tryReadPreamble(probe.scores) || tryReadPreamble(probe.bounded);
        if (!preamble || preamble.version !== version) continue;
        const scored = await scoreMapped(pixels, width, height, map, originalWidth, strength, fit, map.length, signal);
        const found = (await tryLayout(scored.scores, signal)) || (await tryLayout(scored.bounded, signal));
        if (found && found.carrierVersion === version) return {
          ...found, origWidth: originalWidth, origHeight: originalHeight,
          scaleX, scaleY, phaseX: fit?.phaseX || 0, phaseY: fit?.phaseY || 0
        };
      }
      if (!native) await yieldNow();
    }
    return { locatorOnly: true, carrierVersion: version, origWidth: originalWidth, origHeight: originalHeight, scaleX, scaleY };
  }

  async function readVisualMapping(pixels, width, height, geometry, signal, readOptions = {}) {
    const version = geometry.carrierVersion || CARRIER_V3;
    const map = locatorBlockMap(geometry.originalWidth, geometry.originalHeight, Infinity, version);
    const offsets = readOptions.offsets || [0, -0.25, 0.25, -0.5, 0.5];
    for (const oy of offsets) for (const ox of offsets) {
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      const matrix = geometry.matrix.slice();
      // Offset in observed space, including the projective denominator.
      for (let i = 0; i < 3; i++) { matrix[i] += ox * matrix[i + 6]; matrix[i + 3] += oy * matrix[i + 6]; }
      let fit = { matrix, signal, channel: readOptions.channel };
      if (Math.abs(matrix[1]) < 1e-12 && Math.abs(matrix[3]) < 1e-12 && Math.abs(matrix[6]) + Math.abs(matrix[7]) < 1e-12) {
        fit = { scaleX: matrix[0] / matrix[8], scaleY: matrix[4] / matrix[8], phaseX: matrix[2] / matrix[8], phaseY: matrix[5] / matrix[8], signal, channel: readOptions.channel };
      }
      for (const strength of readOptions.strengths || STRENGTHS) {
        const probe = await scoreMapped(pixels, width, height, map, geometry.originalWidth, strength, fit, PREAMBLE_BLOCKS);
        const preamble = tryReadPreamble(probe.scores) || tryReadPreamble(probe.bounded);
        if (!preamble || preamble.version !== version) continue;
        const scored = await scoreMapped(pixels, width, height, map, geometry.originalWidth, strength, fit);
        const found = (await tryLayout(scored.scores, signal)) || (await tryLayout(scored.bounded, signal));
        if (found && found.carrierVersion === version) return {
          ...found, origWidth: geometry.originalWidth, origHeight: geometry.originalHeight,
          matrix, readChannel: readOptions.channel, geometry: { ...geometry, matrix,
            corners: [[0, 0], [geometry.originalWidth - 1, 0], [geometry.originalWidth - 1, geometry.originalHeight - 1], [0, geometry.originalHeight - 1]]
              .map(([x, y]) => mappedPoint(matrix, x, y)) }, visualTransform: geometry.model
        };
      }
      await yieldNow();
    }
    return { locatorOnly: true, carrierVersion: version, origWidth: geometry.originalWidth, origHeight: geometry.originalHeight,
      matrix: geometry.matrix, geometry, visualTransform: geometry.model };
  }

  function canUseReaderWorker(options) {
    return typeof Worker !== "undefined" && codecScriptUrl &&
      ["http:", "https:"].includes(new URL(codecScriptUrl).protocol) && options.worker !== false;
  }

  function searchInWorker(pixels, width, height, options, operation = "geometry") {
    return new Promise((resolve, reject) => {
      const url = new URL("pixelstow-transform-worker.js?v=20261014-camera-devices1", codecScriptUrl);
      const worker = new Worker(url);
      let finished = false;
      const abort = () => { if (finished) return; cleanup(); reject(new DOMException("Search cancelled.", "AbortError")); };
      const cleanup = () => {
        finished = true;
        worker.onmessage = worker.onerror = null;
        worker.terminate();
        options.signal?.removeEventListener("abort", abort);
      };
      worker.onmessage = ({ data }) => {
        if (finished) return;
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
          includeLegacy: options.includeLegacy ?? legacyRecovery, carrierVersion: options.carrierVersion, nativeOnly: options.nativeOnly,
          corners: options.corners, seed: options.seed, deadline: options.deadline,
          seedDeadline: options.seedDeadline, camera: options.camera, scan: options.scan,
          searchState: options.searchState, stopOnHighConfidence: options.stopOnHighConfidence,
          resumeDiscovery: options.resumeDiscovery,
          strength: options.strength, visual: options.visual }, [copy.buffer]);
      } catch (error) { cleanup(); reject(error); }
    });
  }

  async function findVisualTransform(pixels, width, height, options = {}) {
    options = recoveryOptions(options);
    assertImage(pixels, width, height);
    checkCancelled(options.signal);
    if (!root.PixelStowTransform) throw new Error("The visual transform reader script is missing. Reload this page.");
    if (!options.geometryOnly) {
      const scan = await scanMarkers(pixels, width, height, options);
      const read = await readMarkerCandidates(pixels, width, height, scan, options);
      if (!read.unreadable || !scan.searchState?.pending.length) return read;
      // Strong markers permit an early read, never acceptance without the body
      // checksum. Resume unvisited scales if that promising fit cannot decode.
      options.onProgress?.("The strong marker fit did not decode. Comparing the remaining image scales…");
      const remaining = await scanMarkers(pixels, width, height, { ...options, searchState: scan.searchState, stopOnHighConfidence: false });
      const retried = await readMarkerCandidates(pixels, width, height, remaining, options);
      return retried.found && !retried.unreadable || (retried.markers?.length || 0) > (read.markers?.length || 0) ? retried : read;
    }
    // A page opened from disk has an opaque origin and cannot start this worker.
    // The same detector can run on the page, yielding between chunks for cancel/UI.
    const versions = recoveryVersions(options).filter((version) => locatorProfile(version));
    if (!versions.length) return { found: false, geometry: null, candidates: [], markers: [],
      reason: "The selected format has no photographic recovery markers." };
    const search = canUseReaderWorker(options)
      ? await searchInWorker(pixels, width, height, options)
      : await root.PixelStowTransform.find(pixels, width, height, options, versions.map((version) => visualAdapter(pixels, width, height, version)));
    return search;
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
    const liftGeometry = (geometry) => ({ ...geometry, matrix: lift(geometry.matrix),
      corners: geometry.corners.map((p) => ({ x: sx * p.x + ox, y: sy * p.y + oy })),
      expectedMarkers: geometry.expectedMarkers.map((m) => ({ ...m, matrix: lift(m.matrix) })),
      referenceMarkers: geometry.referenceMarkers?.map((m) => ({ ...m, matrix: lift(m.matrix), expectedMatrix: lift(m.expectedMatrix) })) });
    const geometry = result.geometry && liftGeometry(result.geometry);
    return { ...result, geometry, markers: result.markers?.map((m) => ({ ...m, matrix: lift(m.matrix),
      initialMatrix: m.initialMatrix && lift(m.initialMatrix) })),
      candidates: result.candidates?.map(liftGeometry),
      localizationResolution: { width: readWidth, height: readHeight } };
  }

  function geometryAt(geometry, matrix) {
    const { originalWidth: w, originalHeight: h } = geometry;
    return { ...geometry, matrix,
      corners: [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]].map(([x, y]) => mappedPoint(matrix, x, y)),
      expectedMarkers: locatorLayout(w, h, geometry.carrierVersion || CARRIER_V3).map((p) => ({ id: p.id, matrix: [
        matrix[0], matrix[1], matrix[2] + matrix[0] * p.x + matrix[1] * p.y,
        matrix[3], matrix[4], matrix[5] + matrix[3] * p.x + matrix[4] * p.y,
        matrix[6], matrix[7], matrix[8] + matrix[6] * p.x + matrix[7] * p.y] })) };
  }

  function photoPhaseAt(field, x, y) {
    if (field.kind === "spline") return root.PixelStowLattice.at(field, x, y);
    const gx = Math.max(0, Math.min(field.columns - 1, (x - field.step / 2) / field.step));
    const gy = Math.max(0, Math.min(field.rows - 1, (y - field.step / 2) / field.step));
    const ix = Math.floor(gx), iy = Math.floor(gy), jx = Math.min(field.columns - 1, ix + 1), jy = Math.min(field.rows - 1, iy + 1);
    const fx = gx - ix, fy = gy - iy, values = field.offsets;
    const a = (ix + iy * field.columns) * 2, b = (jx + iy * field.columns) * 2;
    const c = (ix + jy * field.columns) * 2, d = (jx + jy * field.columns) * 2;
    return { x: (values[a] * (1 - fx) + values[b] * fx) * (1 - fy) + (values[c] * (1 - fx) + values[d] * fx) * fy,
      y: (values[a + 1] * (1 - fx) + values[b + 1] * fx) * (1 - fy) + (values[c + 1] * (1 - fx) + values[d + 1] * fx) * fy };
  }

  async function measurePhotoPhase(image, signal) {
    // Both symbols share a central 2x2 lobe on the four-pixel lattice. Its
    // horizontal/vertical Fourier phase locates pixels without knowing the bits.
    // Markers establish the plane; this only corrects small remaining grid errors.
    const { pixels, width, height } = image, step = 32, radius = 32;
    if (width < radius * 4 || height < radius * 4) return null;
    const columns = Math.ceil(width / step), rows = Math.ceil(height / step);
    const offsets = new Float32Array(columns * rows * 2), luma = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      if ((y & 31) === 0) { checkCancelled(signal); await yieldNow(); }
      for (let x = 0; x < width; x++) {
        const i = x + y * width;
        luma[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
      }
    }
    const cosine = [1, 0, -1, 0], sine = [0, -1, 0, 1];
    const weights = Float64Array.from({ length: radius * 2 }, (_, i) => 0.5 + 0.5 * Math.cos((i - radius) * Math.PI / radius));
    const phase = (real, imaginary) => {
      let angle = -3 * Math.PI / 4 - Math.atan2(imaginary, real);
      if (angle > Math.PI) angle -= 2 * Math.PI;
      if (angle < -Math.PI) angle += 2 * Math.PI;
      return angle * 2 / Math.PI;
    };
    let strong = 0;
    for (let gy = 0; gy < rows; gy++) {
      checkCancelled(signal); await yieldNow();
      for (let gx = 0; gx < columns; gx++) {
        const cx = step / 2 + gx * step, cy = step / 2 + gy * step;
        let xr = 0, xi = 0, yr = 0, yi = 0;
        for (let y = Math.max(1, cy - radius); y < Math.min(height - 1, cy + radius); y++) {
          const wy = weights[y - cy + radius];
          for (let x = Math.max(1, cx - radius); x < Math.min(width - 1, cx + radius); x++) {
            const weight = weights[x - cx + radius] * wy, i = x + y * width;
            // Second differences remove slowly varying photo content before
            // measuring the carrier, including at partially covered edge windows.
            const vx = (2 * luma[i] - luma[i - 1] - luma[i + 1]) * weight;
            const vy = (2 * luma[i] - luma[i - width] - luma[i + width]) * weight;
            xr += vx * cosine[x & 3]; xi += vx * sine[x & 3];
            yr += vy * cosine[y & 3]; yi += vy * sine[y & 3];
          }
        }
        if (Math.min(Math.hypot(xr, xi), Math.hypot(yr, yi)) > 512) strong++;
        let ox = phase(xr, xi), oy = phase(yr, yi);
        const index = (gx + gy * columns) * 2;
        let ax = 0, ay = 0, neighbours = 0;
        if (gx) { ax += offsets[index - 2]; ay += offsets[index - 1]; neighbours++; }
        if (gy) { ax += offsets[index - columns * 2]; ay += offsets[index - columns * 2 + 1]; neighbours++; }
        // Fourier phase wraps every four pixels. Continue from neighbouring
        // windows rather than allowing a discontinuous four-pixel jump.
        if (neighbours) {
          ox += Math.round((ax / neighbours - ox) / BLOCK) * BLOCK;
          oy += Math.round((ay / neighbours - oy) / BLOCK) * BLOCK;
        }
        if (!Number.isFinite(ox + oy) || Math.max(Math.abs(ox), Math.abs(oy)) > 8) return null;
        offsets[index] = ox; offsets[index + 1] = oy;
      }
    }
    return strong >= columns * rows * 0.7 ? { columns, rows, step, offsets } : null;
  }

  function composePhotoPhase(previous, residual) {
    if (!previous) return residual;
    for (let y = 0; y < residual.rows; y++) for (let x = 0; x < residual.columns; x++) {
      const i = (x + y * residual.columns) * 2, rx = residual.offsets[i], ry = residual.offsets[i + 1];
      const prior = photoPhaseAt(previous, (x + 0.5) * residual.step + rx, (y + 0.5) * residual.step + ry);
      if (Math.max(Math.abs(rx + prior.x), Math.abs(ry + prior.y)) > 8) return null;
      residual.offsets[i] = rx + prior.x; residual.offsets[i + 1] = ry + prior.y;
    }
    return residual;
  }

  async function rectifyPhoto(pixels, width, height, nativeWidth, nativeHeight, matrix, signal, phaseCorrection) {
    // Each output pixel is on the original carrier lattice. A single homography
    // maps its footprint into the full capture; no triangles or preview resize.
    const out = new Uint8Array(nativeWidth * nativeHeight * 4), sum = new Float64Array(4);
    const curved = phaseCorrection?.kind === "spline", local = new Float64Array(12);
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
        let nx = Math.min(8, Math.max(1, Math.ceil(Math.hypot(matrix[0] - cx * matrix[6], matrix[3] - cy * matrix[6]) / Math.abs(d))));
        let ny = Math.min(8, Math.max(1, Math.ceil(Math.hypot(matrix[1] - cx * matrix[7], matrix[4] - cy * matrix[7]) / Math.abs(d))));
        let correction;
        if (curved) {
          root.PixelStowLattice.evaluate(phaseCorrection, x, y, local);
          correction = { x: local[0], y: local[1] };
          const qx = x + local[0], qy = y + local[1], divisor = matrix[6] * qx + matrix[7] * qy + matrix[8];
          const sx = (matrix[0] * qx + matrix[1] * qy + matrix[2]) / divisor;
          const sy = (matrix[3] * qx + matrix[4] * qy + matrix[5]) / divisor;
          const ax = (matrix[0] - sx * matrix[6]) / divisor, ay = (matrix[3] - sy * matrix[6]) / divisor;
          const bx = (matrix[1] - sx * matrix[7]) / divisor, by = (matrix[4] - sy * matrix[7]) / divisor;
          nx = Math.min(8, Math.max(1, Math.ceil(Math.hypot(ax * (1 + local[2]) + bx * local[4], ay * (1 + local[2]) + by * local[4]))));
          ny = Math.min(8, Math.max(1, Math.ceil(Math.hypot(ax * local[3] + bx * (1 + local[5]), ay * local[3] + by * (1 + local[5])))));
        } else correction = phaseCorrection ? photoPhaseAt(phaseCorrection, x, y) : { x: 0, y: 0 };
        sum.fill(0);
        for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
          const u = (ix + 0.5) / nx - 0.5, v = (iy + 0.5) / ny - 0.5;
          // A local quadratic expansion of the spline follows the curved pixel
          // footprint, including its Jacobian, without re-evaluating 16 controls
          // for every subpixel. The projective denominator remains continuous.
          const ox = curved ? local[0] + local[2] * u + local[3] * v + (local[6] * u * u + 2 * local[7] * u * v + local[8] * v * v) / 2 : correction.x;
          const oy = curved ? local[1] + local[4] * u + local[5] * v + (local[9] * u * u + 2 * local[10] * u * v + local[11] * v * v) / 2 : correction.y;
          const px = x + ox + u, py = y + oy + v;
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
      readResolution: { width: image.width, height: image.height, geometry: recovered.geometry, photoMatrix: h,
        phaseCorrection: image.phaseCorrection, channel: recovered.readChannel },
      readImage: { ...image, matrix: q } };
  }

  function photoMarkerAnchors(geometry, markers) {
    const inverse = root.PixelStowTransform.invert(geometry.matrix);
    const profile = locatorProfile(geometry.carrierVersion || CARRIER_V3);
    const layout = locatorLayout(geometry.originalWidth, geometry.originalHeight, profile.version);
    const maximum = Math.min(48, Math.max(geometry.originalWidth, geometry.originalHeight) * 0.04);
    return (markers || []).filter((m) => m.matrix && (m.verification === "header" ||
      m.verification === "pattern" && m.localized) && m.quality >= 0.6)
      .flatMap((m) => {
        const patch = layout.find((p) => p.id === m.id);
        if (!patch) return [];
        const cx = (profile.width - 1) / 2, cy = (profile.height - 1) / 2;
        const controls = [[cx, cy, 1]];
        // Independently refined axes give curvature information between marker
        // centres. A prediction-only pattern match supplies no measured slope.
        if (m.localized && m.quality >= 0.85) controls.push([cx * 0.35, cy, 0.25], [cx * 1.65, cy, 0.25],
          [cx, cy * 0.35, 0.25], [cx, cy * 1.65, 0.25]);
        return controls.flatMap(([u, v, weight]) => {
          const x = patch.x + u, y = patch.y + v, observed = mappedPoint(m.matrix, u, v);
          const predicted = mappedPoint(inverse, observed.x, observed.y);
          const dx = predicted.x - x, dy = predicted.y - y;
          return Number.isFinite(dx + dy) && Math.max(Math.abs(dx), Math.abs(dy)) <= maximum
            ? [{ x, y, dx, dy, markerId: m.id, control: weight < 1,
              weight: weight * m.quality ** 2 * (m.verification === "header" ? 1 : 0.75) }] : [];
        });
      });
  }

  async function readTrackedPhoto(pixels, width, height, geometry, signal, onProgress, markers, options, nativeGeometry, fast) {
    const anchors = photoMarkerAnchors(geometry, markers);
    if (!root.PixelStowLattice || new Set(anchors.map((a) => a.markerId)).size < 3) return null;
    const deadline = Math.min(options.deadline || Infinity, Date.now() + 8000);
    let previous;
    for (let pass = 0; pass < 2 && Date.now() < deadline; pass++) {
      const field = await root.PixelStowLattice.track(pixels, width, height, geometry, {
        signal, onProgress, deadline, anchors, previous, channel: pass ? 1 : undefined,
        reservations: reservedLocators(geometry.originalWidth, geometry.originalHeight, geometry.carrierVersion || CARRIER_V3)
      });
      if (!field) continue;
      onProgress?.("Sampling the original capture through the curved wavelet grid…");
      const corrected = await rectifyPhoto(pixels, width, height, geometry.originalWidth, geometry.originalHeight, geometry.matrix, signal, field);
      for (const channel of [undefined, 1, 0, 2]) {
        const retried = await readVisualMapping(corrected.pixels, corrected.width, corrected.height, nativeGeometry, signal, { ...fast, channel });
        if (!retried.locatorOnly) return photoReadResult(retried, { ...corrected, phaseCorrection: field }, geometry);
      }
      // Fourier phase is an estimate. Check small fractional shifts cheaply at
      // the repeated preamble before undertaking any full payload read.
      onProgress?.("Checking subpixel alignment of the tracked grid…");
      for (const channel of [undefined, 1]) {
        const retried = await readVisualMapping(corrected.pixels, corrected.width, corrected.height, nativeGeometry, signal,
          { ...fast, channel, offsets: [0, -0.25, 0.25] });
        if (!retried.locatorOnly) return photoReadResult(retried, { ...corrected, phaseCorrection: field }, geometry);
      }
      previous = field;
    }
    return null;
  }

  async function readPhotoMapping(pixels, width, height, geometry, signal, onProgress, markers, options = {}) {
    let image = await rectifyPhoto(pixels, width, height, geometry.originalWidth, geometry.originalHeight, geometry.matrix, signal);
    const nativeGeometry = geometryAt(geometry, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // A correct native grid needs one template. Avoid repeatedly decoding a
    // whole damaged compressed payload at every strength and nearby phase.
    const fast = { offsets: [0], strengths: [16] };
    let recovered = await readVisualMapping(image.pixels, image.width, image.height, nativeGeometry, signal, fast);
    if (recovered.locatorOnly) {
      let working = image, previous, tracked = false;
      // Residual phase can be measured again after the first correction. Every
      // reconstruction still samples the full original; no resampling cascade.
      for (let pass = 0; pass < 3; pass++) {
        onProgress?.("Refining the photographed pixel grid from its carrier pattern (" + (pass + 1) + "/3)…");
        const measured = await measurePhotoPhase(working, signal);
        const phaseCorrection = measured && composePhotoPhase(previous, measured);
        if (!phaseCorrection) {
          if (!previous) recovered = await readVisualMapping(image.pixels, image.width, image.height, nativeGeometry, signal);
          break;
        }
        const corrected = await rectifyPhoto(pixels, width, height, image.width, image.height, geometry.matrix, signal, phaseCorrection);
        // Screen/camera colour channels can have different interference. Keep
        // the colour raster intact and verify each alternate through the same CRC.
        for (const channel of [undefined, 1, 0, 2]) {
          const retried = await readVisualMapping(corrected.pixels, corrected.width, corrected.height, nativeGeometry, signal, { ...fast, channel });
          if (!retried.locatorOnly) {
            image = { ...corrected, phaseCorrection }; recovered = retried;
            return photoReadResult(recovered, image, geometry);
          }
        }
        // Try original-pixel tracking after the first inexpensive phase attempt.
        // Retain the remaining proven phase passes if a curved fit cannot verify.
        if (pass === 0) {
          tracked = true;
          const followed = await readTrackedPhoto(pixels, width, height, geometry, signal, onProgress, markers, options, nativeGeometry, fast);
          if (followed) return followed;
        }
        previous = phaseCorrection; working = corrected;
      }
      // If native reconstruction destroyed the usable phase, measure smaller,
      // oversampled windows directly in the original capture. Keep the proven
      // reader above and its successful fast path; no writer/format change.
      if (recovered.locatorOnly && !tracked) {
        const followed = await readTrackedPhoto(pixels, width, height, geometry, signal, onProgress, markers, options, nativeGeometry, fast);
        if (followed) return followed;
      }
    }
    return photoReadResult(recovered, image, geometry);
  }

  function retainVisualResult(pixels, width, height, result, workingImage) {
    if (!result) return;
    if (result.geometry) visualMappings.set(pixels, { width, height, geometry: result.geometry,
      readResolution: result.readResolution, carrierVersion: result.carrierVersion || result.markers?.[0]?.carrierVersion, workingImage });
    else if (result.unreadable) visualMappings.set(pixels, { width, height, unreadable: true,
      carrierVersion: result.carrierVersion || result.markers?.[0]?.carrierVersion });
  }

  function rankMarkerCandidates(candidates) {
    const sorted = candidates.slice().sort((a, b) => (b.geometry.rank || 0) - (a.geometry.rank || 0));
    const distinct = [];
    for (const candidate of sorted) {
      const g = candidate.geometry;
      if (distinct.some(({ geometry: other }) => other.originalWidth === g.originalWidth && other.originalHeight === g.originalHeight &&
        other.corners.every((p, i) => Math.hypot(p.x - g.corners[i].x, p.y - g.corners[i].y) < 0.5))) continue;
      distinct.push(candidate);
      if (distinct.length === 8) break;
    }
    return distinct;
  }

  function markerBasis(matrix, version = CARRIER_V3) {
    const p = locatorProfile(version);
    const centre = mappedPoint(matrix, p.width / 2, p.height / 2);
    const x = mappedPoint(matrix, p.width / 2 + 1, p.height / 2);
    const y = mappedPoint(matrix, p.width / 2, p.height / 2 + 1);
    return Math.min(Math.hypot(x.x - centre.x, x.y - centre.y), Math.hypot(y.x - centre.x, y.y - centre.y));
  }

  function nextMarkerScale(pending, samples, start, sizes, seed) {
    if (!samples.length) return pending.reduce((best, i) => Math.abs(i - start) < Math.abs(best - start) ? i : best, pending[0]);
    const best = samples.slice().sort((a, b) => b.score - a.score)[0];
    // Measured neighbours supply a warmer/colder slope. Weak pilot correlations
    // guide scheduling only: they never verify encoding or eliminate a branch.
    const priority = (index) => {
      const direction = Math.sign(index - best.index);
      const neighbour = samples.filter((s) => Math.sign(s.index - best.index) === direction)
        .sort((a, b) => Math.abs(a.index - best.index) - Math.abs(b.index - best.index))[0];
      const colder = neighbour && neighbour.score < best.score ? 2 : 0;
      const targetDivisor = seed ? markerBasis(seed.matrix, seed.carrierVersion) / 1.2 : sizes[best.index].divisor;
      const spacing = seed ? Math.abs(Math.log2(sizes[index].divisor / targetDivisor)) : Math.abs(index - best.index);
      return spacing + colder + (index < best.index ? 0.05 : 0);
    };
    return pending.reduce((bestIndex, index) => priority(index) < priority(bestIndex) ? index : bestIndex, pending[0]);
  }

  // Pure discovery: only locator symbols are read. No carrier preamble, body,
  // decompression or payload verification is performed by this operation.
  async function scanMarkers(pixels, width, height, options = {}) {
    options = recoveryOptions(options);
    options = { mode: "perspective", ...options };
    assertImage(pixels, width, height);
    checkCancelled(options.signal);
    if (canUseReaderWorker(options)) return searchInWorker(pixels, width, height, options, "markers");
    const native = await findLocator(pixels, width, height, true, false, options.signal, options);
    if (native) {
      const patch = locatorLayout(width, height, native.carrierVersion).find((p) => p.id === native.id);
      const seed = readVisualLocator(pixels, width, height, [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1], native.id, native.carrierVersion);
      const result = await findVisualTransform(pixels, width, height, { ...options, mode: "padding", seed,
        worker: false, geometryOnly: true });
      const candidates = rankMarkerCandidates((result.candidates || []).map((geometry) => ({ geometry, markers: result.markers, markerSearch: result.markerSearch })));
      return { ...result, candidates, geometry: candidates[0]?.geometry, highConfidence: Boolean(candidates[0]?.geometry.highConfidence), width, height };
    }
    if (options.nativeOnly) return { found: false, geometry: null, candidates: [], markers: [], width, height,
      reason: "No recovery marker headers were found on the native pixel grid." };
    if ((options.singleResolution || options.mode === "padding" || Math.max(width, height) < 640) && width * height <= MAX_PIXELS) {
      const result = await findVisualTransform(pixels, width, height, { ...options, worker: false, geometryOnly: true });
      const candidates = rankMarkerCandidates((result.candidates || []).map((geometry) => ({ geometry, markers: result.markers, markerSearch: result.markerSearch })));
      return { ...result, candidates, geometry: candidates[0]?.geometry, highConfidence: Boolean(candidates[0]?.geometry.highConfidence), width, height };
    }
    const deadline = Math.min(options.searchState?.deadline || Infinity, options.deadline || Infinity, Date.now() + 60000);
    let best = null, known = options.searchState?.seed || options.seed || null;
    let verifiedCurrent = Boolean(options.searchState?.seed);
    const candidates = [];
    // Start near a useful middle size. Marker agreement and measured spacing
    // choose the next level; both directions remain available after a weak miss.
    // Every working image comes directly from the original, never a resize chain.
    const sizes = [16, 8, 4, 2, 1].map((divisor) => ({ divisor,
      width: Math.round(width / divisor), height: Math.round(height / divisor) }))
      .filter((size, i, all) => (width * height <= MAX_PIXELS || size.width * size.height <= MAX_MARKER_PIXELS) &&
        (size.divisor === 1 || size.width >= 128 && size.height >= 96) &&
        all.findIndex((s) => s.width === size.width && s.height === size.height) === i);
    const startDivisor = known ? markerBasis(known.matrix, known.carrierVersion) / 1.2 : Math.max(width, height) / 1000;
    const start = sizes.reduce((best, size, i) => Math.abs(Math.log2(size.divisor / startDivisor)) <
      Math.abs(Math.log2(sizes[best].divisor / startDivisor)) ? i : best, 0);
    const pending = options.searchState?.pending.slice() || sizes.map((_, i) => i);
    const samples = options.searchState?.samples.slice() || [];
    while (pending.length) {
      if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      if (Date.now() >= deadline) {
        best = { ...(best || { found: false }), reason: "Marker discovery reached its search time limit. Retry image recovery if needed." };
        break;
      }
      const index = nextMarkerScale(pending, samples, start, sizes, known);
      pending.splice(pending.indexOf(index), 1);
      const { width: rw, height: rh, divisor } = sizes[index], full = divisor === 1;
      const label = (full ? "Full size" : "1/" + divisor + " size") + " (" + rw + " × " + rh + ")";
      options.onProgress?.("Locating photo markers: " + label + "…");
      const corners = options.corners?.map((p) => ({ x: (p.x + 0.5) * rw / width - 0.5, y: (p.y + 0.5) * rh / height - 0.5 }));
      const scaleMatrix = (h) => [(rw / width) * h[0] + (rw / width - 1) / 2 * h[6],
        (rw / width) * h[1] + (rw / width - 1) / 2 * h[7], (rw / width) * h[2] + (rw / width - 1) / 2 * h[8],
        (rh / height) * h[3] + (rh / height - 1) / 2 * h[6], (rh / height) * h[4] + (rh / height - 1) / 2 * h[7],
        (rh / height) * h[5] + (rh / height - 1) / 2 * h[8], h[6], h[7], h[8]];
      const seed = known ? { ...known, matrix: scaleMatrix(known.matrix),
        initialMatrix: known.initialMatrix && scaleMatrix(known.initialMatrix) } : undefined;
      // Dimensions from a verified header reveal the actual symbol spacing.
      // Avoid levels that put this patch outside the local detector's range.
      if (seed && verifiedCurrent) {
        const basis = markerBasis(seed.matrix, seed.carrierVersion);
        if (basis > 3 || basis < 0.4) continue;
      }
      const image = full ? { pixels, width, height } : await reducePhoto(pixels, width, height, rw, rh, options.signal);
      const remaining = deadline - Date.now();
      const seedBudget = Math.max(1500, remaining / Math.min(3, pending.length + 1));
      const result = await findVisualTransform(image.pixels, rw, rh, { ...options, corners, seed, singleResolution: true,
        worker: false, geometryOnly: true, deadline,
        seedDeadline: Math.min(deadline, Date.now() + seedBudget),
        onProgress: (text) => options.onProgress?.(label + ": " + text) });
      const lifted = full ? result : liftPhotoResult(result, width, height, rw, rh);
      const header = lifted.markers?.filter((m) => m.verification === "header").sort((a, b) => b.quality - a.quality)[0];
      if (header) { known = { ...header, initialMatrix: lifted.geometry?.matrix || header.initialMatrix }; verifiedCurrent = true; }
      for (const geometry of lifted.candidates || []) candidates.push({ geometry, markers: lifted.markers, markerSearch: lifted.markerSearch,
        localizationResolution: { width: rw, height: rh }, photo: true });
      const markerScore = lifted.geometry?.rank ?? (lifted.markers?.length ? 30 + lifted.markers.length * 3 :
        Math.min(20, 20 * Math.max(0, lifted.evidence?.pilotQuality || 0)));
      samples.push({ index, score: markerScore });
      const rank = (r) => (r?.geometry ? 16 : 0) + (r?.markers?.length || 0);
      if (!best || rank(lifted) >= rank(best)) best = lifted;
      if (options.stopOnHighConfidence !== false && lifted.geometry?.highConfidence) {
        options.onProgress?.("The corner geometry agrees strongly. Reading the most promising pixel grid…");
        break;
      }
    }
    const ranked = rankMarkerCandidates(candidates);
    return { ...best, width, height, candidates: ranked, geometry: ranked[0]?.geometry,
      highConfidence: Boolean(ranked[0]?.geometry.highConfidence),
      searchState: { pending, samples, seed: verifiedCurrent ? known : undefined, deadline },
      markers: ranked[0]?.markers || best?.markers || [], markerSearch: ranked[0]?.markerSearch || best?.markerSearch };
  }

  async function analyzeNativeMarkers(pixels, width, height, version = CARRIER_V5) {
    assertImage(pixels, width, height);
    const profile = locatorProfile(version), layout = profile && locatorLayout(width, height, version);
    if (!layout || !locatorFits(width, height, version)) return { found: false, markers: [], geometry: null };
    await yieldNow();
    const expectedMarkers = layout.map(patch => ({ id: patch.id, patchWidth: profile.width, patchHeight: profile.height,
      matrix: [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1] }));
    const markers = expectedMarkers.map(patch => readVisualLocator(pixels, width, height, patch.matrix, patch.id, version))
      .filter(marker => marker && marker.originalWidth === width && marker.originalHeight === height);
    const matrix = [1,0,0,0,1,0,0,0,1];
    const expectedReferenceMarkers = version === CARRIER_V5 ? referenceLayout(width, height).map(patch => ({
      id: patch.id, patchWidth: 24, patchHeight: 16, matrix: patchTransform(matrix, patch)
    })) : [];
    const referenceMarkers = markers.length && version === CARRIER_V5 ? checkReferences(pixels, width, height, matrix,
      { originalWidth: width, originalHeight: height }, true) : [];
    return { found: Boolean(markers.length), markers, geometry: markers.length ? {
      carrierVersion: version, model: "native", matrix, originalWidth: width, originalHeight: height,
      corners: [{x:0,y:0},{x:width-1,y:0},{x:width-1,y:height-1},{x:0,y:height-1}],
      expectedMarkers, patchWidth: profile.width, patchHeight: profile.height, markerCount: markers.length,
      markerTotal: profile.ids.length, headerCount: markers.length, patternCount: 0, inlierCount: markers.length, fitError: 0,
      referenceMarkers, referenceCount: referenceMarkers.length, expectedReferenceMarkers
    } : null };
  }

  async function readMarkerCandidates(pixels, width, height, scan, options = {}) {
    options = recoveryOptions(options);
    assertImage(pixels, width, height);
    checkCancelled(options.signal);
    // A scan is tied to one raster. Camera buffers must never use a previous
    // frame's geometry as if it had been measured in the newly captured pixels.
    if (!scan || scan.width !== width || scan.height !== height) throw new Error("The marker scan does not match this image.");
    if (canUseReaderWorker(options)) {
      const result = await searchInWorker(pixels, width, height, { ...options, scan }, "read-candidates");
      checkCancelled(options.signal);
      retainVisualResult(pixels, width, height, result);
      return result;
    }
    const selected = recoveryVersions(options);
    const candidates = rankMarkerCandidates((scan.candidates || []).filter((c) => selected.includes(c.geometry.carrierVersion || CARRIER_V3)));
    const markers = (scan.markers || []).filter((m) => selected.includes(m.carrierVersion || scan.geometry?.carrierVersion || CARRIER_V3));
    let best = { found: Boolean(markers.length), unreadable: Boolean(markers.length),
      markers, markerSearch: scan.markerSearch, signature: scan.signature, reason: scan.reason };
    for (let i = 0; i < candidates.length; i++) {
      checkCancelled(options.signal);
      const candidate = candidates[i], geometry = candidate.geometry;
      options.onProgress?.("Reading ranked candidate " + (i + 1) + "/" + candidates.length +
        " (" + geometry.inlierCount + "/" + geometry.markerTotal + " aligned markers)…");
      let recovered = candidate.photo
        ? await readPhotoMapping(pixels, width, height, geometry, options.signal, options.onProgress, candidate.markers, options)
        : await readVisualMapping(pixels, width, height, geometry, options.signal);
      if (!candidate.photo && recovered.locatorOnly && geometry.model !== "translation")
        recovered = await readPhotoMapping(pixels, width, height, geometry, options.signal, options.onProgress, candidate.markers, options);
      checkCancelled(options.signal);
      const inspection = describeRecovery(recovered);
      const result = { ...inspection, found: true, unreadable: Boolean(recovered.locatorOnly) || !inspection.found,
        carrierVersion: geometry.carrierVersion || CARRIER_V3, geometry: recovered.geometry, readResolution: recovered.readResolution,
        markers: candidate.markers, markerSearch: candidate.markerSearch || scan.markerSearch, signature: scan.signature,
        reason: inspection.found && !recovered.locatorOnly ? undefined : "Recovery markers were found, but the payload did not pass its checks." };
      if (!result.unreadable) {
        retainVisualResult(pixels, width, height, result, recovered.readImage);
        return result;
      }
      if (i === 0) best = result;
    }
    // Live scans can stop on a high-confidence fit before visiting every scale.
    // If its body fails, keep this exact frame and use the remaining scales,
    // just as ordinary file recovery does. Never borrow the next frame's pixels.
    if (options.resumeDiscovery && scan.searchState?.pending.length) {
      const deadline = options.deadline || Date.now() + 60000;
      if (Date.now() < deadline) {
        options.onProgress?.("The marker fit did not decode. Checking the remaining scales of this capture…");
        const remaining = await scanMarkers(pixels, width, height, { ...options,
          searchState: { ...scan.searchState, deadline }, deadline, stopOnHighConfidence: false });
        checkCancelled(options.signal);
        const retried = await readMarkerCandidates(pixels, width, height, remaining, { ...options, resumeDiscovery: false });
        if (retried.found && !retried.unreadable || (retried.markers?.length || 0) > (best.markers?.length || 0)) return retried;
      }
    }
    retainVisualResult(pixels, width, height, best);
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

  function cleanLocators(pixels, width, height, output, version = CARRIER_V3) {
    if (version !== CARRIER_V3) return cleanBlendedLocators(pixels, width, height, output, version);
    const profile = locatorProfile(version);
    const { order: locatorOrder, columns: LOCATOR_COLUMNS, cell: LOCATOR_CELL } = profile;
    for (const patch of locatorLayout(width, height, version)) {
      const header = locatorHeader(width, height, patch.id, version);
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

  function cleanBlendedLocators(pixels, width, height, output, version) {
    const profile = locatorProfile(version);
    const patches = locatorLayout(width, height, version).concat(version === CARRIER_V5 ? referenceLayout(width, height) : []);
    for (const patch of patches) {
      const main = profile.ids.includes(patch.id), p = main ? profile : referenceProfile();
      const header = locatorHeader(width, height, patch.id, version);
      for (let slot = 0; slot < p.order.length; slot++) {
        const cell = p.order[slot], coded = slot % (main ? 96 : 24);
        const bit = WORD_BITS[header[Math.floor(coded / 12)] * 12 + coded % 12], kernel = p.kernels[bit];
        const x = patch.x + cell % p.columns * p.cell, y = patch.y + Math.floor(cell / p.columns) * p.cell;
        let projection = 0, energy = 0;
        for (let i = 0; i < kernel.length; i++) {
          const index = (x + i % p.cell + (y + Math.floor(i / p.cell)) * width) * 4;
          projection += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3 * kernel[i];
          energy += kernel[i] ** 2;
        }
        const maximum = (version === CARRIER_V4 ? V4_MARKER_PEAK / 16 : V5_MARKER_PEAK / 16) * blendedLocatorGain(version, p, cell, main);
        const amount = Math.max(0, Math.min(maximum, projection / energy));
        for (let i = 0; i < kernel.length; i++) {
          const index = (x + i % p.cell + (y + Math.floor(i / p.cell)) * width) * 4;
          for (let c = 0; c < 3; c++) output[index + c] = clampChannel(pixels[index + c] - amount * kernel[i]);
        }
      }
    }
  }

  async function writeSignal(reference, image, width, height, framed, strength, version, map = null, signalPolicy = null) {
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
    // V5's CRC-protected carrier header stores uniform headroom in two-level
    // increments. This changes no payload frame, password or marker header.
    const flags = FLAGS | (parityBits === 1 ? ONE_PARITY : 0) |
      (version === CARRIER_V5 ? ((signalPolicy?.linearHeadroom || 0) / 2) << 2 : 0);
    const bytes = new Uint8Array(9);
    bytes[0] = MAGIC;
    bytes[1] = locatorProfile(version) ? version : CARRIER_V1;
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
    }, strength, amplitudeCache, signalPolicy);
    const payloadOrder = scatterOrder(payloadBlocks, SEED);
    const payloadSlots = new Uint32Array(payloadBlocks);
    for (let slot = 0; slot < payloadBlocks; slot++) {
      const block = PREAMBLE_BLOCKS + payloadOrder[slot];
      payloadSlots[slot] = map ? map[block] : block;
    }
    await writeBits(reference, image, width, columns, payloadSlots, (slot) => codedBit(framed, slot % (framed.length * bitsPerByte), bitsPerByte), strength, amplitudeCache, signalPolicy);
    return {
      ...repetitionBudget(payloadBlocks, framed.length, bitsPerByte)
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

  function decodeSoftRange(scores, output, first, last) {
    let corrections = 0;
    for (let byteIndex = first; byteIndex < last; byteIndex++) {
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
    return corrections;
  }

  function decodeSoft(scores, byteCount) {
    const bytes = new Uint8Array(byteCount);
    return { bytes, corrections: decodeSoftRange(scores, bytes, 0, byteCount) };
  }

  async function decodeSoftPayload(scores, byteCount, signal) {
    const bytes = new Uint8Array(byteCount);
    let corrections = 0;
    for (let first = 0; first < byteCount; first += 1024) {
      if (first) await yieldNow();
      checkCancelled(signal);
      corrections += decodeSoftRange(scores, bytes, first, Math.min(byteCount, first + 1024));
    }
    return { bytes, corrections };
  }

  async function readFramedScores(scores, signal) {
    checkCancelled(signal);
    const preamble = tryReadPreamble(scores);
    if (!preamble) throw frameError("The image does not contain a matching carrier header.");
    if ((preamble.version !== CARRIER_V1 && !locatorProfile(preamble.version)) ||
      preamble.framedLength < HEADER || preamble.framedLength > MAX_FRAMED) {
      throw frameError("Unsupported image carrier.");
    }
    const allowed = preamble.version === CARRIER_V5 ? (ONE_PARITY | 0xfc) : ONE_PARITY;
    if ((preamble.flags & ~allowed) !== FLAGS) throw frameError("The carrier flags do not match this profile.");
    const rangeHeadroom = preamble.version === CARRIER_V5 ? (preamble.flags >>> 2) * 2 : 0;
    if (rangeHeadroom > 62) throw frameError("Unsupported carrier range adjustment.");
    const bitsPerByte = (preamble.flags & ONE_PARITY) !== 0 ? 9 : 12;
    const payloadBlocks = scores.length - PREAMBLE_BLOCKS;
    const codedBits = preamble.framedLength * bitsPerByte;
    if (payloadBlocks < codedBits) throw frameError("The image does not hold a complete copy of the payload.");
    const order = scatterOrder(payloadBlocks, SEED);
    const combined = combineScores(scores.subarray(PREAMBLE_BLOCKS), order, codedBits);
    const decoded = bitsPerByte === 12
      ? await decodeSoftPayload(combined, preamble.framedLength, signal)
      : decodeOneParity(combined, preamble.framedLength);
    checkCancelled(signal);
    return {
      bytes: decoded.bytes,
      corrections: decoded.corrections,
      ...repetitionBudget(payloadBlocks, preamble.framedLength, bitsPerByte),
      carrierVersion: preamble.version,
      rangeHeadroom
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

  async function scoreBlocks(pixels, width, columns, rows, difference, common, signal) {
    checkCancelled(signal);
    let differenceEnergy = 0;
    for (let i = 0; i < 16; i++) differenceEnergy += difference[i] * difference[i];
    const scores = new Int32Array(columns * rows);
    const bounded = new Int32Array(scores.length);
    const block = new Float64Array(16);
    for (let row = 0; row < rows; row++) {
      if ((row & 15) === 15) { await yieldNow(); checkCancelled(signal); }
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

  async function tryLayout(scores, signal) {
    try {
      const framed = await readFramedScores(scores, signal);
      const unpacked = await unpackFrame(framed.bytes);
      checkCancelled(signal);
      return {
        payload: unpacked.payload,
        strength: unpacked.strength,
        corrections: framed.corrections,
        copies: framed.copies,
        parityBits: framed.parityBits,
        repetitionRatio: framed.repetitionRatio,
        framedBytes: framed.framedBytes,
        passwordProtected: unpacked.passwordProtected,
        bundle: unpacked.bundle,
        formatVersion: unpacked.formatVersion,
        carrierVersion: framed.carrierVersion,
        rangeHeadroom: framed.rangeHeadroom
      };
    } catch (error) {
      if (error && error.code === "frame") return null;
      throw error;
    }
  }

  async function tryReadAt(pixels, width, height, strength, signal) {
    const columns = Math.floor(width / BLOCK);
    const rows = Math.floor(height / BLOCK);
    const blockCount = columns * rows;
    if (blockCount <= PREAMBLE_BLOCKS || blockCount > MAX_BLOCKS) return null;
    strength = Math.max(1, Math.min(32, strength | 0));
    const shapes = buildShapes(strength);
    const scored = await scoreBlocks(pixels, width, columns, rows, shapes.difference, shapes.common, signal);
    return (await tryLayout(scored.scores, signal)) || (await tryLayout(scored.bounded, signal));
  }

  async function readNative(pixels, width, height, version, strength, signal, map) {
    checkCancelled(signal);
    if (!pixels || width < BLOCK || height < BLOCK || pixels.length !== width * height * 4) return null;
    if (width * height > MAX_PIXELS) return null;
    if (locatorProfile(version) && !locatorFits(width, height, version)) return null;
    const preambleMap = locatorProfile(version)
      ? (map ? map.subarray(0, PREAMBLE_BLOCKS) : locatorBlockMap(width, height, PREAMBLE_BLOCKS, version))
      : Uint32Array.from({ length: PREAMBLE_BLOCKS }, (_, i) => i);
    if (Math.floor(width / BLOCK) * Math.floor(height / BLOCK) <= PREAMBLE_BLOCKS || preambleMap.length < PREAMBLE_BLOCKS) return null;
    // Generated files already have a known pixel lattice. Check that carrier's
    // repeated header directly, without requiring a marker fit or resize search.
    // Only allocate/score the entire payload map after the header has passed CRC.
    // The writer can reduce amplitude per block to avoid clipping. Start with
    // its nominal strength, then retain the original reader's other templates.
    const amplitudes = strength ? [strength, ...STRENGTHS.filter((value) => value !== strength)] : STRENGTHS;
    for (const amplitude of amplitudes) {
      const probe = await scoreMapped(pixels, width, height, preambleMap, width, amplitude, null, PREAMBLE_BLOCKS, signal);
      const preamble = tryReadPreamble(probe.scores) || tryReadPreamble(probe.bounded);
      if (!preamble || preamble.version !== version) continue;
      let found;
      if (locatorProfile(version)) {
        map ||= locatorBlockMap(width, height, Infinity, version);
        const scored = await scoreMapped(pixels, width, height, map, width, amplitude, null, map.length, signal);
        found = (await tryLayout(scored.scores, signal)) || (await tryLayout(scored.bounded, signal));
      } else found = await tryReadAt(pixels, width, height, amplitude, signal);
      if (found?.carrierVersion === version) return { ...found, origWidth: width, origHeight: height,
        scaleX: 1, scaleY: 1, phaseX: 0, phaseY: 0 };
    }
    return null;
  }

  async function recover(pixels, width, height, options = {}) {
    options = recoveryOptions(options);
    checkCancelled(options.signal);
    if (!pixels || pixels.length !== width * height * 4 || width < BLOCK || height < BLOCK) return null;
    if (width * height > MAX_INPUT_PIXELS) throw new Error("This photo exceeds the 32 megapixel input limit.");
    const versions = recoveryVersions(options);
    if (options.nativeOnly) {
      for (const version of versions) {
        const found = await readNative(pixels, width, height, version, options.strength, options.signal);
        if (found) return found;
      }
      return null;
    }
    const visual = visualMappings.get(pixels);
    if (visual && visual.width === width && visual.height === height &&
      versions.includes(visual.carrierVersion || visual.geometry?.carrierVersion || CARRIER_V3)) {
      if (visual.unreadable) return { locatorOnly: true, carrierVersion: visual.carrierVersion || visual.geometry?.carrierVersion || CARRIER_V3 };
      if (visual.readResolution) {
        const resolution = visual.readResolution;
        const image = visual.workingImage || { ...await rectifyPhoto(pixels, width, height, resolution.width, resolution.height,
          resolution.photoMatrix, options.signal, resolution.phaseCorrection), phaseCorrection: resolution.phaseCorrection };
        visual.workingImage = image;
        const recovered = await readVisualMapping(image.pixels, image.width, image.height, resolution.geometry, options.signal, { channel: resolution.channel });
        return photoReadResult(recovered, image, geometryAt(visual.geometry, resolution.photoMatrix));
      }
      return readVisualMapping(pixels, width, height, visual.geometry, options.signal);
    }
    for (const version of versions) {
      const direct = await readNative(pixels, width, height, version, undefined, options.signal);
      if (direct) return direct;
    }
    const native = await findLocator(pixels, width, height, true, false, options.signal, options);
    if (native) {
      const found = await readMapped(pixels, width, height, native, true, options.signal);
      if (!found.locatorOnly) return found;
      return readMapped(pixels, width, height, native, false, options.signal);
    }
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    options.onProgress?.("Checking common image resize ratios…");
    const locator = await findLocator(pixels, width, height, false, options.quickOnly, options.signal, options);
    return locator ? readMapped(pixels, width, height, locator, false, options.signal) : null;
  }

  function describeRecovery(recovery) {
    if (!recovery) return { found: false };
    if (recovery.locatorOnly) return { found: true, unreadable: true, carrierVersion: recovery.carrierVersion || CARRIER_V3, geometry: recovery.geometry };
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
      strength: recovery.strength,
      repetitionRatio: recovery.repetitionRatio,
      copies: recovery.copies,
      parityBits: recovery.parityBits,
      framedBytes: recovery.framedBytes
    };
  }

  async function inspect(pixels, width, height, options = {}) {
    options = recoveryOptions(options);
    assertImage(pixels, width, height);
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    // Ordinary file imports retain the cheap direct reader. Camera discovery
    // uses scanMarkers instead, and reads only the ranked retained captures.
    if (options.background && canUseReaderWorker(options)) {
      const result = await searchInWorker(pixels, width, height, options, "inspect");
      if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      retainVisualResult(pixels, width, height, result);
      return result;
    }
    options.onProgress?.("Reading the image at its original size…");
    const recovery = await recover(pixels, width, height, { ...options, quickOnly: options.quickOnly || options.automatic === true });
    if (options.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    const direct = describeRecovery(recovery);
    if (options.nativeOnly || !options.automatic || (direct.found && !direct.unreadable)) return direct;
    // One perspective search also retains translation/affine estimates. Running
    // the three manual modes in sequence would repeat the FFT and seed searches.
    options.onProgress?.("Looking for encoded contents in a resized, padded or photographed image…");
    const transformed = await findVisualTransform(pixels, width, height, { ...options, mode: "perspective" });
    if (transformed.found || !direct.found) return transformed;
    // A weak spectral signature must not erase a checksum-valid native marker.
    return { ...transformed, ...direct };
  }

  async function decode(pixels, width, height, password, options = {}) {
    const recovery = await recover(pixels, width, height, options);
    checkCancelled(options.signal);
    if (!recovery) return { status: "none" };
    if (recovery.locatorOnly) return { status: "markers", carrierVersion: recovery.carrierVersion || CARRIER_V3, geometry: recovery.geometry, scaleX: recovery.scaleX, scaleY: recovery.scaleY };
    if (recovery.passwordProtected && !password) {
      return { status: "password", strength: recovery.strength, repetitionRatio: recovery.repetitionRatio,
        copies: recovery.copies, parityBits: recovery.parityBits, framedBytes: recovery.framedBytes };
    }
    try {
      const textBytes = recovery.passwordProtected
        ? await decryptEnvelope(recovery.payload, password, recovery.bundle)
        : recovery.payload;
      try {
        checkCancelled(options.signal);
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
          strength: recovery.strength,
          rangeHeadroom: recovery.rangeHeadroom,
          repetitionRatio: recovery.repetitionRatio,
          copies: recovery.copies,
          parityBits: recovery.parityBits,
          framedBytes: recovery.framedBytes
        };
      } finally { textBytes.fill(0); }
    } catch (error) {
      if (error && error.code === "incorrect") return { status: "incorrect" };
      if (error && error.code === "frame") return { status: "none" };
      throw error;
    }
  }

  async function encodeAt(reference, width, height, payload, passwordProtected, strength, adaptive, bundle, carrierVersion, quality = DEFAULT_QUALITY) {
    strength = Math.max(1, Math.min(32, strength));
    const version = locatorProfile(carrierVersion) ? carrierVersion : CARRIER_V1;
    const map = locatorProfile(version) ? locatorBlockMap(width, height, Infinity, version) : null;
    const probe = await packFrame(payload, 8, passwordProtected, bundle);
    const columns = Math.floor(width / BLOCK);
    const blockCount = map ? map.length : columns * Math.floor(height / BLOCK);
    let signalPolicy = null;
    if (adaptive || version === CARRIER_V4 || version === CARRIER_V5) {
      const available = blockCount - PREAMBLE_BLOCKS;
      let bitsPerByte = 0;
      if (probe.length * 12 <= available) bitsPerByte = 12;
      else if (probe.length * 9 <= available) bitsPerByte = 9;
      if (available <= 0 || bitsPerByte === 0) {
        throw new Error("The framed payload needs " + probe.length.toLocaleString("en-GB") + " bytes, but this image holds " +
          Math.max(0, Math.floor(available / 9)).toLocaleString("en-GB") + ". Use a larger picture, smaller files or a shorter recording.");
      }
      if (version === CARRIER_V4 || version === CARRIER_V5) {
        signalPolicy = qualitySignalPolicy(v4SignalPolicy(available / (probe.length * bitsPerByte), strength), quality);
        signalPolicy.strength = Math.max(strength, signalPolicy.strength);
        strength = signalPolicy.strength;
      } else {
        const copies = Math.max(1, Math.floor(available / (probe.length * bitsPerByte)));
        const multiplier = copies >= 4 ? 1 : copies === 3 ? 1.5 : copies === 2 ? 2 : 4;
        strength = Math.min(32, Math.max(strength, roundHalfToEven(strength * multiplier)));
      }
    }
    const framed = await packFrame(payload, strength, passwordProtected, bundle);
    let signalSource = reference;
    if (version === CARRIER_V5) {
      const headroom = Math.min(62, 2 * Math.ceil((Math.max(12, strength) * 19 / 16 + signalPolicy.biasLimit) / 2));
      signalSource = linearRange(reference, headroom);
      signalPolicy = { ...signalPolicy, linearHeadroom: headroom, textureSource: reference };
    }
    const output = signalSource.slice();
    const written = await writeSignal(signalSource, output, width, height, framed, strength, version, map, signalPolicy);
    if (map) paintLocators(signalSource, output, width, height, strength, version, signalPolicy);
    return {
      pixels: output,
      strength,
      copies: written.copies,
      parityBits: written.parityBits,
      repetitionRatio: written.repetitionRatio,
      framedBytes: written.framedBytes,
      passwordProtected,
      carrierVersion: version,
      rangeHeadroom: signalPolicy?.linearHeadroom || 0,
      map
    };
  }

  async function encode(pixels, width, height, text, password, options = {}) {
    return encodePayload(pixels, width, height, { text, attachments: [] }, password, options);
  }

  async function encodePayload(pixels, width, height, content, password, options = {}) {
    const quality = encodingQuality(options.quality);
    const { text = "", attachments = [] } = content;
    const bundle = attachments.length > 0;
    const plain = bundle ? packBundle(text, attachments) : strictUtf8(text);
    if (!bundle && (plain.length < 1 || plain.length > MAX_TEXT)) {
      throw new Error(plain.length < 1 ? "Enter a message or add an attachment to encode." : "The message is longer than 16 KiB.");
    }
    try {
      assertImage(pixels, width, height, MAX_PIXELS);
      await yieldNow();
      // Input protection is independent of the user's active recovery formats.
      // A locked/native older fingerprint must still never be encoded again.
      const existing = await inspect(pixels, width, height, { quickOnly: true, includeLegacy: true });
      if (existing.found) {
        throw new Error("This image already contains a fingerprint. Choose a picture that does not have one.");
      }
      const locked = typeof password === "string" && password.length > 0;
      const wantLocators = Boolean(locatorProfile(preferredCarrier));
      if (preferredCarrier === CARRIER_V5 && !locatorFits(width, height, preferredCarrier))
        throw new Error("This picture is too small for version 5 recovery markers. Use a larger picture or select an older encoding format explicitly.");
      const usedVersion = wantLocators && locatorFits(width, height, preferredCarrier) ? preferredCarrier : CARRIER_V1;
      const payload = locked ? await encryptEnvelope(plain, password, bundle) : plain.slice();
      try {
        let encoded = await encodeAt(pixels, width, height, payload, locked, STRENGTHS[0], true, bundle, usedVersion, quality);
        for (;;) {
          const recovery = await readNative(encoded.pixels, width, height, usedVersion, encoded.strength, undefined, encoded.map);
          if (recovery && !recovery.locatorOnly && recovery.carrierVersion === usedVersion &&
            recovery.bundle === bundle && recovery.passwordProtected === locked && bytesEqual(recovery.payload, payload)) {
            return {
              pixels: encoded.pixels,
              width,
              height,
              strength: encoded.strength,
              copies: encoded.copies,
              parityBits: encoded.parityBits,
              repetitionRatio: encoded.repetitionRatio,
              framedBytes: encoded.framedBytes,
              passwordProtected: locked,
              carrierVersion: usedVersion,
              rangeHeadroom: encoded.rangeHeadroom,
              quality,
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
          encoded = await encodeAt(pixels, width, height, payload, locked, next, false, bundle, usedVersion, quality);
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
    if (width * height > MAX_INPUT_PIXELS) throw new Error("This photo exceeds the 32 megapixel input limit.");
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
      if (bitmap.width * bitmap.height > MAX_INPUT_PIXELS) throw new Error("This photo exceeds the 32 megapixel input limit.");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = Math.min(bitmap.height, 256);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const pixels = new Uint8Array(bitmap.width * bitmap.height * 4);
      try {
        // Decode at 1:1 in strips. A camera photo need not fit in a giant canvas,
        // and no resizing is applied to the pixels used by the reader.
        for (let y = 0; y < bitmap.height; y += canvas.height) {
          const rows = Math.min(canvas.height, bitmap.height - y);
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, y, bitmap.width, rows, 0, 0, bitmap.width, rows);
          pixels.set(context.getImageData(0, 0, bitmap.width, rows).data, y * bitmap.width * 4);
          await yieldNow();
        }
        return { pixels, width: bitmap.width, height: bitmap.height, exact: false };
      } finally { canvas.width = canvas.height = 0; }
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

  async function forwardSample(source, sourceW, sourceH, pixels, width, height, fit, signal) {
    const out = pixels.slice();
    const inverse = fit.matrix ? root.PixelStowTransform.invert(fit.matrix) : null;
    const correction = fit.readResolution?.phaseCorrection;
    const photoInverse = correction ? root.PixelStowTransform.invert(fit.readResolution.photoMatrix) : null;
    const readInverse = correction ? root.PixelStowTransform.invert(fit.readImage.matrix) : null;
    const curvedInverse = correction?.kind === "spline" ? await root.PixelStowLattice.inverse(correction, signal) : null;
    for (let y = 0; y < height; y++) {
      if ((y & 15) === 15) { checkCancelled(signal); await yieldNow(); }
      const originY = inverse ? 0 : (y - fit.phaseY) / fit.scaleY;
      for (let x = 0; x < width; x++) {
        let point = inverse ? mappedPoint(inverse, x, y) : { x: (x - fit.phaseX) / fit.scaleX, y: originY };
        if (correction) {
          const observed = mappedPoint(photoInverse, x, y);
          let native = curvedInverse ? root.PixelStowLattice.inverseAt(curvedInverse, observed.x, observed.y) : observed;
          if (!curvedInverse) for (let iteration = 0; iteration < 3; iteration++) {
            const delta = photoPhaseAt(correction, native.x, native.y);
            native = { x: observed.x - delta.x, y: observed.y - delta.y };
          }
          point = mappedPoint(readInverse, native.x, native.y);
        }
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

  async function extractCarrier(pixels, width, height, strength, options = {}) {
    checkCancelled(options.signal);
    if (options.background && canUseReaderWorker(options)) {
      const saved = visualMappings.get(pixels);
      // Preserve the verified photo transform without copying its cached working
      // raster. The disposable worker reconstructs it from the full input copy.
      const visual = saved ? { width, height, geometry: saved.geometry, carrierVersion: saved.carrierVersion,
        readResolution: saved.readResolution, unreadable: saved.unreadable } : undefined;
      return searchInWorker(pixels, width, height, { ...options, strength, visual }, "extract-carrier");
    }
    if (options.visual) visualMappings.set(pixels, options.visual);
    const fit = await recover(pixels, width, height, options);
    if (!fit || fit.locatorOnly || !locatorProfile(fit.carrierVersion)) return extractBlind(pixels, width, height, strength);
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
    let cleaned = await extractBlind(restored, origW, origH, fit.strength, locatorBlockMap(origW, origH, Infinity, fit.carrierVersion),
      fit.carrierVersion === CARRIER_V4 || fit.carrierVersion === CARRIER_V5 ? V4_PAYLOAD_PEAK : fit.strength);
    cleanLocators(restored, origW, origH, cleaned, fit.carrierVersion);
    if (fit.rangeHeadroom) cleaned = linearRange(cleaned, fit.rangeHeadroom, true);
    if (identity) return cleaned;
    return forwardSample(cleaned, origW, origH, pixels, width, height, fit, options.signal);
  }

  async function extractBlind(pixels, width, height, strength, map = null, peakStrength = strength) {
    assertImage(pixels, width, height);
    strength = Math.max(1, Math.min(32, strength | 0));
    const maximum = Math.max(1, peakStrength / strength);
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
        marker = clampRange(marker / commonEnergy, 0, maximum);
        bit = clampRange(bit / differenceEnergy, -maximum / 2, maximum / 2);
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
    estimateRepetition,
    estimatePayloadFrame,
    repetitionForFrame,
    estimateSignalGain,
    payloadsEqual,
    inspect,
    decode,
    encode,
    encodePayload,
    extractCarrier,
    findVisualTransform,
    scanMarkers,
    analyzeNativeMarkers,
    readMarkerCandidates,
    clearVisualTransform(pixels) { visualMappings.delete(pixels); },
    setCarrierVersion(version) { preferredCarrier = [CARRIER_V1, ...RECOVERY_CARRIERS].includes(version) ? version : CARRIER_V5; },
    getCarrierVersion() { return preferredCarrier; },
    setLegacyRecovery(enabled) { legacyRecovery = enabled === true; },
    getLegacyRecovery() { return legacyRecovery; },
    getRecoveryVersions: recoveryVersions,
    getLimits() { return { inputPixels: MAX_INPUT_PIXELS, encodingPixels: MAX_PIXELS }; },
    readImageFile,
    decodePng,
    writePng,
    writeJpeg
  };
})(typeof window !== "undefined" ? window : self);
