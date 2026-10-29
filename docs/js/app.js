// Main Application Logic for Boss Respawn Tracker (Single-Boss Focused Mode + 3H Reset + 61M->30M + 24H Chat)
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
    logs: [],
    chats: [],
    lastActivityAt: parseInt(localStorage.getItem('boss_last_activity') || String(Date.now()), 10),
    activeBossId: localStorage.getItem('boss_active_id') || 'boss_mushmom',
    activeServer: localStorage.getItem('boss_active_server') || 'S1',
    currentView: 'server', // 'server' | 'radar' | 'history'
    alertThresholdMinutes: parseInt(localStorage.getItem('boss_alert_minutes') || '5', 10),
    alertedCache: new Set(),
    tickerId: null
  };

  // DOM Elements
  const el = {
    mainAppContent: document.getElementById('mainAppContent'),
    lblUserName: document.getElementById('lblUserName'),
    btnSwitchUser: document.getElementById('btnSwitchUser'),
    connStatus: document.getElementById('connStatus'),
    connDot: document.getElementById('connDot'),
    connText: document.getElementById('connText'),
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

  // Get currently selected Boss object
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

  // Count total active records across all servers and bosses
  function hasAnyActiveRecords() {
    for (const srv of Object.keys(state.records)) {
      const srvRecs = state.records[srv];
      if (srvRecs && Object.keys(srvRecs).length > 0) return true;
    }
    return false;
  }

  // Persist state to localStorage (ensures data survives page reloads & code updates)
  function saveLocalCloudCache() {
    try {
      localStorage.setItem('boss_cloud_config', JSON.stringify(state.config));
      localStorage.setItem('boss_cloud_records', JSON.stringify(state.records));
      localStorage.setItem('boss_cloud_logs', JSON.stringify(state.logs.slice(0, 200)));
      localStorage.setItem('boss_cloud_chats', JSON.stringify(state.chats.slice(-300)));
      localStorage.setItem('boss_last_activity', String(state.lastActivityAt));
    } catch (e) {}
  }

  // Merge bosses non-destructively so code updates never wipe user-added bosses
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
    if (msg.type === 'RECORD_UPDATED') {
      const rec = msg.record;
      if (!state.records[rec.serverId]) state.records[rec.serverId] = {};
      state.records[rec.serverId][rec.bossId] = rec;

      if (!msg.isAutoAdjust) {
        state.lastActivityAt = msg.lastActivityAt || Date.now();
      }

      if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
        state.logs.unshift(msg.log);
        if (state.logs.length > 200) state.logs.pop();
      }
      saveLocalCloudCache();

      if (msg.isAutoAdjust) {
        showToast(`⚡ [${rec.serverId}] ${rec.bossName} 重生後 15 分鐘未編輯，自動改為倒數 30 分鐘！`, 'warn');
      } else {
        showToast(`📢 ${rec.reporter} 更新了 [${rec.serverId}] ${rec.bossName} 的打死時間！`, 'info');
      }

      renderTopBossTabs();
      renderServerGridBadges();
      if (state.currentView === 'server') {
        renderSingleBossView();
        renderSingleBossServerList();
      }
      if (state.currentView === 'radar') renderRadarView();
      if (state.currentView === 'history') renderHistoryView();
    } else if (msg.type === 'RECORD_CLEARED') {
      if (state.records[msg.serverId]) {
        delete state.records[msg.serverId][msg.bossId];
      }
      state.lastActivityAt = msg.lastActivityAt || Date.now();
      if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
        state.logs.unshift(msg.log);
      }
      saveLocalCloudCache();

      const bName = msg.bossName || (msg.log && msg.log.bossName) || '王怪';
      const rep = msg.reporter || (msg.log && msg.log.reporter) || '';
      showToast(`🔄 [${msg.serverId}] ${bName} 紀錄已被 ${rep} 清除`, 'info');
      renderTopBossTabs();
      renderServerGridBadges();
      if (state.currentView === 'server') {
        renderSingleBossView();
        renderSingleBossServerList();
      }
      if (state.currentView === 'radar') renderRadarView();
      if (state.currentView === 'history') renderHistoryView();
    } else if (msg.type === 'ALL_RECORDS_RESET') {
      state.records = {};
      state.lastActivityAt = msg.lastActivityAt || Date.now();
      if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
        state.logs.unshift(msg.log);
      }
      saveLocalCloudCache();

      showToast('⏰ 所有頻道紀錄已重置清空！', 'warn');
      renderTopBossTabs();
      renderServerGridBadges();
      if (state.currentView === 'server') {
        renderSingleBossView();
        renderSingleBossServerList();
      }
      if (state.currentView === 'radar') renderRadarView();
      if (state.currentView === 'history') renderHistoryView();
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
      renderTopBossTabs();
      renderBossManagerList();
      renderServerGridBadges();
      renderSingleBossView();
      renderSingleBossServerList();
      showToast('⚙️ 王怪與復活時間設定已同步更新！', 'success');
    }
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
        const savedLogs = localStorage.getItem('boss_cloud_logs');
        if (savedLogs) state.logs = JSON.parse(savedLogs);
        const savedChats = localStorage.getItem('boss_cloud_chats');
        if (savedChats) state.chats = JSON.parse(savedChats);
        const savedAct = localStorage.getItem('boss_last_activity');
        if (savedAct) state.lastActivityAt = parseInt(savedAct, 10) || Date.now();
      } catch (e) {}

      // Fetch recent events from ntfy.sh cloud history (24h window) without wiping local data
      try {
        const res = await fetch(`https://ntfy.sh/${liveSocket.cloudTopic}/json?poll=1&since=24h`);
        const text = await res.text();
        const lines = text.trim().split('\n').filter(Boolean);
        lines.forEach(line => {
          try {
            const evt = JSON.parse(line);
            if (evt.event === 'message' && evt.message) {
              const msg = JSON.parse(evt.message);
              if (msg.type === 'RECORD_UPDATED' && msg.record) {
                const r = msg.record;
                if (!state.records[r.serverId]) state.records[r.serverId] = {};
                const existing = state.records[r.serverId][r.bossId];
                if (!existing || (r.updatedAt || 0) >= (existing.updatedAt || 0)) {
                  state.records[r.serverId][r.bossId] = r;
                }
                if (!msg.isAutoAdjust && msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
                  state.logs.unshift(msg.log);
                }
              } else if (msg.type === 'RECORD_CLEARED') {
                if (state.records[msg.serverId]) delete state.records[msg.serverId][msg.bossId];
                if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
                  state.logs.unshift(msg.log);
                }
              } else if (msg.type === 'ALL_RECORDS_RESET') {
                state.records = {};
                if (msg.lastActivityAt && msg.lastActivityAt > state.lastActivityAt) {
                  state.lastActivityAt = msg.lastActivityAt;
                }
                if (msg.log && !state.logs.some(l => l.id === msg.log.id)) {
                  state.logs.unshift(msg.log);
                }
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
        pruneOldChatsInState();
        saveLocalCloudCache();
      } catch (e) {}

      return {
        success: true,
        config: state.config,
        records: state.records,
        logs: state.logs.slice(0, 100),
        chats: state.chats,
        lastActivityAt: state.lastActivityAt
      };
    }

    if (endpoint === '/api/record') {
      const { serverId, bossId, killedAt, respawnMinutes, note, isAutoAdjust } = body;
      const kTime = killedAt ? Number(killedAt) : Date.now();
      const rMinutes = Number(respawnMinutes) > 0 ? Number(respawnMinutes) : 45;
      const respawnAt = kTime + rMinutes * 60 * 1000;
      const bossDef = state.config.bosses.find(b => b.id === bossId) || { name: bossId };
      const reporter = isAutoAdjust ? '系統自動(重生15分轉倒數30分)' : state.currentUser;

      const recordEntry = {
        serverId,
        bossId,
        bossName: bossDef.name,
        killedAt: kTime,
        respawnMinutes: rMinutes,
        respawnAt,
        reporter,
        note: note || '',
        autoAdjusted30m: Boolean(isAutoAdjust),
        updatedAt: Date.now()
      };

      if (!state.records[serverId]) state.records[serverId] = {};
      state.records[serverId][bossId] = recordEntry;

      if (!isAutoAdjust) {
        state.lastActivityAt = Date.now();
      }

      const logEntry = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        type: isAutoAdjust ? 'AUTO_30M' : 'KILL',
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
      state.logs.unshift(logEntry);
      if (state.logs.length > 200) state.logs.pop();
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'RECORD_UPDATED',
        record: recordEntry,
        log: logEntry,
        lastActivityAt: state.lastActivityAt,
        isAutoAdjust: Boolean(isAutoAdjust)
      });

      return { success: true, record: recordEntry, lastActivityAt: state.lastActivityAt };
    }

    if (endpoint === '/api/record/clear') {
      const { serverId, bossId } = body;
      const bossDef = state.config.bosses.find(b => b.id === bossId) || { name: bossId };
      if (state.records[serverId]) delete state.records[serverId][bossId];
      state.lastActivityAt = Date.now();

      const logEntry = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        type: 'CLEAR',
        serverId,
        bossId,
        bossName: bossDef.name,
        reporter: state.currentUser,
        timestamp: Date.now()
      };
      state.logs.unshift(logEntry);
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'RECORD_CLEARED',
        serverId,
        bossId,
        bossName: bossDef.name,
        reporter: state.currentUser,
        lastActivityAt: state.lastActivityAt,
        log: logEntry
      });

      return { success: true, lastActivityAt: state.lastActivityAt };
    }

    if (endpoint === '/api/record/reset-all') {
      const { isAuto } = body;
      state.records = {};
      state.lastActivityAt = Date.now();

      const logEntry = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        type: isAuto ? 'AUTO_RESET_3H' : 'CLEAR',
        serverId: 'ALL',
        bossId: 'ALL',
        bossName: '全頻道',
        reporter: isAuto ? '系統自動(閒置3小時重置)' : state.currentUser,
        timestamp: Date.now()
      };
      state.logs.unshift(logEntry);
      saveLocalCloudCache();

      liveSocket.broadcastCloud({
        type: 'ALL_RECORDS_RESET',
        lastActivityAt: state.lastActivityAt,
        log: logEntry
      });

      return { success: true, lastActivityAt: state.lastActivityAt };
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
        state.records = data.records || {};
        state.logs = data.logs || [];
        state.chats = data.chats || [];
        if (data.lastActivityAt) {
          state.lastActivityAt = data.lastActivityAt;
        }
        pruneOldChatsInState();
        saveLocalCloudCache();

        // Pre-seed alertedCache for bosses that already spawned > 1 minute ago
        const now = Date.now();
        state.config.servers.forEach(srv => {
          const srvRecs = state.records[srv] || {};
          Object.values(srvRecs).forEach(rec => {
            if (rec && rec.respawnAt && rec.respawnAt - now < -60000) {
              state.alertedCache.add(`${srv}_${rec.bossId}_${rec.respawnAt}_0m`);
              state.alertedCache.add(`${srv}_${rec.bossId}_${rec.respawnAt}_1m`);
              state.alertedCache.add(`${srv}_${rec.bossId}_${rec.respawnAt}_thresh`);
            }
          });
        });

        getActiveBoss();
        renderTopBossTabs();
        renderServerButtons();
        selectBoss(state.activeBossId);
        renderChatMessages();
        startCountdownTicker();

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

  // Update dots & mini timers on S1~S60 ONLY for the currently selected Boss
  function renderServerGridBadges() {
    const now = Date.now();
    const activeBoss = getActiveBoss();
    let totalRadarCount = 0;

    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv] || {};
      Object.values(srvRecs).forEach(r => {
        if (r && r.respawnAt && (r.respawnAt - now) <= state.alertThresholdMinutes * 60 * 1000) {
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

      if (rec && rec.respawnAt) {
        const diffMs = rec.respawnAt - now;
        if (diffMs <= 0) {
          dot.className = 'server-badge-dot alive';
          dot.style.display = 'block';
          miniTimer.textContent = '已重生';
          miniTimer.className = 'server-mini-timer alive';
        } else if (diffMs <= state.alertThresholdMinutes * 60 * 1000) {
          dot.className = 'server-badge-dot soon';
          dot.style.display = 'block';
          miniTimer.textContent = formatShortDuration(Math.ceil(diffMs / 1000));
          miniTimer.className = 'server-mini-timer soon';
        } else {
          dot.style.display = 'none';
          miniTimer.textContent = formatShortDuration(Math.ceil(diffMs / 1000));
          miniTimer.className = 'server-mini-timer counting';
        }
      } else {
        dot.style.display = 'none';
        miniTimer.textContent = '';
        miniTimer.className = 'server-mini-timer';
      }
    });
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
    const currentRespawnMins = rec ? rec.respawnMinutes : boss.respawnMinutes;

    let statusClass = '';
    let badgeHtml = '';
    let countdownHtml = '';
    let countdownClass = '';
    let progressPercent = 0;
    let progressClass = '';
    let detailsHtml = '';

    if (rec && rec.respawnAt) {
      const diffMs = rec.respawnAt - now;
      const totalDuration = Math.max(1000, rec.respawnAt - rec.killedAt);
      const elapsed = now - rec.killedAt;
      progressPercent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

      const killedTimeStr = formatTime(new Date(rec.killedAt));
      const respawnTimeStr = formatTime(new Date(rec.respawnAt));
      const auto30Tag = rec.autoAdjusted30m ? '<span class="auto-30m-badge">⚡ 重生15分未編輯已改為倒數30分</span>' : '';

      if (diffMs <= 0) {
        statusClass = 'status-alive';
        badgeHtml = '<span class="boss-status-badge badge-alive">🟢 已重生 / 存活中</span>';
        countdownClass = 'alive';
        progressClass = 'ready';
        progressPercent = 100;
        const overdueSeconds = Math.floor(Math.abs(diffMs) / 1000);
        countdownHtml = `已重生 +${formatDuration(overdueSeconds)}`;
      } else if (diffMs <= state.alertThresholdMinutes * 60 * 1000) {
        statusClass = 'status-spawning-soon';
        const mins = Math.ceil(diffMs / 60000);
        badgeHtml = `<span class="boss-status-badge badge-soon">⚠️ 即將復活 (${mins}分鐘內)</span>`;
        countdownClass = 'soon';
        progressClass = 'soon';
        countdownHtml = formatDuration(Math.ceil(diffMs / 1000));
      } else {
        badgeHtml = '<span class="boss-status-badge badge-respawning">🔴 復活倒數中</span>';
        countdownClass = 'counting';
        countdownHtml = formatDuration(Math.ceil(diffMs / 1000));
      }

      detailsHtml = `
        <div class="detail-row">
          <span>基準時間：</span>
          <span class="detail-highlight">${killedTimeStr} (${rec.reporter || '未知'}) ${auto30Tag}</span>
        </div>
        <div class="detail-row">
          <span>預計復活時間：</span>
          <span class="detail-highlight" style="color: var(--accent-cyan); font-weight: 700;">${respawnTimeStr}</span>
        </div>
        <div class="detail-row">
          <span>目前設定間隔：</span>
          <span class="detail-highlight">${formatMinutes(rec.respawnMinutes)}</span>
        </div>
        ${rec.note ? `<div class="detail-row"><span>備註：</span><span class="detail-highlight">${rec.note}</span></div>` : ''}
      `;
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
          <span class="detail-highlight">${formatMinutes(currentRespawnMins)}</span>
        </div>
        <div class="detail-row">
          <span>狀態：</span>
          <span class="detail-highlight">尚未輸入打死時間</span>
        </div>
      `;
    }

    const defaultInputTime = toLocalDatetimeInputValue(new Date());

    const card = document.createElement('div');
    card.className = `boss-card ${statusClass}`;
    card.id = 'singleActiveBossCard';
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
              <span class="meta-tag">復活週期: ${formatMinutes(currentRespawnMins)}</span>
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
            ⚡ 剛剛打死 [${state.activeServer}] ${boss.name}（立即倒數 ${formatMinutes(boss.respawnMinutes)}）
          </button>
          ${rec ? `<button type="button" class="btn btn-danger" id="btnSingleClearKill" title="清除此服紀錄">🔄 清除紀錄</button>` : ''}
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
      saveBossRecord(state.activeServer, boss.id, Date.now(), boss.respawnMinutes, inputNote.value.trim(), false);
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
      saveBossRecord(state.activeServer, boss.id, killedAt, mins, inputNote.value.trim(), false);
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

    if (!rec || !rec.respawnAt) return;

    const diffMs = rec.respawnAt - now;
    const isAlive = diffMs <= 0;
    const isSoon = diffMs > 0 && diffMs <= state.alertThresholdMinutes * 60 * 1000;

    const wasAlive = card.classList.contains('status-alive');
    const wasSoon = card.classList.contains('status-spawning-soon');

    if (isAlive !== wasAlive || isSoon !== wasSoon) {
      renderSingleBossView();
      return;
    }

    const countdownEl = document.getElementById('singleBossCountdownText');
    const progressEl = document.getElementById('singleBossProgressBar');

    if (countdownEl) {
      if (isAlive) {
        const overdueSeconds = Math.floor(Math.abs(diffMs) / 1000);
        countdownEl.textContent = `已重生 +${formatDuration(overdueSeconds)}`;
      } else {
        const remainSeconds = Math.ceil(diffMs / 1000);
        countdownEl.textContent = formatDuration(remainSeconds);
      }
    }

    if (progressEl) {
      const totalDuration = Math.max(1000, rec.respawnAt - rec.killedAt);
      const elapsed = now - rec.killedAt;
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
      if (rec && rec.respawnAt) {
        activeItems.push({
          ...rec,
          diffMs: rec.respawnAt - now
        });
      }
    });

    activeItems.sort((a, b) => a.diffMs - b.diffMs);
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
      const row = document.createElement('div');
      const isAlive = item.diffMs <= 0;
      const isSoon = item.diffMs > 0 && item.diffMs <= state.alertThresholdMinutes * 60 * 1000;
      const sec = Math.ceil(Math.abs(item.diffMs) / 1000);

      const timerColor = isAlive
        ? 'var(--accent-green)'
        : (isSoon ? 'var(--accent-yellow)' : 'var(--accent-cyan)');

      const timerStr = isAlive
        ? `已重生 +${formatDuration(sec)}`
        : formatDuration(sec);

      const auto30Badge = item.autoAdjusted30m ? '<span class="auto-30m-badge">⚡ 重生15分轉30分</span>' : '';

      row.className = `srv-summary-row ${item.serverId === state.activeServer ? 'active-srv' : ''}`;
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="radar-server-tag" style="min-width: 36px;">${item.serverId}</span>
          <div>
            <div style="font-family: var(--font-mono); font-weight: 800; font-size: 1rem; color: ${timerColor};">
              ${timerStr} ${auto30Badge}
            </div>
            <div style="font-size: 0.74rem; color: var(--text-secondary);">
              預計 ${formatTime(new Date(item.respawnAt))} 復活 · 記錄 ${formatTime(new Date(item.killedAt))}
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

  // Save Boss Kill Record
  async function saveBossRecord(serverId, bossId, killedAt, respawnMinutes, note, isAutoAdjust = false) {
    try {
      const res = await apiFetch('/api/record', {
        method: 'POST',
        body: JSON.stringify({
          serverId,
          bossId,
          killedAt,
          respawnMinutes,
          note,
          isAutoAdjust
        })
      });

      if (res.success) {
        if (!isAutoAdjust) {
          showToast(`✅ 已記錄 [${serverId}] ${res.record.bossName} 打死時間，開始倒數 ${formatMinutes(respawnMinutes)}！`, 'success');
        } else {
          showToast(`⚡ [${serverId}] ${res.record.bossName} 重生後 15 分鐘未編輯，已自動改為倒數 30 分鐘！`, 'warn');
        }
        if (!state.records[serverId]) state.records[serverId] = {};
        state.records[serverId][bossId] = res.record;
        if (res.lastActivityAt) state.lastActivityAt = res.lastActivityAt;
        saveLocalCloudCache();
        renderTopBossTabs();
        renderServerGridBadges();
        renderSingleBossView();
        renderSingleBossServerList();
      }
    } catch (e) {
      if (!isAutoAdjust) showToast('紀錄失敗：' + e.message, 'error');
    }
  }

  // Clear Boss Record
  async function clearBossRecord(serverId, bossId, bossName) {
    if (!confirm(`確定要清除 [${serverId}] ${bossName} 的時間紀錄嗎？`)) return;

    try {
      const res = await apiFetch('/api/record/clear', {
        method: 'POST',
        body: JSON.stringify({
          serverId,
          bossId
        })
      });

      if (res.success) {
        showToast(`已重設 [${serverId}] ${bossName} 紀錄`, 'info');
        if (state.records[serverId]) {
          delete state.records[serverId][bossId];
        }
        if (res.lastActivityAt) state.lastActivityAt = res.lastActivityAt;
        saveLocalCloudCache();
        renderTopBossTabs();
        renderServerGridBadges();
        renderSingleBossView();
        renderSingleBossServerList();
      }
    } catch (e) {
      showToast('清除失敗：' + e.message, 'error');
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
        state.lastActivityAt = res.lastActivityAt || Date.now();
        saveLocalCloudCache();
        showToast(
          isAuto
            ? '⏰ 已超過 3 小時未刪改任何資料，系統已自動將所有頻道重置！'
            : '🧹 已將所有頻道紀錄重置清空！',
          'warn'
        );
        renderTopBossTabs();
        renderServerGridBadges();
        renderSingleBossView();
        renderSingleBossServerList();
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
        if (!rec || !rec.respawnAt) return;
        const diffMs = rec.respawnAt - now;
        if (diffMs <= 15 * 60 * 1000) {
          allItems.push({
            ...rec,
            diffMs
          });
        }
      });
    });

    allItems.sort((a, b) => a.diffMs - b.diffMs);

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
      const tr = document.createElement('tr');
      const isAlive = item.diffMs <= 0;
      const remainSec = Math.ceil(Math.abs(item.diffMs) / 1000);

      const statusBadge = isAlive
        ? '<span class="boss-status-badge badge-alive">🟢 已重生</span>'
        : '<span class="boss-status-badge badge-soon">⚠️ 即將復活</span>';

      const countdownText = isAlive
        ? `+${formatDuration(remainSec)}`
        : formatDuration(remainSec);

      tr.innerHTML = `
        <td><span class="radar-server-tag">${item.serverId}</span></td>
        <td style="font-weight: 700;">${item.bossName} ${item.autoAdjusted30m ? '<span class="auto-30m-badge">重生15分轉30分</span>' : ''}</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: ${isAlive ? 'var(--accent-green)' : 'var(--accent-yellow)'}">${countdownText}</td>
        <td>${formatTime(new Date(item.respawnAt))}</td>
        <td>${formatTime(new Date(item.killedAt))} (${item.reporter || '未知'})</td>
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
        typeHtml = '<span style="color: var(--accent-yellow)">⚡ 重生15分未編輯改倒數30分</span>';
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

    // Rule 3 & Alerts: Check across all servers
    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv];
      if (!srvRecs) return;

      Object.values(srvRecs).forEach(rec => {
        if (!rec || !rec.respawnAt) return;

        // Rule 3: When a channel is unedited for 15 minutes after boss respawn (respawnAt), automatically set it to countdown 30 minutes
        if (!rec.autoAdjusted30m && (now - rec.respawnAt >= FIFTEEN_MINS_MS)) {
          const newKilledAt = rec.respawnAt + FIFTEEN_MINS_MS;
          const newNote = rec.note ? `${rec.note} (重生15分未編輯自動倒數30分)` : '重生後15分未編輯，自動改為倒數30分';
          rec.autoAdjusted30m = true;
          saveBossRecord(srv, rec.bossId, newKilledAt, 30, newNote, true);
          return;
        }

        const diffMs = rec.respawnAt - now;
        const cacheKey0m = `${srv}_${rec.bossId}_${rec.respawnAt}_0m`;
        const cacheKey1m = `${srv}_${rec.bossId}_${rec.respawnAt}_1m`;
        const cacheKeyThresh = `${srv}_${rec.bossId}_${rec.respawnAt}_thresh`;

        if (diffMs <= 0 && !state.alertedCache.has(cacheKey0m)) {
          state.alertedCache.add(cacheKey0m);
          triggerAlert(srv, rec.bossName, 0);
        } else if (diffMs > 0 && diffMs <= 60 * 1000 && !state.alertedCache.has(cacheKey1m)) {
          state.alertedCache.add(cacheKey1m);
          triggerAlert(srv, rec.bossName, 1);
        } else if (diffMs > 60 * 1000 && diffMs <= threshMs && !state.alertedCache.has(cacheKeyThresh)) {
          state.alertedCache.add(cacheKeyThresh);
          triggerAlert(srv, rec.bossName, Math.ceil(diffMs / 60000));
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
            renderTopBossTabs();
            renderBossManagerList();
            renderServerGridBadges();
            renderSingleBossView();
            renderSingleBossServerList();
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
        renderTopBossTabs();
        renderBossManagerList();
        renderSingleBossView();
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
        renderServerGridBadges();
        renderSingleBossView();
        renderSingleBossServerList();
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
