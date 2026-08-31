/**
 * Motor Control Manager & Stateful Motor Direction Engine
 * Ensures deterministic, stateful, direction-aware motor control with
 * sequential command queueing, direction reversal safety delays, duplicate filtering,
 * and ESP acknowledgement tracking.
 */

class MotorControlManager {
  constructor() {
    // --- Motor State Machine ---
    // Valid states: 'IDLE' | 'CLOCKWISE' | 'COUNTER_CLOCKWISE' | 'STOPPING'
    this.motorState = 'IDLE';
    this.motorDirection = 'NONE'; // 'NONE' | 'CLOCKWISE' | 'COUNTER_CLOCKWISE'
    this.lastDirection = 'NONE';
    this.commandSource = 'SYSTEM'; // 'MANUAL' | 'AUTOMATION' | 'SYSTEM' | 'SAFETY'
    this.commandStartedAt = null;
    this.commandDuration = 0;

    // Safety Delay configuration (in ms) when reversing motor direction or overriding
    this.reversalDelayMs = 1000; // 1 second delay

    // Active movement auto-stop timer
    this.autoStopTimer = null;

    // References to DeviceManager callback hooks
    this.sendToDeviceCallback = null;
    this.broadcastStateCallback = null;
    this.addActivityLogCallback = null;
    this.deviceStateRef = null;
  }

  /**
   * Initializes references to DeviceManager state and communications
   */
  init({ sendToDevice, broadcastState, addActivityLog, deviceState }) {
    this.sendToDeviceCallback = sendToDevice;
    this.broadcastStateCallback = broadcastState;
    this.addActivityLogCallback = addActivityLog;
    this.deviceStateRef = deviceState;
  }

  /**
   * Helper to log activity to DeviceManager timeline
   */
  logActivity(title, description, type = 'system') {
    if (this.addActivityLogCallback) {
      this.addActivityLogCallback(title, description, type);
    }
  }

  /**
   * Helper to broadcast state changes to all WebSocket client apps
   */
  notifyStateChange() {
    if (this.deviceStateRef) {
      // Sync deviceState properties for backward compatibility
      this.deviceStateRef.motorState = this.motorState;
      this.deviceStateRef.motorDirection = this.motorDirection;
      this.deviceStateRef.lastDirection = this.lastDirection;
      this.deviceStateRef.commandSource = this.commandSource;
      this.deviceStateRef.commandStartedAt = this.commandStartedAt;
      this.deviceStateRef.commandDuration = this.commandDuration;

      // Update legacy fields
      if (this.motorDirection === 'CLOCKWISE') {
        this.deviceStateRef.direction = 'c';
        this.deviceStateRef.motorStatus = 'extending';
      } else if (this.motorDirection === 'COUNTER_CLOCKWISE') {
        this.deviceStateRef.direction = 'cc';
        this.deviceStateRef.motorStatus = 'retracting';
      } else {
        this.deviceStateRef.direction = 'stop';
        this.deviceStateRef.motorStatus = this.motorState === 'STOPPING' ? 'stopping' : 'idle';
      }
    }

    if (this.broadcastStateCallback) {
      this.broadcastStateCallback();
    }
  }

  /**
   * Translates higher level clothesline position intention ('OPEN' | 'CLOSE' | 'STOP')
   * to low-level motor direction based on mechanical mapping settings.
   */
  resolveDirectionFromAction(action) {
    const mapping = (this.deviceStateRef && this.deviceStateRef.settings && this.deviceStateRef.settings.directionMapping) || 'NORMAL';
    // NORMAL: OPEN -> CLOCKWISE, CLOSE -> COUNTER_CLOCKWISE
    // REVERSED: OPEN -> COUNTER_CLOCKWISE, CLOSE -> CLOCKWISE
    if (action === 'OPEN' || action === 'open') {
      return mapping === 'REVERSED' ? 'COUNTER_CLOCKWISE' : 'CLOCKWISE';
    }
    if (action === 'CLOSE' || action === 'close') {
      return mapping === 'REVERSED' ? 'CLOCKWISE' : 'COUNTER_CLOCKWISE';
    }
    return 'STOP';
  }

  /**
   * Public entry point for motor control requests.
   * Immediately overrides active movement and executes command with 1s safety pause if motor is active.
   */
  requestMotorCommand({ targetDirection, action, speed, duration, source = 'MANUAL', reason = '' }) {
    // Determine target motor direction
    let dir = targetDirection;
    if (!dir && action) {
      dir = this.resolveDirectionFromAction(action);
    }
    if (!dir) dir = 'STOP';

    const req = {
      direction: dir,
      action: action || (dir === 'CLOCKWISE' ? 'OPEN' : dir === 'COUNTER_CLOCKWISE' ? 'CLOSE' : 'STOP'),
      speed: speed !== undefined && speed !== null ? Number(speed) : (this.deviceStateRef?.settings?.motorSpeed || 255),
      duration: duration !== undefined && duration !== null ? Number(duration) : 1.8,
      source: source || 'MANUAL',
      reason: reason || 'User Command',
      timestamp: Date.now(),
    };

    // Execute immediately without queuing (overriding active movement)
    this.executeSingleCommand(req);

    return {
      success: true,
      message: `Command ${req.direction} executing (override mode)`,
      state: this.getMotorStateSnapshot(),
    };
  }

  /**
   * Immediately executes motor command, overriding existing duration timer.
   * Enforces a 1-second delay if motor is currently moving.
   */
  async executeSingleCommand(cmd) {
    const { direction, action, speed, duration, source, reason } = cmd;

    // 1. Instantly override active movement: Clear existing auto-stop duration timer
    if (this.autoStopTimer) {
      console.log(`[MOTOR ENGINE] Overriding active duration timer.`);
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    // 2. Check if motor is currently active/moving
    const isCurrentlyActive = this.motorState !== 'IDLE';

    if (direction === 'STOP') {
      await this.sendStopToHardware(source, reason);
      this.motorState = 'IDLE';
      this.motorDirection = 'NONE';
      this.commandSource = source;
      if (this.deviceStateRef) {
        this.deviceStateRef.clotheslinePosition = 'partial';
      }
      this.notifyStateChange();
      this.logActivity('Motor Stopped', reason, source.toLowerCase());
      return;
    }

    // 3. If motor was running, enforce a 1-second hardware pause before starting new direction
    if (isCurrentlyActive) {
      console.log(`[MOTOR ENGINE] Motor currently active (${this.motorState}). Sending STOP & waiting 1s before starting ${direction}.`);
      this.logActivity('Motor Direction Override', `Stopping motor & pausing 1s before switching to ${direction}`, 'system');

      // Step A: Send STOP command to hardware immediately
      await this.sendStopToHardware(source, 'Direction Override Pause');

      // Step B: Set state to STOPPING and wait 1 second (1000ms)
      this.motorState = 'STOPPING';
      this.notifyStateChange();

      await new Promise((resolve) => setTimeout(resolve, this.reversalDelayMs));

      // Step C: Transition state to IDLE before starting new movement
      this.motorState = 'IDLE';
      this.motorDirection = 'NONE';
      this.notifyStateChange();
    }

    // 4. Execute CLOCKWISE or COUNTER_CLOCKWISE
    const commandPayload = {
        command: 'MOTOR_MOVE',
        direction: direction,
        action: action, // Legacy support
        dir: direction === 'CLOCKWISE' ? 'c' : 'cc', // Legacy ESP compatibility
        speed: speed,
        duration: duration,
        source: source,
        reason: reason,
      };

      this.motorState = direction;
      this.motorDirection = direction;
      this.lastDirection = direction;
      this.commandSource = source;
      this.commandStartedAt = new Date().toISOString();
      this.commandDuration = duration;

      if (this.deviceStateRef) {
        this.deviceStateRef.speed = speed;
        this.deviceStateRef.buzzer = true;
      }

      // Send WebSocket message to ESP32
      if (this.sendToDeviceCallback) {
        this.sendToDeviceCallback(commandPayload);
        this.sendToDeviceCallback({ action: 'buzzer', state: true });
      }

      this.notifyStateChange();
      this.logActivity(`Motor ${direction}`, `${reason} (${duration}s @ PWM ${speed})`, source.toLowerCase());

      // 5. Schedule Automatic Stop Timer after duration
      const durationMs = Math.round(duration * 1000);
      this.autoStopTimer = setTimeout(async () => {
        console.log(`[MOTOR ENGINE] Movement duration completed (${duration}s). Stopping motor.`);
        await this.sendStopToHardware(source, 'Duration Complete');

        this.motorState = 'IDLE';
        this.motorDirection = 'NONE';

        if (this.deviceStateRef) {
          this.deviceStateRef.buzzer = false;
          if (action === 'OPEN') this.deviceStateRef.clotheslinePosition = 'open';
          if (action === 'CLOSE') this.deviceStateRef.clotheslinePosition = 'closed';
        }

        if (this.sendToDeviceCallback) {
          this.sendToDeviceCallback({ action: 'buzzer', state: false });
        }

        this.notifyStateChange();
      }, durationMs);
  }

  /**
   * Helper to send STOP command payload to hardware
   */
  async sendStopToHardware(source, reason) {
    const stopPayload = {
      command: 'MOTOR_STOP',
      direction: 'STOP',
      action: 'stop',
      dir: 'stop',
      speed: 0,
      source: source,
      reason: reason,
    };

    if (this.sendToDeviceCallback) {
      this.sendToDeviceCallback(stopPayload);
    }
  }

  /**
   * Processes incoming Acknowledgement & Telemetry messages from ESP32
   */
  handleHardwareAck(payload) {
    if (payload.type === 'ack' || payload.status) {
      console.log(`[MOTOR ENGINE ACK] ESP32 reported status: ${payload.status || payload.type} for command: ${payload.command || payload.direction}`);
      if (payload.status === 'MOTOR_STOPPED') {
        this.motorState = 'IDLE';
        this.motorDirection = 'NONE';
        this.notifyStateChange();
      } else if (payload.status === 'MOTOR_RUNNING' && payload.direction) {
        this.motorState = payload.direction;
        this.motorDirection = payload.direction;
        this.notifyStateChange();
      }
    }
  }

  /**
   * Returns current state snapshot
   */
  getMotorStateSnapshot() {
    return {
      motorState: this.motorState,
      motorDirection: this.motorDirection,
      lastDirection: this.lastDirection,
      commandSource: this.commandSource,
      commandStartedAt: this.commandStartedAt,
      commandDuration: this.commandDuration,
    };
  }
}

module.exports = new MotorControlManager();
