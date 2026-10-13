// Camera acquisition belongs to the browser front end. The existing codec still
// decides whether a frame contains a complete, checksum-valid payload.
(function () {
  class PixelStowCamera {
    constructor({ importImage, report, working, changed, drawGuides }) {
      Object.assign(this, { importImage, report, working, changed, drawGuides });
      this.session = null;
      this.captureCanvas = document.createElement("canvas");
      this.openButton = document.querySelector("#open-camera");
      this.photoButton = document.querySelector("#take-photo");
      this.input = document.querySelector("#camera-file");
      this.panel = document.querySelector("#camera-panel");
      this.video = document.querySelector("#camera-video");
      this.view = document.querySelector("#camera-view");
      this.frame = document.querySelector("#camera-frame");
      this.captureButton = document.querySelector("#capture-frame");
      this.pauseButton = document.querySelector("#pause-camera");
      this.switchButton = document.querySelector("#switch-camera");
      this.closeButton = document.querySelector("#close-camera");
      this.rotateButton = document.querySelector("#rotate-camera");
      this.nativePhotoButton = document.querySelector("#camera-take-photo");
      this.progress = document.querySelector("#camera-progress");
      this.signature = document.querySelector("#camera-signature");
      this.nearMiss = document.querySelector("#camera-near-miss");
      this.nearSummary = document.querySelector("#camera-near-summary");
      this.still = document.querySelector("#camera-still");
      this.guides = document.querySelector("#camera-guides");
      this.useNearButton = document.querySelector("#use-camera-near-miss");
      // file:// can show a camera preview where permitted, but cannot run this
      // worker. Keep that route manual rather than continuously loading the UI.
      this.backgroundAvailable = typeof Worker !== "undefined" && ["https:", "http:"].includes(location.protocol);
      this.openButton.addEventListener("click", () => this.open());
      this.photoButton.addEventListener("click", () => this.takePhoto());
      this.nativePhotoButton.addEventListener("click", () => this.takePhoto());
      this.input.addEventListener("change", () => {
        const file = this.input.files?.[0];
        this.input.value = "";
        if (file && !this.working()) this.importImage(file, "camera");
      });
      this.captureButton.addEventListener("click", () => {
        const session = this.session;
        if (!session || session.handingOff || this.working()) return;
        try { this.accept(session, this.captureFrame()); }
        catch (error) { this.progress.textContent = error.message; }
      });
      this.useNearButton.addEventListener("click", () => {
        const session = this.session;
        if (session?.best && !session.handingOff && !this.working())
          this.accept(session, session.best.image, undefined, session.best.scan);
      });
      this.pauseButton.addEventListener("click", () => this.togglePause());
      this.rotateButton.addEventListener("click", () => {
        const session = this.session;
        if (!session?.ready || session.adjusting || session.handingOff || this.working()) return;
        session.rotation = (session.rotation + 90) % 360;
        this.cancelSearches(session, true);
        this.layoutPreview();
        this.progress.textContent = "View rotated. Keep all four picture corners inside the guides and hold steady.";
        this.schedule(session, 900);
      });
      this.switchButton.addEventListener("click", () => {
        if (!this.session || this.session.handingOff || this.working()) return;
        const facing = this.session.facing === "environment" ? "user" : "environment";
        this.close();
        this.open(facing);
      });
      this.closeButton.addEventListener("click", () => {
        this.close();
        this.report("Camera closed.");
      });
      this.panel.addEventListener("cancel", (event) => {
        event.preventDefault();
        this.close();
        this.report("Camera closed.");
      });
      // close is queued: switching cameras may already have reopened the dialog
      // by the time the previous close event arrives.
      this.panel.addEventListener("close", () => { if (this.active && !this.panel.open) this.close(); });
      this.video.addEventListener("loadedmetadata", () => this.sync());
      this.video.addEventListener("loadeddata", () => this.sync());
      this.video.addEventListener("resize", () => this.sync());
      // Status wrapping and a retained near miss can change the space available
      // to the preview without resizing the window.
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.layoutPreview()).observe(this.view);
      const viewportChanged = () => {
        this.layoutPreview();
        const session = this.session;
        if (!session) return;
        clearTimeout(session.orientationTimer);
        session.orientationTimer = setTimeout(() => this.refreshOrientation(session), 250);
      };
      window.addEventListener("resize", viewportChanged);
      window.visualViewport?.addEventListener("resize", viewportChanged);
      screen.orientation?.addEventListener("change", viewportChanged);
      window.addEventListener("orientationchange", viewportChanged);
      window.addEventListener("pagehide", () => this.close());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.active) {
          this.close();
          this.report("Camera closed while the page was away. Open camera to resume.");
        }
      });
      this.sync();
    }

    get active() { return Boolean(this.session); }

    takePhoto() {
      if (this.working() || this.session?.handingOff) return;
      this.close();
      this.input.value = "";
      this.input.click(); // Remain in the user gesture for iPhone's picker.
    }

    isPortrait() {
      // Physical orientation avoids mistaking a keyboard or Safari toolbar resize
      // for a device rotation. Older iOS exposes window.orientation instead.
      if (screen.orientation?.type) return screen.orientation.type.startsWith("portrait");
      if (typeof window.orientation === "number") return Math.abs(window.orientation) % 180 === 0;
      return window.matchMedia("(orientation: portrait)").matches;
    }

    videoConstraints(facing, portrait = this.isPortrait()) {
      return { facingMode: { ideal: facing }, width: { ideal: portrait ? 1920 : 2560 },
        height: { ideal: portrait ? 2560 : 1920 }, aspectRatio: { ideal: portrait ? 3 / 4 : 4 / 3 } };
    }

    layoutPreview() {
      const session = this.session, width = this.video.videoWidth, height = this.video.videoHeight;
      this.frame.hidden = !session?.ready || !width || !height;
      if (this.frame.hidden) return;
      const sideways = session.rotation % 180 !== 0;
      const frameWidth = sideways ? height : width, frameHeight = sideways ? width : height;
      const scale = Math.min(this.view.clientWidth / frameWidth, this.view.clientHeight / frameHeight);
      const w = frameWidth * scale, h = frameHeight * scale;
      // Fit the entire frame. The border follows actual video pixels, including
      // right-angle rotation, rather than an arbitrary CSS crop or screen shape.
      this.video.style.width = width * scale + "px";
      this.video.style.height = height * scale + "px";
      this.video.style.transform = "translate(-50%, -50%) rotate(" + session.rotation + "deg)";
      Object.assign(this.frame.style, { left: (this.view.clientWidth - w) / 2 + "px",
        top: (this.view.clientHeight - h) / 2 + "px", width: w + "px", height: h + "px" });
    }

    async refreshOrientation(session) {
      if (this.session !== session || !session.ready || session.handingOff || session.adjusting) return;
      const portrait = this.isPortrait();
      if (portrait === session.portrait) return;
      session.adjusting = true;
      session.rotation = 0;
      clearTimeout(session.timer);
      this.cancelSearches(session, true);
      this.progress.textContent = "Adjusting camera to the phone's orientation…";
      this.signature.textContent = "";
      this.sync();
      try {
        const track = session.stream?.getVideoTracks()[0];
        await track?.applyConstraints(this.videoConstraints(session.facing, portrait));
      } catch {
        // Ideals are advisory. Retain a usable feed if the camera cannot change
        // its format; guides still reflect it and Rotate view remains available.
      } finally {
        session.adjusting = false;
        if (this.session === session && !session.handingOff) {
          session.portrait = portrait;
          this.progress.textContent = session.paused ? "Scanning paused. Reframe, then resume or capture and read."
            : "Camera ready. Keep all four picture corners inside the guides and hold steady…";
          this.sync();
          // A second rotation during applyConstraints is handled in order.
          this.refreshOrientation(session);
          this.schedule(session, 900);
        }
      }
    }

    sync() {
      const session = this.session, locked = this.working();
      const ready = Boolean(session?.ready && !session.adjusting && this.video.readyState >= 2 && this.video.videoWidth && this.video.videoHeight);
      this.panel.hidden = !session;
      this.openButton.disabled = locked || Boolean(session);
      this.photoButton.disabled = this.input.disabled = locked || Boolean(session?.handingOff);
      this.nativePhotoButton.disabled = locked || Boolean(session?.handingOff);
      this.captureButton.disabled = locked || !ready || Boolean(session?.handingOff);
      this.pauseButton.hidden = !this.backgroundAvailable;
      this.pauseButton.disabled = locked || !session?.ready || !this.backgroundAvailable || Boolean(session?.handingOff);
      this.pauseButton.textContent = session?.paused ? "Resume scanning" : "Pause scanning";
      this.switchButton.disabled = this.rotateButton.disabled = locked || !ready || Boolean(session?.handingOff);
      this.useNearButton.disabled = locked || !session?.best || Boolean(session?.handingOff);
      this.layoutPreview();
    }

    async open(facing = "environment") {
      if (this.active || this.working()) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        this.report("Live camera needs a supported browser on HTTPS or localhost. Use Take photo instead.", true);
        return;
      }
      const session = { facing, ready: false, paused: !this.backgroundAvailable, frames: 0, lastTime: -1,
        rotation: 0, portrait: this.isPortrait(), history: [], appraised: 0 };
      this.session = session;
      this.signature.textContent = "";
      this.progress.textContent = "Allow camera access to start the preview…";
      this.changed();
      try {
        this.panel.showModal();
        document.documentElement.classList.add("camera-modal-open");
        document.body.classList.add("camera-modal-open");
        // Ideals allow a lower-resolution webcam to work too. Never request the
        // microphone, crop to the CSS preview, or rescale captured video pixels.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: this.videoConstraints(facing, session.portrait) });
        if (this.session !== session) { stream.getTracks().forEach((track) => track.stop()); return; }
        session.stream = stream;
        const track = stream.getVideoTracks()[0];
        session.facing = track.getSettings().facingMode || facing;
        track.addEventListener("ended", () => {
          if (this.session !== session || session.handingOff) return;
          this.close();
          this.report("Camera disconnected. Open camera again or use Take photo.", true);
        });
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.srcObject = stream;
        await this.video.play();
        if (this.session !== session) return;
        session.ready = true;
        this.sync();
        this.progress.textContent = this.backgroundAvailable
          ? "Camera ready. Keep all four picture corners inside the guides and hold steady while frames are checked…"
          : "Preview ready. Tap Capture and read. Automatic background scanning needs HTTPS or localhost.";
        this.refreshOrientation(session);
        this.schedule(session, 900); // Let the camera settle focus/exposure first.
      } catch (error) {
        if (this.session !== session) return;
        this.close();
        const message = error?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser, or use Take photo."
          : error?.name === "NotFoundError" ? "No camera is available. Choose an image or use Take photo on a phone."
          : "Could not start the camera. Try Take photo, or close other apps using the camera.";
        this.report(message, true);
      }
    }

    close() {
      const session = this.session;
      if (!session) return;
      // Invalidate first: late permission/play/worker results cannot reopen the
      // camera or replace a newer input, even if the user closes and reopens it.
      this.session = null;
      clearTimeout(session.timer);
      clearTimeout(session.orientationTimer);
      this.cancelSearches(session, true);
      session.stream?.getTracks().forEach((track) => track.stop());
      this.video.pause();
      this.video.srcObject = null;
      if (this.panel.open) this.panel.close();
      document.documentElement.classList.remove("camera-modal-open");
      document.body.classList.remove("camera-modal-open");
      this.frame.hidden = true;
      this.nearMiss.hidden = true;
      this.still.width = this.still.height = this.guides.width = this.guides.height = 0;
      this.captureCanvas.width = this.captureCanvas.height = 0;
      this.changed();
    }

    togglePause() {
      const session = this.session;
      if (!session?.ready || session.handingOff || !this.backgroundAvailable || this.working()) return;
      session.paused = !session.paused;
      clearTimeout(session.timer);
      if (session.paused) {
        this.cancelSearches(session);
        this.progress.textContent = "Scanning paused. Reframe the live view, then resume or capture and read.";
      } else {
        this.progress.textContent = "Scanning resumed. Hold the picture steady…";
        this.schedule(session, 400);
      }
      this.sync();
    }

    schedule(session, delay = 700) {
      if (this.session !== session || session.paused || session.adjusting || session.handingOff) return;
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.scan(session), delay);
    }

    captureFrame() {
      const rawWidth = this.video.videoWidth, rawHeight = this.video.videoHeight;
      if (this.session?.adjusting || this.video.readyState < 2 || !rawWidth || !rawHeight) throw new Error("Wait for the live camera picture, then try again.");
      const rotation = this.session?.rotation || 0, sideways = rotation % 180 !== 0;
      const width = sideways ? rawHeight : rawWidth, height = sideways ? rawWidth : rawHeight;
      if (width * height > 24000000) throw new Error("This camera frame is too large. Use Take photo with an image under 24 megapixels.");
      const canvas = this.captureCanvas;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.save();
      context.imageSmoothingEnabled = false;
      context.translate(width / 2, height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(this.video, -rawWidth / 2, -rawHeight / 2, rawWidth, rawHeight);
      context.restore();
      return { pixels: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), width, height, exact: true };
    }

    cancelSearches(session, clearHistory = false) {
      session.abort?.abort();
      session.readAbort?.abort();
      session.pending = null;
      session.appraised = 0;
      if (clearHistory) {
        session.history = []; session.best = null;
        session.tracking = null;
        this.displayedFrame = null;
        this.nearMiss.hidden = true;
        this.still.width = this.still.height = this.guides.width = this.guides.height = 0;
      }
    }

    retainFrame(session, entry) {
      // Only marker-bearing frames enter history. Keep at most three, and at
      // most 48 MiB of retained RGBA (one oversized frame may be retained alone).
      const history = session.history.filter((frame) => Date.now() - frame.capturedAt < 45000);
      if (entry.scan.markers?.length) history.push(entry);
      // Keep an attempted frame for feedback, but don't let old failed captures
      // occupy every history slot and starve newer candidates of a payload read.
      const attempted = history.filter((frame) => frame.attempted).sort((a, b) => b.score - a.score)[0];
      const retained = history.filter((frame) => !frame.attempted || frame === attempted);
      retained.sort((a, b) => Number(a.attempted || false) - Number(b.attempted || false) || b.score - a.score || b.frameNumber - a.frameNumber);
      let bytes = 0;
      session.history = retained.filter((frame, index) => {
        bytes += frame.image.pixels.byteLength;
        return index < 3 && (index === 0 || bytes <= 48 * 1024 * 1024);
      });
      session.best = session.history[0];
      this.showBestFrame(session);
    }

    showBestFrame(session) {
      const entry = session.best;
      if (!entry) {
        this.nearMiss.hidden = true;
        this.displayedFrame = null;
        this.still.width = this.still.height = this.guides.width = this.guides.height = 0;
        return;
      }
      const { image, scan, frameNumber } = entry;
      if (this.displayedFrame !== entry) {
        this.still.width = image.width; this.still.height = image.height;
        this.still.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.pixels.buffer,
          image.pixels.byteOffset, image.pixels.byteLength), image.width, image.height), 0, 0);
        this.drawGuides(this.guides, scan, image.width, image.height);
        this.displayedFrame = entry;
      }
      this.nearSummary.textContent = "Best capture · frame " + frameNumber + ": " + scan.markers.length +
        "/8 markers; " + (entry.state || (entry.inspection?.unreadable ? "contents did not pass their checks" : entry.attempted ? "reading contents" : "waiting for frame appraisal"));
      this.nearMiss.hidden = false;
      this.sync();
    }

    scan(session) {
      if (this.session !== session || session.paused || session.adjusting || session.handingOff) return;
      if (this.video.readyState < 2 || this.video.currentTime === session.lastTime) {
        this.schedule(session);
        return;
      }
      session.lastTime = this.video.currentTime;
      try {
        // Refresh this one slot even during a long payload read. The next marker
        // scan starts from the current framing, rather than an old queued frame.
        session.pending = { image: this.captureFrame(), frameNumber: ++session.frames, capturedAt: Date.now() };
        this.scanMarkers(session);
      } catch (error) {
        session.paused = true;
        this.cancelSearches(session);
        this.progress.textContent = error.message;
        this.sync();
      }
      this.schedule(session, 900);
    }

    async scanMarkers(session) {
      if (this.session !== session || session.paused || session.adjusting || session.scanning || session.handingOff || !session.pending) return;
      session.scanning = true;
      const entry = session.pending;
      session.pending = null;
      const { image, frameNumber } = entry;
      const controller = new AbortController();
      session.abort = controller;
      try {
        const prefix = "Frame " + frameNumber + " · " + image.width + " × " + image.height + ": ";
        if (!session.reading) this.signature.textContent = "";
        const previous = session.tracking?.scan;
        const header = previous?.markers?.find((m) => m.verification === "header");
        const scan = await PixelStow.scanMarkers(image.pixels, image.width, image.height, {
          mode: "perspective", camera: true, deadline: Date.now() + (header ? 12000 : 24000), signal: controller.signal,
          seed: previous?.width === image.width && previous?.height === image.height && header
            ? { ...header, initialMatrix: previous.geometry?.matrix } : undefined,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted && !session.reading) this.progress.textContent = prefix + text; },
          onSignature: (signature) => { if (this.session === session && !controller.signal.aborted) this.signature.textContent = signature.message; }
        });
        if (this.session !== session || controller.signal.aborted) return;
        entry.scan = scan;
        session.tracking = scan.markers?.some((m) => m.verification === "header") ? { scan } : null;
        entry.score = scan.candidates?.[0]?.geometry.rank ?? (scan.markers?.length || 0);
        this.retainFrame(session, entry);
        session.appraised++;
        if (scan.candidates?.length && session.readEntry && !session.readAbort?.signal.aborted && entry.score > session.readEntry.score) {
          session.readEntry.state = "replaced by a stronger capture";
          session.appraised = Math.max(2, session.appraised);
          session.readAbort.abort(); // Terminates the payload worker, not just its UI updates.
          this.progress.textContent = "A stronger marker fit was found. Switching to frame " + frameNumber + "…";
        }
        this.signature.textContent = scan.highConfidence
          ? "All eight markers agree strongly. Reading the most promising capture."
          : scan.markers?.length ? "Recovery markers verified. Comparing captures before reading contents."
          : scan.signature?.likely ? "Frequency hints found; no verified markers in this capture."
            : "No encoding signature or checksum-valid markers found.";
        if (!session.reading) this.progress.textContent = prefix + (scan.candidates?.length
          ? "Marker scan complete. Ranking the recent captures…"
          : "No stable marker fit. Reframe and hold steady; checking a fresh capture…");
        this.readBestFrame(session);
      } catch (error) {
        if (this.session !== session || controller.signal.aborted) return;
        session.paused = true;
        this.cancelSearches(session);
        this.progress.textContent = (error?.message || "The camera scan could not finish.") + " Scanning paused; resume or use Take photo.";
        this.sync();
      } finally {
        session.scanning = false;
        if (session.abort === controller) session.abort = null;
        if (this.session === session && !session.paused && !session.adjusting && !session.handingOff) this.scanMarkers(session);
      }
    }

    async readBestFrame(session) {
      if (this.session !== session || session.paused || session.adjusting || session.reading || session.handingOff) return;
      const entry = session.history.find((frame) => !frame.attempted && frame.scan.candidates?.length && Date.now() - frame.capturedAt < 45000);
      if (!entry) return; // Never spend a payload read on a marker-free capture.
      if (session.appraised < 2 && !entry.scan.highConfidence) return;
      session.appraised = 0;
      session.reading = true;
      session.readEntry = entry;
      entry.attempted = true;
      entry.state = undefined;
      const controller = new AbortController();
      session.readAbort = controller;
      // A bad capture cannot monopolize the reader indefinitely. Fresh marker
      // scans continue independently; their best result is next in rank order.
      const timer = setTimeout(() => controller.abort(), 30000);
      this.showBestFrame(session);
      try {
        const { image, scan, frameNumber } = entry;
        const inspection = await PixelStow.readMarkerCandidates(image.pixels, image.width, image.height, scan, {
          signal: controller.signal,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted)
            this.progress.textContent = "Reading best capture · frame " + frameNumber + ": " + text; }
        });
        if (this.session !== session || controller.signal.aborted) return;
        entry.inspection = inspection;
        if (inspection.found && !inspection.unreadable) {
          await this.accept(session, image, inspection);
          return;
        }
        this.progress.textContent = "This capture's contents did not pass their checks. Comparing fresher captures…";
        this.showBestFrame(session);
      } catch (error) {
        if (this.session !== session) return;
        if (controller.signal.aborted) {
          // Pause/orientation cancellation permits a retry; a time-limited bad
          // frame is skipped while newer marker-bearing frames are considered.
          if (session.paused || session.adjusting) entry.attempted = false;
          else if (!entry.state) entry.state = "read time limit reached";
        } else {
          entry.state = "read could not finish";
          this.progress.textContent = error?.message || "Could not read this capture. Trying another promising frame…";
        }
      } finally {
        clearTimeout(timer);
        session.reading = false;
        session.readEntry = null;
        if (session.readAbort === controller) session.readAbort = null;
        if (this.session === session && !session.handingOff) this.showBestFrame(session);
        this.readBestFrame(session);
      }
    }

    async accept(session, image, inspection, markerScan) {
      if (this.session !== session || session.handingOff) return;
      session.handingOff = true;
      session.paused = true;
      clearTimeout(session.timer);
      this.cancelSearches(session);
      session.stream?.getTracks().forEach((track) => track.stop());
      this.progress.textContent = inspection?.found && !inspection.unreadable ? "Encoded contents found. Opening this capture…" : "Opening this capture…";
      this.sync();
      try {
        // Preserve the inspected raster losslessly for exports/sharing. The UI
        // receives the same pixel object whose geometry was cached by inspect.
        const blob = await PixelStow.writePng(image.pixels, image.width, image.height);
        if (this.session !== session) return;
        const name = "camera-capture-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
        const file = new File([blob], name, { type: "image/png" });
        this.close();
        await this.importImage(file, "camera", { image, inspection, markerScan });
      } catch (error) {
        if (this.session !== session) return;
        this.close();
        this.report(error?.message || "Could not open the captured frame. Try Take photo.", true);
      }
    }
  }
  window.PixelStowCamera = PixelStowCamera;
})();
