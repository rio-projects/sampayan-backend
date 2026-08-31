/**
 * AI Weather Analysis Engine - Sampayan Backend
 * 
 * Leverages Google Gemini API (gemini-2.5-flash) to perform real-time intelligent
 * weather synthesis and laundry safety risk assessment.
 * Falls back to deterministic heuristic analysis if GEMINI_API_KEY is not set or network fails.
 */

const { GoogleGenAI } = require('@google/genai');
const pagasaService = require('./pagasaService');

class AiAnalysisService {
  constructor() {
    this.cachedAnalysis = null;
    this.lastAnalyzedTime = 0;
    this.cacheTtlMs = 5 * 60 * 1000; // Cache Gemini results for 5 minutes
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  getStatus() {
    return {
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      model: this.model,
      cacheTtlSeconds: Math.round(this.cacheTtlMs / 1000),
      hasCachedAnalysis: Boolean(this.cachedAnalysis),
      lastAnalyzedAt: this.lastAnalyzedTime ? new Date(this.lastAnalyzedTime).toISOString() : null,
    };
  }

  /**
   * Initializes GoogleGenAI client if GEMINI_API_KEY environment variable is present
   */
  getAiClient() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    try {
      return new GoogleGenAI({ apiKey });
    } catch (err) {
      console.warn('[GEMINI INIT ERR]', err.message);
      return null;
    }
  }

  /**
   * Analyzes weather forecast & PAGASA intelligence using Google Gemini API
   */
  async analyze(weatherData = {}, deviceState = {}) {
    const now = Date.now();
    // Return cached analysis if fresh
    if (this.cachedAnalysis && (now - this.lastAnalyzedTime < this.cacheTtlMs)) {
      return this.cachedAnalysis;
    }

    const aiClient = this.getAiClient();
    if (aiClient) {
      try {
        const geminiResult = await this.analyzeWithGemini(aiClient, weatherData, deviceState);
        if (geminiResult) {
          this.cachedAnalysis = geminiResult;
          this.lastAnalyzedTime = now;
          return geminiResult;
        }
      } catch (err) {
        console.error('[GEMINI API CALL ERR]', err.message);
      }
    }

    // Fallback to deterministic heuristic engine
    const fallbackResult = this.analyzeHeuristic(weatherData, deviceState);
    this.cachedAnalysis = fallbackResult;
    this.lastAnalyzedTime = now;
    return fallbackResult;
  }

  /**
   * Calls Google Gemini API (gemini-2.5-flash) with structured JSON schema output
   */
  async analyzeWithGemini(aiClient, weatherData, deviceState) {
    const pagasa = pagasaService.getIntelligence();
    const rainProb = weatherData.rainProbability || 0;
    const lookaheadProb = weatherData.lookaheadRainProbability || rainProb;
    const humidity = weatherData.humidity || 65;
    const temp = weatherData.temperature || 28;
    const isRaining = weatherData.isRaining || false;
    const rainSensor = deviceState.rainSensor || false;
    const position = deviceState.clotheslinePosition || 'open';

    const prompt = `
You are Sampayan AI, an expert Philippine weather intelligence and smart clothesline safety system.
Analyze the following real-time atmospheric and hardware telemetry to produce a structured JSON laundry safety risk assessment.

CURRENT TELEMETRY:
- Current Temperature: ${temp}°C
- Current Humidity: ${humidity}%
- Immediate Rain Probability: ${rainProb}%
- Peak Rain Risk (Next Lookahead Window): ${lookaheadProb}%
- Local Rain Sensor Triggered: ${rainSensor ? 'YES' : 'NO'}
- Active Weather Condition: ${weatherData.condition || 'Clear'}
- Current Raining State: ${isRaining ? 'YES' : 'NO'}
- PAGASA Primary Weather System: ${pagasa.primarySystem} (${pagasa.systemName})
- PAGASA Status: ${pagasa.status}
- PAGASA Pattern: ${pagasa.patternDescription}
- Clothesline Current Position: ${position.toUpperCase()}

Return ONLY a valid JSON object matching the exact JSON structure:
{
  "aiRiskLevel": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
  "laundryRecommendation": "SAFE_OUTSIDE" | "MONITOR" | "RETRACT_SOON" | "RETRACT_IMMEDIATELY" | "KEEP_RETRACTED",
  "weatherCause": "Short summary of primary weather cause (e.g. Southwest Monsoon Habagat)",
  "expectedPattern": "Human readable weather forecast pattern (e.g. Intermittent heavy rain showers expected)",
  "laundryImpact": "Impact on laundry outdoor drying (e.g. High risk of laundry getting soaked)",
  "recommendedAction": "Action string (e.g. Keep clothesline retracted under cover)"
}
`;

    const response = await aiClient.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    if (response && response.text) {
      const parsed = JSON.parse(response.text.trim());
      console.log(`[GEMINI API SUCCESS] 🤖 Risk: ${parsed.aiRiskLevel} | Recommendation: ${parsed.laundryRecommendation}`);
      return {
        ...parsed,
        source: 'Google Gemini (' + this.model + ')',
        evaluatedAt: new Date().toISOString(),
      };
    }
    return null;
  }

  /**
   * Fallback heuristic rule engine if GEMINI_API_KEY is not set
   */
  analyzeHeuristic(weatherData = {}, deviceState = {}) {
    const rainProb = weatherData.rainProbability || 0;
    const lookaheadProb = weatherData.lookaheadRainProbability || rainProb;
    const humidity = weatherData.humidity || 65;
    const isRaining = weatherData.isRaining || false;
    const pagasa = pagasaService.getIntelligence();
    const position = deviceState.clotheslinePosition || 'open';

    let riskLevel = 'LOW';
    let recommendation = 'SAFE_OUTSIDE';
    let cause = pagasa.systemName !== 'None' ? pagasa.systemName : 'Dry Atmospheric Conditions';
    let pattern = 'Favorable dry weather with adequate sunlight.';
    let impact = 'Optimal laundry drying conditions.';
    let action = 'KEEP_OPEN';

    if (isRaining || rainProb >= 70 || lookaheadProb >= 70 || pagasa.riskLevel === 'CRITICAL') {
      riskLevel = 'CRITICAL';
      recommendation = position === 'closed' ? 'KEEP_RETRACTED' : 'RETRACT_IMMEDIATELY';
      cause = isRaining ? 'Active Rainfall Detected' : (pagasa.systemName !== 'None' ? pagasa.systemName : 'Severe Rain Forecast');
      pattern = 'Imminent rain showers and heavy moisture risk.';
      impact = 'High risk of laundry getting wet and damaged.';
      action = 'Retract clothesline under cover immediately.';
    } else if (rainProb >= 40 || lookaheadProb >= 40 || pagasa.riskLevel === 'HIGH') {
      riskLevel = 'HIGH';
      recommendation = position === 'closed' ? 'KEEP_RETRACTED' : 'RETRACT_SOON';
      cause = pagasa.primarySystem !== 'NONE' ? pagasa.systemName : 'Elevated Rain Probability';
      pattern = 'Intermittent rain showers expected within lookahead window.';
      impact = 'Slow drying and high probability of repeated rainfall.';
      action = 'Retract clothesline or monitor closely.';
    } else if (rainProb >= 20 || lookaheadProb >= 20 || humidity > 85 || pagasa.riskLevel === 'MODERATE') {
      riskLevel = 'MODERATE';
      recommendation = 'MONITOR';
      cause = humidity > 85 ? 'High Humidity' : 'Slight Rain Risk';
      pattern = 'Partly cloudy conditions with occasional moisture.';
      impact = 'Drying speed reduced due to moisture levels.';
      action = 'Keep clothesline open but remain attentive.';
    } else {
      riskLevel = 'LOW';
      recommendation = position === 'closed' ? 'SAFE_TO_REOPEN' : 'SAFE_OUTSIDE';
      cause = 'Clear Weather';
      pattern = 'Dry conditions expected across lookahead window.';
      impact = 'Fast and safe outdoor laundry drying.';
      action = 'Laundry can remain outside safely.';
    }

    return {
      aiRiskLevel: riskLevel,
      laundryRecommendation: recommendation,
      weatherCause: cause,
      expectedPattern: pattern,
      laundryImpact: impact,
      recommendedAction: action,
      source: 'Deterministic Heuristic Fallback',
      evaluatedAt: new Date().toISOString(),
    };
  }
}

module.exports = new AiAnalysisService();
