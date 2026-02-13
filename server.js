const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

let rooms = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        state: "waiting",
        killer: null
      };
    }

    rooms[roomId].players[socket.id] = {
      x: 100,
      y: 100,
      alive: true
    };

    io.to(roomId).emit("updatePlayers", rooms[roomId].players);

    if (Object.keys(rooms[roomId].players).length >= 3) {
      startGame(roomId);
    }
  });

  socket.on("move", ({ roomId, x, y }) => {
    if (!rooms[roomId]) return;

    if (rooms[roomId].players[socket.id]) {
      rooms[roomId].players[socket.id].x = x;
      rooms[roomId].players[socket.id].y = y;
    }

    io.to(roomId).emit("updatePlayers", rooms[roomId].players);
  });

  socket.on("disconnect", () => {
    for (let roomId in rooms) {
      delete rooms[roomId].players[socket.id];
      io.to(roomId).emit("updatePlayers", rooms[roomId].players);
    }
  });
});

function startGame(roomId) {
  const room = rooms[roomId];

  if (room.state !== "waiting") return;

  room.state = "starting";

  setTimeout(() => {
    const playerIds = Object.keys(room.players);
    const randomIndex = Math.floor(Math.random() * playerIds.length);
    room.killer = playerIds[randomIndex];

    room.state = "playing";

    io.to(roomId).emit("gameStarted", {
      killer: room.killer
    });

    startHuntTimer(roomId);

  }, 60000); // 1 minute waiting
}

function startHuntTimer(roomId) {
  setTimeout(() => {
    const room = rooms[roomId];

    const alivePlayers = Object.values(room.players).filter(p => p.alive).length;

    if (alivePlayers > 1) {
      io.to(roomId).emit("survivorsWin");
    } else {
      io.to(roomId).emit("killerWin");
    }

    room.state = "ended";

  }, 90000); // 90 sec hunt
}

server.listen(3000, () => {
  console.log("Server running");
});
