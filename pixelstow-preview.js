// Share the existing image canvases and gestures with a full-screen viewer.
(function (root) {
  "use strict";
  class PixelStowPreview {
    constructor({ preview, viewport, captureView, restoreView, fit, actualSize, resize }) {
      Object.assign(this, { preview, viewport, captureView, restoreView, fit, actualSize, resize });
      this.panel = document.querySelector("#preview-panel");
      this.slot = document.querySelector("#preview-screen");
      this.toolbar = document.querySelector("#preview-screen-toolbar");
      this.audioButton = document.querySelector("#preview-audio");
      this.audioPlaceholder = document.createComment("Image audio control returns here");
      this.markerControl = document.querySelector("#preview-markers");
      this.markerPlaceholder = document.createComment("Marker preview control returns here");
      this.placeholder = document.createComment("Image preview returns here");
      document.querySelector("#full-preview").addEventListener("click", () => this.open(false));
      document.querySelector("#preview-encoded-image").addEventListener("click", () => this.open(true));
      document.querySelector("#preview-screen-close").addEventListener("click", () => this.close());
      document.querySelector("#preview-screen-fit").addEventListener("click", fit);
      document.querySelector("#preview-screen-actual").addEventListener("click", actualSize);
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
        if (!this.panel.open || event.button !== 0 || event.target.closest("button")) return;
        if (this.tap) { this.tap = null; this.multitouch = true; return; }
        if (!this.multitouch) this.tap = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() };
      }, true);
      viewport.addEventListener("pointermove", (event) => {
        if (this.tap?.id === event.pointerId && Math.hypot(event.clientX - this.tap.x, event.clientY - this.tap.y) > 8) this.tap.moved = true;
      }, true);
      viewport.addEventListener("pointerup", (event) => {
        const tap = this.tap;
        this.tap = null;
        if (tap?.id === event.pointerId && !tap.moved && Date.now() - tap.at < 500 && (this.clean || this.toolbar.hidden)) this.controls(this.toolbar.hidden);
        if (event.isPrimary) this.multitouch = false;
      }, true);
      viewport.addEventListener("pointercancel", () => { this.tap = null; this.multitouch = false; }, true);
      document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement === this.panel) this.nativeFullscreen = true;
        else if (this.nativeFullscreen && this.panel.open) this.close();
      });
      root.visualViewport?.addEventListener("resize", () => { if (this.panel.open) resize(); });
    }
    get openNow() { return this.panel.open; }
    get clean() { return this.panel.open && this.panel.classList.contains("clean"); }
    controls(show) { this.toolbar.hidden = !show; }
    open(clean) {
      if (this.panel.open || this.preview.hidden) return;
      this.savedView = this.captureView();
      this.returnFocus = document.activeElement;
      this.preview.before(this.placeholder);
      this.slot.append(this.preview);
      // Move the single image audio shortcut into the top toolbar. Reuse its
      // node/listener/player, and keep the bottom comparison slider unobstructed.
      this.audioButton.before(this.audioPlaceholder);
      this.toolbar.prepend(this.audioButton);
      this.markerControl.before(this.markerPlaceholder);
      this.toolbar.prepend(this.markerControl);
      this.panel.classList.toggle("clean", clean);
      this.controls(!clean);
      document.documentElement.classList.add("preview-modal-open");
      document.body.classList.add("preview-modal-open");
      this.panel.showModal();
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
      this.tap = null; this.multitouch = false;
      this.placeholder.replaceWith(this.preview);
      this.audioPlaceholder.replaceWith(this.audioButton);
      this.markerPlaceholder.replaceWith(this.markerControl);
      document.documentElement.classList.remove("preview-modal-open");
      document.body.classList.remove("preview-modal-open");
      this.restoreView(this.savedView);
      this.returnFocus?.focus({ preventScroll: true });
    }
  }
  root.PixelStowPreview = PixelStowPreview;
})(window);
