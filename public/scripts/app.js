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
const loginMenuItem = document.getElementById("login-menu");
const logoutMenuItem = document.getElementById("logout-menu");
const shareMenuItem = document.getElementById("share-menu");
const achievementsMenuItem = document.getElementById("achievements-menu");
const leaderboardMenuItem = document.getElementById("leaderboard-menu");
const fullscreenMenuItem = document.getElementById("fullscreen-menu");
const favoritesAddMenuItem = document.getElementById("favorites-add-menu");
const favoritesEditMenuItem = document.getElementById("favorites-edit-menu");
const loginModal = document.getElementById("login-modal");
const loginClose = loginModal ? loginModal.querySelector(".modal-close") : null;
const achievementsModal = document.getElementById("achievements-modal");
const achievementsClose = achievementsModal
  ? achievementsModal.querySelector(".modal-close")
  : null;
const emailToggle = loginModal ? loginModal.querySelector("[data-action=\"email-login\"]") : null;
const signupToggle = loginModal ? loginModal.querySelector("[data-action=\"email-signup\"]") : null;
const emailForm = document.getElementById("email-login");
const signupForm = document.getElementById("email-signup");
const loginStatus = document.getElementById("login-status");
const providerButtons = loginModal
  ? Array.from(loginModal.querySelectorAll("[data-provider]"))
  : [];
let currentUrl = "";
let fetchController = null;
let history = [];
let historyIndex = -1;
let hasStarted = false;
let currentUser = null;
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

function openLoginModal() {
  if (!loginModal) return;
  loginModal.classList.remove("is-hidden");
}

function closeLoginModal() {
  if (!loginModal) return;
  loginModal.classList.add("is-hidden");
  if (emailForm) emailForm.classList.add("is-hidden");
  if (signupForm) signupForm.classList.add("is-hidden");
}

function openAchievementsModal() {
  if (!achievementsModal) return;
  achievementsModal.classList.remove("is-hidden");
}

function closeAchievementsModal() {
  if (!achievementsModal) return;
  achievementsModal.classList.add("is-hidden");
}

function setLoginStatus(message) {
  if (!loginStatus) return;
  loginStatus.textContent = message;
}

function setAuthState(user) {
  currentUser = user || null;
  if (loginMenuItem) {
    const loggedIn = Boolean(user);
    loginMenuItem.classList.toggle("is-disabled", loggedIn);
    loginMenuItem.classList.toggle("is-truncated", loggedIn);
    loginMenuItem.setAttribute("aria-disabled", loggedIn ? "true" : "false");
    loginMenuItem.textContent = loggedIn
      ? `Logged in as ${user.username || user.email || "user"}`
      : "Login";
  }
  if (logoutMenuItem) {
    logoutMenuItem.classList.toggle("is-disabled", !user);
    logoutMenuItem.setAttribute("aria-disabled", !user ? "true" : "false");
  }
  if (achievementsMenuItem) {
    achievementsMenuItem.classList.toggle("is-disabled", !user);
    achievementsMenuItem.setAttribute("aria-disabled", !user ? "true" : "false");
  }
  if (user && metaEl) {
    metaEl.textContent = `Signed in as ${user.username || user.email}.`;
  }
}

if (loginMenuItem) {
  loginMenuItem.addEventListener("click", () => {
    closeMenus();
    setLoginStatus("");
    openLoginModal();
  });
}

if (loginModal) {
  loginModal.addEventListener("click", (event) => {
    if (event.target === loginModal) closeLoginModal();
  });
}

if (loginClose) {
  loginClose.addEventListener("click", closeLoginModal);
}

if (achievementsModal) {
  achievementsModal.addEventListener("click", (event) => {
    if (event.target === achievementsModal) closeAchievementsModal();
  });
}

if (achievementsClose) {
  achievementsClose.addEventListener("click", closeAchievementsModal);
}

if (emailToggle && emailForm) {
  emailToggle.addEventListener("click", () => {
    emailForm.classList.toggle("is-hidden");
    if (signupForm) signupForm.classList.add("is-hidden");
  });
}

if (signupToggle && signupForm) {
  signupToggle.addEventListener("click", () => {
    signupForm.classList.toggle("is-hidden");
    if (emailForm) emailForm.classList.add("is-hidden");
  });
}

if (emailForm) {
  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(emailForm);
    const payload = {
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
    };
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      setAuthState(data.user);
      closeLoginModal();
      setLoginStatus("");
    } else {
      setLoginStatus("Email login failed. Check your credentials.");
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(signupForm);
    const payload = {
      email: String(formData.get("email") || ""),
      username: String(formData.get("username") || ""),
      password: String(formData.get("password") || ""),
    };
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      setAuthState(data.user);
      closeLoginModal();
      setLoginStatus("");
    } else {
      setLoginStatus("Sign up failed. Try a different email or username.");
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && loginModal && !loginModal.classList.contains("is-hidden")) {
    closeLoginModal();
  }
  if (
    event.key === "Escape" &&
    achievementsModal &&
    !achievementsModal.classList.contains("is-hidden")
  ) {
    closeAchievementsModal();
  }
});

if (logoutMenuItem) {
  logoutMenuItem.addEventListener("click", async () => {
    closeMenus();
    await fetch("/api/auth/logout", { method: "POST" });
    metaEl.textContent = "Signed out.";
    setAuthState(null);
  });
}

if (shareMenuItem) {
  shareMenuItem.addEventListener("click", async () => {
    closeMenus();
    if (!currentUrl) {
      metaEl.textContent = "No URL to share yet.";
      return;
    }
    const shareUrl = getShareUrl(currentUrl);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        metaEl.textContent = "Share link copied to clipboard.";
      } else {
        window.prompt("Copy share link:", shareUrl);
      }
    } catch {
      window.prompt("Copy share link:", shareUrl);
    }
  });
}

if (fullscreenMenuItem) {
  fullscreenMenuItem.addEventListener("click", async () => {
    closeMenus();
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {}
    } else {
      try {
        await document.exitFullscreen();
      } catch {}
    }
  });
}

if (achievementsMenuItem) {
  achievementsMenuItem.addEventListener("click", () => {
    closeMenus();
    openAchievementsModal();
  });
}

if (leaderboardMenuItem) {
  leaderboardMenuItem.addEventListener("click", () => {
    closeMenus();
    metaEl.textContent = "Leaderboards coming soon.";
  });
}

if (favoritesAddMenuItem) {
  favoritesAddMenuItem.addEventListener("click", () => {
    closeMenus();
    metaEl.textContent = "Favorites coming soon.";
  });
}

if (favoritesEditMenuItem) {
  favoritesEditMenuItem.addEventListener("click", () => {
    closeMenus();
    metaEl.textContent = "Favorites coming soon.";
  });
}

if (providerButtons.length) {
  fetch("/api/auth/providers")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !data.providers) return;
      providerButtons.forEach((button) => {
        const provider = button.getAttribute("data-provider");
        const available = Boolean(data.providers[provider]);
        if (!available) {
          button.classList.add("is-disabled");
          button.setAttribute("aria-disabled", "true");
        }
        button.addEventListener("click", (event) => {
          if (!available) {
            event.preventDefault();
            setLoginStatus(`${provider} sign-in is not configured yet.`);
          }
        });
      });
    })
    .catch(() => {});
}

fetch("/api/auth/me")
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (!data) return;
    setAuthState(data.user);
  })
  .catch(() => {});

async function logVisit(url) {
  if (!currentUser || !url) return;
  try {
    await fetch("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {}
}


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
    if (entry.url) logVisit(entry.url);
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
