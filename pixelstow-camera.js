// Camera acquisition belongs to the browser front end. The existing codec still
// decides whether a frame contains a complete, checksum-valid payload.
(function () {
  class PixelStowCamera {
    constructor({ importImage, report, working, changed, drawGuides, clearFeedback, prepareCapture, clearPreview }) {
      Object.assign(this, { importImage, report, working, changed, drawGuides, clearFeedback, prepareCapture, clearPreview });
      this.session = null;
      this.devices = [];
      this.devicesKnown = false;
      this.discoveryComplete = false;
      this.automaticDeviceId = null;
      this.preferredDeviceId = null;
      this.failedDevices = new Set();
      this.deviceHistory = new Map();
      this.switchOperation = null;
      // Desktop file inputs ignore capture and open a file picker. Keep the
      // native still-camera route for phones/tablets, including desktop-UA iPads.
      this.nativePhotoCapture = Boolean(navigator.userAgentData?.mobile ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
      this.captureCanvas = document.createElement("canvas");
      this.guideCanvas = document.createElement("canvas");
      // The old full-image pilot remains research-only. Normal capture uses the
      // subtle edge guide directly from the frozen full-resolution raster.
      this.scaleGuideEnabled = false;
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
      this.readProgress = new PixelStowReadProgress(document.querySelector("#camera-read-status"), this.frame);
      this.signature = document.querySelector("#camera-signature");
      this.calibrationLight = document.querySelector("#camera-calibration");
      this.nearMiss = document.querySelector("#camera-near-miss");
      this.nearSummary = document.querySelector("#camera-near-summary");
      this.still = document.querySelector("#camera-still");
      this.guides = document.querySelector("#camera-guides");
      this.frozenFrame = document.createElement("canvas");
      this.frozenFrame.hidden = true;
      this.frozenFrame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none";
      this.video.after(this.frozenFrame);
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
        if (this.pinch || Date.now() - (this.pinchGuard || 0) < 400) return;
        if (tap?.id === event.pointerId && tap.session === this.session && Date.now() - tap.at < 500) this.captureCurrent();
      });
      this.view.addEventListener("touchstart", (event) => this.onCameraTouch(event), { passive: false });
      this.view.addEventListener("touchmove", (event) => this.onCameraTouch(event), { passive: false });
      this.view.addEventListener("touchend", (event) => this.onCameraTouch(event));
      this.view.addEventListener("touchcancel", (event) => this.onCameraTouch(event));
      this.view.addEventListener("wheel", (event) => this.onCameraWheel(event), { passive: false });
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
      navigator.mediaDevices?.addEventListener?.("devicechange", () => this.devicesChanged());
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
          this.report("Camera closed while the page was away. Tap Decode to resume.");
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
      try { this.accept(session, session.calibrationHold?.entry.image || this.captureFrame(), undefined, undefined, false); }
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

    deviceRank(device) {
      let capabilities = {};
      try { capabilities = device.getCapabilities?.() || {}; } catch { /* Optional browser/driver information. */ }
      const history = this.deviceHistory.get(device.deviceId) || {}, label = device.label || "";
      const facing = capabilities.facingMode || (history.facing ? [history.facing] : []);
      const virtual = /virtual|\bobs\b|manycam|snap camera|xsplit|camtwist|loopback/i.test(label);
      const unusual = /\b(?:dual(?:[\s_-]*wide)?|triple|ultra[\s_-]*wide|telephoto)\b/i.test(label);
      const rear = facing.includes("environment") || /\b(back|rear|environment)\b/i.test(label);
      const front = facing.includes("user") || /\b(front|facetime|selfie)\b/i.test(label);
      const category = virtual ? 4 : unusual ? 3 : this.nativePhotoCapture && rear ? 0 : this.nativePhotoCapture && front ? 2 : 1;
      // Reported maximum dimensions are a ranking hint, not a format request or
      // a claim of optical quality. Unknown cameras use a neutral HD estimate.
      const pixels = Math.min(32000000, (capabilities.width?.max || history.width || 1280) *
        (capabilities.height?.max || history.height || 720));
      const autofocus = Array.isArray(capabilities.focusMode) && capabilities.focusMode.some(mode => ["continuous", "single-shot"].includes(mode)) ? 1 : 0;
      return [history.failed ? 1 : 0, category, -pixels, -autofocus];
    }

    compareDevices(a, b) {
      const left = this.deviceRank(a), right = this.deviceRank(b);
      for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
      return 0; // Retain browser order when available evidence is equal.
    }

    async devicesChanged() {
      const before = this.devices.map(device => device.deviceId).sort().join("\n");
      await this.refreshDevices(false, true);
      const after = this.devices.map(device => device.deviceId).sort().join("\n");
      // Permission exposure can generate events too. Only a changed camera list
      // invalidates the discovery cache, not closing a camera or losing labels.
      if (before !== after) {
        this.discoveryComplete = false;
        this.failedDevices.clear();
        for (const [id, history] of this.deviceHistory) if (history.failed) this.deviceHistory.set(id, { ...history, failed: false });
      }
      this.sync();
    }

    async refreshDevices(rank = false, force = false) {
      if (this.discoveryComplete && !force) return;
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const previous = new Map(this.devices.map((device, index) => [device.deviceId, index]));
        const ids = new Set();
        const next = devices.filter(device => {
          if (device.kind !== "videoinput" || !device.deviceId || ids.has(device.deviceId)) return false;
          ids.add(device.deviceId);
          return true;
        });
        if (this.devicesKnown && this.devices.length && (!next.length || next.every(device => !device.label))) return;
        // With no live stream, a browser can expose only its default camera.
        // Keep the permitted IDs until an actual startup proves one unavailable.
        if (this.discoveryComplete && !this.session?.ready && next.length === 1 && next.length < this.devices.length &&
          next.every(device => previous.has(device.deviceId))) return;
        this.devices = next;
        this.devices.sort((a, b) => rank ? this.compareDevices(a, b)
          : (previous.get(a.deviceId) ?? Infinity) - (previous.get(b.deviceId) ?? Infinity) || this.compareDevices(a, b));
        this.devicesKnown = true;
      } catch { /* A permitted video stream remains usable without enumeration. */ }
    }

    noteDeviceFailure(deviceId, error) {
      if (!deviceId || ["NotAllowedError", "SecurityError"].includes(error?.name)) return;
      this.failedDevices.add(deviceId);
      this.deviceHistory.set(deviceId, { ...this.deviceHistory.get(deviceId), failed: true });
    }

    stopStream(session) {
      const stream = session.stream;
      session.stream = null;
      if (this.video.srcObject === stream) { this.video.pause(); this.video.srcObject = null; }
      stream?.getTracks().forEach(track => track.stop());
    }

    async startDevice(session, facing, deviceId) {
      this.stopStream(session);
      session.deviceId = deviceId;
      session.deviceLabel = this.devices.find(device => device.deviceId === deviceId)?.label || "";
      const stream = await this.acquireStream(session, facing, deviceId);
      if (this.session !== session) { stream.getTracks().forEach(track => track.stop()); throw new DOMException("Camera closed.", "AbortError"); }
      session.stream = stream;
      const track = stream.getVideoTracks()[0], settings = track.getSettings();
      session.facing = settings.facingMode || facing;
      session.deviceId = settings.deviceId || deviceId;
      session.deviceLabel = track.label;
      if (!session.deviceId) session.deviceId = this.devices.find(device => device.label === track.label)?.deviceId || null;
      track.addEventListener("ended", () => {
        if (this.session !== session || session.stream !== stream || session.handingOff) return;
        this.close();
        this.report("Camera disconnected. Tap Decode to try again, or Browse to load a saved photo.", true);
      });
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      await this.video.play();
      if (this.session !== session) throw new DOMException("Camera closed.", "AbortError");
      if (session.deviceId) this.deviceHistory.set(session.deviceId, { failed: false, facing: settings.facingMode,
        width: this.video.videoWidth || settings.width, height: this.video.videoHeight || settings.height });
      await this.preferSharpFrame(track);
      this.configureZoom(session, track);
    }

    async preferSharpFrame(track) {
      // A browsed still is the sensor's finished photo. The preview stream is
      // often a smaller, softer image, which is enough to erase a two-level guide.
      if (!track?.applyConstraints) return;
      let caps = {};
      try { caps = track.getCapabilities?.() || {}; } catch { return; }
      const current = track.getSettings?.() || {};
      const constraints = {};
      if (caps.width?.max > (current.width || 0)) constraints.width = { ideal: caps.width.max };
      if (caps.height?.max > (current.height || 0)) constraints.height = { ideal: caps.height.max };
      const advanced = Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous") ? [{ focusMode: "continuous" }] : [];
      if (!advanced.length && !constraints.width && !constraints.height) return;
      try { await track.applyConstraints({ ...constraints, advanced }); } catch { /* Keep the stream that already started. */ }
    }

    async startBestDevice(session, facing) {
      const cached = this.discoveryComplete;
      await this.refreshDevices(true);
      if (this.session !== session) throw new DOMException("Camera closed.", "AbortError");
      const usable = this.devices.filter(device => !this.deviceHistory.get(device.deviceId)?.failed);
      let choices = this.devices.some(device => device.label) ? (usable.length ? usable : this.devices).slice()
        : [{ deviceId: cached ? this.automaticDeviceId : null }];
      let bootstrap = choices[0]?.deviceId === null, reconsider = !cached, refreshed = false, lastError;
      const attempted = new Set();
      const skipped = [];
      for (let index = 0; index < choices.length; index++) {
        const device = choices[index];
        attempted.add(device.deviceId);
        try {
          await this.startDevice(session, facing, device.deviceId);
          if (reconsider) {
            // Opening the first stream can expose more IDs, labels and optional
            // capabilities. Re-rank once before enabling capture controls.
            bootstrap = false; reconsider = false;
            await this.refreshDevices(true);
            if (this.session !== session) throw new DOMException("Camera closed.", "AbortError");
            if (!session.deviceId) session.deviceId = this.devices.find(candidate => candidate.label === session.deviceLabel)?.deviceId || null;
            const eligible = this.devices.filter(candidate => !this.failedDevices.has(candidate.deviceId));
            if (eligible[0] && eligible[0].deviceId !== session.deviceId) {
              const restore = this.devices.find(candidate => candidate.deviceId === session.deviceId) ||
                { deviceId: session.deviceId, label: session.deviceLabel };
              choices = eligible.filter(candidate => candidate.deviceId !== session.deviceId);
              choices.push(restore);
              index = -1;
              continue;
            }
          }
          session.skippedDevices = skipped;
          this.discoveryComplete = true;
          this.automaticDeviceId = session.deviceId;
          return;
        } catch (error) {
          if (this.session !== session || ["NotAllowedError", "SecurityError"].includes(error?.name)) throw error;
          lastError = error;
          this.noteDeviceFailure(session.deviceId, error);
          this.stopStream(session);
          skipped.push(device.label || session.deviceLabel || "camera");
          if (bootstrap || (cached && !refreshed)) {
            bootstrap = false;
            refreshed = true; reconsider = true;
            this.discoveryComplete = false;
            await this.refreshDevices(true, true);
            if (this.session !== session) throw error;
            choices = this.devices.filter(candidate => !attempted.has(candidate.deviceId)); index = -1;
          }
          this.progress.textContent = "Trying the next available camera…";
        }
      }
      throw lastError || new DOMException("No camera is available.", "NotFoundError");
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
      const session = this.session;
      if ((session?.handingOff || session?.calibrationHold) && this.frozenFrame && !this.frozenFrame.hidden) return;
      if (!session) { this.frame.hidden = true; this.video.style.visibility = "hidden"; this.resetPortraitPreview(); this.placeCalibration(); return; }
      // Permission and device startup must not collapse the preview row. Use
      // the requested orientation until actual video dimensions are available.
      const ready = session.ready && this.video.videoWidth && this.video.videoHeight;
      const portrait = this.isPortrait();
      const width = ready ? this.video.videoWidth : portrait ? 1920 : 2560;
      const height = ready ? this.video.videoHeight : portrait ? 2560 : 1920;
      this.frame.hidden = false;
      this.video.style.visibility = ready ? "visible" : "hidden";
      const sideways = session.rotation % 180 !== 0;
      const frameWidth = sideways ? height : width, frameHeight = sideways ? width : height;
      const viewW = this.view.clientWidth || 1;
      const viewH = this.fitPortraitPreview(frameWidth, frameHeight) || this.view.clientHeight;
      // Hardware zoom is already in the video frames. Simulated zoom enlarges
      // the same centred preview and the capture crops to the visible part.
      const zoom = session.zoomMode === "simulated" ? (session.zoom || 1) : 1;
      const scale = Math.min(Math.max(1, viewW - 8) / frameWidth, Math.max(1, viewH - 8) / frameHeight) * zoom;
      const w = frameWidth * scale, h = frameHeight * scale;
      const videoLeft = (viewW - w) / 2, videoTop = (viewH - h) / 2;
      const left = Math.max(0, videoLeft), top = Math.max(0, videoTop);
      const right = Math.min(viewW, videoLeft + w), bottom = Math.min(viewH, videoTop + h);
      this.video.style.width = width * scale + "px";
      this.video.style.height = height * scale + "px";
      this.video.style.transform = "translate(-50%, -50%) rotate(" + session.rotation + "deg)";
      Object.assign(this.frame.style, {
        left: left + "px", top: top + "px",
        width: Math.max(0, right - left) + "px", height: Math.max(0, bottom - top) + "px"
      });
      this.placeCalibration(left, top, Math.max(0, right - left));
    }

    snapZoom(factor, range) {
      const clamped = Math.min(range.max, Math.max(range.min, factor));
      if (!range.step) return clamped;
      const steps = Math.round((clamped - range.min) / range.step);
      return Math.min(range.max, Math.max(range.min, range.min + steps * range.step));
    }

    configureZoom(session, track) {
      let caps = {};
      try { caps = track?.getCapabilities?.() || {}; } catch { caps = {}; }
      const spec = caps.zoom;
      const min = Number(spec?.min), max = Number(spec?.max);
      const hardware = Number.isFinite(min) && Number.isFinite(max) && max > min + 0.01;
      const range = hardware
        ? { min, max, step: Number(spec.step) > 0 ? Number(spec.step) : 0 }
        : { min: 1, max: 4, step: 0 };
      const held = session.zoom;
      session.zoomMode = hardware ? "hardware" : "simulated";
      session.zoomRange = range;
      if (held == null) {
        const current = Number(track?.getSettings?.().zoom);
        session.zoom = hardware && Number.isFinite(current) ? this.snapZoom(current, range) : 1;
      } else session.zoom = this.snapZoom(held, range);
    }

    setZoom(session, factor) {
      if (this.session !== session || !session?.zoomRange || session.adjusting || session.handingOff) return;
      const zoom = this.snapZoom(factor, session.zoomRange);
      if (Math.abs(zoom - (session.zoom || 1)) < 0.0001) return;
      session.zoom = zoom;
      session.zoomDirty = true;
      if (session.zoomMode === "hardware") this.applyHardwareZoom(session);
      else this.layoutPreview();
    }

    async applyHardwareZoom(session) {
      if (session.zoomPending) { session.zoomQueued = true; return; }
      session.zoomPending = true;
      try {
        do {
          session.zoomQueued = false;
          const track = session.stream?.getVideoTracks?.()[0];
          if (!track || this.session !== session) return;
          await track.applyConstraints({ advanced: [{ zoom: session.zoom }] });
          const applied = Number(track.getSettings?.().zoom);
          if (this.session === session && Number.isFinite(applied)) session.zoom = applied;
        } while (session.zoomQueued && this.session === session);
      } catch {
        if (this.session !== session) return;
        session.zoomMode = "simulated";
        session.zoomRange = { min: 1, max: 4, step: 0 };
        session.zoom = Math.min(4, Math.max(1, session.zoom || 1));
      } finally {
        session.zoomPending = false;
        if (this.session === session) this.layoutPreview();
      }
    }

    onCameraTouch(event) {
      const session = this.session;
      if (!session?.ready || session.adjusting) return;
      if (event.touches.length >= 2) {
        event.preventDefault();
        this.viewTap = null;
        const [a, b] = event.touches;
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!this.pinch || event.type === "touchstart") this.pinch = { distance: Math.max(1, distance), zoom: session.zoom || 1 };
        else if (event.type === "touchmove") this.setZoom(session, this.pinch.zoom * distance / this.pinch.distance);
        return;
      }
      if ((event.type === "touchend" || event.type === "touchcancel") && this.pinch) this.endPinch(session);
    }

    onCameraWheel(event) {
      const session = this.session;
      if (!session?.ready || session.adjusting) return;
      event.preventDefault();
      this.viewTap = null;
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * this.view.clientHeight : event.deltaY;
      this.setZoom(session, (session.zoom || 1) * Math.exp(-pixels * 0.0015));
      clearTimeout(session.zoomTimer);
      session.zoomTimer = setTimeout(() => this.releaseZoom(session), 180);
    }

    endPinch(session) {
      this.pinch = null;
      this.pinchGuard = Date.now();
      this.releaseZoom(session);
    }

    releaseZoom(session) {
      if (!session?.zoomDirty || this.session !== session || session.purpose === "source" || session.paused || session.handingOff) {
        if (session) session.zoomDirty = false;
        return;
      }
      session.zoomDirty = false;
      const wait = Math.max(0, (session.scanAfter || 0) - Date.now());
      this.cancelSearches(session, true);
      session.fallbackAfter = Date.now() + 5000;
      session.lastTime = -1;
      this.schedule(session, Math.max(400, wait));
    }

    visibleVideoRect(rawWidth, rawHeight, zoom) {
      if (!(zoom > 1.001)) return { sx: 0, sy: 0, sw: rawWidth, sh: rawHeight };
      const rotation = this.session?.rotation || 0, sideways = rotation % 180 !== 0;
      const frameWidth = sideways ? rawHeight : rawWidth, frameHeight = sideways ? rawWidth : rawHeight;
      const viewW = this.view?.clientWidth || frameWidth, viewH = this.view?.clientHeight || frameHeight;
      const fit = Math.min(viewW / frameWidth, viewH / frameHeight) * zoom;
      const shownW = Math.min(frameWidth, viewW / fit), shownH = Math.min(frameHeight, viewH / fit);
      const sw = Math.max(1, Math.min(rawWidth, Math.round(sideways ? shownH : shownW)));
      const sh = Math.max(1, Math.min(rawHeight, Math.round(sideways ? shownW : shownH)));
      const sx = Math.max(0, Math.min(rawWidth - sw, Math.floor((rawWidth - sw) / 2)));
      const sy = Math.max(0, Math.min(rawHeight - sh, Math.floor((rawHeight - sh) / 2)));
      return { sx, sy, sw, sh };
    }

    portraitStacked() {
      return window.matchMedia("(orientation: portrait)").matches && window.matchMedia("(min-height: 601px)").matches;
    }

    fitPortraitPreview(frameWidth, frameHeight) {
      // A tall camera frame inside the short flexible row is scaled to the row
      // height, which leaves empty columns on either side. Give it the full
      // column width and let the notes use the space that remains.
      if (!this.portraitStacked() || !frameWidth || !frameHeight) { this.resetPortraitPreview(); return 0; }
      const header = this.panel.querySelector(".camera-header")?.offsetHeight || 0;
      const controls = this.panel.querySelector(".camera-controls")?.offsetHeight || 0;
      const status = this.panel.querySelector("#camera-read-status");
      const statusOut = status && getComputedStyle(status).position === "absolute";
      const footer = this.panel.querySelector(".camera-footer");
      const footerStyle = footer ? getComputedStyle(footer) : null;
      const footerGap = footerStyle ? parseFloat(footerStyle.rowGap || footerStyle.gap) || 0 : 0;
      const footerPad = footerStyle ? (parseFloat(footerStyle.paddingTop) || 0) + (parseFloat(footerStyle.paddingBottom) || 0) : 0;
      const style = getComputedStyle(this.panel);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const gap = parseFloat(style.rowGap || style.gap) || 0;
      const statusH = statusOut ? 0 : (status?.offsetHeight || 0);
      const footerGaps = footerGap * (statusOut ? 1 : 2);
      const available = this.panel.clientHeight - header - controls - statusH - padY - gap * 2 - footerPad - footerGaps;
      const needed = this.view.clientWidth * frameHeight / frameWidth;
      const room = Math.max(1, available - 32);
      const next = Math.floor(Math.min(needed, room));
      if (this.view.style.height !== next + "px") {
        this.view.style.minHeight = "0px";
        this.view.style.height = next + "px";
      }
      return next;
    }

    resetPortraitPreview() {
      if (!this.view?.style.height && !this.view?.style.minHeight) return;
      this.view.style.height = "";
      this.view.style.minHeight = "";
    }

    placeCalibration(frameLeft, frameTop, frameWidth) {
      const light = this.calibrationLight;
      if (!light) return;
      if (!frameWidth) {
        light.style.left = light.style.top = light.style.maxWidth = "";
        return;
      }
      light.style.left = (frameLeft + frameWidth / 2) + "px";
      light.style.top = (frameTop + 10) + "px";
      light.style.maxWidth = Math.max(48, frameWidth - 24) + "px";
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
        const desired = session.zoom;
        await track?.applyConstraints(this.videoConstraints(session.facing, portrait, session.deviceId, session.captureProfile));
        if (track && this.session === session) {
          session.zoom = desired;
          this.configureZoom(session, track);
          if (session.zoomMode === "hardware") await this.applyHardwareZoom(session);
        }
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
      this.help.textContent = source ? "Frame a new photo to put your message and files inside. Pinch to zoom. The outlined view is captured."
        : "Keep all four picture corners inside the guides. Pinch to zoom. Move closer and hold steady.";
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
      this.view.setAttribute("aria-label", source ? "Take a source photo from the live camera preview. Pinch to zoom."
        : "Capture and read the live camera preview. Pinch to zoom.");
      this.nativePhotoButton.textContent = "Take photo with phone camera";
      this.nativePhotoButton.hidden = source || !this.nativePhotoCapture;
      this.target.hidden = source;
      this.signature.hidden = source;
      this.pauseButton.hidden = source || Boolean(session?.manualCapture) || !this.backgroundAvailable;
      this.pauseButton.disabled = locked || !session?.ready || !this.backgroundAvailable || Boolean(this.switchOperation || session?.handingOff);
      const pauseLabel = session?.paused ? "Resume scanning" : "Pause scanning";
      this.pauseButton.setAttribute("aria-label", pauseLabel);
      this.pauseButton.title = pauseLabel;
      this.pauseButton.querySelector(".pause-icon").toggleAttribute("hidden", Boolean(session?.paused));
      this.pauseButton.querySelector(".play-icon").toggleAttribute("hidden", !session?.paused);
      this.rotateButton.disabled = locked || !ready || Boolean(this.switchOperation || session?.handingOff);
      const next = this.nextDevices(session?.deviceId)[0];
      this.switchButton.disabled = this.rotateButton.disabled || (!this.nativePhotoCapture && this.devicesKnown && !next);
      this.switchButton.title = next?.label ? "Switch to " + next.label : this.switchButton.disabled && ready
        ? "No other camera is available to this browser" : "Switch camera";
      this.switchButton.setAttribute("aria-label", this.switchButton.title);
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
      const deviceId = options.deviceId ?? null;
      const session = { facing, purpose, deviceId, deviceLabel: this.devices.find(device => device.deviceId === deviceId)?.label || "",
        manualCapture: Boolean(options.manualCapture), ready: false,
        paused: purpose === "source" || Boolean(options.manualCapture || options.paused) || !this.backgroundAvailable, frames: 0, lastTime: -1,
        rotation: 0, portrait: this.isPortrait(), history: [], appraised: 0 };
      this.session = session;
      this.frozenFrame.hidden = true;
      this.updateCalibrationLight(session);
      this.clearFeedback?.();
      this.signature.textContent = "";
      if (purpose === "source") this.readProgress.finish("Frame your source photo, then capture it.", "source");
      else this.readProgress.begin("Waiting for a camera frame…");
      this.progress.textContent = "Opening camera…";
      this.changed();
      try {
        this.panel.showModal();
        document.documentElement.classList.add("camera-modal-open");
        document.body.classList.add("camera-modal-open");
        this.sync();
        // Ideals allow a lower-resolution webcam to work too. Never request the
        // microphone, crop to the CSS preview, or rescale captured video pixels.
        if (options.deviceId === undefined) await this.startBestDevice(session, facing);
        else await this.startDevice(session, facing, deviceId);
        if (this.session !== session) return { cancelled: true };
        session.ready = true;
        // Only a live, playable camera becomes the remembered selection.
        this.preferredDeviceId = session.deviceId;
        this.failedDevices.delete(session.deviceId);
        // Start the grace period when the live picture is ready, rather than
        // counting camera permission/startup time as time spent framing it.
        session.scanAfter = Date.now() + 2000;
        session.fallbackAfter = Date.now() + 5000;
        this.updateCalibrationLight(session);
        this.sync();
        this.progress.textContent = purpose === "source" ? "Camera ready. Frame your source photo, then tap Take source photo."
          : session.manualCapture ? "Camera ready. Frame your picture, then tap Capture and read."
          : session.paused && this.backgroundAvailable ? "Camera ready. Scanning paused; capture a photo or resume scanning."
          : this.backgroundAvailable
          ? "Frame your picture. Automatic scanning starts in two seconds; Capture and read is available now."
          : "Preview ready. Tap Capture and read. Automatic background scanning needs HTTPS or localhost.";
        if (session.captureProfile !== "preferred") this.progress.textContent += " Compatibility mode: " +
          this.video.videoWidth + " × " + this.video.videoHeight + " actual pixels.";
        if (session.skippedDevices?.length) this.progress.textContent += " Skipped unavailable cameras: " + session.skippedDevices.join(", ") + ".";
        this.refreshOrientation(session);
        this.schedule(session, 900);
        return { ready: true };
      } catch (error) {
        if (this.session !== session) return { cancelled: true };
        this.noteDeviceFailure(session.deviceId, error);
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
      if (this.session) this.clearPreview?.();
      if (this.frozenFrame) {
        this.frozenFrame.hidden = true;
        this.frozenFrame.width = this.frozenFrame.height = 0;
      }
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
      clearTimeout(session.zoomTimer);
      this.pinch = null;
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
      this.guideCanvas.width = this.guideCanvas.height = 0;
      this.changed();
    }

    togglePause() {
      const session = this.session;
      if (!session?.ready || session.purpose === "source" || session.handingOff || !this.backgroundAvailable || this.working()) return;
      clearTimeout(session.timer);
      if (!session.paused) {
        session.paused = true;
        this.cancelSearches(session);
        this.progress.textContent = "Scanning paused. Reframe the live view, then resume or capture and read.";
      } else {
        // Drop every queued or retained capture before the clock restarts.
        // A reframe made while paused must not resume the previous search.
        this.scrubScanQueue(session);
        session.paused = false;
        this.progress.textContent = "Scanning resumed. Hold the picture steady…";
        this.schedule(session, 400);
      }
      this.sync();
    }

    scrubScanQueue(session) {
      this.cancelSearches(session, true);
      session.fallbackAfter = undefined;
      session.scanAfter = 0;
      session.lastTime = -1;
    }

    schedule(session, delay = 700) {
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.handingOff || session.calibrationHold) return;
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.scan(session), Math.max(delay, (session.scanAfter || 0) - Date.now()));
    }

    captureFrame() {
      const rawWidth = this.video.videoWidth, rawHeight = this.video.videoHeight;
      if (this.session?.adjusting || this.video.readyState < 2 || !rawWidth || !rawHeight) throw new Error("Wait for the live camera picture, then try again.");
      const rotation = this.session?.rotation || 0, sideways = rotation % 180 !== 0;
      const zoom = this.session?.zoomMode === "simulated" ? (this.session.zoom || 1) : 1;
      const source = this.visibleVideoRect(rawWidth, rawHeight, zoom);
      const width = sideways ? source.sh : source.sw, height = sideways ? source.sw : source.sh;
      if (width * height > PixelStow.getLimits().inputPixels) throw new Error("This camera frame exceeds the 32 megapixel photo input limit.");
      const canvas = this.captureCanvas;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.save();
      context.imageSmoothingEnabled = false;
      context.translate(width / 2, height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(this.video, source.sx, source.sy, source.sw, source.sh, -source.sw / 2, -source.sh / 2, source.sw, source.sh);
      context.restore();
      return { pixels: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), width, height, exact: true };
    }

    cancelSearches(session, clearHistory = false) {
      this.clearCalibrationHold(session);
      this.updateCalibrationLight(session);
      session.abort?.abort();
      session.readAbort?.abort();
      session.guideAbort?.abort();
      session.guidePending = null;
      session.guideGeneration = (session.guideGeneration || 0) + 1;
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
      const history = session.history.filter((frame) => frame !== entry && Date.now() - frame.capturedAt < 45000);
      if (entry.scan.markers?.length) history.push(entry);
      // Keep an attempted frame for feedback, but don't let old failed captures
      // occupy every history slot and starve newer candidates of a payload read.
      const attempted = history.filter((frame) => frame.attempted).sort((a, b) => this.framePriority(b) - this.framePriority(a))[0];
      const retained = history.filter((frame) => !frame.attempted || frame === attempted);
      retained.sort((a, b) => Number(a.attempted || false) - Number(b.attempted || false) || this.framePriority(b) - this.framePriority(a) || b.frameNumber - a.frameNumber);
      let bytes = 0;
      session.history = retained.filter((frame, index) => {
        bytes += frame.image.pixels.byteLength;
        return index < 3 && (index === 0 || bytes <= 48 * 1024 * 1024);
      });
      session.best = session.history[0];
      this.showBestFrame(session);
    }

    framePriority(entry) {
      // Only marker-bearing frames reach payload history. The guide promotes
      // their scheduling; it never substitutes for a marker or payload checksum.
      return (entry.scaleGuide?.detected ? 1000 : 0) + entry.score;
    }

    edgeGuideSummary(entry) {
      const hint = entry.scaleGuide;
      return hint?.detected && (entry.guideKind === "edge" || hint.kind === "edge") && Number.isFinite(hint.scale)
        ? "Edge guide · ~" + hint.scale.toFixed(2) + "× scale." : "";
    }

    holdCalibrationFrame(session, entry) {
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting ||
        session.handingOff || session.calibrationHold || !entry.scaleGuide?.detected || !this.frozenFrame) return;
      const { image } = entry;
      this.frozenFrame.width = image.width;
      this.frozenFrame.height = image.height;
      this.frozenFrame.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
      this.frozenFrame.hidden = false;
      const hold = { entry };
      session.calibrationHold = hold;
      // Keep checking this exact raster in the background, with the camera
      // stream alive behind it. Discard queued lookahead from before the hold.
      clearTimeout(session.timer);
      session.guidePending = null;
      this.captureButton.toggleAttribute("data-calibration-hold", true);
      hold.timer = setTimeout(() => {
        if (this.session !== session || session.calibrationHold !== hold || session.handingOff) return;
        this.clearCalibrationHold(session);
        this.updateCalibrationLight(session);
        this.layoutPreview();
        this.schedule(session, 0);
      }, 2000);
    }

    clearCalibrationHold(session) {
      const hold = session.calibrationHold;
      if (!hold) return;
      clearTimeout(hold.timer);
      session.calibrationHold = null;
      if (this.session === session || !this.session) {
        this.captureButton?.toggleAttribute("data-calibration-hold", false);
        // A successful/manual handoff owns the frozen canvas from here on.
        if (!session.handingOff && this.frozenFrame) this.frozenFrame.hidden = true;
      }
    }

    updateCalibrationLight(session, entry) {
      if (this.session !== session) return;
      const detected = session.purpose !== "source" && Boolean(entry?.scaleGuide?.detected);
      const state = detected ? "detected" : entry?.guideChecked ? "none" : "searching";
      if (this.frame) this.frame.dataset.calibration = detected ? "detected" : "searching";
      this.readProgress?.syncFrame();
      if (!this.calibrationLight) return;
      this.calibrationLight.hidden = session.purpose === "source";
      this.calibrationLight.setAttribute?.("data-state", state);
      this.calibrationLight.textContent = detected ? "Calibration found" : state === "none" ? "No signal" : "Searching";
    }

    preserveCalibration(entry, result) {
      if (!result) return result;
      // The hint can settle after this frame's marker worker has started. Keep
      // that same-frame evidence, without claiming it guided the winning fit.
      const hint = entry.scaleGuide || result.scaleGuide;
      result.scaleGuide = hint;
      result.calibration = { status: entry.guideChecked ? "not-detected" : "not-checked", attempted: false, used: false,
        ...result.calibration, ...(hint?.detected ? { status: "detected" } : entry.guideChecked ? { status: "not-detected" } : {}) };
      return result;
    }

    captureGuideImage(image) {
      const factor = Math.min(1, 512 / Math.max(image.width, image.height));
      const canvas = this.guideCanvas;
      canvas.width = Math.round(image.width * factor); canvas.height = Math.round(image.height * factor);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
      // Same frozen raster, including rotation. Never sample a later video frame.
      context.drawImage(this.captureCanvas, 0, 0, canvas.width, canvas.height);
      return { pixels: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer), width: canvas.width, height: canvas.height };
    }

    enqueueFrame(session, entry) {
      if (this.session !== session || session.paused || session.adjusting || session.handingOff) return;
      if (session.scanningEntry === entry) {
        // A guide can finish while this same raster is already being searched.
        // Keep that work running; use the hint for ranking and visible feedback.
        if (!session.reading && entry.scaleGuide?.detected) this.signature.textContent = this.edgeGuideSummary(entry);
        return;
      }
      if (entry.markerFinished) {
        // Late hints may promote verified geometry in history, but cannot queue
        // the exact same completed frame for another marker search.
        if (entry.scaleGuide?.detected && entry.scan?.markers?.length) {
          this.retainFrame(session, entry);
          this.readBestFrame(session);
        }
        return;
      }
      if (entry.guideKind === "edge") {
        // Sample ordinary recovery occasionally; do not fill a marker queue
        // with every uncalibrated video frame while the cheap guide is running.
        session.fallbackAfter ??= Date.now() + 5000;
        if (!entry.scaleGuide?.detected &&
          (Date.now() < session.fallbackAfter || session.scanning || session.reading || session.pending)) return;
        // A positive guide can still have an inaccurate scale. Periodically
        // retain the ordinary search even when every appraisal reports green.
        if (Date.now() >= session.fallbackAfter) {
          entry.fallback = true;
          session.fallbackAfter = Date.now() + 8000;
        }
      }
      // Refresh the queued raster without losing its promised full-search turn.
      if (session.pending?.fallback) entry.fallback = true;
      if (session.pending?.scaleGuide?.detected && !entry.scaleGuide?.detected && Date.now() - session.pending.capturedAt < 45000) return;
      session.pending = entry;
      entry.markerDispatched = true;
      const active = session.scanningEntry;
      if (entry.scaleGuide?.detected) {
        const replaceScan = active && active !== entry && !active.markerGuideUsed;
        const read = session.readEntry;
        const replaceRead = read && read !== entry && !(read.markerGuideUsed ?? read.scaleGuide?.detected);
        if (replaceScan || replaceRead) {
          entry.fallback = false;
          if (replaceScan) session.abort?.abort();
          if (replaceRead) {
            read.state = "replaced by a calibrated capture";
            session.readAbort?.abort();
          }
          this.progress.textContent = "Calibration found. Switching to frame " + entry.frameNumber + "…";
        }
      }
      this.scanMarkers(session);
    }

    async checkScaleGuide(session) {
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.handingOff || session.calibrationHold || session.guideBusy || !session.guidePending) return;
      session.guideBusy = true;
      const entry = session.guidePending; session.guidePending = null;
      const generation = session.guideGeneration;
      const controller = new AbortController(); session.guideAbort = controller;
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          const sample = entry.guideKind === "edge" ? entry.image : entry.guideImage;
          const scanner = entry.guideKind === "edge" ? PixelStow.scanEdgeGuide : PixelStow.scanScaleGuide;
          // The worker normally rejects on abort. Also release the latest-frame
          // queue if a failed implementation ignores cancellation or settles late.
          let aborted;
          const cancellation = new Promise((_, reject) => {
            aborted = () => reject(new DOMException("Cancelled", "AbortError"));
            controller.signal.addEventListener("abort", aborted, { once: true });
          });
          let hint;
          try {
            // Same coverage floor as a browsed photo. A screen inside a bezel
            // or a little background is still the framed carrier. Three seconds
            // matches a slow run of the file detector without holding a stale frame.
            hint = await Promise.race([scanner(sample.pixels, sample.width, sample.height,
              { signal: controller.signal, deadline: Date.now() + 3000, maxMilliseconds: 3000,
                ...(entry.guideKind === "edge" ? { minimumCoverage: .5 } : {}) }), cancellation]);
        } finally { controller.signal.removeEventListener("abort", aborted); }
        if (this.session !== session || controller.signal.aborted || generation !== session.guideGeneration) return;
        entry.guideChecked = true;
        if (hint?.detected && Number.isFinite(hint.scale) && hint.scale > 0 && Number.isFinite(hint.fx) &&
          Number.isFinite(hint.fy) && Math.hypot(hint.fx, hint.fy) > 0) {
          const fx = hint.fx * sample.width / entry.image.width, fy = hint.fy * sample.height / entry.image.height;
          entry.scaleGuide = { ...hint, fx, fy, scale: hint.scale * Math.hypot(hint.fx, hint.fy) / Math.hypot(fx, fy),
            width: entry.image.width, height: entry.image.height };
        }
        this.preserveCalibration(entry, entry.scan);
        this.preserveCalibration(entry, entry.inspection);
        this.holdCalibrationFrame(session, entry);
        this.updateCalibrationLight(session, entry);
      } catch (_) { /* An unavailable/unclear guide always uses ordinary discovery. */ }
      finally {
        clearTimeout(timer); entry.guideImage = null;
        if (generation === session.guideGeneration && (!entry.markerDispatched || entry.scaleGuide?.detected)) this.enqueueFrame(session, entry);
        session.guideBusy = false;
        if (session.guideAbort === controller) session.guideAbort = null;
        this.checkScaleGuide(session);
      }
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
        // Recovery metadata is retained, but diagnostics are painted only on
        // an explicit Analysis request in the image preview.
        this.guides.width = this.guides.height = 0;
        this.guides.hidden = true;
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
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.handingOff || session.calibrationHold) return;
      if (Date.now() < (session.scanAfter || 0)) { this.schedule(session, 0); return; }
      if (this.video.readyState < 2 || this.video.currentTime === session.lastTime) {
        this.schedule(session);
        return;
      }
      session.lastTime = this.video.currentTime;
      try {
        // Refresh this one slot even during a long payload read. The next marker
        // scan starts from the current framing, rather than an old queued frame.
        const entry = { image: this.captureFrame(), frameNumber: ++session.frames, capturedAt: Date.now() };
        if (!this.scaleGuideEnabled && typeof PixelStow.scanEdgeGuide === "function") {
          // Downsampling happens once inside the guide worker. The original
          // raster is also retained for marker checks and lossless hand-off.
          entry.guideKind = "edge";
          session.fallbackAfter ??= Date.now() + 5000;
          session.guidePending = entry;
          this.checkScaleGuide(session);
        } else if (this.scaleGuideEnabled && typeof PixelStow.scanScaleGuide === "function") {
          entry.guideImage = this.captureGuideImage(entry.image);
          session.guidePending = entry;
          this.checkScaleGuide(session);
        } else this.enqueueFrame(session, entry);
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
      session.scanningEntry = entry;
      const { image, frameNumber } = entry;
      const controller = new AbortController();
      session.abort = controller;
      // A late same-frame hint is useful for ranking, but cannot retroactively
      // change the options used by an already-running marker worker.
      const scaleGuide = entry.scaleGuide || false;
      entry.markerGuideUsed = Boolean(scaleGuide?.detected);
      entry.calibratedOnly = entry.guideKind === "edge" && Boolean(scaleGuide?.detected) && !entry.fallback;
      try {
        const prefix = "Frame " + frameNumber + " · " + image.width + " × " + image.height + ": ";
        if (!session.reading) {
          this.signature.textContent = this.edgeGuideSummary(entry);
          this.progress.textContent = prefix + (entry.guideKind === "edge" && entry.scaleGuide?.detected
            ? "Edge guide found. Checking markers…" : "Checking markers…");
          this.readProgress.begin(this.progress.textContent);
        }
        const previous = session.tracking?.scan;
        const header = previous?.markers?.find((m) => m.verification === "header");
        const scan = await PixelStow.scanMarkers(image.pixels, image.width, image.height, {
          mode: "perspective", camera: true, calibratedOnly: entry.calibratedOnly,
          // A missed calibration does not make the raster unreadable. Give
          // occasional ordinary samples the full acquisition allowance; eight
          // seconds repeatedly failed to establish a usable marker fit.
          deadline: Date.now() + (entry.calibratedOnly ? 8000 : header && !entry.fallback ? 12000 : 24000), signal: controller.signal,
          scaleGuide, calibration: { status: entry.guideChecked ? entry.scaleGuide?.detected ? "detected" : "not-detected" : "not-checked" },
          seed: !entry.calibratedOnly && previous?.width === image.width && previous?.height === image.height && header
            ? { ...header, initialMatrix: previous.geometry?.matrix } : undefined,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted && !session.reading) {
            this.progress.textContent = prefix + text; this.readProgress.update(this.progress.textContent);
          } },
          onSignature: (signature) => { if (this.session === session && !controller.signal.aborted) {
            if (signature.confirmed) entry.markerConfirmed = true;
            this.signature.textContent = [this.edgeGuideSummary(entry), signature.message].filter(Boolean).join(" ");
            if (!session.reading) this.readProgress.signature(signature);
          } }
        });
        if (this.session !== session || controller.signal.aborted) return;
        this.preserveCalibration(entry, scan);
        entry.scan = scan;
        entry.scaleGuide ||= scan.scaleGuide;
        session.tracking = scan.markers?.some((m) => m.verification === "header") ? { scan } : null;
        entry.score = scan.candidates?.[0]?.geometry.rank ?? (scan.markers?.length || 0);
        this.retainFrame(session, entry);
        session.appraised++;
        // Small score fluctuations between live frames must not repeatedly
        // cancel a useful payload read before its checksum can complete.
        const promotionMargin = Math.max(5, Math.abs(session.readEntry?.score || 0) * 0.08);
        if (scan.candidates?.length && session.readEntry && !session.readAbort?.signal.aborted &&
          this.framePriority(entry) >= this.framePriority(session.readEntry) + promotionMargin) {
          session.readEntry.state = "replaced by a stronger capture";
          session.appraised = Math.max(2, session.appraised);
          session.readAbort.abort(); // Terminates the payload worker, not just its UI updates.
          this.progress.textContent = (entry.scaleGuide?.detected && !session.readEntry.scaleGuide?.detected
            ? "A marker-bearing capture with a scale guide was found. Switching to frame " : "A stronger marker fit was found. Switching to frame ") + frameNumber + "…";
        }
        const signatureText = scan.highConfidence
          ? "All markers agree strongly. Reading the most promising capture."
          : scan.markers?.length ? "Recovery markers verified. Comparing captures before reading contents."
          : scan.signature?.likely ? "Frequency hints found; no verified markers in this capture."
            : "No encoding signature or checksum-valid markers found.";
        this.signature.textContent = [this.edgeGuideSummary(entry), signatureText].filter(Boolean).join(" ");
        if (!session.reading) this.progress.textContent = prefix + (scan.candidates?.length
          ? "Marker scan complete. Ranking the recent captures…"
          : "No stable marker fit. Reframe and hold steady; checking a fresh capture…");
        if (!session.reading) this.readProgress.update(this.progress.textContent);
        this.readBestFrame(session);
      } catch (error) {
        if (this.session !== session || controller.signal.aborted) return;
        if (entry.calibratedOnly) {
          entry.state = "calibrated marker check could not finish";
          if (!session.reading) this.progress.textContent = "This calibrated frame did not decode. Checking a fresh capture…";
          return;
        }
        session.paused = true;
        this.cancelSearches(session);
        this.progress.textContent = (error?.message || "The camera scan could not finish.") + " Scanning paused; resume or tap Capture and read.";
        this.readProgress.finish(this.progress.textContent, "failed");
        this.sync();
      } finally {
        entry.markerFinished = true;
        session.scanning = false;
        if (session.scanningEntry === entry) session.scanningEntry = null;
        if (session.abort === controller) session.abort = null;
        if (this.session === session && !session.paused && !session.adjusting && !session.handingOff) this.scanMarkers(session);
      }
    }

    async readBestFrame(session) {
      if (this.session !== session || session.purpose === "source" || session.paused || session.adjusting || session.reading || session.handingOff) return;
      const entry = session.history.find((frame) => !frame.attempted && frame.scan.candidates?.length && Date.now() - frame.capturedAt < 45000);
      if (!entry) return; // Never spend a payload read on a marker-free capture.
      // A usable geometric fit is enough to attempt the checksummed body.
      // Waiting for another appraisal could age out this readable capture.
      session.appraised = 0;
      session.reading = true;
      session.readEntry = entry;
      this.clearFeedback?.();
      this.signature.textContent = this.edgeGuideSummary(entry);
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
      try {
        const { image, scan, frameNumber } = entry;
        const inspection = await PixelStow.readMarkerCandidates(image.pixels, image.width, image.height, scan, {
          signal: controller.signal, deadline, resumeDiscovery: !entry.calibratedOnly, calibratedOnly: entry.calibratedOnly,
          onProgress: (text) => { if (this.session === session && !controller.signal.aborted) {
            this.progress.textContent = "Reading best capture · frame " + frameNumber + ": " + text;
            this.readProgress.update(this.progress.textContent);
          } }
        });
        if (this.session !== session || controller.signal.aborted) return;
        this.preserveCalibration(entry, inspection);
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

    async accept(session, image, inspection, markerScan, continuousCapture = true) {
      if (this.session !== session || session.handingOff) return;
      session.handingOff = true;
      if (this.frozenFrame) {
        this.frozenFrame.width = image.width;
        this.frozenFrame.height = image.height;
        this.frozenFrame.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(image.pixels),image.width,image.height),0,0);
        this.frozenFrame.hidden = false;
      }
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
        await this.importImage(file, "camera", { image, inspection, markerScan, continuousCapture, sourceOnly: session.purpose === "source" });
      } catch (error) {
        if (this.session !== session) return;
        this.close();
        this.report(error?.message || "Could not open the captured frame. Tap Decode to try again.", true);
      }
    }
  }
  window.PixelStowCamera = PixelStowCamera;
})();
