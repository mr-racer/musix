import { Sha256 } from "./sha256";

// sha256 of a File, 8 MB at a time, off the main thread; progress as it goes
self.onmessage = async (e: MessageEvent<File>) => {
  const f = e.data;
  const h = new Sha256();
  const STEP = 8 * 1024 * 1024;
  for (let o = 0; o < f.size; o += STEP) {
    h.update(new Uint8Array(await f.slice(o, o + STEP).arrayBuffer()));
    self.postMessage({ progress: Math.min(1, (o + STEP) / f.size) });
  }
  self.postMessage({ sha256: h.hex() });
};
