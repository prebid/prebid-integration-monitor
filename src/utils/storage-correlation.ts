/**
 * Storage Correlation Module
 * Maps cookies and localStorage to their owners/purposes
 */

export interface StorageOwner {
  pattern: RegExp;
  owner: string;
  category: 'identity' | 'analytics' | 'advertising' | 'consent' | 'functional' | 'unknown';
  purpose: string;
  privacy: 'first-party' | 'third-party';
}

// Comprehensive mapping of known cookie/storage patterns
export const STORAGE_PATTERNS: StorageOwner[] = [
  // Google Ecosystem
  { pattern: /^__gads$/, owner: 'Google Ads', category: 'advertising', purpose: 'Ad targeting and measurement', privacy: 'third-party' },
  { pattern: /^__gpi$/, owner: 'Google Publisher Tag', category: 'advertising', purpose: 'Publisher ad serving', privacy: 'third-party' },
  { pattern: /^__eoi$/, owner: 'Google', category: 'advertising', purpose: 'Interest-based advertising', privacy: 'third-party' },
  { pattern: /^_ga$|^_ga_/, owner: 'Google Analytics', category: 'analytics', purpose: 'Website analytics', privacy: 'first-party' },
  { pattern: /^_gcl_/, owner: 'Google Ads Conversion', category: 'advertising', purpose: 'Conversion tracking', privacy: 'first-party' },
  { pattern: /^_gid$/, owner: 'Google Analytics', category: 'analytics', purpose: 'User distinction', privacy: 'first-party' },
  { pattern: /^goog:/, owner: 'Google', category: 'advertising', purpose: 'Various Google services', privacy: 'third-party' },
  
  // Facebook/Meta
  { pattern: /^_fbp$/, owner: 'Facebook Pixel', category: 'advertising', purpose: 'Facebook ad targeting', privacy: 'third-party' },
  { pattern: /^_fbc$/, owner: 'Facebook', category: 'advertising', purpose: 'Facebook click ID', privacy: 'third-party' },
  
  // Amazon
  { pattern: /^aps/, owner: 'Amazon Publisher Services', category: 'advertising', purpose: 'Header bidding', privacy: 'third-party' },
  { pattern: /^apstag/, owner: 'Amazon TAM', category: 'advertising', purpose: 'Transparent Ad Marketplace', privacy: 'third-party' },
  
  // Identity Providers
  { pattern: /^_sharedID$|^sharedid/, owner: 'SharedID/Prebid', category: 'identity', purpose: 'Cross-site user identification', privacy: 'first-party' },
  { pattern: /^_pubcid/, owner: 'PubCommon ID', category: 'identity', purpose: 'Publisher common ID', privacy: 'first-party' },
  { pattern: /^id5/, owner: 'ID5', category: 'identity', purpose: 'Universal ID', privacy: 'third-party' },
  { pattern: /^__uid/, owner: 'UID2', category: 'identity', purpose: 'Unified ID 2.0', privacy: 'third-party' },
  { pattern: /^panoramaId/, owner: 'Lotame Panorama', category: 'identity', purpose: 'Identity graph', privacy: 'third-party' },
  { pattern: /^_li_duid$|^_li_pbid$/, owner: 'LiveIntent', category: 'identity', purpose: 'Email-based identity', privacy: 'third-party' },
  { pattern: /^idl_env$/, owner: 'IdentityLink', category: 'identity', purpose: 'Deterministic identity', privacy: 'third-party' },
  { pattern: /^33across/, owner: '33Across', category: 'identity', purpose: 'Addressability platform', privacy: 'third-party' },
  
  // Consent Management
  { pattern: /^usprivacy$|^us_privacy$/, owner: 'IAB CCPA', category: 'consent', purpose: 'CCPA consent string', privacy: 'first-party' },
  { pattern: /^euconsent/, owner: 'IAB TCF', category: 'consent', purpose: 'GDPR consent string', privacy: 'first-party' },
  { pattern: /^_ketch_/, owner: 'Ketch', category: 'consent', purpose: 'Consent management platform', privacy: 'first-party' },
  { pattern: /^notice_gdpr/, owner: 'OneTrust/Evidon', category: 'consent', purpose: 'GDPR preferences', privacy: 'first-party' },
  { pattern: /^OptanonConsent/, owner: 'OneTrust', category: 'consent', purpose: 'Consent management', privacy: 'first-party' },
  
  // Ad Tech Companies
  { pattern: /^cto_/, owner: 'Criteo', category: 'advertising', purpose: 'Retargeting', privacy: 'third-party' },
  { pattern: /^__qca$/, owner: 'Quantcast', category: 'analytics', purpose: 'Audience measurement', privacy: 'third-party' },
  { pattern: /^rtbhouse/, owner: 'RTBHouse', category: 'advertising', purpose: 'Retargeting', privacy: 'third-party' },
  { pattern: /^_cc_/, owner: 'Lotame', category: 'advertising', purpose: 'Data management platform', privacy: 'third-party' },
  { pattern: /^_kuid_$/, owner: 'Salesforce Krux', category: 'advertising', purpose: 'User segmentation', privacy: 'third-party' },
  { pattern: /^bounceClientVisit/, owner: 'Bounce Exchange', category: 'advertising', purpose: 'Exit intent marketing', privacy: 'third-party' },
  
  // Analytics & Monitoring
  { pattern: /^_hjid$|^_hj/, owner: 'Hotjar', category: 'analytics', purpose: 'Session recording & heatmaps', privacy: 'third-party' },
  { pattern: /^ajs_/, owner: 'Segment', category: 'analytics', purpose: 'Customer data platform', privacy: 'first-party' },
  { pattern: /^amplitude_/, owner: 'Amplitude', category: 'analytics', purpose: 'Product analytics', privacy: 'first-party' },
  { pattern: /^mp_/, owner: 'Mixpanel', category: 'analytics', purpose: 'Product analytics', privacy: 'third-party' },
  { pattern: /^optimizely/, owner: 'Optimizely', category: 'functional', purpose: 'A/B testing', privacy: 'first-party' },
  { pattern: /^lux_uid$/, owner: 'SpeedCurve LUX', category: 'analytics', purpose: 'Real user monitoring', privacy: 'first-party' },
  
  // Publishers & Platforms
  { pattern: /^_pn$|^pn_/, owner: 'Piano', category: 'functional', purpose: 'Subscription management', privacy: 'first-party' },
  { pattern: /^_swb$|^_swb_/, owner: 'ShareThis', category: 'advertising', purpose: 'Social sharing & tracking', privacy: 'third-party' },
  { pattern: /^pushly/, owner: 'Pushly', category: 'functional', purpose: 'Push notifications', privacy: 'first-party' },
  { pattern: /^permutive/, owner: 'Permutive', category: 'advertising', purpose: 'Publisher DMP', privacy: 'first-party' },
  
  // Security & Performance
  { pattern: /^datadome$/, owner: 'DataDome', category: 'functional', purpose: 'Bot detection', privacy: 'first-party' },
  { pattern: /^cf_/, owner: 'Cloudflare', category: 'functional', purpose: 'CDN & security', privacy: 'first-party' },
  { pattern: /^AWSALB/, owner: 'AWS', category: 'functional', purpose: 'Load balancing', privacy: 'first-party' },
  { pattern: /^__cf/, owner: 'Cloudflare', category: 'functional', purpose: 'Bot management', privacy: 'first-party' },
  
  // Session & Site Functionality
  { pattern: /session/i, owner: 'Site-specific', category: 'functional', purpose: 'Session management', privacy: 'first-party' },
  { pattern: /^client_id$/, owner: 'Site-specific', category: 'functional', purpose: 'User identification', privacy: 'first-party' },
  { pattern: /^PHPSESSID$/, owner: 'PHP', category: 'functional', purpose: 'Session management', privacy: 'first-party' },
  
  // ESP/SSP/DSP Platforms
  { pattern: /^_GESPSK/, owner: 'Google ESP', category: 'advertising', purpose: 'Enhanced conversions', privacy: 'third-party' },
  { pattern: /^pbjs_/, owner: 'Prebid.js', category: 'advertising', purpose: 'Header bidding', privacy: 'first-party' },
  { pattern: /^__gpp/, owner: 'IAB Global Privacy Platform', category: 'consent', purpose: 'Global privacy string', privacy: 'first-party' },
];

export interface StorageCorrelation {
  identified: Array<{
    name: string;
    value: string;
    owner: string;
    category: string;
    purpose: string;
    privacy: string;
  }>;
  unidentified: Array<{
    name: string;
    value: string;
  }>;
  summary: {
    total: number;
    identified: number;
    unidentified: number;
    byCategory: Record<string, number>;
    byOwner: Record<string, number>;
    privacyBreakdown: {
      firstParty: number;
      thirdParty: number;
    };
  };
}

export function correlateStorage(
  cookies: Array<{name: string; value: string}>,
  localStorage: Array<{key: string; value: string}>,
  sessionStorage: Array<{key: string; value: string}>
): StorageCorrelation {
  const result: StorageCorrelation = {
    identified: [],
    unidentified: [],
    summary: {
      total: 0,
      identified: 0,
      unidentified: 0,
      byCategory: {},
      byOwner: {},
      privacyBreakdown: {
        firstParty: 0,
        thirdParty: 0
      }
    }
  };

  // Process all storage items
  const allItems = [
    ...cookies.map(c => ({name: c.name, value: c.value, type: 'cookie'})),
    ...localStorage.map(l => ({name: l.key, value: l.value, type: 'localStorage'})),
    ...sessionStorage.map(s => ({name: s.key, value: s.value, type: 'sessionStorage'}))
  ];

  allItems.forEach(item => {
    let identified = false;
    
    for (const pattern of STORAGE_PATTERNS) {
      if (pattern.pattern.test(item.name)) {
        result.identified.push({
          name: item.name,
          value: item.value.substring(0, 50), // Truncate for privacy
          owner: pattern.owner,
          category: pattern.category,
          purpose: pattern.purpose,
          privacy: pattern.privacy
        });
        
        // Update summaries
        result.summary.byCategory[pattern.category] = (result.summary.byCategory[pattern.category] || 0) + 1;
        result.summary.byOwner[pattern.owner] = (result.summary.byOwner[pattern.owner] || 0) + 1;
        
        if (pattern.privacy === 'first-party') {
          result.summary.privacyBreakdown.firstParty++;
        } else {
          result.summary.privacyBreakdown.thirdParty++;
        }
        
        identified = true;
        break;
      }
    }
    
    if (!identified) {
      result.unidentified.push({
        name: item.name,
        value: item.value.substring(0, 50)
      });
    }
  });

  result.summary.total = allItems.length;
  result.summary.identified = result.identified.length;
  result.summary.unidentified = result.unidentified.length;

  return result;
}