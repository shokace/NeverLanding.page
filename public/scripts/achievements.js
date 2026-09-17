const achievementsGrid = document.getElementById("achievements-grid");
const achievementsPanel = document.getElementById("achievements-modal");
const celebratingTiles = new Set();
const viewedThisSession = new Set();
let revealPendingUnlock = false;
const visibleTiles = new IntersectionObserver(() => celebrateVisibleUnlocks(), {
  root: achievementsGrid?.parentElement, threshold: 0.6,
});
const achievementDetailModal = document.getElementById("achievement-detail-modal");
const achievementDetailText = document.getElementById("achievement-detail-text");
const achievementDetailTitle = document.getElementById("achievement-detail-title");
const achievementDetailClose = achievementDetailModal
  ? achievementDetailModal.querySelector(".modal-close")
  : null;
const achievementsMenuButton = document.getElementById("achievements-menu");
let achievementData = [];
let unlockedCodes = new Set();
let unlockedDetails = new Map();
let seenCodes = new Set();
let currentUserId = null;
const ACHIEVEMENTS_SEEN_KEY = "neverlanding-achievements-seen";

function buildAchievementTiles(total) {
  if (!achievementsGrid) return;
  const tiles = document.createDocumentFragment();
  for (let i = 0; i < total; i += 1) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "achievement-tile";
    tile.dataset.index = String(i);
    const info = achievementData[i];
    tile.setAttribute("aria-label", info?.title || "Achievement");
    tile.title = info?.title || "Achievement";
    tile.classList.toggle("is-unavailable", info?.available === false);
    if (info && info.icon) {
      const img = document.createElement("img");
      img.src = info.icon;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("load", () => requestAnimationFrame(celebrateVisibleUnlocks), {once:true});
      tile.appendChild(img);
    }
    tiles.appendChild(tile);
  }
  stopCelebrations();
  visibleTiles.disconnect();
  achievementsGrid.replaceChildren(tiles);
  achievementsGrid.querySelectorAll(".achievement-tile").forEach(tile => visibleTiles.observe(tile));
  applyUnlocks();
}

function applyUnlocks() {
  if (!achievementsGrid) return;
  const tiles = achievementsGrid.querySelectorAll(".achievement-tile");
  tiles.forEach((tile) => {
    const index = Number(tile.dataset.index || 0);
    const info = achievementData[index];
    const code = info && info.code ? info.code : "";
    tile.classList.toggle("is-unlocked", Boolean(code && unlockedCodes.has(code)));
  });
  applyNotificationBadges();
}

function getSeenKey(userId) {
  return userId ? `${ACHIEVEMENTS_SEEN_KEY}:${userId}` : ACHIEVEMENTS_SEEN_KEY;
}

function loadSeenCodes(userId) {
  try {
    const raw = localStorage.getItem(getSeenKey(userId));
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((code) => String(code)));
  } catch {
    return new Set();
  }
}

function saveSeenCodes() {
  try {
    const list = Array.from(seenCodes);
    localStorage.setItem(getSeenKey(currentUserId), JSON.stringify(list));
  } catch {}
}

function applyNotificationBadges() {
  const unseen = new Set();
  const displayedCodes = new Set(achievementData.map(info => info.code));
  unlockedCodes.forEach((code) => {
    if (displayedCodes.has(code) && !seenCodes.has(code)) unseen.add(code);
  });

  if (achievementsGrid) {
    const tiles = achievementsGrid.querySelectorAll(".achievement-tile");
    tiles.forEach((tile) => {
      const index = Number(tile.dataset.index || 0);
      const info = achievementData[index];
      const code = info && info.code ? info.code : "";
      tile.classList.toggle("is-new", Boolean(code && unseen.has(code)));
    });
  }

  if (achievementsMenuButton) {
    achievementsMenuButton.classList.toggle("has-badge", unseen.size > 0);
  }
  requestAnimationFrame(celebrateVisibleUnlocks);
}

function stopCelebrations() {
  for (const tile of celebratingTiles) {
    tile.classList.remove("is-celebrating");
    tile.querySelectorAll(".achievement-sparkle").forEach(sparkle => sparkle.remove());
  }
  celebratingTiles.clear();
}

function celebrateVisibleUnlocks() {
  if (!currentUserId || document.hidden || achievementsPanel.classList.contains("is-hidden") ||
      !achievementDetailModal.classList.contains("is-hidden")) return;
  const fresh = [...achievementsGrid.querySelectorAll(".achievement-tile.is-new")];
  if (revealPendingUnlock && fresh.length) {
    fresh[0].scrollIntoView({block:"center", behavior:"instant"});
    revealPendingUnlock = false;
  }
  const viewport = achievementsGrid.parentElement.getBoundingClientRect();
  // Merge persisted state so another tab cannot restart a celebration we saw.
  seenCodes = new Set([...seenCodes, ...loadSeenCodes(currentUserId)]);
  for (const tile of fresh) {
    const box = tile.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top));
    const visibleWidth = Math.max(0, Math.min(box.right, viewport.right) - Math.max(box.left, viewport.left));
    const icon = tile.querySelector("img");
    if (!box.height || !box.width || visibleHeight * visibleWidth / (box.height * box.width) < 0.6 ||
        (icon && (!icon.complete || !icon.naturalWidth))) continue;
    const code = achievementData[Number(tile.dataset.index)]?.code;
    if (!code || !unlockedCodes.has(code) || seenCodes.has(code)) continue;
    // Seeing a tile qualifies it for acknowledgement when this panel closes.
    viewedThisSession.add(code);
    if (celebratingTiles.has(tile) || matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
    tile.classList.add("is-celebrating");
    for (let i = 0; i < 6; i++) {
      const sparkle = document.createElement("span");
      sparkle.className = "achievement-sparkle";
      sparkle.setAttribute("aria-hidden", "true");
      sparkle.style.setProperty("--sparkle-index", i);
      tile.appendChild(sparkle);
    }
    celebratingTiles.add(tile);
  }
}

function finishViewingSession() {
  if (currentUserId && viewedThisSession.size) {
    seenCodes = new Set([...seenCodes, ...loadSeenCodes(currentUserId), ...viewedThisSession]);
    saveSeenCodes();
  }
  viewedThisSession.clear();
  revealPendingUnlock = false;
  stopCelebrations();
  applyNotificationBadges();
}

document.addEventListener("achievements-opened", () => {
  revealPendingUnlock = true;
  requestAnimationFrame(celebrateVisibleUnlocks);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) celebrateVisibleUnlocks();
});
window.addEventListener("pagehide", finishViewingSession);
window.addEventListener("storage", event => {
  if (event.key === getSeenKey(currentUserId)) {
    seenCodes = new Set([...seenCodes, ...loadSeenCodes(currentUserId)]);
    applyNotificationBadges();
  }
});

function openDetailModal(title, text, code) {
  if (!achievementDetailModal || !achievementDetailText) return;
  if (achievementDetailTitle) {
    achievementDetailTitle.textContent = title || "Achievement";
  }
  achievementDetailText.textContent = text;
  const details = unlockedDetails.get(code);
  if (unlockedCodes.has(code) && details?.url) {
    try {
      const url = new URL(details.url);
      if (url.protocol === "https:" && !url.username && !url.password) {
        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = url.hostname;
        link.className = "achievement-source";
        achievementDetailText.append(document.createElement("br"), document.createElement("br"), "Unlocked on: ", link);
      }
    } catch {}
  }
  achievementDetailModal.classList.remove("is-hidden");
}

function closeDetailModal() {
  if (!achievementDetailModal) return;
  achievementDetailModal.classList.add("is-hidden");
  requestAnimationFrame(celebrateVisibleUnlocks);
}

async function loadAchievements() {
  if (!achievementsGrid) return;
  try {
    const res = await fetch("/data/achievements.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load achievements");
    const data = await res.json();
    achievementData = Array.isArray(data.achievements) ? data.achievements : [];
    const total = achievementData.length;
    if (!total) return;
    buildAchievementTiles(total);
  } catch {
    achievementsGrid.textContent = "Achievements could not load. Reopen this panel to try again.";
  }
}

loadAchievements();

let unlockRequest = 0;
async function refreshUnlocked() {
  const version = ++unlockRequest;
  const userId = currentUserId;
  if (!userId) return;
  try {
    const res = await fetch("/api/achievements/unlocked");
    if (!res.ok) return;
    const data = await res.json();
    if (version !== unlockRequest || userId !== currentUserId) return;
    unlockedCodes = new Set(Array.isArray(data.codes) ? data.codes : []);
    unlockedDetails = new Map((Array.isArray(data.items) ? data.items : []).map(item => [item.code, item]));
    applyUnlocks();
  } catch {}
}

document.addEventListener("auth-changed", (event) => {
  if ((event.detail?.user?.id || null) !== currentUserId) finishViewingSession();
  if (!event.detail || !event.detail.user) {
    currentUserId = null;
    unlockedCodes = new Set();
    unlockedDetails = new Map();
    seenCodes = loadSeenCodes(null);
    applyUnlocks();
    return;
  }
  unlockedCodes = new Set();
  unlockedDetails = new Map();
  currentUserId = event.detail.user.id || null;
  seenCodes = loadSeenCodes(currentUserId);
  applyUnlocks();
  refreshUnlocked();
});

document.addEventListener("achievements-changed", () => {
  refreshUnlocked();
});

document.addEventListener("achievements-viewed", finishViewingSession);

if (achievementsGrid) {
  achievementsGrid.addEventListener("click", (event) => {
    const tile = event.target.closest(".achievement-tile");
    if (!tile) return;
    const index = Number(tile.dataset.index || 0);
    const info = achievementData[index];
    const title = info && info.title ? `${info.title} Achievement` : "Achievement";
    const code = info && info.code ? info.code : "";
    let text = info && info.description ? info.description : "Visit the web to unlock this achievement.";
    if (unlockedCodes.has(code)) text = info.unlockedDescription || `Unlocked! ${text}`;
    openDetailModal(title, text, code);
  });
}

if (achievementDetailModal) {
  achievementDetailModal.addEventListener("click", (event) => {
    if (event.target === achievementDetailModal) closeDetailModal();
  });
}

if (achievementDetailClose) {
  achievementDetailClose.addEventListener("click", closeDetailModal);
}

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    achievementDetailModal &&
    !achievementDetailModal.classList.contains("is-hidden")
  ) {
    closeDetailModal();
  }
});

if (achievementsMenuButton) achievementsMenuButton.addEventListener("click", () => {
  if (!achievementData.length) loadAchievements();
  refreshUnlocked();
});
