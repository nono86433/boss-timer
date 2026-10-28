// Main Application Logic for Boss Respawn Tracker (Single-Boss Focused Mode)
(function () {
  'use strict';

  // Application State
  const state = {
    currentUser: localStorage.getItem('boss_tracker_user') || null,
    config: {
      authNames: ['啞啞', '森森'],
      servers: Array.from({ length: 60 }, (_, i) => `S${i + 1}`),
      bosses: []
    },
    records: {},
    logs: [],
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

    // Step 3: Single Boss Card & Active Server Summary
    singleBossContainer: document.getElementById('singleBossContainer'),
    lblSummaryBossName: document.getElementById('lblSummaryBossName'),
    lblActiveBossServerCount: document.getElementById('lblActiveBossServerCount'),
    singleBossServerList: document.getElementById('singleBossServerList'),

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
    if (!state.config.bosses || state.config.bosses.length === 0) return null;
    let found = state.config.bosses.find(b => b.id === state.activeBossId);
    if (!found) {
      found = state.config.bosses[0];
      state.activeBossId = found.id;
      localStorage.setItem('boss_active_id', found.id);
    }
    return found;
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

      if (msg.log) {
        state.logs.unshift(msg.log);
        if (state.logs.length > 200) state.logs.pop();
      }

      showToast(`📢 ${rec.reporter} 更新了 [${rec.serverId}] ${rec.bossName} 的打死時間！`, 'info');
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
      if (msg.log) {
        state.logs.unshift(msg.log);
      }
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
    } else if (msg.type === 'CONFIG_UPDATED') {
      state.config = msg.config;
      getActiveBoss();
      renderTopBossTabs();
      renderBossManagerList();
      renderServerGridBadges();
      renderSingleBossView();
      renderSingleBossServerList();
      showToast('⚙️ 王怪與復活時間設定已同步更新！', 'success');
    }
  }

  // API helper with authentication header
  async function apiFetch(endpoint, options = {}) {
    if (!state.currentUser) {
      promptAuth();
      throw new Error('請先完成身分驗證');
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

  // Load state from backend
  async function initAppState() {
    try {
      const data = await apiFetch('/api/state');
      if (data.success) {
        state.config = data.config;
        state.records = data.records || {};
        state.logs = data.logs || [];

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
        startCountdownTicker();

        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  // STEP 1: Render Top Boss Tabs (蘑菇王, 殭屍姑姑王, etc.)
  function renderTopBossTabs() {
    el.topBossTabs.innerHTML = '';
    const activeBoss = getActiveBoss();

    state.config.bosses.forEach(boss => {
      // Count how many servers have records for this boss
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

    // Count total radar across all bosses for the top tab badge
    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv] || {};
      Object.values(srvRecs).forEach(r => {
        if (r && r.respawnAt && (r.respawnAt - now) <= state.alertThresholdMinutes * 60 * 1000) {
          totalRadarCount++;
        }
      });
    });
    el.lblRadarCount.textContent = totalRadarCount;

    // Update S1~S60 buttons specifically for the active Boss
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
          <span>打死時間：</span>
          <span class="detail-highlight">${killedTimeStr} (回報人: ${rec.reporter || '未知'})</span>
        </div>
        <div class="detail-row">
          <span>預計復活時間：</span>
          <span class="detail-highlight" style="color: var(--accent-cyan); font-weight: 700;">${respawnTimeStr}</span>
        </div>
        <div class="detail-row">
          <span>設定復活間隔：</span>
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
            ⚡ 剛剛打死 [${state.activeServer}] ${boss.name}（立即倒數 ${formatMinutes(currentRespawnMins)}）
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
              <input type="number" id="singleInputRespawnMins" class="form-input" style="width: 100px; padding: 6px 10px;" min="1" max="10080" value="${currentRespawnMins}">
              <span style="font-size: 0.85rem; color: var(--text-secondary);">分鐘</span>
              <div class="qr-preset-group" id="singleRespawnPresets">
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 30 ? 'active' : ''}" data-preset-min="30">30分鐘</button>
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 45 ? 'active' : ''}" data-preset-min="45">45分鐘</button>
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 60 ? 'active' : ''}" data-preset-min="60">1小時</button>
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 90 ? 'active' : ''}" data-preset-min="90">1.5小時</button>
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 120 ? 'active' : ''}" data-preset-min="120">2小時</button>
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 180 ? 'active' : ''}" data-preset-min="180">3小時</button>
                <button type="button" class="quick-tag-btn ${currentRespawnMins === 240 ? 'active' : ''}" data-preset-min="240">4小時</button>
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
            <input type="text" id="singleInputNote" class="form-input" placeholder="備註 (選填，例如掉落物)" value="${rec ? (rec.note || '') : ''}" style="flex: 1; min-width: 160px; padding: 8px 12px;">
            <button type="button" class="btn btn-primary" id="btnSingleSubmitCustom" style="padding: 9px 18px; font-weight: 700;">
              ✅ 記錄時間並開始倒數
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind events inside the Single Boss Card
    const inputRespawnMins = card.querySelector('#singleInputRespawnMins');
    const inputKilledAt = card.querySelector('#singleInputKilledAt');
    const inputNote = card.querySelector('#singleInputNote');

    card.querySelector('#btnSingleQuickKill').addEventListener('click', () => {
      const mins = parseInt(inputRespawnMins.value, 10) || currentRespawnMins;
      saveBossRecord(state.activeServer, boss.id, Date.now(), mins, inputNote.value.trim());
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
    el.lblActiveBossServerCount.textContent = `共 ${activeItems.length} 個伺服器有紀錄`;

    if (activeItems.length === 0) {
      el.singleBossServerList.innerHTML = `
        <div class="empty-state" style="padding: 36px 12px;">
          <div style="font-size: 28px; margin-bottom: 8px;">🍄</div>
          <div>目前【${boss.name}】在 S1~S60 尚無倒數紀錄</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">點選上方 S1~S60 並記錄打死時間後將自動列於此處</div>
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

      row.className = `srv-summary-row ${item.serverId === state.activeServer ? 'active-srv' : ''}`;
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="radar-server-tag" style="min-width: 36px;">${item.serverId}</span>
          <div>
            <div style="font-family: var(--font-mono); font-weight: 800; font-size: 1.05rem; color: ${timerColor};">
              ${timerStr}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-secondary);">
              預計 ${formatTime(new Date(item.respawnAt))} 復活 · 打死 ${formatTime(new Date(item.killedAt))} (${item.reporter || '未知'})
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
        showToast(`✅ 已記錄 [${serverId}] ${res.record.bossName} 打死時間，開始倒數 ${formatMinutes(respawnMinutes)}！`, 'success');
        if (!state.records[serverId]) state.records[serverId] = {};
        state.records[serverId][bossId] = res.record;
        renderTopBossTabs();
        renderServerGridBadges();
        renderSingleBossView();
        renderSingleBossServerList();
      }
    } catch (e) {
      showToast('紀錄失敗：' + e.message, 'error');
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
        renderTopBossTabs();
        renderServerGridBadges();
        renderSingleBossView();
        renderSingleBossServerList();
      }
    } catch (e) {
      showToast('清除失敗：' + e.message, 'error');
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
        <td style="font-weight: 700;">${item.bossName}</td>
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
      const isKill = log.type === 'KILL';
      tr.innerHTML = `
        <td>${formatDateTime(new Date(log.timestamp))}</td>
        <td><span class="radar-server-tag">${log.serverId}</span></td>
        <td style="font-weight: 700;">${log.bossName}</td>
        <td>${isKill ? '<span style="color: var(--accent-green)">擊殺回報</span>' : '<span style="color: var(--text-muted)">清除重設</span>'}</td>
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

    // 1. Check alerts across all servers
    state.config.servers.forEach(srv => {
      const srvRecs = state.records[srv];
      if (!srvRecs) return;

      Object.values(srvRecs).forEach(rec => {
        if (!rec || !rec.respawnAt) return;
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

    // 2. Update UI for active view
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
      return;
    }
    if (isNaN(minutes) || minutes <= 0) {
      alert('請填寫大於 0 的復活分鐘數（例如: 30、45 或 60）！');
      return;
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
    el.networkLinksContainer.innerHTML = '載入網路位址中...';
    el.modalShare.style.display = 'flex';

    try {
      const res = await fetch('/api/network-info');
      const data = await res.json();
      el.networkLinksContainer.innerHTML = '';

      addShareLink('本機瀏覽器', `http://localhost:${data.port}`);
      data.addresses.forEach(ip => {
        addShareLink(`手機 / 區域網路共享 (Wi-Fi)`, `http://${ip}:${data.port}`);
      });
    } catch (e) {
      el.networkLinksContainer.innerHTML = '無法取得網路資訊';
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
        if (ok) {
          el.inlineNewBossName.value = '';
        }
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
