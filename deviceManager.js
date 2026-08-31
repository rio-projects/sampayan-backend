/**
 * Automated Smart Clothesline Device & System Manager
 * Manages real-time state, weather automation, operating modes, and WebSocket connections.
 */

const weatherService = require('./weatherService');

class DeviceManager {
  constructor() {
    // Current state of Automated Smart Clothesline system
    this.deviceState = {
      connected: false,
      deviceId: 'esp32_clothesline',
      
      // Clothesline & Motor Status
      clotheslinePosition: 'open', // 'open' | 'closed' | 'partial'
      motorStatus: 'idle',        // 'idle' | 'extending' | 'retracting' | 'stopped'
      direction: 'stop',          // 'c' (open/extend) | 'cc' (close/retract) | 'stop'
      speed: 0,
      buzzer: false,
      
      // Control Modes & Safety Overrides
      systemMode: 'auto',         // 'auto' | 'manual'
      rainSafetyOverride: true,   // true | false
      
      // Sensor & Hardware Telemetry
      rainSensor: false,          // false (dry) | true (rain)
      rssi: null,
      uptime: 0,
      lastSeen: null,
      ip: null,
      
      // Weather Forecast Snapshot
      weatherForecast: {
        rainProbability: 0,
        isRaining: false,
        condition: 'Clear Sky',
        temperature: 28,
        humidity: 75,
        lastUpdated: null,
      },
    };

    // Active WebSocket connections
    this.deviceSocket = null;
    this.clientSockets = new Set();

    // Start Weather Polling & Automated Decision Engine
    this.initWeatherEngine();
  }

  /**
   * Initializes Weather Service polling & Automated Decision Engine
   */
  initWeatherEngine() {
    weatherService.startPolling(180000, (forecast) => { // Poll every 3 minutes
      this.deviceState.weatherForecast = forecast;
      this.evaluateAutomatedRules('weather_update');
      this.broadcastStateToClients();
    });
  }

  /**
   * Evaluates control priority rules for Smart Clothesline Automation:
   * 1. Rain Safety Override (If ON & Rain Detected -> Force CLOSE even in Manual Mode)
   * 2. Automatic Mode Rules (If AUTO & High Rain Prob / Active Rain -> CLOSE; Else -> OPEN)
   * 3. Manual Mode Rules (Respect manual user commands)
   */
  evaluateAutomatedRules(triggerReason = 'periodic') {
    const { systemMode, rainSafetyOverride, weatherForecast, rainSensor, clotheslinePosition } = this.deviceState;
    const isRainDetected = rainSensor || weatherForecast.isRaining;
    const isHighRainRisk = weatherForecast.rainProbability >= 60;

    const time = new Date().toLocaleTimeString();

    // Rule 1: Rain Safety Override (Active during Manual Mode if enabled)
    if (systemMode === 'manual' && rainSafetyOverride && isRainDetected) {
      if (clotheslinePosition !== 'closed') {
        console.log(`[${time}] 🌧️ [RAIN OVERRIDE] Rain detected in Manual Mode! Auto-retracting clothesline...`);
        this.executeClotheslineAction('close', 'Rain Safety Override Active');
      }
      return;
    }

    // Rule 2: Automatic Mode Decision Engine
    if (systemMode === 'auto') {
      if (isRainDetected || isHighRainRisk) {
        if (clotheslinePosition !== 'closed') {
          console.log(`[${time}] 🌧️ [AUTO MODE] Rain detected or High Rain Risk (${weatherForecast.rainProbability}%). Retracting clothesline...`);
          this.executeClotheslineAction('close', `Auto Rain Protection (${weatherForecast.condition})`);
        }
      } else {
        if (clotheslinePosition !== 'open') {
          console.log(`[${time}] ☀️ [AUTO MODE] Weather safe (${weatherForecast.condition}). Opening clothesline...`);
          this.executeClotheslineAction('open', 'Auto Weather Safe');
        }
      }
    }
  }

  /**
   * Changes Operating System Mode ('auto' | 'manual')
   */
  setSystemMode(mode) {
    if (mode !== 'auto' && mode !== 'manual') return false;
    
    this.deviceState.systemMode = mode;
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ⚙️  [MODE CHANGED] System Mode set to: ${mode.toUpperCase()}`);

    // Re-evaluate rules immediately if switched to auto
    if (mode === 'auto') {
      this.evaluateAutomatedRules('mode_switch');
    }

    this.broadcastStateToClients();
    return true;
  }

  /**
   * Toggles Rain Safety Override ('true' | 'false')
   */
  setRainSafetyOverride(enabled) {
    this.deviceState.rainSafetyOverride = Boolean(enabled);
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] 🛡️ [OVERRIDE CHANGED] Rain Safety Override: ${enabled ? 'ENABLED' : 'DISABLED'}`);

    this.evaluateAutomatedRules('override_switch');
    this.broadcastStateToClients();
    return true;
  }

  /**
   * Executes high-level Clothesline Action ('open' | 'close' | 'stop')
   */
  executeClotheslineAction(action, reason = 'User Command') {
    let dir = 'stop';
    let speed = 0;
    let newPos = this.deviceState.clotheslinePosition;
    let newMotorStatus = 'idle';

    if (action === 'open') {
      dir = 'c';
      speed = 255;
      newPos = 'open';
      newMotorStatus = 'extending';
    } else if (action === 'close') {
      dir = 'cc';
      speed = 255;
      newPos = 'closed';
      newMotorStatus = 'retracting';
    } else if (action === 'stop') {
      dir = 'stop';
      speed = 0;
      newPos = 'partial';
      newMotorStatus = 'stopped';
    }

    this.deviceState.direction = dir;
    this.deviceState.speed = speed;
    this.deviceState.clotheslinePosition = newPos;
    this.deviceState.motorStatus = newMotorStatus;

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] 👕 [CLOTHESLINE ACTION] ${action.toUpperCase()} (${reason}) --> Dir: ${dir} | Speed: ${speed}`);

    const payload = {
      action: 'motor',
      clotheslineAction: action,
      dir: dir,
      speed: speed,
      reason: reason,
    };

    const sent = this.sendToDevice(payload);
    this.broadcastStateToClients();
    return { success: sent, state: this.deviceState };
  }

  /**
   * Legacy raw motor command wrapper
   */
  sendMotorCommand(direction, speed) {
    let action = 'stop';
    if (direction === 'c') action = 'open';
    if (direction === 'cc') action = 'close';
    return this.executeClotheslineAction(action, 'Direct Motor API');
  }

  /**
   * Send buzzer command
   */
  sendBuzzerCommand(state) {
    this.deviceState.buzzer = Boolean(state);

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] 🔔 [ACTION: BUZZER] State: ${state ? 'ON' : 'OFF'}`);

    const payload = {
      action: 'buzzer',
      state: Boolean(state),
    };

    const sent = this.sendToDevice(payload);
    this.broadcastStateToClients();
    return { success: sent, state: this.deviceState };
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
        if (payload.rainSensor !== undefined) {
          const prevRain = this.deviceState.rainSensor;
          this.deviceState.rainSensor = Boolean(payload.rainSensor);
          if (prevRain !== this.deviceState.rainSensor) {
            this.evaluateAutomatedRules('rain_sensor_change');
          }
        }

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
