// Optional, local speech compression after a working recording has finished.
// WebCodecs supplies Opus packets; a finite WebM carries exact playback timing.
(function (root) {
  "use strict";
  // Use Opus's 48 kHz clock for both input and container timing. Cocoa's encoder
  // can report priming in input-rate samples; 16 kHz makes that ambiguous.
  // The compressed bitrate, rather than the PCM rate, determines the file size.
  const RATE = 48000, FRAME = 960, TYPE = "audio/webm;codecs=opus";
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const cancelled = (signal) => { if (signal?.aborted) throw new DOMException("Voice compression cancelled.", "AbortError"); };
  const config = (bitrate, format) => ({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate,
    bitrateMode: "constant", opus: { format, signal: "voice", application: "voip", frameDuration: 20000 } });

  async function configuration(bitrate) {
    if (!root.AudioEncoder || !root.AudioData || !root.OfflineAudioContext) return null;
    if (!document.createElement("audio").canPlayType(TYPE)) return null;
    // Some implementations only expose raw Opus packets, but still supply the
    // OpusHead with encoder delay. Require that header before constructing WebM.
    for (const format of ["ogg", "opus"]) {
      const candidate = config(bitrate, format);
      try { if ((await root.AudioEncoder.isConfigSupported(candidate)).supported) return candidate; }
      catch { /* Try the other packet format. */ }
    }
    return null;
  }
  async function supported(bitrate = 8000) { return Boolean(await configuration(bitrate)); }

  function join(parts) {
    const bytes = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0; for (const p of parts) { bytes.set(p, offset); offset += p.length; }
    return bytes;
  }
  function unsigned(value) {
    const bytes = [];
    do { bytes.unshift(value % 256); value = Math.floor(value / 256); } while (value);
    return new Uint8Array(bytes);
  }
  function element(id, bytes) {
    let size = 1; while (bytes.length >= 2 ** (7 * size) - 1) size++;
    const length = new Uint8Array(size); let remaining = bytes.length;
    for (let i = size - 1; i >= 0; i--) { length[i] = remaining % 256; remaining = Math.floor(remaining / 256); }
    length[0] |= 1 << (8 - size);
    return join([unsigned(id), length, bytes]);
  }
  const integer = (id, value) => element(id, unsigned(value));
  const text = (id, value) => element(id, new TextEncoder().encode(value));
  function float(id, value) {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value);
    return element(id, bytes);
  }
  function block(packets, simple) {
    // Xiph lacing groups one second of packets without paying a block header
    // for every 20 ms. Packet boundaries and their original bytes are retained.
    const header = [0x81, 0, 0, (simple ? 0x80 : 0) | (packets.length > 1 ? 2 : 0)];
    if (packets.length > 1) {
      header.push(packets.length - 1);
      for (const packet of packets.slice(0, -1)) {
        let length = packet.length;
        while (length >= 255) { header.push(255); length -= 255; }
        header.push(length);
      }
    }
    return element(simple ? 0xa3 : 0xa1, join([new Uint8Array(header), ...packets]));
  }

  function packetSamples(packet) {
    const toc = packet[0], kind = toc >> 3, code = toc & 3;
    const ms = kind < 12 ? [10, 20, 40, 60][kind & 3] : kind < 16 ? [10, 20][kind & 1] : [2.5, 5, 10, 20][kind & 3];
    const count = code === 0 ? 1 : code === 3 ? packet[1] & 63 : 2;
    if (!count || ms * count > 120) throw new Error("Invalid encoded voice packet.");
    return ms * count * 48;
  }

  function mux(head, packets, samples, lace = true) {
    if (!head || head.length !== 19 || new TextDecoder().decode(head.subarray(0, 8)) !== "OpusHead" ||
      head[8] !== 1 || head[9] !== 1 || head[18] !== 0 || !packets.length)
      throw new Error("The browser did not supply a mono Opus header.");
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength), preSkip = view.getUint16(10, true);
    const end = preSkip + samples, used = []; let total = 0;
    for (const packet of packets) { used.push(packet); total += packetSamples(packet); if (total >= end) break; }
    if (total < end) throw new Error("The voice encoder did not finish the full recording.");
    const header = element(0x1a45dfa3, join([integer(0x4286, 1), integer(0x42f7, 1), integer(0x42f2, 4),
      integer(0x42f3, 8), text(0x4282, "webm"), integer(0x4287, 4), integer(0x4285, 2)]));
    const info = element(0x1549a966, join([integer(0x2ad7b1, 1000000), float(0x4489, samples * 1000 / RATE),
      text(0x4d80, "PixelStow"), text(0x5741, "PixelStow")]));
    const tracks = element(0x1654ae6b, element(0xae, join([integer(0xd7, 1), integer(0x73c5, 1), integer(0x83, 2),
      text(0x86, "A_OPUS"), element(0x63a2, head), integer(0x56aa, Math.round(preSkip * 1000000000 / 48000)),
      integer(0x56bb, 80000000), element(0xe1, join([float(0xb5, view.getUint32(12, true) || RATE), integer(0x9f, 1)]))])));
    const clusters = []; let position = 0;
    const groupSize = lace ? 50 : 1;
    for (let i = 0; i < used.length; i += groupSize) {
      const group = used.slice(i, i + groupSize), last = i + group.length === used.length;
      let content = block(group, !last);
      if (last) {
        // CodecDelay removes priming at the start; DiscardPadding trims the
        // final packet at the end. Both are nanoseconds, not timecode ticks.
        let padding = unsigned(Math.round((total - end) * 1000000000 / 48000));
        if (padding[0] & 128) padding = join([new Uint8Array([0]), padding]);
        content = element(0xa0, join([content, element(0x75a2, padding)]));
      }
      clusters.push(element(0x1f43b675, join([integer(0xe7, Math.round(position / 48)), content])));
      for (const packet of group) position += packetSamples(packet);
    }
    return join([header, element(0x18538067, join([info, tracks, ...clusters]))]);
  }

  async function compact(file, bitrate = 8000, { signal } = {}) {
    cancelled(signal);
    const settings = await configuration(bitrate);
    if (!settings) throw new Error("Smaller voice files need a browser with Opus audio encoding. Keep the original recording or try a newer browser.");
    cancelled(signal);
    if (file.bytes.length > 1024 * 1024) throw new Error("Choose a voice clip smaller than 1 MiB.");
    // Offline contexts avoid taking over Safari's audible playback session.
    const decode = new root.OfflineAudioContext(1, RATE, RATE);
    const decoded = await decode.decodeAudioData(file.bytes.slice().buffer);
    cancelled(signal);
    if (!(decoded.duration > 0) || decoded.duration > 60) throw new Error("Smaller voice is available for clips up to 60 seconds.");
    const length = Math.ceil(decoded.duration * RATE), render = new root.OfflineAudioContext(1, length, RATE);
    const source = render.createBufferSource(); source.buffer = decoded; source.connect(render.destination); source.start();
    const mono = await render.startRendering(); cancelled(signal);
    const pcm = mono.getChannelData(0), packets = [];
    let head, failed;
    const encoder = new root.AudioEncoder({
      output(chunk, metadata) {
        const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); packets.push(bytes);
        if (metadata?.decoderConfig?.description) {
          const d = metadata.decoderConfig.description;
          head = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice();
        }
      }, error(error) { failed = error; }
    });
    const abort = () => { if (encoder.state !== "closed") encoder.close(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      encoder.configure(settings);
      // Flush codec lookahead with silence; WebM DiscardPadding removes the tail.
      for (let offset = 0; offset < length + FRAME * 2; offset += FRAME) {
        cancelled(signal); if (failed) throw failed;
        const samples = new Float32Array(FRAME); samples.set(pcm.subarray(offset, Math.min(length, offset + FRAME)));
        const frame = new root.AudioData({ format: "f32-planar", sampleRate: RATE, numberOfChannels: 1,
          numberOfFrames: FRAME, timestamp: Math.round(offset * 1000000 / RATE), data: samples });
        try { encoder.encode(frame); } finally { frame.close(); }
        const drainDeadline = Date.now() + 5000;
        while (encoder.encodeQueueSize > 12) {
          cancelled(signal); if (failed) throw failed;
          if (Date.now() > drainDeadline) throw new Error("The voice encoder stopped responding.");
          await pause();
        }
      }
      let flushTimer;
      try {
        await Promise.race([encoder.flush(), new Promise((_, reject) => {
          flushTimer = setTimeout(() => reject(new Error("The voice encoder stopped responding.")), 5000);
        })]);
      } finally { clearTimeout(flushTimer); }
      cancelled(signal); if (failed) throw failed;
      // Verify actual output playback, duration and non-silent signal before
      // replacing anything. A successful configuration alone proves little.
      let bytes, verified, failure;
      for (const lace of [true, false]) {
        cancelled(signal);
        bytes = mux(head, packets, length, lace);
        try {
          verified = await decode.decodeAudioData(bytes.slice().buffer); cancelled(signal);
          if (Math.abs(verified.duration - length / RATE) > 0.08)
            throw new Error("The smaller voice file has an incorrect duration (" + verified.duration.toFixed(2) +
              " s instead of " + (length / RATE).toFixed(2) + " s).");
          failure = null;
          break;
        } catch (error) {
          cancelled(signal);
          failure = error;
          // Retry identical packets with separate WebM blocks if the native
          // decoder cannot handle lacing. No second conversion or quality loss.
        }
      }
      if (failure) throw failure;
      const peak = (data) => { let p = 0; for (const v of data) p = Math.max(p, Math.abs(v)); return p; };
      if (peak(pcm) > 0.01 && peak(verified.getChannelData(0)) < 0.001) throw new Error("The smaller voice file was silent.");
      if (bytes.length >= file.bytes.length) return { file, saved: 0, duration: verified.duration };
      return { file: { name: file.name.replace(/\.[^.]+$/, "") + ".webm", type: TYPE, bytes },
        saved: file.bytes.length - bytes.length, duration: verified.duration };
    } finally {
      signal?.removeEventListener("abort", abort);
      if (encoder.state !== "closed") encoder.close();
      pcm.fill(0);
    }
  }

  root.PixelStowVoice = { supported, compact };
})(typeof window !== "undefined" ? window : self);
