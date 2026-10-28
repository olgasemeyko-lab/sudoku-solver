// The "Read a puzzle from an image" section of the page.
// It loads an image, asks vision.js to find and straighten the grid,
// asks digits.js to read each cell, puts the digits into the grid,
// and draws every step so you can see what the app saw.

// Big photos are shrunk before searching, which keeps it fast.
// The search doesn't need fine detail, only the grid's lines.
const SEARCH_SIZE = 1000;
// The straightened grid is 450 x 450 pixels, so each cell is 50 x 50.
const GRID_SIZE = 450;

const reader = document.getElementById("reader");
const readerStatus = document.getElementById("reader-status");
const readerSteps = document.getElementById("reader-steps");
const foundCanvas = document.getElementById("found-canvas");
const warpedCanvas = document.getElementById("warped-canvas");
const cellTiles = document.getElementById("cell-tiles");

// ---- Ways to give the app an image ----

document.getElementById("image-input").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) readFile(file);
  event.target.value = ""; // so choosing the same file again still works
});

// The upload button at the top of the page opens the same file picker.
document.getElementById("upload-top").addEventListener("click", () => {
  document.getElementById("image-input").click();
});

document.getElementById("example-image").addEventListener("click", () => {
  readUrl("examples/screenshot.png", { quiet: false });
});

// After reading an image the user chose, bring the grid into view.
// (Not for the example shown when the page opens.)
function showGrid() {
  board.scrollIntoView({ behavior: "smooth", block: "center" });
}

reader.addEventListener("dragover", (event) => {
  event.preventDefault();
  reader.classList.add("dragging");
});
reader.addEventListener("dragleave", () => reader.classList.remove("dragging"));
reader.addEventListener("drop", (event) => {
  event.preventDefault();
  reader.classList.remove("dragging");
  const file = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) readFile(file);
  else showReaderStatus("bad", "That isn't an image.", "Drop a PNG, JPEG or other image file.");
});

// Pasting an image anywhere on the page (pasting text into the grid is
// handled in app.js).
document.addEventListener("paste", (event) => {
  const items = [...(event.clipboardData ? event.clipboardData.items : [])];
  const item = items.find((i) => i.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  readFile(item.getAsFile());
});

function readFile(file) {
  const url = URL.createObjectURL(file);
  readUrl(url, { quiet: false, onDone: () => URL.revokeObjectURL(url) });
}

// Load an image from a web address, then look for the grid in it.
// `quiet` hides errors; we use it when trying the example on page load.
function readUrl(url, { quiet, onDone }) {
  const image = new Image();
  image.onload = () => {
    showReaderStatus("", "Reading the puzzle...", "");
    // Wait one moment so the message above appears before the work starts.
    setTimeout(() => {
      try {
        if (processImage(image) && !quiet) showGrid();
      } catch (error) {
        if (quiet) {
          readerStatus.hidden = true;
        } else if (error.name === "SecurityError") {
          // Browsers block reading pixels from local files opened with file://.
          showReaderStatus("bad", "The example can't be read from here.",
            "Browsers don't allow this when the page is opened straight from a file. " +
            "Click Upload image and choose examples/screenshot.png instead.");
        } else {
          showReaderStatus("bad", "Something went wrong reading the image.", error.message);
        }
      }
      if (onDone) onDone();
    }, 30);
  };
  image.onerror = () => {
    if (!quiet) showReaderStatus("bad", "This file couldn't be opened as an image.", "Try a PNG or JPEG file.");
    if (onDone) onDone();
  };
  image.src = url;
}

// ---- The actual work ----

function processImage(image) {
  // 1. Find the grid in a smaller copy of the image.
  const scale = Math.min(1, SEARCH_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const small = imagePixels(image, scale);
  const smallCorners = findGrid(small);

  if (!smallCorners) {
    readerSteps.hidden = true;
    showReaderStatus("bad", "No Sudoku grid found.",
      "Use an image where the whole grid is visible, including its thick outer border.");
    return false;
  }

  // 2. Straighten it, using the full-size image for the sharpest result
  // (capped at 2000 pixels so huge photos don't slow things down).
  const fullScale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const full = imagePixels(image, fullScale);
  const corners = smallCorners.map((p) => ({
    x: (p.x / scale) * fullScale,
    y: (p.y / scale) * fullScale,
  }));
  const warped = warpGrid(full, corners, GRID_SIZE);

  // 3. Cut it into cells and read each one.
  const cells = cutCells(warped);
  const readings = readDigits(cells);
  loadRecognized(readings);

  drawFound(image, smallCorners.map((p) => ({ x: p.x / scale, y: p.y / scale })));
  drawPixels(warpedCanvas, warped);
  cellTiles.innerHTML = "";
  cells.forEach((cell, i) => {
    const { digit, confidence } = readings[i];
    const tile = document.createElement("div");
    tile.className = "tile";
    const canvas = document.createElement("canvas");
    drawPixels(canvas, cell);
    tile.appendChild(canvas);
    const where = "Row " + (Math.floor(i / 9) + 1) + ", column " + (i % 9 + 1);
    if (digit === 0) {
      tile.classList.add("empty");
      tile.title = where + ": empty";
    } else {
      const label = document.createElement("span");
      label.className = "tile-digit";
      label.textContent = digit;
      tile.appendChild(label);
      tile.title = where + ": read as " + digit + " (" + Math.round(confidence * 100) + "% sure)";
      if (confidence < 0.9) tile.classList.add("unsure");
    }
    tile.setAttribute("aria-label", tile.title);
    cellTiles.appendChild(tile);
  });

  readerSteps.hidden = false;
  const count = readings.filter((r) => r.digit !== 0).length;
  showReaderStatus("good", "Read " + count + " digits and put them in the grid above.",
    "Each small square in picture 3 shows the digit that was read in its corner. Hover over one to see how sure the reader was.");
  return true;
}

// Draw the image at a given scale and read back its pixels.
function imagePixels(image, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent screenshots get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Picture 1: the original image with the found grid outlined.
function drawFound(image, corners) {
  const scale = Math.min(1, 900 / image.naturalWidth);
  foundCanvas.width = Math.round(image.naturalWidth * scale);
  foundCanvas.height = Math.round(image.naturalHeight * scale);
  const ctx = foundCanvas.getContext("2d");
  ctx.drawImage(image, 0, 0, foundCanvas.width, foundCanvas.height);

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--pencil").trim() || "#2b5bd1";
  const points = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const lineWidth = Math.max(3, foundCanvas.width / 150);
  ctx.strokeStyle = accent;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = accent;
  points.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, lineWidth * 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPixels(canvas, pixels) {
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext("2d").putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
}

function showReaderStatus(tone, title, detail) {
  readerStatus.hidden = false;
  readerStatus.dataset.tone = tone;
  readerStatus.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title;
  readerStatus.append(strong, detail);
}

// Show the example straight away, so the page demonstrates itself.
// If it can't be loaded (e.g. the page was opened from a file), stay quiet.
readUrl("examples/screenshot.png", { quiet: true });
