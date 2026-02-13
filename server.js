const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

let rooms = {};

const LOBBY_TIME = 60;
const HIDE_TIME = 30;
const HUNT_TIME = 90;
const KILL_DISTANCE = 120;
const KILL_ANGLE = Math.PI / 6; // 30 degrees

io.on("connection", (socket) => {

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        state: "waiting",
        killer: null,
        timer: null,
        timeLeft: 0
      };
    }

    rooms[roomId].players[socket.id] = {
      x: Math.random() * 600,
      y: Math.random() * 400,
      alive: true,
      angle: 0
    };

    io.to(roomId).emit("updatePlayers", rooms[roomId].players);

    if (Object.keys(rooms[roomId].players).length >= 3 &&
        rooms[roomId].state === "waiting") {
      startLobby(roomId);
    }
  });

  socket.on("move", ({ roomId, x, y, angle }) => {
    const room = rooms[roomId];
    if (!room || room.state === "ended") return;

    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    player.x = x;
    player.y = y;
    player.angle = angle;

    if (room.state === "hunt" && socket.id === room.killer) {
      checkKills(roomId);
    }

    io.to(roomId).emit("updatePlayers", room.players);
  });

  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      delete rooms[roomId].players[socket.id];
      io.to(roomId).emit("updatePlayers", rooms[roomId].players);
    }
  });
});

function startLobby(roomId) {
  const room = rooms[roomId];
  room.state = "lobby";
  room.timeLeft = LOBBY_TIME;

  io.to(roomId).emit("phase", { phase: "lobby", time: room.timeLeft });

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(roomId).emit("phase", { phase: "lobby", time: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      startHide(roomId);
    }
  }, 1000);
}

function startHide(roomId) {
  const room = rooms[roomId];

  const ids = Object.keys(room.players);
  const randomIndex = Math.floor(Math.random() * ids.length);
  room.killer = ids[randomIndex];

  room.state = "hide";
  room.timeLeft = HIDE_TIME;

  io.to(roomId).emit("role", room.killer);
  io.to(roomId).emit("phase", { phase: "hide", time: room.timeLeft });

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(roomId).emit("phase", { phase: "hide", time: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      startHunt(roomId);
    }
  }, 1000);
}

function startHunt(roomId) {
  const room = rooms[roomId];
  room.state = "hunt";
  room.timeLeft = HUNT_TIME;

  io.to(roomId).emit("phase", { phase: "hunt", time: room.timeLeft });

  room.timer = setInterval(() => {
    room.timeLeft--;

    io.to(roomId).emit("phase", { phase: "hunt", time: room.timeLeft });

    checkWinCondition(roomId);

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      endGame(roomId);
    }
  }, 1000);
}

function checkKills(roomId) {
  const room = rooms[roomId];
  const killer = room.players[room.killer];
  if (!killer) return;

  for (let id in room.players) {
    if (id === room.killer) continue;

    const player = room.players[id];
    if (!player.alive) continue;

    const dx = player.x - killer.x;
    const dy = player.y - killer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > KILL_DISTANCE) continue;

    const angleToPlayer = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToPlayer - killer.angle);

    if (Math.abs(angleDiff) < KILL_ANGLE) {
      player.alive = false;
      io.to(roomId).emit("playerKilled", id);
    }
  }

  checkWinCondition(roomId);
}

function checkWinCondition(roomId) {
  const room = rooms[roomId];

  const alivePlayers = Object.keys(room.players)
    .filter(id => room.players[id].alive && id !== room.killer);

  if (alivePlayers.length === 0) {
    io.to(roomId).emit("winner", "killer");
    room.state = "ended";
    clearInterval(room.timer);
  }
}

function endGame(roomId) {
  const room = rooms[roomId];

  const alivePlayers = Object.keys(room.players)
    .filter(id => room.players[id].alive && id !== room.killer);

  if (alivePlayers.length > 0) {
    io.to(roomId).emit("winner", "survivors");
  } else {
    io.to(roomId).emit("winner", "killer");
  }

  room.state = "ended";
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
