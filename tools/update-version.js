// Gives the app a new version number after a change.
//
// Usage: node tools/update-version.js     (run before every commit)
//
// The version is a short fingerprint of the app's files, so it changes
// whenever any of them changes, and stays the same when nothing did.
// It is written to three places:
//   - version.json, which open copies of the app check to see if they're old
//   - the <meta name="app-version"> tag in index.html: the page's own version
//   - "?v=..." after every file name in index.html, so that after an update
//     the browser downloads every file fresh instead of mixing in old copies

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

// Every file the page loads (besides index.html itself).
const APP_FILES = ["style.css", "solver.js", "vision.js", "digit-model.js", "digits.js", "app.js", "reader.js", "update.js"];

// index.html with all version numbers blanked out, so the version doesn't
// depend on itself.
function pageWithoutVersions(html) {
  return html
    .replace(/(<meta name="app-version" content=")[^"]*/, "$1")
    .replace(/\?v=[0-9a-f]*/g, "?v=");
}

function computeVersion() {
  const hash = crypto.createHash("sha256");
  hash.update(pageWithoutVersions(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")));
  for (const file of APP_FILES) hash.update(fs.readFileSync(path.join(ROOT, file)));
  return hash.digest("hex").slice(0, 10);
}

function writeVersion() {
  const version = computeVersion();
  const pagePath = path.join(ROOT, "index.html");
  const html = fs.readFileSync(pagePath, "utf8")
    .replace(/(<meta name="app-version" content=")[^"]*/, "$1" + version)
    .replace(/\?v=[0-9a-f]*/g, "?v=" + version);
  fs.writeFileSync(pagePath, html);
  fs.writeFileSync(path.join(ROOT, "version.json"), JSON.stringify({ version }) + "\n");
  return version;
}

if (require.main === module) {
  console.log("Version " + writeVersion());
}

module.exports = { computeVersion, APP_FILES };
