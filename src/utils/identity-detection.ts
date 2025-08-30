/**
 * Comprehensive Identity Provider Detection Module
 * Detects and classifies identity solutions on web pages
 */

export interface IdentityProvider {
  name: string;
  detected: boolean;
  detectionMethods: DetectionMethod[];
  classification: IdentityClassification;
  metadata?: IdentityMetadata;
}

export interface DetectionMethod {
  type: 'window' | 'cookie' | 'localStorage' | 'prebidModule' | 'script' | 'pixel';
  confidence: 'high' | 'medium' | 'low';
  details?: string;
}

export interface IdentityClassification {
  partyType: '1st' | '3rd' | 'hybrid';
  idType: 'deterministic' | 'probabilistic' | 'both';
  scope: 'site' | 'cross-site' | 'global';
  technology: 'cookie' | 'localStorage' | 'server' | 'hybrid';
  openSource: boolean;
  requiresConsent: boolean;
  privacyCompliant: string[]; // ['GDPR', 'CCPA', 'TCF2.0', etc.]
}

export interface IdentityMetadata {
  version?: string;
  partnerId?: string;
  configPresent?: boolean;
  activeSync?: boolean;
  lastSeen?: string;
  additionalData?: Record<string, any>;
}

export interface IdentityDetectionResult {
  providers: IdentityProvider[];
  summary: {
    totalProviders: number;
    firstPartyCount: number;
    thirdPartyCount: number;
    deterministicCount: number;
    probabilisticCount: number;
    consentRequiredCount: number;
  };
  raw: {
    windowObjects: string[];
    cookies: string[];
    localStorage: string[];
    prebidModules: string[];
  };
}

// Identity provider definitions with comprehensive metadata
export const IDENTITY_PROVIDERS: Record<string, Omit<IdentityProvider, 'detected' | 'detectionMethods'>> = {
  'UID2.0': {
    name: 'Unified ID 2.0',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: true,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA', 'TCF2.0']
    }
  },
  'ID5': {
    name: 'ID5 Universal ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA', 'TCF2.0']
    }
  },
  'SharedID': {
    name: 'SharedID (formerly PubCommon)',
    classification: {
      partyType: '1st',
      idType: 'deterministic',
      scope: 'site',
      technology: 'cookie',
      openSource: true,
      requiresConsent: false,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'PubCommonID': {
    name: 'PubCommon ID',
    classification: {
      partyType: '1st',
      idType: 'deterministic',
      scope: 'site',
      technology: 'cookie',
      openSource: true,
      requiresConsent: false,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'LiveIntent': {
    name: 'LiveIntent Identity',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA', 'TCF2.0']
    }
  },
  'LotamePanorama': {
    name: 'Lotame Panorama ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'CriteoID': {
    name: 'Criteo ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'TCF2.0']
    }
  },
  'MerkleID': {
    name: 'Merkle ID',
    classification: {
      partyType: '3rd',
      idType: 'both',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'NeustarFabrick': {
    name: 'Neustar Fabrick ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'ZeotapID': {
    name: 'Zeotap ID+',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA', 'TCF2.0']
    }
  },
  'QuantcastID': {
    name: 'Quantcast ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA', 'TCF2.0']
    }
  },
  'UnifiedID': {
    name: 'The Trade Desk Unified ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'IntentIQ': {
    name: 'IntentIQ ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'HadronID': {
    name: 'Hadron ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'YahooConnectID': {
    name: 'Yahoo ConnectID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'TapadGraph': {
    name: 'Tapad Graph',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'IDx': {
    name: 'IDx',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'cross-site',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'BritePool': {
    name: 'BritePool ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'AMXRTB': {
    name: 'AMX RTB ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'cross-site',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'AdmixerID': {
    name: 'Admixer ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'cross-site',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'DMDID': {
    name: 'DMD ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'cross-site',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'KinessoID': {
    name: 'Kinesso ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'NovatiqHyperID': {
    name: 'Novatiq Hyper ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: false, // Uses network signals, not cookies
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'Parrable': {
    name: 'Parrable ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'global',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'AmazonAdvertisingID': {
    name: 'Amazon Advertising ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'OneKeyID': {
    name: 'OneKey ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'PairID': {
    name: 'PAIR ID',
    classification: {
      partyType: '1st',
      idType: 'deterministic',
      scope: 'site',
      technology: 'server',
      openSource: true,
      requiresConsent: false,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'TrustPid': {
    name: 'TrustPid',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'UTIQ': {
    name: 'UTIQ ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'VerizonMediaID': {
    name: 'Verizon Media ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR', 'CCPA']
    }
  },
  'NetID': {
    name: 'NetID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'global',
      technology: 'server',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'MwOpenLinkID': {
    name: 'mwOpenLink ID',
    classification: {
      partyType: '3rd',
      idType: 'probabilistic',
      scope: 'cross-site',
      technology: 'cookie',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  },
  'JustID': {
    name: 'Just ID',
    classification: {
      partyType: '3rd',
      idType: 'deterministic',
      scope: 'cross-site',
      technology: 'hybrid',
      openSource: false,
      requiresConsent: true,
      privacyCompliant: ['GDPR']
    }
  }
};

/**
 * Detection patterns for various identity providers
 */
export const DETECTION_PATTERNS = {
  window: {
    // UID 2.0
    '__uid2': 'UID2.0',
    '__uid2_advertising_token': 'UID2.0',
    'UID2': 'UID2.0',
    
    // ID5
    'ID5': 'ID5',
    'id5Instance': 'ID5',
    
    // LiveIntent
    '__liQ': 'LiveIntent',
    '_li': 'LiveIntent',
    'liQ': 'LiveIntent',
    
    // Lotame
    '__lotl': 'LotamePanorama',
    'lotamePanorama': 'LotamePanorama',
    'panoramaId': 'LotamePanorama',
    'lotame_synch': 'LotamePanorama',
    
    // Criteo
    'criteo_pubtag': 'CriteoID',
    'Criteo': 'CriteoID',
    'criteo_fast_bid': 'CriteoID',
    
    // Merkle
    'merkleId': 'MerkleID',
    'merkle': 'MerkleID',
    
    // Neustar/Fabrick
    'fabrickId': 'NeustarFabrick',
    'neustar': 'NeustarFabrick',
    
    // Zeotap
    'zeotapIdPlus': 'ZeotapID',
    'zeotap': 'ZeotapID',
    
    // Quantcast
    'quantcastId': 'QuantcastID',
    '__qca': 'QuantcastID',
    
    // SharedID/PubCommon
    'sharedId': 'SharedID',
    'pubcid': 'PubCommonID',
    'PublisherCommonId': 'PubCommonID',
    
    // UnifiedID
    'unifiedId': 'UnifiedID',
    '__uid': 'UnifiedID',
    
    // IntentIQ
    'intentIqId': 'IntentIQ',
    'intentIq': 'IntentIQ',
    '_intentIqId': 'IntentIQ',
    
    // Hadron
    'hadronId': 'HadronID',
    'hadron': 'HadronID',
    
    // Yahoo/ConnectID
    'connectId': 'YahooConnectID',
    'yahooConnectId': 'YahooConnectID',
    
    // Tapad
    'tapadId': 'TapadGraph',
    'TapAd_TS': 'TapadGraph',
    
    // IDx
    'idxId': 'IDx',
    'idx': 'IDx',
    
    // BritePool
    'britepoolId': 'BritePool',
    'britepool_id': 'BritePool',
    
    // AMX
    'amxId': 'AMXRTB',
    'amxrtb': 'AMXRTB',
    
    // Admixer
    'admixerId': 'AdmixerID',
    'admixer': 'AdmixerID',
    
    // DMD
    'dmdId': 'DMDID',
    'dmd': 'DMDID',
    
    // Kinesso
    'kpuid': 'KinessoID',
    'kinessoId': 'KinessoID',
    
    // Novatiq
    'novatiq': 'NovatiqHyperID',
    'novatiqId': 'NovatiqHyperID',
    
    // Parrable
    'parrable': 'Parrable',
    '_parrable_id': 'Parrable',
    
    // Amazon
    'amznid': 'AmazonAdvertisingID',
    'aps_id': 'AmazonAdvertisingID',
    
    // OneKey
    'oneKeyData': 'OneKeyID',
    'onekeyid': 'OneKeyID',
    
    // PAIR
    'pairId': 'PairID',
    'pair_id': 'PairID',
    
    // TrustPid
    'trustpid': 'TrustPid',
    'trustpidData': 'TrustPid',
    
    // UTIQ
    'utiq': 'UTIQ',
    'utiqId': 'UTIQ',
    
    // Verizon
    'verizonMediaId': 'VerizonMediaID',
    'vidm': 'VerizonMediaID',
    
    // NetID
    'netId': 'NetID',
    'netIdData': 'NetID',
    
    // mwOpenLink
    'mwOpenLinkId': 'MwOpenLinkID',
    'mwol': 'MwOpenLinkID',
    
    // JustID
    'justId': 'JustID',
    'just_id': 'JustID'
  },
  
  cookies: {
    // UID 2.0
    'uid2_advertising_token': 'UID2.0',
    '__uid2_advertising_token': 'UID2.0',
    
    // ID5
    'id5id': 'ID5',
    'id5id_last': 'ID5',
    'id5_consent': 'ID5',
    
    // LiveIntent
    'idex': 'LiveIntent',
    'tuuid': 'LiveIntent',
    'li_did': 'LiveIntent',
    
    // Lotame
    '_cc_id': 'LotamePanorama',
    'panoramaId': 'LotamePanorama',
    'lotame_profile_id': 'LotamePanorama',
    
    // Criteo
    'cto_bundle': 'CriteoID',
    'cto_idcpy': 'CriteoID',
    'optout': 'CriteoID',
    
    // SharedID/PubCommon
    'sharedid': 'SharedID',
    '_sharedid': 'SharedID',
    '_pubcid': 'PubCommonID',
    'pubcid': 'PubCommonID',
    
    // Quantcast
    '__qca': 'QuantcastID',
    'mc': 'QuantcastID',
    
    // UnifiedID
    '__uid': 'UnifiedID',
    'unified_id': 'UnifiedID',
    
    // IntentIQ
    'intentIqId': 'IntentIQ',
    'iiq_id': 'IntentIQ',
    
    // Parrable
    '_parrable_id': 'Parrable',
    'tpc': 'Parrable',
    
    // Amazon
    'ad-id': 'AmazonAdvertisingID',
    'ad-privacy': 'AmazonAdvertisingID',
    
    // Various provider-specific cookies
    'hadronId': 'HadronID',
    'connectId': 'YahooConnectID',
    'tapad_id': 'TapadGraph',
    'idx': 'IDx',
    'bpid': 'BritePool',
    'amxId': 'AMXRTB',
    'admixerId': 'AdmixerID',
    'dmdId': 'DMDID',
    'kpuid': 'KinessoID',
    'novatiqId': 'NovatiqHyperID',
    'pairId': 'PairID',
    'trustpid': 'TrustPid',
    'utiq': 'UTIQ',
    'vidm_id': 'VerizonMediaID',
    'netId': 'NetID',
    'mwol': 'MwOpenLinkID',
    'justId': 'JustID'
  },
  
  localStorage: {
    // UID 2.0
    '__uid2_advertising_token': 'UID2.0',
    'UID2-sdk-identity': 'UID2.0',
    
    // ID5
    'id5id': 'ID5',
    'id5id_last': 'ID5',
    'id5_consent': 'ID5',
    
    // LiveIntent
    '_li_pbid': 'LiveIntent',
    '_li_duid': 'LiveIntent',
    
    // SharedID
    'sharedid': 'SharedID',
    '__sharedid': 'SharedID',
    
    // PubCommon
    '_pubcid': 'PubCommonID',
    'pubcid': 'PubCommonID',
    
    // Parrable
    '_parrable_id': 'Parrable',
    'parrable_opted_out': 'Parrable',
    
    // Various provider-specific storage
    'lotame_profile_id': 'LotamePanorama',
    'criteo_fast_bid': 'CriteoID',
    'quantcast_id': 'QuantcastID',
    'intentiq_id': 'IntentIQ',
    'hadron_id': 'HadronID',
    'connectid': 'YahooConnectID',
    'tapad_id': 'TapadGraph',
    'idx_id': 'IDx',
    'britepool_id': 'BritePool',
    'amx_id': 'AMXRTB',
    'admixer_id': 'AdmixerID',
    'dmd_id': 'DMDID',
    'kinesso_id': 'KinessoID',
    'novatiq_id': 'NovatiqHyperID',
    'pair_id': 'PairID',
    'trustpid': 'TrustPid',
    'utiq_id': 'UTIQ',
    'verizon_media_id': 'VerizonMediaID',
    'netid': 'NetID',
    'mwol_id': 'MwOpenLinkID',
    'just_id': 'JustID'
  },
  
  prebidModules: {
    // User ID modules as they appear in Prebid
    'uid2IdSystem': 'UID2.0',
    'unifiedIdSystem': 'UnifiedID',
    'id5IdSystem': 'ID5',
    'sharedIdSystem': 'SharedID',
    'pubCommonIdSystem': 'PubCommonID',
    'liveIntentIdSystem': 'LiveIntent',
    'lotamePanoramaIdSystem': 'LotamePanorama',
    'criteoIdSystem': 'CriteoID',
    'merkleIdSystem': 'MerkleID',
    'fabrickIdSystem': 'NeustarFabrick',
    'zeotapIdPlusIdSystem': 'ZeotapID',
    'quantcastIdSystem': 'QuantcastID',
    'intentIqIdSystem': 'IntentIQ',
    'hadronIdSystem': 'HadronID',
    'connectIdSystem': 'YahooConnectID',
    'tapadIdSystem': 'TapadGraph',
    'idxIdSystem': 'IDx',
    'britepoolIdSystem': 'BritePool',
    'amxIdSystem': 'AMXRTB',
    'admixerIdSystem': 'AdmixerID',
    'dmdIdSystem': 'DMDID',
    'kinessoIdSystem': 'KinessoID',
    'novatiqIdSystem': 'NovatiqHyperID',
    'parrableIdSystem': 'Parrable',
    'amazonIdSystem': 'AmazonAdvertisingID',
    'oneKeyIdSystem': 'OneKeyID',
    'pairIdSystem': 'PairID',
    'trustpidSystem': 'TrustPid',
    'utiqIdSystem': 'UTIQ',
    'verizonMediaIdSystem': 'VerizonMediaID',
    'netIdSystem': 'NetID',
    'mwOpenLinkIdSystem': 'MwOpenLinkID',
    'justIdSystem': 'JustID'
  }
};

/**
 * Comprehensive identity detection function to be executed in page context
 */
export function createIdentityDetectionScript(): string {
  return `
    (function detectIdentityProviders() {
      const detectedProviders = new Map();
      const detectionPatterns = ${JSON.stringify(DETECTION_PATTERNS)};
      const providerDefinitions = ${JSON.stringify(IDENTITY_PROVIDERS)};
      
      // Helper to add detection
      function addDetection(providerId, method, confidence, details) {
        if (!detectedProviders.has(providerId)) {
          detectedProviders.set(providerId, {
            detectionMethods: [],
            metadata: {}
          });
        }
        const provider = detectedProviders.get(providerId);
        provider.detectionMethods.push({ type: method, confidence, details });
      }
      
      // 1. Check window objects
      for (const [key, providerId] of Object.entries(detectionPatterns.window)) {
        try {
          if (window[key] !== undefined && window[key] !== null) {
            const value = window[key];
            const confidence = typeof value === 'object' ? 'high' : 'medium';
            let details = 'Window object: ' + key;
            
            // Try to extract version or additional metadata
            if (value && typeof value === 'object') {
              if (value.version) {
                const provider = detectedProviders.get(providerId) || { detectionMethods: [], metadata: {} };
                provider.metadata.version = value.version;
                detectedProviders.set(providerId, provider);
              }
              if (value.getId && typeof value.getId === 'function') {
                details += ' (has getId method)';
              }
            }
            
            addDetection(providerId, 'window', confidence, details);
          }
        } catch (e) {
          // Skip if we can't access the property
        }
      }
      
      // 2. Check cookies
      try {
        const cookies = document.cookie.split(';').map(c => c.trim());
        for (const cookie of cookies) {
          const [name] = cookie.split('=');
          const cookieName = name.trim();
          
          for (const [pattern, providerId] of Object.entries(detectionPatterns.cookies)) {
            if (cookieName === pattern || cookieName.includes(pattern)) {
              addDetection(providerId, 'cookie', 'high', 'Cookie: ' + cookieName);
            }
          }
        }
      } catch (e) {
        // Cookie access might be blocked
      }
      
      // 3. Check localStorage
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          
          for (const [pattern, providerId] of Object.entries(detectionPatterns.localStorage)) {
            if (key === pattern || key.includes(pattern)) {
              const value = localStorage.getItem(key);
              const confidence = value && value.length > 20 ? 'high' : 'medium';
              addDetection(providerId, 'localStorage', confidence, 'Storage key: ' + key);
            }
          }
        }
      } catch (e) {
        // LocalStorage access might be blocked
      }
      
      // 4. Check for Prebid modules (if Prebid exists)
      try {
        if (window._pbjsGlobals && Array.isArray(window._pbjsGlobals)) {
          for (const globalName of window._pbjsGlobals) {
            const pbjs = window[globalName];
            if (pbjs && pbjs.installedModules && Array.isArray(pbjs.installedModules)) {
              for (const module of pbjs.installedModules) {
                const moduleStr = String(module);
                for (const [pattern, providerId] of Object.entries(detectionPatterns.prebidModules)) {
                  if (moduleStr === pattern || moduleStr.includes(pattern.replace('IdSystem', ''))) {
                    addDetection(providerId, 'prebidModule', 'high', 'Prebid module: ' + moduleStr);
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // Prebid might not be available
      }
      
      // 5. Check for specific script tags (additional detection)
      try {
        const scripts = document.querySelectorAll('script[src]');
        const idScriptPatterns = {
          'id5-sync.com': 'ID5',
          'liadm.com': 'LiveIntent',
          'crwdcntrl.net': 'LotamePanorama',
          'criteo.com': 'CriteoID',
          'adsrvr.org': 'UnifiedID',
          'intentiq.com': 'IntentIQ',
          'parrable.com': 'Parrable',
          'quantserve.com': 'QuantcastID',
          'zeotap.com': 'ZeotapID',
          'britepool.com': 'BritePool',
          'novatiq.com': 'NovatiqHyperID'
        };
        
        scripts.forEach(script => {
          const src = script.src.toLowerCase();
          for (const [domain, providerId] of Object.entries(idScriptPatterns)) {
            if (src.includes(domain)) {
              addDetection(providerId, 'script', 'medium', 'Script from: ' + domain);
            }
          }
        });
      } catch (e) {
        // Script detection failed
      }
      
      // 6. Check for pixels/iframes (additional detection)
      try {
        const iframes = document.querySelectorAll('iframe[src]');
        const pixelPatterns = {
          'idsync.rlcdn.com': 'LiveIntent',
          'sync.crwdcntrl.net': 'LotamePanorama',
          'match.adsrvr.org': 'UnifiedID',
          'sync.intentiq.com': 'IntentIQ',
          'sync.zeotap.com': 'ZeotapID'
        };
        
        iframes.forEach(iframe => {
          const src = iframe.src.toLowerCase();
          for (const [domain, providerId] of Object.entries(pixelPatterns)) {
            if (src.includes(domain)) {
              addDetection(providerId, 'pixel', 'low', 'Sync pixel: ' + domain);
            }
          }
        });
      } catch (e) {
        // Pixel detection failed
      }
      
      // Convert Map to result format
      const result = {
        providers: [],
        summary: {
          totalProviders: 0,
          firstPartyCount: 0,
          thirdPartyCount: 0,
          deterministicCount: 0,
          probabilisticCount: 0,
          consentRequiredCount: 0
        },
        raw: {
          windowObjects: [],
          cookies: [],
          localStorage: [],
          prebidModules: []
        }
      };
      
      // Build final provider list with classifications
      for (const [providerId, detectionData] of detectedProviders.entries()) {
        const providerDef = providerDefinitions[providerId];
        if (providerDef) {
          const provider = {
            name: providerDef.name,
            detected: true,
            detectionMethods: detectionData.detectionMethods,
            classification: providerDef.classification,
            metadata: detectionData.metadata
          };
          
          result.providers.push(provider);
          
          // Update summary
          result.summary.totalProviders++;
          if (providerDef.classification.partyType === '1st') {
            result.summary.firstPartyCount++;
          } else if (providerDef.classification.partyType === '3rd') {
            result.summary.thirdPartyCount++;
          }
          if (providerDef.classification.idType === 'deterministic') {
            result.summary.deterministicCount++;
          } else if (providerDef.classification.idType === 'probabilistic') {
            result.summary.probabilisticCount++;
          }
          if (providerDef.classification.requiresConsent) {
            result.summary.consentRequiredCount++;
          }
          
          // Track raw detections
          detectionData.detectionMethods.forEach(method => {
            if (method.type === 'window' && method.details) {
              result.raw.windowObjects.push(method.details.replace('Window object: ', ''));
            } else if (method.type === 'cookie' && method.details) {
              result.raw.cookies.push(method.details.replace('Cookie: ', ''));
            } else if (method.type === 'localStorage' && method.details) {
              result.raw.localStorage.push(method.details.replace('Storage key: ', ''));
            } else if (method.type === 'prebidModule' && method.details) {
              result.raw.prebidModules.push(method.details.replace('Prebid module: ', ''));
            }
          });
        }
      }
      
      // Sort providers by name for consistency
      result.providers.sort((a, b) => a.name.localeCompare(b.name));
      
      return result;
    })();
  `;
}

/**
 * Detect identity providers from outside the page context (for Puppeteer use)
 */
export async function detectIdentityProviders(page: any): Promise<IdentityDetectionResult> {
  try {
    const result = await page.evaluate(createIdentityDetectionScript());
    return result as IdentityDetectionResult;
  } catch (error) {
    console.error('Error detecting identity providers:', error);
    return {
      providers: [],
      summary: {
        totalProviders: 0,
        firstPartyCount: 0,
        thirdPartyCount: 0,
        deterministicCount: 0,
        probabilisticCount: 0,
        consentRequiredCount: 0
      },
      raw: {
        windowObjects: [],
        cookies: [],
        localStorage: [],
        prebidModules: []
      }
    };
  }
}