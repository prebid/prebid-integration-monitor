/**
 * Identity Usage Detection Module
 * Focuses on actual identity data usage rather than just installed modules
 */

export interface IdentityUsage {
  correlatedStorage: {
    byOwner: Record<string, {
      count: number;
      items: Array<{
        name: string;
        storageType: 'cookie' | 'localStorage' | 'sessionStorage';
      }>;
      category: 'identity' | 'analytics' | 'advertising' | 'consent' | 'functional';
      purpose: string;
      privacy: 'first-party' | 'third-party';
    }>;
    unidentified: Array<{
      name: string;
      storageType: 'cookie' | 'localStorage' | 'sessionStorage';
    }>;
    unidentifiedAnalysis?: {
      patterns: {
        prefixes: Record<string, string[]>;
        suffixes: Record<string, string[]>;
        keywords: Record<string, string[]>;
      };
      suggestions: Array<{
        items: string[];
        possibleOwner: string;
        reasoning: string;
        confidence: 'high' | 'medium' | 'low';
      }>;
      statistics: {
        total: number;
        byStorageType: Record<string, number>;
        commonPatterns: Array<{
          pattern: string;
          count: number;
          examples: string[];
        }>;
      };
    };
  };
  identityProviders: {
    active: Array<{
      name: string;
      storageItems: string[];
      orphaned: boolean;
    }>;
    inactive: Array<{
      module: string;
      confidence: 'high' | 'medium' | 'low';
      reason?: string;
    }>;
  };
  summary: {
    storage: {
      total: number;
      identified: number;
      unidentified: number;
      byCategory: Record<string, number>;
      firstParty: number;
      thirdParty: number;
    };
    identity: {
      activeProviders: number;
      inactiveModules: number;
      orphanedData: number;
      highConfidenceInactive: number;
      mediumConfidenceInactive: number;
      lowConfidenceInactive: number;
    };
  };
}

// Known identity storage patterns
const IDENTITY_STORAGE_PATTERNS: Record<string, {
  provider: string;
  patterns: {
    cookies?: RegExp[];
    localStorage?: RegExp[];
    sessionStorage?: RegExp[];
  };
}> = {
  uid2: {
    provider: 'UID2',
    patterns: {
      cookies: [/^__uid2_advertising_token$/],
      localStorage: [/^UID2-sdk-identity$/]
    }
  },
  id5: {
    provider: 'ID5 Universal ID',
    patterns: {
      cookies: [/^id5id$/],
      localStorage: [/^id5id$/, /^id5id_last$/]
    }
  },
  criteo: {
    provider: 'Criteo ID',
    patterns: {
      cookies: [/^cto_bundle$/, /^cto_bidid$/],
      localStorage: [/^cto_bundle$/]
    }
  },
  intentiq: {
    provider: 'IntentIQ ID',
    patterns: {
      cookies: [/^_li_duid$/],
      localStorage: [/^_li_duid$/, /^intentIQ_uuid$/]
    }
  },
  liveintent: {
    provider: 'LiveIntent Identity',
    patterns: {
      cookies: [/^_li_pbid$/, /^_lc2_fpi$/],
      localStorage: [/^_li_pbid$/, /^_lc2_fpi$/]
    }
  },
  lotame: {
    provider: 'Lotame Panorama ID',
    patterns: {
      cookies: [/^_cc_id$/, /^panoramaId$/],
      localStorage: [/^panoramaId$/]
    }
  },
  pubcommon: {
    provider: 'PubCommon ID',
    patterns: {
      cookies: [/^_pubcid$/, /^pubcid$/],
      localStorage: [/^_pubcid$/, /^_pubcid_cst$/, /^_pubcid_exp$/]
    }
  },
  sharedid: {
    provider: 'SharedID',
    patterns: {
      cookies: [/^sharedid$/, /^_sharedID$/],
      localStorage: [/^sharedid$/, /^_sharedID$/]
    }
  },
  identitylink: {
    provider: 'IdentityLink',
    patterns: {
      cookies: [/^idl_env$/],
      localStorage: [/^idl_env$/]
    }
  },
  fabrick: {
    provider: 'Neustar Fabrick ID',
    patterns: {
      cookies: [/^fabrickId$/],
      localStorage: [/^fabrickId$/]
    }
  },
  unifiedid: {
    provider: 'Unified ID',
    patterns: {
      cookies: [/^__uid$/, /^unifiedId$/],
      localStorage: [/^unifiedId$/]
    }
  },
  parrableid: {
    provider: 'Parrable ID',
    patterns: {
      cookies: [/^_parrable_id$/],
      localStorage: [/^_parrable_id$/]
    }
  },
  permutive: {
    provider: 'Permutive',
    patterns: {
      localStorage: [/^permutive-id$/, /^_pdfps$/]
    }
  },
  merkle: {
    provider: 'Merkle ID',
    patterns: {
      cookies: [/^merkleId$/],
      localStorage: [/^merkleId$/]
    }
  },
  pairid: {
    provider: 'PAIR ID',
    patterns: {
      localStorage: [/^pairId$/]
    }
  },
  zeotap: {
    provider: 'Zeotap ID+',
    patterns: {
      cookies: [/^IDP$/],
      localStorage: [/^zeotapIdPlus$/]
    }
  },
  admixerid: {
    provider: 'AdmixerID',
    patterns: {
      cookies: [/^admixerId$/],
      localStorage: [/^admixerId$/]
    }
  },
  britepoolid: {
    provider: 'BritePool ID',
    patterns: {
      cookies: [/^britepoolid$/],
      localStorage: [/^britepoolid$/]
    }
  },
  deepintentid: {
    provider: 'DeepIntent ID',
    patterns: {
      cookies: [/^_dpes_id$/],
      localStorage: [/^_dpes_id$/]
    }
  },
  quantcastid: {
    provider: 'Quantcast ID',
    patterns: {
      cookies: [/^__qca$/],
      localStorage: [/^_qca$/]
    }
  },
  tapadid: {
    provider: 'Tapad ID',
    patterns: {
      cookies: [/^tapad_id$/],
      localStorage: [/^tapad_id$/]
    }
  },
  hadronid: {
    provider: 'Hadron ID',
    patterns: {
      cookies: [/^hID$/, /^hadronId$/],
      localStorage: [/^hadronId$/]
    }
  },
  amxid: {
    provider: 'AMX RTB ID',
    patterns: {
      cookies: [/^__amxId$/],
      localStorage: [/^__amxId$/]
    }
  },
  connectid: {
    provider: 'Yahoo ConnectID',
    patterns: {
      cookies: [/^connectId$/],
      localStorage: [/^connectId$/]
    }
  },
  conversantid: {
    provider: 'Conversant ID',
    patterns: {
      cookies: [/^conversantId$/],
      localStorage: [/^conversantId$/]
    }
  },
  dacid: {
    provider: 'DAC ID',
    patterns: {
      cookies: [/^dacId$/],
      localStorage: [/^dacId$/]
    }
  },
  dmdid: {
    provider: 'DMD ID',
    patterns: {
      cookies: [/^dmdId$/],
      localStorage: [/^dmdId$/]
    }
  },
  naveggid: {
    provider: 'Navegg ID',
    patterns: {
      cookies: [/^nvggid$/],
      localStorage: [/^nvggid$/]
    }
  },
  novatiqid: {
    provider: 'Novatiq ID',
    patterns: {
      cookies: [/^novatiq$/],
      localStorage: [/^novatiq$/]
    }
  },
  akamaidad: {
    provider: 'Akamai DAP',
    patterns: {
      cookies: [/^akamai_dap$/],
      localStorage: [/^akamai_dap$/]
    }
  },
  imuid: {
    provider: 'IM-UID',
    patterns: {
      cookies: [/^im-uid$/],
      localStorage: [/^im-uid$/]
    }
  },
  kinessoId: {
    provider: 'Kinesso ID',
    patterns: {
      cookies: [/^kpid$/],
      localStorage: [/^kpid$/]
    }
  },
  mwOpenLinkId: {
    provider: 'MediaWallah OpenLink ID',
    patterns: {
      cookies: [/^mwol$/],
      localStorage: [/^mwol$/]
    }
  }
};

export function createIdentityUsageDetectionScript(): string {
  return `
    (function() {
      try {
        const result = {
          correlatedStorage: {
            byOwner: {},
            unidentified: []
          },
          identityProviders: {
            active: [],
            inactive: []
          },
          summary: {
            storage: {
              total: 0,
              identified: 0,
              unidentified: 0,
              byCategory: {},
              firstParty: 0,
              thirdParty: 0
            },
            identity: {
              activeProviders: 0,
              inactiveModules: 0,
              orphanedData: 0,
              highConfidenceInactive: 0,
              mediumConfidenceInactive: 0,
              lowConfidenceInactive: 0
            }
          }
        };

        // Helper to match patterns
        function matchesPattern(str, patterns) {
          if (!patterns || !Array.isArray(patterns)) return false;
          return patterns.some(pattern => {
            if (typeof pattern === 'string') {
              return str === pattern;
            } else if (pattern instanceof RegExp) {
              return pattern.test(str);
            }
            // Handle serialized RegExp
            const regexMatch = pattern.toString().match(/^\\/(.+)\\/([gimuy]*)$/);
            if (regexMatch) {
              const regex = new RegExp(regexMatch[1], regexMatch[2]);
              return regex.test(str);
            }
            return false;
          });
        }

        // Comprehensive storage correlation patterns
        const CORRELATION_PATTERNS = [
          // Google Ecosystem
          { pattern: /^__gads$/, owner: 'Google Ads', category: 'advertising', purpose: 'Ad targeting', privacy: 'third-party' },
          { pattern: /^__gpi$/, owner: 'Google Publisher Tag', category: 'advertising', purpose: 'Publisher ads', privacy: 'third-party' },
          { pattern: /^__eoi$/, owner: 'Google', category: 'advertising', purpose: 'Interest-based ads', privacy: 'third-party' },
          { pattern: /^_ga$|^_ga_/, owner: 'Google Analytics', category: 'analytics', purpose: 'Analytics', privacy: 'first-party' },
          { pattern: /^_gcl_/, owner: 'Google Ads', category: 'advertising', purpose: 'Conversion tracking', privacy: 'first-party' },
          { pattern: /^goog:/, owner: 'Google', category: 'advertising', purpose: 'Various services', privacy: 'third-party' },
          
          // Identity Providers
          { pattern: /^_sharedID$|^sharedid/, owner: 'SharedID', category: 'identity', purpose: 'User ID', privacy: 'first-party' },
          { pattern: /^_pubcid/, owner: 'PubCommon ID', category: 'identity', purpose: 'Publisher ID', privacy: 'first-party' },
          { pattern: /^id5/, owner: 'ID5', category: 'identity', purpose: 'Universal ID', privacy: 'third-party' },
          { pattern: /^cto_/, owner: 'Criteo', category: 'advertising', purpose: 'Retargeting', privacy: 'third-party' },
          { pattern: /^33across/, owner: '33Across', category: 'identity', purpose: 'Addressability', privacy: 'third-party' },
          { pattern: /^__uid/, owner: 'UID2', category: 'identity', purpose: 'Unified ID', privacy: 'third-party' },
          { pattern: /^panoramaId/, owner: 'Lotame', category: 'identity', purpose: 'Identity graph', privacy: 'third-party' },
          { pattern: /^_li_duid$|^_li_pbid$/, owner: 'LiveIntent', category: 'identity', purpose: 'Email identity', privacy: 'third-party' },
          { pattern: /^idl_env$/, owner: 'IdentityLink', category: 'identity', purpose: 'Identity', privacy: 'third-party' },
          { pattern: /^intentIQ/, owner: 'IntentIQ', category: 'identity', purpose: 'Identity', privacy: 'third-party' },
          
          // Facebook/Meta
          { pattern: /^_fbp$/, owner: 'Facebook', category: 'advertising', purpose: 'Ad targeting', privacy: 'third-party' },
          { pattern: /^_fbc$/, owner: 'Facebook', category: 'advertising', purpose: 'Click ID', privacy: 'third-party' },
          
          // Amazon
          { pattern: /^aps/, owner: 'Amazon APS', category: 'advertising', purpose: 'Header bidding', privacy: 'third-party' },
          
          // Consent
          { pattern: /^usprivacy$|^us_privacy$/, owner: 'IAB CCPA', category: 'consent', purpose: 'CCPA consent', privacy: 'first-party' },
          { pattern: /^euconsent/, owner: 'IAB TCF', category: 'consent', purpose: 'GDPR consent', privacy: 'first-party' },
          { pattern: /^_ketch_/, owner: 'Ketch', category: 'consent', purpose: 'Consent mgmt', privacy: 'first-party' },
          { pattern: /^notice_gdpr/, owner: 'OneTrust', category: 'consent', purpose: 'GDPR prefs', privacy: 'first-party' },
          
          // Analytics
          { pattern: /^__qca$/, owner: 'Quantcast', category: 'analytics', purpose: 'Measurement', privacy: 'third-party' },
          { pattern: /^lux_uid$/, owner: 'SpeedCurve', category: 'analytics', purpose: 'RUM', privacy: 'first-party' },
          { pattern: /^optimizely/, owner: 'Optimizely', category: 'functional', purpose: 'A/B testing', privacy: 'first-party' },
          
          // Ad Tech
          { pattern: /^rtbhouse/, owner: 'RTBHouse', category: 'advertising', purpose: 'Retargeting', privacy: 'third-party' },
          { pattern: /^_cc_/, owner: 'Lotame', category: 'advertising', purpose: 'DMP', privacy: 'third-party' },
          { pattern: /^permutive/, owner: 'Permutive', category: 'advertising', purpose: 'Publisher DMP', privacy: 'first-party' },
          { pattern: /^_GESPSK/, owner: 'Google ESP', category: 'advertising', purpose: 'Enhanced conv', privacy: 'third-party' },
          
          // Site Functionality
          { pattern: /^datadome$/, owner: 'DataDome', category: 'functional', purpose: 'Bot detection', privacy: 'first-party' },
          { pattern: /^AWSALB/, owner: 'AWS', category: 'functional', purpose: 'Load balancing', privacy: 'first-party' },
          { pattern: /session/i, owner: 'Site', category: 'functional', purpose: 'Session', privacy: 'first-party' },
          { pattern: /^pushly/, owner: 'Pushly', category: 'functional', purpose: 'Push notif', privacy: 'first-party' },
          { pattern: /^_pn$|^pn_/, owner: 'Piano', category: 'functional', purpose: 'Subscriptions', privacy: 'first-party' },
          { pattern: /^_swb/, owner: 'ShareThis', category: 'advertising', purpose: 'Social sharing', privacy: 'third-party' }
        ];
        
        // Collect all storage items (names only)
        const allStorageItems = [];
        
        // Get cookies
        const cookies = document.cookie.split(';').map(c => c.trim()).filter(c => c);
        cookies.forEach(cookie => {
          const [name] = cookie.split('=');
          if (name) {
            allStorageItems.push({
              name: name.trim(),
              type: 'cookie'
            });
          }
        });

        // Get localStorage
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
              allStorageItems.push({
                name: key,
                type: 'localStorage'
              });
            }
          }
        } catch (e) {}

        // Get sessionStorage
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) {
              allStorageItems.push({
                name: key,
                type: 'sessionStorage'
              });
            }
          }
        } catch (e) {}
        
        // Correlate all storage items
        allStorageItems.forEach(item => {
          let identified = false;
          
          for (const pattern of CORRELATION_PATTERNS) {
            if (pattern.pattern.test(item.name)) {
              // Update byOwner with all info
              if (!result.correlatedStorage.byOwner[pattern.owner]) {
                result.correlatedStorage.byOwner[pattern.owner] = {
                  count: 0,
                  items: [],
                  category: pattern.category,
                  purpose: pattern.purpose,
                  privacy: pattern.privacy
                };
              }
              result.correlatedStorage.byOwner[pattern.owner].count++;
              result.correlatedStorage.byOwner[pattern.owner].items.push({
                name: item.name,
                storageType: item.type
              })
              
              // Update category counts
              result.summary.storage.byCategory[pattern.category] = 
                (result.summary.storage.byCategory[pattern.category] || 0) + 1;
              
              // Update privacy counts
              if (pattern.privacy === 'first-party') {
                result.summary.storage.firstParty++;
              } else {
                result.summary.storage.thirdParty++;
              }
              
              identified = true;
              break;
            }
          }
          
          if (!identified) {
            result.correlatedStorage.unidentified.push({
              name: item.name,
              storageType: item.type
            });
          }
        });

        // Check for active identity providers based on correlated storage
        const identityOwners = Object.entries(result.correlatedStorage.byOwner)
          .filter(([owner, data]) => data.category === 'identity');
        
        // Create active provider entries
        identityOwners.forEach(([owner, data]) => {
          const storageItems = data.items.map(item => item.name);
          result.identityProviders.active.push({
            name: owner,
            storageItems: storageItems,
            orphaned: false // Will be determined below
          });
        });

        // Get Prebid modules if available
        let installedIdentityModules = [];
        const prebidInstances = [];
        const globalVars = Object.keys(window);
        let pbjs = null;
        
        for (const key of globalVars) {
          if (key.includes('pbjs') || key === 'pbjs') {
            const obj = window[key];
            if (obj && typeof obj === 'object' && obj.installedModules) {
              prebidInstances.push(obj);
            }
          }
        }

        if (prebidInstances.length > 0) {
          pbjs = window.pbjs || prebidInstances[0];
          if (pbjs.installedModules && Array.isArray(pbjs.installedModules)) {
            installedIdentityModules = pbjs.installedModules.filter(m => 
              m.includes('IdSystem') || m.includes('UserId')
            );
          }
        }

        // Map module names to provider names
        const moduleToProvider = {
          'unifiedIdSystem': 'Unified ID',
          'pubCommonIdSystem': 'PubCommon ID',
          'criteoIdSystem': 'Criteo ID',
          'id5IdSystem': 'ID5 Universal ID',
          'parrableIdSystem': 'Parrable ID',
          'britepoolIdSystem': 'BritePool ID',
          'liveIntentIdSystem': 'LiveIntent Identity',
          'lotamePanoramaIdSystem': 'Lotame Panorama ID',
          'fabrickIdSystem': 'Neustar Fabrick ID',
          'deepintentIdSystem': 'DeepIntent ID',
          'quantcastIdSystem': 'Quantcast ID',
          'zeotapIdPlusSystem': 'Zeotap ID+',
          'hadronIdSystem': 'Hadron ID',
          'uid2IdSystem': 'UID2',
          'euid2IdSystem': 'EUID2',
          'admixerIdSystem': 'AdmixerID',
          'adtelligentIdSystem': 'Adtelligent ID',
          'amxIdSystem': 'AMX RTB ID',
          'kinessoIdSystem': 'Kinesso ID',
          'imIdSystem': 'IM-UID',
          'connectIdSystem': 'Yahoo ConnectID',
          'tapadIdSystem': 'Tapad ID',
          'novatiqIdSystem': 'Novatiq ID',
          'conversantIdSystem': 'Conversant ID',
          'naveggIdSystem': 'Navegg ID',
          'intentIqIdSystem': 'IntentIQ ID',
          'merkleIdSystem': 'Merkle ID',
          'pairIdSystem': 'PAIR ID',
          'sharedIdSystem': 'SharedID',
          'identityLinkIdSystem': 'IdentityLink',
          'dacIdSystem': 'DAC ID',
          'dmdIdSystem': 'DMD ID',
          'akamaiDapIdSystem': 'Akamai DAP',
          'mwOpenLinkIdSystem': 'MediaWallah OpenLink ID'
        };

        // Find inactive modules with confidence scoring
        const activeProviderNames = result.identityProviders.active.map(p => p.name);
        
        // Get Prebid config for additional context
        let config = {};
        let userSyncEnabled = true;
        let syncDelay = 3000;
        let consentBlocked = false;
        
        if (pbjs && pbjs.getConfig) {
          config = pbjs.getConfig();
          userSyncEnabled = config.userSync?.syncEnabled !== false;
          syncDelay = config.userSync?.syncDelay || 3000;
          
          // Check for consent blocking
          if (window.__tcfapi) {
            try {
              window.__tcfapi('getTCData', 2, (tcData) => {
                if (tcData && tcData.gdprApplies && !tcData.purpose?.consents?.[1]) {
                  consentBlocked = true;
                }
              });
            } catch {}
          }
        }
        
        // Check time on page and bot detection
        const timeOnPage = performance.now();
        const syncDelayPassed = timeOnPage > syncDelay + 2000;
        const botSignals = [
          navigator.webdriver === true,
          navigator.plugins?.length === 0,
          navigator.languages?.length === 0
        ];
        const possibleBot = botSignals.filter(s => s).length >= 2;
        
        installedIdentityModules.forEach(module => {
          const providerName = moduleToProvider[module];
          if (providerName && !activeProviderNames.includes(providerName)) {
            const inactiveModule = {
              module: module,
              confidence: 'low',
              reason: 'Unknown'
            };
            
            // Check if module is configured
            const userIds = config.userSync?.userIds || [];
            const moduleBaseName = module.replace('IdSystem', '');
            const isConfigured = userIds.some(uid => 
              uid.name?.toLowerCase() === moduleBaseName.toLowerCase()
            );
            
            // Assign confidence based on factors
            if (!isConfigured) {
              inactiveModule.confidence = 'high';
              inactiveModule.reason = 'Not configured in userSync.userIds';
            } else if (consentBlocked) {
              inactiveModule.confidence = 'high';
              inactiveModule.reason = 'Blocked by consent management';
            } else if (!userSyncEnabled) {
              inactiveModule.confidence = 'high';
              inactiveModule.reason = 'User sync disabled';
            } else if (possibleBot) {
              inactiveModule.confidence = 'low';
              inactiveModule.reason = 'Bot detection may be preventing sync';
            } else if (!syncDelayPassed) {
              inactiveModule.confidence = 'low';
              inactiveModule.reason = 'Sync delay not yet passed';
            } else if (syncDelayPassed && timeOnPage > 10000) {
              inactiveModule.confidence = 'medium';
              inactiveModule.reason = 'No data after reasonable wait time';
            } else {
              inactiveModule.confidence = 'low';
              inactiveModule.reason = 'May require multiple page views or specific conditions';
            }
            
            result.identityProviders.inactive.push(inactiveModule);
          }
        });

        // Find orphaned data (data but no module)
        const installedProviderNames = installedIdentityModules.map(m => moduleToProvider[m]).filter(Boolean);
        result.identityProviders.active.forEach(provider => {
          if (!installedProviderNames.includes(provider.name)) {
            provider.orphaned = true;
          }
        });

        // Calculate storage summary
        result.summary.storage.total = allStorageItems.length;
        const identifiedCount = Object.values(result.correlatedStorage.byOwner)
          .reduce((sum, owner) => sum + owner.count, 0);
        result.summary.storage.identified = identifiedCount;
        result.summary.storage.unidentified = result.correlatedStorage.unidentified.length;
        
        // Calculate identity summary
        result.summary.identity.activeProviders = result.identityProviders.active.length;
        result.summary.identity.inactiveModules = result.identityProviders.inactive.length;
        result.summary.identity.orphanedData = result.identityProviders.active.filter(p => p.orphaned).length;
        result.summary.identity.highConfidenceInactive = result.identityProviders.inactive.filter(m => m.confidence === 'high').length;
        result.summary.identity.mediumConfidenceInactive = result.identityProviders.inactive.filter(m => m.confidence === 'medium').length;
        result.summary.identity.lowConfidenceInactive = result.identityProviders.inactive.filter(m => m.confidence === 'low').length;

        return result;
      } catch (error) {
        return {
          error: error.message,
          stack: error.stack
        };
      }
    })();
  `;
}