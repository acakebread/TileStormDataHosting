// Browser attachment and recording UI. Payload serialization belongs to pixelstow.js.
(function () {
  // MediaRecorder's streaming WebM can omit Info/Duration. Native players then
  // keep increasing their duration estimate while playing, distorting the bar.
  // Finalize the single-track, unlaced Opus stream emitted by the browser, using
  // its packet timestamps. Audio packet bytes are copied without re-encoding.
  // Matroska: https://www.matroska.org/technical/elements.html
  // Opus packet duration: https://www.rfc-editor.org/rfc/rfc6716.html#section-3.1
  function finalizeWebmAudio(bytes) {
    try {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const vint = (offset, limit, isId = false) => {
        if (offset >= limit || !bytes[offset]) throw new Error("Invalid WebM integer");
        let width = 1, marker = 0x80;
        while (!(bytes[offset] & marker)) { width++; marker >>= 1; }
        if (width > (isId ? 4 : 8) || offset + width > limit) throw new Error("Invalid WebM integer");
        let value = isId ? bytes[offset] : bytes[offset] & (marker - 1);
        let unknown = !isId && value === marker - 1;
        for (let i = 1; i < width; i++) {
          value = value * 256 + bytes[offset + i];
          unknown &&= bytes[offset + i] === 255;
        }
        if (!unknown && !Number.isSafeInteger(value)) throw new Error("Oversized WebM integer");
        return { width, value, unknown };
      };
      const element = (offset, limit) => {
        const id = vint(offset, limit, true);
        const size = vint(offset + id.width, limit);
        const data = offset + id.width + size.width;
        const end = size.unknown ? limit : data + size.value;
        if (end > limit) throw new Error("Truncated WebM element");
        return { id: id.value, start: offset, data, end, idWidth: id.width, sizeWidth: size.width, unknown: size.unknown };
      };
      const children = (parent) => {
        const result = [];
        for (let offset = parent.data; offset < parent.end;) {
          const child = element(offset, parent.end);
          if (child.unknown) throw new Error("Unexpected open WebM element");
          result.push(child);
          offset = child.end;
        }
        return result;
      };
      const uint = (field) => {
        let value = 0;
        if (field.end - field.data > 8) throw new Error("Oversized WebM integer");
        for (let i = field.data; i < field.end; i++) value = value * 256 + bytes[i];
        if (!Number.isSafeInteger(value)) throw new Error("Oversized WebM integer");
        return value;
      };
      const float = (field) => field.end - field.data === 4 ? view.getFloat32(field.data)
        : field.end - field.data === 8 ? view.getFloat64(field.data) : NaN;
      const header = element(0, bytes.length);
      if (header.id !== 0x1a45dfa3 || header.unknown) return bytes;
      const segment = element(header.end, bytes.length);
      // Inserting into an indexed, finished file could invalidate byte offsets.
      if (segment.id !== 0x18538067 || !segment.unknown) return bytes;
      let info = null, duration = null, scale = 1000000, trackNumber = null, codecDelay = 0, endSeconds = 0;
      for (let offset = segment.data; offset < segment.end;) {
        const item = element(offset, segment.end);
        offset = item.end;
        if (item.id === 0x1549a966) {
          if (info || item.unknown) return bytes;
          info = item;
          for (const field of children(info)) {
            if (field.id === 0xbf) return bytes; // Preserve checksummed metadata.
            if (field.id === 0x2ad7b1) scale = uint(field);
            if (field.id === 0x4489) duration = field;
          }
          if (!(scale > 0) || (duration && Number.isFinite(float(duration)) && float(duration) > 0)) return bytes;
        } else if (item.id === 0x1654ae6b) {
          const tracks = children(item).filter((field) => field.id === 0xae);
          if (trackNumber !== null || tracks.length !== 1) return bytes;
          const fields = children(tracks[0]);
          const number = fields.find((field) => field.id === 0xd7);
          const type = fields.find((field) => field.id === 0x83);
          const codec = fields.find((field) => field.id === 0x86);
          const trackScale = fields.find((field) => field.id === 0x23314f);
          const delay = fields.find((field) => field.id === 0x56aa);
          if (!number || !type || !codec || uint(type) !== 2 ||
            new TextDecoder().decode(bytes.subarray(codec.data, codec.end)) !== "A_OPUS" ||
            (trackScale && float(trackScale) !== 1)) return bytes;
          trackNumber = uint(number);
          if (delay) codecDelay = uint(delay) / 1000000000;
        } else if (item.id === 0x1f43b675) {
          if (!info || trackNumber === null) return bytes;
          let timestamp = null, position = item.data;
          for (; position < item.end;) {
            const block = element(position, item.end);
            // An open cluster ends when the following cluster starts.
            if (item.unknown && block.id === 0x1f43b675) break;
            if (block.unknown) return bytes;
            position = block.end;
            if (block.id === 0xe7) timestamp = uint(block);
            else if (block.id === 0xa3) {
              const track = vint(block.data, block.end);
              const time = block.data + track.width;
              const packet = time + 3;
              if (timestamp === null || track.value !== trackNumber || packet >= block.end || (bytes[time + 2] & 6)) return bytes;
              const toc = bytes[packet], config = toc >> 3, code = toc & 3;
              const frameMs = config < 12 ? [10, 20, 40, 60][config & 3]
                : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
              if (code === 3 && packet + 1 >= block.end) return bytes;
              const count = code === 0 ? 1 : code === 3 ? bytes[packet + 1] & 63 : 2;
              if (!count || count * frameMs > 120) return bytes;
              const seconds = (timestamp + view.getInt16(time)) * scale / 1000000000 + count * frameMs / 1000 - codecDelay;
              endSeconds = Math.max(endSeconds, seconds);
            } else if (block.id !== 0xec && block.id !== 0xbf) return bytes;
          }
          offset = position;
        } else if (item.id !== 0xec) return bytes; // Leave indexed/other WebM variants intact.
      }
      if (!info || !(endSeconds > 0)) return bytes;
      const ticks = endSeconds * 1000000000 / scale;
      if (duration) {
        const repaired = bytes.slice();
        const output = new DataView(repaired.buffer);
        if (duration.end - duration.data === 4) output.setFloat32(duration.data, ticks);
        else if (duration.end - duration.data === 8) output.setFloat64(duration.data, ticks);
        else return bytes;
        return repaired;
      }
      const added = new Uint8Array(11);
      added.set([0x44, 0x89, 0x88]); // Duration, eight-byte big-endian float.
      new DataView(added.buffer).setFloat64(3, ticks);
      const size = info.end - info.data + added.length;
      let width = info.sizeWidth;
      while (size >= 2 ** (7 * width) - 1) width++;
      const sizeBytes = new Uint8Array(width);
      let remaining = size;
      for (let i = width - 1; i >= 0; i--) { sizeBytes[i] = remaining % 256; remaining = Math.floor(remaining / 256); }
      sizeBytes[0] |= 1 << (8 - width);
      const repaired = new Uint8Array(bytes.length + added.length + width - info.sizeWidth);
      const sizeOffset = info.start + info.idWidth;
      repaired.set(bytes.subarray(0, sizeOffset));
      repaired.set(sizeBytes, sizeOffset);
      const dataOffset = sizeOffset + width;
      repaired.set(bytes.subarray(info.data, info.end), dataOffset);
      repaired.set(added, dataOffset + info.end - info.data);
      repaired.set(bytes.subarray(info.end), dataOffset + size);
      return repaired;
    } catch (_) {
      return bytes; // An unfamiliar container must not prevent audio playback.
    }
  }

  class MediaPanel {
    constructor({ changed, report, remaining, save }) {
      this.changed = changed;
      this.report = report;
      this.remaining = remaining;
      this.save = save;
      this.files = [];
      this.urls = { compose: [], decoded: [] };
      this.busy = false;
      this.locked = false;
      this.recording = null;
      this.pending = false;
      this.requestingMic = false;
      this.generation = 0;
      this.input = document.querySelector("#attachment-file");
      this.kind = document.querySelector("#attachment-kind");
      this.list = document.querySelector("#attachment-list");
      this.decoded = document.querySelector("#decoded-attachments");
      this.decodedSection = document.querySelector("#decoded-files");
      this.recordButton = document.querySelector("#record-audio");
      this.stopButton = document.querySelector("#stop-audio");
      this.cancelButton = document.querySelector("#cancel-audio");
      this.recordStatus = document.querySelector("#record-status");
      this.recordQuality = document.querySelector("#record-quality");
      this.recordHelp = document.querySelector("#record-help");
      this.compactAvailable = false;
      this.recordQuality.addEventListener("change", () => this.recordingHelp());
      Promise.all([PixelStowVoice.supported(8000), PixelStowVoice.supported(6000)]).then(([compact, tiny]) => {
        this.compactAvailable = compact;
        this.recordQuality.querySelector('option[value="compact"]').disabled = !compact;
        this.recordQuality.querySelector('option[value="tiny"]').disabled = !compact || !tiny;
        if (!compact) this.recordQuality.value = "compatible";
        this.recordingHelp(); this.render(this.list, this.files, "compose", false); this.sync();
      });
      this.audioAction = document.querySelector("#audio-action");
      this.previewVoiceButton = document.querySelector("#preview-audio");
      this.voiceStatus = document.querySelector("#voice-status");
      this.voiceAudio = null;
      // Safari grants playback permission per media element. Retain the main
      // player when a camera capture or another imported image replaces its source.
      this.messageAudio = document.createElement("audio");
      this.composePlayers = new Map();
      this.audioVoices = new WeakMap();
      const toggleVoice = () => {
        if (this.busy || !this.voiceAudio) return;
        const voice = this.voiceAudio;
        if (voice.playing && !voice.audio.paused && !voice.audio.ended) voice.audio.pause();
        else {
          // An autoplay request can leave paused=false without ever reaching
          // audible playback. Replace that pending request inside this same tap.
          if (!voice.audio.paused) voice.audio.pause();
          if (voice.audio.ended) voice.audio.currentTime = 0;
          this.playVoice(voice);
        }
      };
      this.previewVoiceButton.addEventListener("click", toggleVoice);
      this.kind.addEventListener("change", () => {
        this.input.accept = {
          all: "", audio: "audio/*,.mp3,.wav,.ogg,.webm,.m4a,.aac,.flac",
          image: "image/*", document: ".txt,.pdf,.json,.csv,.zip,.doc,.docx"
        }[this.kind.value];
      });
      this.input.addEventListener("change", async () => {
        const files = Array.from(this.input.files);
        this.input.value = "";
        await this.addFiles(files);
      });
      this.recordButton.addEventListener("click", () => this.startRecording());
      this.stopButton.addEventListener("click", () => this.stopRecording());
      this.cancelButton.addEventListener("click", () => this.stopRecording(true));
      window.addEventListener("pagehide", () => {
        this.reset();
        this.messageAudio.pause();
        this.messageAudio.removeAttribute("src");
        this.messageAudio.load();
        if (this.primerUrl) URL.revokeObjectURL(this.primerUrl);
        this.primerUrl = null;
        this.priming = false;
      });
      this.sync();
    }

    get active() { return this.pending || Boolean(this.recording); }

    preparePlayback() {
      // Called directly by image/camera/unlock gestures, before asynchronous
      // decoding. A short silent PCM clip lets this same player acquire Safari's
      // media permission; it is replaced by the recovered attachment afterwards.
      if (this.voiceAudio || this.priming) return;
      if (!this.primerUrl) {
        const bytes = new Uint8Array(444), view = new DataView(bytes.buffer);
        const word = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
        word(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); word(8, "WAVEfmt ");
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
        view.setUint16(32, 1, true); view.setUint16(34, 8, true); word(36, "data");
        view.setUint32(40, bytes.length - 44, true); bytes.fill(128, 44);
        this.primerUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      }
      const audio = this.messageAudio, url = this.primerUrl;
      audio.muted = audio.defaultMuted = false;
      audio.volume = 1;
      audio.setAttribute("playsinline", "");
      audio.src = url;
      this.priming = true;
      const finish = () => {
        this.priming = false;
        if (audio.src === url && !this.voiceAudio) audio.pause();
      };
      try { Promise.resolve(audio.play()).then(finish, finish); }
      catch { finish(); } // Autoplay policies may still require the explicit Play button.
    }

    sync() {
      const disabled = this.busy || this.locked || this.active;
      this.input.disabled = disabled;
      this.kind.disabled = disabled;
      const supported = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
      this.recordButton.disabled = disabled || !supported;
      this.recordQuality.disabled = disabled;
      this.stopButton.hidden = !this.recording;
      this.stopButton.disabled = Boolean(this.recording?.finishing);
      this.cancelButton.hidden = !this.recording && !this.requestingMic && !this.compressionAbort;
      this.cancelButton.textContent = this.compressionAbort ? "Cancel compression" : "Discard recording";
      this.list.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
      this.previewVoiceButton.disabled = this.busy || !this.voiceAudio;
      if (!supported && !this.active) this.recordStatus.textContent = "This browser cannot access the microphone on this page. You can still attach an audio file.";
    }

    setState(busy, locked) {
      this.busy = busy;
      this.locked = locked;
      this.sync();
    }

    recordingHelp() {
      this.recordHelp.textContent = !this.compactAvailable
        ? "The working recorder is available. Smaller voice files need Opus audio encoding, available in newer browsers including Safari 26."
        : this.recordQuality.value === "compatible"
          ? "Keep the working recording format. You can also choose Make voice smaller on an attached audio file."
          : "Record normally, then reduce to mono " + (this.recordQuality.value === "tiny" ? "6" : "8") +
            " kbit/s Opus after Stop. Voice quality is reduced. The original is kept if conversion fails; listen before encoding.";
    }

    async compactAttachment(index) {
      if (this.busy || this.locked || this.active || !this.compactAvailable) return;
      const file = this.files[index], generation = this.generation;
      this.compressionAbort = new AbortController();
      this.pending = true; this.changed();
      this.report("Making the voice attachment smaller…");
      try {
        const result = await PixelStowVoice.compact(file, this.recordQuality.value === "tiny" ? 6000 : 8000,
          { signal: this.compressionAbort.signal });
        if (generation !== this.generation) return;
        if (result.file !== file) {
          // Retain Safari's media element/permission across WAV → Opus. Prepare
          // its new source now, rather than making the first Play tap replace it.
          const player = this.composePlayers.get(file);
          if (player) {
            this.composePlayers.delete(file);
            this.composePlayers.set(result.file, player);
          }
          this.files[index] = result.file;
          this.render(this.list, this.files, "compose", false);
        }
        this.report(result.saved ? "Voice reduced from " + file.bytes.length.toLocaleString("en-GB") + " to " +
          result.file.bytes.length.toLocaleString("en-GB") + " bytes. Listen to the smaller version before encoding."
          : "This voice file is already as small as the conversion. The original was kept.");
      } catch (error) {
        if (generation === this.generation && error.name !== "AbortError") this.report("The original audio was kept. " + error.message, true);
      } finally {
        if (generation === this.generation) { this.pending = false; this.compressionAbort = null; this.changed(); }
      }
    }

    async addFiles(files) {
      if (!files.length || this.busy || this.locked || this.active) return;
      if (files.reduce((sum, file) => sum + file.size, 0) + this.files.reduce((sum, file) => sum + file.bytes.length, 0) > 1024 * 1024) {
        return this.report("Choose smaller files: the payload limit is 1 MiB, and this photo may hold less.", true);
      }
      const generation = this.generation;
      this.pending = true;
      this.changed();
      try {
        const added = [];
        for (const file of files) {
          const types = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac" };
          const type = file.type || types[file.name.split(".").pop().toLowerCase()] || "application/octet-stream";
          added.push({ name: file.name, type, bytes: new Uint8Array(await file.arrayBuffer()) });
        }
        if (generation !== this.generation) return;
        PixelStow.payloadSize("", [...this.files, ...added]);
        this.files.push(...added);
        this.render(this.list, this.files, "compose", false);
        this.report("Files attached. Add a message if you wish, then encode the new image.");
      } catch (error) {
        this.report(error.message || "Could not attach those files.", true);
      } finally {
        this.pending = false;
        this.changed();
      }
    }

    clearUrls(group, container, retainedPlayers = new Set()) {
      if (group === "decoded") {
        if (this.voiceAudio) this.voiceAudio.playAttempt++;
        this.voiceAudio = null;
        this.audioAction.hidden = true;
        this.previewVoiceButton.hidden = true;
        this.voiceStatus.textContent = "";
        this.previewVoiceButton.textContent = "Play audio";
      }
      container.querySelectorAll("audio").forEach((audio) => {
        this.audioVoices.get(audio)?.dispose();
        this.audioVoices.delete(audio);
        audio.pause();
        if (!retainedPlayers.has(audio)) {
          audio.removeAttribute("src");
          audio.load();
        }
      });
      for (const url of this.urls[group]) URL.revokeObjectURL(url);
      this.urls[group] = [];
      container.replaceChildren();
    }

    render(container, files, group, autoplay) {
      const players = new Map();
      if (group === "compose") for (const file of files) {
        if (/^audio\//i.test(file.type)) players.set(file, this.composePlayers.get(file) || document.createElement("audio"));
      }
      this.clearUrls(group, container, new Set(players.values()));
      if (group === "compose") this.composePlayers = players;
      let firstAudio = null;
      files.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "attachment-row";
        const label = document.createElement("span");
        label.textContent = file.name + " · " + file.bytes.length.toLocaleString("en-GB") + " bytes";
        row.appendChild(label);
        if (group === "compose") {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.setAttribute("aria-label", "Remove " + file.name);
          remove.addEventListener("click", () => {
            if (this.busy || this.locked || this.active) return;
            this.files.splice(index, 1);
            this.render(container, this.files, group, false);
            this.changed();
          });
          row.appendChild(remove);
          if (/^audio\//i.test(file.type) && this.compactAvailable) {
            const smaller = document.createElement("button"); smaller.type = "button";
            smaller.textContent = "Make voice smaller";
            smaller.addEventListener("click", () => this.compactAttachment(index)); row.appendChild(smaller);
          }
        }
        {
          const blob = new Blob([file.bytes], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          this.urls[group].push(url);
          const link = document.createElement("a");
          link.className = "button-link";
          link.href = url;
          link.download = file.name;
          link.textContent = "Download file";
          link.addEventListener("click", async (event) => {
            event.preventDefault();
            if (this.busy || this.active) return;
            const filename = await this.save(blob, link.download);
            if (filename) link.download = filename;
          });
          row.appendChild(link);
        }
        if (/^audio\//i.test(file.type)) {
          // Repair older streamed recordings only in the playback copy. Imported
          // attachment bytes and downloads remain exactly as supplied.
          const playbackBytes = /webm/i.test(file.type) ? finalizeWebmAudio(file.bytes) : file.bytes;
          const url = URL.createObjectURL(new Blob([playbackBytes], { type: file.type }));
          this.urls[group].push(url);
          const audio = group === "decoded" && !firstAudio ? this.messageAudio : players.get(file) || document.createElement("audio");
          audio.controls = true;
          audio.preload = "auto";
          audio.muted = false;
          audio.defaultMuted = false;
          audio.volume = 1;
          audio.src = url;
          audio.setAttribute("aria-label", "Play " + file.name);
          row.appendChild(audio);
          const hint = document.createElement("p");
          hint.className = "hint";
          const voice = { audio, hint, name: file.name, playAttempt: 0, playing: false };
          const listeners = [];
          const listen = (name, handler) => { audio.addEventListener(name, handler); listeners.push([name, handler]); };
          voice.dispose = () => {
            voice.playAttempt++;
            voice.playing = false;
            for (const [name, handler] of listeners) audio.removeEventListener(name, handler);
          };
          this.audioVoices.set(audio, voice);
          listen("error", () => {
            if (!audio.error) return;
            voice.playing = false;
            hint.textContent = audio.error.code === 3 || audio.error.code === 4
              ? "This browser cannot play this audio format. Download the file to listen in another player."
              : "Playback was interrupted. Press Play to try again.";
            if (this.voiceAudio === voice) {
              this.previewVoiceButton.textContent = "Play audio";
              this.voiceStatus.textContent = hint.textContent;
            }
          });
          if (group === "decoded") {
            listen("play", () => {
              if (!this.decoded.contains(audio)) return;
              this.decoded.querySelectorAll("audio").forEach((other) => { if (other !== audio) other.pause(); });
              this.voiceAudio = voice;
              voice.playing = false;
              this.previewVoiceButton.textContent = "Play audio";
              this.voiceStatus.textContent = "Starting " + file.name + "…";
              hint.textContent = "";
            });
            listen("playing", () => this.voiceStarted(voice));
            listen("waiting", () => {
              voice.playing = false;
              if (this.voiceAudio !== voice) return;
              this.previewVoiceButton.textContent = "Play audio";
              this.voiceStatus.textContent = "Audio buffering. Tap Play to retry if it does not start.";
            });
            ["pause", "ended"].forEach((event) => listen(event, () => {
              // A queued pause from replacing a blocked request must not cancel
              // the new play request made later in the same user gesture.
              if (!audio.paused && !audio.ended) return;
              voice.playing = false;
              voice.playAttempt++;
              if (this.voiceAudio !== voice) return;
              this.previewVoiceButton.textContent = "Play audio";
              this.voiceStatus.textContent = audio.ended ? "Message finished. Tap Play to hear it again." : "Message paused.";
            }));
          }
          row.appendChild(hint);
          if (!firstAudio) firstAudio = voice;
        }
        container.appendChild(row);
        // Prepare the new source after reattaching its retained player, before
        // any preview gesture. A load from the play handler can abort play().
        if (group === "compose") players.get(file)?.load();
      });
      if (group === "decoded" && firstAudio) {
        this.voiceAudio = firstAudio;
        this.audioAction.hidden = false;
        this.previewVoiceButton.hidden = false;
        this.voiceStatus.textContent = "Audio attached. Use Play audio beside the image or the file's player to listen.";
        if (autoplay) this.playVoice(firstAudio);
      }
      this.sync();
    }

    voiceStarted(voice) {
      const audio = voice.audio;
      if (this.voiceAudio !== voice || !this.decoded.contains(audio) || audio.paused || audio.ended || audio.currentSrc !== audio.src) return;
      voice.playing = true;
      voice.hint.textContent = "";
      this.previewVoiceButton.textContent = "Pause audio";
      this.voiceStatus.textContent = "Playing " + voice.name;
    }

    playVoice(voice) {
      // Keep play in the tap handler: awaiting anything first loses iOS permission
      // to start audible media. Reuse the loaded player rather than replacing it.
      voice.audio.muted = false;
      voice.audio.volume = 1;
      // Native controls can recover a failed load; give the shortcut the same retry.
      if (voice.audio.error) voice.audio.load();
      const attempt = ++voice.playAttempt;
      voice.hint.textContent = "";
      voice.playing = false;
      this.voiceStatus.textContent = "Starting " + voice.name + "…";
      const failed = (error) => {
        if (this.voiceAudio !== voice || voice.playAttempt !== attempt || voice.playing) return;
        this.previewVoiceButton.textContent = "Play audio";
        const hint = voice.audio.error?.code === 3 || voice.audio.error?.code === 4 || error.name === "NotSupportedError"
          ? "This browser cannot play this audio format. Download the file to listen in another player."
          : error.name === "AbortError" ? "Playback was interrupted. Press Play to try again."
          : "Press Play to hear the message. Your browser did not start playback automatically.";
        voice.hint.textContent = hint;
        this.voiceStatus.textContent = hint;
      };
      try {
        Promise.resolve(voice.audio.play()).then(() => {
          if (voice.playAttempt === attempt) this.voiceStarted(voice);
        }, failed);
      } catch (error) { failed(error); }
    }

    showDecoded(files, autoplay = true) {
      this.render(this.decoded, files, "decoded", autoplay);
      this.decodedSection.hidden = files.length === 0;
    }

    reset() {
      this.generation++;
      this.compressionAbort?.abort();
      this.compressionAbort = null;
      this.pending = false;
      this.stopRecording(true);
      this.files.forEach((file) => file.bytes.fill(0));
      this.files = [];
      this.input.value = "";
      this.clearUrls("compose", this.list);
      this.composePlayers.clear();
      this.clearUrls("decoded", this.decoded);
      this.decodedSection.hidden = true;
      this.recordStatus.textContent = "";
      this.sync();
    }

    stopRecording(cancel = false) {
      const job = this.recording;
      if (!job) {
        if (cancel && this.compressionAbort) {
          this.compressionAbort.abort();
          this.report("Voice compression cancelled. The original audio was kept.");
          return;
        }
        if (cancel && this.requestingMic) {
          this.generation++;
          this.pending = false;
          this.requestingMic = false;
          this.recordStatus.textContent = "Microphone request cancelled.";
          this.changed();
        }
        return;
      }
      job.cancelled ||= cancel;
      if (cancel) job.compressionAbort?.abort();
      clearInterval(job.timer);
      if (!job.finishing) {
        job.finishing = true;
        job.elapsedSeconds = (performance.now() - job.started) / 1000;
        if (job.recorder.state !== "inactive") job.recorder.stop();
        if (!job.cancelled) this.recordStatus.textContent = "Finishing voice recording…";
        this.sync();
      }
      // On a normal stop, leave the input alive until the final data/stop events.
      // Cancelling or leaving the page can release the microphone immediately.
      if (job.cancelled) this.releaseRecording(job);
    }

    releaseRecording(job) {
      if (job.release) return job.release;
      job.stream?.getTracks().forEach((track) => track.stop());
      if (job.recordStream !== job.stream) job.recordStream?.getTracks().forEach((track) => track.stop());
      job.source?.disconnect();
      job.release = job.context && job.context.state !== "closed" ? job.context.close().catch(() => {}) : Promise.resolve();
      return job.release;
    }

    async startRecording() {
      if (this.busy || this.locked || this.active) return;
      let budget;
      try { budget = this.remaining(); }
      catch (error) { return this.report(error.message || "Check the message before recording.", true); }
      if (budget < 2048) return this.report("This photo has little room left. Use a larger picture or remove an attachment before recording.", true);
      const generation = this.generation;
      this.pending = true;
      this.requestingMic = true;
      this.changed();
      this.recordStatus.textContent = "Requesting microphone access…";
      const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const inputs = { stream: null, recordStream: null, source: null, context: null };
      try {
        // Retain the pre-compact M4A format on iPhones; desktop keeps its Opus path.
        const formats = appleMobile ? ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]
          : ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
        const mimeType = formats.find((type) => MediaRecorder.isTypeSupported(type));
        if (appleMobile && !mimeType) throw new Error("This browser cannot record M4A audio. You can still attach an audio file.");
        if (appleMobile) {
          // Supply a real mono speech-rate input; microphone hints can be ignored.
          // Resume in the Record tap before awaiting permission, for iOS activation.
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          inputs.context = new AudioContextClass({ sampleRate: 16000 });
          inputs.context.resume().catch(() => {});
        }
        if (generation !== this.generation) { await this.releaseRecording(inputs); return; }
        inputs.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
        if (generation !== this.generation) {
          await this.releaseRecording(inputs);
          return;
        }
        inputs.recordStream = inputs.stream;
        if (inputs.context) {
          const destination = inputs.context.createMediaStreamDestination();
          destination.channelCount = 1;
          destination.channelCountMode = "explicit";
          inputs.source = inputs.context.createMediaStreamSource(inputs.stream);
          inputs.source.connect(destination);
          inputs.recordStream = destination.stream;
          await inputs.context.resume();
          if (generation !== this.generation) { await this.releaseRecording(inputs); return; }
          if (inputs.context.state !== "running") throw new Error("The microphone audio did not start. Tap Record to try again.");
        }
        const options = { audioBitsPerSecond: 16000 };
        if (mimeType) options.mimeType = mimeType;
        const recorder = new MediaRecorder(inputs.recordStream, options);
        this.requestingMic = false;
        const singleClip = mimeType?.includes("mp4") || recorder.mimeType.includes("mp4");
        const compactBitrate = this.compactAvailable && this.recordQuality.value !== "compatible" ?
          (this.recordQuality.value === "tiny" ? 6000 : 8000) : 0;
        const maxSeconds = compactBitrate ? Math.min(30, Math.max(1, (budget - 400) * 8 / (compactBitrate + 800)))
          : singleClip ? Math.min(30, Math.max(1, (budget - 1536) * 8 / 16000)) : 30;
        const job = { ...inputs, recorder, compactBitrate, compressionAbort: new AbortController(),
          chunks: [], size: 0, started: performance.now(), cancelled: false, finishing: false, timer: null };
        this.recording = job;
        const update = () => {
          if (job.finishing) return;
          const seconds = (performance.now() - job.started) / 1000;
          this.recordStatus.textContent = "Recording: " + seconds.toFixed(1) + " s · " + (compactBitrate
            ? "Smaller voice after Stop. Estimated room for " + maxSeconds.toFixed(1) + " seconds."
            : singleClip
            ? "M4A/AAC. Estimated room for " + maxSeconds.toFixed(1) + " seconds; file size shown after Stop."
            : job.size.toLocaleString("en-GB") + " / about " + budget.toLocaleString("en-GB") + " bytes · Opus. Maximum 30 seconds.");
          // M4A container chunks are not a reliable measure of speech bytes.
          if (seconds >= maxSeconds || (!compactBitrate && !singleClip && job.size >= Math.max(1024, budget - 1024))) this.stopRecording();
        };
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size) { job.chunks.push(event.data); job.size += event.data.size; }
          if (recorder.state !== "inactive") update();
        });
        recorder.addEventListener("error", () => {
          job.failed = true;
          this.stopRecording(true);
          this.report("The microphone recording failed. You can try again or attach an audio file.", true);
        });
        recorder.addEventListener("stop", async () => {
          clearInterval(job.timer);
          try {
            await this.releaseRecording(job);
            if (!job.cancelled && generation === this.generation) {
              const type = recorder.mimeType || mimeType || "audio/webm";
              const blob = new Blob(job.chunks, { type });
              if (!blob.size) throw new Error("The recording was empty. Try recording again.");
              const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
              const name = "voice-message-" + (this.files.length + 1) + "." + extension;
              const bytes = new Uint8Array(await blob.arrayBuffer());
              let attachment = { name, type, bytes: /webm/i.test(type) ? finalizeWebmAudio(bytes) : bytes }, compactNote = "";
              if (compactBitrate) {
                this.recordStatus.textContent = "Making the voice recording smaller…";
                try {
                  const smaller = await PixelStowVoice.compact(attachment, compactBitrate, { signal: job.compressionAbort.signal });
                  attachment = smaller.file;
                  compactNote = smaller.saved ? " Saved " + smaller.saved.toLocaleString("en-GB") + " bytes."
                    : " The original was already smaller.";
                } catch (error) {
                  if (job.cancelled || generation !== this.generation) return;
                  compactNote = " The original recording was kept. " + (error.message || "Voice conversion failed.");
                }
              }
              if (job.cancelled || generation !== this.generation) return;
              PixelStow.payloadSize("", [...this.files, attachment]);
              this.files.push(attachment);
              this.render(this.list, this.files, "compose", false);
              const size = attachment.bytes.length;
              this.recordStatus.textContent = "Recording attached: " + size.toLocaleString("en-GB") + " bytes · " +
                (job.elapsedSeconds ?? (performance.now() - job.started) / 1000).toFixed(1) + " s · " +
                (attachment.type.includes("opus") || attachment.type.includes("webm") || attachment.type.includes("ogg") ? "Opus" : "M4A/AAC") + "." + compactNote + " Listen before encoding; remove it to record again.";
              this.report(size > budget ? "The recording may be too large for this photo. Use a larger image or make a shorter recording." : "Voice message attached. You can encode it with or without text.", size > budget);
            } else if (generation === this.generation && !job.failed) {
              this.recordStatus.textContent = "Recording discarded.";
            }
          } catch (error) {
            this.report(error.message || "The recording could not be attached.", true);
          } finally {
            job.chunks = [];
            if (this.recording === job) this.recording = null;
            this.changed();
          }
        });
        // Write one finished M4A file, without repeated short container fragments.
        if (singleClip) recorder.start();
        else recorder.start(250);
        job.timer = setInterval(update, 250);
        update();
      } catch (error) {
        if (this.recording && generation === this.generation) {
          this.recording.cancelled = true;
          clearInterval(this.recording.timer);
          await this.releaseRecording(this.recording);
        } else await this.releaseRecording(inputs);
        if (generation !== this.generation) return;
        this.recording = null;
        this.recordStatus.textContent = "";
        this.report(error.name === "NotAllowedError" ? "Microphone access was denied. Allow it in your browser to record, or attach an audio file."
          : error.name === "Error" ? error.message : "Could not start the microphone. Check it is connected, or attach an audio file.", true);
      } finally {
        if (generation === this.generation) {
          this.pending = false;
          this.requestingMic = false;
          this.changed();
        }
      }
    }
  }

  window.PixelStowMediaPanel = MediaPanel;
})();
