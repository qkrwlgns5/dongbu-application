export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_EDGE = 512;

// Only a bounded, structurally valid PNG is served. The browser converts the
// selected raster to PNG first; SVG, HTML and original photo metadata are not stored.
export async function validateLogoPng(bytes) {
  const invalid = () => { throw new Error("올바른 로고 이미지가 아닙니다. PNG·JPG·WebP 사진을 다시 선택해 주세요."); };
  if (bytes.length < 57 || bytes.length > MAX_LOGO_BYTES) invalid();
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => bytes[index] !== byte)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let imageData = false;
  let ended = false;
  let rowBytes = 0;
  let expectedBytes = 0;
  const dataChunks = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    // Canvas encoders may add these standard, non-textual color/size chunks.
    if (!["IHDR", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "pHYs"].includes(type)) invalid();
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index++) {
      crc ^= bytes[index];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + length)) invalid();
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) invalid();
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      if (width < 1 || height < 1 || width > MAX_LOGO_EDGE || height > MAX_LOGO_EDGE) invalid();
      if (bytes[24] !== 8 || ![0, 2, 4, 6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) invalid();
      const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[25]];
      rowBytes = 1 + width * channels;
      expectedBytes = rowBytes * height;
    } else if (type === "IHDR") invalid();
    if (type === "IDAT" && length > 0) { imageData = true; dataChunks.push(bytes.slice(offset + 8, offset + 8 + length)); }
    offset += length + 12;
    if (type === "IEND") { if (length !== 0 || !imageData) invalid(); ended = true; break; }
  }
  if (!ended || offset !== bytes.length) invalid();
  // Verify the compressed pixels, not just the PNG envelope. Bound inflation
  // to the IHDR dimensions so a compressed payload cannot exhaust memory.
  const reader = new Blob(dataChunks).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let inflatedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (inflatedBytes + value.length > expectedBytes) { await reader.cancel(); invalid(); }
      for (let index = 0; index < value.length; index++) if ((inflatedBytes + index) % rowBytes === 0 && value[index] > 4) invalid();
      inflatedBytes += value.length;
    }
    if (inflatedBytes !== expectedBytes) invalid();
  } catch { await reader.cancel().catch(() => {}); invalid(); }
  finally { reader.releaseLock(); }
}

export function logoObjectKey(eventId, version) {
  return `event-logos/${encodeURIComponent(eventId)}/${version}.png`;
}
