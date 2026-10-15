// Camera acquisition belongs to the browser front end. The existing codec still
// decides whether a frame contains a complete, checksum-valid payload.
(function () {
  class PixelStowCamera {
    constructor({ importImage, report, working, changed, drawGuides, clearFeedback, prepareCapture }) {
      Object.assign(this, { importImage, report, working, changed, drawGuides, clearFeedback, prepareCapture });
      this.session = null;
      this.devices = [];
      this.devicesKnown = false;
      this.preferredDeviceId = null;
      this.failedDevices = new Set();
      this.switchOperation = null;
      // Desktop file inputs ignore capture and open a file picker. Keep the
      // native still-camera route for phones/tablets, including desktop-UA iPads.
      this.nativePhotoCapture = Boolean(navigator.userAgentData?.mobile ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
      this.captureCanvas = document.createElement("canvas");
      this.openButton = document.querySelector("#open-camera");
      this.sourceButton = document.querySelector("#camera-source");
      this.input = document.querySelector("#camera-file");
      this.panel = document.querySelector("#camera-panel");
      this.title = document.querySelector("#camera-title");
      this.help = document.querySelector("#camera-help");
      this.target = document.querySelector(".camera-target");
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
      this.readProgress = new PixelStowReadProgress(document.querySelector("#camera-read-status"));
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
      this.sourceButton.addEventListener("click", () => this.open("environment", "source"));
      this.nativePhotoButton.addEventListener("click", () => this.takePhoto(this.session?.purpose));
      this.input.addEventListener("change", () => {
        const file = this.input.files?.[0];
        const sourceOnly = this.inputPurpose === "source";
        this.inputPurpose = "read";
        this.input.value = "";
        if (file && !this.working()) this.importImage(file, "camera", sourceOnly ? { sourceOnly: true } : undefined);
      });
      this.input.addEventListener("cancel", () => { this.inputPurpose = "read"; });
      this.captureButton.addEventListener("click", () => this.captureCurrent());
      // Capture on a deliberate tap, never at the end of a drag or pinch.
      this.view.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0) { this.viewTap = null; return; }
        this.viewTap = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now(), session: this.session };
      });
      this.view.addEventListener("pointermove", (event) => {
        if (this.viewTap?.id === event.pointerId && Math.hypot(event.clientX - this.viewTap.x, event.clientY - this.viewTap.y) > 8)
          this.viewTap = null;
      });
      this.view.addEventListener("pointerup", (event) => {
        const tap = this.viewTap;
        this.viewTap = null;
        if (tap?.id === event.pointerId && tap.session === this.session && Date.now() - tap.at < 500) this.captureCurrent();
      });
      for (const type of ["pointercancel", "pointerleave"]) this.view.addEventListener(type, () => { this.viewTap = null; });
      this.view.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (!event.repeat) this.captureCurrent();
      });
      this.view.addEventListener("click", (event) => { if (event.detail === 0) this.captureCurrent(); });
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
        this.progress.textContent = session.purpose === "source" ? "View rotated. Frame your source photo, then capture it."
          : "View rotated. Keep all four picture corners inside the guides and hold steady.";
        this.schedule(session, 900);
      });
      this.switchButton.addEventListener("click", () => this.switchCamera());
      navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
        this.failedDevices.clear();
        if (!this.active) return;
        await this.refreshDevices();
        this.sync();
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
      // Refit when viewport or camera controls change size.
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
          this.report("Camera closed while the page was away. Tap Capture to resume.");
        }
      });
      this.sync();
    }

    get active() { return Boolean(this.session || this.switchOperation); }

    captureCurrent() {
      const session = this.session;
      if (!session?.ready || session.adjusting || session.handingOff || this.switchOperation || this.working() || this.video.readyState < 2) return;
      // Keep audio permission preparation in the actual shutter/tap gesture.
      this.prepareCapture?.();
      try { this.accept(session, this.captureFrame()); }
      catch (error) { this.progress.textContent = error.message; }
    }

    takePhoto(purpose = "read") {
      if (this.working() || this.switchOperation || this.session?.handingOff) return;
      // Photo is already showing the live source. Its shutter should use
      // that frame directly, without opening the phone's separate capture UI.
      if (this.session?.purpose === "source") {
        this.captureCurrent();
        return;
      }
      if (!this.nativePhotoCapture) {
        if (this.active) {
          this.captureCurrent();
        } else this.open("environment", purpose, { manualCapture: true });
        return;
      }
      this.close();
      this.inputPurpose = purpose;
      this.input.value = "";
      this.input.click(); // Remain in the user gesture for iPhone's picker.
    }

    async refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const ids = new Set();
        this.devices = devices.filter(device => {
          if (device.kind !== "videoinput" || !device.deviceId || ids.has(device.deviceId)) return false;
          ids.add(device.deviceId);
          return true;
        });
        this.devicesKnown = true;
      } catch { /* A permitted video stream remains usable without enumeration. */ }
    }

    async switchCamera() {
      const session = this.session;
      if (!session?.ready || session.adjusting || session.handingOff || this.switchOperation || this.working()) return;
      const operation = { cancelled: false };
      this.switchOperation = operation;
      session.adjusting = true;
      clearTimeout(session.timer);
      this.cancelSearches(session, true);
      this.progress.textContent = "Switching camera…";
      this.sync();
      try {
        await this.refreshDevices();
        if (this.session !== session || operation.cancelled) return;
        const choices = this.nextDevices(session.deviceId);
        if (!choices.length && !this.nativePhotoCapture) {
          session.adjusting = false;
          this.progress.textContent = "No other working camera is available to this browser.";
          this.schedule(session, 900);
          return;
        }
        const facing = session.facing === "environment" ? "user" : "environment";
        if (!choices.length) choices.push({ deviceId: null }); // Phone front/rear fallback.
        // If every alternative fails, try the last working camera once as well.
        if (session.deviceId) choices.push({ deviceId: session.deviceId, label: session.deviceLabel, restore: true });
        const skipped = [];
        let last;
        this.close(true);
        for (const device of choices) {
          if (operation.cancelled || this.switchOperation !== operation) return;
          last = await this.open(device.restore ? session.facing : facing, session.purpose, {
            deviceId: device.deviceId, manualCapture: session.manualCapture, paused: session.paused,
            switchOperation: operation, quietFailure: true
          });
          if (last?.cancelled || operation.cancelled) return;
          if (last?.ready) {
            if (skipped.length) this.progress.textContent += " Skipped unavailable cameras: " + skipped.join(", ") + ".";
            if (device.restore) this.progress.textContent += " Kept the last working camera.";
            return;
          }
          // Permission/security failures apply to camera access, not one format.
          if (["NotAllowedError", "SecurityError"].includes(last?.error?.name)) break;
          if (device.deviceId) this.failedDevices.add(device.deviceId);
          skipped.push(device.label || "camera");
        }
        if (!operation.cancelled) this.report("No camera in the remaining list could be opened. " + (last?.message || "Try reopening the camera."), true);
      } finally {
        if (this.switchOperation === operation) {
          this.switchOperation = null;
          this.changed();
          this.sync();
        }
      }
    }

    nextDevices(deviceId) {
      const index = this.devices.findIndex(device => device.deviceId === deviceId), choices = [];
      for (let offset = 1; offset <= this.devices.length; offset++) {
        const device = this.devices[(index + offset) % this.devices.length];
        if (device.deviceId !== deviceId && !this.failedDevices.has(device.deviceId)) choices.push(device);
      }
      return choices;
    }

    isPortrait() {
      // Physical orientation avoids mistaking a keyboard or Safari toolbar resize
      // for a device rotation. Older iOS exposes window.orientation instead.
      if (screen.orientation?.type) return screen.orientation.type.startsWith("portrait");
      if (typeof window.orientation === "number") return Math.abs(window.orientation) % 180 === 0;
      return window.matchMedia("(orientation: portrait)").matches;
    }

    videoConstraints(facing, portrait = this.isPortrait(), deviceId = null, profile = "preferred") {
      const selection = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } };
      if (profile === "default") return selection;
      if (profile === "basic") return { ...selection, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
      return { ...selection,
        width: { ideal: portrait ? 1920 : 2560 },
        height: { ideal: portrait ? 2560 : 1920 }, aspectRatio: { ideal: portrait ? 3 / 4 : 4 / 3 } };
    }

    async acquireStream(session, facing, deviceId) {
      // A driver can advertise a format which then fails during startup. Relax
      // format preferences on this device; an explicit switch keeps its exact ID.
      for (const profile of ["preferred", "default", "basic"]) {
        if (this.session !== session) throw new DOMException("Camera closed.", "AbortError");
        if (profile !== "preferred") this.progress.textContent = profile === "default"
          ? "Trying the camera's default capture settings…" : "Trying 640 × 480 camera compatibility settings…";
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
            video: this.videoConstraints(facing, session.portrait, deviceId, profile) });
          session.captureProfile = profile;
          return stream;
        } catch (error) {
          const missingDevice = error?.name === "NotFoundError" ||
            (error?.name === "OverconstrainedError" && error.constraint === "deviceId");
          if (this.session !== session || missingDevice || profile === "basic" ||
            !["NotReadableError", "AbortError", "OverconstrainedError"].includes(error?.name)) throw error;
        }
      }
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
        await track?.applyConstraints(this.videoConstraints(session.facing, portrait, session.deviceId, session.captureProfile));
      } catch {
        // Ideals are advisory. Retain a usable feed if the camera cannot change
        // its format; guides still reflect it and Rotate view remains available.
      } finally {
        session.adjusting = false;
        if (this.session === session && !session.handingOff) {
          session.portrait = portrait;
          this.progress.textContent = session.purpose === "source" ? "Camera ready. Frame your source photo, then tap Take source photo."
            : session.manualCapture ? "Camera ready. Frame your picture, then tap Capture and read."
            : session.paused ? "Scanning paused. Reframe, then resume or capture and read."
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
      this.openButton.disabled = locked || this.active;
      this.sourceButton.disabled = locked || this.active;
      this.input.disabled = locked || Boolean(this.switchOperation || session?.handingOff);
      this.nativePhotoButton.disabled = locked || Boolean(this.switchOperation || session?.handingOff);
      this.captureButton.disabled = locked || !ready || Boolean(this.switchOperation || session?.handingOff);
      this.view.setAttribute("aria-disabled", String(this.captureButton.disabled));
      const source = session?.purpose === "source";
      this.title.textContent = source ? "Camera source photo" : session?.manualCapture ? "Camera photo" : "Camera scanner";
      this.help.textContent = source ? "Frame a new photo to put your message and files inside. The whole outlined view is captured."
        : "Keep all four picture corners inside the guides. Move closer and hold steady.";
      if (session?.deviceLabel) this.help.textContent += " Camera: " + session.deviceLabel + ".";
      // Camera names are a warning cue, not proof that a feed is unusable.
      // In particular, ordinary "Back Wide Camera" is the standard rear lens.
      if (!source && /\b(?:dual(?:[\s_-]*wide)?|triple|ultra[\s_-]*wide)\b/i.test(session?.deviceLabel || "")) {
        const warning = document.createElement("span");
        warning.className = "camera-mode-warning";
        warning.textContent = " This camera mode may produce distorted frames and scan unreliably. Try a standard rear camera.";
        this.help.append(warning);
      }
      this.captureButton.textContent = source ? "Take source photo" : "Capture and read";
      this.view.setAttribute("aria-label", source ? "Take a source photo from the live camera preview" : "Capture and read the live camera preview");
      this.nativePhotoButton.textContent = "Take photo with phone camera";
      this.nativePhotoButton.hidden = source || !this.nativePhotoCapture;
      this.target.hidden = source;
      this.signature.hidden = source;
      this.pauseButton.hidden = source || Boolean(session?.manualCapture) || !this.backgroundAvailable;
      this.pauseButton.disabled = locked || !session?.ready || !this.backgroundAvailable || Boolean(this.switchOperation || session?.handingOff);
      this.pauseButton.textContent = session?.paused ? "Resume scanning" : "Pause scanning";
      this.rotateButton.disabled = locked || !ready || Boolean(this.switchOperation || session?.handingOff);
      const next = this.nextDevices(session?.deviceId)[0];
      this.switchButton.disabled = this.rotateButton.disabled || (!this.nativePhotoCapture && this.devicesKnown && !next);
      this.switchButton.title = next?.label ? "Switch to " + next.label : this.switchButton.disabled && ready
        ? "No other camera is available to this browser" : "Switch camera";
      this.useNearButton.disabled = locked || !session?.best || Boolean(session?.handingOff);
      this.layoutPreview();
    }

    async open(facing = "environment", purpose = "read", options = {}) {
      if (options.switchOperation?.cancelled) return { cancelled: true };
      if (this.session || (this.switchOperation && this.switchOperation !== options.switchOperation) || this.working()) return;
      if (!options.switchOperation) this.failedDevices.clear();
      if (!navigator.mediaDevices?.getUserMedia) {
        if (this.nativePhotoCapture) { this.takePhoto(purpose); return; }
        this.report("Live camera needs a supported browser on HTTPS or localhost. Use Browse to load a saved photo.", true);
        return;
      }
      let deviceId = options.deviceId === undefined ? this.preferredDeviceId : options.deviceId;
      const session = { facing, purpose, deviceId, deviceLabel: this.devices.find(device => device.deviceId === deviceId)?.label || "",
        manualCapture: Boolean(options.manualCapture), ready: false,
        paused: purpose === "source" || Boolean(options.manualCapture || options.paused) || !this.backgroundAvailable, frames: 0, lastTime: -1,
        rotation: 0, portrait: this.isPortrait(), history: [], appraised: 0 };
      this.session = session;
      this.clearFeedback?.();
      this.signature.textContent = "";
      if (purpose === "source") this.readProgress.finish("Frame your source photo, then capture it.", "source");
      else this.readProgress.begin("Waiting for a camera frame…");
      this.progress.textContent = "Allow camera access to start the preview…";
      this.changed();
      try {
        this.panel.showModal();
        document.documentElement.classList.add("camera-modal-open");
        document.body.classList.add("camera-modal-open");
        // Ideals allow a lower-resolution webcam to work too. Never request the
        // microphone, crop to the CSS preview, or rescale captured video pixels.
        let stream;
        try {
          stream = await this.acquireStream(session, facing, deviceId);
        } catch (error) {
          // A remembered camera may have been unplugged since the last session.
          // An explicit switch must fail rather than silently reopen the old one.
          const missingDevice = error?.name === "NotFoundError" ||
            (error?.name === "OverconstrainedError" && error.constraint === "deviceId");
          if (this.session !== session || !deviceId || options.deviceId !== undefined || !missingDevice) throw error;
          this.preferredDeviceId = null;
          deviceId = session.deviceId = null;
          stream = await this.acquireStream(session, facing, null);
        }
        if (this.session !== session) { stream.getTracks().forEach((track) => track.stop()); return { cancelled: true }; }
        session.stream = stream;
        const track = stream.getVideoTracks()[0];
        session.facing = track.getSettings().facingMode || facing;
        session.deviceId = track.getSettings().deviceId || deviceId;
        session.deviceLabel = track.label;
        await this.refreshDevices();
        if (this.session !== session) return { cancelled: true };
        if (!session.deviceId) session.deviceId = this.devices.find(device => device.label === track.label)?.deviceId || null;
        track.addEventListener("ended", () => {
          if (this.session !== session || session.handingOff) return;
          this.close();
          this.report("Camera disconnected. Tap Capture to try again, or Browse to load a saved photo.", true);
        });
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.srcObject = stream;
        await this.video.play();
        if (this.session !== session) return { cancelled: true };
        session.ready = true;
        // Only a live, playable camera becomes the remembered selection.
        this.preferredDeviceId = session.deviceId;
        this.failedDevices.delete(session.deviceId);
        // Start the grace period when the live picture is ready, rather than
        // counting camera permission/startup time as time spent framing it.
        session.scanAfter = Date.now() + 4000;
        this.sync();
        this.progress.textContent = purpose === "source" ? "Camera ready. Frame your source photo, then tap Take source photo."
          : session.manualCapture ? "Camera ready. Frame your picture, then tap Capture and read."
          : session.paused && this.backgroundAvailable ? "Camera ready. Scanning paused; capture a photo or resume scanning."
          : this.backgroundAvailable
          ? "Frame your picture. Automatic scanning starts in four seconds; Capture and read is available now."
          : "Preview ready. Tap Capture and read. Automatic background scanning needs HTTPS or localhost.";
        if (session.captureProfile !== "preferred") this.progress.textContent += " Compatibility mode: " +
          this.video.videoWidth + " × " + this.video.videoHeight + " actual pixels.";
        this.refreshOrientation(session);
        this.schedule(session, 900);
        return { ready: true };
      } catch (error) {
        if (this.session !== session) return { cancelled: true };
        this.close(Boolean(options.switchOperation));
        const closePreviews = /Windows/i.test(navigator.userAgent)
          ? "Close OBS, webcam-test tabs and the Windows Settings camera preview, then retry."
          : "Close other apps and preview tabs using the camera, then retry.";
        const message = error?.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser or choose a saved image."
          : ["NotFoundError", "OverconstrainedError"].includes(error?.name) && options.deviceId ? "The selected camera is unavailable. Reopen the camera or choose a saved image."
          : error?.name === "NotFoundError" ? "No camera is available. Use Browse to load a saved photo."
          : ["NotReadableError", "AbortError"].includes(error?.name)
            ? "The browser could not start this camera. " + closePreviews + (this.nativePhotoCapture
              ? " Use Browse to load a saved image."
              : " If it still fails, use OBS Virtual Camera or choose a saved image.")
            : "Could not start the camera. Close other apps using the camera or choose a saved image.";
        const clean = value => String(value || "").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200);
        const detail = [clean(error?.name), error?.constraint ? "constraint: " + clean(error.constraint) : "", clean(error?.message)].filter(Boolean).join(" · ");
        const failure = (session.deviceLabel ? clean(session.deviceLabel) + ": " : "") + message +
          (detail ? " Browser error: " + detail : "");
        if (!options.quietFailure) this.report(failure, true);
        return { error, message: failure };
      }
    }

    close(preserveSwitch = false) {
      if (!preserveSwitch && this.switchOperation) {
        this.switchOperation.cancelled = true;
        this.switchOperation = null;
      }
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
      if (!session?.ready || session.purpose === "source" || session.handingOff || !this.backgroundAvailable || this.working()) return;
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
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.handingOff) return;
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.scan(session), Math.max(delay, (session.scanAfter || 0) - Date.now()));
    }

    captureFrame() {
      const rawWidth = this.video.videoWidth, rawHeight = this.video.videoHeight;
      if (this.session?.adjusting || this.video.readyState < 2 || !rawWidth || !rawHeight) throw new Error("Wait for the live camera picture, then try again.");
      const rotation = this.session?.rotation || 0, sideways = rotation % 180 !== 0;
      const width = sideways ? rawHeight : rawWidth, height = sideways ? rawWidth : rawHeight;
      if (width * height > PixelStow.getLimits().inputPixels) throw new Error("This camera frame exceeds the 32 megapixel photo input limit.");
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
        this.signature.textContent = "";
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
      const markerTotal = entry.scan?.geometry?.markerTotal || entry.inspection?.geometry?.markerTotal ||
        (scan.markers[0]?.carrierVersion && scan.markers[0].carrierVersion !== 5 ? 8 : 4);
      this.nearSummary.textContent = "Best capture · frame " + frameNumber + ": " + scan.markers.length +
        "/" + markerTotal + " markers; " + (entry.state || (entry.inspection?.unreadable ? "contents did not pass their checks" : entry.attempted ? "reading contents" : "waiting for frame appraisal"));
      const geometry = entry.inspection?.geometry || scan.geometry;
      if (geometry?.missingMarkerIds?.length) {
        const positions = { 0: "top-left", 1: "top-middle", 2: "top-right", 3: "left-middle",
          5: "right-middle", 6: "bottom-left", 7: "bottom-middle", 8: "bottom-right" };
        this.nearSummary.textContent += ". Missing: " + geometry.missingMarkerIds.map((id) => positions[id] || id).join(", ");
      }
      if (scan.markerSearch?.some((m) => !m.found && ["time-limit", "not-searched"].includes(m.reason)))
        this.nearSummary.textContent += ". Some marker searches reached their time limit";
      this.nearMiss.hidden = false;
      this.sync();
    }

    scan(session) {
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.handingOff) return;
      if (Date.now() < (session.scanAfter || 0)) { this.schedule(session, 0); return; }
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
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.scanning || session.handingOff || !session.pending) return;
      session.scanning = true;
      const entry = session.pending;
      session.pending = null;
      const { image, frameNumber } = entry;
      const controller = new AbortController();
      session.abort = controller;
      try {
        const prefix = "Frame " + frameNumber + " · " + image.width + " × " + image.height + ": ";
        if (!session.reading) {
          this.signature.textContent = "";
          this.progress.textContent = prefix + "Checking markers…";
          this.readProgress.begin(this.progress.textContent);
        }
        const previous = session.tracking?.scan;
        const header = previous?.markers?.find((m) => m.verification === "header");
        const scan = await PixelStow.scanMarkers(image.pixels, image.width, image.height, {
          mode: "perspective", camera: true, deadline: Date.now() + (header ? 12000 : 24000), signal: controller.signal,
          seed: previous?.width === image.width && previous?.height === image.height && header
            ? { ...header, initialMatrix: previous.geometry?.matrix } : undefined,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted && !session.reading) {
            this.progress.textContent = prefix + text; this.readProgress.update(this.progress.textContent);
          } },
          onSignature: (signature) => { if (this.session === session && !controller.signal.aborted) {
            this.signature.textContent = signature.message;
            if (!session.reading) this.readProgress.signature(signature);
          } }
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
          ? "All markers agree strongly. Reading the most promising capture."
          : scan.markers?.length ? "Recovery markers verified. Comparing captures before reading contents."
          : scan.signature?.likely ? "Frequency hints found; no verified markers in this capture."
            : "No encoding signature or checksum-valid markers found.";
        if (!session.reading) this.progress.textContent = prefix + (scan.candidates?.length
          ? "Marker scan complete. Ranking the recent captures…"
          : "No stable marker fit. Reframe and hold steady; checking a fresh capture…");
        if (!session.reading) this.readProgress.update(this.progress.textContent);
        this.readBestFrame(session);
      } catch (error) {
        if (this.session !== session || controller.signal.aborted) return;
        session.paused = true;
        this.cancelSearches(session);
        this.progress.textContent = (error?.message || "The camera scan could not finish.") + " Scanning paused; resume or tap Capture and read.";
        this.readProgress.finish(this.progress.textContent, "failed");
        this.sync();
      } finally {
        session.scanning = false;
        if (session.abort === controller) session.abort = null;
        if (this.session === session && !session.paused && !session.adjusting && !session.handingOff) this.scanMarkers(session);
      }
    }

    async readBestFrame(session) {
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.reading || session.handingOff) return;
      const entry = session.history.find((frame) => !frame.attempted && frame.scan.candidates?.length && Date.now() - frame.capturedAt < 45000);
      if (!entry) return; // Never spend a payload read on a marker-free capture.
      if (session.appraised < 2 && !entry.scan.highConfidence) return;
      session.appraised = 0;
      session.reading = true;
      session.readEntry = entry;
      this.clearFeedback?.();
      this.signature.textContent = "";
      this.progress.textContent = "Reading best capture · frame " + entry.frameNumber + "…";
      this.readProgress.update(this.progress.textContent);
      entry.attempted = true;
      entry.state = undefined;
      const controller = new AbortController();
      session.readAbort = controller;
      // A bad capture cannot monopolize the reader indefinitely. Fresh marker
      // scans continue independently; their best result is next in rank order.
      const deadline = Date.now() + 30000;
      const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
      this.showBestFrame(session);
      try {
        const { image, scan, frameNumber } = entry;
        const inspection = await PixelStow.readMarkerCandidates(image.pixels, image.width, image.height, scan, {
          signal: controller.signal, deadline, resumeDiscovery: true,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted) {
            this.progress.textContent = "Reading best capture · frame " + frameNumber + ": " + text;
            this.readProgress.update(this.progress.textContent);
          } }
        });
        if (this.session !== session || controller.signal.aborted) return;
        entry.inspection = inspection;
        if (inspection.found && !inspection.unreadable) {
          await this.accept(session, image, inspection);
          return;
        }
        this.progress.textContent = "This capture's contents did not pass their checks. Comparing fresher captures…";
        this.readProgress.update(this.progress.textContent);
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
      this.signature.textContent = "";
      this.progress.textContent = inspection?.found && !inspection.unreadable ? "Encoded contents found. Opening this capture…" : "Opening this capture…";
      if (inspection?.found && !inspection.unreadable) this.readProgress.finish(this.progress.textContent);
      else this.readProgress.begin(this.progress.textContent);
      this.sync();
      try {
        // Preserve the inspected raster losslessly for exports/sharing. The UI
        // receives the same pixel object whose geometry was cached by inspect.
        const blob = await PixelStow.writePng(image.pixels, image.width, image.height);
        if (this.session !== session) return;
        const name = "camera-capture-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
        const file = new File([blob], name, { type: "image/png" });
        this.close();
        await this.importImage(file, "camera", { image, inspection, markerScan, continuousCapture: true, sourceOnly: session.purpose === "source" });
      } catch (error) {
        if (this.session !== session) return;
        this.close();
        this.report(error?.message || "Could not open the captured frame. Tap Capture to try again.", true);
      }
    }
  }
  window.PixelStowCamera = PixelStowCamera;
})();
