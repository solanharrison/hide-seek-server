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

/* ================= CONSTANTS ================= */

const GamePhase = {
  LOBBY: "LOBBY",
  HIDE: "HIDE",
  HUNT: "HUNT",
  RESULTS: "RESULTS"
};

const PlayerRole = {
  KILLER: "KILLER",
  HIDER: "HIDER",
  SPECTATOR: "SPECTATOR"
};

const LOBBY_TIME = 20;
const HIDE_TIME = 15;
const HUNT_TIME = 60;
const MIN_PLAYERS = 3;

/* ================= GAME STATE ================= */

let gameState = {
  players: {},
  phase: GamePhase.LOBBY,
  timer: 0,
  winner: null
};

let interval = null;

/* ================= SOCKET ================= */

io.on("connection", (socket) => {

  socket.on("join", ({ name }) => {
    gameState.players[socket.id] = {
      id: socket.id,
      name,
      x: Math.random() * 1000 + 100,
      y: Math.random() * 600 + 100,
      angle: 0,
      role: PlayerRole.SPECTATOR,
      isDead: false
    };

    broadcastState();

    if (Object.keys(gameState.players).length >= MIN_PLAYERS &&
        gameState.phase === GamePhase.LOBBY) {
      startLobbyCountdown();
    }
  });

  socket.on("move", ({ x, y }) => {
    const player = gameState.players[socket.id];
    if (!player || player.isDead) return;

    // Basic boundary check
    player.x = Math.max(20, Math.min(1180, x));
    player.y = Math.max(20, Math.min(780, y));

    broadcastState();
  });

  socket.on("rotate", ({ angle }) => {
    const player = gameState.players[socket.id];
    if (!player) return;
    player.angle = angle;
  });

  socket.on("attemptKill", ({ targetId }) => {
    if (gameState.phase !== GamePhase.HUNT) return;

    const killer = gameState.players[socket.id];
    const target = gameState.players[targetId];

    if (!killer || !target) return;
    if (killer.role !== PlayerRole.KILLER) return;
    if (target.isDead) return;

    // Server authoritative kill
    target.isDead = true;

    io.emit("killConfirmed", targetId);

    checkWinCondition();
    broadcastState();
  });

  socket.on("disconnect", () => {
    delete gameState.players[socket.id];
    broadcastState();
  });
});

/* ================= GAME FLOW ================= */

function startLobbyCountdown() {
  gameState.phase = GamePhase.LOBBY;
  gameState.timer = LOBBY_TIME;
  broadcastState();
  io.emit("phaseChange", GamePhase.LOBBY);

  interval = setInterval(() => {
    gameState.timer--;
    broadcastState();

    if (gameState.timer <= 0) {
      clearInterval(interval);
      startHidePhase();
    }
  }, 1000);
}

function startHidePhase() {
  gameState.phase = GamePhase.HIDE;
  gameState.timer = HIDE_TIME;
  assignRoles();
  broadcastState();
  io.emit("phaseChange", GamePhase.HIDE);

  interval = setInterval(() => {
    gameState.timer--;
    broadcastState();

    if (gameState.timer <= 0) {
      clearInterval(interval);
      startHuntPhase();
    }
  }, 1000);
}

function startHuntPhase() {
  gameState.phase = GamePhase.HUNT;
  gameState.timer = HUNT_TIME;
  broadcastState();
  io.emit("phaseChange", GamePhase.HUNT);

  interval = setInterval(() => {
    gameState.timer--;
    broadcastState();

    if (gameState.timer <= 0) {
      clearInterval(interval);
      endGame("HIDER");
    }
  }, 1000);
}

function endGame(winner) {
  gameState.phase = GamePhase.RESULTS;
  gameState.winner = winner;
  gameState.timer = 5;
  broadcastState();
  io.emit("phaseChange", GamePhase.RESULTS);

  interval = setInterval(() => {
    gameState.timer--;
    broadcastState();

    if (gameState.timer <= 0) {
      clearInterval(interval);
      resetGame();
    }
  }, 1000);
}

function assignRoles() {
  const ids = Object.keys(gameState.players);
  const killerIndex = Math.floor(Math.random() * ids.length);

  ids.forEach((id, index) => {
    gameState.players[id].role =
      index === killerIndex ? PlayerRole.KILLER : PlayerRole.HIDER;
    gameState.players[id].isDead = false;
  });
}

function checkWinCondition() {
  const aliveHiders = Object.values(gameState.players)
    .filter(p => p.role === PlayerRole.HIDER && !p.isDead);

  if (aliveHiders.length === 0) {
    clearInterval(interval);
    endGame("KILLER");
  }
}

function resetGame() {
  gameState.phase = GamePhase.LOBBY;
  gameState.timer = 0;
  gameState.winner = null;

  Object.values(gameState.players).forEach(p => {
    p.role = PlayerRole.SPECTATOR;
    p.isDead = false;
  });

  broadcastState();
}

/* ================= UTIL ================= */

function broadcastState() {
  io.emit("gameStateUpdate", gameState);
}
