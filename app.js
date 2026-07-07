import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
    getDatabase,
    ref,
    onValue,
    set,
    update
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "A_REMPLACER",
    authDomain: "A_REMPLACER",
    databaseURL: "A_REMPLACER",
    projectId: "A_REMPLACER",
    storageBucket: "A_REMPLACER",
    messagingSenderId: "A_REMPLACER",
    appId: "A_REMPLACER"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const pedaloContainer = document.getElementById("pedalos");

function initPedalos() {

    const pedaloRef = ref(db, "pedalos");

    onValue(pedaloRef, snapshot => {

        if (!snapshot.exists()) {

            const data = {};

            for (let i = 1; i <= 19; i++) {
                data[i] = {
                    number: i,
                    color: "white",
                    status: "available",
                    startTime: null
                };
            }

            set(pedaloRef, data);
        }
    });
}

function formatTime(seconds) {

    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    return `${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

function startPedalo(id) {

    update(ref(db, `pedalos/${id}`), {
        status: "running",
        startTime: Date.now()
    });
}

function finishPedalo(id) {

    update(ref(db, `pedalos/${id}`), {
        status: "available",
        startTime: null
    });
}

function breakPedalo(id) {

    update(ref(db, `pedalos/${id}`), {
        status: "broken",
        startTime: null
    });
}

function repairPedalo(id) {

    update(ref(db, `pedalos/${id}`), {
        status: "available",
        startTime: null
    });
}

function render(data) {

    const list = Object.values(data);

    const order = {
        available: 1,
        late: 2,
        running: 3,
        broken: 4
    };

    list.sort((a, b) => order[a.status] - order[b.status]);

    let available = 0;
    let running = 0;
    let late = 0;
    let broken = 0;

    pedaloContainer.innerHTML = "";

    list.forEach(pedalo => {

        let currentStatus = pedalo.status;
        let timerText = "";

        if (pedalo.status === "running" && pedalo.startTime) {

            const elapsed = Math.floor(
                (Date.now() - pedalo.startTime) / 1000
            );

            const remaining = 1800 - elapsed;

            if (remaining <= 0) {
                currentStatus = "late";
                timerText = "+" + formatTime(Math.abs(remaining));
            } else {
                timerText = formatTime(remaining);
            }
        }

        if (currentStatus === "available") available++;
        if (currentStatus === "running") running++;
        if (currentStatus === "late") late++;
        if (currentStatus === "broken") broken++;

        const card = document.createElement("div");
        card.className = `card ${currentStatus}`;

        let buttons = "";

        if (currentStatus === "available") {
            buttons = `
                <button onclick="startPedalo(${pedalo.number})">Départ</button>
                <button onclick="breakPedalo(${pedalo.number})">Casser</button>
            `;
        }

        if (
            currentStatus === "running" ||
            currentStatus === "late"
        ) {
            buttons = `
                <button onclick="finishPedalo(${pedalo.number})">
                    Arrivée
                </button>
            `;
        }

        if (currentStatus === "broken") {
            buttons = `
                <button onclick="repairPedalo(${pedalo.number})">
                    Réparer
                </button>
            `;
        }

        card.innerHTML = `
            <h2>${pedalo.number}</h2>
            <div class="timer">
                ${
                    currentStatus === "available"
                    ? "Disponible"
                    : currentStatus === "broken"
                    ? "Cassé"
                    : timerText
                }
            </div>
            <div>${buttons}</div>
        `;

        pedaloContainer.appendChild(card);
    });

    document.getElementById("availableCount").textContent = available;
    document.getElementById("runningCount").textContent = running;
    document.getElementById("lateCount").textContent = late;
    document.getElementById("brokenCount").textContent = broken;
}

window.startPedalo = startPedalo;
window.finishPedalo = finishPedalo;
window.breakPedalo = breakPedalo;
window.repairPedalo = repairPedalo;

initPedalos();

onValue(ref(db, "pedalos"), snapshot => {

    if (snapshot.exists()) {
        render(snapshot.val());
    }
});

setInterval(() => {

    onValue(ref(db, "pedalos"), snapshot => {

        if (snapshot.exists()) {
            render(snapshot.val());
        }
    });

}, 1000);
