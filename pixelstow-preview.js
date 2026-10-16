// Share the existing image canvases and gestures with a full-screen viewer.
(function (root) {
  "use strict";
  class PixelStowPreview {
    constructor({ preview, viewport, canToggleSource, captureView, restoreView, fit, actualSize, resize }) {
      Object.assign(this, { preview, viewport, canToggleSource, captureView, restoreView, fit, actualSize, resize });
      this.panel = document.querySelector("#preview-panel");
      this.slot = document.querySelector("#preview-screen");
      this.toolbar = document.querySelector("#preview-screen-toolbar");
      this.footer = document.querySelector("#preview-screen-footer");
      this.actions = document.querySelector("#preview-screen-actions");
      this.toggleButton = document.querySelector("#preview-screen-toggle");
      this.audioButton = document.querySelector("#preview-audio");
      this.audioPlaceholder = document.createComment("Image audio control returns here");
      this.comparison = document.querySelector("#comparison-control");
      this.comparisonPlaceholder = document.createComment("Comparison slider returns here");
      this.placeholder = document.createComment("Image preview returns here");
      this.pointers = new Set();
      document.querySelector("#full-preview").addEventListener("click", () => this.open(false));
      document.querySelector("#preview-encoded-image").addEventListener("click", () => this.open(true));
      document.querySelector("#preview-screen-close").addEventListener("click", () => this.close());
      document.querySelector("#preview-screen-fit").addEventListener("click", fit);
      document.querySelector("#preview-screen-actual").addEventListener("click", actualSize);
      this.toggleButton.addEventListener("click", () => this.toggleSource());
      document.querySelector("#preview-screen-hide").addEventListener("click", () => this.controls(false));
      this.panel.addEventListener("cancel", (event) => { event.preventDefault(); this.close(); });
      this.panel.addEventListener("close", () => this.restore());
      this.panel.addEventListener("keydown", (event) => {
        if (event.key === "Tab") this.controls(true);
        if (event.key === "Escape") { event.preventDefault(); this.close(); }
      });
      // Pointer events work even when the touch viewer suppresses native clicks.
      // A two-finger gesture or a drag must never reveal presentation controls.
      viewport.addEventListener("pointerdown", (event) => {
        if (!this.panel.open || event.button !== 0) return;
        this.pointers.add(event.pointerId);
        if (this.pointers.size > 1) { this.cancelTap(); this.multitouch = true; return; }
        if (event.target.closest("button")) return;
        if (!this.multitouch) {
          this.tap = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() };
          if (this.clean) this.holdTimer = setTimeout(() => {
            this.holdTimer = null;
            if (this.clean && this.tap?.id === event.pointerId && !this.tap.moved && this.toggleSource()) {
              this.tap.held = true;
            }
          }, 450);
        }
      }, true);
      viewport.addEventListener("pointermove", (event) => {
        if (this.tap?.id === event.pointerId && Math.hypot(event.clientX - this.tap.x, event.clientY - this.tap.y) > 8) {
          this.tap.moved = true;
          clearTimeout(this.holdTimer); this.holdTimer = null;
        }
      }, true);
      viewport.addEventListener("pointerup", (event) => {
        const tap = this.tap;
        this.cancelTap();
        this.pointers.delete(event.pointerId);
        if (!this.multitouch && tap?.id === event.pointerId && !tap.moved && !tap.held && Date.now() - tap.at < 450 && (this.clean || this.toolbar.hidden)) this.controls(this.toolbar.hidden);
        if (!this.pointers.size) this.multitouch = false;
      }, true);
      viewport.addEventListener("pointercancel", (event) => {
        this.cancelTap();
        this.pointers.delete(event.pointerId);
        if (!this.pointers.size) this.multitouch = false;
      }, true);
      root.addEventListener("blur", () => { this.cancelTap(); this.pointers.clear(); this.multitouch = false; });
      document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement === this.panel) this.nativeFullscreen = true;
        else if (this.nativeFullscreen && this.panel.open) this.close();
      });
      root.visualViewport?.addEventListener("resize", () => { if (this.panel.open) resize(); });
      this.syncToggleSource();
    }
    get openNow() { return this.panel.open; }
    get clean() { return this.panel.open && this.panel.classList.contains("clean"); }
    syncToggleSource() {
      const available = Boolean(this.canToggleSource?.());
      if (!available) this.panel.classList.remove("show-source");
      const source = this.panel.classList.contains("show-source");
      this.toggleButton.hidden = !this.clean;
      this.toggleButton.disabled = !available;
      this.toggleButton.setAttribute("aria-pressed", String(source));
      const label = source ? "Show encoded image" : "Show source image";
      this.toggleButton.setAttribute("aria-label", label);
      this.toggleButton.title = label;
    }
    toggleSource() {
      if (!this.clean || !this.canToggleSource?.()) { this.syncToggleSource(); return false; }
      this.panel.classList.toggle("show-source");
      this.syncToggleSource();
      return true;
    }
    cancelTap() { this.tap = null; clearTimeout(this.holdTimer); this.holdTimer = null; }
    controls(show) {
      const focusInFooter = this.footer.contains(document.activeElement);
      this.toolbar.hidden = this.footer.hidden = !show;
      if (!show && focusInFooter && this.panel.open) this.panel.focus({ preventScroll: true });
      if (this.panel.open) this.resize();
    }
    open(clean) {
      if (this.panel.open || this.preview.hidden) return;
      this.savedView = this.captureView();
      this.returnFocus = document.activeElement;
      this.preview.before(this.placeholder);
      this.slot.append(this.preview);
      // Reuse the single audio player and comparison slider in the footer.
      // Audio, analysis and view actions share a single row below the slider.
      this.audioButton.before(this.audioPlaceholder);
      this.actions.prepend(this.audioButton);
      this.comparison.before(this.comparisonPlaceholder);
      this.footer.prepend(this.comparison);
      this.panel.classList.toggle("clean", clean);
      this.panel.classList.remove("show-source");
      this.panel.setAttribute("aria-label", clean ? "Full screen image preview. Tap for controls; hold to switch encoded image and source when available; drag with the left mouse button or one or two fingers to pan; pinch to zoom; Escape to close."
        : "Full screen image comparison. Tap for controls; hold to drag the divider; pinch to zoom; Escape to close.");
      this.controls(!clean);
      document.documentElement.classList.add("preview-modal-open");
      document.body.classList.add("preview-modal-open");
      this.panel.showModal();
      this.syncToggleSource();
      // Focus the dialog itself so a hidden toolbar cannot gain autofocus and
      // put a focus ring over the encoded picture on entry.
      this.panel.focus({ preventScroll: true });
      this.fit();
      // The viewport dialog also works on iPhones without element fullscreen.
      // Where available, presentation mode can remove browser chrome as well.
      if (clean && this.panel.requestFullscreen) {
        try { this.panel.requestFullscreen().catch(() => {}); } catch { /* Keep viewport mode. */ }
      }
    }
    close() {
      if (this.panel.open) this.panel.close();
      if (document.fullscreenElement === this.panel) document.exitFullscreen().catch(() => {});
    }
    restore() {
      this.nativeFullscreen = false;
      this.cancelTap(); this.multitouch = false;
      this.panel.classList.remove("show-source");
      this.syncToggleSource();
      this.pointers.clear();
      this.placeholder.replaceWith(this.preview);
      this.audioPlaceholder.replaceWith(this.audioButton);
      this.comparisonPlaceholder.replaceWith(this.comparison);
      document.documentElement.classList.remove("preview-modal-open");
      document.body.classList.remove("preview-modal-open");
      this.restoreView(this.savedView);
      this.returnFocus?.focus({ preventScroll: true });
    }
  }
  root.PixelStowPreview = PixelStowPreview;
})(window);
