import { cleanCanvasPngBytes } from "../app/logo-png.js";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_EDGE = 512;
const MAX_COLOR_PROFILE_BYTES = 256 * 1024;

// WebKit's canvas PNG encoder can include an ICC color profile. It is normal
// image color information, not a different file type. Validate it separately
// with its own inflation bound instead of rejecting all iCCP chunks.
async function validateColorProfile(data, colorType, invalid) {
  const separator = data.indexOf(0);
  if (separator < 1 || separator > 79 || data[separator + 1] !== 0 || separator + 2 >= data.length) invalid();
  for (let index = 0; index < separator; index++) {
    const byte = data[index];
    if (byte < 32 || (byte > 126 && byte < 161) || (byte === 32 && (index === 0 || index === separator - 1 || data[index - 1] === 32))) invalid();
  }
  const parts = [];
  const reader = new Blob([data.subarray(separator + 2)]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_COLOR_PROFILE_BYTES) invalid();
      parts.push(value);
    }
  } catch { await reader.cancel().catch(() => {}); invalid(); }
  finally { reader.releaseLock(); }
  if (total < 132) invalid();
  const profile = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { profile.set(part, offset); offset += part.length; }
  const view = new DataView(profile.buffer);
  const signature = (start) => String.fromCharCode(...profile.subarray(start, start + 4));
  if (view.getUint32(0) !== total || signature(36) !== "acsp") invalid();
  if (signature(16) !== ([0, 4].includes(colorType) ? "GRAY" : "RGB ") || !["XYZ ", "Lab "].includes(signature(20))) invalid();
  const count = view.getUint32(128);
  const tableEnd = 132 + count * 12;
  if (tableEnd > total) invalid();
  for (let index = 0; index < count; index++) {
    const position = 132 + index * 12;
    const tagOffset = view.getUint32(position + 4);
    const tagLength = view.getUint32(position + 8);
    if (tagOffset < tableEnd || tagOffset % 4 !== 0 || tagLength < 8 || tagOffset + tagLength > total) invalid();
  }
}

// Only a bounded, structurally valid PNG is served. The browser converts the
// selected raster to PNG first; SVG, HTML and original photo metadata are not stored.
// Standard canvas-generated color profiles are retained to preserve logo colors.
// Return the validated, cleaned bytes so older clients can send Safari's eXIf
// chunk, but that non-pixel metadata is never stored or served.
export async function validateLogoPng(bytes) {
  const invalid = () => { throw new Error("올바른 로고 이미지가 아닙니다. PNG·JPG·WebP 사진을 다시 선택해 주세요."); };
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > MAX_LOGO_BYTES) invalid();
  // Enforce the raw byte cap before cleaning; validate the removed chunk's CRC
  // as well as all retained image/color data. Do not silently repair corruption.
  try { bytes = cleanCanvasPngBytes(bytes); } catch { invalid(); }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => bytes[index] !== byte)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let imageData = false;
  let ended = false;
  let rowBytes = 0;
  let expectedBytes = 0;
  let colorType = 0;
  const dataChunks = [];
  const seenMetadata = new Set();
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > bytes.length) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    // Canvas encoders may add these standard, non-textual color/size chunks.
    if (!["IHDR", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "pHYs", "iCCP"].includes(type)) invalid();
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
      colorType = bytes[25];
      const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[bytes[25]];
      rowBytes = 1 + width * channels;
      expectedBytes = rowBytes * height;
    } else if (type === "IHDR") invalid();
    if (["sRGB", "gAMA", "cHRM", "pHYs", "iCCP"].includes(type)) {
      if (imageData || seenMetadata.has(type)) invalid();
      seenMetadata.add(type);
      if (type === "iCCP") {
        await validateColorProfile(bytes.subarray(offset + 8, offset + 8 + length), colorType, invalid);
      } else {
        const expectedLength = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 }[type];
        if (length !== expectedLength) invalid();
        if (type === "sRGB" && bytes[offset + 8] > 3) invalid();
        if (type === "gAMA" && view.getUint32(offset + 8) === 0) invalid();
        if (type === "pHYs" && bytes[offset + 16] > 1) invalid();
      }
    }
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
  return bytes;
}

export function logoObjectKey(eventId, version) {
  return `event-logos/${encodeURIComponent(eventId)}/${version}.png`;
}
