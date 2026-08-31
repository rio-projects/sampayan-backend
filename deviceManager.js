/**
 * Automated Smart Clothesline Device & System Manager
 * Manages real-time state, weather automation, operating modes, settings, activity timeline, and WebSocket connections.
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
      speed: 255,
      buzzer: false,
      
      // Control Modes & Safety Overrides
      systemMode: 'auto',         // 'auto' | 'manual'
      rainSafetyOverride: true,   // true | false (User facing: Rain Protection)

      // Settings Configuration
      settings: {
        motorSpeed: 255,          // 0 to 255 PWM
        lookaheadHours: 3,        // Lookahead window N hours (1 to 12)
        rainThreshold: 10,        // Rain probability threshold % (e.g., 10%)
        autoClose: true,          // Auto-close when rain risk detected (ON by default)
        autoReopen: false,        // Auto-reopen when dry (OFF by default)
      },
      
      // Sensor & Hardware Telemetry
      rainSensor: false,          // false (dry) | true (rain)
      rssi: null,
      uptime: 0,
      lastSeen: null,
      ip: null,
      
      // Weather Forecast Snapshot & Lookahead
      weatherForecast: {
        rainProbability: 0,
        lookaheadRainProbability: 0,
        isRaining: false,
        condition: 'Clear Sky',
        temperature: 28,
        humidity: 75,
        lastUpdated: null,
      },

      // Activity Timeline (User readable logs)
      activityLogs: [],
    };

    // Active WebSocket connections
    this.deviceSocket = null;
    this.clientSockets = new Set();

    // Add initial system startup activity log
    this.addActivityLog('System Initialized', 'Smart Clothesline backend operational', 'system');

    // Start Weather Polling & Automated Decision Engine
    this.initWeatherEngine();
  }

  /**
   * Adds an event entry to the user-friendly Activity Timeline
   */
  addActivityLog(title, description, type = 'system') {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const logItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: timeStr,
      rawTime: new Date().toISOString(),
      title,
      description,
      type, // 'safe' | 'rain_risk' | 'rain_sensor' | 'manual' | 'system'
    };

    // Keep last 20 activity logs
    this.deviceState.activityLogs = [logItem, ...this.deviceState.activityLogs.slice(0, 19)];
  }

  /**
   * Initializes Weather Service polling & Automated Decision Engine
   */
  initWeatherEngine() {
    weatherService.startPolling(180000, (forecast) => { // Poll every 3 minutes
      this.updateWeatherForecastState(forecast);
      this.evaluateAutomatedRules('weather_update');
      this.broadcastStateToClients();
    });
  }

  /**
   * Updates cached weather forecast state including N-hour lookahead computation
   */
  updateWeatherForecastState(forecast) {
    const lookaheadHours = this.deviceState.settings.lookaheadHours;
    const maxLookaheadProb = weatherService.getLookaheadRainProb(lookaheadHours);

    this.deviceState.weatherForecast = {
      ...forecast,
      lookaheadRainProbability: maxLookaheadProb,
    };
  }

  /**
   * Evaluates control priority rules for Smart Clothesline Automation:
   * 1. Rain Safety Override (If ON & Rain Detected -> Force CLOSE even in Manual Mode)
   * 2. Automatic Mode Rules:
   *    - Retract / Close if autoClose=true AND (rain detected OR rain probability >= rainThreshold in next N hours)
   *    - Open if autoReopen=true AND dry weather AND rain probability < rainThreshold for next N hours
   */
  evaluateAutomatedRules(triggerReason = 'periodic') {
    const { systemMode, rainSafetyOverride, weatherForecast, rainSensor, clotheslinePosition, settings } = this.deviceState;
    
    // N-Hour Lookahead Rain Evaluation
    const lookaheadRainProb = weatherService.getLookaheadRainProb(settings.lookaheadHours);
    this.deviceState.weatherForecast.lookaheadRainProbability = lookaheadRainProb;

    const isRainDetected = rainSensor || weatherForecast.isRaining;
    const isRainRiskInNextNHours = lookaheadRainProb >= settings.rainThreshold;

    // Rule 1: Rain Safety Override (Active during Manual Mode if enabled)
    if (systemMode === 'manual' && rainSafetyOverride && (isRainDetected || isRainRiskInNextNHours)) {
      if (clotheslinePosition !== 'closed') {
        const desc = isRainDetected ? 'Physical rain sensor triggered' : `${lookaheadRainProb}% rain expected in next ${settings.lookaheadHours}h`;
        this.addActivityLog('Rain Protection Triggered', desc, 'rain_sensor');
        this.executeClotheslineAction('close', `Rain Protection (${desc})`);
      }
      return;
    }

    // Rule 2: Automatic Mode Decision Engine
    if (systemMode === 'auto') {
      if (isRainDetected || isRainRiskInNextNHours) {
        if (settings.autoClose && clotheslinePosition !== 'closed') {
          const desc = isRainDetected ? 'Rain detected by local sensor' : `${lookaheadRainProb}% rain probability within ${settings.lookaheadHours} hours`;
          this.addActivityLog('Clothesline Closed Automatically', desc, 'rain_risk');
          this.executeClotheslineAction('close', `Auto Protection (${desc})`);
        }
      } else {
        // Safe conditions
        if (settings.autoReopen && clotheslinePosition !== 'open') {
          const desc = `<${settings.rainThreshold}% rain expected for next ${settings.lookaheadHours} hours`;
          this.addActivityLog('Clothesline Opened Automatically', desc, 'safe');
          this.executeClotheslineAction('open', `Auto Reopen (${desc})`);
        }
      }
    }
  }

  /**
   * Updates Settings Configuration
   */
  updateSettings({ motorSpeed, lookaheadHours, rainThreshold, autoClose, autoReopen }) {
    if (motorSpeed !== undefined) {
      this.deviceState.settings.motorSpeed = Math.max(0, Math.min(255, Number(motorSpeed)));
      this.deviceState.speed = this.deviceState.settings.motorSpeed;
    }

    if (lookaheadHours !== undefined) {
      this.deviceState.settings.lookaheadHours = Math.max(1, Math.min(12, Number(lookaheadHours)));
    }

    if (rainThreshold !== undefined) {
      this.deviceState.settings.rainThreshold = Math.max(0, Math.min(100, Number(rainThreshold)));
    }

    if (autoClose !== undefined) {
      this.deviceState.settings.autoClose = Boolean(autoClose);
    }

    if (autoReopen !== undefined) {
      this.deviceState.settings.autoReopen = Boolean(autoReopen);
    }

    this.addActivityLog('Settings Updated', `Speed: ${Math.round((this.deviceState.settings.motorSpeed/255)*100)}% | Window: ${this.deviceState.settings.lookaheadHours}h | Threshold: ${this.deviceState.settings.rainThreshold}%`, 'system');

    // Re-evaluate rules immediately with new settings
    this.evaluateAutomatedRules('settings_update');
    this.broadcastStateToClients();
    return this.deviceState.settings;
  }

  /**
   * Changes Operating System Mode ('auto' | 'manual')
   */
  setSystemMode(mode) {
    if (mode !== 'auto' && mode !== 'manual') return false;
    
    this.deviceState.systemMode = mode;
    this.addActivityLog('System Mode Changed', `Switched to ${mode.toUpperCase()} Mode`, 'manual');

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
    this.addActivityLog('Rain Protection Configured', `Physical Rain Protection set to ${enabled ? 'ENABLED' : 'DISABLED'}`, 'system');

    this.evaluateAutomatedRules('override_switch');
    this.broadcastStateToClients();
    return true;
  }

  /**
   * Executes high-level Clothesline Action ('open' | 'close' | 'stop')
   */
  executeClotheslineAction(action, reason = 'User Command', customSpeed = null, force = false) {
    // Prevent continuous motor run if already in target position
    if (!force && this.deviceState.motorStatus === 'idle') {
      if (action === 'open' && this.deviceState.clotheslinePosition === 'open') {
        return { success: true, message: 'Clothesline is already fully open', state: this.deviceState };
      }
      if (action === 'close' && this.deviceState.clotheslinePosition === 'closed') {
        return { success: true, message: 'Clothesline is already fully retracted', state: this.deviceState };
      }
    }

    let dir = 'stop';
    let speed = 0;
    let newPos = this.deviceState.clotheslinePosition;
    let newMotorStatus = 'idle';

    const targetSpeed = customSpeed !== null ? Number(customSpeed) : this.deviceState.settings.motorSpeed;

    let buzzerStateNeeded = false;

    if (action === 'open') {
      dir = 'c';
      speed = targetSpeed;
      newPos = 'open';
      newMotorStatus = 'extending';
      buzzerStateNeeded = true;
      this.addActivityLog('Clothesline Opened', reason, 'manual');
    } else if (action === 'close') {
      dir = 'cc';
      speed = targetSpeed;
      newPos = 'closed';
      newMotorStatus = 'retracting';
      buzzerStateNeeded = true;
      this.addActivityLog('Clothesline Closed', reason, 'manual');
    } else if (action === 'stop') {
      dir = 'stop';
      speed = 0;
      newPos = 'partial';
      newMotorStatus = 'stopped';
      buzzerStateNeeded = false;
      this.addActivityLog('Motor Stopped', reason, 'manual');
    }

    this.deviceState.direction = dir;
    this.deviceState.speed = speed;
    this.deviceState.clotheslinePosition = newPos;
    this.deviceState.motorStatus = newMotorStatus;
    this.deviceState.buzzer = buzzerStateNeeded;

    // Clear any existing movement timer
    if (this.motorTimer) {
      clearTimeout(this.motorTimer);
      this.motorTimer = null;
    }

    // Automatically transition motorStatus to 'idle' and turn off buzzer after 10 seconds of movement
    if (action === 'open' || action === 'close') {
      this.motorTimer = setTimeout(() => {
        this.deviceState.motorStatus = 'idle';
        this.deviceState.direction = 'stop';
        this.deviceState.buzzer = false;
        this.sendToDevice({ action: 'motor', dir: 'stop', speed: 0 });
        this.sendToDevice({ action: 'buzzer', state: false });
        this.broadcastStateToClients();
      }, 10000); // 10-second calibrated travel time
    }

    const payload = {
      action: 'motor',
      clotheslineAction: action,
      dir: dir,
      speed: speed,
      reason: reason,
    };

    const sent = this.sendToDevice(payload);
    
    // Automatically trigger buzzer control payload on movement/stop
    this.sendToDevice({ action: 'buzzer', state: buzzerStateNeeded });

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
    return this.executeClotheslineAction(action, 'Direct Motor API', speed);
  }

  /**
   * Send buzzer command
   */
  sendBuzzerCommand(state) {
    this.deviceState.buzzer = Boolean(state);
    this.addActivityLog('Warning Buzzer Toggled', `Buzzer turned ${state ? 'ON' : 'OFF'}`, 'manual');

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
    this.addActivityLog('ESP32 Hardware Connected', `Connected from ${clientIp}`, 'system');

    this.deviceSocket = ws;
    this.deviceState.connected = true;
    this.deviceState.lastSeen = new Date().toISOString();
    this.deviceState.ip = clientIp;

    this.broadcastStateToClients();

    ws.on('message', (message) => {
      this.handleDeviceMessage(message);
    });

    ws.on('close', () => {
      this.addActivityLog('ESP32 Hardware Disconnected', 'Connection lost', 'system');
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
        if (payload.direction !== undefined) {
          this.deviceState.direction = payload.direction;
          if (payload.direction === 'stop') {
            this.deviceState.motorStatus = 'idle';
          } else if (payload.direction === 'c') {
            this.deviceState.motorStatus = 'extending';
          } else if (payload.direction === 'cc') {
            this.deviceState.motorStatus = 'retracting';
          }
        }
        if (payload.speed !== undefined) this.deviceState.speed = payload.speed;
        if (payload.buzzer !== undefined) this.deviceState.buzzer = payload.buzzer;
        if (payload.rssi !== undefined) this.deviceState.rssi = payload.rssi;
        if (payload.uptime !== undefined) this.deviceState.uptime = payload.uptime;
        if (payload.rainSensor !== undefined) {
          const prevRain = this.deviceState.rainSensor;
          this.deviceState.rainSensor = Boolean(payload.rainSensor);
          if (prevRain !== this.deviceState.rainSensor && this.deviceState.rainSensor) {
            this.addActivityLog('Rain Detected by Sensor', 'Hardware sensor detected rainfall', 'rain_sensor');
            this.evaluateAutomatedRules('rain_sensor_change');
          }
        }

        this.broadcastStateToClients();
      }
    } catch (err) {
      console.error('[DEVICE MSG PARSE ERR]', err.message);
    }
  }

  /**
   * Register Web/Mobile Client App WebSocket connection
   */
  addClientSocket(ws, req) {
    this.clientSockets.add(ws);
    ws.send(JSON.stringify({ type: 'state_update', data: this.deviceState }));

    ws.on('close', () => {
      this.clientSockets.delete(ws);
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
