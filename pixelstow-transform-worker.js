// Dedicated disposable worker; its input is a copy, never the UI's pixel buffer.
importScripts("./pixelstow-spectrum.js?v=20261012-spectrum1", "./pixelstow-transform.js?v=20261012-photo-pyramid1", "./pixelstow.js?v=20261012-photo-pyramid1");
self.onmessage = async ({ data }) => {
  try {
    const options = {
      mode: data.mode, worker: false, geometryOnly: true, forceSearch: data.forceSearch,
      corners: data.corners, simplerFirst: data.simplerFirst, deadline: data.deadline,
      seedDeadline: data.seedDeadline,
      onSignature: (signature) => self.postMessage({ signature }),
      onProgress: (progress) => self.postMessage({ progress })
    };
    const result = data.operation === "inspect"
      ? await self.PixelStow.inspect(data.pixels, data.width, data.height, { ...options, geometryOnly: false, automatic: true })
      : await self.PixelStow.findVisualTransform(data.pixels, data.width, data.height, options);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error?.message || "The visual transform search failed." });
  }
};
