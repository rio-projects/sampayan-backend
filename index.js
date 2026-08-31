require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const deviceManager = require('./deviceManager');
const weatherService = require('./weatherService');
const pagasaService = require('./pagasaService');
const aiAnalysisService = require('./aiAnalysisService');
const notificationService = require('./notificationService');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json());

// Log incoming API calls
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && req.path !== '/api/health' && req.path !== '/api/status') {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] 🌐 [HTTP REQUEST] ${req.method} ${req.path}`);
  }
  next();
});

// --- REST API Endpoints ---

// Health & System Information
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    server: 'Automated Smart Clothesline Backend',
    version: '3.0.0',
    uptime: Math.floor(process.uptime()),
    device: deviceManager.getSnapshot(),
  });
});

// Telemetry & Device Status
app.get('/api/status', (req, res) => {
  res.json(deviceManager.getSnapshot());
});

// Weather Snapshot Endpoint
app.get('/api/weather', async (req, res) => {
  const forecast = await weatherService.fetchWeather();
  res.json(forecast);
});

// PAGASA Weather Intelligence Endpoint
app.get('/api/pagasa', (req, res) => {
  res.json(pagasaService.getIntelligence());
});

// AI Weather Risk Analysis Endpoint
app.get('/api/ai-analysis', (req, res) => {
  const snapshot = deviceManager.getSnapshot();
  const analysis = aiAnalysisService.analyze(snapshot.weatherForecast, snapshot);
  res.json(analysis);
});

// Push Notification Registration Endpoint
app.post('/api/notifications/register', (req, res) => {
  const { token } = req.body;
  const registered = notificationService.registerToken(token);
  res.json({ success: registered, token });
});

// Settings Configuration Endpoint
app.post('/api/settings', (req, res) => {
  const updatedSettings = deviceManager.updateSettings(req.body);
  res.json({
    success: true,
    settings: updatedSettings,
    state: deviceManager.getSnapshot(),
  });
});

// Mode Selector Endpoint (AUTOMATIC / MANUAL)
app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (!mode || (mode !== 'auto' && mode !== 'manual')) {
    return res.status(400).json({ error: 'Invalid or missing field "mode". Must be "auto" or "manual".' });
  }

  const success = deviceManager.setSystemMode(mode);
  res.json({
    success,
    mode,
    state: deviceManager.getSnapshot(),
  });
});

// Rain Safety Override Endpoint
app.post('/api/override', (req, res) => {
  const { enabled } = req.body;
  if (enabled === undefined) {
    return res.status(400).json({ error: 'Missing required boolean field "enabled".' });
  }

  const success = deviceManager.setRainSafetyOverride(Boolean(enabled));
  res.json({
    success,
    rainSafetyOverride: Boolean(enabled),
    state: deviceManager.getSnapshot(),
  });
});

// Clothesline Control Endpoint (OPEN / CLOSE / STOP)
app.post('/api/clothesline', (req, res) => {
  const { action, speed, force, source = 'MANUAL' } = req.body;
  const normalizedAction = (action || '').toLowerCase();
  if (!normalizedAction || (normalizedAction !== 'open' && normalizedAction !== 'close' && normalizedAction !== 'stop')) {
    return res.status(400).json({ error: 'Invalid or missing field "action". Must be "open", "close", or "stop".' });
  }

  const result = deviceManager.executeClotheslineAction(normalizedAction, `Manual API Command (${source})`, speed, force, source);
  res.status(result.success ? 200 : 503).json({
    success: result.success,
    action: normalizedAction,
    message: result.message,
    state: result.state,
  });
});

// Explicit Motor Direction Control Endpoint (CLOCKWISE / COUNTER_CLOCKWISE / STOP)
app.post('/api/motor', (req, res) => {
  const { direction, dir, speed, source = 'MANUAL' } = req.body;
  const targetDir = direction || dir;

  if (!targetDir) {
    return res.status(400).json({ error: 'Missing required field: direction (CLOCKWISE, COUNTER_CLOCKWISE, STOP)' });
  }

  const speedVal = speed !== undefined ? Number(speed) : 255;
  const result = deviceManager.sendMotorCommand(targetDir, speedVal, source, `Direct Motor API (${source})`);

  return res.status(result.success ? 200 : 503).json({
    success: result.success,
    message: result.message,
    state: result.state,
  });
});

// Buzzer Control Endpoint
app.post('/api/buzzer', (req, res) => {
  const { state } = req.body;
  if (state === undefined) {
    return res.status(400).json({ error: 'Missing required field: state' });
  }

  const result = deviceManager.sendBuzzerCommand(Boolean(state));

  return res.json({
    success: result.success,
    message: result.success ? 'Buzzer command sent' : 'Buzzer command queued (ESP32 offline)',
    state: result.state,
  });
});

// --- HTTP & WebSocket Server Setup ---
const server = http.createServer(app);

// Create WebSocket servers for Device and Client
const wssDevice = new WebSocketServer({ noServer: true });
const wssClient = new WebSocketServer({ noServer: true });

wssDevice.on('connection', (ws, req) => {
  deviceManager.setDeviceSocket(ws, req);
});

wssClient.on('connection', (ws, req) => {
  deviceManager.addClientSocket(ws, req);
});

// Handle HTTP Upgrade requests to route WebSocket paths safely
server.on('upgrade', (request, socket, head) => {
  const urlPath = request.url || '';

  if (urlPath.includes('device')) {
    wssDevice.handleUpgrade(request, socket, head, (ws) => {
      wssDevice.emit('connection', ws, request);
    });
  } else if (urlPath.includes('client') || urlPath.includes('ws')) {
    wssClient.handleUpgrade(request, socket, head, (ws) => {
      wssClient.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=================================================`);
  console.log(` Automated Smart Clothesline Backend Running     `);
  console.log(` HTTP API:   http://${HOST}:${PORT}/api/health    `);
  console.log(` Device WS:  ws://${HOST}:${PORT}/ws/device       `);
  console.log(` Client WS:  ws://${HOST}:${PORT}/ws/client       `);
  console.log(`=================================================`);
});
