// Clipboard and native sharing stay in the browser; no photo is hosted or uploaded here.
(function () {
  const openingUrl = "https://www.massivehadron.com/pixelstow.html#open-card";
  const shareText = "There is a message inside this photo! Open it in PixelStow: " + openingUrl + "\nSave the original image to Files and choose it there, or copy the photo and tap Paste image.";

  class Sharing {
    constructor({ importImage, save, report, working, setBusy, hasImage, imageForClipboard }) {
      Object.assign(this, { importImage, save, report, working, setBusy, hasImage, imageForClipboard, file: null });
      this.copyButton = document.querySelector("#copy-image");
      this.pasteButton = document.querySelector("#paste-image");
      this.pasteDialog = document.querySelector("#paste-dialog");
      this.pasteTarget = document.querySelector("#paste-target");
      this.pasteHelp = document.querySelector("#paste-help");
      this.shareButton = document.querySelector("#share-image");
      this.messageButton = document.querySelector("#share-message");
      this.shareHelp = document.querySelector("#share-help");
      this.shareDialog = document.querySelector("#share-dialog");
      this.shareLink = document.querySelector("#share-link");
      this.shareStatus = document.querySelector("#share-status");
      this.shareLink.value = shareText;
      document.querySelector("#whatsapp-link").href = "https://wa.me/?text=" + encodeURIComponent(shareText);
      this.pasteButton.addEventListener("click", () => this.paste());
      this.copyButton.addEventListener("click", () => this.copyImage());
      this.shareButton.addEventListener("click", () => this.share());
      this.messageButton.addEventListener("click", () => {
        if (!this.working() && this.file) this.shareFallback("Include this clickable opening message with the original image. The WhatsApp link sends the message only; attach the photo separately.");
      });
      document.querySelector("#paste-close").addEventListener("click", () => this.pasteDialog.close());
      this.pasteDialog.addEventListener("close", () => this.pasteTarget.replaceChildren());
      // Text/HTML never gets inserted into this box. Accept only an actual image file.
      this.pasteTarget.addEventListener("beforeinput", (event) => event.preventDefault());
      document.addEventListener("paste", (event) => {
        const data = event.clipboardData;
        const image = Array.from(data?.items || []).filter((item) => item.kind === "file" && /^image\//.test(item.type)).map((item) => item.getAsFile()).find(Boolean)
          || Array.from(data?.files || []).find((file) => /^image\//.test(file.type));
        if (!image) {
          if (this.pasteDialog.open) {
            event.preventDefault();
            this.pasteHelp.textContent = "No image was pasted. Copy the actual photo, or save it to Files and use Choose image.";
          }
          return;
        }
        event.preventDefault();
        if (this.working()) return;
        if (this.pasteDialog.open) this.pasteDialog.close();
        this.importImage(image, "clipboard");
      });
      document.querySelector("#share-close").addEventListener("click", () => this.shareDialog.close());
      document.querySelector("#download-share-image").addEventListener("click", () => {
        if (this.working() || !this.file) return;
        const file = this.file;
        this.shareDialog.close();
        this.save(file, file.name || "pixelstow-card.png");
      });
      document.querySelector("#copy-share-link").addEventListener("click", () => this.copyMessage());
      const showOpeningNote = () => { document.querySelector("#open-card-note").hidden = location.hash !== "#open-card"; };
      window.addEventListener("hashchange", showOpeningNote);
      showOpeningNote();
      this.sync();
    }

    setFile(file) {
      if (file && !/\.(png|jpe?g)$/i.test(file.name)) {
        const extension = { "image/png": ".png", "image/jpeg": ".jpg" }[file.type];
        if (extension) file = new File([file], (file.name || "clipboard-image") + extension, { type: file.type });
      }
      this.file = file;
      this.sync();
    }
    sync() {
      this.pasteButton.disabled = this.working();
      this.copyButton.disabled = this.working();
      this.copyButton.hidden = !this.hasImage();
      this.shareButton.disabled = this.working();
      this.messageButton.disabled = this.working();
      this.shareButton.hidden = !this.file;
      this.messageButton.hidden = !this.file;
      this.shareHelp.hidden = !this.file;
    }

    async copyImage() {
      if (this.working() || !this.hasImage()) return;
      if (!navigator.clipboard?.write || !window.ClipboardItem) {
        this.report("This browser cannot copy an image directly. Use Download encoded PNG, or save the original image from Files.", true);
        return;
      }
      try {
        // Safari needs write() inside the tap. Pass a promise for PNG creation
        // instead of awaiting it and losing the user activation.
        const png = Promise.resolve(this.imageForClipboard());
        const copying = navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        this.setBusy(true);
        await copying;
        this.report("Image copied to clipboard. Paste it into your message; choose an original file / document when available to preserve its contents.");
      } catch (_) {
        this.report("The browser could not copy the image. Allow clipboard access and try again, or download the PNG instead.", true);
      } finally {
        this.setBusy(false);
      }
    }

    pasteFallback(message) {
      this.pasteHelp.textContent = message + " Touch and hold in the box, then choose Paste (or press Ctrl / Cmd + V).";
      this.pasteTarget.replaceChildren();
      if (!this.pasteDialog.open) this.pasteDialog.showModal();
      this.pasteTarget.focus();
    }

    async paste() {
      if (this.working()) return;
      if (!navigator.clipboard?.read) {
        this.pasteFallback("Copy the actual photo first.");
        return;
      }
      let image;
      try {
        // Call read directly from the tap. Safari may show its own Paste callout.
        const reading = navigator.clipboard.read();
        this.setBusy(true);
        this.report("Allow your browser's Paste prompt to load the copied image…");
        const items = await reading;
        for (const item of items) {
          const type = item.types.find((type) => /^image\//.test(type));
          if (!type) continue;
          const blob = await item.getType(type);
          image = new File([blob], "clipboard-image", { type });
          break;
        }
      } catch (_) {
        this.pasteFallback("Safari could not read the clipboard directly. Copy the photo, then paste it below.");
      } finally {
        this.setBusy(false);
      }
      if (image) await this.importImage(image, "clipboard");
      else if (!this.pasteDialog.open) this.pasteFallback("The clipboard did not contain an image. Copy the actual photo first.");
    }

    shareFallback(message) {
      this.shareStatus.textContent = message;
      if (!this.shareDialog.open) this.shareDialog.showModal();
    }

    async share() {
      if (this.working() || !this.file) return;
      try {
        if (!navigator.share || !navigator.canShare?.({ files: [this.file] })) {
          this.shareFallback("This browser cannot share image files directly. Download the image and attach it separately; the WhatsApp link includes the opening message only.");
          return;
        }
        // The verified file is prepared in advance: no encoding or download dialog
        // can consume Safari's user activation before the native share sheet opens.
        const sharing = navigator.share({ files: [this.file], title: "PixelStow photo card", text: shareText });
        this.setBusy(true);
        await sharing;
        this.report("Image handed to the sharing app. Keep the opening link and send the original file to preserve its contents.");
      } catch (error) {
        if (error.name === "AbortError") this.report("Sharing cancelled. Your image is still ready.");
        else this.shareFallback("The image could not be shared directly. Download the image, attach the original file and include this message.");
      } finally {
        this.setBusy(false);
      }
    }

    async copyMessage() {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(shareText);
        this.shareStatus.textContent = "Opening message copied. Attach the original image too.";
      } catch (_) {
        this.shareLink.focus();
        this.shareLink.select();
        this.shareStatus.textContent = "Touch and hold the selected message and choose Copy, or press Ctrl / Cmd + C.";
      }
    }
  }
  window.PixelStowSharing = Sharing;
})();
