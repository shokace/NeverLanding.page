const achievementsGrid = document.getElementById("achievements-grid");
const achievementDetailModal = document.getElementById("achievement-detail-modal");
const achievementDetailText = document.getElementById("achievement-detail-text");
const achievementDetailClose = achievementDetailModal
  ? achievementDetailModal.querySelector(".modal-close")
  : null;
let achievementData = [];
let unlockedCodes = new Set();

function buildAchievementTiles(total) {
  if (!achievementsGrid) return;
  const tiles = document.createDocumentFragment();
  for (let i = 0; i < total; i += 1) {
    const tile = document.createElement("div");
    tile.className = "achievement-tile";
    tile.dataset.index = String(i);
    const info = achievementData[i];
    if (info && info.icon) {
      const img = document.createElement("img");
      img.src = info.icon;
      img.alt = "";
      img.loading = "lazy";
      tile.appendChild(img);
    }
    tiles.appendChild(tile);
  }
  achievementsGrid.appendChild(tiles);
  applyUnlocks();
}

function applyUnlocks() {
  if (!achievementsGrid) return;
  const tiles = achievementsGrid.querySelectorAll(".achievement-tile");
  tiles.forEach((tile) => {
    const index = Number(tile.dataset.index || 0);
    const info = achievementData[index];
    const code = info && info.code ? info.code : "";
    if (code && unlockedCodes.has(code)) {
      tile.classList.add("is-unlocked");
    }
  });
}

function openDetailModal(text) {
  if (!achievementDetailModal || !achievementDetailText) return;
  achievementDetailText.textContent = text;
  achievementDetailModal.classList.remove("is-hidden");
}

function closeDetailModal() {
  if (!achievementDetailModal) return;
  achievementDetailModal.classList.add("is-hidden");
}

async function loadAchievements() {
  if (!achievementsGrid) return;
  try {
    const res = await fetch("/data/achievements.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load achievements");
    const data = await res.json();
    achievementData = Array.isArray(data.achievements) ? data.achievements : [];
    const total = Number(data.slots) || 0;
    if (!total) return;
    buildAchievementTiles(total);
  } catch {
    buildAchievementTiles(295);
  }
}

loadAchievements();
refreshUnlocked();

async function refreshUnlocked() {
  try {
    const res = await fetch("/api/achievements/unlocked");
    if (!res.ok) return;
    const data = await res.json();
    unlockedCodes = new Set(Array.isArray(data.codes) ? data.codes : []);
    applyUnlocks();
  } catch {}
}

document.addEventListener("auth-changed", (event) => {
  if (!event.detail || !event.detail.user) return;
  refreshUnlocked();
});

if (achievementsGrid) {
  achievementsGrid.addEventListener("click", (event) => {
    const tile = event.target.closest(".achievement-tile");
    if (!tile) return;
    const index = Number(tile.dataset.index || 0);
    const info = achievementData[index];
    const text = info && info.description ? info.description : "Achievement details coming soon.";
    openDetailModal(text);
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
