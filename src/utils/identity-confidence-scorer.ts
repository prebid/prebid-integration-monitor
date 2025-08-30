/**
 * Identity Confidence Scorer Module
 * Assigns confidence levels to inactive module detection based on multiple factors
 */

export interface ModuleConfidenceScore {
  module: string;
  status: 'active' | 'inactive' | 'likely_inactive' | 'possibly_inactive' | 'uncertain';
  confidence: number; // 0-100
  factors: {
    hasStorageData: boolean;
    isConfigured: boolean;
    consentBlocked: boolean;
    geoBlocked: boolean;
    botDetected: boolean;
    syncDelayPassed: boolean;
    multiplePageViews: boolean;
    timeOnPage: number;
  };
  reasoning: string[];
}

export function createConfidenceScoringScript(): string {
  return `
    (function() {
      try {
        const scoreModules = () => {
          const scores = [];
          const pbjs = window.pbjs || window[Object.keys(window).find(k => k.includes('pbjs'))];
          
          if (!pbjs || !pbjs.installedModules) return scores;
          
          // Get identity modules
          const identityModules = pbjs.installedModules.filter(m => 
            m.includes('IdSystem') || m.includes('UserId')
          );
          
          // Check various factors
          const config = pbjs.getConfig ? pbjs.getConfig() : {};
          const userSyncConfig = config.userSync || {};
          const consentConfig = config.consentManagement || {};
          
          // Detect bot signals
          const botSignals = [
            navigator.webdriver === true,
            navigator.plugins?.length === 0,
            !window.chrome && navigator.vendor === 'Google Inc.',
            navigator.languages?.length === 0,
            window.outerWidth === 0 && window.outerHeight === 0
          ];
          const botDetected = botSignals.filter(s => s).length >= 2;
          
          // Check consent status
          let consentGranted = true;
          let gdprApplies = false;
          
          if (window.__tcfapi) {
            try {
              window.__tcfapi('getTCData', 2, (tcData) => {
                if (tcData) {
                  gdprApplies = tcData.gdprApplies;
                  consentGranted = tcData.gdprApplies === false || 
                                   (tcData.purpose?.consents?.[1] === true); // Purpose 1 is storage
                }
              });
            } catch {}
          }
          
          // Time factors
          const timeOnPage = performance.now();
          const syncDelay = userSyncConfig.syncDelay || 3000;
          const syncDelayPassed = timeOnPage > syncDelay + 2000; // Add buffer
          
          // Storage patterns for each identity provider
          const storagePatterns = {
            'sharedIdSystem': ['_pubcid', 'sharedid'],
            'pubCommonIdSystem': ['_pubcid', 'pubcid'],
            'criteoIdSystem': ['cto_bundle', 'cto_bidid'],
            'id5IdSystem': ['id5id', 'id5id_last'],
            'intentIqIdSystem': ['_li_duid', 'intentIQ_uuid'],
            'liveIntentIdSystem': ['_li_pbid', '_lc2_fpi'],
            'lotamePanoramaIdSystem': ['panoramaId', '_cc_id'],
            'identityLinkIdSystem': ['idl_env'],
            'fabrickIdSystem': ['fabrickId'],
            'unifiedIdSystem': ['__uid', 'unifiedId'],
            'uid2IdSystem': ['__uid2_advertising_token', 'UID2-sdk-identity'],
            'parrableIdSystem': ['_parrable_id'],
            'merkleIdSystem': ['merkleId'],
            'pairIdSystem': ['pairId'],
            'zeotapIdPlusSystem': ['IDP', 'zeotapIdPlus']
          };
          
          // Check each module
          identityModules.forEach(module => {
            const score = {
              module: module,
              status: 'uncertain',
              confidence: 0,
              factors: {
                hasStorageData: false,
                isConfigured: false,
                consentBlocked: false,
                geoBlocked: false,
                botDetected: botDetected,
                syncDelayPassed: syncDelayPassed,
                multiplePageViews: false,
                timeOnPage: timeOnPage
              },
              reasoning: []
            };
            
            // Check if configured
            const moduleBaseName = module.replace('IdSystem', '').replace('System', '');
            const userIds = userSyncConfig.userIds || config.userId?.userIds || [];
            score.factors.isConfigured = userIds.some(uid => 
              uid.name?.toLowerCase() === moduleBaseName.toLowerCase() ||
              uid.name?.toLowerCase() === module.toLowerCase()
            );
            
            // Check for storage data
            const patterns = storagePatterns[module] || [];
            const cookies = document.cookie.split(';').map(c => c.trim().split('=')[0]);
            const localStorageKeys = Object.keys(localStorage);
            
            score.factors.hasStorageData = patterns.some(pattern => 
              cookies.some(c => c.includes(pattern)) ||
              localStorageKeys.some(k => k.includes(pattern))
            );
            
            // Check for multiple page views (heuristic)
            score.factors.multiplePageViews = 
              cookies.includes('_pubcid_exp') || 
              localStorageKeys.includes('_pubcid_last') ||
              timeOnPage > 10000;
            
            // Check consent blocking
            score.factors.consentBlocked = gdprApplies && !consentGranted;
            
            // Calculate confidence score
            let confidenceScore = 50; // Start at neutral
            
            // High confidence factors
            if (score.factors.hasStorageData) {
              confidenceScore = 100;
              score.status = 'active';
              score.reasoning.push('Storage data found for this provider');
            } else if (!score.factors.isConfigured) {
              confidenceScore = 95;
              score.status = 'inactive';
              score.reasoning.push('Module installed but not configured in userSync.userIds');
            } else if (score.factors.consentBlocked) {
              confidenceScore = 85;
              score.status = 'inactive';
              score.reasoning.push('Consent management is blocking this module');
            } else if (score.factors.botDetected) {
              confidenceScore = 30;
              score.status = 'uncertain';
              score.reasoning.push('Bot detection may affect ID syncing');
            } else if (!score.factors.syncDelayPassed) {
              confidenceScore = 25;
              score.status = 'uncertain';
              score.reasoning.push('Insufficient time for sync delay');
            } else if (score.factors.syncDelayPassed && score.factors.multiplePageViews) {
              confidenceScore = 80;
              score.status = 'likely_inactive';
              score.reasoning.push('No data found after sufficient time and page views');
            } else if (score.factors.syncDelayPassed) {
              confidenceScore = 65;
              score.status = 'possibly_inactive';
              score.reasoning.push('No data found after sync delay period');
            } else {
              confidenceScore = 40;
              score.status = 'uncertain';
              score.reasoning.push('Unable to determine status with confidence');
            }
            
            // Adjust for specific modules
            if (module === 'sharedIdSystem' && !score.factors.hasStorageData && score.factors.syncDelayPassed) {
              // SharedID should always create a pubcid
              confidenceScore = Math.min(confidenceScore + 15, 95);
              score.reasoning.push('SharedID typically creates immediate storage');
            }
            
            if (module.includes('uid2') || module.includes('euid')) {
              // UID2/EUID requires publisher integration
              if (!score.factors.hasStorageData && !window.__uid2) {
                confidenceScore = Math.min(confidenceScore + 10, 90);
                score.reasoning.push('UID2/EUID requires specific publisher integration');
              }
            }
            
            score.confidence = confidenceScore;
            scores.push(score);
          });
          
          return scores;
        };
        
        const results = scoreModules();
        
        return {
          scores: results,
          summary: {
            total: results.length,
            highConfidence: results.filter(s => s.confidence >= 80).length,
            mediumConfidence: results.filter(s => s.confidence >= 50 && s.confidence < 80).length,
            lowConfidence: results.filter(s => s.confidence < 50).length,
            active: results.filter(s => s.status === 'active').length,
            inactive: results.filter(s => s.status === 'inactive').length,
            likelyInactive: results.filter(s => s.status === 'likely_inactive').length,
            possiblyInactive: results.filter(s => s.status === 'possibly_inactive').length,
            uncertain: results.filter(s => s.status === 'uncertain').length
          },
          recommendations: {
            highConfidenceInactive: results
              .filter(s => s.status === 'inactive' && s.confidence >= 80)
              .map(s => ({
                module: s.module,
                action: 'Can be safely removed from bundle',
                reason: s.reasoning[0]
              })),
            needsInvestigation: results
              .filter(s => s.confidence < 50)
              .map(s => ({
                module: s.module,
                action: 'Requires manual testing with real browser',
                reason: s.reasoning[0]
              }))
          }
        };
      } catch (error) {
        return {
          error: error.message,
          stack: error.stack
        };
      }
    })();
  `;
}