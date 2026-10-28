# Sudoku Solver

Recognize a Sudoku from a screenshot and solve it, all in the browser.

## Status

- [x] Step 1: solver, with checks for conflicting digits, no solution, and more than one solution
- [x] Step 2: web page with an editable grid
- [x] Step 3: find the grid in an uploaded image, straighten it and cut it into 81 cells
- [ ] Step 4: read the digits (small neural network)
- [ ] Step 5: polish and publish on GitHub Pages

## Run the tests

Requires [Node.js](https://nodejs.org) 18 or newer.

```
node --test
```

## Try the page

Open `index.html` in a web browser. No installation needed.

Browsers don't let a page opened straight from a file read its own example
image, so the "Use your example screenshot" button only works when the page is
served from a website (such as GitHub Pages, in step 5). Uploading an image
works everywhere: choose `examples/screenshot.png`.
