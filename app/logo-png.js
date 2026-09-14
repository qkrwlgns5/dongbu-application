// Safari adds an eXIf chunk even to a freshly drawn canvas. Remove that
// non-pixel metadata before upload; keep image/color chunks byte-for-byte.
// This only runs AFTER browser decoding and canvas encoding, never on originals.
export function cleanCanvasPngBytes(bytes) {
  const invalid = () => { throw new Error("사진 변환에 실패했습니다. 이미지를 다시 선택해 주세요."); };
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || signature.some((value, index) => bytes[index] !== value)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [bytes.subarray(0, 8)];
  let offset = 8;
  let ended = false;
  let pixels = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const end = offset + size + 12;
    if (end > bytes.length) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8 && (type !== "IHDR" || size !== 13)) invalid();
    if (offset !== 8 && type === "IHDR") invalid();
    if (type === "eXIf") {
      // Check removed data too, so damaged PNGs are not silently repaired.
      let crc = 0xffffffff;
      for (let index = offset + 4; index < end - 4; index++) {
        crc ^= bytes[index];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) invalid();
    } else chunks.push(bytes.subarray(offset, end));
    if (type === "IDAT" && size > 0) pixels = true;
    offset = end;
    if (type === "IEND") { if (size !== 0 || !pixels) invalid(); ended = true; break; }
  }
  if (!ended || offset !== bytes.length) invalid();
  const clean = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let position = 0;
  for (const chunk of chunks) { clean.set(chunk, position); position += chunk.length; }
  return clean;
}

