"""Teaches the digit-reading network, then saves it as digit-model.js.

Usage:
    node training/generate.js      # first, make the practice digits
    python3 training/train.py      # then train (needs only NumPy)

It runs twice:
  1. A fair test: train without a few fonts, then measure how well the
     network reads those fonts it has never seen.
  2. The real thing: train on every font and save the result for the app.

The network is the one described in digits.js:
    conv 3x3 (16) -> relu -> pool -> conv 3x3 (32) -> relu -> pool -> dense (9)

Training means: show the network a batch of digits, measure how wrong its
answers are (the "loss"), work out how each weight should change to be a
little less wrong (the "gradient", via backpropagation), nudge the weights,
and repeat many thousands of times.
"""

import json
import sys
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

HERE = Path(__file__).parent
DATA = HERE / "data"
MODEL_FILE = HERE.parent / "digit-model.js"

# Fonts kept out of the fair test's training, to see how the network
# copes with lettering it has never seen.
UNSEEN_FONTS = ["Lato", "Merriweather", "Space Mono", "Josefin Sans", "Liberation Serif", "Comfortaa"]

EPOCHS = 2        # passes through all the practice digits; more makes it
                  # memorise the training fonts and do worse on new ones
BATCH = 128       # digits per small step
LEARNING_RATE = 0.002

rng = np.random.default_rng(42)


# ---------- The layers, each with a forward and a backward step ----------

def conv_forward(x, w, b):
    """3x3 convolution with 1 pixel of padding. x: (N, C, H, W), w: (O, C, 3, 3)."""
    n, c, h, wd = x.shape
    padded = np.pad(x, ((0, 0), (0, 0), (1, 1), (1, 1)))
    # Every 3x3 window of the input, laid out as one row per output pixel,
    # so the whole convolution becomes a single matrix multiplication.
    windows = sliding_window_view(padded, (3, 3), axis=(2, 3))  # (N, C, H, W, 3, 3)
    cols = windows.transpose(0, 2, 3, 1, 4, 5).reshape(n * h * wd, c * 9)
    out = cols @ w.reshape(len(w), -1).T + b
    return out.reshape(n, h, wd, -1).transpose(0, 3, 1, 2), cols


def conv_backward(dout, cols, x_shape, w):
    n, c, h, wd = x_shape
    dflat = dout.transpose(0, 2, 3, 1).reshape(-1, len(w))
    dw = (dflat.T @ cols).reshape(w.shape)
    db = dflat.sum(axis=0)
    dcols = (dflat @ w.reshape(len(w), -1)).reshape(n, h, wd, c, 3, 3)
    dpadded = np.zeros((n, c, h + 2, wd + 2), dtype=dout.dtype)
    for ky in range(3):
        for kx in range(3):
            dpadded[:, :, ky:ky + h, kx:kx + wd] += dcols[..., ky, kx].transpose(0, 3, 1, 2)
    return dpadded[:, :, 1:-1, 1:-1], dw, db


def pool_forward(x):
    """Keep the largest value of every 2x2 block."""
    n, c, h, w = x.shape
    blocks = x.reshape(n, c, h // 2, 2, w // 2, 2)
    out = blocks.max(axis=(3, 5))
    winners = blocks == out[:, :, :, None, :, None]
    return out, winners


def pool_backward(dout, winners):
    # Only the value that won each block passes its gradient back.
    d = winners * dout[:, :, :, None, :, None]
    n, c, h2, _, w2, _ = d.shape
    return d.reshape(n, c, h2 * 2, w2 * 2)


# ---------- The whole network ----------

def init_model():
    def he(shape, fan_in):
        return (rng.standard_normal(shape) * np.sqrt(2 / fan_in)).astype(np.float32)
    return {
        "conv1_w": he((16, 1, 3, 3), 9), "conv1_b": np.zeros(16, np.float32),
        "conv2_w": he((32, 16, 3, 3), 144), "conv2_b": np.zeros(32, np.float32),
        "dense_w": he((9, 32 * 7 * 7), 32 * 7 * 7), "dense_b": np.zeros(9, np.float32),
    }


def forward(m, x):
    a1, cols1 = conv_forward(x, m["conv1_w"], m["conv1_b"])
    r1 = np.maximum(a1, 0)
    p1, win1 = pool_forward(r1)
    a2, cols2 = conv_forward(p1, m["conv2_w"], m["conv2_b"])
    r2 = np.maximum(a2, 0)
    p2, win2 = pool_forward(r2)
    flat = p2.reshape(len(x), -1)
    scores = flat @ m["dense_w"].T + m["dense_b"]
    cache = (x, a1, cols1, win1, p1, a2, cols2, win2, p2, flat)
    return scores, cache


def loss_and_gradients(m, x, labels):
    scores, (x, a1, cols1, win1, p1, a2, cols2, win2, p2, flat) = forward(m, x)
    # Softmax turns scores into chances; the loss is how unlikely the
    # network thought the right answer was.
    scores = scores - scores.max(axis=1, keepdims=True)
    chances = np.exp(scores)
    chances /= chances.sum(axis=1, keepdims=True)
    n = len(x)
    loss = -np.log(chances[np.arange(n), labels] + 1e-9).mean()

    g = {}
    dscores = chances
    dscores[np.arange(n), labels] -= 1
    dscores /= n
    g["dense_w"] = dscores.T @ flat
    g["dense_b"] = dscores.sum(axis=0)
    dp2 = (dscores @ m["dense_w"]).reshape(p2.shape)
    da2 = pool_backward(dp2, win2) * (a2 > 0)
    dp1, g["conv2_w"], g["conv2_b"] = conv_backward(da2, cols2, p1.shape, m["conv2_w"])
    da1 = pool_backward(dp1, win1) * (a1 > 0)
    _, g["conv1_w"], g["conv1_b"] = conv_backward(da1, cols1, x.shape, m["conv1_w"])
    return loss, g


def predict(m, x):
    out = []
    for i in range(0, len(x), 1024):
        scores, _ = forward(m, x[i:i + 1024])
        out.append(scores.argmax(axis=1))
    return np.concatenate(out)


# ---------- Training ----------

def train(x, labels, x_test=None, labels_test=None):
    m = init_model()
    # Adam: a popular way of nudging the weights that adapts the step size
    # for each weight separately.
    moment1 = {k: np.zeros_like(v) for k, v in m.items()}
    moment2 = {k: np.zeros_like(v) for k, v in m.items()}
    step = 0
    for epoch in range(EPOCHS):
        order = rng.permutation(len(x))
        rate = LEARNING_RATE * (0.6 ** epoch)  # smaller steps as it gets better
        losses = []
        for start in range(0, len(x), BATCH):
            batch = order[start:start + BATCH]
            xb = x[batch]
            # Shift a few digits by a pixel, so the network doesn't depend on
            # perfect centring.
            shift = rng.integers(-1, 2, size=2)
            if rng.random() < 0.5:
                xb = np.roll(xb, shift, axis=(2, 3))
            loss, g = loss_and_gradients(m, xb, labels[batch])
            losses.append(loss)
            step += 1
            for k in m:
                moment1[k] = 0.9 * moment1[k] + 0.1 * g[k]
                moment2[k] = 0.999 * moment2[k] + 0.001 * g[k] ** 2
                m1 = moment1[k] / (1 - 0.9 ** step)
                m2 = moment2[k] / (1 - 0.999 ** step)
                m[k] -= (rate * m1 / (np.sqrt(m2) + 1e-8)).astype(np.float32)
        report = f"  epoch {epoch + 1}/{EPOCHS}: loss {np.mean(losses):.4f}"
        if x_test is not None:
            accuracy = (predict(m, x_test) == labels_test).mean()
            report += f", unseen fonts {accuracy:.2%} correct"
        print(report, flush=True)
    return m


def gradient_check():
    """Compare backpropagation with slow, direct measurement on a tiny batch,
    to make sure the backward steps above are right."""
    m = init_model()
    m = {k: v.astype(np.float64) for k, v in m.items()}
    x = rng.random((3, 1, 28, 28))
    labels = np.array([0, 4, 8])
    _, g = loss_and_gradients(m, x, labels)
    for k in m:
        for _ in range(3):
            idx = tuple(rng.integers(0, s) for s in m[k].shape)
            old = m[k][idx]
            m[k][idx] = old + 1e-5
            up, _ = loss_and_gradients(m, x, labels)
            m[k][idx] = old - 1e-5
            down, _ = loss_and_gradients(m, x, labels)
            m[k][idx] = old
            measured = (up - down) / 2e-5
            print(f"  {k}{list(idx)}: backprop {g[k][idx]:+.6f}, measured {measured:+.6f}")


def save_model(m, notes):
    def numbers(a):
        return [float(f"{v:.4g}") for v in a.ravel()]
    model = {
        "conv1": {"weights": numbers(m["conv1_w"]), "bias": numbers(m["conv1_b"])},
        "conv2": {"weights": numbers(m["conv2_w"]), "bias": numbers(m["conv2_b"])},
        "dense": {"weights": numbers(m["dense_w"]), "bias": numbers(m["dense_b"])},
    }
    MODEL_FILE.write_text(
        "// The digit-reading network's learned weights.\n"
        "// Made by training/train.py; don't edit by hand.\n"
        f"// {notes}\n"
        "const DIGIT_MODEL = " + json.dumps(model, separators=(",", ":")) + ";\n\n"
        'if (typeof module !== "undefined") {\n  module.exports = { DIGIT_MODEL };\n}\n'
    )


def main():
    if "--check" in sys.argv:
        gradient_check()
        return

    images = np.fromfile(DATA / "images.bin", np.uint8).reshape(-1, 1, 28, 28)
    x = images.astype(np.float32) / 255
    labels = np.fromfile(DATA / "labels.bin", np.uint8).astype(np.int64) - 1  # digits 1-9 -> classes 0-8
    font_ids = np.fromfile(DATA / "fonts.bin", np.uint8)
    fonts = json.loads((DATA / "fonts.json").read_text())
    print(f"{len(x)} practice digits in {len(fonts)} fonts")

    unseen = np.isin(font_ids, [fonts.index(f) for f in UNSEEN_FONTS if f in fonts])
    print(f"\n1. Fair test: training without {', '.join(UNSEEN_FONTS)}")
    m = train(x[~unseen], labels[~unseen], x[unseen], labels[unseen])
    guesses = predict(m, x[unseen])
    accuracy = (guesses == labels[unseen]).mean()
    wrong = guesses != labels[unseen]
    pairs = {}
    for truth, guess in zip(labels[unseen][wrong] + 1, guesses[wrong] + 1):
        pairs[f"{truth} read as {guess}"] = pairs.get(f"{truth} read as {guess}", 0) + 1
    print(f"   Unseen fonts: {accuracy:.2%} correct. Most common mistakes:",
          sorted(pairs.items(), key=lambda p: -p[1])[:5])

    print("\n2. Training on all fonts for the app")
    m = train(x, labels)
    save_model(m, f"Trained on {len(x)} digits in {len(fonts)} fonts; "
                  f"{accuracy:.2%} correct on fonts left out of training.")
    print(f"\nSaved {MODEL_FILE.name}")


if __name__ == "__main__":
    main()
