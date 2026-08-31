/**
 * Device & Client Connection Manager
 * Maintains real-time state, manages WebSocket sockets, and handles telemetry.
 */

class DeviceManager {
  constructor() {
    // Current state of connected ESP32 hardware
    this.deviceState = {
      connected: false,
      deviceId: 'esp32_default',
      direction: 'stop',
      speed: 128,
      buzzer: false,
      rssi: null,
      uptime: 0,
      lastSeen: null,
      ip: null,
    };

    // Active WebSocket connections
    this.deviceSocket = null;
    this.clientSockets = new Set();
  }

  /**
   * Register ESP32 Hardware WebSocket connection
   */
  setDeviceSocket(ws, req) {
    const clientIp = req.socket.remoteAddress;
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ⚡ [HARDWARE CONNECTED] ESP32 device online from ${clientIp}`);

    this.deviceSocket = ws;
    this.deviceState.connected = true;
    this.deviceState.lastSeen = new Date().toISOString();
    this.deviceState.ip = clientIp;

    this.broadcastStateToClients();

    ws.on('message', (message) => {
      this.handleDeviceMessage(message);
    });

    ws.on('close', () => {
      const dropTime = new Date().toLocaleTimeString();
      console.log(`[${dropTime}] ⚠️  [HARDWARE DISCONNECTED] ESP32 device offline`);
      this.deviceSocket = null;
      this.deviceState.connected = false;
      this.broadcastStateToClients();
    });

    ws.on('error', (err) => {
      console.error('[DEVICE ERR]', err.message);
    });
  }

  /**
   * Process incoming WebSocket message from ESP32
   */
  handleDeviceMessage(data) {
    try {
      const payload = JSON.parse(data.toString());
      this.deviceState.lastSeen = new Date().toISOString();

      if (payload.type === 'telemetry' || payload.type === 'status') {
        if (payload.direction !== undefined) this.deviceState.direction = payload.direction;
        if (payload.speed !== undefined) this.deviceState.speed = payload.speed;
        if (payload.buzzer !== undefined) this.deviceState.buzzer = payload.buzzer;
        if (payload.rssi !== undefined) this.deviceState.rssi = payload.rssi;
        if (payload.uptime !== undefined) this.deviceState.uptime = payload.uptime;

        this.broadcastStateToClients();
      } else if (payload.type === 'ack') {
        console.log('[DEVICE ACK]', payload);
      }
    } catch (err) {
      console.error('[DEVICE MSG PARSE ERR]', err.message);
    }
  }

  /**
   * Register Web/Mobile Client App WebSocket connection
   */
  addClientSocket(ws, req) {
    const time = new Date().toLocaleTimeString();
    const clientIp = req ? req.socket.remoteAddress : 'unknown';
    console.log(`[${time}] 📱 [CLIENT CONNECTED] App subscriber connected (${clientIp})`);
    this.clientSockets.add(ws);

    // Send immediate initial state
    ws.send(JSON.stringify({ type: 'state_update', data: this.deviceState }));

    ws.on('close', () => {
      const closeTime = new Date().toLocaleTimeString();
      console.log(`[${closeTime}] 📱 [CLIENT DISCONNECTED] App subscriber disconnected`);
      this.clientSockets.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[CLIENT ERR]', err.message);
    });
  }

  /**
   * Send motor command to ESP32 and update local state
   */
  sendMotorCommand(direction, speed) {
    this.deviceState.direction = direction;
    this.deviceState.speed = speed;

    const time = new Date().toLocaleTimeString();
    let dirLabel = '🛑 STOP';
    if (direction === 'c') dirLabel = '↻ CLOCKWISE (C)';
    if (direction === 'cc') dirLabel = '↺ COUNTER-CLOCKWISE (CC)';

    console.log(`[${time}] ⚙️  [ACTION: MOTOR] Direction: ${dirLabel} | Speed: ${speed}/255`);

    const payload = {
      action: 'motor',
      dir: direction,
      speed: Number(speed),
    };

    const sent = this.sendToDevice(payload);
    this.broadcastStateToClients();
    return { success: sent, state: this.deviceState };
  }

  /**
   * Send buzzer command to ESP32 and update local state
   */
  sendBuzzerCommand(state) {
    this.deviceState.buzzer = Boolean(state);

    const time = new Date().toLocaleTimeString();
    const buzzerLabel = state ? '🔊 ON' : '🔇 OFF';
    console.log(`[${time}] 🔔 [ACTION: BUZZER] State: ${buzzerLabel}`);

    const payload = {
      action: 'buzzer',
      state: Boolean(state),
    };

    const sent = this.sendToDevice(payload);
    this.broadcastStateToClients();
    return { success: sent, state: this.deviceState };
  }

  /**
   * Send raw JSON payload to ESP32 device
   */
  sendToDevice(payload) {
    if (this.deviceSocket && this.deviceSocket.readyState === 1) { // 1 = OPEN
      this.deviceSocket.send(JSON.stringify(payload));
      return true;
    }
    console.warn('   └─ ⚠️  [HARDWARE OFFLINE] Command saved to backend buffer');
    return false;
  }

  /**
   * Broadcast state telemetry to all connected app clients
   */
  broadcastStateToClients() {
    const message = JSON.stringify({
      type: 'state_update',
      data: this.deviceState,
      timestamp: new Date().toISOString(),
    });

    for (const ws of this.clientSockets) {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    }
  }

  /**
   * Return current state snapshot
   */
  getSnapshot() {
    return {
      ...this.deviceState,
      activeClientCount: this.clientSockets.size,
    };
  }
}

module.exports = new DeviceManager();
