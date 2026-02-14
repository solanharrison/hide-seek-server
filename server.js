const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*" }));

app.get("/", (_, res) => {
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

/* ================= GAME CONFIG ================= */

const PHASES = {
  LOBBY: "lobby",
  HIDE: "hide",
  HUNT: "hunt",
  RESULT: "result"
};

const MIN_PLAYERS = 3;
const HIDE_TIME = 15;
const HUNT_TIME = 60;

/* ================= STATE ================= */

let players = {};
let phase = PHASES.LOBBY;
let timer = 0;
let interval = null;

/* ================= HELPERS ================= */

function broadcastPlayers() {
  io.emit("updatePlayers", Object.values(players));
}

function broadcastPhase() {
  io.emit("phaseChange", { phase, duration: timer });
}

function resetGame() {
  phase = PHASES.LOBBY;
  timer = 0;

  Object.values(players).forEach(p => {
    p.role = "hider";
    p.isAlive = true;
  });

  broadcastPlayers();
  broadcastPhase();
}

function startHidePhase() {
  phase = PHASES.HIDE;
  timer = HIDE_TIME;

  // assign killer
  const ids = Object.keys(players);
  const killerId = ids[Math.floor(Math.random() * ids.length)];

  ids.forEach(id => {
    players[id].role = id === killerId ? "killer" : "hider";
    players[id].isAlive = true;
  });

  broadcastPlayers();
  broadcastPhase();

  interval = setInterval(() => {
    timer--;
    broadcastPhase();
    if (timer <= 0) {
      clearInterval(interval);
      startHuntPhase();
    }
  }, 1000);
}

function startHuntPhase() {
  phase = PHASES.HUNT;
  timer = HUNT_TIME;
  broadcastPhase();

  interval = setInterval(() => {
    timer--;
    broadcastPhase();

    if (timer <= 0) {
      clearInterval(interval);
      endGame("hiders");
    }
  }, 1000);
}

function endGame(winner) {
  phase = PHASES.RESULT;
  io.emit("gameEnd", { winner });

  setTimeout(resetGame, 5000);
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

    broadcastPlayers();

    if (
      Object.keys(players).length >= MIN_PLAYERS &&
      phase === PHASES.LOBBY
    ) {
      startHidePhase();
    }
  });

  socket.on("move", ({ x, y, angle }) => {
    const p = players[socket.id];
    if (!p || !p.isAlive) return;

    p.x = x;
    p.y = y;
    p.angle = angle;

    broadcastPlayers();
  });

  socket.on("attemptKill", ({ targetId }) => {
    if (phase !== PHASES.HUNT) return;

    const killer = players[socket.id];
    const target = players[targetId];

    if (!killer || !target) return;
    if (killer.role !== "killer") return;
    if (!target.isAlive) return;

    target.isAlive = false;
    io.emit("playerKilled", { playerId: targetId });

    const aliveHiders = Object.values(players).filter(
      p => p.role === "hider" && p.isAlive
    );

    if (aliveHiders.length === 0) {
      clearInterval(interval);
      endGame("killer");
    }

    broadcastPlayers();
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    broadcastPlayers();
  });
});
