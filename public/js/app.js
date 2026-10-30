// Main Application Logic for Boss Respawn Tracker
// Features: Single-Boss Focus, 3-Round Auto Cycle (Purple R2, Orange R3, Auto-Delete after R3),
// 3-Hour Inactivity Reset, 24-Hour Chat Room, and Conflict-Free Multi-User Sync
(function () {
  'use strict';

  const isGitHubPages = window.location.hostname.endsWith('github.io');
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const FIFTEEN_MINS_MS = 15 * 60 * 1000;
  const THIRTY_MINS_MS = 30 * 60 * 1000;

  const DEFAULT_BOSSES = [
    {
      id: 'boss_mushmom',
      name: '蘑菇王',
      respawnMinutes: 45,
      location: '',
      note: '',
      color: '#f97316'
    },
    {
      id: 'boss_zombiemushmom',
      name: '殭屍姑姑王',
      respawnMinutes: 45,
      location: '',
      note: '',
      color: '#a855f7'
    }
  ];

  // Application State
  const state = {
    currentUser: localStorage.getItem('boss_tracker_user') || null,
    config: {
      authNames: ['啞啞', '森森'],
      servers: Array.from({ length: 60 }, (_, i) => `S${i + 1}`),
      bosses: [...DEFAULT_BOSSES]
    },
    records: {},
    deletedRecords: {},
    lastResetAllAt: parseInt(localStorage.getItem('boss_last_reset_all') || '0', 10),
    logs: [],
    chats: [],
    lastActivityAt: parseInt(localStorage.getItem('boss_last_activity') || String(Date.now()), 10),
    activeBossId: localStorage.getItem('boss_active_id') || 'boss_mushmom',
    activeServer: localStorage.getItem('boss_active_server') || 'S1',
    currentView: 'server', // 'server' | 'radar' | 'history'
    alertThresholdMinutes: parseInt(localStorage.getItem('boss_alert_minutes') || '5', 10),
    alertedCache: new Set(),
    notifiedRoundCache: new Set(),
    tickerId: null,
    autoSyncId: null,
    isSyncing: false
  };

  // DOM Elements
  const el = {
    mainAppContent: document.getElementById('mainAppContent'),
    lblUserName: document.getElementById('lblUserName'),
    btnSwitchUser: document.getElementById('btnSwitchUser'),
    connStatus: document.getElementById('connStatus'),
    connDot: document.getElementById('connDot'),
    connText: document.getElementById('connText'),
    btnManualSync: document.getElementById('btnManualSync'),
    lblInactivityTimer: document.getElementById('lblInactivityTimer'),
    btnToggleSound: document.getElementById('btnToggleSound'),
    btnToggleVoice: document.getElementById('btnToggleVoice'),
    selectAlertMinutes: document.getElementById('selectAlertMinutes'),
    btnTestSound: document.getElementById('btnTestSound'),
    btnOpenShare: document.getElementById('btnOpenShare'),
    btnOpenBossManager: document.getElementById('btnOpenBossManager'),

    tabServerView: document.getElementById('tabServerView'),
    tabRadarView: document.getElementById('tabRadarView'),
    tabHistoryView: document.getElementById('tabHistoryView'),
    lblCurrentBossNav: document.getElementById('lblCurrentBossNav'),
    lblCurrentServerNav: document.getElementById('lblCurrentServerNav'),
    lblRadarCount: document.getElementById('lblRadarCount'),

    sectionServerView: document.getElementById('sectionServerView'),
    sectionRadarView: document.getElementById('sectionRadarView'),
    sectionHistoryView: document.getElementById('sectionHistoryView'),

    // Step 1: Top Boss Selector
    topBossTabs: document.getElementById('topBossTabs'),
    btnQuickAddBoss: document.getElementById('btnQuickAddBoss'),
    inlineNewBossName: document.getElementById('inlineNewBossName'),
    inlineNewBossMinutes: document.getElementById('inlineNewBossMinutes'),
    btnInlineAddBoss: document.getElementById('btnInlineAddBoss'),

    // Step 2: Server Grid S1~S60
    lblGridBossName: document.getElementById('lblGridBossName'),
    serverGrid: document.getElementById('serverGrid'),
    serverRangeTabs: document.getElementById('serverRangeTabs'),

    // Step 3: Single Boss Card, Active Server Summary & Chat Room
    singleBossContainer: document.getElementById('singleBossContainer'),
    lblSummaryBossName: document.getElementById('lblSummaryBossName'),
    lblActiveBossServerCount: document.getElementById('lblActiveBossServerCount'),
    btnListSync: document.getElementById('btnListSync'),
    btnResetAllChannels: document.getElementById('btnResetAllChannels'),
    singleBossServerList: document.getElementById('singleBossServerList'),

    chatMessagesBox: document.getElementById('chatMessagesBox'),
    chatQuickPhrases: document.getElementById('chatQuickPhrases'),
    inputChatMessage: document.getElementById('inputChatMessage'),
    btnSendChat: document.getElementById('btnSendChat'),

    radarTableBody: document.getElementById('radarTableBody'),
    historyTableBody: document.getElementById('historyTableBody'),

    // Auth Modal
    modalAuth: document.getElementById('modalAuth'),
    inputAuthName: document.getElementById('inputAuthName'),
    btnSubmitAuth: document.getElementById('btnSubmitAuth'),
    lblAuthError: document.getElementById('lblAuthError'),

    // Boss Manager Modal
    modalBossManager: document.getElementById('modalBossManager'),
    bossSettingsList: document.getElementById('bossSettingsList'),
    inputNewBossName: document.getElementById('inputNewBossName'),
    inputNewBossMinutes: document.getElementById('inputNewBossMinutes'),
    newBossRespawnPresets: document.getElementById('newBossRespawnPresets'),
    inputNewBossLoc: document.getElementById('inputNewBossLoc'),
    inputNewBossNote: document.getElementById('inputNewBossNote'),
    btnSubmitNewBoss: document.getElementById('btnSubmitNewBoss'),
    btnCloseBossManager: document.getElementById('btnCloseBossManager'),
    btnDoneBossManager: document.getElementById('btnDoneBossManager'),

    // Share Modal
    modalShare: document.getElementById('modalShare'),
    networkLinksContainer: document.getElementById('networkLinksContainer'),
    btnCloseShare: document.getElementById('btnCloseShare'),
    btnDoneShare: document.getElementById('btnDoneShare'),

    toastContainer: document.getElementById('toastContainer')
  };

  // Deterministic 3-Round Lifecycle Calculator
  // Round 1: Manual record -> Respawns after baseRespawnMinutes -> Waits 15m
  // Round 2: Auto 30m countdown (Purple) -> Respawns after 30m -> Waits 15m
  // Round 3: Auto 30m countdown (Orange) -> Respawns after 30m -> Waits 15m
  // After Round 3 + 15m without manual edit -> Expired & Automatically Deleted!
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
      return {
        expired: true,
        round: 4,
        expireDeleteAt
      };
    }

    if (now >= r3Start) {
      return {
        expired: false,
        round: 3,
        phaseStartAt: r3Start,
        phaseRespawnAt: r3Respawn,
        phaseMinutes: 30,
        diffMs: r3Respawn - now,
        nextTransitionAt: expireDeleteAt
      };
    }

    if (now >= r2Start) {
      return {
        expired: false,
        round: 2,
        phaseStartAt: r2Start,
        phaseRespawnAt: r2Respawn,
        phaseMinutes: 30,
        diffMs: r2Respawn - now,
        nextTransitionAt: r3Start
      };
    }

    return {
      expired: false,
      round: 1,
      phaseStartAt: r1Start,
      phaseRespawnAt: r1Respawn,
      phaseMinutes: baseMins,
      diffMs: r1Respawn - now,
      nextTransitionAt: r2Start
    };
  }

  function getActiveBoss() {
    if (!state.config.bosses || state.config.bosses.length === 0) {
      state.config.bosses = [...DEFAULT_BOSSES];
    }
    let found = state.config.bosses.find(b => b.id === state.activeBossId);
    if (!found) {
      found = state.config.bosses[0];
      state.activeBossId = found.id;
      localStorage.setItem('boss_active_id', found.id);
    }
    return found;
  }

  function hasAnyActiveRecords() {
    for (const srv of Object.keys(state.records)) {
      const srvRecs = state.records[srv];
      if (srvRecs && Object.keys(srvRecs).length > 0) return true;
    }
    return false;
  }

  function saveLocalCloudCache() {
    try {
      localStorage.setItem('boss_cloud_config', JSON.stringify(state.config));
      localStorage.setItem('boss_cloud_records', JSON.stringify(state.records));
      localStorage.setItem('boss_cloud_deleted', JSON.stringify(state.deletedRecords));
      localStorage.setItem('boss_last_reset_all', String(state.lastResetAllAt));
      localStorage.setItem('boss_cloud_logs', JSON.stringify(state.logs.slice(0, 200)));
      localStorage.setItem('boss_cloud_chats', JSON.stringify(state.chats.slice(-300)));
      localStorage.setItem('boss_last_activity', String(state.lastActivityAt));
    } catch (e) {}
  }

  function mergeBossesNonDestructive(existingBosses, incomingBosses) {
    const map = new Map();
    DEFAULT_BOSSES.forEach(b => map.set(b.id, { ...b }));
    (existingBosses || []).forEach(b => {
      if (b && b.id) map.set(b.id, { ...b });
    });
    (incomingBosses || []).forEach(b => {
      if (b && b.id) map.set(b.id, { ...b });
    });
    return Array.from(map.values());
  }

  // Reconcile state.records against deletedRecords, lastResetAllAt, and 3-round expiration
  function reconcileRecordsState(incomingRecords, incomingDeleted, incomingResetAllAt) {
    if (incomingResetAllAt && incomingResetAllAt > state.lastResetAllAt) {
      state.lastResetAllAt = incomingResetAllAt;
    }

    if (incomingDeleted) {
      for (const [key, delTs] of Object.entries(incomingDeleted)) {
        if (!state.deletedRecords[key] || delTs > state.deletedRecords[key]) {
          state.deletedRecords[key] = delTs;
        }
      }
    }

    // Merge incoming records if newer
    if (incomingRecords) {
      for (const srv of Object.keys(incomingRecords)) {
        const srvRecs = incomingRecords[srv] || {};
        for (const bossId of Object.keys(srvRecs)) {
          const r = srvRecs[bossId];
          if (!r) continue;
          if (!state.records[srv]) state.records[srv] = {};
          const cur = state.records[srv][bossId];
          const rTime = r.updatedAt || r.killedAt || 0;
          const curTime = cur ? (cur.updatedAt || cur.killedAt || 0) : 0;
          if (!cur || rTime >= curTime) {
            state.records[srv][bossId] = r;
          }
        }
      }
    }

    // Purge any record older than lastResetAllAt, deletedRecords[key], or 3-round expiration
    const now = Date.now();
    for (const srv of Object.keys(state.records)) {
      const srvRecs = state.records[srv];
      if (!srvRecs) continue;
      for (const bossId of Object.keys(srvRecs)) {
        const rec = srvRecs[bossId];
        if (!rec) {
          delete srvRecs[bossId];
          continue;
        }
        const recTs = rec.updatedAt || rec.killedAt || 0;
        const delTs = state.deletedRecords[`${srv}_${bossId}`] || 0;
        const cycle = computeRecordCycle(rec, now);

        if (recTs <= state.lastResetAllAt || recTs <= delTs || cycle.expired) {
          delete srvRecs[bossId];
        }
      }
      if (Object.keys(srvRecs).length === 0) {
        delete state.records[srv];
      }
    }
  }

  // Setup LiveSocket
  const liveSocket = new window.LiveSocket({
    currentUser: state.currentUser,
    onStatusChange: (status) => {
      el.connDot.className = 'status-dot ' + status;
      if (status === 'connected') {
        el.connText.textContent = '即時同步中';
      } else if (status === 'connecting') {
        el.connText.textContent = '連線中...';
      } else {
        el.connText.textContent = '中斷連線 (重新連線中)';
      }
    },
    onMessage: (msg) => {
      handleSocketMessage(msg);
    }
  });

  // Handle incoming real-time socket events
  function handleSocketMessage(msg) {
    if (msg.type === 'RECORD_UPDATED' && msg.record) {
      const rec = msg.record;
      reconcileRecordsState({ [rec.serverId]: { [rec.bossId]: rec } }, msg.deletedRecords, msg.lastResetAllAt);

      if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
        state.lastActivityAt = msg.lastActivityAt;
      }
      if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
        state.logs.unshift(msg.log);
        if (state.logs.length > 200) state.logs.pop();
      }
      saveLocalCloudCache();

      showToast(`📢 ${rec.reporter} 更新了 [${rec.serverId}] ${rec.bossName} 的打死時間！`, 'info');
      refreshAllViews();
    } else if (msg.type === 'RECORD_CLEARED') {
      const delTs = msg.deletedAt || Date.now();
      reconcileRecordsState(null, { [`${msg.serverId}_${msg.bossId}`]: delTs }, msg.lastResetAllAt);

      if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
        state.lastActivityAt = msg.lastActivityAt;
      }
      if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
        state.logs.unshift(msg.log);
      }
      saveLocalCloudCache();

      const bName = msg.bossName || (msg.log && msg.log.bossName) || '王怪';
      const rep = msg.reporter || (msg.log && msg.log.reporter) || '';
      if (msg.isAutoDelete3R) {
        showToast(`🗑️ [${msg.serverId}] ${bName} 連續三輪未手動編輯，已自動刪除紀錄（請重新找王時間）！`, 'warn');
      } else {
        showToast(`🔄 [${msg.serverId}] ${bName} 紀錄已被 ${rep} 清除`, 'info');
      }
      refreshAllViews();
    } else if (msg.type === 'ALL_RECORDS_RESET') {
      const resetTs = msg.lastResetAllAt || Date.now();
      state.records = {};
      state.lastResetAllAt = Math.max(state.lastResetAllAt, resetTs);
      state.lastActivityAt = msg.lastActivityAt || resetTs;
      if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
        state.logs.unshift(msg.log);
      }
      saveLocalCloudCache();

      showToast('⏰ 所有頻道紀錄已重置清空！', 'warn');
      refreshAllViews();
    } else if (msg.type === 'STATE_SNAPSHOT') {
      if (msg.config && msg.config.bosses) {
        state.config.bosses = mergeBossesNonDestructive(state.config.bosses, msg.config.bosses);
      }
      if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
        state.lastActivityAt = msg.lastActivityAt;
      }
      reconcileRecordsState(msg.records, msg.deletedRecords, msg.lastResetAllAt);
      saveLocalCloudCache();
      refreshAllViews();
    } else if (msg.type === 'CHAT_MESSAGE' && msg.chat) {
      pruneOldChatsInState();
      if (!state.chats.some(c => c.id === msg.chat.id)) {
        state.chats.push(msg.chat);
        saveLocalCloudCache();
        renderChatMessages();
        if (msg.chat.sender !== state.currentUser && window.soundEngine) {
          window.soundEngine.playChime('normal');
          showToast(`💬 ${msg.chat.sender}：${msg.chat.text}`, 'info');
        }
      }
    } else if (msg.type === 'CONFIG_UPDATED') {
      state.config = msg.config;
      saveLocalCloudCache();
      getActiveBoss();
      renderBossManagerList();
      refreshAllViews();
      showToast('⚙️ 王怪與復活時間設定已同步更新！', 'success');
    }
  }

  function refreshAllViews() {
    renderTopBossTabs();
    renderServerGridBadges();
    if (state.currentView === 'server') {
      renderSingleBossView();
      renderSingleBossServerList();
    }
    if (state.currentView === 'radar') renderRadarView();
    if (state.currentView === 'history') renderHistoryView();
  }

  // API helper with authentication header & GitHub Pages Cloud Sync Mode
  async function apiFetch(endpoint, options = {}) {
    if (!state.currentUser) {
      promptAuth();
      throw new Error('請先完成身分驗證');
    }

    if (isGitHubPages) {
      return await handleCloudApi(endpoint, options);
    }

    const headers = options.headers || {};
    headers['Content-Type'] = 'application/json';
    headers['x-user-identity'] = encodeURIComponent(state.currentUser);

    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    if (res.status === 401 || res.status === 403) {
      state.currentUser = null;
      localStorage.removeItem('boss_tracker_user');
      promptAuth();
      throw new Error('身分驗證失效，請重新輸入指定名稱');
    }

    return await res.json();
  }

  // Cloud Sync Handler when hosted on GitHub Pages
  async function handleCloudApi(endpoint, options = {}) {
    const body = options.body ? JSON.parse(options.body) : {};

    if (endpoint === '/api/state') {
      try {
        const savedCfg = localStorage.getItem('boss_cloud_config');
        if (savedCfg) {
          const parsedCfg = JSON.parse(savedCfg);
          state.config.bosses = mergeBossesNonDestructive(state.config.bosses, parsedCfg.bosses);
        }
        const savedRec = localStorage.getItem('boss_cloud_records');
        if (savedRec) state.records = JSON.parse(savedRec);
        const savedDel = localStorage.getItem('boss_cloud_deleted');
        if (savedDel) state.deletedRecords = JSON.parse(savedDel);
        const savedReset = localStorage.getItem('boss_last_reset_all');
        if (savedReset) state.lastResetAllAt = parseInt(savedReset, 10) || 0;
        const savedLogs = localStorage.getItem('boss_cloud_logs');
        if (savedLogs) state.logs = JSON.parse(savedLogs);
        const savedChats = localStorage.getItem('boss_cloud_chats');
        if (savedChats) state.chats = JSON.parse(savedChats);
        const savedAct = localStorage.getItem('boss_last_activity');
        if (savedAct) state.lastActivityAt = parseInt(savedAct, 10) || Date.now();
      } catch (e) {}

      // Fetch recent events from ntfy.sh cloud history (24h window) and reconcile
      try {
        const res = await fetch(`https://ntfy.sh/${liveSocket.cloudTopic}/json?poll=1&since=24h&_t=${Date.now()}`, {
          cache: 'no-store'
        });
        const text = await res.text();
        const lines = text.trim().split('\n').filter(Boolean);
        lines.forEach(line => {
          try {
            const evt = JSON.parse(line);
            if (evt.event === 'message' && evt.message) {
              const msg = JSON.parse(evt.message);
              if (msg.type === 'RECORD_UPDATED' && msg.record) {
                const r = msg.record;
                reconcileRecordsState({ [r.serverId]: { [r.bossId]: r } }, msg.deletedRecords, msg.lastResetAllAt);
                if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
                  state.logs.unshift(msg.log);
                }
              } else if (msg.type === 'RECORD_CLEARED') {
                const delTs = msg.deletedAt || (msg.log && msg.log.timestamp) || evt.time * 1000 || Date.now();
                reconcileRecordsState(null, { [`${msg.serverId}_${msg.bossId}`]: delTs }, msg.lastResetAllAt);
                if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
                  state.logs.unshift(msg.log);
                }
              } else if (msg.type === 'ALL_RECORDS_RESET') {
                const resetTs = msg.lastResetAllAt || (msg.log && msg.log.timestamp) || evt.time * 1000 || Date.now();
                reconcileRecordsState(null, null, resetTs);
                if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
                  state.logs.unshift(msg.log);
                }
              } else if (msg.type === 'STATE_SNAPSHOT') {
                if (msg.config && msg.config.bosses) {
                  state.config.bosses = mergeBossesNonDestructive(state.config.bosses, msg.config.bosses);
                }
                if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                reconcileRecordsState(msg.records, msg.deletedRecords, msg.lastResetAllAt);
              } else if (msg.type === 'CHAT_MESSAGE' && msg.chat) {
                if (!state.chats.some(c => c.id === msg.chat.id)) {
                  state.chats.push(msg.chat);
                }
              } else if (msg.type === 'CONFIG_UPDATED' && msg.config) {
                state.config.bosses = mergeBossesNonDestructive(state.config.bosses, msg.config.bosses);
              }
            }
          } catch (e) {}
        });
        reconcileRecordsState();
        pruneOldChatsInState();
        state.logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        saveLocalCloudCache();
      } catch (e) {}

      return {
        success: true,
        config: state.config,
        records: state.records,
        deletedRecords: state.deletedRecords,
        lastResetAllAt: state.lastResetAllAt,
        logs: state.logs.slice(0, 100),
        chats: state.chats,
        lastActivityAt: state.lastActivityAt
      };
    }

    if (endpoint === '/api/record') {
      const { serverId, bossId, killedAt, respawnMinutes, note } = body;
      const now = Date.now();
      const kTime = killedAt ? Number(killedAt) : now;
      const rMinutes = Number(respawnMinutes) > 0 ? Number(respawnMinutes) : 45;
      const respawnAt = kTime + rMinutes * 60 * 1000;
      const bossDef = state.config.bosses.find(b => b.id === bossId) || { name: bossId };

      const recordEntry = {
        serverId,
        bossId,
        bossName: bossDef.name,
        baseKilledAt: kTime,
        baseRespawnMinutes: rMinutes,
        killedAt: kTime,
        respawnMinutes: rMinutes,
        respawnAt,
        reporter: state.currentUser,
        note: note || '',
        updatedAt: now
      };

      if (!state.records[serverId]) state.records[serverId] = {};
      state.records[serverId][bossId] = recordEntry;
      delete state.deletedRecords[`${serverId}_${bossId}`];
      state.lastActivityAt = now;

      const logEntry = {
        id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
        type: 'KILL',
        serverId,
        bossId,
        bossName: bossDef.name,
        killedAt: kTime,
        respawnAt,
        respawnMinutes: rMinutes,
        reporter: state.currentUser,
        note: note || '',
        timestamp: now
      };
      state.logs.unshift(logEntry);
      if (state.logs.length > 200) state.logs.pop();
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'RECORD_UPDATED',
        record: recordEntry,
        deletedRecords: state.deletedRecords,
        lastResetAllAt: state.lastResetAllAt,
        log: logEntry,
        lastActivityAt: state.lastActivityAt
      });

      return { success: true, record: recordEntry, lastActivityAt: state.lastActivityAt };
    }

    if (endpoint === '/api/record/clear') {
      const { serverId, bossId, isAutoDelete3R } = body;
      const now = Date.now();
      const bossDef = state.config.bosses.find(b => b.id === bossId) || { name: bossId };
      const reporter = isAutoDelete3R ? '系統自動(滿三輪未編輯刪除)' : state.currentUser;

      if (state.records[serverId]) delete state.records[serverId][bossId];
      state.deletedRecords[`${serverId}_${bossId}`] = now;
      if (!isAutoDelete3R) {
        state.lastActivityAt = now;
      }

      const logEntry = {
        id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
        type: isAutoDelete3R ? 'AUTO_DEL_3R' : 'CLEAR',
        serverId,
        bossId,
        bossName: bossDef.name,
        reporter,
        timestamp: now
      };
      state.logs.unshift(logEntry);
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'RECORD_CLEARED',
        serverId,
        bossId,
        bossName: bossDef.name,
        reporter,
        deletedAt: now,
        deletedRecords: state.deletedRecords,
        lastResetAllAt: state.lastResetAllAt,
        lastActivityAt: state.lastActivityAt,
        log: logEntry,
        isAutoDelete3R: Boolean(isAutoDelete3R)
      });

      return { success: true, lastActivityAt: state.lastActivityAt, deletedAt: now };
    }

    if (endpoint === '/api/record/reset-all') {
      const { isAuto } = body;
      const now = Date.now();
      state.records = {};
      state.lastResetAllAt = now;
      state.lastActivityAt = now;

      const logEntry = {
        id: `${now}_${Math.random().toString(36).substr(2, 4)}`,
        type: isAuto ? 'AUTO_RESET_3H' : 'CLEAR',
        serverId: 'ALL',
        bossId: 'ALL',
        bossName: '全頻道',
        reporter: isAuto ? '系統自動(閒置3小時重置)' : state.currentUser,
        timestamp: now
      };
      state.logs.unshift(logEntry);
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'ALL_RECORDS_RESET',
        lastActivityAt: state.lastActivityAt,
        lastResetAllAt: state.lastResetAllAt,
        log: logEntry
      });

      return { success: true, lastActivityAt: state.lastActivityAt, lastResetAllAt: state.lastResetAllAt };
    }

    if (endpoint === '/api/chat') {
      const text = String(body.text || '').trim().slice(0, 500);
      pruneOldChatsInState();
      const chatMsg = {
        id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        sender: state.currentUser,
        text,
        timestamp: Date.now()
      };
      state.chats.push(chatMsg);
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'CHAT_MESSAGE',
        chat: chatMsg
      });

      return { success: true, chat: chatMsg };
    }

    if (endpoint === '/api/bosses') {
      const { action, boss } = body;
      if (action === 'add') {
        const newBoss = {
          id: `boss_${Date.now()}`,
          name: boss.name.trim(),
          respawnMinutes: Math.max(1, parseInt(boss.respawnMinutes, 10)),
          location: boss.location ? boss.location.trim() : '',
          note: boss.note ? boss.note.trim() : '',
          color: boss.color || '#3b82f6'
        };
        state.config.bosses.push(newBoss);
        saveLocalCloudCache();
        liveSocket.broadcastCloud({ type: 'CONFIG_UPDATED', config: state.config });
        return { success: true, boss: newBoss };
      }
      if (action === 'edit') {
        const idx = state.config.bosses.findIndex(b => b.id === boss.id);
        if (idx !== -1) {
          state.config.bosses[idx] = {
            ...state.config.bosses[idx],
            name: boss.name.trim(),
            respawnMinutes: Math.max(1, parseInt(boss.respawnMinutes, 10)),
            location: boss.location ? boss.location.trim() : '',
            note: boss.note ? boss.note.trim() : ''
          };
          saveLocalCloudCache();
          liveSocket.broadcastCloud({ type: 'CONFIG_UPDATED', config: state.config });
          return { success: true, boss: state.config.bosses[idx] };
        }
      }
      if (action === 'delete') {
        state.config.bosses = state.config.bosses.filter(b => b.id !== boss.id);
        saveLocalCloudCache();
        liveSocket.broadcastCloud({ type: 'CONFIG_UPDATED', config: state.config });
        return { success: true };
      }
    }

    return { success: true };
  }

  // Manual & Background Synchronization Function
  async function syncNow(showUserFeedback = false) {
    if (!state.currentUser || state.isSyncing) return;
    state.isSyncing = true;

    if (showUserFeedback) {
      if (el.btnManualSync) el.btnManualSync.textContent = '🔄 同步中...';
      if (el.btnListSync) el.btnListSync.textContent = '同步中...';
    }

    try {
      const data = await apiFetch('/api/state');
      if (data.success) {
        if (data.config && data.config.bosses) {
          state.config.bosses = mergeBossesNonDestructive(state.config.bosses, data.config.bosses);
        }
        reconcileRecordsState(data.records, data.deletedRecords, data.lastResetAllAt);
        if (data.lastActivityAt && data.lastActivityAt > state.lastActivityAt) {
          state.lastActivityAt = data.lastActivityAt;
        }
        if (data.chats) {
          data.chats.forEach(c => {
            if (!state.chats.some(existing => existing.id === c.id)) {
              state.chats.push(c);
            }
          });
          pruneOldChatsInState();
        }
        saveLocalCloudCache();

        // Also broadcast our reconciled snapshot so the other teammate immediately receives any missing records
        if (isGitHubPages && showUserFeedback) {
          await liveSocket.broadcastCloud({
            type: 'STATE_SNAPSHOT',
            config: state.config,
            records: state.records,
            deletedRecords: state.deletedRecords,
            lastResetAllAt: state.lastResetAllAt,
            lastActivityAt: state.lastActivityAt
          });
        }

        // Reconnect socket if disconnected
        if (!liveSocket.isConnected) {
          liveSocket.connect();
        }

        refreshAllViews();
        renderChatMessages();

        if (showUserFeedback) {
          showToast('✅ 已與隊友完成最新資料同步！', 'success');
        }
      }
    } catch (e) {
      if (showUserFeedback) {
        showToast('同步失敗：' + e.message, 'error');
      }
    } finally {
      state.isSyncing = false;
      if (el.btnManualSync) el.btnManualSync.textContent = '🔄 立即同步';
      if (el.btnListSync) el.btnListSync.textContent = '🔄 同步';
    }
  }

  // Authentication Flow
  function checkAuth() {
    if (!state.currentUser || !state.config.authNames.includes(state.currentUser)) {
      promptAuth();
    } else {
      el.lblUserName.textContent = state.currentUser;
      el.modalAuth.style.display = 'none';
      el.mainAppContent.style.display = 'block';
      liveSocket.setUser(state.currentUser);
      initAppState();
    }
  }

  function promptAuth() {
    state.currentUser = null;
    localStorage.removeItem('boss_tracker_user');
    el.lblUserName.textContent = '未驗證';
    el.mainAppContent.style.display = 'none';
    el.modalAuth.style.display = 'flex';
    el.lblAuthError.style.display = 'none';
    el.inputAuthName.value = '';
    setTimeout(() => el.inputAuthName.focus(), 50);
  }

  async function submitAuth(name) {
    if (!name) name = el.inputAuthName.value.trim();
    if (!name) {
      el.lblAuthError.textContent = '請輸入指定名稱（「啞啞」或「森森」）才能查看與輸入資料！';
      el.lblAuthError.style.display = 'block';
      return;
    }

    if (isGitHubPages) {
      if (state.config.authNames.includes(name)) {
        state.currentUser = name;
        localStorage.setItem('boss_tracker_user', state.currentUser);
        el.lblUserName.textContent = state.currentUser;
        el.modalAuth.style.display = 'none';
        el.mainAppContent.style.display = 'block';
        liveSocket.setUser(state.currentUser);
        showToast(`🔓 身分驗證成功！歡迎，${state.currentUser}`, 'success');
        initAppState();
      } else {
        el.lblAuthError.textContent = '名稱驗證失敗：僅限輸入「啞啞」或「森森」才能查看資料！';
        el.lblAuthError.style.display = 'block';
      }
      return;
    }

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();

      if (data.success) {
        state.currentUser = data.user;
        localStorage.setItem('boss_tracker_user', state.currentUser);
        el.lblUserName.textContent = state.currentUser;
        el.modalAuth.style.display = 'none';
        el.mainAppContent.style.display = 'block';
        liveSocket.setUser(state.currentUser);
        showToast(`🔓 身分驗證成功！歡迎，${state.currentUser}`, 'success');
        initAppState();
      } else {
        el.lblAuthError.textContent = data.message || '名稱驗證失敗：僅限輸入「啞啞」或「森森」才能查看資料！';
        el.lblAuthError.style.display = 'block';
      }
    } catch (err) {
      el.lblAuthError.textContent = '連線伺服器失敗，請確認後端是否啟動';
      el.lblAuthError.style.display = 'block';
    }
  }

  // Load state from backend / cloud
  async function initAppState() {
    try {
      const data = await apiFetch('/api/state');
      if (data.success) {
        state.config = data.config;
        reconcileRecordsState(data.records, data.deletedRecords, data.lastResetAllAt);
        state.logs = data.logs || [];
        state.chats = data.chats || [];
        if (data.lastActivityAt) {
          state.lastActivityAt = data.lastActivityAt;
        }
        pruneOldChatsInState();
        saveLocalCloudCache();

        const now = Date.now();
        state.config.servers.forEach(srv => {
          const srvRecs = state.records[srv] || {};
          Object.values(srvRecs).forEach(rec => {
            if (!rec) return;
            const cycle = computeRecordCycle(rec, now);
            if (!cycle.expired) {
              state.notifiedRoundCache.add(`${srv}_${rec.bossId}_${rec.baseKilledAt || rec.killedAt}_r${cycle.round}`);
              if (cycle.diffMs < -60000) {
                state.alertedCache.add(`${srv}_${rec.bossId}_${cycle.phaseRespawnAt}_0m`);
                state.alertedCache.add(`${srv}_${rec.bossId}_${cycle.phaseRespawnAt}_1m`);
                state.alertedCache.add(`${srv}_${rec.bossId}_${cycle.phaseRespawnAt}_thresh`);
              }
            }
          });
        });

        getActiveBoss();
        renderTopBossTabs();
        renderServerButtons();
        selectBoss(state.activeBossId);
        renderChatMessages();
        startCountdownTicker();

        // Background auto-sync every 15 seconds so 2 users stay in sync even if WS drops
        if (state.autoSyncId) clearInterval(state.autoSyncId);
        state.autoSyncId = setInterval(() => {
          syncNow(false);
        }, 15000);

        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  // 24-Hour Chat Room Helpers
  function pruneOldChatsInState() {
    const now = Date.now();
    state.chats = (state.chats || []).filter(c => c && c.timestamp && (now - c.timestamp <= TWENTY_FOUR_HOURS_MS));
    state.chats.sort((a, b) => a.timestamp - b.timestamp);
  }

  function renderChatMessages() {
    if (!el.chatMessagesBox) return;
    pruneOldChatsInState();
    el.chatMessagesBox.innerHTML = '';

    if (state.chats.length === 0) {
      el.chatMessagesBox.innerHTML = `
        <div class="empty-state" style="padding: 40px 10px;">
          <div style="font-size: 24px; margin-bottom: 6px;">💬</div>
          <div style="font-size: 0.85rem;">尚無聊天訊息（訊息將自動保留 24 小時）</div>
        </div>
      `;
      return;
    }

    state.chats.forEach(msg => {
      const isSelf = msg.sender === state.currentUser;
      const item = document.createElement('div');
      item.className = `chat-msg-item ${isSelf ? 'self' : 'other'}`;
      item.innerHTML = `
        <div class="chat-msg-header">
          <span class="chat-msg-sender">${escapeHtml(msg.sender)}</span>
          <span>${formatTime(new Date(msg.timestamp))}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
      `;
      el.chatMessagesBox.appendChild(item);
    });

    el.chatMessagesBox.scrollTop = el.chatMessagesBox.scrollHeight;
  }

  async function sendChatMessage(customText) {
    const raw = customText !== undefined ? customText : el.inputChatMessage.value;
    const text = String(raw || '').trim();
    if (!text) return;

    if (customText === undefined) {
      el.inputChatMessage.value = '';
    }

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      if (res.success && res.chat) {
        if (!state.chats.some(c => c.id === res.chat.id)) {
          state.chats.push(res.chat);
        }
        renderChatMessages();
      }
    } catch (e) {
      showToast('發送訊息失敗：' + e.message, 'error');
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // STEP 1: Render Top Boss Tabs
  function renderTopBossTabs() {
    el.topBossTabs.innerHTML = '';
    const activeBoss = getActiveBoss();

    state.config.bosses.forEach(boss => {
      let count = 0;
      state.config.servers.forEach(srv => {
        if (state.records[srv] && state.records[srv][boss.id]) count++;
      });

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `boss-select-tab ${activeBoss && boss.id === activeBoss.id ? 'active' : ''}`;
      btn.innerHTML = `
        <span style="color: ${boss.color || 'var(--accent-cyan)'};">◆</span>
        <span>${boss.name}</span>
        <span class="boss-tab-sub">預設 ${formatMinutes(boss.respawnMinutes)}${count > 0 ? ` · ${count}服紀錄中` : ''}</span>
      `;
      btn.addEventListener('click', () => {
        selectBoss(boss.id);
      });
      el.topBossTabs.appendChild(btn);
    });
  }

  function selectBoss(bossId) {
    state.activeBossId = bossId;
    localStorage.setItem('boss_active_id', bossId);
    const boss = getActiveBoss();

    if (boss) {
      el.lblCurrentBossNav.textContent = boss.name;
      el.lblGridBossName.textContent = boss.name;
      el.lblSummaryBossName.textContent = boss.name;
    }

    renderTopBossTabs();
    renderServerGridBadges();
    renderSingleBossView();
    renderSingleBossServerList();
  }

  // STEP 2: Render S1 ~ S60 Server Buttons
  function renderServerButtons() {
    el.serverGrid.innerHTML = '';
    state.config.servers.forEach(srv => {
      const btn = document.createElement('button');
      btn.className = `server-btn ${srv === state.activeServer ? 'active' : ''}`;
      btn.dataset.server = srv;
      btn.innerHTML = `
        <span>${srv}</span>
        <span class="server-mini-timer" data-srv-timer="${srv}"></span>
        <span class="server-badge-dot" style="display: none;"></span>
      `;
      btn.addEventListener('click', () => {
        selectServer(srv);
      });
      el.serverGrid.appendChild(btn);
    });
  }

  function filterServerRange(range) {
    const buttons = el.serverGrid.querySelectorAll('.server-btn');
    buttons.forEach(btn => {
      const srvNum = parseInt(btn.dataset.server.replace('S', ''), 10);
      if (range === 'all') {
        btn.style.display = 'flex';
      } else {
        const [min, max] = range.split('-').map(Number);
        btn.style.display = (srvNum >= min && srvNum <= max) ? 'flex' : 'none';
      }
    });
  }

  function selectServer(server) {
    state.activeServer = server;
    localStorage.setItem('boss_active_server', server);
    el.lblCurrentServerNav.textContent = server;

    el.serverGrid.querySelectorAll('.server-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.server === server);
    });

    renderSingleBossView();
    renderSingleBossServerList();
  }

  // Update dots & mini timers on S1~S60 ONLY for the currently selected Boss (with Round 2 / Round 3 colors)
  function renderServerGridBadges() {
    const now = Date.now();
    const activeBoss = getActiveBoss();
    let totalRadarCount = 0;

    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv] || {};
      Object.values(srvRecs).forEach(r => {
        if (!r) return;
        const c = computeRecordCycle(r, now);
        if (!c.expired && c.diffMs <= state.alertThresholdMinutes * 60 * 1000) {
          totalRadarCount++;
        }
      });
    });
    el.lblRadarCount.textContent = totalRadarCount;

    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv] || {};
      const rec = activeBoss ? srvRecs[activeBoss.id] : null;

      const btn = el.serverGrid.querySelector(`[data-server="${srv}"]`);
      if (!btn) return;
      const dot = btn.querySelector('.server-badge-dot');
      const miniTimer = btn.querySelector('.server-mini-timer');

      if (rec) {
        const cycle = computeRecordCycle(rec, now);
        if (!cycle.expired) {
          const diffMs = cycle.diffMs;
          const rPrefix = cycle.round === 2 ? 'R2 ' : (cycle.round === 3 ? 'R3 ' : '');

          if (diffMs <= 0) {
            dot.className = `server-badge-dot ${cycle.round === 3 ? 'round-3' : (cycle.round === 2 ? 'round-2' : 'alive')}`;
            dot.style.display = 'block';
            miniTimer.textContent = `${rPrefix}已重生`;
            miniTimer.className = `server-mini-timer ${cycle.round === 3 ? 'round-3' : (cycle.round === 2 ? 'round-2' : 'alive')}`;
          } else if (diffMs <= state.alertThresholdMinutes * 60 * 1000) {
            dot.className = 'server-badge-dot soon';
            dot.style.display = 'block';
            miniTimer.textContent = `${rPrefix}${formatShortDuration(Math.ceil(diffMs / 1000))}`;
            miniTimer.className = 'server-mini-timer soon';
          } else {
            if (cycle.round >= 2) {
              dot.className = `server-badge-dot round-${cycle.round}`;
              dot.style.display = 'block';
            } else {
              dot.style.display = 'none';
            }
            miniTimer.textContent = `${rPrefix}${formatShortDuration(Math.ceil(diffMs / 1000))}`;
            miniTimer.className = `server-mini-timer ${cycle.round === 3 ? 'round-3' : (cycle.round === 2 ? 'round-2' : 'counting')}`;
          }
          return;
        }
      }

      dot.style.display = 'none';
      miniTimer.textContent = '';
      miniTimer.className = 'server-mini-timer';
    });
  }

  // Helper to build Round Badge HTML
  function getRoundTagHtml(round) {
    if (round === 2) {
      return '<span class="round-tag r2">🟣 第二輪 (自動倒數30分)</span>';
    }
    if (round === 3) {
      return '<span class="round-tag r3">🟠 第三輪・最終輪 (未編輯將自動刪除)</span>';
    }
    return '<span class="round-tag r1">🔵 第一輪 (手動記錄)</span>';
  }

  // STEP 3: Render ONLY the Single Selected Boss Card for the Selected Server
  function renderSingleBossView() {
    el.singleBossContainer.innerHTML = '';
    const boss = getActiveBoss();
    if (!boss) {
      el.singleBossContainer.innerHTML = `
        <div class="boss-card">
          <div class="empty-state">尚未設定任何王怪，請在上方新增王怪！</div>
        </div>
      `;
      return;
    }

    const now = Date.now();
    const serverRecords = state.records[state.activeServer] || {};
    const rec = serverRecords[boss.id];
    const cycle = rec ? computeRecordCycle(rec, now) : { expired: true };
    const hasValidRec = rec && !cycle.expired;

    let statusClass = '';
    let badgeHtml = '';
    let countdownHtml = '';
    let countdownClass = '';
    let progressPercent = 0;
    let progressClass = '';
    let detailsHtml = '';

    if (hasValidRec) {
      const diffMs = cycle.diffMs;
      const totalDuration = Math.max(1000, cycle.phaseRespawnAt - cycle.phaseStartAt);
      const elapsed = now - cycle.phaseStartAt;
      progressPercent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

      const phaseStartStr = formatTime(new Date(cycle.phaseStartAt));
      const respawnTimeStr = formatTime(new Date(cycle.phaseRespawnAt));
      const roundTag = getRoundTagHtml(cycle.round);

      if (cycle.round === 2) statusClass = 'status-round-2';
      if (cycle.round === 3) statusClass = 'status-round-3';

      if (diffMs <= 0) {
        if (cycle.round === 1) statusClass = 'status-alive';
        const overdueSeconds = Math.floor(Math.abs(diffMs) / 1000);
        const remainToNextRoundSec = Math.max(0, Math.ceil((cycle.nextTransitionAt - now) / 1000));

        if (cycle.round === 1) {
          badgeHtml = '<span class="boss-status-badge badge-alive">🟢 第一輪・已重生</span>';
          countdownClass = 'alive';
          progressClass = 'ready';
        } else if (cycle.round === 2) {
          badgeHtml = '<span class="boss-status-badge badge-round-2">🟣 第二輪・已重生</span>';
          countdownClass = 'round-2';
          progressClass = 'round-2';
        } else {
          badgeHtml = '<span class="boss-status-badge badge-round-3">🟠 第三輪・已重生 (即將刪除)</span>';
          countdownClass = 'round-3';
          progressClass = 'round-3';
        }
        progressPercent = 100;
        countdownHtml = `已重生 +${formatDuration(overdueSeconds)}`;

        const nextActionHint = cycle.round < 3
          ? `若無人編輯，將於 ${formatShortDuration(remainToNextRoundSec)} 後自動進入「第 ${cycle.round + 1} 輪 (倒數30分)」`
          : `⚠️ 此為第三輪，若無人手動編輯將於 ${formatShortDuration(remainToNextRoundSec)} 後自動刪除此頻道紀錄！`;

        detailsHtml = `
          <div class="detail-row">
            <span>目前階段：</span>
            <span class="detail-highlight">${roundTag}</span>
          </div>
          <div class="detail-row">
            <span>本輪預計復活：</span>
            <span class="detail-highlight" style="color: var(--accent-cyan); font-weight: 700;">${respawnTimeStr}</span>
          </div>
          <div class="detail-row">
            <span>自動轉換提示：</span>
            <span class="detail-highlight" style="color: ${cycle.round === 3 ? '#fb923c' : '#c084fc'};">${nextActionHint}</span>
          </div>
          ${rec.note ? `<div class="detail-row"><span>備註：</span><span class="detail-highlight">${escapeHtml(rec.note)}</span></div>` : ''}
        `;
      } else if (diffMs <= state.alertThresholdMinutes * 60 * 1000) {
        statusClass = 'status-spawning-soon';
        const mins = Math.ceil(diffMs / 60000);
        badgeHtml = `<span class="boss-status-badge badge-soon">⚠️ 第${cycle.round}輪・即將復活 (${mins}分內)</span>`;
        countdownClass = 'soon';
        progressClass = 'soon';
        countdownHtml = formatDuration(Math.ceil(diffMs / 1000));

        detailsHtml = `
          <div class="detail-row">
            <span>目前階段：</span>
            <span class="detail-highlight">${roundTag}</span>
          </div>
          <div class="detail-row">
            <span>預計復活時間：</span>
            <span class="detail-highlight" style="color: var(--accent-yellow); font-weight: 700;">${respawnTimeStr}</span>
          </div>
          <div class="detail-row">
            <span>本輪起算時間：</span>
            <span class="detail-highlight">${phaseStartStr} (${rec.reporter || '未知'})</span>
          </div>
          ${rec.note ? `<div class="detail-row"><span>備註：</span><span class="detail-highlight">${escapeHtml(rec.note)}</span></div>` : ''}
        `;
      } else {
        if (cycle.round === 2) {
          badgeHtml = '<span class="boss-status-badge badge-round-2">🟣 第二輪・倒數 30 分鐘</span>';
          countdownClass = 'round-2';
          progressClass = 'round-2';
        } else if (cycle.round === 3) {
          badgeHtml = '<span class="boss-status-badge badge-round-3">🟠 第三輪(最終)・倒數 30 分鐘</span>';
          countdownClass = 'round-3';
          progressClass = 'round-3';
        } else {
          badgeHtml = '<span class="boss-status-badge badge-respawning">🔴 第一輪・復活倒數中</span>';
          countdownClass = 'counting';
          progressClass = '';
        }
        countdownHtml = formatDuration(Math.ceil(diffMs / 1000));

        detailsHtml = `
          <div class="detail-row">
            <span>目前階段：</span>
            <span class="detail-highlight">${roundTag}</span>
          </div>
          <div class="detail-row">
            <span>預計復活時間：</span>
            <span class="detail-highlight" style="color: var(--accent-cyan); font-weight: 700;">${respawnTimeStr}</span>
          </div>
          <div class="detail-row">
            <span>本輪起算時間：</span>
            <span class="detail-highlight">${phaseStartStr} (原始回報: ${rec.reporter || '未知'})</span>
          </div>
          ${rec.note ? `<div class="detail-row"><span>備註：</span><span class="detail-highlight">${escapeHtml(rec.note)}</span></div>` : ''}
        `;
      }
    } else {
      badgeHtml = '<span class="boss-status-badge" style="background: rgba(255,255,255,0.06); color: var(--text-muted);">⚪ 此伺服器尚未記錄</span>';
      countdownHtml = '--:--:--';
      detailsHtml = `
        <div class="detail-row">
          <span>目前選擇：</span>
          <span class="detail-highlight">[${state.activeServer}] ${boss.name}</span>
        </div>
        <div class="detail-row">
          <span>預設復活時間：</span>
          <span class="detail-highlight">${formatMinutes(boss.respawnMinutes)}</span>
        </div>
        <div class="detail-row">
          <span>狀態：</span>
          <span class="detail-highlight">尚未輸入打死時間（或已滿三輪未編輯自動刪除）</span>
        </div>
      `;
    }

    const defaultInputTime = toLocalDatetimeInputValue(new Date());

    const card = document.createElement('div');
    card.className = `boss-card ${statusClass}`;
    card.id = 'singleActiveBossCard';
    card.dataset.renderedRound = hasValidRec ? String(cycle.round) : '0';
    card.dataset.renderedAlive = hasValidRec ? String(cycle.diffMs <= 0) : 'false';
    card.dataset.renderedSoon = hasValidRec ? String(cycle.diffMs > 0 && cycle.diffMs <= state.alertThresholdMinutes * 60 * 1000) : 'false';

    card.innerHTML = `
      <div>
        <div class="boss-card-header">
          <div class="boss-name-group">
            <div class="boss-name" style="font-size: 1.45rem;">
              <span class="server-tag-huge" style="font-size: 1.45rem; margin-right: 4px;">[${state.activeServer}]</span>
              <span style="color: ${boss.color || 'var(--accent-cyan)'};">◆</span>
              <span>${boss.name}</span>
            </div>
            <div class="boss-meta-tags">
              <span class="meta-tag">預設週期: ${formatMinutes(boss.respawnMinutes)}</span>
              ${boss.location ? `<span class="meta-tag">📍 ${boss.location}</span>` : ''}
            </div>
          </div>
          <div>${badgeHtml}</div>
        </div>

        <div class="timer-display-area">
          <div class="countdown-main ${countdownClass}" id="singleBossCountdownText">
            ${countdownHtml}
          </div>
          <div class="timer-progress-track">
            <div class="timer-progress-fill ${progressClass}" id="singleBossProgressBar" style="width: ${progressPercent}%;"></div>
          </div>
        </div>

        <div class="card-details-info">
          ${detailsHtml}
        </div>

        <!-- Quick 1-Click Kill Button -->
        <div style="display: flex; gap: 10px; margin-bottom: 18px;">
          <button type="button" class="btn-record-kill" id="btnSingleQuickKill" style="flex: 1; padding: 12px; font-size: 1.05rem;">
            ⚡ 剛剛打死 [${state.activeServer}] ${boss.name}（重置為第一輪倒數 ${formatMinutes(boss.respawnMinutes)}）
          </button>
          ${hasValidRec ? `<button type="button" class="btn btn-danger" id="btnSingleClearKill" title="清除此服紀錄">🔄 清除紀錄</button>` : ''}
        </div>

        <!-- Custom Kill Time & Respawn Interval Form directly inside the single boss card -->
        <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px;">
          <div style="font-weight: 700; font-size: 0.92rem; color: var(--accent-cyan); margin-bottom: 12px;">
            ⏱️ 自訂輸入打死時間 & 設定王復活時間
          </div>

          <!-- Respawn Interval Setting -->
          <div class="form-group" style="margin-bottom: 12px;">
            <label class="form-label">選擇或輸入復活時間 (分鐘)：</label>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <input type="number" id="singleInputRespawnMins" class="form-input" style="width: 100px; padding: 6px 10px;" min="1" max="10080" value="${boss.respawnMinutes}">
              <span style="font-size: 0.85rem; color: var(--text-secondary);">分鐘</span>
              <div class="qr-preset-group" id="singleRespawnPresets">
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 30 ? 'active' : ''}" data-preset-min="30">30分鐘</button>
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 45 ? 'active' : ''}" data-preset-min="45">45分鐘</button>
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 60 ? 'active' : ''}" data-preset-min="60">1小時</button>
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 90 ? 'active' : ''}" data-preset-min="90">1.5小時</button>
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 120 ? 'active' : ''}" data-preset-min="120">2小時</button>
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 180 ? 'active' : ''}" data-preset-min="180">3小時</button>
                <button type="button" class="quick-tag-btn ${boss.respawnMinutes === 240 ? 'active' : ''}" data-preset-min="240">4小時</button>
              </div>
            </div>
          </div>

          <!-- Killed Time Input -->
          <div class="form-group" style="margin-bottom: 12px;">
            <label class="form-label">輸入打死時間：</label>
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <input type="datetime-local" id="singleInputKilledAt" class="form-input" step="1" value="${defaultInputTime}" style="flex: 1; min-width: 210px; padding: 7px 10px;">
              <button type="button" class="quick-tag-btn" data-time-offset="0">現在</button>
              <button type="button" class="quick-tag-btn" data-time-offset="-1">-1分</button>
              <button type="button" class="quick-tag-btn" data-time-offset="-3">-3分</button>
              <button type="button" class="quick-tag-btn" data-time-offset="-5">-5分</button>
              <button type="button" class="quick-tag-btn" data-time-offset="-10">-10分</button>
            </div>
          </div>

          <!-- Note & Submit -->
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <input type="text" id="singleInputNote" class="form-input" placeholder="備註 (選填，例如掉落物)" value="" style="flex: 1; min-width: 160px; padding: 8px 12px;">
            <button type="button" class="btn btn-primary" id="btnSingleSubmitCustom" style="padding: 9px 18px; font-weight: 700;">
              ✅ 記錄時間並開始倒數
            </button>
          </div>
        </div>
      </div>
    `;

    const inputRespawnMins = card.querySelector('#singleInputRespawnMins');
    const inputKilledAt = card.querySelector('#singleInputKilledAt');
    const inputNote = card.querySelector('#singleInputNote');

    card.querySelector('#btnSingleQuickKill').addEventListener('click', () => {
      saveBossRecord(state.activeServer, boss.id, Date.now(), boss.respawnMinutes, inputNote.value.trim());
    });

    const btnClear = card.querySelector('#btnSingleClearKill');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        clearBossRecord(state.activeServer, boss.id, boss.name);
      });
    }

    card.querySelectorAll('[data-preset-min]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.presetMin, 10);
        inputRespawnMins.value = mins;
        card.querySelectorAll('[data-preset-min]').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    card.querySelectorAll('[data-time-offset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const offsetMins = parseInt(btn.dataset.timeOffset, 10);
        inputKilledAt.value = toLocalDatetimeInputValue(new Date(Date.now() + offsetMins * 60000));
      });
    });

    card.querySelector('#btnSingleSubmitCustom').addEventListener('click', () => {
      const dtVal = inputKilledAt.value;
      const killedAt = dtVal ? new Date(dtVal).getTime() : Date.now();
      const mins = parseInt(inputRespawnMins.value, 10);
      if (isNaN(mins) || mins <= 0) {
        alert('請輸入大於 0 的復活時間分鐘數！');
        return;
      }
      saveBossRecord(state.activeServer, boss.id, killedAt, mins, inputNote.value.trim());
    });

    el.singleBossContainer.appendChild(card);
  }

  // Update the Single Boss Card timer in-place every second without losing form focus
  function updateSingleBossTimerInPlace() {
    const boss = getActiveBoss();
    if (!boss) return;
    const card = document.getElementById('singleActiveBossCard');
    if (!card) return;

    const now = Date.now();
    const serverRecords = state.records[state.activeServer] || {};
    const rec = serverRecords[boss.id];
    if (!rec) {
      if (card.dataset.renderedRound !== '0') renderSingleBossView();
      return;
    }

    const cycle = computeRecordCycle(rec, now);
    if (cycle.expired) {
      renderSingleBossView();
      return;
    }

    const isAlive = cycle.diffMs <= 0;
    const isSoon = cycle.diffMs > 0 && cycle.diffMs <= state.alertThresholdMinutes * 60 * 1000;

    if (
      card.dataset.renderedRound !== String(cycle.round) ||
      card.dataset.renderedAlive !== String(isAlive) ||
      card.dataset.renderedSoon !== String(isSoon)
    ) {
      renderSingleBossView();
      return;
    }

    const countdownEl = document.getElementById('singleBossCountdownText');
    const progressEl = document.getElementById('singleBossProgressBar');

    if (countdownEl) {
      if (isAlive) {
        const overdueSeconds = Math.floor(Math.abs(cycle.diffMs) / 1000);
        countdownEl.textContent = `已重生 +${formatDuration(overdueSeconds)}`;
      } else {
        const remainSeconds = Math.ceil(cycle.diffMs / 1000);
        countdownEl.textContent = formatDuration(remainSeconds);
      }
    }

    if (progressEl) {
      const totalDuration = Math.max(1000, cycle.phaseRespawnAt - cycle.phaseStartAt);
      const elapsed = now - cycle.phaseStartAt;
      const progressPercent = isAlive ? 100 : Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
      progressEl.style.width = `${progressPercent}%`;
    }
  }

  // Render Right-side Summary List of all active servers for the currently selected Boss
  function renderSingleBossServerList() {
    el.singleBossServerList.innerHTML = '';
    const boss = getActiveBoss();
    if (!boss) return;

    const now = Date.now();
    const activeItems = [];

    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv] || {};
      const rec = srvRecs[boss.id];
      if (rec) {
        const cycle = computeRecordCycle(rec, now);
        if (!cycle.expired) {
          activeItems.push({
            ...rec,
            cycle
          });
        }
      }
    });

    activeItems.sort((a, b) => a.cycle.diffMs - b.cycle.diffMs);
    el.lblActiveBossServerCount.textContent = `${activeItems.length} 個頻道`;

    if (activeItems.length === 0) {
      el.singleBossServerList.innerHTML = `
        <div class="empty-state" style="padding: 28px 12px;">
          <div style="font-size: 24px; margin-bottom: 6px;">🍄</div>
          <div>目前【${boss.name}】尚無倒數紀錄</div>
        </div>
      `;
      return;
    }

    activeItems.forEach(item => {
      const { cycle } = item;
      const row = document.createElement('div');
      const isAlive = cycle.diffMs <= 0;
      const isSoon = cycle.diffMs > 0 && cycle.diffMs <= state.alertThresholdMinutes * 60 * 1000;
      const sec = Math.ceil(Math.abs(cycle.diffMs) / 1000);

      let timerColor = 'var(--accent-cyan)';
      if (isAlive) {
        timerColor = cycle.round === 3 ? '#fb923c' : (cycle.round === 2 ? '#c084fc' : 'var(--accent-green)');
      } else if (isSoon) {
        timerColor = 'var(--accent-yellow)';
      } else if (cycle.round === 2) {
        timerColor = '#c084fc';
      } else if (cycle.round === 3) {
        timerColor = '#fb923c';
      }

      const timerStr = isAlive
        ? `已重生 +${formatDuration(sec)}`
        : formatDuration(sec);

      const roundBadge = getRoundTagHtml(cycle.round);
      const rowRoundClass = cycle.round === 2 ? 'row-round-2' : (cycle.round === 3 ? 'row-round-3' : '');

      row.className = `srv-summary-row ${rowRoundClass} ${item.serverId === state.activeServer ? 'active-srv' : ''}`;
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="radar-server-tag" style="min-width: 36px;">${item.serverId}</span>
          <div>
            <div style="font-family: var(--font-mono); font-weight: 800; font-size: 1rem; color: ${timerColor}; display: flex; align-items: center; flex-wrap: wrap;">
              <span>${timerStr}</span>
              ${roundBadge}
            </div>
            <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 2px;">
              預計 ${formatTime(new Date(cycle.phaseRespawnAt))} 復活 · 起算 ${formatTime(new Date(cycle.phaseStartAt))} (${item.reporter || '未知'})
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn btn-danger btn-sm" data-clear-srv="${item.serverId}" title="清除此服紀錄">✕</button>
        </div>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-clear-srv]')) return;
        selectServer(item.serverId);
      });

      row.querySelector(`[data-clear-srv="${item.serverId}"]`).addEventListener('click', (e) => {
        e.stopPropagation();
        clearBossRecord(item.serverId, boss.id, boss.name);
      });

      el.singleBossServerList.appendChild(row);
    });
  }

  // Save Boss Kill Record (Manual)
  async function saveBossRecord(serverId, bossId, killedAt, respawnMinutes, note) {
    try {
      const res = await apiFetch('/api/record', {
        method: 'POST',
        body: JSON.stringify({
          serverId,
          bossId,
          killedAt,
          respawnMinutes,
          note
        })
      });

      if (res.success) {
        showToast(`✅ 已記錄 [${serverId}] ${res.record.bossName} 打死時間，開始第一輪倒數 ${formatMinutes(respawnMinutes)}！`, 'success');
        if (!state.records[serverId]) state.records[serverId] = {};
        state.records[serverId][bossId] = res.record;
        delete state.deletedRecords[`${serverId}_${bossId}`];
        if (res.lastActivityAt) state.lastActivityAt = res.lastActivityAt;
        saveLocalCloudCache();
        refreshAllViews();
      }
    } catch (e) {
      showToast('紀錄失敗：' + e.message, 'error');
    }
  }

  // Clear Boss Record (Manual or 3-Round Auto Delete)
  async function clearBossRecord(serverId, bossId, bossName, isAutoDelete3R = false) {
    if (!isAutoDelete3R && !confirm(`確定要清除 [${serverId}] ${bossName} 的時間紀錄嗎？`)) return;

    try {
      const res = await apiFetch('/api/record/clear', {
        method: 'POST',
        body: JSON.stringify({
          serverId,
          bossId,
          isAutoDelete3R
        })
      });

      if (res.success) {
        if (isAutoDelete3R) {
          showToast(`🗑️ [${serverId}] ${bossName} 已連續三輪無手動編輯，系統已自動刪除紀錄（請重新找王時間）！`, 'warn');
        } else {
          showToast(`已重設 [${serverId}] ${bossName} 紀錄`, 'info');
        }
        if (state.records[serverId]) {
          delete state.records[serverId][bossId];
        }
        state.deletedRecords[`${serverId}_${bossId}`] = res.deletedAt || Date.now();
        if (res.lastActivityAt) state.lastActivityAt = res.lastActivityAt;
        saveLocalCloudCache();
        refreshAllViews();
      }
    } catch (e) {
      if (!isAutoDelete3R) showToast('清除失敗：' + e.message, 'error');
    }
  }

  // Reset ALL Channels (Manual or 3-Hour Inactivity Auto-Reset)
  async function resetAllChannels(isAuto = false) {
    if (!isAuto && !confirm('確定要將 S1 ~ S60 所有頻道的王怪紀錄全部重置清空嗎？')) return;

    try {
      const res = await apiFetch('/api/record/reset-all', {
        method: 'POST',
        body: JSON.stringify({ isAuto })
      });
      if (res.success) {
        state.records = {};
        state.lastResetAllAt = res.lastResetAllAt || Date.now();
        state.lastActivityAt = res.lastActivityAt || Date.now();
        saveLocalCloudCache();
        showToast(
          isAuto
            ? '⏰ 已超過 3 小時未刪改任何資料，系統已自動將所有頻道重置！'
            : '🧹 已將所有頻道紀錄重置清空！',
          'warn'
        );
        refreshAllViews();
      }
    } catch (e) {
      if (!isAuto) showToast('重置失敗：' + e.message, 'error');
    }
  }

  // Render Cross-Server Radar View
  function renderRadarView() {
    el.radarTableBody.innerHTML = '';
    const now = Date.now();
    const allItems = [];

    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv] || {};
      Object.values(srvRecs).forEach(rec => {
        if (!rec) return;
        const cycle = computeRecordCycle(rec, now);
        if (!cycle.expired && cycle.diffMs <= 15 * 60 * 1000) {
          allItems.push({
            ...rec,
            cycle
          });
        }
      });
    });

    allItems.sort((a, b) => a.cycle.diffMs - b.cycle.diffMs);

    if (allItems.length === 0) {
      el.radarTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <div class="empty-icon">📡</div>
            <div>目前跨服 S1~S60 皆無 15 分鐘內即將復活或已重生之王怪</div>
          </td>
        </tr>
      `;
      return;
    }

    allItems.forEach(item => {
      const { cycle } = item;
      const tr = document.createElement('tr');
      const isAlive = cycle.diffMs <= 0;
      const remainSec = Math.ceil(Math.abs(cycle.diffMs) / 1000);

      const statusBadge = isAlive
        ? '<span class="boss-status-badge badge-alive">🟢 已重生</span>'
        : '<span class="boss-status-badge badge-soon">⚠️ 即將復活</span>';

      const countdownText = isAlive
        ? `+${formatDuration(remainSec)}`
        : formatDuration(remainSec);

      tr.innerHTML = `
        <td><span class="radar-server-tag">${item.serverId}</span></td>
        <td style="font-weight: 700;">${item.bossName} ${getRoundTagHtml(cycle.round)}</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: ${isAlive ? 'var(--accent-green)' : 'var(--accent-yellow)'}">${countdownText}</td>
        <td>${formatTime(new Date(cycle.phaseRespawnAt))}</td>
        <td>${formatTime(new Date(cycle.phaseStartAt))} (${item.reporter || '未知'})</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-jump-srv="${item.serverId}" data-jump-boss="${item.bossId}">
            前往 ${item.serverId}
          </button>
        </td>
      `;

      tr.querySelector(`[data-jump-srv="${item.serverId}"]`).addEventListener('click', () => {
        switchView('server');
        selectBoss(item.bossId);
        selectServer(item.serverId);
      });

      el.radarTableBody.appendChild(tr);
    });
  }

  // Render History View
  function renderHistoryView() {
    el.historyTableBody.innerHTML = '';
    if (!state.logs || state.logs.length === 0) {
      el.historyTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <div class="empty-icon">📜</div>
            <div>尚無回報紀錄</div>
          </td>
        </tr>
      `;
      return;
    }

    state.logs.forEach(log => {
      const tr = document.createElement('tr');
      let typeHtml = '<span style="color: var(--text-muted)">清除重設</span>';
      if (log.type === 'KILL') {
        typeHtml = '<span style="color: var(--accent-green)">擊殺回報</span>';
      } else if (log.type === 'AUTO_30M') {
        typeHtml = '<span style="color: #c084fc">🟣 自動進入下一輪(30分)</span>';
      } else if (log.type === 'AUTO_DEL_3R') {
        typeHtml = '<span style="color: #fb923c">🗑️ 滿三輪未編輯自動刪除</span>';
      } else if (log.type === 'AUTO_RESET_3H') {
        typeHtml = '<span style="color: var(--accent-red)">⏰ 閒置3小時全服重置</span>';
      }

      tr.innerHTML = `
        <td>${formatDateTime(new Date(log.timestamp))}</td>
        <td><span class="radar-server-tag">${log.serverId}</span></td>
        <td style="font-weight: 700;">${log.bossName}</td>
        <td>${typeHtml}</td>
        <td>${log.respawnMinutes ? formatMinutes(log.respawnMinutes) : '-'}</td>
        <td>${log.respawnAt ? formatTime(new Date(log.respawnAt)) : '-'}</td>
        <td><span class="user-name-highlight">${log.reporter}</span></td>
      `;
      el.historyTableBody.appendChild(tr);
    });
  }

  // Switch View Tab
  function switchView(viewName) {
    state.currentView = viewName;
    el.tabServerView.classList.toggle('active', viewName === 'server');
    el.tabRadarView.classList.toggle('active', viewName === 'radar');
    el.tabHistoryView.classList.toggle('active', viewName === 'history');

    el.sectionServerView.style.display = viewName === 'server' ? 'block' : 'none';
    el.sectionRadarView.style.display = viewName === 'radar' ? 'block' : 'none';
    el.sectionHistoryView.style.display = viewName === 'history' ? 'block' : 'none';

    if (viewName === 'server') {
      renderSingleBossView();
      renderSingleBossServerList();
    }
    if (viewName === 'radar') renderRadarView();
    if (viewName === 'history') renderHistoryView();
  }

  // Live Timer Countdown Ticker (Every 1 second)
  function startCountdownTicker() {
    if (state.tickerId) clearInterval(state.tickerId);
    state.tickerId = setInterval(() => {
      tick();
    }, 1000);
  }

  function tick() {
    if (!state.currentUser) return;
    const now = Date.now();
    const threshMs = state.alertThresholdMinutes * 60 * 1000;

    // Rule 1: Check 3-hour inactivity auto-reset
    if (hasAnyActiveRecords()) {
      const remainResetMs = (state.lastActivityAt + THREE_HOURS_MS) - now;
      if (remainResetMs <= 0) {
        resetAllChannels(true);
        return;
      }
      if (el.lblInactivityTimer) {
        el.lblInactivityTimer.textContent = formatDuration(Math.ceil(remainResetMs / 1000));
      }
    } else {
      if (el.lblInactivityTimer) {
        el.lblInactivityTimer.textContent = '無紀錄';
      }
    }

    // Rule 2 & Alerts: Check 3-Round transitions & expiration across all servers
    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv];
      if (!srvRecs) return;

      Object.values(srvRecs).forEach(rec => {
        if (!rec) return;
        const cycle = computeRecordCycle(rec, now);

        // If 3 rounds have finished without manual edit -> Auto-Delete!
        if (cycle.expired) {
          delete srvRecs[rec.bossId];
          clearBossRecord(srv, rec.bossId, rec.bossName, true);
          return;
        }

        // Notify when transitioning into Round 2 or Round 3
        const roundKey = `${srv}_${rec.bossId}_${rec.baseKilledAt || rec.killedAt}_r${cycle.round}`;
        if (!state.notifiedRoundCache.has(roundKey)) {
          state.notifiedRoundCache.add(roundKey);
          if (cycle.round === 2) {
            showToast(`🟣 [${srv}] ${rec.bossName} 重生滿 15 分鐘未編輯，已進入「第二輪」倒數 30 分鐘！`, 'warn');
          } else if (cycle.round === 3) {
            showToast(`🟠 [${srv}] ${rec.bossName} 已進入「第三輪(最終輪)」倒數 30 分鐘（若再無編輯將自動刪除）！`, 'warn');
          }
        }

        const diffMs = cycle.diffMs;
        const cacheKey0m = `${srv}_${rec.bossId}_${cycle.phaseRespawnAt}_0m`;
        const cacheKey1m = `${srv}_${rec.bossId}_${cycle.phaseRespawnAt}_1m`;
        const cacheKeyThresh = `${srv}_${rec.bossId}_${cycle.phaseRespawnAt}_thresh`;

        if (diffMs <= 0 && !state.alertedCache.has(cacheKey0m)) {
          state.alertedCache.add(cacheKey0m);
          triggerAlert(srv, `${rec.bossName} (第${cycle.round}輪)`, 0);
        } else if (diffMs > 0 && diffMs <= 60 * 1000 && !state.alertedCache.has(cacheKey1m)) {
          state.alertedCache.add(cacheKey1m);
          triggerAlert(srv, `${rec.bossName} (第${cycle.round}輪)`, 1);
        } else if (diffMs > 60 * 1000 && diffMs <= threshMs && !state.alertedCache.has(cacheKeyThresh)) {
          state.alertedCache.add(cacheKeyThresh);
          triggerAlert(srv, `${rec.bossName} (第${cycle.round}輪)`, Math.ceil(diffMs / 60000));
        }
      });
    });

    // Update UI for active view
    if (state.currentView === 'server') {
      updateSingleBossTimerInPlace();
      renderSingleBossServerList();
    } else if (state.currentView === 'radar') {
      renderRadarView();
    }
    renderServerGridBadges();
  }

  // Trigger Sound, Voice, and Desktop Notification
  function triggerAlert(server, bossName, minutesRemaining) {
    if (window.soundEngine) {
      window.soundEngine.notifyBoss(server, bossName, minutesRemaining);
    }

    const title = minutesRemaining <= 0
      ? `⚔️ [${server}] ${bossName} 已經復活重生！`
      : `⚠️ [${server}] ${bossName} 即將在 ${minutesRemaining} 分鐘後復活！`;

    showToast(title, minutesRemaining <= 0 ? 'success' : 'warn');

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: `請前往 ${server} 準備擊殺！`
        });
      } catch (e) {}
    }
  }

  // Boss Manager (Add / Edit / Delete Bosses & Respawn Intervals)
  function renderBossManagerList() {
    el.bossSettingsList.innerHTML = '';
    state.config.bosses.forEach(boss => {
      const item = document.createElement('div');
      item.style.cssText = 'background: rgba(255,255,255,0.04); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px;';
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <div style="font-weight: 700; font-size: 1rem; color: ${boss.color || 'var(--text-primary)'}">
              ◆ ${boss.name}
            </div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 2px;">
              預設復活時間: <strong style="color: var(--accent-cyan);">${formatMinutes(boss.respawnMinutes)}</strong>
              ${boss.location ? ` | 地點: ${boss.location}` : ''}
              ${boss.note ? ` | 備忘: ${boss.note}` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button class="quick-tag-btn ${boss.respawnMinutes === 30 ? 'active' : ''}" data-set-boss-min="30">30分</button>
            <button class="quick-tag-btn ${boss.respawnMinutes === 45 ? 'active' : ''}" data-set-boss-min="45">45分</button>
            <button class="quick-tag-btn ${boss.respawnMinutes === 60 ? 'active' : ''}" data-set-boss-min="60">1小時</button>
            <button class="quick-tag-btn ${boss.respawnMinutes === 90 ? 'active' : ''}" data-set-boss-min="90">1.5小時</button>
            <button class="quick-tag-btn ${boss.respawnMinutes === 120 ? 'active' : ''}" data-set-boss-min="120">2小時</button>
            <button class="btn btn-secondary btn-sm" data-custom-boss-min="${boss.id}">自訂分鐘</button>
            <button class="btn btn-danger btn-sm" data-del-boss="${boss.id}">刪除</button>
          </div>
        </div>
      `;

      item.querySelectorAll('[data-set-boss-min]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const newMins = parseInt(btn.dataset.setBossMin, 10);
          await updateBossDefinition({ ...boss, respawnMinutes: newMins });
        });
      });

      item.querySelector(`[data-custom-boss-min="${boss.id}"]`).addEventListener('click', async () => {
        const input = prompt(`請輸入「${boss.name}」的復活時間 (分鐘數)：`, boss.respawnMinutes);
        if (input === null) return;
        const newMins = parseInt(input, 10);
        if (isNaN(newMins) || newMins <= 0) {
          alert('請輸入大於 0 的有效分鐘數！');
          return;
        }
        await updateBossDefinition({ ...boss, respawnMinutes: newMins });
      });

      item.querySelector(`[data-del-boss="${boss.id}"]`).addEventListener('click', async () => {
        if (state.config.bosses.length <= 1) {
          alert('請至少保留一隻王怪！');
          return;
        }
        if (!confirm(`確定要刪除王怪「${boss.name}」嗎？`)) return;
        try {
          const res = await apiFetch('/api/bosses', {
            method: 'POST',
            body: JSON.stringify({ action: 'delete', boss: { id: boss.id } })
          });
          if (res.success) {
            state.config.bosses = state.config.bosses.filter(b => b.id !== boss.id);
            saveLocalCloudCache();
            getActiveBoss();
            renderBossManagerList();
            refreshAllViews();
            showToast('已刪除王怪', 'info');
          }
        } catch (e) {
          showToast('刪除失敗：' + e.message, 'error');
        }
      });

      el.bossSettingsList.appendChild(item);
    });
  }

  async function updateBossDefinition(updatedBoss) {
    try {
      const res = await apiFetch('/api/bosses', {
        method: 'POST',
        body: JSON.stringify({
          action: 'edit',
          boss: updatedBoss
        })
      });
      if (res.success) {
        const idx = state.config.bosses.findIndex(b => b.id === updatedBoss.id);
        if (idx !== -1) state.config.bosses[idx] = res.boss;
        saveLocalCloudCache();
        renderBossManagerList();
        refreshAllViews();
        showToast(`✅ 已將「${updatedBoss.name}」預設復活時間設為 ${formatMinutes(updatedBoss.respawnMinutes)}`, 'success');
      }
    } catch (e) {
      showToast('修改失敗：' + e.message, 'error');
    }
  }

  async function createNewBoss(name, minutes, location = '', note = '') {
    if (!name) {
      alert('請填寫王怪名稱！');
      return false;
    }
    if (isNaN(minutes) || minutes <= 0) {
      alert('請填寫大於 0 的復活分鐘數（例如: 30、45 或 60）！');
      return false;
    }

    try {
      const res = await apiFetch('/api/bosses', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add',
          boss: { name, respawnMinutes: minutes, location, note }
        })
      });

      if (res.success) {
        showToast(`✅ 成功新增王怪「${name}」 (復活時間 ${formatMinutes(minutes)})！`, 'success');
        state.config.bosses.push(res.boss);
        saveLocalCloudCache();
        selectBoss(res.boss.id);
        renderBossManagerList();
        return true;
      }
    } catch (e) {
      showToast('新增失敗：' + e.message, 'error');
    }
    return false;
  }

  // Network Share Modal
  async function openShareModal() {
    el.networkLinksContainer.innerHTML = '';
    el.modalShare.style.display = 'flex';

    addShareLink('🌐 GitHub 公開網頁版 (跨網路隨時可用)', 'https://nono86433.github.io/boss-timer/');

    if (!isGitHubPages) {
      try {
        const res = await fetch('/api/network-info');
        const data = await res.json();
        addShareLink('本機瀏覽器', `http://localhost:${data.port}`);
        data.addresses.forEach(ip => {
          addShareLink(`手機 / 區域網路共享 (Wi-Fi / Radmin)`, `http://${ip}:${data.port}`);
        });
      } catch (e) {}
    }
  }

  function addShareLink(label, url) {
    const row = document.createElement('div');
    row.style.cssText = 'background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;';
    row.innerHTML = `
      <div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${label}</div>
        <div style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 700; color: var(--accent-cyan);">${url}</div>
      </div>
      <button class="btn btn-secondary btn-sm" data-copy="${url}">複製網址</button>
    `;

    row.querySelector(`[data-copy="${url}"]`).addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        showToast('已複製網址到剪貼簿！可直接傳給森森或啞啞', 'success');
      });
    });

    el.networkLinksContainer.appendChild(row);
  }

  // Utility: Show Toast
  function showToast(text, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${text}</span>`;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(60px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  // Format Helpers
  function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatShortDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  function formatTime(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatDateTime(d) {
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${m}/${day} ${formatTime(d)}`;
  }

  function formatMinutes(minutes) {
    if (minutes < 60) return `${minutes} 分鐘`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h} 小時 ${m} 分` : `${h} 小時`;
  }

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function toLocalDatetimeInputValue(date) {
    const tzOffset = date.getTimezoneOffset() * 60000;
    const localISOTime = new Date(date.getTime() - tzOffset).toISOString().slice(0, 19);
    return localISOTime;
  }

  // Bind All UI Event Listeners
  function bindEvents() {
    el.btnSubmitAuth.addEventListener('click', () => submitAuth());
    el.inputAuthName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitAuth();
    });
    el.btnSwitchUser.addEventListener('click', () => promptAuth());

    // Manual Sync Buttons & Tab Focus Auto-Sync
    if (el.btnManualSync) {
      el.btnManualSync.addEventListener('click', () => syncNow(true));
    }
    if (el.btnListSync) {
      el.btnListSync.addEventListener('click', () => syncNow(true));
    }
    window.addEventListener('focus', () => {
      if (state.currentUser) syncNow(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.currentUser) {
        syncNow(false);
      }
    });

    // Inline Quick Add Boss at the very top
    if (el.btnInlineAddBoss) {
      el.btnInlineAddBoss.addEventListener('click', async () => {
        const name = el.inlineNewBossName.value.trim();
        const mins = parseInt(el.inlineNewBossMinutes.value, 10);
        const ok = await createNewBoss(name, mins);
        if (ok) el.inlineNewBossName.value = '';
      });
      el.inlineNewBossName.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          const name = el.inlineNewBossName.value.trim();
          const mins = parseInt(el.inlineNewBossMinutes.value, 10);
          const ok = await createNewBoss(name, mins);
          if (ok) el.inlineNewBossName.value = '';
        }
      });
    }

    // Reset All Channels Button
    if (el.btnResetAllChannels) {
      el.btnResetAllChannels.addEventListener('click', () => resetAllChannels(false));
    }

    // Chat Room Events
    if (el.btnSendChat) {
      el.btnSendChat.addEventListener('click', () => sendChatMessage());
    }
    if (el.inputChatMessage) {
      el.inputChatMessage.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChatMessage();
      });
    }
    if (el.chatQuickPhrases) {
      el.chatQuickPhrases.querySelectorAll('[data-chat-phrase]').forEach(btn => {
        btn.addEventListener('click', () => {
          const phrase = `[${state.activeServer}] ${btn.dataset.chatPhrase}`;
          sendChatMessage(phrase);
        });
      });
    }

    // Range tabs
    el.serverRangeTabs.querySelectorAll('.range-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.serverRangeTabs.querySelectorAll('.range-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterServerRange(btn.dataset.range);
      });
    });

    // Views
    el.tabServerView.addEventListener('click', () => switchView('server'));
    el.tabRadarView.addEventListener('click', () => switchView('radar'));
    el.tabHistoryView.addEventListener('click', () => switchView('history'));

    // Sound, voice, and alert threshold toggles
    el.btnToggleSound.addEventListener('click', () => {
      window.soundEngine.enabled = !window.soundEngine.enabled;
      el.btnToggleSound.classList.toggle('muted', !window.soundEngine.enabled);
      showToast(window.soundEngine.enabled ? '🔔 提示音效已開啟' : '🔕 提示音效已關閉', 'info');
    });

    el.btnToggleVoice.addEventListener('click', () => {
      window.soundEngine.voiceEnabled = !window.soundEngine.voiceEnabled;
      el.btnToggleVoice.classList.toggle('muted', !window.soundEngine.voiceEnabled);
      showToast(window.soundEngine.voiceEnabled ? '🗣️ 國語語音播報已開啟' : '🔇 語音播報已關閉', 'info');
    });

    if (el.selectAlertMinutes) {
      el.selectAlertMinutes.value = String(state.alertThresholdMinutes);
      el.selectAlertMinutes.addEventListener('change', () => {
        state.alertThresholdMinutes = parseInt(el.selectAlertMinutes.value, 10) || 5;
        localStorage.setItem('boss_alert_minutes', String(state.alertThresholdMinutes));
        refreshAllViews();
        showToast(`⏰ 已設定於王復活前 ${state.alertThresholdMinutes} 分鐘發出提醒！`, 'info');
      });
    }

    el.btnTestSound.addEventListener('click', () => {
      const boss = getActiveBoss();
      const bName = boss ? boss.name : '蘑菇王';
      window.soundEngine.playChime('urgent');
      window.soundEngine.speak(`測試提醒：${state.activeServer} 的 ${bName} 即將在 ${state.alertThresholdMinutes} 分鐘後重生！`);
      showToast('🔊 已播放測試音效與語音提醒', 'info');
    });

    // Boss Manager Modal
    const openBossManager = () => {
      renderBossManagerList();
      el.modalBossManager.style.display = 'flex';
    };
    el.btnOpenBossManager.addEventListener('click', openBossManager);
    el.btnQuickAddBoss.addEventListener('click', openBossManager);
    el.btnCloseBossManager.addEventListener('click', () => el.modalBossManager.style.display = 'none');
    el.btnDoneBossManager.addEventListener('click', () => el.modalBossManager.style.display = 'none');

    if (el.newBossRespawnPresets) {
      el.newBossRespawnPresets.querySelectorAll('[data-new-respawn]').forEach(btn => {
        btn.addEventListener('click', () => {
          el.inputNewBossMinutes.value = btn.dataset.newRespawn;
        });
      });
    }

    el.btnSubmitNewBoss.addEventListener('click', async () => {
      const name = el.inputNewBossName.value.trim();
      const minutes = parseInt(el.inputNewBossMinutes.value, 10);
      const location = el.inputNewBossLoc.value.trim();
      const note = el.inputNewBossNote.value.trim();

      const ok = await createNewBoss(name, minutes, location, note);
      if (ok) {
        el.inputNewBossName.value = '';
        el.inputNewBossMinutes.value = '';
        el.inputNewBossLoc.value = '';
        el.inputNewBossNote.value = '';
      }
    });

    // Share modal
    el.btnOpenShare.addEventListener('click', openShareModal);
    el.btnCloseShare.addEventListener('click', () => el.modalShare.style.display = 'none');
    el.btnDoneShare.addEventListener('click', () => el.modalShare.style.display = 'none');
  }

  // Initialize App
  function init() {
    bindEvents();
    liveSocket.connect();
    checkAuth();
  }

  init();
})();
