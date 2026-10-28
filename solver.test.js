// Tests for the solver. Run with: node --test
const test = require("node:test");
const assert = require("node:assert");
const { parseGrid, formatGrid, findConflicts, solveSudoku } = require("./solver.js");

// The puzzle from our example screenshot.
const PUZZLE = `
  . . . | 4 . 8 | . . .
  . 6 . | . 7 . | . 1 .
  7 . 2 | . 9 . | 5 . 4
  ------+-------+------
  . 9 . | 7 . 4 | . 3 .
  . . 7 | . 5 . | 8 . .
  . 8 . | 9 . 6 | . 5 .
  ------+-------+------
  9 . 4 | . 1 . | 7 . 8
  . 7 . | . 6 . | . 4 .
  . . . | 2 . 7 | . . .
`;

// True if every row, column and box contains 1-9 exactly once.
function isValidSolution(grid) {
  return grid.every((d) => d >= 1 && d <= 9) && findConflicts(grid).length === 0;
}

// A well-known puzzle (from Wikipedia's Sudoku article) with exactly one answer.
const UNIQUE_PUZZLE =
  "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";

test("solves a puzzle that has exactly one answer", () => {
  const puzzle = parseGrid(UNIQUE_PUZZLE);
  const result = solveSudoku(puzzle);
  assert.strictEqual(result.status, "solved");
  assert.ok(isValidSolution(result.solution));
  // The solution must keep every digit that was given.
  puzzle.forEach((d, i) => {
    if (d !== 0) assert.strictEqual(result.solution[i], d);
  });
});

// The screenshot's puzzle, exactly as printed, has 4 valid solutions,
// so the app must warn instead of pretending there is one right answer.
test("warns that the example puzzle has more than one answer", () => {
  const puzzle = parseGrid(PUZZLE);
  const result = solveSudoku(puzzle);
  assert.strictEqual(result.status, "multiple");
  assert.ok(isValidSolution(result.solution));
  console.log(formatGrid(result.solution));
});

test("flags two equal digits in a row as a conflict", () => {
  const grid = parseGrid(PUZZLE);
  grid[0] = 4; // top-left cell; row 1 already has a 4
  const result = solveSudoku(grid);
  assert.strictEqual(result.status, "conflict");
  assert.deepStrictEqual(result.conflicts, [0, 3]);
});

test("reports a puzzle with no solution", () => {
  // No clashes yet, but the top-left cell has no possible digit:
  // 1-8 are in its row and 9 is in its column.
  const grid = new Array(81).fill(0);
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((d, k) => (grid[k + 1] = d));
  grid[9 * 8] = 9;
  assert.strictEqual(solveSudoku(grid).status, "unsolvable");
});

test("reports a puzzle with more than one solution", () => {
  const empty = new Array(81).fill(0);
  assert.strictEqual(solveSudoku(empty).status, "multiple");
});
