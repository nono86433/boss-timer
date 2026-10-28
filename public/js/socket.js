// WebSocket Client with auto-reconnect and heartbeat
class LiveSocket {
  constructor(options = {}) {
    this.url = options.url || `ws://${window.location.host}`;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onMessage = options.onMessage || (() => {});
    this.currentUser = options.currentUser || null;
    this.ws = null;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isConnected = false;
  }

  setUser(user) {
    this.currentUser = user;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendAuth();
    }
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch(err) {
      console.error('WebSocket init error:', err);
      this.scheduleReconnect();
      return;
    }

    this.onStatusChange('connecting');

    this.ws.onopen = () => {
      console.log('⚡ WebSocket 連線成功');
      this.isConnected = true;
      this.onStatusChange('connected');
      if (this.currentUser) {
        this.sendAuth();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
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
      try { this.ws.close(); } catch(e) {}
    };
  }

  sendAuth() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentUser) {
      this.ws.send(JSON.stringify({
        type: 'AUTH',
        name: this.currentUser
      }));
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log('🔄 嘗試重新連線 WebSocket...');
      this.connect();
    }, 3000);
  }
}

window.LiveSocket = LiveSocket;
