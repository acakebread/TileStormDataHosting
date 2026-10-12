// Dedicated disposable worker; its input is a copy, never the UI's pixel buffer.
importScripts("./pixelstow-transform.js?v=20261012-transform1", "./pixelstow.js?v=20261012-transform2");
self.onmessage = async ({ data }) => {
  try {
    const result = await self.PixelStow.findVisualTransform(data.pixels, data.width, data.height, {
      mode: data.mode, worker: false, geometryOnly: true,
      onProgress: (progress) => self.postMessage({ progress })
    });
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error?.message || "The visual transform search failed." });
  }
};
