// Finding a Sudoku grid in an image.
//
// Every function here works on a plain image object:
//   { width, height, data }
// where `data` holds 4 numbers per pixel (red, green, blue, alpha, each 0-255),
// row by row from the top-left. That's the same layout the browser's
// canvas uses, so the page can pass canvas pixels straight in.
//
// The overall recipe (see findGrid):
//   1. Mark every pixel that is clearly darker than its surroundings as "ink".
//   2. Group touching ink pixels into shapes. All of a Sudoku's lines touch
//      its outer border, so the whole grid is one big shape.
//   3. Pick the biggest roughly-square shape that has lines where the
//      3x3 box borders should be.
//   4. Find its four outer corners.
// Then warpGrid straightens the grid into a square, and cutCells splits it.

// Turn colour pixels into brightness values, 0 (black) to 255 (white).
// Transparent pixels count as white, like a screenshot on a white page.
function toGray(img) {
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) {
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    const a = img.data[i * 4 + 3] / 255;
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b; // how bright it looks to a human eye
    gray[i] = Math.round(brightness * a + 255 * (1 - a));
  }
  return gray;
}

// Step 1: mark "ink" pixels (1) and background pixels (0).
// A pixel counts as ink when it is noticeably darker than the average of the
// square around it. Comparing with the surroundings, instead of using one
// fixed cut-off for the whole image, copes with shadows and tinted backgrounds.
function findInk(gray, width, height) {
  const radius = Math.max(7, Math.round(Math.min(width, height) / 40));
  const darkerBy = 12;

  // A "summed-area table": sums[y][x] holds the total of all pixels above and
  // to the left. With it, the average of any rectangle takes 4 lookups
  // instead of adding up thousands of pixels.
  const w1 = width + 1;
  const sums = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowTotal = 0;
    for (let x = 0; x < width; x++) {
      rowTotal += gray[y * width + x];
      sums[(y + 1) * w1 + x + 1] = sums[y * w1 + x + 1] + rowTotal;
    }
  }

  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const total = sums[bottom * w1 + right] - sums[top * w1 + right] -
        sums[bottom * w1 + left] + sums[top * w1 + left];
      const average = total / ((bottom - top) * (right - left));
      if (gray[y * width + x] < average - darkerBy) ink[y * width + x] = 1;
    }
  }
  return ink;
}

// Step 2: give every group of touching ink pixels its own number ("label"),
// and note how big each group is and where it sits.
function findShapes(ink, width, height) {
  const labels = new Int32Array(width * height); // 0 = not part of any shape
  const shapes = [];
  const stack = new Int32Array(width * height);

  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || labels[start]) continue;
    const label = shapes.length + 1;
    const shape = { label, pixels: 0, minX: width, maxX: 0, minY: height, maxY: 0 };

    // "Flood fill": start at one pixel and keep visiting ink neighbours
    // (including diagonal ones) until the whole group has been labelled.
    let size = 0;
    stack[size++] = start;
    labels[start] = label;
    while (size > 0) {
      const p = stack[--size];
      const x = p % width;
      const y = (p - x) / width;
      shape.pixels++;
      if (x < shape.minX) shape.minX = x;
      if (x > shape.maxX) shape.maxX = x;
      if (y < shape.minY) shape.minY = y;
      if (y > shape.maxY) shape.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (ink[n] && !labels[n]) {
            labels[n] = label;
            stack[size++] = n;
          }
        }
      }
    }
    shapes.push(shape);
  }
  return { labels, shapes };
}

// Step 4: the outer corners of a shape. The top-left corner is the pixel
// with the smallest x + y, the bottom-right the largest x + y, and so on.
// This works as long as the grid is not turned by more than about 30 degrees.
function findCorners(labels, width, shape) {
  let tl, tr, br, bl;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (let y = shape.minY; y <= shape.maxY; y++) {
    for (let x = shape.minX; x <= shape.maxX; x++) {
      if (labels[y * width + x] !== shape.label) continue;
      const sum = x + y;
      const diff = x - y;
      if (sum < minSum) { minSum = sum; tl = { x, y }; }
      if (sum > maxSum) { maxSum = sum; br = { x, y }; }
      if (diff > maxDiff) { maxDiff = diff; tr = { x, y }; }
      if (diff < minDiff) { minDiff = diff; bl = { x, y }; }
    }
  }
  return [tl, tr, br, bl];
}

// The point at fraction (u, v) across a four-cornered shape,
// e.g. (0.5, 0.5) is its middle.
function pointInQuad(corners, u, v) {
  const [tl, tr, br, bl] = corners;
  const topX = tl.x + (tr.x - tl.x) * u, topY = tl.y + (tr.y - tl.y) * u;
  const botX = bl.x + (br.x - bl.x) * u, botY = bl.y + (br.y - bl.y) * u;
  return { x: topX + (botX - topX) * v, y: topY + (botY - topY) * v };
}

// Step 3 helper: how much does this shape look like a Sudoku grid?
// We walk along the four lines between the 3x3 boxes (at 1/3 and 2/3 of the
// way across and down) and count how often the shape really has ink there.
// A real grid scores close to 1; a plain frame or a blob of text scores low.
function gridScore(labels, width, height, shape, corners) {
  let hits = 0;
  let checks = 0;
  for (const line of [1 / 3, 2 / 3]) {
    for (let step = 1; step < 40; step++) {
      const along = step / 40;
      for (const [u, v] of [[line, along], [along, line]]) {
        const p = pointInQuad(corners, u, v);
        checks++;
        if (hasLabelNear(labels, width, height, p, shape.label, 3)) hits++;
      }
    }
  }
  return hits / checks;
}

function hasLabelNear(labels, width, height, p, label, reach) {
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let y = cy - reach; y <= cy + reach; y++) {
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label) return true;
    }
  }
  return false;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Find the Sudoku grid in an image.
// Returns its four corners [topLeft, topRight, bottomRight, bottomLeft],
// each { x, y } in pixels, or null if no grid was found.
function findGrid(img) {
  const { width, height } = img;
  const ink = findInk(toGray(img), width, height);
  const { labels, shapes } = findShapes(ink, width, height);

  // Only consider shapes that are big and about as wide as they are tall,
  // biggest first.
  const minSide = Math.min(width, height) * 0.2;
  const candidates = shapes
    .filter((s) => {
      const w = s.maxX - s.minX + 1;
      const h = s.maxY - s.minY + 1;
      return w >= minSide && h >= minSide && w / h > 0.6 && w / h < 1.67;
    })
    .sort((a, b) =>
      (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));

  for (const shape of candidates.slice(0, 8)) {
    const corners = findCorners(labels, width, shape);
    // All four sides should be roughly the same length.
    const sides = corners.map((c, k) => distance(c, corners[(k + 1) % 4]));
    if (Math.min(...sides) < Math.max(...sides) * 0.6) continue;
    if (gridScore(labels, width, height, shape, corners) < 0.6) continue;
    return corners;
  }
  return null;
}

// The "perspective transform" that maps the corners of a flat square of
// size x size onto the four corners found in the image. It is 8 numbers;
// we find them by solving 8 equations, two for each corner.
function squareToQuad(size, corners) {
  const from = [[0, 0], [size, 0], [size, size], [0, size]];
  const rows = [];
  from.forEach(([x, y], k) => {
    const { x: u, y: v } = corners[k];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  return solveLinear(rows);
}

// Solve a set of linear equations by Gaussian elimination
// (the method taught in school, done systematically).
// Each row holds the coefficients followed by the right-hand side.
function solveLinear(rows) {
  const n = rows.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      for (let c = col; c <= n; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row, k) => row[n] / row[k]);
}

// Straighten the grid: build a new size x size image where every pixel is
// fetched from the matching spot inside the four corners of the original.
function warpGrid(img, corners, size) {
  const [a, b, c, d, e, f, g, h] = squareToQuad(size, corners);
  const out = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5; // centre of the output pixel
      const w = g * px + h * py + 1;
      const sx = (a * px + b * py + c) / w;
      const sy = (d * px + e * py + f) / w;
      sample(img, sx - 0.5, sy - 0.5, out.data, (y * size + x) * 4);
    }
  }
  return out;
}

// Read the colour at a position between pixels by blending the 4 nearest
// pixels ("bilinear interpolation"). Outside the image counts as white.
function sample(img, x, y, out, at) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  for (let ch = 0; ch < 4; ch++) {
    let value = 0;
    for (const [dx, dy, weight] of [
      [0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)],
      [0, 1, (1 - fx) * fy], [1, 1, fx * fy],
    ]) {
      const sx = x0 + dx, sy = y0 + dy;
      const inside = sx >= 0 && sy >= 0 && sx < img.width && sy < img.height;
      value += weight * (inside ? img.data[(sy * img.width + sx) * 4 + ch] : 255);
    }
    out[at + ch] = value;
  }
}

// Cut a straightened grid into 81 cell images, row by row.
// `margin` trims that fraction off each edge so the grid lines are left out.
function cutCells(grid, margin = 0.12) {
  const cellSize = grid.width / 9;
  const trim = Math.round(cellSize * margin);
  const side = Math.floor(cellSize) - 2 * trim;
  const cells = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const left = Math.round(col * cellSize) + trim;
      const top = Math.round(row * cellSize) + trim;
      const data = new Uint8ClampedArray(side * side * 4);
      for (let y = 0; y < side; y++) {
        const from = ((top + y) * grid.width + left) * 4;
        data.set(grid.data.subarray(from, from + side * 4), y * side * 4);
      }
      cells.push({ width: side, height: side, data });
    }
  }
  return cells;
}

// Make the functions usable both from a web page and from Node (for tests).
if (typeof module !== "undefined") {
  module.exports = { findGrid, warpGrid, cutCells };
}
