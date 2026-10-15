// UI evidence stages only: these colours are neither elapsed-time progress nor
// a probability of recovery. A rejected candidate can move straight back to red.
(function (root) {
  "use strict";
  class PixelStowReadProgress {
    constructor(element) { this.element = element; this.clear(); }
    clear() { this.show("", "idle", 0); }
    begin(text = "Reading the image…") { this.show(text, "search", .05); }
    show(text, stage, value) {
      this.value = value;
      this.element.textContent = text;
      this.element.dataset.stage = stage;
      const colours = [[237, 119, 119], [239, 198, 106], [99, 215, 156]];
      const half = value < .5 ? 0 : 1, mix = value < .5 ? value * 2 : (value - .5) * 2;
      const rgb = colours[half].map((start, i) => Math.round(start + (colours[half + 1][i] - start) * mix));
      this.element.style.color = ["idle", "source", "cancelled"].includes(stage) ? "var(--muted)" : "rgb(" + rgb.join(",") + ")";
      this.element.title = text ? text + " — colour indicates recovery stage, not a success probability." : "";
    }
    signature(signature) {
      this.show(signature.message, "signature", signature.likely ? .28 : .08);
    }
    update(text) {
      const marker = text.match(/(?:found|complete:)\s*(\d+)\s*\/\s*(\d+)\s*(?:markers)?/i);
      let stage = "search", value = this.value || .1;
      if (/did not decode|did not pass|no stable|no .*found|failed|could not|time limit/i.test(text)) { stage = "retry"; value = .06; }
      else if (/subpixel alignment/i.test(text)) { stage = "alignment"; value = .9; }
      else if (/curved wavelet grid|tracked grid/i.test(text)) { stage = "grid"; value = .85; }
      else if (/refining .*pixel grid/i.test(text)) { stage = "grid"; value = .8; }
      else if (/reading ranked candidate|reading best capture|reading the most promising/i.test(text)) { stage = "payload"; value = .72; }
      else if (/refining .*alignment|corner geometry agrees/i.test(text)) { stage = "geometry"; value = .62; }
      else if (marker) { stage = "markers"; value = +marker[1] ? .3 + .28 * Math.min(1, +marker[1] / Math.max(1, +marker[2])) : .1; }
      else if (/frequency/i.test(text)) { stage = "signature"; value = .2; }
      else if (/locating photo markers|checking common|looking for encoded|checking markers|preparing wavelet|original size/i.test(text)) value = .12;
      this.show(text, stage, value);
    }
    finish(text, stage = "success") {
      this.show(text, stage, stage === "success" ? 1 : stage === "locked" ? .95 : 0);
    }
  }
  root.PixelStowReadProgress = PixelStowReadProgress;
})(window);
