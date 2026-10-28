// A small PNG reader for the tests, so they can open real screenshots
// without installing anything. Handles the common kind of PNG: 8 bits per
// colour, RGB or RGBA, not interlaced.
const fs = require("fs");
const zlib = require("zlib");

function readPng(file) {
  const bytes = fs.readFileSync(file);
  let width, height, colorType;
  const compressed = [];
  // A PNG is a list of "chunks": IHDR (size and format), IDAT (pixels), ...
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("Only 8-bit, non-interlaced RGB or RGBA PNGs are supported");
      }
    }
    if (type === "IDAT") compressed.push(body);
    at += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  // Each row starts with a "filter" byte saying how it was encoded
  // relative to the pixel on the left and the row above.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      if (filter === 2) predicted = up;
      if (filter === 3) predicted = (left + up) >> 1;
      if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predicted) & 255;
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = pixels[i * channels];
    data[i * 4 + 1] = pixels[i * channels + 1];
    data[i * 4 + 2] = pixels[i * channels + 2];
    data[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, data };
}

module.exports = { readPng };
