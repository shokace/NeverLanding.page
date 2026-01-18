const getButton = document.getElementById("get");
const backButton = document.getElementById("back");
const forwardButton = document.getElementById("forward");
const stopButton = document.getElementById("stop");
const refreshButton = document.getElementById("refresh");
const urlEl = document.getElementById("url");
const metaEl = document.getElementById("meta");
const viewerEl = document.getElementById("viewer");
const embedNoteEl = document.getElementById("embed-note");
const loadingEl = document.getElementById("loading");
const throbberEl = document.getElementById("throbber");
let currentUrl = "";
let fetchController = null;
let history = [];
let historyIndex = -1;
let hasStarted = false;
const HISTORY_KEY = "neverlanding-history";
const HISTORY_LIMIT = 50;
const SHARE_PARAM = "url";
const menus = Array.from(document.querySelectorAll(".menu"));

function closeMenus(exceptMenu = null) {
  menus.forEach((menu) => {
    if (menu === exceptMenu) return;
    menu.classList.remove("is-open");
    const button = menu.querySelector(".menu-button");
    if (button) button.setAttribute("aria-expanded", "false");
  });
}

menus.forEach((menu) => {
  const button = menu.querySelector(".menu-button");
  if (!button) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = menu.classList.contains("is-open");
    if (isOpen) {
      menu.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
      return;
    }
    closeMenus(menu);
    menu.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
  });
});

document.addEventListener("click", () => {
  closeMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
  }
});

function loadHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.items)) {
      history = data.items;
      historyIndex = -1;
    }
  } catch {}
}

function saveHistory() {
  try {
    sessionStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ items: history, index: historyIndex })
    );
  } catch {}
}

function updateBackButton() {
  backButton.disabled = historyIndex <= 0;
}

function updateForwardButton() {
  forwardButton.disabled = historyIndex >= history.length - 1;
}

function getShareUrl(targetUrl) {
  if (!targetUrl) return "";
  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_PARAM, targetUrl);
  return url.toString();
}

function updateShareParam(targetUrl) {
  if (!targetUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(null, "", url.toString());
    return;
  }
  const shareUrl = getShareUrl(targetUrl);
  if (shareUrl) {
    window.history.replaceState(null, "", shareUrl);
  }
}

function normalizeSharedUrl(raw) {
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function applyEntry(entry) {
  currentUrl = entry.url || "";
  urlEl.textContent = currentUrl || "No URL returned.";
  urlEl.href = currentUrl || "#";
  const metaParts = [];
  if (entry.crawl) metaParts.push(entry.crawl);
  if (entry.at) metaParts.push(entry.at);
  metaEl.textContent = metaParts.join(" - ");
  viewerEl.src = currentUrl || "about:blank";
  if (!currentUrl && !hasStarted) {
    loadingEl.classList.remove("is-hidden");
  }
  updateShareParam(currentUrl);
}

function pushHistory(entry) {
  history = history.slice(0, historyIndex + 1);
  history.push(entry);
  if (history.length > HISTORY_LIMIT) {
    history.shift();
  } else {
    historyIndex += 1;
  }
  if (history.length >= HISTORY_LIMIT) {
    historyIndex = history.length - 1;
  }
  saveHistory();
  updateBackButton();
  updateForwardButton();
}

async function loadRandom() {
  getButton.disabled = true;
  urlEl.textContent = "Loading...";
  urlEl.href = "#";
  metaEl.textContent = "";
  viewerEl.src = "about:blank";
  loadingEl.classList.add("is-hidden");
  throbberEl.classList.remove("is-hidden");

  try {
    fetchController = new AbortController();
    const res = await fetch("/api/random", {
      method: "GET",
      signal: fetchController.signal,
    });
    if (!res.ok) {
      throw new Error("Request failed");
    }
    const data = await res.json();
    const entry = {
      url: data.url || "",
      crawl: data.crawl || "",
      at: data.at || "",
    };
    applyEntry(entry);
    if (entry.url) pushHistory(entry);
  } catch (err) {
    currentUrl = "";
    urlEl.textContent = "Error loading a URL.";
    urlEl.href = "#";
    metaEl.textContent = "Please try again.";
    throbberEl.classList.add("is-hidden");
    if (!hasStarted) loadingEl.classList.remove("is-hidden");
  } finally {
    getButton.disabled = false;
    fetchController = null;
  }
}

getButton.addEventListener("click", loadRandom);
backButton.addEventListener("click", () => {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  const entry = history[historyIndex];
  applyEntry(entry);
  saveHistory();
  updateBackButton();
  updateForwardButton();
});

forwardButton.addEventListener("click", () => {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  const entry = history[historyIndex];
  applyEntry(entry);
  saveHistory();
  updateBackButton();
  updateForwardButton();
});

stopButton.addEventListener("click", () => {
  if (fetchController) {
    fetchController.abort();
    fetchController = null;
  }
  try {
    if (viewerEl.contentWindow) {
      viewerEl.contentWindow.stop();
    }
  } catch {}
});

refreshButton.addEventListener("click", () => {
  if (!currentUrl) return;
  viewerEl.src = "about:blank";
  setTimeout(() => {
    viewerEl.src = currentUrl;
  }, 60);
});

loadHistory();
updateBackButton();
updateForwardButton();

const sharedParam = new URLSearchParams(window.location.search).get(SHARE_PARAM);
const sharedUrl = normalizeSharedUrl(sharedParam);
if (sharedUrl) {
  applyEntry({ url: sharedUrl, crawl: "shared link", at: "" });
  pushHistory({ url: sharedUrl, crawl: "shared link", at: "" });
}

viewerEl.addEventListener("load", () => {
  if (!currentUrl) return;
  throbberEl.classList.add("is-hidden");
  if (!hasStarted) {
    loadingEl.classList.add("is-hidden");
    hasStarted = true;
  }
});
