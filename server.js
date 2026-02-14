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

const CONFIG = {
  TILE_SIZE: 40,
  PLAYER_RADIUS: 12,
  PLAYER_SPEED: 150,
  FLASHLIGHT_RANGE: 200,
  FLASHLIGHT_ANGLE: Math.PI / 3, // 60 degrees
  HIDE_DURATION: 15,
  HUNT_DURATION: 60,
  LOBBY_COUNTDOWN: 20,
  MIN_PLAYERS: 3
};

const PHASES = {
  LOBBY: "lobby",
  HIDE: "hide",
  HUNT: "hunt",
  RESULT: "result"
};

/* ================= MAP DATA ================= */

const MAP_DATA = {
  tiles: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,1,1,1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,0,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,0,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ],
  spawnPoints: [
    { x: 180, y: 180 },
    { x: 400, y: 180 },
    { x: 620, y: 180 },
    { x: 180, y: 440 },
    { x: 400, y: 440 },
    { x: 620, y: 440 },
    { x: 180, y: 620 },
    { x: 400, y: 620 },
    { x: 620, y: 620 }
  ]
};

// Precompute walls
const walls = [];
for (let y = 0; y < MAP_DATA.tiles.length; y++) {
  for (let x = 0; x < MAP_DATA.tiles[y].length; x++) {
    if (MAP_DATA.tiles[y][x] === 1) {
      walls.push({
        x: x * CONFIG.TILE_SIZE,
        y: y * CONFIG.TILE_SIZE,
        w: CONFIG.TILE_SIZE,
        h: CONFIG.TILE_SIZE
      });
    }
  }
}

/* ================= STATE ================= */

let players = {};
let phase = PHASES.LOBBY;
let timer = 0;
let phaseInterval = null;
let lobbyCountdownInterval = null;

/* ================= COLLISION HELPERS ================= */

function circleRectCollision(cx, cy, radius, rx, ry, rw, rh) {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return (dx * dx + dy * dy) < (radius * radius);
}

function checkWallCollision(x, y, radius) {
  for (const wall of walls) {
    if (circleRectCollision(x, y, radius, wall.x, wall.y, wall.w, wall.h)) {
      return true;
    }
  }
  return false;
}

function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  // Liang-Barsky algorithm
  let t0 = 0, t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  const p = [-dx, dx, -dy, dy];
  const q = [
    x1 - rx,
    rx + rw - x1,
    y1 - ry,
    ry + rh - y1
  ];
  
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0 && t > t0) t0 = t;
      if (p[i] > 0 && t < t1) t1 = t;
    }
  }
  
  return t0 <= t1;
}

function hasLineOfSight(x1, y1, x2, y2) {
  for (const wall of walls) {
    if (lineIntersectsRect(x1, y1, x2, y2, wall.x, wall.y, wall.w, wall.h)) {
      return false;
    }
  }
  return true;
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function isInFlashlightCone(killerX, killerY, killerAngle, targetX, targetY) {
  const dx = targetX - killerX;
  const dy = targetY - killerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance > CONFIG.FLASHLIGHT_RANGE) return false;
  
  const angleToTarget = Math.atan2(dy, dx);
  const angleDiff = Math.abs(normalizeAngle(angleToTarget - killerAngle));
  
  return angleDiff < (CONFIG.FLASHLIGHT_ANGLE / 2);
}

/* ================= BROADCAST HELPERS ================= */

function broadcastPlayers() {
  io.emit("updatePlayers", Object.values(players));
}

function broadcastPhase() {
  io.emit("phaseChange", { phase, duration: timer });
}

function broadcastLobbyCountdown(seconds) {
  io.emit("lobbyCountdown", { seconds });
}

/* ================= GAME FLOW ================= */

function resetGame() {
  if (phaseInterval) {
    clearInterval(phaseInterval);
    phaseInterval = null;
  }
  if (lobbyCountdownInterval) {
    clearInterval(lobbyCountdownInterval);
    lobbyCountdownInterval = null;
  }
  
  phase = PHASES.LOBBY;
  timer = 0;

  // Reset all players
  Object.values(players).forEach(p => {
    p.role = "hider";
    p.isAlive = true;
  });

  broadcastPlayers();
  broadcastPhase();
  
  // Check if we can start countdown again
  checkAndStartLobbyCountdown();
}

function checkAndStartLobbyCountdown() {
  if (Object.keys(players).length >= CONFIG.MIN_PLAYERS && phase === PHASES.LOBBY) {
    if (lobbyCountdownInterval) return; // Already counting
    
    timer = CONFIG.LOBBY_COUNTDOWN;
    broadcastLobbyCountdown(timer);
    
    lobbyCountdownInterval = setInterval(() => {
      timer--;
      broadcastLobbyCountdown(timer);
      
      if (timer <= 0) {
        clearInterval(lobbyCountdownInterval);
        lobbyCountdownInterval = null;
        startHidePhase();
      }
    }, 1000);
  }
}

function startHidePhase() {
  phase = PHASES.HIDE;
  timer = CONFIG.HIDE_DURATION;

  // Assign killer randomly
  const ids = Object.keys(players);
  const killerId = ids[Math.floor(Math.random() * ids.length)];

  // Reset and assign roles
  ids.forEach((id, index) => {
    const spawn = MAP_DATA.spawnPoints[index % MAP_DATA.spawnPoints.length];
    players[id].role = id === killerId ? "killer" : "hider";
    players[id].isAlive = true;
    players[id].x = spawn.x;
    players[id].y = spawn.y;
    players[id].angle = 0;
    
    // Send role assignment individually
    io.to(id).emit("roleAssigned", { role: players[id].role });
  });

  broadcastPlayers();
  broadcastPhase();

  // Notify game started
  io.emit("gameStart", { players: Object.values(players) });

  phaseInterval = setInterval(() => {
    timer--;
    broadcastPhase();
    if (timer <= 0) {
      clearInterval(phaseInterval);
      phaseInterval = null;
      startHuntPhase();
    }
  }, 1000);
}

function startHuntPhase() {
  phase = PHASES.HUNT;
  timer = CONFIG.HUNT_DURATION;
  broadcastPhase();

  phaseInterval = setInterval(() => {
    timer--;
    broadcastPhase();

    if (timer <= 0) {
      clearInterval(phaseInterval);
      phaseInterval = null;
      endGame("hiders");
    }
  }, 1000);
}

function endGame(winner) {
  phase = PHASES.RESULT;
  
  if (phaseInterval) {
    clearInterval(phaseInterval);
    phaseInterval = null;
  }
  
  io.emit("gameEnd", { winner });

  setTimeout(() => {
    io.emit("gameReset");
    resetGame();
  }, 5000);
}

/* ================= SOCKET EVENTS ================= */

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("joinRoom", ({ name }) => {
    const playerName = name || `Player_${socket.id.substr(0, 4)}`;
    
    players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: MAP_DATA.spawnPoints[0].x + Math.random() * 50 - 25,
      y: MAP_DATA.spawnPoints[0].y + Math.random() * 50 - 25,
      angle: 0,
      role: "hider",
      isAlive: true
    };

    // Send joined confirmation
    socket.emit("joined", {
      id: socket.id,
      name: playerName,
      players: Object.values(players)
    });

    // Broadcast new player list
    broadcastPlayers();
    
    // Send current phase
    broadcastPhase();

    // Check for lobby countdown
    checkAndStartLobbyCountdown();
  });

  socket.on("move", ({ x, y, angle }) => {
    const p = players[socket.id];
    if (!p || !p.isAlive) return;
    
    // Killer can't move during hide phase
    if (phase === PHASES.HIDE && p.role === "killer") {
      return;
    }
    
    // Validate movement against walls
    const clampedX = Math.max(CONFIG.PLAYER_RADIUS, Math.min(x, MAP_DATA.tiles[0].length * CONFIG.TILE_SIZE - CONFIG.PLAYER_RADIUS));
    const clampedY = Math.max(CONFIG.PLAYER_RADIUS, Math.min(y, MAP_DATA.tiles.length * CONFIG.TILE_SIZE - CONFIG.PLAYER_RADIUS));
    
    // Check collision for X movement
    if (!checkWallCollision(clampedX, p.y, CONFIG.PLAYER_RADIUS)) {
      p.x = clampedX;
    }
    
    // Check collision for Y movement
    if (!checkWallCollision(p.x, clampedY, CONFIG.PLAYER_RADIUS)) {
      p.y = clampedY;
    }
    
    p.angle = angle !== undefined ? angle : p.angle;

    // Broadcast updated position
    broadcastPlayers();
  });

  socket.on("angle", ({ angle }) => {
    const p = players[socket.id];
    if (!p || !p.isAlive) return;
    p.angle = angle;
    broadcastPlayers();
  });

  socket.on("attemptKill", ({ targetId }) => {
    if (phase !== PHASES.HUNT) return;

    const killer = players[socket.id];
    const target = players[targetId];

    // Validation
    if (!killer || !target) return;
    if (killer.role !== "killer") return;
    if (!killer.isAlive) return;
    if (!target.isAlive) return;

    // Check distance
    const dx = target.x - killer.x;
    const dy = target.y - killer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > CONFIG.FLASHLIGHT_RANGE) return;

    // Check if target is in flashlight cone
    if (!isInFlashlightCone(killer.x, killer.y, killer.angle, target.x, target.y)) {
      return;
    }

    // Check line of sight (raycast through walls)
    if (!hasLineOfSight(killer.x, killer.y, target.x, target.y)) {
      return;
    }

    // Valid kill!
    target.isAlive = false;
    io.emit("playerKilled", { 
      playerId: targetId, 
      killerId: socket.id 
    });

    // Check win condition
    const aliveHiders = Object.values(players).filter(
      p => p.role === "hider" && p.isAlive
    );

    if (aliveHiders.length === 0) {
      if (phaseInterval) {
        clearInterval(phaseInterval);
        phaseInterval = null;
      }
      endGame("killer");
    } else {
      broadcastPlayers();
    }
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    const wasInGame = players[socket.id];
    delete players[socket.id];
    
    if (Object.keys(players).length === 0) {
      // No players left, reset everything
      if (phaseInterval) {
        clearInterval(phaseInterval);
        phaseInterval = null;
      }
      if (lobbyCountdownInterval) {
        clearInterval(lobbyCountdownInterval);
        lobbyCountdownInterval = null;
      }
      phase = PHASES.LOBBY;
      timer = 0;
    } else {
      broadcastPlayers();
      
      // Check if we need to stop lobby countdown
      if (Object.keys(players).length < CONFIG.MIN_PLAYERS && lobbyCountdownInterval) {
        clearInterval(lobbyCountdownInterval);
        lobbyCountdownInterval = null;
        timer = 0;
      }
      
      // Check if killer disconnected during game
      if (phase === PHASES.HIDE || phase === PHASES.HUNT) {
        const killerExists = Object.values(players).some(p => p.role === "killer" && p.isAlive);
        const aliveHiders = Object.values(players).filter(p => p.role === "hider" && p.isAlive);
        
        if (!killerExists && aliveHiders.length > 0) {
          // Killer disconnected, hiders win
          endGame("hiders");
        } else if (aliveHiders.length === 0) {
          // All hiders gone, killer wins
          endGame("killer");
        }
      }
    }
  });
});

/* ================= HEARTBEAT ================= */

// Optional: Send periodic updates for smoother sync
setInterval(() => {
  if (Object.keys(players).length > 0 && (phase === PHASES.HIDE || phase === PHASES.HUNT)) {
    broadcastPlayers();
  }
}, 50); // 20 updates per second
