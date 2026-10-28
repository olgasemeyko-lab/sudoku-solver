// Tests for reading digits. Run with: node --test
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { findGrid, warpGrid, cutCells } = require("./vision.js");
const { prepareCell, readDigits } = require("./digits.js");
const { DIGIT_MODEL } = require("./digit-model.js");
const { readPng } = require("./tests/png.js");

// What the example screenshot really contains (checked by eye).
// The model never saw this image during training, so this is a fair test.
const SCREENSHOT_PUZZLE =
  "...4.8..." + ".6..7..1." + "7.2.9.5.4" +
  ".9.7.4.3." + "..7.5.8.." + ".8.9.6.5." +
  "9.4.1.7.8" + ".7..6..4." + "...2.7...";

function blankCell(size) {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
}

test("an empty cell is recognised as empty", () => {
  assert.strictEqual(prepareCell(blankCell(38)), null);
});

test("a cell holding only a stray grid line is recognised as empty", () => {
  const cell = blankCell(38);
  for (let x = 0; x < 38; x++) {
    for (let y = 1; y <= 3; y++) cell.data.fill(0, (y * 38 + x) * 4, (y * 38 + x) * 4 + 3);
  }
  assert.strictEqual(prepareCell(cell), null);
});

test("reads every digit of the example screenshot correctly", () => {
  const image = readPng(path.join(__dirname, "examples", "screenshot.png"));
  const corners = findGrid(image);
  assert.ok(corners, "the grid should be found");
  const readings = readDigits(cutCells(warpGrid(image, corners, 450)), DIGIT_MODEL);
  const text = readings.map((r) => (r.digit === 0 ? "." : String(r.digit))).join("");
  assert.strictEqual(text, SCREENSHOT_PUZZLE);
  // ...and is confident about every digit it read.
  const lowest = Math.min(...readings.filter((r) => r.digit).map((r) => r.confidence));
  assert.ok(lowest > 0.9, "lowest confidence was " + lowest.toFixed(2));
});
