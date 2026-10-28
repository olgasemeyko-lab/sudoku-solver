// Makes the practice digits the model learns from.
//
// Usage: node training/generate.js [samples per font]
//
// For every font, it draws digits 1-9 the way they could appear in a
// Sudoku screenshot: different sizes, weights, small shifts and tilts,
// stray bits of grid line, blur and noise. Each drawing then goes through
// prepareCell from digits.js, exactly like a real cell in the app, so the
// model trains on precisely the kind of input it will get later.
//
// Output (in training/data/, not saved in git):
//   images.bin  - 784 bytes per sample: the 28 x 28 square, 0-255
//   labels.bin  - 1 byte per sample: the digit, 1-9
//   fonts.bin   - 1 byte per sample: which font (index into fonts.json)
//   fonts.json  - the font names

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const FONT_DIR = path.join(__dirname, "fonts");
const DATA_DIR = path.join(__dirname, "data");
const PER_FONT = Number(process.argv[2] || 1500);

// Fonts from Google Fonts, downloaded once into training/fonts/.
// Only fonts with ordinary "lining" digits: puzzles don't use the
// old-fashioned style where some digits hang below the line.
const GOOGLE_FONTS = [
  "Roboto", "Open Sans", "Lato", "Montserrat", "Source Sans 3", "Nunito",
  "Poppins", "Merriweather", "Playfair Display", "Oswald", "Raleway",
  "PT Serif", "Roboto Mono", "Ubuntu", "Noto Sans", "Fira Sans", "Work Sans",
  "Quicksand", "Josefin Sans", "Archivo", "Libre Baskerville", "Lora",
  "IBM Plex Sans", "IBM Plex Mono", "Space Mono", "Karla", "Rubik", "Barlow",
  "Manrope", "Bitter", "Arvo", "Cabin", "Exo 2", "Titillium Web", "Jost",
  "Questrial", "Didact Gothic", "Courier Prime", "Inconsolata", "Noto Serif",
  "Source Serif 4", "Zilla Slab", "Comfortaa", "Varela Round", "Mulish",
];
// Fonts already installed on this machine.
const LOCAL_FONTS = [
  "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Sans",
  "Liberation Serif", "Liberation Mono", "FreeSans", "FreeSerif", "Inter",
  "JetBrains Mono", "Carlito", "Caladea",
];

// Download the regular and bold files of a Google font (once).
function downloadFont(family) {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const files = [];
  for (const weight of [400, 700]) {
    const file = path.join(FONT_DIR, family.replace(/ /g, "_") + "-" + weight + ".ttf");
    if (!fs.existsSync(file)) {
      const cssUrl = "https://fonts.googleapis.com/css2?family=" +
        encodeURIComponent(family) + ":wght@" + weight;
      let css;
      try {
        css = execFileSync("curl", ["-sSf", cssUrl], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        continue; // this font has no such weight
      }
      const url = css.match(/url\((https:[^)]+\.ttf)\)/);
      if (!url) continue;
      execFileSync("curl", ["-sSf", "-o", file, url[1]]);
    }
    files.push({ weight, file });
  }
  return files;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({ path: path.join(ROOT, "digits.js") });

  // Load every font into the page.
  const fonts = [];
  for (const family of GOOGLE_FONTS) {
    const files = downloadFont(family);
    for (const { weight, file } of files) {
      const base64 = fs.readFileSync(file).toString("base64");
      await page.evaluate(async ({ family, weight, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const face = new FontFace(family, bytes, { weight: String(weight) });
        document.fonts.add(await face.load());
      }, { family, weight, base64 });
    }
    if (files.length) fonts.push({ family, weights: files.map((f) => f.weight) });
    else console.warn("Skipped " + family + ": couldn't download it");
  }
  for (const family of LOCAL_FONTS) fonts.push({ family, weights: [400, 700] });
  console.log("Fonts: " + fonts.length);

  const images = [];
  const labels = [];
  const fontIds = [];
  let missed = 0;
  let emptyMistakes = 0;

  for (let f = 0; f < fonts.length; f++) {
    const result = await page.evaluate(drawSamples, { font: fonts[f], count: PER_FONT });
    images.push(Buffer.from(result.images, "base64"));
    labels.push(Buffer.from(result.labels));
    fontIds.push(Buffer.alloc(result.labels.length, f));
    missed += result.missed;
    emptyMistakes += result.emptyMistakes;
    process.stdout.write(".");
  }
  await browser.close();

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "images.bin"), Buffer.concat(images));
  fs.writeFileSync(path.join(DATA_DIR, "labels.bin"), Buffer.concat(labels));
  fs.writeFileSync(path.join(DATA_DIR, "fonts.bin"), Buffer.concat(fontIds));
  fs.writeFileSync(path.join(DATA_DIR, "fonts.json"), JSON.stringify(fonts.map((f) => f.family), null, 1));

  const total = fonts.length * PER_FONT;
  console.log("\nSaved " + (total - missed) + " digits.");
  console.log("Digits wrongly seen as empty cells: " + missed + " of " + total);
  console.log("Empty cells wrongly seen as digits: " + emptyMistakes + " of " + total);
}

// Runs inside the browser page. Draws `count` digits in one font
// (plus as many empty cells, to check empty-cell detection).
function drawSamples({ font, count }) {
  const CELL = 50; // the app's straightened grid has 50 x 50 pixel cells
  const TRIM = 6;  // cutCells trims 12% (6 pixels) off each edge
  const random = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  const big = document.createElement("canvas");
  const cell = document.createElement("canvas");
  cell.width = cell.height = CELL;
  const cellCtx = cell.getContext("2d", { willReadFrequently: true });

  function drawCell(digit) {
    // Draw at a random resolution, then shrink or stretch to 50 x 50, like
    // straightening a small or large screenshot does.
    const size = Math.round(random(24, 110));
    big.width = big.height = size;
    const ctx = big.getContext("2d");

    // Paper: usually white, sometimes tinted or grey (some apps shade the given cells).
    const paper = Math.random() < 0.15 ? random(200, 235) : random(238, 255);
    const tint = random(-8, 8);
    ctx.fillStyle = `rgb(${paper + tint},${paper},${paper - tint})`;
    ctx.fillRect(0, 0, size, size);

    // Stray grid lines near the edges, as if the grid was found a little off.
    ctx.fillStyle = `rgb(${random(0, 120)},${random(0, 120)},${random(0, 120)})`;
    for (const side of ["top", "bottom", "left", "right"]) {
      if (Math.random() > 0.35) continue;
      const thick = random(1, size * 0.07);
      const at = random(-0.08, 0.16) * size; // distance from that edge
      if (side === "top") ctx.fillRect(0, at, size, thick);
      if (side === "bottom") ctx.fillRect(0, size - at - thick, size, thick);
      if (side === "left") ctx.fillRect(at, 0, thick, size);
      if (side === "right") ctx.fillRect(size - at - thick, 0, thick, size);
    }

    if (digit) {
      const ink = random(0, 90);
      const blue = Math.random() < 0.2 ? random(60, 160) : 0; // some apps use coloured digits
      ctx.fillStyle = `rgb(${ink},${ink + blue * 0.3},${ink + blue})`;
      ctx.font = `${pick(font.weights)} ${random(0.42, 0.78) * size}px "${font.family}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.translate(size / 2 + random(-0.07, 0.07) * size, size / 2 + random(-0.06, 0.08) * size);
      ctx.rotate(random(-3, 3) * Math.PI / 180);
      if (Math.random() < 0.25) ctx.filter = `blur(${random(0.3, 1.2) * size / 50}px)`;
      ctx.fillText(String(digit), 0, 0);
      ctx.restore();
    }

    cellCtx.drawImage(big, 0, 0, CELL, CELL);
    const pixels = cellCtx.getImageData(TRIM, TRIM, CELL - 2 * TRIM, CELL - 2 * TRIM);
    if (Math.random() < 0.3) { // camera / compression noise
      const amount = random(2, 10);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const n = random(-amount, amount);
        pixels.data[i] += n; pixels.data[i + 1] += n; pixels.data[i + 2] += n;
      }
    }
    return prepareCell(pixels);
  }

  const bytes = [];
  const labels = [];
  let missed = 0;
  let emptyMistakes = 0;
  for (let k = 0; k < count; k++) {
    const digit = 1 + (k % 9);
    const input = drawCell(digit);
    if (!input) { missed++; continue; }
    for (const v of input) bytes.push(Math.round(v * 255));
    labels.push(digit);
    if (drawCell(0)) emptyMistakes++;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return { images: btoa(binary), labels, missed, emptyMistakes };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
