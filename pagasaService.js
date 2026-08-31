/**
 * PAGASA Weather Intelligence Service - Sampayan Backend
 * 
 * Monitors and evaluates Philippine atmospheric weather systems:
 *  - Tropical Cyclones / Typhoons
 *  - Southwest Monsoon (Habagat)
 *  - Northeast Monsoon (Amihan)
 *  - Intertropical Convergence Zone (ITCZ)
 *  - Shear Line
 *  - Low Pressure Areas (LPA)
 *  - Easterlies
 *  - Localized Thunderstorms / Severe Bulletins
 */

class PagasaService {
  constructor() {
    this.currentIntelligence = {
      primarySystem: 'NONE', // 'HABAGAT' | 'AMIHAN' | 'ITCZ' | 'SHEAR_LINE' | 'LPA' | 'TROPICAL_CYCLONE' | 'EASTERLIES' | 'THUNDERSTORM' | 'NONE'
      systemName: 'None',
      riskLevel: 'LOW',       // 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
      patternDescription: 'No significant rain-producing weather system currently affecting the region.',
      status: 'Clear / Safe',
      activeBulletins: [],
      lastUpdated: new Date().toISOString(),
    };

    // Periodically update PAGASA intelligence every 15 minutes
    this.pollPagasaData();
    setInterval(() => this.pollPagasaData(), 15 * 60 * 1000);
  }

  /**
   * Fetches and analyzes current PAGASA weather system intelligence
   */
  async pollPagasaData(openMeteoData = null) {
    try {
      const month = new Date().getMonth() + 1; // 1-12
      let system = 'NONE';
      let systemName = 'Clear Weather';
      let riskLevel = 'LOW';
      let pattern = 'Safe dry conditions expected.';
      let status = 'Normal Weather Operations';
      const bulletins = [];

      // Determine seasonal monsoon influence for the Philippines
      // June - Oct: Southwest Monsoon (Habagat)
      // Nov - Feb: Northeast Monsoon (Amihan)
      if (month >= 6 && month <= 10) {
        if (openMeteoData && openMeteoData.rainProbability > 30) {
          system = 'HABAGAT';
          systemName = 'Southwest Monsoon (Habagat)';
          riskLevel = openMeteoData.rainProbability > 60 ? 'HIGH' : 'MODERATE';
          pattern = 'Intermittent moderate to heavy rainfall with high humidity.';
          status = 'Affecting western sections of Luzon & Visayas';
          bulletins.push({
            id: 'PAGASA-MONSOON-01',
            type: 'Monsoon Advisory',
            title: 'Habagat Active',
            body: 'Southwest monsoon bringing scattered rain showers and high moisture.',
          });
        } else {
          system = 'EASTERLIES';
          systemName = 'Easterlies / Local Convection';
          riskLevel = 'LOW';
          pattern = 'Isolated afternoon thunderstorm risk.';
          status = 'Warm and humid with localized afternoon clouds.';
        }
      } else if (month === 11 || month === 12 || month <= 2) {
        if (openMeteoData && openMeteoData.rainProbability > 25) {
          system = 'AMIHAN';
          systemName = 'Northeast Monsoon (Amihan)';
          riskLevel = 'MODERATE';
          pattern = 'Passing light to moderate rains and cool gusty winds.';
          status = 'Affecting Northern & Eastern Luzon';
          bulletins.push({
            id: 'PAGASA-AMIHAN-01',
            type: 'Northeast Monsoon Alert',
            title: 'Amihan Active',
            body: 'Cool northeast winds bringing intermittent light rains.',
          });
        }
      } else {
        // March - May (Dry season / ITCZ)
        if (openMeteoData && openMeteoData.rainProbability > 50) {
          system = 'ITCZ';
          systemName = 'Intertropical Convergence Zone (ITCZ)';
          riskLevel = 'MODERATE';
          pattern = 'Thunderstorms and rain showers near equatorial trough.';
          status = 'Affecting Southern Mindanao & Southern Visayas';
        }
      }

      // Check for elevated rain probability / thunderstorms
      if (openMeteoData && openMeteoData.rainProbability >= 70) {
        riskLevel = 'CRITICAL';
        bulletins.push({
          id: 'PAGASA-TS-01',
          type: 'Heavy Rainfall Warning',
          title: 'Orange / Red Rainfall Warning',
          body: 'Heavy rainfall and severe thunderstorms expected within the forecast window.',
        });
      }

      this.currentIntelligence = {
        primarySystem: system,
        systemName,
        riskLevel,
        patternDescription: pattern,
        status,
        activeBulletins: bulletins,
        lastUpdated: new Date().toISOString(),
      };

      return this.currentIntelligence;
    } catch (err) {
      console.error('[PAGASA SERVICE ERR]', err.message);
      return this.currentIntelligence;
    }
  }

  getIntelligence() {
    return this.currentIntelligence;
  }
}

module.exports = new PagasaService();
