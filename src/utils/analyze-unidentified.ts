/**
 * Analyze Unidentified Storage Module
 * Helps identify patterns in unidentified storage items for future correlation
 */

export interface UnidentifiedAnalysis {
  patterns: {
    prefixes: Record<string, string[]>; // Common prefixes and their items
    suffixes: Record<string, string[]>; // Common suffixes
    keywords: Record<string, string[]>; // Items containing keywords
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
}

// Known patterns that weren't in our main correlation but we can suggest
const ADDITIONAL_PATTERNS = [
  // ESPN/Disney specific
  { pattern: /^SWID$/, owner: 'ESPN/Disney', reasoning: 'ESPN Single Web ID for user identification' },
  { pattern: /^s_ens/, owner: 'Adobe Analytics (ESPN)', reasoning: 'Adobe Analytics namespace for ESPN' },
  { pattern: /^ESPN/, owner: 'ESPN', reasoning: 'ESPN-prefixed cookies' },
  
  // Adobe/Omniture Analytics
  { pattern: /^s_/, owner: 'Adobe Analytics', reasoning: 'Adobe Analytics/Omniture standard prefix' },
  { pattern: /^mbox/, owner: 'Adobe Target', reasoning: 'Adobe Target personalization' },
  { pattern: /^AMCV_/, owner: 'Adobe Experience Cloud', reasoning: 'Adobe Marketing Cloud Visitor ID' },
  
  // Common analytics
  { pattern: /^_dc_/, owner: 'DoubleClick', reasoning: 'DoubleClick/Google ad serving' },
  { pattern: /^_cs_/, owner: 'ContentSquare', reasoning: 'ContentSquare analytics' },
  { pattern: /^_hp2_/, owner: 'Heap Analytics', reasoning: 'Heap Analytics tracking' },
  { pattern: /^ab\.storage/, owner: 'AB Tasty', reasoning: 'AB Tasty A/B testing' },
  
  // CDPs and DMPs
  { pattern: /^_evga_/, owner: 'Evergage/Salesforce', reasoning: 'Evergage personalization platform' },
  { pattern: /^bluekai/, owner: 'Oracle BlueKai', reasoning: 'Oracle DMP' },
  { pattern: /^krux/, owner: 'Salesforce Krux', reasoning: 'Krux DMP' },
  
  // Social platforms
  { pattern: /^datr$/, owner: 'Facebook', reasoning: 'Facebook browser identification' },
  { pattern: /^sb$/, owner: 'Facebook', reasoning: 'Facebook security browser ID' },
  { pattern: /^personalization_id$/, owner: 'Twitter', reasoning: 'Twitter personalization' },
  
  // E-commerce
  { pattern: /^_shopify_/, owner: 'Shopify', reasoning: 'Shopify e-commerce platform' },
  { pattern: /^wc_/, owner: 'WooCommerce', reasoning: 'WooCommerce e-commerce' },
  { pattern: /^cart/, owner: 'E-commerce Platform', reasoning: 'Shopping cart data' },
  
  // Authentication/Session
  { pattern: /^auth/, owner: 'Authentication System', reasoning: 'Authentication tokens' },
  { pattern: /^token/, owner: 'Authentication System', reasoning: 'Access/refresh tokens' },
  { pattern: /^sid$|^sessionid$/i, owner: 'Session Management', reasoning: 'Session identifiers' },
  
  // Geographic/Localization
  { pattern: /^country$|^region$|^locale$/, owner: 'Site Localization', reasoning: 'Geographic/language preferences' },
  { pattern: /^edition/, owner: 'Content Localization', reasoning: 'Content edition preferences' },
  
  // User preferences
  { pattern: /^theme$|^dark/, owner: 'UI Preferences', reasoning: 'Theme/display preferences' },
  { pattern: /^font/, owner: 'UI Preferences', reasoning: 'Font size preferences' },
  
  // Newsletter/Email
  { pattern: /^sailthru/, owner: 'Sailthru', reasoning: 'Sailthru email marketing' },
  { pattern: /^mc_/, owner: 'Mailchimp', reasoning: 'Mailchimp email marketing' },
  
  // Video players
  { pattern: /^jwplayer/, owner: 'JW Player', reasoning: 'JW Player video platform' },
  { pattern: /^brightcove/, owner: 'Brightcove', reasoning: 'Brightcove video platform' },
  { pattern: /^kaltura/, owner: 'Kaltura', reasoning: 'Kaltura video platform' },
  
  // Payment/Subscription
  { pattern: /^stripe/, owner: 'Stripe', reasoning: 'Stripe payment processing' },
  { pattern: /^braintree/, owner: 'Braintree/PayPal', reasoning: 'Braintree payment processing' },
  
  // Chat/Support
  { pattern: /^intercom/, owner: 'Intercom', reasoning: 'Intercom customer messaging' },
  { pattern: /^zendesk/, owner: 'Zendesk', reasoning: 'Zendesk customer support' },
  { pattern: /^drift/, owner: 'Drift', reasoning: 'Drift conversational marketing' },
  
  // Testing/Experimentation
  { pattern: /^_vis_opt_/, owner: 'VWO', reasoning: 'Visual Website Optimizer' },
  { pattern: /^_gaexp/, owner: 'Google Optimize', reasoning: 'Google Optimize experiments' },
  
  // Security/Fraud
  { pattern: /^_px/, owner: 'PerimeterX', reasoning: 'PerimeterX bot detection' },
  { pattern: /^reese84/, owner: 'Human Security', reasoning: 'Human/White Ops bot detection' },
  { pattern: /^ak_bmsc$/, owner: 'Akamai', reasoning: 'Akamai bot manager' },
  
  // Publisher specific
  { pattern: /^nyt-/, owner: 'New York Times', reasoning: 'NYT-specific cookies' },
  { pattern: /^WaPo/, owner: 'Washington Post', reasoning: 'Washington Post cookies' },
  { pattern: /^bbc/, owner: 'BBC', reasoning: 'BBC-specific cookies' },
  { pattern: /^cnn/, owner: 'CNN', reasoning: 'CNN-specific cookies' },
  { pattern: /^forbes/, owner: 'Forbes', reasoning: 'Forbes-specific cookies' }
];

export function analyzeUnidentified(
  unidentifiedItems: Array<{ name: string; storageType: string }>
): UnidentifiedAnalysis {
  const analysis: UnidentifiedAnalysis = {
    patterns: {
      prefixes: {},
      suffixes: {},
      keywords: {}
    },
    suggestions: [],
    statistics: {
      total: unidentifiedItems.length,
      byStorageType: {},
      commonPatterns: []
    }
  };

  // Count by storage type
  unidentifiedItems.forEach(item => {
    analysis.statistics.byStorageType[item.storageType] = 
      (analysis.statistics.byStorageType[item.storageType] || 0) + 1;
  });

  // Extract patterns
  const prefixMap: Record<string, string[]> = {};
  const suffixMap: Record<string, string[]> = {};
  const keywordMap: Record<string, string[]> = {};

  unidentifiedItems.forEach(item => {
    const name = item.name;
    
    // Extract prefix (first part before _ or -)
    const prefixMatch = name.match(/^([a-zA-Z]+)[_\-]/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      if (!prefixMap[prefix]) prefixMap[prefix] = [];
      prefixMap[prefix].push(name);
    }
    
    // Extract suffix (last part after _ or -)
    const suffixMatch = name.match(/[_\-]([a-zA-Z]+)$/);
    if (suffixMatch) {
      const suffix = suffixMatch[1];
      if (!suffixMap[suffix]) suffixMap[suffix] = [];
      suffixMap[suffix].push(name);
    }
    
    // Extract keywords
    const keywords = ['id', 'user', 'session', 'token', 'uid', 'guid', 'uuid', 'track', 
                     'visitor', 'customer', 'client', 'analytics', 'metric', 'consent',
                     'gdpr', 'ccpa', 'privacy', 'opt', 'ad', 'campaign', 'source', 'medium'];
    
    keywords.forEach(keyword => {
      if (name.toLowerCase().includes(keyword)) {
        if (!keywordMap[keyword]) keywordMap[keyword] = [];
        keywordMap[keyword].push(name);
      }
    });
  });

  // Filter to only show patterns with 2+ occurrences
  Object.entries(prefixMap).forEach(([prefix, items]) => {
    if (items.length >= 2) {
      analysis.patterns.prefixes[prefix] = items;
    }
  });
  
  Object.entries(suffixMap).forEach(([suffix, items]) => {
    if (items.length >= 2) {
      analysis.patterns.suffixes[suffix] = items;
    }
  });
  
  analysis.patterns.keywords = keywordMap;

  // Check against additional patterns for suggestions
  const groupedSuggestions: Record<string, { items: string[]; reasoning: string; confidence: 'high' | 'medium' | 'low' }> = {};
  
  unidentifiedItems.forEach(item => {
    for (const pattern of ADDITIONAL_PATTERNS) {
      if (pattern.pattern.test(item.name)) {
        if (!groupedSuggestions[pattern.owner]) {
          groupedSuggestions[pattern.owner] = {
            items: [],
            reasoning: pattern.reasoning,
            confidence: 'medium'
          };
        }
        groupedSuggestions[pattern.owner].items.push(item.name);
        break; // Only match first pattern
      }
    }
  });
  
  // Convert grouped suggestions to array
  Object.entries(groupedSuggestions).forEach(([owner, data]) => {
    // Adjust confidence based on number of matches
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (data.items.length >= 3) confidence = 'high';
    else if (data.items.length >= 2) confidence = 'medium';
    
    analysis.suggestions.push({
      items: data.items,
      possibleOwner: owner,
      reasoning: data.reasoning,
      confidence: confidence
    });
  });
  
  // Sort suggestions by confidence and item count
  analysis.suggestions.sort((a, b) => {
    const confOrder = { high: 3, medium: 2, low: 1 };
    const confDiff = confOrder[b.confidence] - confOrder[a.confidence];
    if (confDiff !== 0) return confDiff;
    return b.items.length - a.items.length;
  });

  // Identify most common patterns
  const allPatterns: Record<string, string[]> = {};
  
  // Check for underscore patterns
  unidentifiedItems.forEach(item => {
    if (item.name.includes('_')) {
      const parts = item.name.split('_');
      if (parts[0]) {
        const pattern = `${parts[0]}_*`;
        if (!allPatterns[pattern]) allPatterns[pattern] = [];
        allPatterns[pattern].push(item.name);
      }
    }
  });
  
  // Convert to common patterns array
  analysis.statistics.commonPatterns = Object.entries(allPatterns)
    .filter(([_, items]) => items.length >= 2)
    .map(([pattern, items]) => ({
      pattern: pattern,
      count: items.length,
      examples: items.slice(0, 3)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return analysis;
}

// Function to generate correlation rule suggestions
export function suggestCorrelationRules(analysis: UnidentifiedAnalysis): string[] {
  const rules: string[] = [];
  
  // Suggest rules based on high-confidence suggestions
  analysis.suggestions
    .filter(s => s.confidence === 'high')
    .forEach(suggestion => {
      const commonPrefix = findCommonPrefix(suggestion.items);
      if (commonPrefix && commonPrefix.length >= 3) {
        rules.push(
          `{ pattern: /^${escapeRegex(commonPrefix)}/, owner: '${suggestion.possibleOwner}', category: 'unknown', purpose: '${suggestion.reasoning}', privacy: 'unknown' }`
        );
      }
    });
  
  // Suggest rules based on common prefixes
  Object.entries(analysis.patterns.prefixes)
    .filter(([prefix, items]) => items.length >= 3)
    .forEach(([prefix, items]) => {
      if (!rules.some(r => r.includes(prefix))) {
        rules.push(
          `{ pattern: /^${escapeRegex(prefix)}_/, owner: 'Unknown (${prefix})', category: 'unknown', purpose: 'Multiple ${prefix}-prefixed items', privacy: 'unknown' }`
        );
      }
    });
  
  return rules;
}

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];
  
  let prefix = '';
  const firstStr = strings[0];
  
  for (let i = 0; i < firstStr.length; i++) {
    const char = firstStr[i];
    if (strings.every(s => s[i] === char)) {
      prefix += char;
    } else {
      break;
    }
  }
  
  return prefix;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}