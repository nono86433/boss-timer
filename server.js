const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helpers for data reading & writing
function readJSON(file, defaultValue) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
  }
  return defaultValue;
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
  }
}

let config = readJSON(CONFIG_FILE, {
  authNames: ["啞啞", "森森"],
  servers: Array.from({ length: 60 }, (_, i) => `S${i + 1}`),
  bosses: [
    {
      id: "boss_mushmom",
      name: "蘑菇王",
      respawnMinutes: 45,
      location: "",
      note: "",
      color: "#f97316"
    },
    {
      id: "boss_zombiemushmom",
      name: "殭屍姑姑王",
      respawnMinutes: 45,
      location: "",
      note: "",
      color: "#a855f7"
    }
  ]
});

let records = readJSON(RECORDS_FILE, {});
let logs = readJSON(LOGS_FILE, []);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware
function checkAuth(req, res, next) {
  const identity = req.headers['x-user-identity'] || req.query.identity;
  if (!identity || !config.authNames.includes(decodeURIComponent(identity))) {
    return res.status(401).json({
      success: false,
      error: '身份驗證失敗：僅限指定人員（啞啞 / 森森）查看與操作！'
    });
  }
  req.currentUser = decodeURIComponent(identity);
  next();
}

// API: Verify login
app.post('/api/auth', (req, res) => {
  const { name } = req.body;
  if (!name || !config.authNames.includes(name.trim())) {
    return res.status(403).json({
      success: false,
      message: '名稱不符！請輸入指定名稱「啞啞」或「森森」'
    });
  }
  return res.json({
    success: true,
    user: name.trim()
  });
});

// API: Network Info (for sharing URL across LAN/phones)
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 of interfaces[k]) {
      if (k2.family === 'IPv4' && !k2.internal) {
        addresses.push(k2.address);
      }
    }
  }
  res.json({
    port: PORT,
    addresses: addresses.length ? addresses : ['127.0.0.1']
  });
});

// API: Get initial state (protected)
app.get('/api/state', checkAuth, (req, res) => {
  res.json({
    success: true,
    config,
    records,
    logs: logs.slice(0, 100)
  });
});

// API: Record boss kill time (protected)
app.post('/api/record', checkAuth, (req, res) => {
  const { serverId, bossId, killedAt, respawnMinutes, note } = req.body;
  const reporter = req.currentUser;

  if (!serverId || !bossId) {
    return res.status(400).json({ success: false, error: '缺少 serverId 或 bossId' });
  }

  const kTime = killedAt ? Number(killedAt) : Date.now();
  const rMinutes = Number(respawnMinutes) > 0 ? Number(respawnMinutes) : 60;
  const respawnAt = kTime + rMinutes * 60 * 1000;

  if (!records[serverId]) {
    records[serverId] = {};
  }

  const bossDef = config.bosses.find(b => b.id === bossId) || { name: bossId };

  const recordEntry = {
    serverId,
    bossId,
    bossName: bossDef.name,
    killedAt: kTime,
    respawnMinutes: rMinutes,
    respawnAt,
    reporter,
    note: note || '',
    updatedAt: Date.now()
  };

  records[serverId][bossId] = recordEntry;
  writeJSON(RECORDS_FILE, records);

  // Add to logs
  const logEntry = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    type: 'KILL',
    serverId,
    bossId,
    bossName: bossDef.name,
    killedAt: kTime,
    respawnAt,
    respawnMinutes: rMinutes,
    reporter,
    note: note || '',
    timestamp: Date.now()
  };

  logs.unshift(logEntry);
  if (logs.length > 200) logs.pop();
  writeJSON(LOGS_FILE, logs);

  // Broadcast to all WebSocket clients
  broadcast({
    type: 'RECORD_UPDATED',
    record: recordEntry,
    log: logEntry
  });

  res.json({ success: true, record: recordEntry });
});

// API: Clear/Reset a boss record (protected)
app.post('/api/record/clear', checkAuth, (req, res) => {
  const { serverId, bossId } = req.body;
  const reporter = req.currentUser;

  if (records[serverId] && records[serverId][bossId]) {
    const bossDef = config.bosses.find(b => b.id === bossId) || { name: bossId };
    delete records[serverId][bossId];
    writeJSON(RECORDS_FILE, records);

    const logEntry = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: 'CLEAR',
      serverId,
      bossId,
      bossName: bossDef.name,
      reporter,
      timestamp: Date.now()
    };
    logs.unshift(logEntry);
    if (logs.length > 200) logs.pop();
    writeJSON(LOGS_FILE, logs);

    broadcast({
      type: 'RECORD_CLEARED',
      serverId,
      bossId,
      bossName: bossDef.name,
      reporter,
      log: logEntry
    });
  }

  res.json({ success: true });
});

// API: Manage boss definitions (add/edit/delete) (protected)
app.post('/api/bosses', checkAuth, (req, res) => {
  const { action, boss } = req.body;

  if (action === 'add') {
    if (!boss || !boss.name || !boss.respawnMinutes) {
      return res.status(400).json({ success: false, error: '請提供完整的王名稱與重生時間' });
    }
    const newBoss = {
      id: `boss_${Date.now()}`,
      name: boss.name.trim(),
      respawnMinutes: Math.max(1, parseInt(boss.respawnMinutes, 10)),
      location: boss.location ? boss.location.trim() : '',
      note: boss.note ? boss.note.trim() : '',
      color: boss.color || '#3b82f6'
    };
    config.bosses.push(newBoss);
    writeJSON(CONFIG_FILE, config);
    broadcast({ type: 'CONFIG_UPDATED', config });
    return res.json({ success: true, boss: newBoss });
  }

  if (action === 'edit') {
    const idx = config.bosses.findIndex(b => b.id === boss.id);
    if (idx !== -1) {
      config.bosses[idx] = {
        ...config.bosses[idx],
        name: boss.name.trim(),
        respawnMinutes: Math.max(1, parseInt(boss.respawnMinutes, 10)),
        location: boss.location ? boss.location.trim() : '',
        note: boss.note ? boss.note.trim() : '',
        color: boss.color || config.bosses[idx].color
      };
      writeJSON(CONFIG_FILE, config);
      broadcast({ type: 'CONFIG_UPDATED', config });
      return res.json({ success: true, boss: config.bosses[idx] });
    }
    return res.status(404).json({ success: false, error: '找不到該Boss設定' });
  }

  if (action === 'delete') {
    config.bosses = config.bosses.filter(b => b.id !== boss.id);
    writeJSON(CONFIG_FILE, config);
    broadcast({ type: 'CONFIG_UPDATED', config });
    return res.json({ success: true });
  }

  res.status(400).json({ success: false, error: '無效的操作' });
});

// Broadcast helper for WebSocket
function broadcast(messageObj) {
  const messageStr = JSON.stringify(messageObj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAuthorized) {
      client.send(messageStr);
    }
  });
}

// WebSocket connection management
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.isAuthorized = false;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'AUTH') {
        if (config.authNames.includes(parsed.name)) {
          ws.isAuthorized = true;
          ws.userName = parsed.name;
          ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', user: parsed.name }));
        } else {
          ws.send(JSON.stringify({ type: 'AUTH_FAIL', error: '未授權' }));
          ws.close();
        }
      }
    } catch (e) {
      console.error('WS Message parsing error:', e);
    }
  });
});

// Ping interval to keep connections alive
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎮 王時間記錄器 (Boss Respawn Tracker) 伺服器已啟動`);
  console.log(`👉 本地網址: http://localhost:${PORT}`);

  const interfaces = os.networkInterfaces();
  for (const k in interfaces) {
    for (const k2 of interfaces[k]) {
      if (k2.family === 'IPv4' && !k2.internal) {
        console.log(`👉 區域網路/手機共用網址: http://${k2.address}:${PORT}`);
      }
    }
  }
  console.log(`🔒 驗證授權名單: ${config.authNames.join(', ')}`);
  console.log(`====================================================`);
});
