// Tells you when a newer version of the app has been published.
//
// Web pages are kept in several caches (your browser, GitHub's servers) for
// up to 10 minutes, so after an update you might still be shown the old app.
// When the page opens, and whenever you come back to it, this asks for
// version.json with a unique address, which skips every cache. If the
// version there differs from this page's own, a bar with a Reload button appears.

const pageVersion = document.querySelector('meta[name="app-version"]').content;
const updateBar = document.getElementById("update-bar");

async function checkForUpdate() {
  let latest;
  try {
    const response = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return; // e.g. the page was opened from a file, not a website
    latest = (await response.json()).version;
  } catch {
    return; // offline, or no version.json: nothing to report
  }
  if (latest && latest !== pageVersion) {
    updateBar.hidden = false;
    // A new address (?v=...) makes every cache fetch the page fresh, and the
    // page's own file names carry the same ?v=, so they come fresh too.
    document.getElementById("update-reload").onclick = () => {
      location.replace(location.pathname + "?v=" + latest);
    };
  }
}

checkForUpdate();
// Phones keep tabs open for days: check again whenever the app is shown.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForUpdate();
});
