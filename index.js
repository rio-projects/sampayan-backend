require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const deviceManager = require('./deviceManager');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json());

// Log incoming API calls
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && req.path !== '/api/health') {
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
    server: 'ESP32 Motor Control Backend',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    device: deviceManager.getSnapshot(),
  });
});

// Telemetry & Device Status
app.get('/api/status', (req, res) => {
  res.json(deviceManager.getSnapshot());
});

// Motor Control Endpoint
app.post('/api/motor', (req, res) => {
  const { dir, speed } = req.body;
  if (!dir) {
    return res.status(400).json({ error: 'Missing required field: dir' });
  }

  const speedVal = speed !== undefined ? Number(speed) : 128;
  const result = deviceManager.sendMotorCommand(dir, speedVal);

  return res.json({
    success: result.success,
    message: result.success ? 'Command sent to ESP32' : 'Command queued (ESP32 offline)',
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

// Handle HTTP Upgrade requests to route WebSocket paths
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/ws/device') {
    wssDevice.handleUpgrade(request, socket, head, (ws) => {
      wssDevice.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/client' || pathname === '/ws') {
    wssClient.handleUpgrade(request, socket, head, (ws) => {
      wssClient.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=================================================`);
  console.log(` ESP32 Control Backend Service Running           `);
  console.log(` HTTP API:   http://${HOST}:${PORT}/api/health    `);
  console.log(` Device WS:  ws://${HOST}:${PORT}/ws/device       `);
  console.log(` Client WS:  ws://${HOST}:${PORT}/ws/client       `);
  console.log(`=================================================`);
});
