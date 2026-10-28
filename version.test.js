// Checks that the version number was updated after the last change.
// Run with: node --test
// If this fails, run: node tools/update-version.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { computeVersion, APP_FILES } = require("./tools/update-version.js");

test("version.json and index.html carry the current version", () => {
  const version = computeVersion();
  const stored = JSON.parse(fs.readFileSync(__dirname + "/version.json", "utf8")).version;
  assert.strictEqual(stored, version, "run: node tools/update-version.js");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.ok(html.includes('<meta name="app-version" content="' + version + '">'));
  // Every file the page loads carries the version, so none is served from an old cache.
  for (const file of APP_FILES) {
    assert.ok(html.includes(file + "?v=" + version), file + " should be loaded with ?v=" + version);
  }
});
