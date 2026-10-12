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
      this.captureButton = document.querySelector("#capture-frame");
      this.pauseButton = document.querySelector("#pause-camera");
      this.switchButton = document.querySelector("#switch-camera");
      this.closeButton = document.querySelector("#close-camera");
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
      this.photoButton.addEventListener("click", () => {
        if (this.working() || this.session?.handingOff) return;
        this.close();
        this.input.value = "";
        this.input.click(); // Remain in the user gesture for iPhone's picker.
      });
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
        if (session?.best && !session.handingOff && !this.working()) this.accept(session, session.best.image, session.best.inspection);
      });
      this.pauseButton.addEventListener("click", () => this.togglePause());
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
      this.video.addEventListener("loadeddata", () => this.sync());
      this.video.addEventListener("resize", () => this.sync());
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

    sync() {
      const session = this.session, locked = this.working();
      const ready = Boolean(session?.ready && this.video.readyState >= 2 && this.video.videoWidth && this.video.videoHeight);
      this.panel.hidden = !session;
      this.openButton.disabled = locked || Boolean(session);
      this.photoButton.disabled = this.input.disabled = locked || Boolean(session?.handingOff);
      this.captureButton.disabled = locked || !ready || Boolean(session?.handingOff);
      this.pauseButton.hidden = !this.backgroundAvailable;
      this.pauseButton.disabled = locked || !session?.ready || !this.backgroundAvailable || Boolean(session?.handingOff);
      this.pauseButton.textContent = session?.paused ? "Resume scanning" : "Pause scanning";
      this.switchButton.disabled = locked || !session?.ready || Boolean(session?.handingOff);
      this.useNearButton.disabled = locked || !session?.best || Boolean(session?.handingOff);
    }

    async open(facing = "environment") {
      if (this.active || this.working()) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        this.report("Live camera needs a supported browser on HTTPS or localhost. Use Take photo instead.", true);
        return;
      }
      const session = { facing, ready: false, paused: !this.backgroundAvailable, frames: 0, lastTime: -1 };
      this.session = session;
      this.signature.textContent = "";
      this.progress.textContent = "Allow camera access to start the preview…";
      this.changed();
      this.panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
      try {
        // Ideals allow a lower-resolution webcam to work too. Never request the
        // microphone, crop to the CSS preview, or rescale captured video pixels.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1440 }
        } });
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
          ? "Camera ready. Hold the picture steady while frames are checked…"
          : "Preview ready. Use this frame to read a photo. Automatic background scanning needs HTTPS or localhost.";
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
      session.abort?.abort();
      session.stream?.getTracks().forEach((track) => track.stop());
      this.video.pause();
      this.video.srcObject = null;
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
        session.abort?.abort();
        this.progress.textContent = "Scanning paused. Reframe the live view, then resume or use this frame.";
      } else {
        this.progress.textContent = "Scanning resumed. Hold the picture steady…";
        if (!session.scanning) this.schedule(session, 400);
      }
      this.sync();
    }

    schedule(session, delay = 700) {
      if (this.session !== session || session.paused || session.handingOff || session.scanning) return;
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.scan(session), delay);
    }

    captureFrame() {
      const width = this.video.videoWidth, height = this.video.videoHeight;
      if (this.video.readyState < 2 || !width || !height) throw new Error("Wait for the live camera picture, then try again.");
      if (width * height > 24000000) throw new Error("This camera frame is too large. Use Take photo with an image under 24 megapixels.");
      const canvas = this.captureCanvas;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(this.video, 0, 0, width, height);
      return { pixels: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), width, height, exact: true };
    }

    showNearMiss(session, image, inspection, frameNumber) {
      if (!inspection.unreadable || !inspection.markers?.length) return;
      // Retain one useful miss, not a growing history of camera-sized buffers.
      if (session.best && session.best.inspection.markers.length > inspection.markers.length) return;
      session.best = { image, inspection };
      this.still.width = image.width; this.still.height = image.height;
      this.still.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.pixels.buffer,
        image.pixels.byteOffset, image.pixels.byteLength), image.width, image.height), 0, 0);
      this.drawGuides(this.guides, inspection, image.width, image.height);
      this.nearSummary.textContent = "Frame " + frameNumber + ": " + inspection.markers.length + "/8 markers found; contents not yet readable";
      this.nearMiss.hidden = false;
      this.sync();
    }

    async scan(session) {
      if (this.session !== session || session.paused || session.scanning || session.handingOff) return;
      if (this.video.readyState < 2 || this.video.currentTime === session.lastTime) {
        this.schedule(session);
        return;
      }
      session.scanning = true;
      session.lastTime = this.video.currentTime;
      const controller = new AbortController();
      session.abort = controller;
      const frameNumber = ++session.frames;
      try {
        const image = this.captureFrame();
        const prefix = "Frame " + frameNumber + " · " + image.width + " × " + image.height + ": ";
        this.signature.textContent = "";
        const inspection = await PixelStow.inspect(image.pixels, image.width, image.height, {
          automatic: true, background: true, signal: controller.signal,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted) this.progress.textContent = prefix + text; },
          onSignature: (signature) => { if (this.session === session && !controller.signal.aborted) this.signature.textContent = signature.message; }
        });
        if (this.session !== session || controller.signal.aborted) return;
        if (inspection.found && !inspection.unreadable) {
          await this.accept(session, image, inspection);
          return;
        }
        this.showNearMiss(session, image, inspection, frameNumber);
        this.progress.textContent = prefix + (inspection.unreadable
          ? "Markers found, but contents could not be read. Reframe and hold steady for the next capture."
          : inspection.signature?.likely ? "Encoding pattern detected, but no readable contents. Trying a fresh frame…"
            : "No readable encoding found. Point at the encoded picture; another frame will be checked…");
      } catch (error) {
        if (this.session !== session || controller.signal.aborted) return;
        session.paused = true;
        this.progress.textContent = (error?.message || "The camera scan could not finish.") + " Scanning paused; resume or use Take photo.";
        this.sync();
      } finally {
        session.scanning = false;
        if (session.abort === controller) session.abort = null;
        this.schedule(session);
      }
    }

    async accept(session, image, inspection) {
      if (this.session !== session || session.handingOff) return;
      session.handingOff = true;
      session.paused = true;
      clearTimeout(session.timer);
      session.abort?.abort();
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
        await this.importImage(file, "camera", { image, inspection });
      } catch (error) {
        if (this.session !== session) return;
        this.close();
        this.report(error?.message || "Could not open the captured frame. Try Take photo.", true);
      }
    }
  }
  window.PixelStowCamera = PixelStowCamera;
})();
