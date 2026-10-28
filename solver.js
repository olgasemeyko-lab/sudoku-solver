// Sudoku solver.
//
// A grid is an array of 81 numbers, read left to right, top to bottom.
// 0 means "empty cell", 1-9 are digits.
// Example: grid[0] is the top-left cell, grid[80] the bottom-right one.

// Turn text like "...4.8..." into a grid. Dots or zeros mean empty;
// spaces, "|", "-" and "+" are ignored, so a pretty-printed board works too.
function parseGrid(text) {
  const chars = text.replace(/[\s|+-]/g, "");
  if (chars.length !== 81) {
    throw new Error("Expected 81 cells, got " + chars.length);
  }
  return [...chars].map((c) => (c === "." ? 0 : Number(c)));
}

// Turn a grid back into readable text with box borders.
function formatGrid(grid) {
  const lines = [];
  for (let row = 0; row < 9; row++) {
    if (row === 3 || row === 6) lines.push("------+-------+------");
    const cells = grid.slice(row * 9, row * 9 + 9).map((d) => (d === 0 ? "." : d));
    lines.push(
      cells.slice(0, 3).join(" ") + " | " +
      cells.slice(3, 6).join(" ") + " | " +
      cells.slice(6, 9).join(" ")
    );
  }
  return lines.join("\n");
}

// The 20 "peers" of a cell: every other cell in the same row, column or box.
// A digit may not appear twice among a cell and its peers.
// We work these out once, up front, because the solver asks for them constantly.
const PEERS = [];
for (let i = 0; i < 81; i++) {
  const row = Math.floor(i / 9);
  const col = i % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  const peers = new Set();
  for (let k = 0; k < 9; k++) {
    peers.add(row * 9 + k); // same row
    peers.add(k * 9 + col); // same column
    peers.add((boxRow + Math.floor(k / 3)) * 9 + boxCol + (k % 3)); // same box
  }
  peers.delete(i);
  PEERS.push([...peers]);
}

// Find cells that break the rules, e.g. two 7s in one row.
// Returns the positions (0-80) of every cell involved in a clash,
// so the page can paint them red.
function findConflicts(grid) {
  const bad = new Set();
  for (let i = 0; i < 81; i++) {
    if (grid[i] === 0) continue;
    for (const p of PEERS[i]) {
      if (grid[p] === grid[i]) bad.add(i);
    }
  }
  return [...bad].sort((a, b) => a - b);
}

// Which digits could go in cell i without clashing with its peers?
function candidates(grid, i) {
  const used = new Set(PEERS[i].map((p) => grid[p]));
  const result = [];
  for (let d = 1; d <= 9; d++) {
    if (!used.has(d)) result.push(d);
  }
  return result;
}

// Solve the puzzle by "backtracking": fill a cell with a digit that fits,
// move on, and if we get stuck, go back and try the next digit.
//
// We stop after finding `limit` solutions. Asking for 2 is how we check
// that a puzzle has exactly one answer: a proper Sudoku must not have two.
function findSolutions(grid, limit = 2) {
  const work = grid.slice(); // copy, so we never change the caller's grid
  const solutions = [];

  function search() {
    // Pick the empty cell with the fewest options. This is what a person
    // does too, and it makes the search dramatically faster.
    let best = -1;
    let bestOptions = null;
    for (let i = 0; i < 81; i++) {
      if (work[i] !== 0) continue;
      const options = candidates(work, i);
      if (options.length === 0) return; // dead end: this cell can't be filled
      if (bestOptions === null || options.length < bestOptions.length) {
        best = i;
        bestOptions = options;
        if (options.length === 1) break; // can't do better than one option
      }
    }

    if (best === -1) {
      // No empty cells left: we found a full solution.
      solutions.push(work.slice());
      return;
    }

    for (const d of bestOptions) {
      work[best] = d;
      search();
      if (solutions.length >= limit) return;
    }
    work[best] = 0; // undo, so the cell is empty again for other attempts
  }

  search();
  return solutions;
}

// The one function the page will call. It always answers with an object
// saying what happened, so the page can show a friendly message.
function solveSudoku(grid) {
  const conflicts = findConflicts(grid);
  if (conflicts.length > 0) {
    return { status: "conflict", conflicts };
  }
  const solutions = findSolutions(grid, 2);
  if (solutions.length === 0) return { status: "unsolvable" };
  if (solutions.length > 1) {
    // Return two different solutions, so the page can point out
    // the cells where they disagree.
    return { status: "multiple", solution: solutions[0], alternative: solutions[1] };
  }
  return { status: "solved", solution: solutions[0] };
}

// Make the functions usable both from a web page and from Node (for tests).
if (typeof module !== "undefined") {
  module.exports = { parseGrid, formatGrid, findConflicts, solveSudoku };
}
