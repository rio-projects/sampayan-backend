/**
 * AI Weather Analysis Engine - Sampayan Backend
 * 
 * Synthesizes forecast parameters, PAGASA intelligence, and current hardware state
 * into structured human-readable laundry safety recommendations.
 */

const pagasaService = require('./pagasaService');

class AiAnalysisService {
  /**
   * Generates AI Weather & Laundry Safety Analysis
   */
  analyze(weatherData = {}, deviceState = {}) {
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
      evaluatedAt: new Date().toISOString(),
    };
  }
}

module.exports = new AiAnalysisService();
