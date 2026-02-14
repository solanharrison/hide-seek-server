const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*" }));

app.get("/", (req, res) => {
  res.send("Shadow Hunt Server Running");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});

/* ================= CONFIG ================= */

const MIN_PLAYERS = 3;
const LOBBY_TIME = 20;
const HIDE_TIME = 15;
const HUNT_TIME = 60;

/* ================= GAME STATE ================= */

let players = {};
let phase = "lobby";
let timer = 0;
let lobbyInterval = null;
let phaseInterval = null;

/* ================= HELPERS ================= */

function broadcastPlayers() {
  // 🔥 FIX: send ARRAY, not object
  io.emit("updatePlayers", Object.values(players));
}

function startLobbyCountdown() {
  if (lobbyInterval) return;

  timer = LOBBY_TIME;
  io.emit("lobbyCountdown", { seconds: timer });

  lobbyInterval = setInterval(() => {
    timer--;
    io.emit("lobbyCountdown", { seconds: timer });

    if (timer <= 0) {
      clearInterval(lobbyInterval);
      lobbyInterval = null;
      startGame();
    }
  }, 1000);
}

function startGame() {
  phase = "hide";

  const ids = Object.keys(players);
  const killerId = ids[Math.floor(Math.random() * ids.length)];

  ids.forEach(id => {
    players[id].role = id === killerId ? "killer" : "hider";
    players[id].isAlive = true;
  });

  io.emit("gameStart", {
    players: Object.values(players)
  });

  ids.forEach(id => {
    io.to(id).emit("roleAssigned", {
      role: players[id].role
    });
  });

  startPhaseTimer("hide", HIDE_TIME);
}

function startPhaseTimer(newPhase, duration) {
  phase = newPhase;
  timer = duration;

  io.emit("phaseChange", {
    phase,
    duration
  });

  if (phaseInterval) clearInterval(phaseInterval);

  phaseInterval = setInterval(() => {
    timer--;

    if (timer <= 0) {
      clearInterval(phaseInterval);

      if (phase === "hide") {
        startPhaseTimer("hunt", HUNT_TIME);
      } else if (phase === "hunt") {
        endGame("hiders");
      }
    }
  }, 1000);
}

function endGame(winner) {
  phase = "result";
  io.emit("gameEnd", { winner });
  setTimeout(resetGame, 5000);
}

function resetGame() {
  phase = "lobby";
  Object.values(players).forEach(p => {
    p.role = "hider";
    p.isAlive = true;
  });
  io.emit("gameReset");
}

/* ================= SOCKET ================= */

io.on("connection", socket => {

  socket.on("joinRoom", ({ name }) => {
    players[socket.id] = {
      id: socket.id,
      name,
      x: Math.random() * 600 + 100,
      y: Math.random() * 400 + 100,
      angle: 0,
      role: "hider",
      isAlive: true
    };

    socket.emit("joined", {
      id: socket.id,
      name,
      players: Object.values(players)
    });

    io.emit("playerJoined", {
      players: Object.values(players)
    });

    if (Object.keys(players).length >= MIN_PLAYERS && phase === "lobby") {
      startLobbyCountdown();
    }
  });

  socket.on("move", ({ x, y, angle }) => {
    const p = players[socket.id];
    if (!p || !p.isAlive) return;

    p.x = Math.max(20, Math.min(1200, x));
    p.y = Math.max(20, Math.min(800, y));
    p.angle = angle;

    broadcastPlayers();
  });

  socket.on("angle", ({ angle }) => {
    const p = players[socket.id];
    if (!p) return;
    p.angle = angle;
  });

  socket.on("attemptKill", ({ targetId }) => {
    if (phase !== "hunt") return;

    const killer = players[socket.id];
    const target = players[targetId];

    if (!killer || !target) return;
    if (killer.role !== "killer") return;
    if (!target.isAlive) return;

    target.isAlive = false;

    io.emit("playerKilled", {
      playerId: targetId,
      killerId: socket.id
    });

    broadcastPlayers();

    const aliveHiders = Object.values(players)
      .filter(p => p.role === "hider" && p.isAlive);

    if (aliveHiders.length === 0) {
      endGame("killer");
    }
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("playerLeft", {
      players: Object.values(players)
    });
  });
});
