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
  async analyzeWithGemini(aiClient, weatherData = {}, deviceState = {}) {
    const pagasa = pagasaService.getIntelligence();
    const rainProb = weatherData.rainProbability || 0;
    const lookaheadProb = weatherData.lookaheadRainProbability || rainProb;
    const humidity = weatherData.humidity || 65;
    const temp = weatherData.temperature || 28;
    const isRaining = weatherData.isRaining || false;
    const rainSensor = deviceState.rainSensor || false;
    const position = deviceState.clotheslinePosition || 'open';
    const locName = weatherData.locationName || deviceState.location?.name || 'Manila, Philippines';
    const lat = weatherData.latitude || deviceState.location?.latitude || 14.5995;
    const lon = weatherData.longitude || deviceState.location?.longitude || 120.9842;
    const lookaheadHours = deviceState.settings?.lookaheadHours || 3;

    const prompt = `
You are Sampayan AI, an expert Philippine meteorological and automated clothesline risk intelligence engine.
Base your evaluation strictly on the live telemetry and location provided below. Do not invent ungrounded weather data or bulletins.
Crucially, provide a deep, paragraph-by-paragraph technical analysis rather than concise bullet points or surface suggestions.

TELEMETRY & GEOLOCATION SNAPSHOT:
- User Location: ${locName} (Coordinates: ${lat}° N, ${lon}° E)
- Temperature: ${temp}°C
- Relative Humidity: ${humidity}%
- Immediate Rain Probability: ${rainProb}%
- Peak Rain Probability (${lookaheadHours}-hour window): ${lookaheadProb}%
- Configured Rain Threshold: ${deviceState.settings?.rainThreshold || 10}%
- Hardware Rain Sensor: ${rainSensor ? 'WET / TRIGGERED' : 'DRY'}
- Current Weather Condition: ${weatherData.condition || 'Unknown'}
- Active Rain Falling: ${isRaining ? 'YES' : 'NO'}
- PAGASA Primary System: ${pagasa.primarySystem} - ${pagasa.systemName}
- PAGASA Advisory & Risk: ${pagasa.riskLevel} - ${pagasa.status}
- PAGASA Pattern: ${pagasa.patternDescription}
- Outdoor Clothesline Position: ${position.toUpperCase()}

Return ONLY a valid JSON object following this EXACT schema. Make the 4 paragraph fields detailed, highly articulate, and well-written (each paragraph must be 3-5 sentences long):

{
  "aiRiskLevel": "LOW | MODERATE | HIGH | CRITICAL",
  "confidencePercent": 90,
  "laundryRecommendation": "SAFE_OUTSIDE | MONITOR | RETRACT_SOON | RETRACT_IMMEDIATELY | KEEP_RETRACTED | SAFE_TO_REOPEN",
  "locationContext": "Location string including city and lat/lon",
  "overviewParagraph": "Detailed Executive Overview paragraph (3-5 sentences). Synthesize real-time weather parameters, current user location, ambient temperature, humidity, immediate rain risk, and active PAGASA weather advisories into a complete narrative.",
  "hazardBreakdownParagraph": "Micro-Climate Hazard & Precipitation Analysis paragraph (3-5 sentences). Provide a thorough analysis of cloud dynamics, moisture accumulation, forecast precipitation probability trends across the lookahead window, and potential sudden rain squall triggers.",
  "dryingOutlookParagraph": "Outdoor Laundry Drying Feasibility & Fabric Protection paragraph (3-5 sentences). Analyze drying speed, atmospheric evaporation potential, humidity impact on heavy versus light fabrics, and specific risk of clothes retaining mildew or getting soaked.",
  "actionPlanParagraph": "Strategic Motor Automation & Action Plan paragraph (3-5 sentences). Deliver clear operational guidance specifying whether the motorized clothesline must extend, retract, or remain protected, detailing safety overrides, user precautions, and key telemetry triggers for reassessment.",
  "analysisSummary": "Two-sentence quick summary for quick glance",
  "weatherCause": "Specific observed or forecast meteorological cause",
  "riskWindow": "Specific lookahead timeframe",
  "expectedPattern": "Expected rain and humidity pattern",
  "dryingOutlook": "GOOD | SLOW | POOR | UNSAFE, with quantitative reason",
  "laundryImpact": "Concrete impact on exposed laundry",
  "evidence": ["3 to 5 key telemetry or PAGASA evidence statements"],
  "recommendedAction": "Immediate primary operational command",
  "automationCommand": "OPEN | CLOSE | KEEP_OPEN | KEEP_CLOSED | MONITOR",
  "reassessmentTrigger": "Exact sensor or probability threshold for re-evaluation"
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
      console.log(`[GEMINI API SUCCESS] 🤖 Location: ${parsed.locationContext || locName} | Risk: ${parsed.aiRiskLevel}`);
      return {
        ...parsed,
        locationContext: parsed.locationContext || `${locName} (${Number(lat).toFixed(2)}°N, ${Number(lon).toFixed(2)}°E)`,
        confidencePercent: Math.max(0, Math.min(100, Number(parsed.confidencePercent) || 0)),
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 5) : [],
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
    const temp = weatherData.temperature || 28;
    const isRaining = weatherData.isRaining || false;
    const rainSensor = deviceState.rainSensor || false;
    const pagasa = pagasaService.getIntelligence();
    const position = deviceState.clotheslinePosition || 'open';
    const locName = weatherData.locationName || deviceState.location?.name || 'Manila, Philippines';
    const lat = weatherData.latitude || deviceState.location?.latitude || 14.5995;
    const lon = weatherData.longitude || deviceState.location?.longitude || 120.9842;
    const lookaheadHours = deviceState.settings?.lookaheadHours || 3;
    const threshold = deviceState.settings?.rainThreshold || 10;

    const locationContext = `${locName} (${Number(lat).toFixed(2)}°N, ${Number(lon).toFixed(2)}°E)`;

    let riskLevel = 'LOW';
    let recommendation = 'SAFE_OUTSIDE';
    let cause = pagasa.systemName !== 'None' ? pagasa.systemName : 'Stable Atmospheric Conditions';
    let pattern = 'Favorable dry weather with adequate ambient sunlight.';
    let impact = 'Optimal laundry drying conditions without moisture risk.';
    let action = 'KEEP_OPEN';

    if (isRaining || rainSensor || rainProb >= 70 || lookaheadProb >= 70 || pagasa.riskLevel === 'CRITICAL') {
      riskLevel = 'CRITICAL';
      recommendation = position === 'closed' ? 'KEEP_RETRACTED' : 'RETRACT_IMMEDIATELY';
      cause = isRaining || rainSensor
        ? 'Active Rainfall & Moisture Sensor Triggered'
        : (pagasa.systemName !== 'None' ? pagasa.systemName : 'Severe Rain Forecast');
      pattern = 'Imminent rain showers and high atmospheric humidity.';
      impact = 'High risk of outdoor laundry getting soaked and damaged.';
      action = 'Retract clothesline under roof cover immediately.';
    } else if (rainProb >= 40 || lookaheadProb >= 40 || pagasa.riskLevel === 'HIGH') {
      riskLevel = 'HIGH';
      recommendation = position === 'closed' ? 'KEEP_RETRACTED' : 'RETRACT_SOON';
      cause = pagasa.primarySystem !== 'NONE' ? pagasa.systemName : 'Elevated Rain Probability';
      pattern = 'Intermittent rain showers expected within lookahead timeframe.';
      impact = 'Slow drying and high risk of sudden rainfall on exposed clothes.';
      action = 'Retract clothesline or remain on high alert.';
    } else if (rainProb >= threshold || lookaheadProb >= threshold || humidity > 85 || pagasa.riskLevel === 'MODERATE') {
      riskLevel = 'MODERATE';
      recommendation = 'MONITOR';
      cause = humidity > 85 ? 'High Ambient Humidity' : 'Moderate Rain Threshold Exceeded';
      pattern = 'Partly cloudy conditions with elevated moisture levels.';
      impact = 'Reduced evaporation speed; drying may take longer than usual.';
      action = 'Keep clothesline open but monitor weather closely.';
    } else {
      riskLevel = 'LOW';
      recommendation = position === 'closed' ? 'SAFE_TO_REOPEN' : 'SAFE_OUTSIDE';
      cause = 'Clear Sky & Low Rain Probability';
      pattern = 'Persistent dry conditions expected across the forecast window.';
      impact = 'Fast and thorough outdoor drying for all fabric types.';
      action = 'Laundry can remain outside safely.';
    }

    const confidencePercent = isRaining || rainSensor
      ? 98
      : Math.min(95, 65 + Math.round(Math.abs(lookaheadProb - 50) / 2));

    // Multi-Paragraph Detailed Synthesis
    const overviewParagraph = `Current atmospheric telemetry for ${locName} (${Number(lat).toFixed(2)}°N, ${Number(lon).toFixed(2)}°E) indicates an ambient temperature of ${temp}°C and relative humidity of ${humidity}%. The immediate rain probability stands at ${rainProb}%, while the peak rain likelihood across the next ${lookaheadHours} hours reaches ${lookaheadProb}%. PAGASA monitoring reports ${pagasa.systemName} (${pagasa.riskLevel} risk level) with current status classified as "${pagasa.status}".`;

    const hazardBreakdownParagraph = `Analyzing micro-climate conditions in the vicinity of ${locName}, local rain risk is evaluated at ${riskLevel} level. The primary driver is ${cause}, presenting a pattern of ${pattern}. With a configured automated rain threshold of ${threshold}%, the lookahead peak of ${lookaheadProb}% represents a ${lookaheadProb >= threshold ? 'critical trigger exceeding' : 'safe margin below'} safety parameters, while physical sensors currently report ${rainSensor ? 'WET precipitation' : 'DRY hardware state'}.`;

    const dryingOutlookParagraph = `From a fabric protection standpoint, atmospheric moisture conditions currently offer a ${riskLevel === 'LOW' ? 'HIGHLY FAVORABLE' : riskLevel === 'MODERATE' ? 'MODERATE' : 'POOR / RISKY'} outdoor drying environment. ${impact} Heavy cottons and linens will experience ${humidity > 80 ? 'prolonged drying cycles due to high air moisture saturation' : 'rapid moisture evaporation under current sun and wind exposure'}. Keeping clothes outside during sudden precipitation could result in re-washing requirements.`;

    const actionPlanParagraph = `Based on comprehensive risk synthesis, the recommended operational command is ${recommendation.replace('_', ' ')}. The motorized clothesline mechanism should ${action === 'KEEP_OPEN' ? 'remain fully extended outside' : 'retract under protective shelter immediately'}. Automated safety overrides remain active, and system state will automatically re-evaluate upon any physical rain sensor pulse, PAGASA bulletin update, or rain probability shift beyond ${threshold}%.`;

    const evidence = [
      `User Location: ${locName} (${Number(lat).toFixed(2)}°N, ${Number(lon).toFixed(2)}°E)`,
      `Immediate Rain Risk: ${rainProb}% | Peak ${lookaheadHours}h Risk: ${lookaheadProb}%`,
      `Temperature: ${temp}°C | Relative Humidity: ${humidity}%`,
      `PAGASA Alert: ${pagasa.systemName} (${pagasa.riskLevel})`,
      `Rain Sensor: ${rainSensor ? 'TRIGGERED (WET)' : 'DRY'}`,
    ];

    return {
      aiRiskLevel: riskLevel,
      confidencePercent,
      laundryRecommendation: recommendation,
      locationContext,
      overviewParagraph,
      hazardBreakdownParagraph,
      dryingOutlookParagraph,
      actionPlanParagraph,
      analysisSummary: `${cause} at ${locName}. Rain probability is ${rainProb}% now (peaking at ${lookaheadProb}% in ${lookaheadHours}h). Action: ${action}.`,
      weatherCause: cause,
      riskWindow: `Next ${lookaheadHours} Hours`,
      expectedPattern: pattern,
      dryingOutlook: riskLevel === 'LOW'
        ? `GOOD - ${humidity}% humidity at ${locName}`
        : riskLevel === 'MODERATE'
          ? `SLOW - ${humidity}% humidity and ${lookaheadProb}% peak rain risk`
          : `UNSAFE - ${lookaheadProb}% peak rain risk`,
      laundryImpact: impact,
      evidence,
      recommendedAction: action,
      automationCommand: recommendation === 'SAFE_OUTSIDE' || recommendation === 'SAFE_TO_REOPEN'
        ? 'KEEP_OPEN'
        : recommendation === 'MONITOR' ? 'MONITOR' : 'CLOSE',
      reassessmentTrigger: 'Reassess when rain probability, local rain sensor, or location changes.',
      source: 'Deterministic Heuristic Engine (Multi-Paragraph)',
      evaluatedAt: new Date().toISOString(),
    };
  }
}

module.exports = new AiAnalysisService();
