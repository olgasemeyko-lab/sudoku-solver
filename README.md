# Sudoku Solver

Recognize a Sudoku from a screenshot and solve it, all in the browser.

**Try it:** https://olgasemeyko-lab.github.io/sudoku-solver/

## Status

- [x] Step 1: solver, with checks for conflicting digits, no solution, and more than one solution
- [x] Step 2: web page with an editable grid
- [x] Step 3: find the grid in an uploaded image, straighten it and cut it into 81 cells
- [x] Step 4: read the digits with a small neural network (99.5% correct on fonts it never saw in training)
- [x] Step 5: "Take a photo" button, number pad and upload button for phones; published on GitHub Pages

## Retrain the digit reader

Only needed if you change `digits.js` or the network. Requires Node.js with
Playwright, and Python 3 with NumPy.

```
node training/generate.js
python3 training/train.py
```

The first command draws about 85,000 practice digits in 57 fonts; the second
trains the network and saves it as `digit-model.js`.

## Run the tests

Requires [Node.js](https://nodejs.org) 18 or newer.

```
node --test
```

## Try the page

Open `index.html` in a web browser. No installation needed.

