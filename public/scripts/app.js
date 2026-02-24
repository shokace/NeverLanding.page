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
const adOverlayEl = document.getElementById("ad-overlay");
const loginMenuItem = document.getElementById("login-menu");
const logoutMenuItem = document.getElementById("logout-menu");
const shareMenuItem = document.getElementById("share-menu");
const achievementsMenuItem = document.getElementById("achievements-menu");
const leaderboardMenuItem = document.getElementById("leaderboard-menu");
const fullscreenMenuItem = document.getElementById("fullscreen-menu");
const favoritesEditMenuItem = document.getElementById("favorites-edit-menu");
const favoriteToggleButton = document.getElementById("favorite-toggle");
const aboutMenuItem = document.getElementById("about-menu");
const reportIssueMenuItem = document.getElementById("report-issue-menu");
const shareModal = document.getElementById("share-modal");
const shareClose = shareModal ? shareModal.querySelector(".modal-close") : null;
const shareLinkInput = document.getElementById("share-link");
const shareCopyButton = document.getElementById("share-copy");
const shareIcons = Array.from(document.querySelectorAll(".share-icon"));
const landingCounter = document.getElementById("landing-counter");
const loginModal = document.getElementById("login-modal");
const loginClose = loginModal ? loginModal.querySelector(".modal-close") : null;
const achievementsModal = document.getElementById("achievements-modal");
const achievementsClose = achievementsModal
  ? achievementsModal.querySelector(".modal-close")
  : null;
const favoritesModal = document.getElementById("favorites-modal");
const favoritesClose = favoritesModal ? favoritesModal.querySelector(".modal-close") : null;
const favoritesList = document.getElementById("favorites-list");
const favoritesEmpty = document.getElementById("favorites-empty");
const aboutModal = document.getElementById("about-modal");
const aboutClose = aboutModal ? aboutModal.querySelector(".modal-close") : null;
const reportIssueModal = document.getElementById("report-issue-modal");
const reportIssueClose = reportIssueModal
  ? reportIssueModal.querySelector(".modal-close")
  : null;
const rateLimitModal = document.getElementById("rate-limit-modal");
const rateLimitClose = rateLimitModal ? rateLimitModal.querySelector(".modal-close") : null;
const rateLimitOk = document.getElementById("rate-limit-ok");
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
let favorites = [];
let favoritesByUrl = new Map();
let isLoading = false;
let prefetchedEntry = null;
let prefetchPromise = null;

function setStopState(active) {
  isLoading = active;
  if (!stopButton) return;
  stopButton.classList.toggle("is-inactive", !active);
}
let favoritesPendingRemovals = new Set();
const HISTORY_KEY = "neverlanding-history";
const HISTORY_LIMIT = 50;
const SHARE_PARAM = "url";
const AD_COUNT_KEY = "neverlanding-ad-count";
const AD_TARGET_KEY = "neverlanding-ad-target";
const AD_MIN_PAGES = 10;
const AD_MAX_PAGES = 15;
const ADS_ENABLED = false;
const menus = Array.from(document.querySelectorAll(".menu"));
let adCount = 0;
let adTarget = 0;
let adShowing = false;
let adCountdownTimer = null;
let adCountdownRemaining = 0;
let adGoLabel = "";

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
  document.dispatchEvent(new CustomEvent("achievements-viewed"));
}

function openFavoritesModal() {
  if (!favoritesModal) return;
  favoritesPendingRemovals = new Set();
  favoritesModal.classList.remove("is-hidden");
  fetchFavorites();
}

function closeFavoritesModal() {
  if (!favoritesModal) return;
  favoritesModal.classList.add("is-hidden");
  if (favoritesPendingRemovals.size) {
    applyFavoriteRemovals();
  }
}

function openAboutModal() {
  if (!aboutModal) return;
  aboutModal.classList.remove("is-hidden");
}

function closeAboutModal() {
  if (!aboutModal) return;
  aboutModal.classList.add("is-hidden");
}

function openShareModal() {
  if (!shareModal) return;
  shareModal.classList.remove("is-hidden");
  updateShareModal();
}

function closeShareModal() {
  if (!shareModal) return;
  shareModal.classList.add("is-hidden");
}

function updateShareModal() {
  if (!shareLinkInput) return;
  const shareUrl = currentUrl ? getShareUrl(currentUrl) : "";
  shareLinkInput.value = shareUrl;
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent("Check out this site I found on Never Landing Page:");
  const targets = {
    sms: `sms:?&body=${encodedText}%20${encodedUrl}`,
    x: `https://x.com/intent/tweet?text=${encodedText}%20${encodedUrl}`,
    email: `mailto:?subject=Never%20Landing%20Page&body=${encodedText}%20${encodedUrl}`,
  };
  shareIcons.forEach((icon) => {
    const key = icon.getAttribute("data-share");
    if (!key || !targets[key]) return;
    icon.setAttribute("href", targets[key]);
  });
}

function openReportIssueModal() {
  if (!reportIssueModal) return;
  reportIssueModal.classList.remove("is-hidden");
}

function closeReportIssueModal() {
  if (!reportIssueModal) return;
  reportIssueModal.classList.add("is-hidden");
}

function openRateLimitModal() {
  if (!rateLimitModal) return;
  rateLimitModal.classList.remove("is-hidden");
}

function closeRateLimitModal() {
  if (!rateLimitModal) return;
  rateLimitModal.classList.add("is-hidden");
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
    achievementsMenuItem.classList.remove("is-disabled");
    achievementsMenuItem.setAttribute("aria-disabled", "false");
  }
  if (user && metaEl) {
    metaEl.textContent = `Signed in as ${user.username || user.email}.`;
  }
  if (!user && landingCounter) {
    landingCounter.textContent = "Landings: 0";
  }
  if (user) {
    fetchFavorites();
  } else {
    favorites = [];
    favoritesByUrl = new Map();
    renderFavoritesList();
    updateFavoriteButton();
  }
  document.dispatchEvent(
    new CustomEvent("auth-changed", { detail: { user: currentUser } })
  );
}

function renderFavoritesList() {
  if (!favoritesList || !favoritesEmpty) return;
  favoritesList.innerHTML = "";
  if (!favorites.length) {
    favoritesEmpty.classList.remove("is-hidden");
    return;
  }
  favoritesEmpty.classList.add("is-hidden");
  const fragment = document.createDocumentFragment();
  favorites.forEach((item) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.url || "#";
    link.textContent = item.title || item.url || "Untitled";
    if (item.url) {
      link.dataset.url = item.url;
    }
    link.addEventListener("click", (event) => {
      const targetUrl = link.dataset.url || "";
      if (!targetUrl) return;
      event.preventDefault();
      closeFavoritesModal();
      applyEntry({ url: targetUrl, crawl: "favorite", at: "" });
      pushHistory({ url: targetUrl, crawl: "favorite", at: "" });
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "favorites-toggle is-active";
    toggle.setAttribute("aria-pressed", "true");
    toggle.setAttribute("title", "Remove from favorites");
    toggle.setAttribute("aria-label", "Remove from favorites");
    toggle.innerHTML = '<span class="favorite-icon" aria-hidden="true"></span>';
    if (item.url) {
      toggle.dataset.url = item.url;
    }
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const targetUrl = toggle.dataset.url || "";
      if (!targetUrl) return;
      const isActive = toggle.classList.toggle("is-active");
      toggle.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (!isActive) {
        favoritesPendingRemovals.add(targetUrl);
        toggle.setAttribute("title", "Restore favorite");
        toggle.setAttribute("aria-label", "Restore favorite");
        return;
      }
      favoritesPendingRemovals.delete(targetUrl);
      toggle.setAttribute("title", "Remove from favorites");
      toggle.setAttribute("aria-label", "Remove from favorites");
    });
    li.appendChild(link);
    li.appendChild(toggle);
    fragment.appendChild(li);
  });
  favoritesList.appendChild(fragment);
}

function updateFavoriteButton() {
  if (!favoriteToggleButton) return;
  const isActive = Boolean(currentUser && currentUrl && favoritesByUrl.has(currentUrl));
  favoriteToggleButton.classList.toggle("is-active", isActive);
  favoriteToggleButton.setAttribute("aria-pressed", isActive ? "true" : "false");
}

async function fetchFavorites() {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/favorites");
    if (!res.ok) return;
    const data = await res.json();
    favorites = Array.isArray(data.items) ? data.items : [];
    favoritesByUrl = new Map(favorites.map((item) => [item.url, item]));
    renderFavoritesList();
    updateFavoriteButton();
  } catch {}
}

async function toggleFavorite() {
  if (!currentUser) {
    setLoginStatus("Create a free account to start!");
    openLoginModal();
    return;
  }
  if (!currentUrl) {
    if (metaEl) metaEl.textContent = "No URL to favorite yet.";
    return;
  }
  try {
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: currentUrl, title: currentUrl }),
    });
    if (!res.ok) return;
    await fetchFavorites();
  } catch {}
}

async function applyFavoriteRemovals() {
  if (!favoritesPendingRemovals.size) return;
  const removals = Array.from(favoritesPendingRemovals);
  favoritesPendingRemovals.clear();
  try {
    await Promise.all(
      removals.map((url) =>
        fetch("/api/favorites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        })
      )
    );
    await fetchFavorites();
  } catch {}
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

if (favoritesModal) {
  favoritesModal.addEventListener("click", (event) => {
    if (event.target === favoritesModal) closeFavoritesModal();
  });
}

if (favoritesClose) {
  favoritesClose.addEventListener("click", closeFavoritesModal);
}

if (aboutModal) {
  aboutModal.addEventListener("click", (event) => {
    if (event.target === aboutModal) closeAboutModal();
  });
}

if (aboutClose) {
  aboutClose.addEventListener("click", closeAboutModal);
}

if (reportIssueModal) {
  reportIssueModal.addEventListener("click", (event) => {
    if (event.target === reportIssueModal) closeReportIssueModal();
  });
}

if (reportIssueClose) {
  reportIssueClose.addEventListener("click", closeReportIssueModal);
}

if (rateLimitClose) {
  rateLimitClose.addEventListener("click", closeRateLimitModal);
}

if (rateLimitOk) {
  rateLimitOk.addEventListener("click", closeRateLimitModal);
}

if (shareModal) {
  shareModal.addEventListener("click", (event) => {
    if (event.target === shareModal) closeShareModal();
  });
}

if (shareClose) {
  shareClose.addEventListener("click", closeShareModal);
}

if (shareCopyButton && shareLinkInput) {
  shareCopyButton.addEventListener("click", async () => {
    if (!shareLinkInput.value) return;
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      shareCopyButton.textContent = "Copied";
      setTimeout(() => {
        shareCopyButton.textContent = "Copy";
      }, 1200);
    } catch {}
  });
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
    }
    openShareModal();
    if (currentUser) {
      fetch("/api/achievements/share", { method: "POST" }).catch(() => {});
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
    if (!currentUser) openLoginModal();
  });
}

if (leaderboardMenuItem) {
  leaderboardMenuItem.addEventListener("click", () => {
    closeMenus();
    metaEl.textContent = "Leaderboards coming soon.";
  });
}

if (aboutMenuItem) {
  aboutMenuItem.addEventListener("click", () => {
    closeMenus();
    openAboutModal();
  });
}

if (reportIssueMenuItem) {
  reportIssueMenuItem.addEventListener("click", () => {
    closeMenus();
    openReportIssueModal();
  });
}

if (favoritesEditMenuItem) {
  favoritesEditMenuItem.addEventListener("click", () => {
    closeMenus();
    if (!currentUser) {
      setLoginStatus("Create a free account to unlock achievements and save favorites.");
      openLoginModal();
      return;
    }
    openFavoritesModal();
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
    if (data.user) fetchProgress();
  })
  .catch(() => {});

async function fetchProgress() {
  if (!landingCounter) return;
  try {
    const res = await fetch("/api/progress");
    if (!res.ok) return;
    const data = await res.json();
    landingCounter.textContent = `Landings: ${data.visits || 0}`;
  } catch {}
}

async function logVisit(url) {
  if (!currentUser || !url) return;
  try {
    const res = await fetch("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (res.status === 429) {
      openRateLimitModal();
      return;
    }
    fetchProgress();
    document.dispatchEvent(new CustomEvent("achievements-changed"));
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
  setStopState(Boolean(currentUrl));
  if (!currentUrl && !hasStarted) {
    loadingEl.classList.remove("is-hidden");
  }
  updateShareParam(currentUrl);
  updateFavoriteButton();
  updateShareModal();
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

function randomAdTarget() {
  return Math.floor(Math.random() * (AD_MAX_PAGES - AD_MIN_PAGES + 1)) + AD_MIN_PAGES;
}

function loadAdState() {
  if (!ADS_ENABLED) {
    adCount = 0;
    adTarget = 0;
    if (adOverlayEl) {
      adOverlayEl.classList.add("is-hidden");
      adOverlayEl.setAttribute("aria-hidden", "true");
    }
    return;
  }
  try {
    adCount = Number(localStorage.getItem(AD_COUNT_KEY)) || 0;
    adTarget = Number(localStorage.getItem(AD_TARGET_KEY)) || 0;
  } catch {
    adCount = 0;
    adTarget = 0;
  }
  if (!adTarget) {
    adTarget = randomAdTarget();
  }
}

function saveAdState() {
  try {
    localStorage.setItem(AD_COUNT_KEY, String(adCount));
    localStorage.setItem(AD_TARGET_KEY, String(adTarget));
  } catch {}
}

function showAdIntermission() {
  if (!adOverlayEl) return;
  adShowing = true;
  adOverlayEl.classList.remove("is-hidden");
  adOverlayEl.setAttribute("aria-hidden", "false");
  viewerEl.src = "about:blank";
  urlEl.textContent = "Advertisement";
  urlEl.href = "#";
  metaEl.textContent = "Press Go to continue.";
  loadingEl.classList.add("is-hidden");
  throbberEl.classList.add("is-hidden");
  setStopState(false);
  startAdCountdown();
  if (window.adsbygoogle && Array.isArray(window.adsbygoogle)) {
    try {
      window.adsbygoogle.push({});
    } catch {}
  }
}

function hideAdIntermission() {
  if (!adOverlayEl) return;
  adShowing = false;
  stopAdCountdown();
  adOverlayEl.classList.add("is-hidden");
  adOverlayEl.setAttribute("aria-hidden", "true");
}

function startAdCountdown() {
  if (!getButton) return;
  stopAdCountdown();
  adGoLabel = adGoLabel || getButton.textContent;
  adCountdownRemaining = 5;
  getButton.disabled = true;
  getButton.classList.add("is-disabled");
  updateGoCountdownLabel();
  adCountdownTimer = window.setInterval(() => {
    adCountdownRemaining -= 1;
    if (adCountdownRemaining <= 0) {
      stopAdCountdown();
      return;
    }
    updateGoCountdownLabel();
  }, 1000);
}

function stopAdCountdown() {
  if (!getButton) return;
  if (adCountdownTimer) {
    window.clearInterval(adCountdownTimer);
    adCountdownTimer = null;
  }
  adCountdownRemaining = 0;
  getButton.textContent = adGoLabel || "Go";
  getButton.disabled = false;
  getButton.classList.remove("is-disabled");
}

function updateGoCountdownLabel() {
  if (!getButton) return;
  getButton.textContent = `${adGoLabel || "Go"} (${adCountdownRemaining})`;
}

function maybeShowAd() {
  if (!ADS_ENABLED) return false;
  if (!adOverlayEl) return false;
  if (adShowing) {
    hideAdIntermission();
    return false;
  }
  if (adCount >= adTarget) {
    showAdIntermission();
    adCount = 0;
    adTarget = randomAdTarget();
    saveAdState();
    return true;
  }
  return false;
}

function recordLandingForAds() {
  if (!ADS_ENABLED) return;
  adCount += 1;
  saveAdState();
}

function normalizeRandomEntry(data) {
  return {
    url: data && data.url ? data.url : "",
    crawl: data && data.crawl ? data.crawl : "",
    at: data && data.at ? data.at : "",
  };
}

async function prefetchRandom() {
  if (prefetchPromise || prefetchedEntry) return;
  prefetchPromise = fetch("/api/random", { method: "GET" })
    .then((res) => {
      if (!res.ok) throw new Error("Prefetch failed");
      return res.json();
    })
    .then((data) => {
      prefetchedEntry = normalizeRandomEntry(data);
    })
    .catch(() => {
      prefetchedEntry = null;
    })
    .finally(() => {
      prefetchPromise = null;
    });
}

async function loadRandom() {
  if (maybeShowAd()) return;
  if (adShowing) hideAdIntermission();
  getButton.disabled = true;
  urlEl.textContent = "Loading...";
  urlEl.href = "#";
  metaEl.textContent = "";
  viewerEl.src = "about:blank";
  setStopState(true);
  loadingEl.classList.add("is-hidden");
  throbberEl.classList.remove("is-hidden");

  try {
    let entry = prefetchedEntry;
    prefetchedEntry = null;
    if (!entry || !entry.url) {
      fetchController = new AbortController();
      const res = await fetch("/api/random", {
        method: "GET",
        signal: fetchController.signal,
      });
      if (!res.ok) {
        throw new Error("Request failed");
      }
      const data = await res.json();
      entry = normalizeRandomEntry(data);
    }
    applyEntry(entry);
    if (entry.url) pushHistory(entry);
    if (entry.url) logVisit(entry.url);
    if (entry.url) recordLandingForAds();
    prefetchRandom();
  } catch (err) {
    currentUrl = "";
    urlEl.textContent = "Error loading a URL.";
    urlEl.href = "#";
    metaEl.textContent = "Please try again.";
    throbberEl.classList.add("is-hidden");
    if (!hasStarted) loadingEl.classList.remove("is-hidden");
    setStopState(false);
  } finally {
    getButton.disabled = false;
    fetchController = null;
  }
}

if (favoriteToggleButton) {
  favoriteToggleButton.addEventListener("click", () => {
    toggleFavorite();
  });
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
  setStopState(false);
});

refreshButton.addEventListener("click", () => {
  if (!currentUrl) return;
  viewerEl.src = "about:blank";
  setTimeout(() => {
    viewerEl.src = currentUrl;
  }, 60);
});

loadHistory();
loadAdState();
updateBackButton();
updateForwardButton();
prefetchRandom();

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
  setStopState(false);
});
