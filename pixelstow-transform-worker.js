// Dedicated disposable worker; its input is a copy, never the UI's pixel buffer.
importScripts("./pixelstow-spectrum.js?v=20261012-spectrum1", "./pixelstow-transform.js?v=20261012-auto1", "./pixelstow.js?v=20261012-auto1");
self.onmessage = async ({ data }) => {
  try {
    const result = await self.PixelStow.findVisualTransform(data.pixels, data.width, data.height, {
      mode: data.mode, worker: false, geometryOnly: true, forceSearch: data.forceSearch,
      corners: data.corners, simplerFirst: data.simplerFirst,
      onSignature: (signature) => self.postMessage({ signature }),
      onProgress: (progress) => self.postMessage({ progress })
    });
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error?.message || "The visual transform search failed." });
  }
};
