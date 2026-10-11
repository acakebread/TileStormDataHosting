import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto, randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "artifacts", "checks", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const source = await readFile(join(root, "pixelstow.js"), "utf8");
const context = vm.createContext({
  window: {}, Uint8Array, Uint8ClampedArray, DataView, TextEncoder, TextDecoder,
  Blob, Response, CompressionStream, DecompressionStream, crypto: webcrypto, setTimeout,
});
vm.runInContext(source.replace("window.PixelStow = {", "window.internalChecks = { unpackBundle, unpackFrame, packFrame, writeSignal, decryptEnvelope }; window.PixelStow = {"), context);
const codec = context.window.PixelStow;
const internal = context.window.internalChecks;
let checks = 0;
function check(condition, label) { assert.ok(condition, label); console.log("PASS: " + label); checks++; }
async function rejects(action, pattern, label) { await assert.rejects(action, pattern); console.log("PASS: " + label); checks++; }
function flat(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([140, 140, 140, 77], i);
  return pixels;
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function whiten(bytes) {
  const result = new Uint8Array(bytes);
  let state = 0x50434631;
  for (let i = 0; i < result.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    result[i] ^= state & 255;
  }
  return result;
}
// Independent writer from the documented layout, to catch a self-consistent codec bug.
function bundle(text, files) {
  const message = Buffer.from(text);
  const header = Buffer.alloc(12);
  header.write("PSB1"); header[4] = 1;
  header.writeUInt16LE(files.length, 6); header.writeUInt32LE(message.length, 8);
  const parts = [header, message];
  for (const file of files) {
    const name = Buffer.from(file.name), type = Buffer.from(file.type);
    const lengths = Buffer.alloc(8);
    lengths.writeUInt16LE(name.length); lengths.writeUInt16LE(type.length, 2); lengths.writeUInt32LE(file.bytes.length, 4);
    parts.push(lengths, name, type, Buffer.from(file.bytes));
  }
  return new Uint8Array(Buffer.concat(parts));
}
function frame(payload, { version = 3, kind = 3, compress = false } = {}) {
  const body = compress ? deflateRawSync(payload) : payload;
  const header = Buffer.alloc(20);
  header.write("PCF1"); header[4] = version; header[5] = kind; header[6] = compress ? 1 : 0; header[7] = 32;
  header.writeUInt32LE(payload.length, 8); header.writeUInt32LE(body.length, 12);
  header.writeUInt32LE(crc(Buffer.concat([header.subarray(0, 16), payload])), 16);
  return whiten(Buffer.concat([header, body]));
}
function protectedBody(plain, password, version) {
  const header = Buffer.alloc(60);
  header.write("PSP1"); header[4] = version; header[5] = 1; header[6] = 1;
  header.writeUInt32LE(600000, 8); header.writeUInt32LE(plain.length, 12);
  header.set(Buffer.from("0123456789abcdef"), 16); header.set(Buffer.from("fixtureNonce"), 32);
  const key = pbkdf2Sync(password, header.subarray(16, 32), 600000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, header.subarray(32, 44));
  cipher.setAAD(header.subarray(0, 44));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  header.set(cipher.getAuthTag(), 44); key.fill(0);
  return new Uint8Array(Buffer.concat([header, ciphertext]));
}
async function imageFromFrame(packed, width = 512, height = 512) {
  const reference = flat(width, height), pixels = reference.slice();
  await internal.writeSignal(reference, pixels, width, height, packed, 32);
  return { pixels, width, height };
}
async function roundTrip(content, password = "", width = 512, height = 512) {
  const original = flat(width, height), before = original.slice();
  const encoded = await codec.encodePayload(original, width, height, content, password);
  check(Buffer.from(original).equals(before), "Encoding preserves source pixels");
  const png = await codec.writePng(encoded.pixels, width, height);
  const reloaded = await codec.decodePng(new Uint8Array(await png.arrayBuffer()));
  check(Buffer.from(encoded.pixels).equals(reloaded.pixels), "PNG preserves every encoded pixel");
  const inspected = await codec.inspect(reloaded.pixels, width, height);
  check(inspected.found && inspected.hasAttachments && inspected.formatVersion === 3 && inspected.passwordProtected === Boolean(password), "v3 inspection identifies attachments and lock without a password");
  const decoded = await codec.decode(reloaded.pixels, width, height, password);
  check(decoded.status === "success" && codec.payloadsEqual(decoded, content), "Independent PNG import recovers exact text, metadata and all binary bytes");
  check(encoded.pixels.every((byte, i) => i % 4 !== 3 || byte === 77), "Attachment encoding preserves alpha");
  return { encoded, reloaded, png };
}

const files = [
  { name: "\uFEFFbirthday-🎂.bin", type: "application/octet-stream", bytes: new Uint8Array(Array.from({ length: 512 }, (_, i) => i & 255)) },
  { name: "empty.txt", type: "text/plain", bytes: new Uint8Array() },
];
const content = { text: "\uFEFF  Happy birthday! café 🎂\n\n  ", attachments: files };
const publicResult = await roundTrip(content);
await writeFile(join(output, "public-v3.png"), new Uint8Array(await publicResult.png.arrayBuffer()), { flag: "wx" });
await writeFile(join(output, "public-v3-payload.bin"), bundle(content.text, files), { flag: "wx" });
const binaryResult = await roundTrip({ text: "", attachments: files });
await writeFile(join(output, "browser-binary-v3.png"), new Uint8Array(await binaryResult.png.arrayBuffer()), { flag: "wx" });
const lockedResult = await roundTrip(content, "public check key 🎂");
await writeFile(join(output, "browser-protected-v3.png"), new Uint8Array(await lockedResult.png.arrayBuffer()), { flag: "wx" });
check((await codec.decode(lockedResult.reloaded.pixels, 512, 512, "")).status === "password", "Locked bundle exposes no text or files without a password");
const wrong = await codec.decode(lockedResult.reloaded.pixels, 512, 512, "wrong");
check(wrong.status === "incorrect" && !wrong.attachments && !wrong.text, "Incorrect password returns no bundle metadata or file bytes");
await rejects(() => codec.encodePayload(lockedResult.reloaded.pixels, 512, 512, content, ""), /already contains/, "Locked carriers cannot be re-encoded");
await rejects(() => codec.encodePayload(publicResult.reloaded.pixels, 512, 512, content, ""), /already contains/, "Public attachment carriers cannot be re-encoded");

const largeFiles = [{ name: "large.bin", type: "application/octet-stream", bytes: new Uint8Array(randomBytes(20000)) }];
const large = await roundTrip({ text: "", attachments: largeFiles }, "", 2049, 1539);
check(large.encoded.pixels.slice(-4).every((byte, i) => byte === [140, 140, 140, 77][i]), "Partial edge pixels are preserved");
await rejects(() => codec.encodePayload(flat(128, 128), 128, 128, content, ""), /too small/, "Actual carrier capacity rejects oversized payloads");
await rejects(() => codec.encodePayload(flat(512, 512), 512, 512, { text: "", attachments: [] }, ""), /message or add/, "An empty payload is rejected");
await rejects(() => codec.encodePayload(flat(512, 512), 512, 512, { text: "", attachments: Array(9).fill(files[0]) }, ""), /eight/, "Attachment count is bounded");
assert.throws(() => codec.payloadSize("", [{ ...files[0], name: "../secret.bin" }]), /filenames/); checks++;
assert.throws(() => codec.payloadSize("", [{ ...files[0], type: "audio/wav\nBad" }]), /media type/); checks++;
assert.throws(() => codec.payloadSize("", [{ ...files[0], bytes: new Uint8Array(1024 * 1024) }]), /1 MiB/); checks++;
assert.throws(() => codec.payloadSize("x".repeat(16385), files), /16 KiB/); checks++;

const referenceBundle = bundle(content.text, files);
const independentlyPacked = frame(referenceBundle, { compress: true });
const independentImage = await imageFromFrame(independentlyPacked);
check(codec.payloadsEqual(await codec.decode(independentImage.pixels, 512, 512, ""), content), "Browser reads an independently serialized compressed v3 image");
check(Buffer.from((await internal.unpackFrame(await internal.packFrame(referenceBundle, 32, false, true))).payload).equals(referenceBundle), "Browser frame body matches the independent bundle serialization");
const nodeLocked = protectedBody(referenceBundle, "fixture password", 2);
const independentLocked = await imageFromFrame(frame(nodeLocked, { kind: 4 }));
check(codec.payloadsEqual(await codec.decode(independentLocked.pixels, 512, 512, "fixture password"), content), "Browser reads Node-authenticated v3 bundle with identical AES-GCM layout");
const damagedEnvelope = nodeLocked.slice(); damagedEnvelope[60] ^= 1;
const tamperedImage = await imageFromFrame(frame(damagedEnvelope, { kind: 4 }));
check((await codec.decode(tamperedImage.pixels, 512, 512, "fixture password")).status === "incorrect", "Tampering fails authentication even with a recomputed outer CRC");

for (const invalid of [
  referenceBundle.slice(0, -1),
  new Uint8Array([...referenceBundle, 0]),
  (() => { const bytes = referenceBundle.slice(); bytes[5] = 1; return bytes; })(),
  (() => { const bytes = referenceBundle.slice(); bytes[6] = 9; return bytes; })(),
  (() => { const bytes = referenceBundle.slice(); bytes[8] = 255; bytes[9] = 255; return bytes; })(),
]) {
  await rejects(() => internal.unpackFrame(frame(invalid)), /bundle|attachment/i, "Malformed bundle is refused despite a valid outer checksum");
}
await rejects(() => internal.unpackFrame(frame(new Uint8Array(1000), { version: 3, kind: 4 })), /password-protected/, "Invalid protected envelope is rejected before key derivation");
const expansion = whiten(frame(new Uint8Array(100000).fill(65), { compress: true }));
new DataView(expansion.buffer).setUint32(8, 1, true);
await rejects(() => internal.unpackFrame(whiten(expansion)), /declared length/, "DEFLATE expansion is stopped at the declared byte budget");

const oldPng = await codec.decodePng(new Uint8Array(await readFile(join(root, "tests/fixtures/public-v1.png"))));
const oldText = await readFile(join(root, "tests/fixtures/public-v1.txt"), "utf8");
const oldDecoded = await codec.decode(oldPng.pixels, oldPng.width, oldPng.height, "");
check(oldDecoded.status === "success" && oldDecoded.text === oldText && oldDecoded.attachments.length === 0, "Frozen .NET PCF1 v1 image remains readable");
for (const password of ["", "fixture password"]) {
  const text = '{"level":"public compatibility check"}\n';
  const encoded = await codec.encode(flat(512, 512), 512, 512, text, password);
  const info = await codec.inspect(encoded.pixels, 512, 512);
  const decoded = await codec.decode(encoded.pixels, 512, 512, password);
  check(info.formatVersion === (password ? 2 : 1) && !info.hasAttachments && decoded.text === text && !decoded.attachments.length, "Text-only writing stays in the TileStorm-compatible v1/v2 format");
  const png = await codec.writePng(encoded.pixels, 512, 512);
  await writeFile(join(output, password ? "browser-v2.png" : "browser-v1.png"), new Uint8Array(await png.arrayBuffer()), { flag: "wx" });
}
const oldLockedText = Buffer.from("Public password fixture: café 🎂\n");
const oldLocked = await imageFromFrame(frame(protectedBody(oldLockedText, "fixture password", 1), { version: 2, kind: 2 }));
check((await codec.decode(oldLocked.pixels, 512, 512, "fixture password")).text === oldLockedText.toString(), "Existing v2 encryption layout remains readable");
console.log(JSON.stringify({ checks, output }));
