import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { MAX_LOGO_BYTES, MAX_LOGO_EDGE, validateLogoPng } from "../worker/logo-image.js";
import { cleanCanvasPngBytes } from "../app/logo-png.js";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const INVALID = /올바른 로고 이미지가 아닙니다/;
// Captured from an 8×8 synthetic canvas in macOS Safari on 2026-09-14.
// Safari adds eXIf color-space/pixel-dimension metadata even for default sRGB.
// This is a generated test pattern, not the user's logo or its metadata.
const SAFARI_CANVAS_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAACVhHtSAAAALElEQVQYGWPUO7LtPwMSOLhuCRKPgYEJhYeFQ7kCxiib2w1YTIYLUW4FQRMAtrMGujNhN8QAAAAASUVORK5CYII=", "base64");

function chunks(bytes) {
  const data = Buffer.from(bytes);
  const result = [];
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    result.push({ type: data.subarray(offset + 4, offset + 8).toString(), bytes: data.subarray(offset, offset + length + 12) });
    offset += length + 12;
  }
  return result;
}

function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const trailer = Buffer.alloc(4); trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, body, trailer]);
}

function header({ width = 1, height = 1, colorType = 6 } = {}) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0); data.writeUInt32BE(height, 4);
  data[8] = 8; data[9] = colorType;
  return chunk("IHDR", data);
}

function png({ before = [], after = [], width = 1, height = 1, colorType = 6, raw, compressed } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType] ?? 4;
  const pixels = raw ?? Buffer.alloc((1 + width * channels) * height);
  return Buffer.concat([SIGNATURE, header({ width, height, colorType }), ...before, chunk("IDAT", compressed ?? deflateSync(pixels)), ...after, chunk("IEND")]);
}

// Minimal bounded ICC structure for mutation/security tests, not a color-rendering fixture.
function profile() {
  const data = Buffer.alloc(152);
  data.writeUInt32BE(data.length);
  data[8] = 4;
  data.write("mntr", 12); data.write("RGB ", 16); data.write("XYZ ", 20); data.write("acsp", 36);
  data.writeUInt32BE(1, 128); data.write("test", 132); data.writeUInt32BE(144, 136); data.writeUInt32BE(8, 140);
  data.write("data", 144);
  return data;
}

function colorChunk(data = profile(), { name = "sRGB IEC61966-2.1", method = 0, compressed } = {}) {
  return chunk("iCCP", Buffer.concat([Buffer.from(name, "latin1"), Buffer.from([0, method]), compressed ?? deflateSync(data)]));
}

test("ordinary canvas PNGs continue to pass for every supported 8-bit channel format", async () => {
  for (const colorType of [0, 2, 4, 6]) await assert.doesNotReject(validateLogoPng(png({ colorType })));
  await assert.doesNotReject(validateLogoPng(png({ width: MAX_LOGO_EDGE, height: MAX_LOGO_EDGE })));
});

test("real Safari canvas PNG saves after metadata cleaning without changing pixels or colors", async () => {
  assert.deepEqual(chunks(SAFARI_CANVAS_PNG).map((item) => item.type), ["IHDR", "sRGB", "eXIf", "IDAT", "IEND"]);
  await assert.rejects(validateLogoPng(SAFARI_CANVAS_PNG), INVALID, "regression: the browser output used to be rejected at save time");
  const before = Buffer.from(SAFARI_CANVAS_PNG);
  const cleaned = cleanCanvasPngBytes(SAFARI_CANVAS_PNG);
  assert.deepEqual(SAFARI_CANVAS_PNG, before, "the cleaner does not modify the original bytes");
  assert.deepEqual(Buffer.from(cleaned), Buffer.concat([SIGNATURE, ...chunks(SAFARI_CANVAS_PNG).filter((item) => item.type !== "eXIf").map((item) => item.bytes)]));
  assert.deepEqual(chunks(cleaned).map((item) => item.type), ["IHDR", "sRGB", "IDAT", "IEND"]);
  await assert.doesNotReject(validateLogoPng(cleaned));
});

test("cleaning preserves already compatible PNGs and does not launder broken or unknown chunks", async () => {
  for (const bytes of [png(), png({ before: [colorChunk()] })]) {
    const cleaned = cleanCanvasPngBytes(bytes);
    assert.deepEqual(Buffer.from(cleaned), bytes);
    await assert.doesNotReject(validateLogoPng(cleaned));
  }
  const corruptExif = Buffer.from(SAFARI_CANVAS_PNG); corruptExif[60] ^= 1;
  const brokenLength = Buffer.from(SAFARI_CANVAS_PNG); brokenLength.writeUInt32BE(0xffffffff, 46);
  for (const bytes of [null, [], Buffer.alloc(0), Buffer.from("not a PNG"), SAFARI_CANVAS_PNG.subarray(0, 70), Buffer.concat([SAFARI_CANVAS_PNG, Buffer.from("junk")]), corruptExif, brokenLength]) {
    assert.throws(() => cleanCanvasPngBytes(bytes), /사진 변환에 실패했습니다/);
  }
  const unknown = png({ before: [chunk("tEXt", Buffer.from("note\0untrusted metadata"))] });
  const corruptPixels = png(); corruptPixels[41] ^= 1;
  for (const bytes of [unknown, corruptPixels]) await assert.rejects(validateLogoPng(cleanCanvasPngBytes(bytes)), INVALID);
});

test("a bounded RGB ICC color profile is accepted instead of rejected as a file-type error", async () => {
  await assert.doesNotReject(validateLogoPng(png({ before: [colorChunk()] })));
  const gray = profile(); gray.write("GRAY", 16);
  await assert.doesNotReject(validateLogoPng(png({ colorType: 0, before: [colorChunk(gray)] })));
});

test("standard canvas color and resolution metadata is accepted with its defined sizes", async () => {
  const gamma = Buffer.alloc(4); gamma.writeUInt32BE(45455);
  const density = Buffer.alloc(9); density.writeUInt32BE(3780, 0); density.writeUInt32BE(3780, 4); density[8] = 1;
  await assert.doesNotReject(validateLogoPng(png({ before: [chunk("gAMA", gamma), chunk("cHRM", Buffer.alloc(32)), chunk("sRGB", Buffer.from([0])), chunk("pHYs", density)] })));
});

test("ICC profile names, compression methods, streams, size and tag offsets are validated", async () => {
  const malformedProfiles = [Buffer.alloc(131)];
  for (const mutate of [
    (data) => data.writeUInt32BE(data.length + 1),
    (data) => data.write("fake", 36),
    (data) => data.write("CMYK", 16),
    (data) => data.write("oops", 20),
    (data) => data.writeUInt32BE(0xffffffff, 128),
    (data) => data.writeUInt32BE(4, 136),
    (data) => data.writeUInt32BE(145, 136),
    (data) => data.writeUInt32BE(0xffffffff, 140),
    (data) => data.writeUInt32BE(1, 140),
  ]) {
    const data = profile(); mutate(data); malformedProfiles.push(data);
  }
  for (const data of malformedProfiles) await assert.rejects(validateLogoPng(png({ before: [colorChunk(data)] })), INVALID);
  for (const name of ["", "x".repeat(80), " leading", "trailing ", "two  spaces", "new\nline", "control\u007f"]) {
    await assert.rejects(validateLogoPng(png({ before: [colorChunk(profile(), { name })] })), INVALID);
  }
  for (const options of [{ method: 1 }, { compressed: Buffer.alloc(0) }, { compressed: Buffer.from("not deflate") }]) {
    await assert.rejects(validateLogoPng(png({ before: [colorChunk(profile(), options)] })), INVALID);
  }
  await assert.rejects(validateLogoPng(png({ colorType: 0, before: [colorChunk()] })), INVALID);
});

test("small compressed profiles cannot inflate beyond the independent 256 KiB cap", async () => {
  const bomb = Buffer.alloc(256 * 1024 + 1);
  const bytes = png({ before: [colorChunk(bomb)] });
  assert(bytes.length < 2048);
  await assert.rejects(validateLogoPng(bytes), INVALID);
});

test("duplicate, misplaced, malformed and unrelated metadata is still rejected", async () => {
  await assert.rejects(validateLogoPng(png({ before: [colorChunk(), colorChunk()] })), INVALID);
  await assert.rejects(validateLogoPng(png({ after: [colorChunk()] })), INVALID);
  for (const extra of [chunk("tEXt", Buffer.from("note\0<script>alert(1)</script>")), chunk("eXIf", Buffer.alloc(8)), chunk("acTL", Buffer.alloc(8)), chunk("sRGB", Buffer.alloc(2)), chunk("sRGB", Buffer.from([4])), chunk("gAMA", Buffer.alloc(4)), chunk("pHYs", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 2]))]) {
    await assert.rejects(validateLogoPng(png({ before: [extra] })), INVALID);
  }
});

test("PNG signatures, byte caps, CRC, dimensions and exact inflated pixels remain enforced", async () => {
  const corrupt = png(); corrupt[40] ^= 1;
  const corruptProfile = colorChunk(); corruptProfile[20] ^= 1;
  for (const bytes of [null, [], Buffer.alloc(0), Buffer.from("<svg/onload=alert(1)>"), Buffer.alloc(MAX_LOGO_BYTES + 1), png().subarray(0, 40), Buffer.concat([png(), Buffer.from("junk")]), corrupt, png({ before: [corruptProfile] }), png({ width: MAX_LOGO_EDGE + 1 }), png({ raw: Buffer.from([5, 0, 0, 0, 0]) }), png({ raw: Buffer.alloc(4) }), png({ raw: Buffer.alloc(6) }), png({ compressed: Buffer.from("not deflate") })]) {
    await assert.rejects(validateLogoPng(bytes), INVALID);
  }
  const bomb = png({ raw: Buffer.alloc(2 * 1024 * 1024) });
  assert(bomb.length < 4096);
  await assert.rejects(validateLogoPng(bomb), INVALID);
});
