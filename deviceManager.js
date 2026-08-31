/**
 * Automated Smart Clothesline Device & System Manager
 * Manages real-time state, weather automation, operating modes, settings, activity timeline, and WebSocket connections.
 */

const weatherService = require('./weatherService');
const pagasaService = require('./pagasaService');
const aiAnalysisService = require('./aiAnalysisService');
const notificationService = require('./notificationService');

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
        motorSpeed: 255,             // 0 to 255 PWM (displayed as 25% - 100%)
        openDurationSeconds: 1.8,    // Decimal 0.1s to 5.0s
        closeDurationSeconds: 2.1,   // Decimal 0.1s to 5.0s
        travelDurationSeconds: 10,   // Fallback motor travel duration in seconds
        lookaheadHours: 3,           // Lookahead window N hours (1 to 12)
        rainThreshold: 10,           // Rain probability threshold % (e.g., 10%)
        autoClose: true,             // Auto-close when rain risk detected (ON by default)
        autoReopen: false,           // Auto-reopen when dry (OFF by default)
        aiAnalysisEnabled: true,     // AI weather assessment (ON by default)
        pagasaEnabled: true,         // PAGASA weather intelligence (ON by default)
        pushNotificationsEnabled: true,
        alerts: {
          rainExpected: true,
          autoRetract: true,
          retractComplete: true,
          autoOpen: true,
          pagasaAlerts: true,
          typhoonAlerts: true,
          heavyRainWarnings: true,
          deviceOffline: true,
          automationFailure: true,
        },
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

      // PAGASA & AI Analysis Snapshot
      pagasaIntelligence: pagasaService.getIntelligence(),
      aiAnalysis: {
        aiRiskLevel: 'LOW',
        laundryRecommendation: 'SAFE_OUTSIDE',
        weatherCause: 'Clear Weather',
        expectedPattern: 'Safe dry conditions.',
        laundryImpact: 'Optimal drying.',
        recommendedAction: 'Keep open',
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
    weatherService.startPolling(180000, async (forecast) => { // Poll every 3 minutes
      this.updateWeatherForecastState(forecast);
      await pagasaService.pollPagasaData(forecast);
      this.deviceState.pagasaIntelligence = pagasaService.getIntelligence();
      this.deviceState.aiAnalysis = aiAnalysisService.analyze(this.deviceState.weatherForecast, this.deviceState);
      
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
   * Evaluates 9-Tier Control Priority Hierarchy for Smart Clothesline Automation:
   * 1. System / Motor Safety
   * 2. Severe PAGASA Warning (Typhoon / Red-Orange Rainfall Warning)
   * 3. Tropical Cyclone / Dangerous Weather
   * 4. Heavy Rainfall Warning / Local Rain Sensor
   * 5. Forecast Rain Threshold Exceeded
   * 6. Active Rain-Producing Weather System (e.g. Habagat)
   * 7. AI Risk Assessment (CRITICAL / HIGH Risk)
   * 8. Normal Weather Automation (Auto Reopen when dry)
   * 9. Manual Fallback
   */
  evaluateAutomatedRules(triggerReason = 'periodic') {
    const { systemMode, rainSafetyOverride, weatherForecast, rainSensor, clotheslinePosition, settings, pagasaIntelligence, aiAnalysis } = this.deviceState;
    
    // N-Hour Lookahead Rain Evaluation
    const lookaheadRainProb = weatherService.getLookaheadRainProb(settings.lookaheadHours);
    this.deviceState.weatherForecast.lookaheadRainProbability = lookaheadRainProb;

    const isRainDetected = rainSensor || weatherForecast.isRaining;
    const isRainRiskInNextNHours = lookaheadRainProb >= settings.rainThreshold;
    const isSeverePagasa = pagasaIntelligence.riskLevel === 'CRITICAL' || pagasaIntelligence.primarySystem === 'TROPICAL_CYCLONE';
    const isHabagatOrRainSystem = pagasaIntelligence.primarySystem === 'HABAGAT' || pagasaIntelligence.primarySystem === 'ITCZ' || pagasaIntelligence.primarySystem === 'LPA';
    const isAiCritical = aiAnalysis.aiRiskLevel === 'CRITICAL' || aiAnalysis.aiRiskLevel === 'HIGH';

    // Tier 1 & 2: Rain Safety Override / Severe Weather (Active during Manual & Auto)
    if ((systemMode === 'manual' && rainSafetyOverride && (isRainDetected || isRainRiskInNextNHours || isSeverePagasa)) || isSeverePagasa) {
      if (clotheslinePosition !== 'closed') {
        const desc = isSeverePagasa ? `PAGASA Alert: ${pagasaIntelligence.systemName}` : (isRainDetected ? 'Physical rain sensor triggered' : `${lookaheadRainProb}% rain expected in next ${settings.lookaheadHours}h`);
        this.addActivityLog('Rain Protection Triggered', desc, 'rain_sensor');
        this.executeClotheslineAction('close', `Rain Protection (${desc})`);

        if (settings.pushNotificationsEnabled && settings.alerts.pagasaAlerts) {
          notificationService.sendNotification('🌧 Protecting Your Laundry', desc, { action: 'close' });
        }
      }
      return;
    }

    // Tier 3-8: Automatic Mode Decision Engine
    if (systemMode === 'auto') {
      if (isRainDetected || isRainRiskInNextNHours || isHabagatOrRainSystem || isAiCritical) {
        if (settings.autoClose && clotheslinePosition !== 'closed') {
          let desc = `${lookaheadRainProb}% rain probability within ${settings.lookaheadHours} hours`;
          if (isRainDetected) desc = 'Rain detected by local sensor';
          else if (isHabagatOrRainSystem) desc = `PAGASA: ${pagasaIntelligence.systemName} active`;
          else if (isAiCritical) desc = `AI Warning: ${aiAnalysis.expectedPattern}`;

          this.addActivityLog('Clothesline Closed Automatically', desc, 'rain_risk');
          this.executeClotheslineAction('close', `Auto Protection (${desc})`);

          if (settings.pushNotificationsEnabled && settings.alerts.autoRetract) {
            notificationService.sendNotification('🌧 Protecting Your Laundry', `Sampayan is retracting because ${desc}.`, { action: 'close' });
          }
        }
      } else {
        // Safe dry conditions
        if (settings.autoReopen && clotheslinePosition !== 'open' && !isHabagatOrRainSystem && aiAnalysis.aiRiskLevel === 'LOW') {
          const desc = `<${settings.rainThreshold}% rain expected for next ${settings.lookaheadHours} hours`;
          this.addActivityLog('Clothesline Opened Automatically', desc, 'safe');
          this.executeClotheslineAction('open', `Auto Reopen (${desc})`);

          if (settings.pushNotificationsEnabled && settings.alerts.autoOpen) {
            notificationService.sendNotification('☀️ Laundry Safe', `Sampayan is reopening the clothesline under clear dry skies.`, { action: 'open' });
          }
        }
      }
    }
  }

  /**
   * Updates Settings Configuration
   */
  updateSettings({ motorSpeed, openDurationSeconds, closeDurationSeconds, travelDurationSeconds, lookaheadHours, rainThreshold, autoClose, autoReopen, aiAnalysisEnabled, pagasaEnabled, pushNotificationsEnabled, alerts }) {
    if (motorSpeed !== undefined) {
      this.deviceState.settings.motorSpeed = Math.max(64, Math.min(255, Number(motorSpeed)));
      this.deviceState.speed = this.deviceState.settings.motorSpeed;
    }

    if (openDurationSeconds !== undefined) {
      this.deviceState.settings.openDurationSeconds = Math.max(0.1, Math.min(5.0, Number(openDurationSeconds)));
    }

    if (closeDurationSeconds !== undefined) {
      this.deviceState.settings.closeDurationSeconds = Math.max(0.1, Math.min(5.0, Number(closeDurationSeconds)));
    }

    if (travelDurationSeconds !== undefined) {
      this.deviceState.settings.travelDurationSeconds = Math.max(3, Math.min(60, Number(travelDurationSeconds)));
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

    if (aiAnalysisEnabled !== undefined) {
      this.deviceState.settings.aiAnalysisEnabled = Boolean(aiAnalysisEnabled);
    }

    if (pagasaEnabled !== undefined) {
      this.deviceState.settings.pagasaEnabled = Boolean(pagasaEnabled);
    }

    if (pushNotificationsEnabled !== undefined) {
      this.deviceState.settings.pushNotificationsEnabled = Boolean(pushNotificationsEnabled);
    }

    if (alerts && typeof alerts === 'object') {
      this.deviceState.settings.alerts = {
        ...this.deviceState.settings.alerts,
        ...alerts,
      };
    }

    this.addActivityLog('Settings Updated', `Speed: ${Math.round((this.deviceState.settings.motorSpeed/255)*100)}% | Open: ${this.deviceState.settings.openDurationSeconds}s | Close: ${this.deviceState.settings.closeDurationSeconds}s`, 'system');

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
    let durationSeconds = 1.8;

    const targetSpeed = customSpeed !== null ? Number(customSpeed) : this.deviceState.settings.motorSpeed;
    let buzzerStateNeeded = false;

    if (action === 'open') {
      dir = 'c';
      speed = targetSpeed;
      newPos = 'open';
      newMotorStatus = 'extending';
      durationSeconds = this.deviceState.settings.openDurationSeconds || 1.8;
      buzzerStateNeeded = true;
      this.addActivityLog('Clothesline Opened', reason, 'manual');
    } else if (action === 'close') {
      dir = 'cc';
      speed = targetSpeed;
      newPos = 'closed';
      newMotorStatus = 'retracting';
      durationSeconds = this.deviceState.settings.closeDurationSeconds || 2.1;
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

    // Automatically transition motorStatus to 'idle' and turn off buzzer after durationSeconds
    const travelMs = Math.round(durationSeconds * 1000);
    if (action === 'open' || action === 'close') {
      this.motorTimer = setTimeout(() => {
        this.deviceState.motorStatus = 'idle';
        this.deviceState.direction = 'stop';
        this.deviceState.buzzer = false;
        this.sendToDevice({ action: 'motor', dir: 'stop', speed: 0 });
        this.sendToDevice({ action: 'buzzer', state: false });
        
        if (this.deviceState.settings.pushNotificationsEnabled) {
          const title = action === 'open' ? '☀️ Clothesline Opened' : '✅ Laundry Protected';
          const body = action === 'open' ? 'Clothesline is now fully extended.' : 'The clothesline has been automatically retracted.';
          notificationService.sendNotification(title, body, { action });
        }

        this.broadcastStateToClients();
      }, travelMs);
    }

    const payload = {
      action: 'motor',
      clotheslineAction: action,
      dir: dir,
      speed: speed,
      duration: durationSeconds,
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
