/**
 * Push Notification Service - Sampayan Backend
 * 
 * Manages notification registrations and dispatches alert messages
 * for weather events, automatic motor actions, and device status changes.
 */

class NotificationService {
  constructor() {
    this.pushTokens = new Set();
    this.sentHistory = [];
  }

  /**
   * Registers a push token from client app
   */
  registerToken(token) {
    if (token && typeof token === 'string') {
      this.pushTokens.add(token);
      console.log(`[PUSH NOTIF] Registered token: ${token}`);
      return true;
    }
    return false;
  }

  /**
   * Sends a notification payload to registered devices
   */
  async sendNotification(title, body, data = {}) {
    const notificationItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      body,
      data,
      timestamp: new Date().toISOString(),
    };

    this.sentHistory.unshift(notificationItem);
    if (this.sentHistory.length > 50) this.sentHistory.pop();

    console.log(`[PUSH NOTIF SENT] 🔔 "${title}" - ${body}`);

    // If tokens are registered, dispatch via Expo Push API
    if (this.pushTokens.size > 0) {
      const messages = Array.from(this.pushTokens).map((token) => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
      }));

      try {
        // Dispatch to Expo Push Server endpoint
        const fetch = (await import('node-fetch')).default;
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messages),
        });
      } catch (err) {
        console.error('[PUSH DISPATCH ERR]', err.message);
      }
    }

    return notificationItem;
  }

  getHistory() {
    return this.sentHistory;
  }
}

module.exports = new NotificationService();
