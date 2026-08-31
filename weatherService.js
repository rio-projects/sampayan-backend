/**
 * Weather Service - Open-Meteo API Integration
 * Fetches real-time weather forecasts and N-hour rain probabilities without requiring an API key.
 */

const LATITUDE = process.env.WEATHER_LAT || '14.5995';   // Default: Manila, Philippines
const LONGITUDE = process.env.WEATHER_LON || '120.9842';

class WeatherService {
  constructor() {
    this.forecast = {
      rainProbability: 0,
      hourlyProbabilities: [0],
      isRaining: false,
      precipitation: 0,
      temperature: 28,
      humidity: 75,
      condition: 'Clear Sky',
      weatherCode: 0,
      lastUpdated: null,
      error: null,
    };

    this.pollInterval = null;
  }

  /**
   * Translates WMO Weather Code into human-readable condition
   */
  getWeatherConditionText(code) {
    if (code === 0) return 'Clear Sky';
    if (code >= 1 && code <= 3) return 'Partly Cloudy';
    if (code >= 45 && code <= 48) return 'Foggy';
    if (code >= 51 && code <= 55) return 'Light Drizzle';
    if (code >= 61 && code <= 65) return 'Rainy';
    if (code >= 80 && code <= 82) return 'Rain Showers';
    if (code >= 95 && code <= 99) return 'Thunderstorm';
    return 'Overcast';
  }

  /**
   * Fetches latest weather data from Open-Meteo API (12-hour hourly forecast)
   */
  async fetchWeather() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code&hourly=precipitation_probability&forecast_hours=12`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Open-Meteo returned HTTP ${res.status}`);
      }

      const data = await res.json();
      
      const current = data.current || {};
      const hourly = data.hourly || {};

      const hourlyProbabilities = hourly.precipitation_probability || [0];
      const maxRainProb = Math.max(...hourlyProbabilities.slice(0, 3), 0);
      const isCurrentlyRaining = (current.rain > 0 || current.precipitation > 0 || current.weather_code >= 51);

      this.forecast = {
        rainProbability: maxRainProb,
        hourlyProbabilities: hourlyProbabilities,
        isRaining: isCurrentlyRaining,
        precipitation: current.precipitation || 0,
        temperature: current.temperature_2m || 28,
        humidity: current.relative_humidity_2m || 75,
        condition: this.getWeatherConditionText(current.weather_code || 0),
        weatherCode: current.weather_code || 0,
        lastUpdated: new Date().toISOString(),
        error: null,
      };

      return this.forecast;
    } catch (err) {
      console.warn('[WEATHER WARN] Failed to fetch Open-Meteo data:', err.message);
      this.forecast.error = err.message;
      return this.forecast;
    }
  }

  /**
   * Computes maximum rain probability for the next N hours
   */
  getLookaheadRainProb(nHours = 3) {
    const hours = Math.max(1, Math.min(12, Number(nHours) || 3));
    const slice = this.forecast.hourlyProbabilities.slice(0, hours);
    return Math.max(...slice, 0);
  }

  /**
   * Starts periodic polling (default: every 3 minutes)
   */
  startPolling(intervalMs = 180000, onUpdateCallback = null) {
    this.fetchWeather().then((data) => {
      if (onUpdateCallback) onUpdateCallback(data);
    });

    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      const updated = await this.fetchWeather();
      if (onUpdateCallback) onUpdateCallback(updated);
    }, intervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Get cached forecast snapshot
   */
  getSnapshot() {
    return this.forecast;
  }
}

module.exports = new WeatherService();
