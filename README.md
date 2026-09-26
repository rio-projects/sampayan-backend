# Automated Smart Clothesline System - Backend Service

Standalone Node.js WebSocket & REST API Backend Service for managing ESP32 Smart Clothesline devices, Open-Meteo Weather API automation, and serving real-time telemetry to mobile/web clients.

## 📁 Repository Structure

```text
.
├── index.js          # Express HTTP API & WebSocket upgrade server
├── deviceManager.js  # Automated decision engine, system mode & telemetry manager
├── weatherService.js # Open-Meteo Weather API integration (rain forecast polling)
├── package.json      # Dependencies (express, ws, cors, dotenv)
├── .env.example      # Sample environment configuration
├── .gitignore        # Ignores node_modules and secret .env
└── README.md         # Deployment & API documentation
```

---

## 🛠️ Local Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables (Optional)**:
   ```bash
   cp .env.example .env
   ```

3. **Start Backend Server**:
   ```bash
   npm start
   ```

   The server will run on `http://localhost:4000`.

---

## 🔌 Updated REST API Summary

### System & Telemetry Endpoints
* **`GET /api/ai-analysis`**: Run or retrieve the cached Gemini weather-risk analysis.
* **`GET /api/ai-status`**: Report Gemini configuration and cache status without exposing the API key.
* **`GET /api/health`**: Health check, server uptime, and device state snapshot.
* **`GET /api/status`**: Detailed device telemetry and weather snapshot.
* **`GET /api/weather`**: Real-time Open-Meteo weather forecast snapshot.

### Clothesline Automation & Control Endpoints
* **`POST /api/mode`**: Toggle operating mode `{"mode": "auto" | "manual"}`.
* **`POST /api/override`**: Toggle Rain Safety Override `{"enabled": true | false}`.
* **`POST /api/clothesline`**: Send clothesline action `{"action": "open" | "close" | "stop"}`.
* **`POST /api/buzzer`**: Toggle warning buzzer `{"state": true | false}`.

### WebSocket Endpoints
* **`ws://<SERVER_HOST>:4000/ws/device`**: Dedicated WebSocket for ESP32 hardware client.
* **`ws://<SERVER_HOST>:4000/ws/client`**: Real-time telemetry subscription endpoint for Web/Mobile apps.


## AI rain risk settings

AI risk uses the peak hourly precipitation probability within `lookaheadHours`
(1–12 hours) and compares it with `rainThreshold` (0–100%). Equality meets the
trigger. For example, a 15% peak exceeds a 10% trigger but stays below a 20%
trigger; rain beyond the selected window does not trigger forecast risk.
Active rainfall and PAGASA warnings can override the probability comparison.
Humidity affects drying speed rather than independently triggering rain risk.

The Gemini prompt and deterministic fallback share these rules. Contradictory
Gemini decision fields fall back to deterministic advice. Cached analysis is
invalidated by changed settings, weather, location, position, sensor state or
PAGASA intelligence. Saving risk settings immediately recomputes deterministic
advice before evaluating automation; subsequent AI analysis uses the new inputs.
The displayed risk window includes its duration, peak probability and threshold.

Deploy the updated `aiAnalysisService.js` and `deviceManager.js` to the VPS and
restart the backend to apply this behavior. No ESP32 firmware update is required.
