// Reading a puzzle from a picture, behind the scenes.
// It loads an image, asks vision.js to find and straighten the grid,
// asks digits.js to read each cell, and puts the digits into the grid
// (loadRecognized in app.js). Messages go to the status box beside the grid.
//
// A picture can come from:
//   - the "Take a photo" button (phones and tablets): opens the camera app
//   - the "Upload a screenshot" button: opens the file or photo picker
//   - dragging an image onto the page, or pasting one

// Big photos are shrunk before searching, which keeps it fast.
// The search doesn't need fine detail, only the grid's lines.
const SEARCH_SIZE = 1000;
// The straightened grid is 450 x 450 pixels, so each cell is 50 x 50.
const GRID_SIZE = 450;

const photoInput = document.getElementById("photo-input");
const imageInput = document.getElementById("image-input");
const takePhotoButton = document.getElementById("take-photo");
const uploadButton = document.getElementById("upload");

// The camera button only makes sense on phones and tablets. There, it is the
// main button; on a computer, uploading is.
if (window.matchMedia("(pointer: coarse)").matches) {
  takePhotoButton.hidden = false;
  uploadButton.classList.remove("btn-primary");
  document.getElementById("drop-hint").hidden = true;
}

// "capture" on the photo input asks the phone to open its camera app
// instead of the photo library. The page never gets access to the camera
// itself; it only receives the finished photo.
takePhotoButton.addEventListener("click", () => photoInput.click());
uploadButton.addEventListener("click", () => imageInput.click());

for (const input of [photoInput, imageInput]) {
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (file) readFile(file);
    input.value = ""; // so choosing the same file again still works
  });
}

// Dragging an image anywhere onto the page.
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  board.classList.add("dragging");
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) board.classList.remove("dragging"); // left the window
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  board.classList.remove("dragging");
  const file = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) readFile(file);
  else setStatus("bad", "That isn't an image.", "Drop a PNG, JPEG or other image file.");
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

// ---- Reading ----

function readFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  setBusy(true);
  setStatus("", "Reading the puzzle...", "");
  image.onload = () => {
    // Wait one moment so the message above appears before the work starts.
    setTimeout(() => {
      try {
        readImage(image);
      } catch (error) {
        setStatus("bad", "Something went wrong reading the picture.", error.message);
      }
      URL.revokeObjectURL(url);
      setBusy(false);
    }, 30);
  };
  image.onerror = () => {
    setStatus("bad", "This file couldn't be opened as a picture.", "Try a PNG or JPEG file.");
    URL.revokeObjectURL(url);
    setBusy(false);
  };
  image.src = url;
}

function readImage(image) {
  // 1. Find the grid in a smaller copy of the image.
  const scale = Math.min(1, SEARCH_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const corners = findGrid(imagePixels(image, scale));
  if (!corners) {
    setStatus("bad", "No Sudoku grid found in that picture.",
      "Make sure the whole grid, including its thick outer border, is in the picture and in focus.");
    return;
  }

  // 2. Straighten it, using the full-size image for the sharpest result
  // (capped at 2000 pixels so huge photos don't slow things down).
  const fullScale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const full = imagePixels(image, fullScale);
  const fullCorners = corners.map((p) => ({ x: (p.x / scale) * fullScale, y: (p.y / scale) * fullScale }));
  const grid = warpGrid(full, fullCorners, GRID_SIZE);

  // 3. Cut it into cells, read each one, and fill in the grid.
  loadRecognized(readDigits(cutCells(grid)));
  board.scrollIntoView({ behavior: "smooth", block: "center" });
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

function setBusy(busy) {
  takePhotoButton.disabled = busy;
  uploadButton.disabled = busy;
}
