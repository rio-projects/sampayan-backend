# ESP32 Motor Controller - Backend Service

Standalone Node.js WebSocket & REST API Backend Service for managing ESP32 hardware devices and serving real-time telemetry to mobile/web clients.

## 📁 Repository Structure

```text
.
├── index.js          # Express HTTP API & WebSocket upgrade server
├── deviceManager.js  # Device connection registry & telemetry broadcasting
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

2. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   # or
   npm start
   ```

   The server will run on `http://localhost:4000`.

---

## ☁️ Deploying to VPS via GitHub

### 1. Push Standalone Server to GitHub
If you want to maintain this backend in a separate repository on GitHub:

```bash
cd server
git init
git add .
git commit -m "Initial commit of ESP32 backend service"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/esp32-backend.git
git push -u origin main
```

### 2. Pull & Deploy on your VPS

On your VPS (Ubuntu/Debian):

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/esp32-backend.git
cd esp32-backend

# Install production dependencies
npm install --production

# Create production .env file
cp .env.example .env
nano .env  # Edit PORT and settings if needed
```

### 3. Keep Server Running with PM2
Use **PM2** to run the backend continuously in the background and auto-restart on reboot:

```bash
# Install PM2 globally if not already installed
sudo npm install -g pm2

# Start backend service
pm2 start index.js --name "esp32-backend"

# Save PM2 process list to start on server reboot
pm2 save
pm2 startup
```

### 4. Nginx Reverse Proxy with SSL (Optional / Recommended for WSS)
To enable secure WebSocket (`wss://`) and HTTPS (`https://`):

```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🔌 API Summary

### HTTP REST Endpoints
* **`GET /api/health`**: Health check & connected device status.
* **`GET /api/status`**: Detailed device telemetry snapshot.
* **`POST /api/motor`**: Send motor command `{"dir": "c"|"cc"|"stop", "speed": 0..255}`.
* **`POST /api/buzzer`**: Send buzzer command `{"state": true|false}`.

### WebSocket Endpoints
* **`ws://<SERVER_HOST>:4000/ws/device`**: Dedicated endpoint for ESP32 hardware client.
* **`ws://<SERVER_HOST>:4000/ws/client`**: Real-time telemetry subscription endpoint for Web/Mobile apps.
# sampayan-backend
