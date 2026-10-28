// Tests for grid finding. Run with: node --test
// We draw test pictures ourselves, pixel by pixel, so we know exactly
// where the grid's corners are and can check the answer.
const test = require("node:test");
const assert = require("node:assert");
const { findGrid, warpGrid, cutCells } = require("./vision.js");

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

// Paint a dark line of the given thickness from point a to point b.
function drawLine(img, a, b, thickness) {
  const pad = Math.ceil(thickness);
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x)) - pad);
  const maxX = Math.min(img.width - 1, Math.ceil(Math.max(a.x, b.x)) + pad);
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y)) - pad);
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(a.y, b.y)) + pad);
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / lengthSq));
      const dist = Math.hypot(x - (a.x + t * (b.x - a.x)), y - (a.y + t * (b.y - a.y)));
      if (dist <= thickness / 2) img.data.fill(20, (y * img.width + x) * 4, (y * img.width + x) * 4 + 3);
    }
  }
}

// Draw a Sudoku grid (no digits) with the given corners.
function drawGrid(img, corners) {
  const [tl, tr, br, bl] = corners;
  const at = (u, v) => {
    const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
    const bot = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  };
  for (let k = 0; k <= 9; k++) {
    const thickness = k % 3 === 0 ? 5 : 2;
    drawLine(img, at(k / 9, 0), at(k / 9, 1), thickness);
    drawLine(img, at(0, k / 9), at(1, k / 9), thickness);
  }
}

function assertNear(found, expected, tolerance) {
  found.forEach((p, k) => {
    const off = Math.hypot(p.x - expected[k].x, p.y - expected[k].y);
    assert.ok(off <= tolerance, `corner ${k} is ${off.toFixed(1)}px away from where it should be`);
  });
}

test("finds a straight grid", () => {
  const img = blankImage(400, 360);
  const corners = [{ x: 60, y: 40 }, { x: 340, y: 40 }, { x: 340, y: 320 }, { x: 60, y: 320 }];
  drawGrid(img, corners);
  assertNear(findGrid(img), corners, 4);
});

test("finds a slightly turned grid next to a bigger plain frame", () => {
  const img = blankImage(600, 500);
  // A decoy: an empty rectangle bigger than the grid, like a photo border.
  const frame = [{ x: 10, y: 10 }, { x: 590, y: 10 }, { x: 590, y: 490 }, { x: 10, y: 490 }];
  frame.forEach((p, k) => drawLine(img, p, frame[(k + 1) % 4], 4));
  // The grid, turned by about 8 degrees.
  const corners = [{ x: 180, y: 80 }, { x: 440, y: 116 }, { x: 404, y: 376 }, { x: 144, y: 340 }];
  drawGrid(img, corners);
  assertNear(findGrid(img), corners, 4);
});

test("returns null when there is no grid", () => {
  const img = blankImage(300, 300);
  drawLine(img, { x: 20, y: 150 }, { x: 280, y: 150 }, 3);
  assert.strictEqual(findGrid(img), null);
});

test("straightens and cuts the grid into 81 equal cells", () => {
  const img = blankImage(400, 400);
  const corners = [{ x: 50, y: 50 }, { x: 350, y: 50 }, { x: 350, y: 350 }, { x: 50, y: 350 }];
  drawGrid(img, corners);
  const warped = warpGrid(img, corners, 450);
  assert.strictEqual(warped.width, 450);
  // A grid line runs exactly through the middle of the left edge after straightening.
  const pixel = (x, y) => warped.data[(y * 450 + x) * 4];
  assert.ok(pixel(150, 75) < 100, "box line at one third should be dark");
  assert.ok(pixel(75, 75) > 200, "middle of a cell should be light");

  const cells = cutCells(warped);
  assert.strictEqual(cells.length, 81);
  assert.ok(cells.every((c) => c.width === cells[0].width && c.width > 30));
  // With the grid lines trimmed off, an empty cell is all white.
  assert.ok(cells[40].data.every((v) => v > 200));
});
