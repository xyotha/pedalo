import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  onDisconnect,
  serverTimestamp
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

const RENTAL_DURATION_SECONDS = 30 * 60;
const PEDALO_COUNT = 19;

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const grid = document.getElementById("pedalosGrid");
const syncStatus = document.getElementById("syncStatus");

const counts = {
  available: document.getElementById("availableCount"),
  running: document.getElementById("runningCount"),
  late: document.getElementById("lateCount"),
  broken: document.getElementById("brokenCount")
};

let pedalos = {};
let renderTimer = null;

function buildInitialPedalos() {
  const colors = {
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

  const data = {};

  for (let i = 1; i <= PEDALO_COUNT; i++) {
    data[i] = {
      number: i,
      color: colors[i],
      status: "available",
      startTime: null,
      endTime: null,
      warning: false
    };
  }

  return data;
}
function initDatabaseIfEmpty() {
  const pedalosRef = ref(db, "pedalos");
  onValue(pedalosRef, (snapshot) => {
    if (!snapshot.exists()) {
      set(pedalosRef, buildInitialPedalos());
    }
  }, { onlyOnce: true });
}

function formatDuration(totalSeconds) {
  const abs = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getComputedStatus(pedalo) {
  if (pedalo.status !== "running" || !pedalo.startTime) {
    return pedalo.status;
  }

  const elapsed = Math.floor((Date.now() - pedalo.startTime) / 1000);
  return elapsed >= RENTAL_DURATION_SECONDS ? "late" : "running";
}

function getTimerText(pedalo, status) {
  if (!pedalo.startTime) return "";

  const elapsed = Math.floor((Date.now() - pedalo.startTime) / 1000);
  const remaining = RENTAL_DURATION_SECONDS - elapsed;

  if (status === "late") {
    return `+${formatDuration(Math.abs(remaining))}`;
  }

  if (status === "running") {
    return formatDuration(remaining);
  }

  return "";
}

function statusLabel(status) {
  const labels = {
    available: "Disponible",
    running: "En navigation",
    late: "En retard",
    broken: "Cassé"
  };
  return labels[status] || status;
}

function sortPedalos(list) {
  const order = {
    available: 1,
    late: 2,
    running: 3,
    broken: 4
  };

  return list.sort((a, b) => {
    const statusA = getComputedStatus(a);
    const statusB = getComputedStatus(b);

    if (order[statusA] !== order[statusB]) {
      return order[statusA] - order[statusB];
    }

    return Number(a.number) - Number(b.number);
  });
}

function render() {
  const list = sortPedalos(Object.values(pedalos));

  const stats = {
    available: 0,
    running: 0,
    late: 0,
    broken: 0
  };

  grid.innerHTML = "";

  for (const pedalo of list) {
    const status = getComputedStatus(pedalo);
    stats[status]++;

    const timerText = getTimerText(pedalo, status);
    const startText = pedalo.startTime ? `Départ ${formatClock(pedalo.startTime)}` : "";

    const card = document.createElement("article");
    card.className = `card ${status}`;

    let actions = "";

    if (status === "available") {
      actions = `
        <button class="primary" data-action="start" data-id="${pedalo.number}">DÉPART</button>
        <button class="secondary" data-action="break" data-id="${pedalo.number}">CASSER</button>
      `;
    } else if (status === "running" || status === "late") {
      actions = `
        <button class="primary" data-action="finish" data-id="${pedalo.number}">ARRIVÉE</button>
      `;
    } else if (status === "broken") {
      actions = `
        <button class="primary" data-action="repair" data-id="${pedalo.number}">RÉPARER</button>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="number">${pedalo.number}</div>
        <div class="color-label">${pedalo.color || "blanc"}</div>
      </div>

      <div>
        <div class="status">${statusLabel(status)}</div>
        <div class="timer">${timerText || "—"}</div>
        <div class="start-time">${startText}</div>
      </div>

      <div class="actions">${actions}</div>
    `;

    grid.appendChild(card);
  }

  counts.available.textContent = stats.available;
  counts.running.textContent = stats.running;
  counts.late.textContent = stats.late;
  counts.broken.textContent = stats.broken;
}

async function startPedalo(id) {
  await update(ref(db, `pedalos/${id}`), {
    status: "running",
    startTime: Date.now()
  });
}

async function finishPedalo(id) {
  await update(ref(db, `pedalos/${id}`), {
    status: "available",
    startTime: null
  });
}

async function breakPedalo(id) {
  await update(ref(db, `pedalos/${id}`), {
    status: "broken",
    startTime: null
  });
}

async function repairPedalo(id) {
  await update(ref(db, `pedalos/${id}`), {
    status: "available",
    startTime: null
  });
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
    if (action === "break") await breakPedalo(id);
    if (action === "repair") await repairPedalo(id);
  } catch (error) {
    alert("Erreur de synchronisation. Vérifie la connexion.");
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

function listenRealtime() {
  const pedalosRef = ref(db, "pedalos");

  onValue(pedalosRef, (snapshot) => {
    pedalos = snapshot.val() || {};
    syncStatus.textContent = "Synchronisé";
    render();

    if (!renderTimer) {
      renderTimer = setInterval(render, 1000);
    }
  }, (error) => {
    syncStatus.textContent = "Erreur de connexion";
    console.error(error);
  });
}

window.addEventListener("online", () => {
  syncStatus.textContent = "Synchronisé";
});

window.addEventListener("offline", () => {
  syncStatus.textContent = "Hors connexion";
});

let deferredPrompt;
const installBtn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}

initDatabaseIfEmpty();
listenRealtime();
