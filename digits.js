// Reading the digit in each cell.
//
// For each of the 81 cell images (from cutCells in vision.js):
//   1. prepareCell decides whether the cell is empty. If it isn't, it cuts
//      out the digit and scales it into a standard 28 x 28 square.
//   2. recognizeDigit feeds that square to a small neural network, which
//      answers with the most likely digit and how sure it is (0 to 1).
//
// The network's numbers ("weights") were learned by training/train.py and
// are stored in digit-model.js as DIGIT_MODEL.

const INPUT_SIZE = 28; // the network looks at 28 x 28 squares...
const DIGIT_BOX = 20;  // ...with the digit scaled to fit 20 x 20 in the middle

// Step 1: is there a digit in this cell? If so, return it as 28 x 28
// numbers from 0 (paper) to 1 (ink). Return null for an empty cell.
function prepareCell(cell) {
  const { width, height, data } = cell;
  const size = width * height;

  // Brightness of each pixel, 0 (black) to 255 (white).
  const gray = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // The darkest and brightest values, ignoring the extreme 1% of pixels
  // so a single speck of dirt doesn't count.
  const sorted = Float32Array.from(gray).sort();
  const dark = sorted[Math.floor(size * 0.01)];
  const light = sorted[Math.floor(size * 0.99)];
  if (light - dark < 60) return null; // almost no contrast: an empty cell

  // Ink is anything darker than halfway between paper and ink.
  const threshold = (dark + light) / 2;
  const ink = new Uint8Array(size);
  for (let i = 0; i < size; i++) ink[i] = gray[i] < threshold ? 1 : 0;

  // Erase grid lines that reach into the cell: an unbroken run of ink
  // across at least 80% of the cell is a line, never part of a digit.
  eraseLongRuns(ink, width, height, 1, width);  // rows
  eraseLongRuns(ink, width, height, width, 1);  // columns

  // Group touching ink pixels into shapes, and keep only shapes that reach
  // into the middle of the cell. Bits of grid line at the edges are dropped.
  const keep = keepCentralShapes(ink, width, height);
  let count = 0;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let i = 0; i < size; i++) {
    if (!keep[i]) continue;
    count++;
    const x = i % width, y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Too little ink, or too small, to be a digit: treat as empty.
  if (count < size * 0.02 || maxY - minY < height * 0.25) return null;

  // How much ink each pixel holds, 0 to 1. Pixels of dropped shapes count as paper.
  // We look one pixel around each kept pixel, so the soft (anti-aliased)
  // edges of the digit are included too.
  const amount = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) {
      for (let dx = -1; dx <= 1 && !near; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && keep[ny * width + nx]) near = true;
      }
    }
    if (!near) return 0;
    return Math.min(1, Math.max(0, (light - gray[y * width + x]) / (light - dark)));
  };

  // Scale the digit's box so its longer side is 20 pixels, and centre it
  // in the 28 x 28 square. Each output pixel averages the area it covers.
  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const scale = DIGIT_BOX / Math.max(boxW, boxH);
  const outW = boxW * scale, outH = boxH * scale;
  const offX = (INPUT_SIZE - outW) / 2, offY = (INPUT_SIZE - outH) / 2;
  const out = new Float32Array(INPUT_SIZE * INPUT_SIZE);
  const steps = 4; // sample 4 x 4 points inside every output pixel
  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      let total = 0;
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const srcX = minX + (x + (sx + 0.5) / steps - offX) / scale;
          const srcY = minY + (y + (sy + 0.5) / steps - offY) / scale;
          if (srcX < minX || srcY < minY || srcX >= maxX + 1 || srcY >= maxY + 1) continue;
          total += amount(Math.floor(srcX), Math.floor(srcY));
        }
      }
      out[y * INPUT_SIZE + x] = total / (steps * steps);
    }
  }
  return out;
}

// Erase long straight runs of ink. `step` is the distance between neighbouring
// pixels along a line (1 for a row, width for a column), and `next` the
// distance from one line to the next.
function eraseLongRuns(ink, width, height, step, next) {
  const lines = step === 1 ? height : width;
  const length = step === 1 ? width : height;
  for (let line = 0; line < lines; line++) {
    let runStart = 0;
    for (let k = 0; k <= length; k++) {
      const filled = k < length && ink[line * next + k * step];
      if (filled) continue;
      if (k - runStart >= length * 0.8) {
        for (let j = runStart; j < k; j++) ink[line * next + j * step] = 0;
      }
      runStart = k + 1;
    }
  }
}

// Keep the groups of touching ink pixels that reach into the middle
// of the cell (the central 40% each way).
function keepCentralShapes(ink, width, height) {
  const labels = new Int32Array(ink.length);
  const keep = new Uint8Array(ink.length);
  const stack = new Int32Array(ink.length);
  const x0 = width * 0.3, x1 = width * 0.7, y0 = height * 0.3, y1 = height * 0.7;
  let next = 0;
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || labels[start]) continue;
    const label = ++next;
    const members = [];
    let central = false;
    let size = 0;
    stack[size++] = start;
    labels[start] = label;
    while (size > 0) {
      const p = stack[--size];
      members.push(p);
      const x = p % width, y = (p - x) / width;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) central = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (ink[n] && !labels[n]) {
            labels[n] = label;
            stack[size++] = n;
          }
        }
      }
    }
    if (central) for (const p of members) keep[p] = 1;
  }
  return keep;
}

// Step 2: run the neural network on a prepared 28 x 28 square.
//
// The network has three layers:
//   conv1: 16 small 3x3 "pattern detectors" slide over the image
//          (edges, curves...), then the image is halved to 14 x 14.
//   conv2: 32 detectors combine those patterns into bigger parts
//          (loops, strokes...), then halved again to 7 x 7.
//   dense: every part votes for each of the digits 1-9.
function recognizeDigit(input, model = DIGIT_MODEL) {
  let x = { channels: 1, size: INPUT_SIZE, values: input };
  x = maxPool(relu(conv3x3(x, model.conv1)));
  x = maxPool(relu(conv3x3(x, model.conv2)));
  const scores = dense(x.values, model.dense);

  // "Softmax" turns the votes into chances that add up to 1.
  const top = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - top));
  const total = exps.reduce((a, b) => a + b, 0);
  const chances = exps.map((e) => e / total);
  const best = chances.indexOf(Math.max(...chances));
  return { digit: best + 1, confidence: chances[best] };
}

// A 3x3 convolution with 1 pixel of padding, so the size stays the same.
// layer.weights is [outChannel][inChannel][3][3], flattened; layer.bias has
// one number per output channel.
function conv3x3(x, layer) {
  const { channels, size, values } = x;
  const outChannels = layer.bias.length;
  const out = new Float32Array(outChannels * size * size);
  for (let o = 0; o < outChannels; o++) {
    for (let y = 0; y < size; y++) {
      for (let xx = 0; xx < size; xx++) {
        let sum = layer.bias[o];
        for (let c = 0; c < channels; c++) {
          for (let ky = 0; ky < 3; ky++) {
            const sy = y + ky - 1;
            if (sy < 0 || sy >= size) continue;
            for (let kx = 0; kx < 3; kx++) {
              const sx = xx + kx - 1;
              if (sx < 0 || sx >= size) continue;
              sum += layer.weights[((o * channels + c) * 3 + ky) * 3 + kx] *
                values[(c * size + sy) * size + sx];
            }
          }
        }
        out[(o * size + y) * size + xx] = sum;
      }
    }
  }
  return { channels: outChannels, size, values: out };
}

// Replace negative values with 0.
function relu(x) {
  return { ...x, values: x.values.map((v) => (v > 0 ? v : 0)) };
}

// Halve the image by keeping the largest value of every 2 x 2 block.
function maxPool(x) {
  const half = x.size / 2;
  const out = new Float32Array(x.channels * half * half);
  for (let c = 0; c < x.channels; c++) {
    for (let y = 0; y < half; y++) {
      for (let xx = 0; xx < half; xx++) {
        const at = (dy, dx) => x.values[(c * x.size + 2 * y + dy) * x.size + 2 * xx + dx];
        out[(c * half + y) * half + xx] = Math.max(at(0, 0), at(0, 1), at(1, 0), at(1, 1));
      }
    }
  }
  return { channels: x.channels, size: half, values: out };
}

// Every output is a weighted sum of all inputs. layer.weights is
// [output][input], flattened.
function dense(values, layer) {
  const outputs = layer.bias.length;
  const result = [];
  for (let o = 0; o < outputs; o++) {
    let sum = layer.bias[o];
    for (let i = 0; i < values.length; i++) sum += layer.weights[o * values.length + i] * values[i];
    result.push(sum);
  }
  return result;
}

// Read all 81 cells. Returns one { digit, confidence } per cell,
// with digit 0 for an empty cell.
function readDigits(cells, model = DIGIT_MODEL) {
  return cells.map((cell) => {
    const input = prepareCell(cell);
    if (!input) return { digit: 0, confidence: 1 };
    return recognizeDigit(input, model);
  });
}

// Make the functions usable both from a web page and from Node (for tests
// and for training).
if (typeof module !== "undefined") {
  module.exports = { prepareCell, recognizeDigit, readDigits, INPUT_SIZE };
}
