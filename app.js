import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, get, runTransaction } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const grid = document.getElementById("pedalosGrid");
const syncStatus = document.getElementById("syncStatus");
const searchInput = document.getElementById("searchInput");

const counts = {
  available: document.getElementById("availableCount"),
  running: document.getElementById("runningCount"),
  late: document.getElementById("lateCount"),
  broken: document.getElementById("brokenCount"),
  dailyRentals: document.getElementById("dailyRentalsCount")
};

let pedalos = {};
let dailyStats = { date: todayKey(), rentals: 0 };
let renderTimer = null;

function todayKey() {
  return new Date().toLocaleDateString("fr-CA");
}

function buildInitialPedalos() {
  const data = {};
  for (let i = 1; i <= PEDALO_COUNT; i++) {
    data[i] = { number: i, color: "blanc", status: "available", startTime: null, endTime: null, warning: false };
  }
  return data;
}

async function initDatabaseIfEmpty() {
  const snapshot = await get(ref(db, "pedalos"));
  if (!snapshot.exists()) await set(ref(db, "pedalos"), buildInitialPedalos());
}

async function migrateMissingFields() {
  const snapshot = await get(ref(db, "pedalos"));
  const data = snapshot.val() || {};
  const updates = {};
  Object.keys(data).forEach((id) => {
    if (data[id].endTime === undefined) updates[`pedalos/${id}/endTime`] = null;
    if (data[id].warning === undefined) updates[`pedalos/${id}/warning`] = false;
  });
  if (Object.keys(updates).length) await update(ref(db), updates);
}

async function resetDailyIfNeeded() {
  const today = todayKey();
  const statsSnapshot = await get(ref(db, "dailyStats"));
  const stats = statsSnapshot.val();

  if (stats && stats.date === today) return;

  const pedalosSnapshot = await get(ref(db, "pedalos"));
  const data = pedalosSnapshot.val() || {};
  const updates = {};

  Object.keys(data).forEach((id) => {
    if (data[id].status !== "broken") {
      updates[`pedalos/${id}/status`] = "available";
      updates[`pedalos/${id}/startTime`] = null;
      updates[`pedalos/${id}/endTime`] = null;
      updates[`pedalos/${id}/warning`] = false;
    }
  });

  updates["dailyStats"] = { date: today, rentals: 0 };
  await update(ref(db), updates);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function getComputedStatus(pedalo) {
  if (pedalo.status !== "running" || !pedalo.endTime) return pedalo.status;
  return Date.now() >= pedalo.endTime ? "late" : "running";
}

function getTimerText(pedalo, status) {
  if (!pedalo.endTime) return "";
  const diff = pedalo.endTime - Date.now();
  if (status === "late") return `+${formatDuration(diff)}`;
  if (status === "running") return formatDuration(diff);
  return "";
}

function statusLabel(status) {
  return { available: "Disponible", running: "En navigation", late: "En retard", broken: "Cassé" }[status] || status;
}

function sortPedalos(list) {
  const order = { available: 1, late: 2, running: 3, broken: 4 };

  return list.sort((a, b) => {
    const statusA = getComputedStatus(a);
    const statusB = getComputedStatus(b);

    if (order[statusA] !== order[statusB]) return order[statusA] - order[statusB];

    if (statusA === "late") {
      const lateA = Date.now() - (a.endTime || 0);
      const lateB = Date.now() - (b.endTime || 0);
      if (lateA !== lateB) return lateB - lateA;
    }

    if (statusA === "running") {
      const endA = a.endTime || Infinity;
      const endB = b.endTime || Infinity;
      if (endA !== endB) return endA - endB;
    }

    return Number(a.number) - Number(b.number);
  });
}

function normalizedPedalo(pedalo) {
  return {
    number: pedalo.number,
    color: pedalo.color || "blanc",
    status: pedalo.status || "available",
    startTime: pedalo.startTime || null,
    endTime: pedalo.endTime || null,
    warning: !!pedalo.warning
  };
}

function render() {
  const query = searchInput.value.trim();
  let list = Object.values(pedalos).map(normalizedPedalo);

  if (query) list = list.filter((pedalo) => String(pedalo.number).includes(query));

  list = sortPedalos(list);
  grid.innerHTML = "";

  for (const pedalo of list) {
    const status = getComputedStatus(pedalo);
    const timerText = getTimerText(pedalo, status);
    const startText = pedalo.startTime ? `Départ ${formatClock(pedalo.startTime)}` : "";
    const returnText = pedalo.endTime ? `Retour ${formatClock(pedalo.endTime)}` : "";

    const card = document.createElement("article");
    card.className = `card ${status} ${pedalo.warning ? "warning-active" : ""}`;

    let actions = "";
    if (status === "available") {
      actions = `
        <button class="primary" data-action="start" data-id="${pedalo.number}">DÉPART</button>
        <button class="warning-btn" data-action="warning" data-id="${pedalo.number}">${pedalo.warning ? "✅ Baignade OK" : "⚠️ Risque baignade"}</button>
      `;
    }

    if (status === "running" || status === "late") {
      actions = `
        <button class="extend-btn" data-action="extend" data-id="${pedalo.number}">+35 MIN</button>
        <button class="warning-btn" data-action="warning" data-id="${pedalo.number}">${pedalo.warning ? "✅ Baignade OK" : "⚠️ Risque baignade"}</button>
        <button class="primary" data-action="finish" data-id="${pedalo.number}">ARRIVÉE</button>
      `;
    }

    if (status === "broken") {
      actions = `<button class="primary" data-action="repair" data-id="${pedalo.number}">RÉPARER</button>`;
    }

    const breakButton = status === "available" ? `<button class="break-icon" data-action="break" data-id="${pedalo.number}">CASSER</button>` : "";

    card.innerHTML = `
      ${breakButton}
      ${pedalo.warning ? `<div class="card-warning">⚠️ RISQUE DE BAIGNADE</div>` : ""}
      <div class="card-header">
        <div class="number">${pedalo.number}</div>
        <div class="color-label">${pedalo.color}</div>
      </div>
      <div>
        <div class="status">${statusLabel(status)}</div>
        <div class="timer">${timerText || "—"}</div>
        <div class="start-time">${startText}</div>
        <div class="start-time">${returnText}</div>
      </div>
      <div class="actions">${actions}</div>
    `;

    grid.appendChild(card);
  }

  const globalStats = { available: 0, running: 0, late: 0, broken: 0 };
  Object.values(pedalos).map(normalizedPedalo).forEach((pedalo) => globalStats[getComputedStatus(pedalo)]++);

  counts.available.textContent = globalStats.available;
  counts.running.textContent = globalStats.running;
  counts.late.textContent = globalStats.late;
  counts.broken.textContent = globalStats.broken;
  counts.dailyRentals.textContent = dailyStats.rentals || 0;
}

async function startPedalo(id) {
  const now = Date.now();
  await update(ref(db), {
    [`pedalos/${id}/status`]: "running",
    [`pedalos/${id}/startTime`]: now,
    [`pedalos/${id}/endTime`]: now + RENTAL_DURATION_MS,
    [`pedalos/${id}/warning`]: false
  });
  await runTransaction(ref(db, "dailyStats/rentals"), (current) => (current || 0) + 1);
}

async function finishPedalo(id) {
  await update(ref(db, `pedalos/${id}`), { status: "available", startTime: null, endTime: null, warning: false });
}

async function extendPedalo(id) {
  const snapshot = await get(ref(db, `pedalos/${id}`));
  const pedalo = snapshot.val();
  if (!pedalo) return;

  const baseTime = Math.max(Date.now(), pedalo.endTime || Date.now());
  await update(ref(db, `pedalos/${id}`), { status: "running", endTime: baseTime + RENTAL_DURATION_MS });
  await runTransaction(ref(db, "dailyStats/rentals"), (current) => (current || 0) + 1);
}

async function breakPedalo(id) {
  await update(ref(db, `pedalos/${id}`), { status: "broken", startTime: null, endTime: null, warning: false });
}

async function repairPedalo(id) {
  await update(ref(db, `pedalos/${id}`), { status: "available", startTime: null, endTime: null, warning: false });
}

async function toggleWarning(id) {
  await runTransaction(ref(db, `pedalos/${id}/warning`), (current) => !current);
}

grid.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  button.disabled = true;

  try {
    if (action === "start") await startPedalo(id);
    if (action === "finish") await finishPedalo(id);
    if (action === "extend") await extendPedalo(id);
    if (action === "repair") await repairPedalo(id);
    if (action === "warning") await toggleWarning(id);

    if (action === "break") {
      const ok = confirm(`Marquer le pédalo ${id} comme cassé ?`);
      if (ok) await breakPedalo(id);
    }
  } catch (error) {
    alert("Erreur de synchronisation. Vérifie la connexion.");
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

searchInput.addEventListener("input", render);

function listenRealtime() {
  onValue(ref(db, "pedalos"), (snapshot) => {
    pedalos = snapshot.val() || {};
    syncStatus.textContent = "Synchronisé";
    render();

    if (!renderTimer) renderTimer = setInterval(render, 1000);
  }, (error) => {
    syncStatus.textContent = "Erreur de connexion";
    console.error(error);
  });

  onValue(ref(db, "dailyStats"), (snapshot) => {
    dailyStats = snapshot.val() || { date: todayKey(), rentals: 0 };
    render();
  });
}

window.addEventListener("online", () => syncStatus.textContent = "Synchronisé");
window.addEventListener("offline", () => syncStatus.textContent = "Hors connexion");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");

await initDatabaseIfEmpty();
await migrateMissingFields();
await resetDailyIfNeeded();
listenRealtime();
