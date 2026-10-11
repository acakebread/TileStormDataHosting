// Shared filename dialog for browser downloads. It never writes the input file.
(function () {
  class ExportDialog {
    constructor() {
      this.dialog = document.querySelector("#export-dialog");
      this.form = document.querySelector("#export-form");
      this.name = document.querySelector("#export-name");
      this.preview = document.querySelector("#export-preview");
      this.error = document.querySelector("#export-error");
      this.extension = "";
      this.pending = null;
      this.result = null;
      this.name.addEventListener("input", () => this.update());
      this.form.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
          this.result = this.filename();
          this.dialog.close();
        } catch (error) {
          this.error.textContent = error.message;
          this.error.hidden = false;
          this.name.focus();
        }
      });
      document.querySelector("#export-cancel").addEventListener("click", () => this.dialog.close());
      this.dialog.addEventListener("close", () => {
        const resolve = this.pending;
        this.pending = null;
        if (resolve) resolve(this.result);
        this.result = null;
        this.name.value = "";
        this.preview.textContent = "";
      });
    }

    filename() {
      let name = this.name.value.trim();
      if (!name) throw new Error("Enter a filename.");
      if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /\.$/.test(name)) {
        throw new Error("Enter a filename without folders, special path characters or a trailing dot.");
      }
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error("Choose another filename; this name is reserved by Windows.");
      }
      if (this.extension && !name.toLowerCase().endsWith(this.extension.toLowerCase())) name += this.extension;
      if (new TextEncoder().encode(name).length > 255) throw new Error("Choose a shorter filename.");
      return name;
    }

    update() {
      this.error.hidden = true;
      try {
        this.preview.textContent = "Save as: " + this.filename();
      } catch (error) {
        this.preview.textContent = "";
      }
    }

    chooseFilename(suggestedName) {
      if (this.pending) return Promise.resolve(null);
      this.extension = /\.[^.]+$/.exec(suggestedName)?.[0] || "";
      this.name.value = suggestedName;
      this.result = null;
      this.update();
      this.dialog.showModal();
      this.name.focus();
      const end = this.extension ? suggestedName.length - this.extension.length : suggestedName.length;
      this.name.setSelectionRange(0, end);
      return new Promise((resolve) => { this.pending = resolve; });
    }

    download(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.dataset.pixelstowExport = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  window.PixelStowExportDialog = ExportDialog;
})();
