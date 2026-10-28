// WebSocket Client with auto-reconnect and cloud sync fallback (for GitHub Pages)
class LiveSocket {
  constructor(options = {}) {
    this.isGitHubPages = window.location.hostname.endsWith('github.io');
    this.cloudTopic = 'nono86433_boss_timer_sync_v1';
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.currentUser = options.currentUser || null;
    this.ws = null;
    this.reconnectTimer = null;
    this.isConnected = false;
  }

  setUser(user) {
    this.currentUser = user;
    if (!this.isGitHubPages && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendAuth();
    }
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }

    let wsUrl;
    if (this.isGitHubPages) {
      wsUrl = `wss://ntfy.sh/${this.cloudTopic}/ws`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('WebSocket init error:', err);
      this.scheduleReconnect();
      return;
    }

    this.onStatusChange('connecting');

    this.ws.onopen = () => {
      console.log('⚡ WebSocket 連線成功');
      this.isConnected = true;
      this.onStatusChange('connected');
      if (!this.isGitHubPages && this.currentUser) {
        this.sendAuth();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if (this.isGitHubPages) {
          // ntfy.sh wraps payload in { event: 'message', message: '...' }
          if (raw.event === 'message' && raw.message) {
            const payload = JSON.parse(raw.message);
            this.onMessage(payload);
          }
        } else {
          this.onMessage(raw);
        }
      } catch (e) {
        console.error('WS Parse message error:', e);
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.onStatusChange('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('WS Error:', err);
      try { this.ws.close(); } catch (e) {}
    };
  }

  sendAuth() {
    if (!this.isGitHubPages && this.ws && this.ws.readyState === WebSocket.OPEN && this.currentUser) {
      this.ws.send(JSON.stringify({
        type: 'AUTH',
        name: this.currentUser
      }));
    }
  }

  async broadcastCloud(payload) {
    if (!this.isGitHubPages) return;
    try {
      await fetch(`https://ntfy.sh/${this.cloudTopic}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Cloud broadcast error:', e);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 3000);
  }
}

window.LiveSocket = LiveSocket;
