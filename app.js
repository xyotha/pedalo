import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
  runTransaction,
  set,
  update
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAgykT17hht0UGmaOOZwjVQe9r0w5UMWwc",
  authDomain: "pedalo-cb92a.firebaseapp.com",
  databaseURL: "https://pedalo-cb92a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pedalo-cb92a",
  storageBucket: "pedalo-cb92a.firebasestorage.app",
  messagingSenderId: "226893576022",
  appId: "1:226893576022:web:2a093e625124fb39bd48f7",
  measurementId: "G-HEQ8NW5K80"
};

const RENTAL_DURATION_MS = 35 * 60 * 1000;
const PEDALO_COUNT = 19;
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");

const BOAT_COLORS = {
  1: "gris",
  2: "jaune",
  3: "blanc",
  4: "blanc",
  5: "blanc",
  6: "blanc",
  7: "bleu",
  8: "bleu",
  9: "blanc",
  10: "vert",
  11: "blanc",
  12: "blanc",
  13: "vert",
  14: "vert",
  15: "blanc",
  16: "gris",
  17: "vert",
  18: "vert",
  19: "vert"
};

const TWO_SEAT_PEDALOS = new Set([1, 2, 15, 16, 17]);
const BOAT_CAPACITIES = Object.fromEntries(
  Array.from({ length: PEDALO_COUNT }, (_, index) => {
    const number = index + 1;
    return [number, TWO_SEAT_PEDALOS.has(number) ? 2 : 4];
  })
);

const COLOR_VALUES = {
  blanc: "#ffffff",
  bleu: "#2689d8",
  gris: "#99a4ac",
  jaune: "#f3c746",
  vert: "#39a66f"
};

const grid = document.getElementById("pedalosGrid");
const syncStatus = document.getElementById("syncStatus");
const searchInput = document.getElementById("searchInput");
const filterButton = document.getElementById("filterButton");
const filterMenu = document.getElementById("filterMenu");
const emptyState = document.getElementById("emptyState");
const demoBanner = document.getElementById("demoBanner");
const toast = document.getElementById("toast");
const confirmDialog = document.getElementById("confirmDialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogText = document.getElementById("dialogText");

const counts = {
  available: document.getElementById("availableCount"),
  running: document.getElementById("runningCount"),
  late: document.getElementById("lateCount"),
  broken: document.getElementById("brokenCount"),
  dailyRentals: document.getElementById("dailyRentalsCount")
};

let db;
let pedalos = {};
let dailyStats = { date: todayKey(), rentals: 0 };
let currentFilter = "all";
let toastTimer;

function todayKey() {
  return new Date().toLocaleDateString("fr-CA");
}

function buildInitialPedalos() {
  const data = {};
  for (let i = 1; i <= PEDALO_COUNT; i += 1) {
    data[i] = {
      number: i,
      color: BOAT_COLORS[i],
      capacity: BOAT_CAPACITIES[i] || null,
      status: "available",
      startTime: null,
      endTime: null,
      warning: false
    };
  }
  return data;
}

function buildDemoPedalos() {
  const data = buildInitialPedalos();
  const now = Date.now();
  Object.assign(data[2], { status: "running", startTime: now - 11 * 60 * 1000, endTime: now + 24 * 60 * 1000 });
  Object.assign(data[7], { status: "running", startTime: now - 29 * 60 * 1000, endTime: now + 6 * 60 * 1000, warning: true });
  Object.assign(data[10], { status: "running", startTime: now - 42 * 60 * 1000, endTime: now - 7 * 60 * 1000 });
  Object.assign(data[16], { status: "broken" });
  return data;
}

function normalizePedalo(pedalo, id) {
  const number = Number(pedalo.number || id);
  return {
    number,
    color: BOAT_COLORS[number] || pedalo.color || "blanc",
    capacity: pedalo.capacity || BOAT_CAPACITIES[number] || null,
    status: pedalo.status || "available",
    startTime: pedalo.startTime || null,
    endTime: pedalo.endTime || null,
    warning: Boolean(pedalo.warning)
  };
}

function getComputedStatus(pedalo) {
  if (pedalo.status !== "running" || !pedalo.endTime) return pedalo.status;
  return Date.now() >= pedalo.endTime ? "late" : "running";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getTimerText(pedalo, status) {
  if (status === "available") return "Prêt";
  if (status === "broken") return "—";
  if (!pedalo.endTime) return "—";
  const difference = pedalo.endTime - Date.now();
  return status === "late" ? `+${formatDuration(difference)}` : formatDuration(difference);
}

function statusLabel(status) {
  return {
    available: "Disponible",
    running: "En navigation",
    late: "En retard",
    broken: "Hors service"
  }[status] || status;
}

function scheduleText(pedalo, status) {
  if (status === "available") return "Disponible immédiatement";
  if (status === "broken") return "En attente de réparation";
  return `Départ ${formatClock(pedalo.startTime)} · Retour ${formatClock(pedalo.endTime)}`;
}

function sortPedalos(list) {
  const order = { late: 1, running: 2, available: 3, broken: 4 };
  return list.sort((a, b) => {
    const statusA = getComputedStatus(a);
    const statusB = getComputedStatus(b);
    if (order[statusA] !== order[statusB]) return order[statusA] - order[statusB];
    if (statusA === "late") return (a.endTime || 0) - (b.endTime || 0);
    if (statusA === "running") return (a.endTime || Infinity) - (b.endTime || Infinity);
    return a.number - b.number;
  });
}

function boatColorValue(color) {
  return COLOR_VALUES[String(color).toLowerCase()] || "#ffffff";
}

function cardActions(pedalo, status) {
  const id = pedalo.number;
  if (status === "available") {
    return `
      <div class="card-actions">
        <button class="button primary" data-action="start" data-id="${id}">DÉPART</button>
      </div>
      <div class="secondary-actions">
        <button class="${pedalo.warning ? "alert-action active" : "text-action"}" data-action="warning" data-id="${id}">
          ${pedalo.warning ? '<span aria-hidden="true">!</span> BAIGNADE SIGNALÉE' : "Alerte baignade"}
        </button>
        <button class="text-action" data-action="break" data-id="${id}">Signaler cassé</button>
      </div>
    `;
  }
  if (status === "running" || status === "late") {
    return `
      <div class="card-actions two">
        <button class="button extend" data-action="extend" data-id="${id}">+35 MIN</button>
        <button class="button ${status === "late" ? "danger" : "success"}" data-action="finish" data-id="${id}">ARRIVÉE</button>
      </div>
      <div class="secondary-actions">
        <button class="${pedalo.warning ? "alert-action active" : "text-action"}" data-action="warning" data-id="${id}">
          ${pedalo.warning ? '<span aria-hidden="true">!</span> BAIGNADE SIGNALÉE' : "Alerte baignade"}
        </button>
      </div>
    `;
  }
  return `
    <div class="card-actions">
      <button class="button ghost" data-action="repair" data-id="${id}">REMETTRE EN SERVICE</button>
    </div>
  `;
}

function cardTemplate(pedalo) {
  const status = getComputedStatus(pedalo);
  const capacity = pedalo.capacity || "—";
  return `
    <article class="card ${status} ${pedalo.warning ? "warning-active" : ""}"
      style="--boat-color: ${boatColorValue(pedalo.color)}">
      <div class="card-heading">
        <div class="pedalo-number"><small>N°</small>${String(pedalo.number).padStart(2, "0")}</div>
        <div class="capacity" title="Nombre de places">
          <span>${capacity} places</span>
        </div>
      </div>
      <div class="physical-color">
        <span class="color-dot"></span>
        <span>${pedalo.color}</span>
      </div>
      <div class="card-center">
        ${pedalo.warning ? '<div class="warning-label"><strong>!</strong> RISQUE DE BAIGNADE</div>' : ""}
        <div class="timer">${getTimerText(pedalo, status)}</div>
        <div class="status-label">${statusLabel(status)}</div>
        <div class="schedule">${scheduleText(pedalo, status)}</div>
      </div>
      <div>${cardActions(pedalo, status)}</div>
    </article>
  `;
}

function render() {
  const query = searchInput.value.trim();
  const all = Object.entries(pedalos).map(([id, pedalo]) => normalizePedalo(pedalo, id));
  const stats = { available: 0, running: 0, late: 0, broken: 0 };

  all.forEach((pedalo) => {
    stats[getComputedStatus(pedalo)] += 1;
  });

  counts.available.textContent = stats.available;
  counts.running.textContent = stats.running;
  counts.late.textContent = stats.late;
  counts.broken.textContent = stats.broken;
  counts.dailyRentals.textContent = dailyStats.rentals || 0;

  const filtered = sortPedalos(all.filter((pedalo) => {
    const matchesSearch = !query || String(pedalo.number).includes(query);
    const matchesFilter = currentFilter === "all" || getComputedStatus(pedalo) === currentFilter;
    return matchesSearch && matchesFilter;
  }));

  grid.innerHTML = filtered.map(cardTemplate).join("");
  emptyState.classList.toggle("hidden", filtered.length > 0);
}

function setSyncStatus(text, state = "") {
  syncStatus.className = `sync-pill ${state}`.trim();
  syncStatus.querySelector("span:last-child").textContent = text;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
}

function confirmAction(title, message) {
  dialogTitle.textContent = title;
  dialogText.textContent = message;
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "confirm"), { once: true });
  });
}

async function writeUpdates(updates) {
  if (DEMO_MODE) {
    Object.entries(updates).forEach(([path, value]) => {
      const parts = path.split("/");
      if (parts[0] === "pedalos") pedalos[parts[1]][parts[2]] = value;
    });
    render();
    return;
  }
  await update(ref(db), updates);
}

async function startPedalo(id) {
  const now = Date.now();
  await writeUpdates({
    [`pedalos/${id}/status`]: "running",
    [`pedalos/${id}/startTime`]: now,
    [`pedalos/${id}/endTime`]: now + RENTAL_DURATION_MS,
    [`pedalos/${id}/warning`]: false
  });
  if (DEMO_MODE) {
    dailyStats.rentals += 1;
    render();
  } else {
    await runTransaction(ref(db, "dailyStats/rentals"), (current) => (current || 0) + 1);
  }
  showToast(`Pédalo ${id} parti pour 35 minutes.`);
}

async function finishPedalo(id) {
  await writeUpdates({
    [`pedalos/${id}/status`]: "available",
    [`pedalos/${id}/startTime`]: null,
    [`pedalos/${id}/endTime`]: null,
    [`pedalos/${id}/warning`]: false
  });
  showToast(`Pédalo ${id} de nouveau disponible.`);
}

async function extendPedalo(id) {
  const pedalo = normalizePedalo(pedalos[id], id);
  const baseTime = Math.max(Date.now(), pedalo.endTime || Date.now());
  await writeUpdates({
    [`pedalos/${id}/status`]: "running",
    [`pedalos/${id}/endTime`]: baseTime + RENTAL_DURATION_MS
  });
  if (DEMO_MODE) {
    dailyStats.rentals += 1;
    render();
  } else {
    await runTransaction(ref(db, "dailyStats/rentals"), (current) => (current || 0) + 1);
  }
  showToast(`35 minutes ajoutées au pédalo ${id}.`);
}

async function toggleWarning(id) {
  const current = Boolean(pedalos[id]?.warning);
  await writeUpdates({ [`pedalos/${id}/warning`]: !current });
  showToast(current ? `Alerte retirée du pédalo ${id}.` : `Alerte ajoutée au pédalo ${id}.`);
}

async function breakPedalo(id) {
  const confirmed = await confirmAction(
    "Mettre ce pédalo hors service ?",
    `Le pédalo ${id} ne pourra plus être démarré tant qu’il n’aura pas été remis en service.`
  );
  if (!confirmed) return;
  await writeUpdates({
    [`pedalos/${id}/status`]: "broken",
    [`pedalos/${id}/startTime`]: null,
    [`pedalos/${id}/endTime`]: null,
    [`pedalos/${id}/warning`]: false
  });
  showToast(`Pédalo ${id} signalé hors service.`);
}

async function repairPedalo(id) {
  const confirmed = await confirmAction(
    "Remettre ce pédalo en service ?",
    `Le pédalo ${id} redeviendra immédiatement disponible.`
  );
  if (!confirmed) return;
  await writeUpdates({
    [`pedalos/${id}/status`]: "available",
    [`pedalos/${id}/startTime`]: null,
    [`pedalos/${id}/endTime`]: null,
    [`pedalos/${id}/warning`]: false
  });
  showToast(`Pédalo ${id} remis en service.`);
}

async function initializeProduction() {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);

  const pedalosRef = ref(db, "pedalos");
  const initialSnapshot = await get(pedalosRef);
  if (!initialSnapshot.exists()) {
    await set(pedalosRef, buildInitialPedalos());
  }

  const statsSnapshot = await get(ref(db, "dailyStats"));
  const storedStats = statsSnapshot.val();
  if (!storedStats || storedStats.date !== todayKey()) {
    const currentPedalos = (await get(pedalosRef)).val() || {};
    const dailyReset = {
      dailyStats: { date: todayKey(), rentals: 0 }
    };

    Object.entries(currentPedalos).forEach(([id, pedalo]) => {
      if (pedalo.status !== "broken") {
        dailyReset[`pedalos/${id}/status`] = "available";
        dailyReset[`pedalos/${id}/startTime`] = null;
        dailyReset[`pedalos/${id}/endTime`] = null;
        dailyReset[`pedalos/${id}/warning`] = false;
      }
    });

    await update(ref(db), dailyReset);
  }

  onValue(pedalosRef, (snapshot) => {
    pedalos = snapshot.val() || {};
    setSyncStatus("Synchronisé", "online");
    render();
  }, (error) => {
    console.error(error);
    setSyncStatus("Erreur Firebase", "offline");
  });

  onValue(ref(db, "dailyStats"), (snapshot) => {
    dailyStats = snapshot.val() || { date: todayKey(), rentals: 0 };
    render();
  });
}

async function initialize() {
  if (DEMO_MODE) {
    demoBanner.classList.remove("hidden");
    pedalos = buildDemoPedalos();
    dailyStats = { date: todayKey(), rentals: 27 };
    setSyncStatus("Mode démo", "online");
    render();
    return;
  }

  try {
    await initializeProduction();
  } catch (error) {
    console.error(error);
    setSyncStatus("Erreur Firebase", "offline");
  }
}

grid.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  button.disabled = true;

  try {
    if (action === "start") await startPedalo(id);
    if (action === "finish") await finishPedalo(id);
    if (action === "extend") await extendPedalo(id);
    if (action === "warning") await toggleWarning(id);
    if (action === "break") await breakPedalo(id);
    if (action === "repair") await repairPedalo(id);
  } catch (error) {
    console.error(error);
    showToast("La modification n’a pas pu être enregistrée.");
  } finally {
    button.disabled = false;
  }
});

searchInput.addEventListener("input", render);

filterButton.addEventListener("click", () => {
  const isOpen = !filterMenu.classList.contains("hidden");
  filterMenu.classList.toggle("hidden", isOpen);
  filterButton.setAttribute("aria-expanded", String(!isOpen));
});

filterMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  currentFilter = button.dataset.filter;
  filterButton.querySelector("span:first-child").textContent = button.textContent;
  filterMenu.classList.add("hidden");
  filterButton.setAttribute("aria-expanded", "false");
  render();
});

document.addEventListener("click", (event) => {
  if (!filterMenu.contains(event.target) && !filterButton.contains(event.target)) {
    filterMenu.classList.add("hidden");
    filterButton.setAttribute("aria-expanded", "false");
  }
});

window.addEventListener("online", () => setSyncStatus(DEMO_MODE ? "Mode démo" : "Synchronisé", "online"));
window.addEventListener("offline", () => setSyncStatus("Hors connexion", "offline"));
window.setInterval(render, 1000);

if ("serviceWorker" in navigator && !DEMO_MODE) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}

initialize();
