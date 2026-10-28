// Connects the web page to the solver in solver.js.
//
// The page keeps two pieces of information:
//   puzzle   - the 81 digits the user typed (0 = empty)
//   result   - what the solver said last time Solve was pressed, or null
//   unsure   - cells read from an image that should be checked by eye
// Every change updates one of these and then calls render(), which redraws
// the grid and the status message from scratch. Keeping one "source of truth"
// like this avoids the page and the data getting out of step.

const EXAMPLES = {
  // The puzzle from the screenshot we started with. It has 4 solutions.
  screenshot:
    "...4.8..." + ".6..7..1." + "7.2.9.5.4" +
    ".9.7.4.3." + "..7.5.8.." + ".8.9.6.5." +
    "9.4.1.7.8" + ".7..6..4." + "...2.7...",
  // A well-known puzzle with exactly one solution.
  classic:
    "53..7...." + "6..195..." + ".98....6." +
    "8...6...3" + "4..8.3..1" + "7...2...6" +
    ".6....28." + "...419..5" + "....8..79",
};

let puzzle = parseGrid(EXAMPLES.screenshot);
let result = null;
// Cells read from an image that the digit reader wasn't sure about.
let unsure = new Set();

const board = document.getElementById("board");
const statusBox = document.getElementById("status");
const solveButton = document.getElementById("solve");
const hideButton = document.getElementById("hide");
const cells = [];

// ---- Build the 81 cells ----

for (let i = 0; i < 81; i++) {
  const row = Math.floor(i / 9);
  const col = i % 9;
  const cell = document.createElement("input");
  cell.id = "cell-" + i;
  cell.className = "cell";
  if (col === 2 || col === 5) cell.classList.add("box-right");
  if (row === 2 || row === 5) cell.classList.add("box-bottom");
  if (col === 8) cell.classList.add("last-col");
  if (row === 8) cell.classList.add("last-row");
  cell.type = "text";
  cell.inputMode = "numeric"; // shows a number keyboard on phones
  cell.autocomplete = "off";
  cell.setAttribute("aria-label", "Row " + (row + 1) + ", column " + (col + 1));

  cell.addEventListener("focus", () => cell.select());
  cell.addEventListener("input", () => onType(i));
  cell.addEventListener("keydown", (event) => onKey(event, i));

  board.appendChild(cell);
  cells.push(cell);
}

// ---- Reacting to the user ----

// The user typed into a cell. Keep only the last digit 1-9 they typed,
// so typing over an existing digit replaces it.
function onType(i) {
  const digits = cells[i].value.replace(/[^1-9]/g, "");
  puzzle[i] = digits ? Number(digits.slice(-1)) : 0;
  unsure.delete(i); // the user has now checked this cell
  result = null; // the puzzle changed, so any old solution is out of date
  render();
  cells[i].select();
}

// Arrow keys move around the grid.
function onKey(event, i) {
  const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
  if (!(event.key in moves)) return;
  const row = Math.floor(i / 9);
  const col = i % 9;
  const next = i + moves[event.key];
  // Don't wrap from the end of one row to the start of the next.
  if (event.key === "ArrowLeft" && col === 0) return;
  if (event.key === "ArrowRight" && col === 8) return;
  if (next < 0 || next > 80 || (row === 0 && event.key === "ArrowUp")) return;
  event.preventDefault();
  cells[next].focus();
}

// Pasting 81 characters anywhere in the grid loads a whole puzzle.
board.addEventListener("paste", (event) => {
  const text = (event.clipboardData || window.clipboardData).getData("text");
  const chars = text.replace(/[^0-9.]/g, "");
  if (chars.length !== 81) return; // let a single digit paste normally
  event.preventDefault();
  loadPuzzle(chars);
});

solveButton.addEventListener("click", () => {
  result = solveSudoku(puzzle);
  render();
});

hideButton.addEventListener("click", () => {
  result = null;
  render();
});

document.getElementById("clear").addEventListener("click", () => {
  loadPuzzle("0".repeat(81));
  cells[0].focus();
});

document.getElementById("example-screenshot").addEventListener("click", () => loadPuzzle(EXAMPLES.screenshot));
document.getElementById("example-classic").addEventListener("click", () => loadPuzzle(EXAMPLES.classic));

function loadPuzzle(text) {
  puzzle = parseGrid(text);
  result = null;
  unsure = new Set();
  render();
}

// Called by reader.js with the 81 readings from an image.
// Digits read with less than 90% confidence are marked for checking.
function loadRecognized(readings) {
  puzzle = readings.map((r) => r.digit);
  unsure = new Set();
  readings.forEach((r, i) => {
    if (r.digit !== 0 && r.confidence < 0.9) unsure.add(i);
  });
  result = null;
  render();
}

// ---- Drawing the page ----

function render() {
  const clashes = new Set(findConflicts(puzzle));
  const shown = result && result.solution ? result.solution : null;

  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const given = puzzle[i] !== 0;
    const value = given ? puzzle[i] : shown ? shown[i] : 0;
    cell.value = value ? String(value) : "";

    // A cell is "maybe" when two valid solutions disagree about it.
    const maybe = !given && result && result.status === "multiple" &&
      result.solution[i] !== result.alternative[i];

    cell.classList.toggle("solved", !given && value !== 0);
    cell.classList.toggle("clash", clashes.has(i));
    cell.classList.toggle("maybe", Boolean(maybe));
    cell.classList.toggle("unsure", unsure.has(i));
  }

  hideButton.disabled = !shown;
  showStatus(clashes.size);
}

function showStatus(clashCount) {
  const count = puzzle.filter((d) => d !== 0).length;

  if (result === null) {
    if (clashCount > 0) {
      setStatus("bad", "Some digits clash.",
        "The cells in red share a digit with another cell in the same row, column or box. Fix them before solving.");
    } else if (unsure.size > 0) {
      setStatus("warn", count + " digits read from your image.",
        unsure.size === 1
          ? "One was hard to read and has a dashed outline. Check it against your picture, then press Solve."
          : unsure.size + " were hard to read and have a dashed outline. Check them against your picture, then press Solve.");
    } else if (count === 0) {
      setStatus("", "The grid is empty.", "Click a cell and type a digit, or load an example.");
    } else if (count < 17) {
      setStatus("", count + " of 81 cells filled.",
        "With fewer than 17 digits a puzzle always has more than one solution, but you can still press Solve.");
    } else {
      setStatus("", count + " of 81 cells filled.", "Press Solve when the grid matches your puzzle.");
    }
    return;
  }

  if (result.status === "conflict") {
    setStatus("bad", "Some digits clash.",
      "The cells in red share a digit with another cell in the same row, column or box. Fix them before solving.");
  } else if (result.status === "unsolvable") {
    setStatus("bad", "This puzzle has no solution.",
      "No clashes are visible, but the digits can't all be right. Compare the grid with your source; one digit is probably wrong.");
  } else if (result.status === "multiple") {
    const maybeCount = result.solution.filter((d, i) => d !== result.alternative[i]).length;
    setStatus("warn", "More than one solution.",
      "Showing one of them. The " + maybeCount + " cells in amber could hold a different digit. " +
      "The puzzle is probably missing a clue, or a digit was entered wrong.");
  } else {
    setStatus("good", "Solved.", "This is the only solution.");
  }
}

function setStatus(tone, title, detail) {
  statusBox.dataset.tone = tone;
  statusBox.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title;
  statusBox.append(strong, detail);
}

render();
