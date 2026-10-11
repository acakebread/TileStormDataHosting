// Browser attachment and recording UI. Payload serialization belongs to pixelstow.js.
(function () {
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
      this.audioAction = document.querySelector("#audio-action");
      this.voiceButton = document.querySelector("#play-voice");
      this.previewVoiceButton = document.querySelector("#preview-audio");
      this.voiceStatus = document.querySelector("#voice-status");
      this.voiceAudio = null;
      const toggleVoice = () => {
        if (this.busy || !this.voiceAudio) return;
        if (!this.voiceAudio.audio.paused) this.voiceAudio.audio.pause();
        else {
          if (this.voiceAudio.audio.ended) this.voiceAudio.audio.currentTime = 0;
          this.playVoice(this.voiceAudio);
        }
      };
      this.voiceButton.addEventListener("click", toggleVoice);
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
      window.addEventListener("pagehide", () => this.reset());
      this.sync();
    }

    get active() { return this.pending || Boolean(this.recording); }

    sync() {
      const disabled = this.busy || this.locked || this.active;
      this.input.disabled = disabled || this.files.length >= 8;
      this.kind.disabled = disabled;
      const supported = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
      this.recordButton.disabled = disabled || this.files.length >= 8 || !supported;
      this.stopButton.hidden = !this.recording;
      this.cancelButton.hidden = !this.recording && !this.requestingMic;
      this.list.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
      this.voiceButton.disabled = this.busy || !this.voiceAudio;
      this.previewVoiceButton.disabled = this.voiceButton.disabled;
      if (!supported && !this.active) this.recordStatus.textContent = "Microphone recording needs a supported browser on HTTPS or localhost. You can still attach an audio file.";
    }

    setState(busy, locked) {
      this.busy = busy;
      this.locked = locked;
      this.sync();
    }

    async addFiles(files) {
      if (!files.length || this.busy || this.locked || this.active) return;
      if (this.files.length + files.length > 8) return this.report("You can attach up to eight files.", true);
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

    clearUrls(group, container) {
      if (group === "decoded") {
        this.voiceAudio = null;
        this.audioAction.hidden = true;
        this.previewVoiceButton.hidden = true;
        this.voiceStatus.textContent = "";
        this.voiceButton.textContent = "Play voice message";
        this.previewVoiceButton.textContent = "Play audio";
      }
      container.querySelectorAll("audio").forEach((audio) => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      for (const url of this.urls[group]) URL.revokeObjectURL(url);
      this.urls[group] = [];
      container.replaceChildren();
    }

    render(container, files, group, autoplay) {
      this.clearUrls(group, container);
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
          const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
          this.urls[group].push(url);
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = group === "decoded" ? "auto" : "metadata";
          audio.muted = false;
          audio.volume = 1;
          audio.src = url;
          audio.setAttribute("aria-label", "Play " + file.name);
          row.appendChild(audio);
          const hint = document.createElement("p");
          hint.className = "hint";
          const voice = { audio, hint, name: file.name, playAttempt: 0 };
          audio.addEventListener("error", () => {
            if (!audio.error) return;
            hint.textContent = audio.error.code === 3 || audio.error.code === 4
              ? "This browser cannot play this audio format. Download the file to listen in another player."
              : "Playback was interrupted. Press Play to try again.";
            if (this.voiceAudio === voice) this.voiceStatus.textContent = hint.textContent;
          });
          if (group === "decoded") {
            audio.addEventListener("play", () => {
              if (!this.decoded.contains(audio)) return;
              voice.playAttempt++;
              this.decoded.querySelectorAll("audio").forEach((other) => { if (other !== audio) other.pause(); });
              this.voiceAudio = voice;
              this.voiceButton.textContent = "Pause voice message";
              this.previewVoiceButton.textContent = "Pause audio";
              this.voiceStatus.textContent = "Playing " + file.name;
              hint.textContent = "";
            });
            audio.addEventListener("playing", () => {
              hint.textContent = "";
              if (this.voiceAudio === voice) this.voiceStatus.textContent = "Playing " + file.name;
            });
            ["pause", "ended"].forEach((event) => audio.addEventListener(event, () => {
              if (this.voiceAudio !== voice) return;
              voice.playAttempt++;
              this.voiceButton.textContent = "Play voice message";
              this.previewVoiceButton.textContent = "Play audio";
              this.voiceStatus.textContent = audio.ended ? "Message finished. Tap Play to hear it again." : "Message paused.";
            }));
          }
          row.appendChild(hint);
          if (!firstAudio) firstAudio = voice;
        }
        container.appendChild(row);
      });
      if (group === "decoded" && firstAudio) {
        this.voiceAudio = firstAudio;
        this.audioAction.hidden = false;
        this.previewVoiceButton.hidden = false;
        this.voiceStatus.textContent = "Audio attached. Tap Play voice message to listen.";
        if (autoplay) this.playVoice(firstAudio);
      }
      this.sync();
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
      voice.audio.play().catch((error) => {
        if (this.voiceAudio !== voice || voice.playAttempt !== attempt || !voice.audio.paused) return;
        this.voiceButton.textContent = "Play voice message";
        this.previewVoiceButton.textContent = "Play audio";
        const hint = voice.audio.error?.code === 3 || voice.audio.error?.code === 4 || error.name === "NotSupportedError"
          ? "This browser cannot play this audio format. Download the file to listen in another player."
          : error.name === "AbortError" ? "Playback was interrupted. Press Play to try again."
          : "Press Play to hear the message. Your browser did not start playback automatically.";
        voice.hint.textContent = hint;
        this.voiceStatus.textContent = hint;
      });
    }

    showDecoded(files, autoplay = true) {
      this.render(this.decoded, files, "decoded", autoplay);
      this.decodedSection.hidden = files.length === 0;
    }

    reset() {
      this.generation++;
      this.stopRecording(true);
      this.files.forEach((file) => file.bytes.fill(0));
      this.files = [];
      this.input.value = "";
      this.clearUrls("compose", this.list);
      this.clearUrls("decoded", this.decoded);
      this.decodedSection.hidden = true;
      this.recordStatus.textContent = "";
      this.sync();
    }

    stopRecording(cancel = false) {
      const job = this.recording;
      if (!job) {
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
      clearInterval(job.timer);
      if (job.recorder.state !== "inactive") job.recorder.stop();
      job.stream.getTracks().forEach((track) => track.stop());
    }

    async startRecording() {
      if (this.busy || this.locked || this.active || this.files.length >= 8) return;
      let budget;
      try { budget = this.remaining(); }
      catch (error) { return this.report(error.message || "Check the message before recording.", true); }
      if (budget < 2048) return this.report("This photo has little room left. Use a larger picture or remove an attachment before recording.", true);
      const generation = this.generation;
      this.pending = true;
      this.requestingMic = true;
      this.changed();
      this.recordStatus.textContent = "Requesting microphone access…";
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        // AAC in MP4 plays on older iPhones too; use Opus when MP4 recording is unavailable.
        const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
        const options = { audioBitsPerSecond: 16000 };
        if (mimeType) options.mimeType = mimeType;
        const recorder = new MediaRecorder(stream, options);
        this.requestingMic = false;
        const job = { recorder, stream, chunks: [], size: 0, started: performance.now(), cancelled: false, timer: null };
        this.recording = job;
        const update = () => {
          const seconds = (performance.now() - job.started) / 1000;
          this.recordStatus.textContent = "Recording: " + seconds.toFixed(1) + " s · " + job.size.toLocaleString("en-GB") + " / about " + budget.toLocaleString("en-GB") + " bytes. Maximum 30 seconds.";
          if (seconds >= 30 || job.size >= Math.max(1024, budget - 1024)) this.stopRecording();
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
          stream.getTracks().forEach((track) => track.stop());
          try {
            if (!job.cancelled && generation === this.generation) {
              const type = recorder.mimeType || mimeType || "audio/webm";
              const blob = new Blob(job.chunks, { type });
              if (!blob.size) throw new Error("The recording was empty. Try recording again.");
              const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
              const name = "voice-message-" + (this.files.length + 1) + "." + extension;
              const attachment = { name, type, bytes: new Uint8Array(await blob.arrayBuffer()) };
              if (generation !== this.generation) return;
              PixelStow.payloadSize("", [...this.files, attachment]);
              this.files.push(attachment);
              this.render(this.list, this.files, "compose", false);
              this.recordStatus.textContent = "Recording attached. Listen before encoding; remove it to record again.";
              this.report(blob.size > budget ? "The recording may be too large for this photo. Use a larger image or make a shorter recording." : "Voice message attached. You can encode it with or without text.", blob.size > budget);
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
        recorder.start(250);
        job.timer = setInterval(update, 250);
        update();
      } catch (error) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (generation !== this.generation) return;
        this.recording = null;
        this.recordStatus.textContent = "";
        this.report(error.name === "NotAllowedError" ? "Microphone access was denied. Allow it in your browser to record, or attach an audio file." : "Could not start the microphone. Check it is connected, or attach an audio file.", true);
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
