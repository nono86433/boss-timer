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
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const FIFTEEN_MINS_MS = 15 * 60 * 1000;
const THIRTY_MINS_MS = 30 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

const DEFAULT_CONFIG = {
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
};

let config = readJSON(CONFIG_FILE, DEFAULT_CONFIG);
if (!config.bosses || config.bosses.length === 0) {
  config.bosses = DEFAULT_CONFIG.bosses;
  writeJSON(CONFIG_FILE, config);
}

let records = readJSON(RECORDS_FILE, {});
let logs = readJSON(LOGS_FILE, []);
let chats = readJSON(CHATS_FILE, []);
let meta = readJSON(META_FILE, {
  lastActivityAt: Date.now(),
  lastResetAllAt: 0,
  deletedRecords: {}
});
if (!meta.deletedRecords) meta.deletedRecords = {};
if (!meta.lastResetAllAt) meta.lastResetAllAt = 0;

// Compute deterministic 3-round cycle state for a record
function computeRecordCycle(rec, now = Date.now()) {
  if (!rec) return { expired: true };

  let r1Start, r1Respawn, r2Start, r2Respawn, r3Start, r3Respawn, expireDeleteAt;
  const baseMins = Number(rec.baseRespawnMinutes || rec.respawnMinutes || 45);

  if (rec.baseKilledAt) {
    r1Start = Number(rec.baseKilledAt);
    r1Respawn = r1Start + baseMins * 60000;
    r2Start = r1Respawn + FIFTEEN_MINS_MS;
    r2Respawn = r2Start + THIRTY_MINS_MS;
    r3Start = r2Respawn + FIFTEEN_MINS_MS;
    r3Respawn = r3Start + THIRTY_MINS_MS;
    expireDeleteAt = r3Respawn + FIFTEEN_MINS_MS;
  } else if (rec.autoAdjusted30m) {
    // Legacy record that was already in Round 2
    r2Start = Number(rec.killedAt);
    r2Respawn = Number(rec.respawnAt);
    r1Start = r2Start - FIFTEEN_MINS_MS - baseMins * 60000;
    r1Respawn = r2Start - FIFTEEN_MINS_MS;
    r3Start = r2Respawn + FIFTEEN_MINS_MS;
    r3Respawn = r3Start + THIRTY_MINS_MS;
    expireDeleteAt = r3Respawn + FIFTEEN_MINS_MS;
  } else {
    r1Start = Number(rec.killedAt);
    r1Respawn = Number(rec.respawnAt) || (r1Start + baseMins * 60000);
    r2Start = r1Respawn + FIFTEEN_MINS_MS;
    r2Respawn = r2Start + THIRTY_MINS_MS;
    r3Start = r2Respawn + FIFTEEN_MINS_MS;
    r3Respawn = r3Start + THIRTY_MINS_MS;
    expireDeleteAt = r3Respawn + FIFTEEN_MINS_MS;
  }

  if (now >= expireDeleteAt) {
    return { expired: true, round: 4, expireDeleteAt };
  }
  if (now >= r3Start) {
    return {
      expired: false,
      round: 3,
      phaseStartAt: r3Start,
      phaseRespawnAt: r3Respawn,
      phaseMinutes: 30,
      diffMs: r3Respawn - now
    };
  }
  if (now >= r2Start) {
    return {
      expired: false,
      round: 2,
      phaseStartAt: r2Start,
      phaseRespawnAt: r2Respawn,
      phaseMinutes: 30,
      diffMs: r2Respawn - now
    };
  }
  return {
    expired: false,
    round: 1,
    phaseStartAt: r1Start,
    phaseRespawnAt: r1Respawn,
    phaseMinutes: baseMins,
    diffMs: r1Respawn - now
  };
}

function pruneOldChats() {
  const now = Date.now();
  const beforeLen = chats.length;
  chats = chats.filter(c => c && c.timestamp && (now - c.timestamp <= TWENTY_FOUR_HOURS_MS));
  if (chats.length !== beforeLen) {
    writeJSON(CHATS_FILE, chats);
  }
}

function checkAutoRules() {
  const now = Date.now();
  let hasAnyRecord = false;
  let recordsChanged = false;

  for (const srv of Object.keys(records)) {
    const srvRecs = records[srv];
    if (!srvRecs) continue;
    for (const bossId of Object.keys(srvRecs)) {
      const rec = srvRecs[bossId];
      if (!rec) continue;

      const cycle = computeRecordCycle(rec, now);
      if (cycle.expired) {
        // 3 rounds completed without manual edit -> automatically delete!
        const bossName = rec.bossName || bossId;
        delete srvRecs[bossId];
        meta.deletedRecords[`${srv}_${bossId}`] = now;
        recordsChanged = true;

        const logEntry = {
          id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
          type: 'AUTO_DEL_3R',
          serverId: srv,
          bossId,
          bossName,
          reporter: '系統自動(三輪未編輯刪除)',
          timestamp: now
        };
        logs.unshift(logEntry);
        if (logs.length > 200) logs.pop();

        broadcast({
          type: 'RECORD_CLEARED',
          serverId: srv,
          bossId,
          bossName,
          reporter: '系統自動(滿三輪未編輯刪除)',
          deletedAt: now,
          lastActivityAt: meta.lastActivityAt,
          log: logEntry,
          isAutoDelete3R: true
        });
      } else {
        hasAnyRecord = true;
      }
    }
    if (Object.keys(srvRecs).length === 0) {
      delete records[srv];
    }
  }

  // Rule 1: If no manual data modification for 3 hours, automatically reset all channels
  if (hasAnyRecord && meta.lastActivityAt && (now - meta.lastActivityAt >= THREE_HOURS_MS)) {
    records = {};
    meta.lastActivityAt = now;
    meta.lastResetAllAt = now;
    writeJSON(RECORDS_FILE, records);
    writeJSON(META_FILE, meta);

    const logEntry = {
      id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
      type: 'AUTO_RESET_3H',
      serverId: 'ALL',
      bossId: 'ALL',
      bossName: '全頻道',
      reporter: '系統自動(閒置3小時重置)',
      timestamp: now
    };
    logs.unshift(logEntry);
    if (logs.length > 200) logs.pop();
    writeJSON(LOGS_FILE, logs);

    broadcast({
      type: 'ALL_RECORDS_RESET',
      lastActivityAt: meta.lastActivityAt,
      lastResetAllAt: meta.lastResetAllAt,
      log: logEntry
    });
    return;
  }

  if (recordsChanged) {
    writeJSON(RECORDS_FILE, records);
    writeJSON(META_FILE, meta);
    writeJSON(LOGS_FILE, logs);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/api/state', checkAuth, (req, res) => {
  pruneOldChats();
  checkAutoRules();
  res.json({
    success: true,
    config,
    records,
    logs: logs.slice(0, 100),
    chats,
    lastActivityAt: meta.lastActivityAt || Date.now(),
    lastResetAllAt: meta.lastResetAllAt || 0,
    deletedRecords: meta.deletedRecords || {}
  });
});

app.post('/api/record', checkAuth, (req, res) => {
  const { serverId, bossId, killedAt, respawnMinutes, note } = req.body;
  const reporter = req.currentUser;

  if (!serverId || !bossId) {
    return res.status(400).json({ success: false, error: '缺少 serverId 或 bossId' });
  }

  const now = Date.now();
  const kTime = killedAt ? Number(killedAt) : now;
  const rMinutes = Number(respawnMinutes) > 0 ? Number(respawnMinutes) : 45;
  const respawnAt = kTime + rMinutes * 60 * 1000;

  if (!records[serverId]) {
    records[serverId] = {};
  }

  const bossDef = config.bosses.find(b => b.id === bossId) || { name: bossId };

  const recordEntry = {
    serverId,
    bossId,
    bossName: bossDef.name,
    baseKilledAt: kTime,
    baseRespawnMinutes: rMinutes,
    killedAt: kTime,
    respawnMinutes: rMinutes,
    respawnAt,
    reporter,
    note: note || '',
    updatedAt: now
  };

  records[serverId][bossId] = recordEntry;
  delete meta.deletedRecords[`${serverId}_${bossId}`];
  meta.lastActivityAt = now;

  writeJSON(RECORDS_FILE, records);
  writeJSON(META_FILE, meta);

  const logEntry = {
    id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
    type: 'KILL',
    serverId,
    bossId,
    bossName: bossDef.name,
    killedAt: kTime,
    respawnAt,
    respawnMinutes: rMinutes,
    reporter,
    note: note || '',
    timestamp: now
  };

  logs.unshift(logEntry);
  if (logs.length > 200) logs.pop();
  writeJSON(LOGS_FILE, logs);

  broadcast({
    type: 'RECORD_UPDATED',
    record: recordEntry,
    log: logEntry,
    lastActivityAt: meta.lastActivityAt
  });

  res.json({ success: true, record: recordEntry, lastActivityAt: meta.lastActivityAt });
});

app.post('/api/record/clear', checkAuth, (req, res) => {
  const { serverId, bossId, isAutoDelete3R } = req.body;
  const reporter = isAutoDelete3R ? '系統自動(滿三輪未編輯刪除)' : req.currentUser;
  const now = Date.now();

  const bossDef = config.bosses.find(b => b.id === bossId) || { name: bossId };
  if (records[serverId] && records[serverId][bossId]) {
    delete records[serverId][bossId];
  }
  meta.deletedRecords[`${serverId}_${bossId}`] = now;
  if (!isAutoDelete3R) {
    meta.lastActivityAt = now;
  }

  writeJSON(RECORDS_FILE, records);
  writeJSON(META_FILE, meta);

  const logEntry = {
    id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
    type: isAutoDelete3R ? 'AUTO_DEL_3R' : 'CLEAR',
    serverId,
    bossId,
    bossName: bossDef.name,
    reporter,
    timestamp: now
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
    deletedAt: now,
    lastActivityAt: meta.lastActivityAt,
    log: logEntry,
    isAutoDelete3R: Boolean(isAutoDelete3R)
  });

  res.json({ success: true, lastActivityAt: meta.lastActivityAt, deletedAt: now });
});

app.post('/api/record/reset-all', checkAuth, (req, res) => {
  const { isAuto } = req.body || {};
  const now = Date.now();
  records = {};
  meta.lastActivityAt = now;
  meta.lastResetAllAt = now;
  writeJSON(RECORDS_FILE, records);
  writeJSON(META_FILE, meta);

  const logEntry = {
    id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
    type: isAuto ? 'AUTO_RESET_3H' : 'CLEAR',
    serverId: 'ALL',
    bossId: 'ALL',
    bossName: '全頻道',
    reporter: isAuto ? '系統自動(閒置3小時重置)' : req.currentUser,
    timestamp: now
  };
  logs.unshift(logEntry);
  if (logs.length > 200) logs.pop();
  writeJSON(LOGS_FILE, logs);

  broadcast({
    type: 'ALL_RECORDS_RESET',
    lastActivityAt: meta.lastActivityAt,
    lastResetAllAt: meta.lastResetAllAt,
    log: logEntry
  });

  res.json({ success: true, lastActivityAt: meta.lastActivityAt, lastResetAllAt: meta.lastResetAllAt });
});

app.post('/api/chat', checkAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !String(text).trim()) {
    return res.status(400).json({ success: false, error: '訊息不能為空' });
  }

  pruneOldChats();

  const chatMsg = {
    id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    sender: req.currentUser,
    text: String(text).trim().slice(0, 500),
    timestamp: Date.now()
  };

  chats.push(chatMsg);
  if (chats.length > 300) {
    chats = chats.slice(-300);
  }
  writeJSON(CHATS_FILE, chats);

  broadcast({
    type: 'CHAT_MESSAGE',
    chat: chatMsg
  });

  res.json({ success: true, chat: chatMsg });
});

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

function broadcast(messageObj) {
  const messageStr = JSON.stringify(messageObj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAuthorized) {
      client.send(messageStr);
    }
  });
}

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

const rulesInterval = setInterval(() => {
  pruneOldChats();
  checkAutoRules();
}, 5000);

const wsPingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(rulesInterval);
  clearInterval(wsPingInterval);
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
