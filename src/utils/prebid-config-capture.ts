/**
 * Minimal Prebid.js configuration capture utility
 * Captures raw config from pbjs.getConfig() or similar methods
 */

/**
 * Creates a minimal script to capture Prebid configuration
 * Fast mode that checks only the most common config locations
 * 
 * @param knownGlobalNames - Array of known Prebid global variable names
 * @returns JavaScript code as a string to be executed in page context
 */
export function createFastPrebidConfigCaptureScript(knownGlobalNames?: string[]): string {
  const globalNamesParam = knownGlobalNames ? JSON.stringify(knownGlobalNames) : '[]';
  
  return `(function(knownGlobalNames) {
    const result = {
      config: null,
      configSource: null,
      configStatus: 'not-found',
      diagnostics: {
        triedMethods: [],
        prebidFound: false,
        prebidState: 'not-found',
        hasGetConfig: false
      }
    };
    
    // Common Prebid global names to check
    const commonNames = ['pbjs', 'pbjs2', 'apntag', 'bsapb', 'hb_ice', '$PREBID_GLOBAL$'];
    const namesToCheck = [...new Set([...knownGlobalNames, ...commonNames])];
    
    let foundPrebid = null;
    let foundName = null;
    
    // Find first valid Prebid instance
    for (const name of namesToCheck) {
      try {
        if (window[name] && typeof window[name] === 'object') {
          foundPrebid = window[name];
          foundName = name;
          result.diagnostics.prebidFound = true;
          
          // Check if it has queue (loading) or is loaded
          if (Array.isArray(foundPrebid.que)) {
            result.diagnostics.prebidState = 'queue';
          } else if (foundPrebid.version) {
            result.diagnostics.prebidState = 'loaded';
          } else {
            result.diagnostics.prebidState = 'partial';
          }
          break;
        }
      } catch (e) {
        // Skip this name
      }
    }
    
    if (!foundPrebid) {
      return result;
    }
    
    // Try to get config
    try {
      // Method 1: getConfig() - most common
      if (typeof foundPrebid.getConfig === 'function') {
        result.diagnostics.hasGetConfig = true;
        const config = foundPrebid.getConfig();
        if (config && Object.keys(config).length > 0) {
          result.config = config;
          result.configSource = foundName + '.getConfig()';
          result.configStatus = 'found';
          return result;
        }
      }
      
      // Method 2: Direct _config property
      if (foundPrebid._config && Object.keys(foundPrebid._config).length > 0) {
        result.config = foundPrebid._config;
        result.configSource = foundName + '._config';
        result.configStatus = 'found';
        return result;
      }
      
      // Method 3: If in queue mode, try processing queue briefly
      if (result.diagnostics.prebidState === 'queue' && Array.isArray(foundPrebid.que)) {
        // Process a few queue items to see if config becomes available
        const maxQueueItems = 5;
        let processed = 0;
        
        for (const cmd of foundPrebid.que) {
          if (processed >= maxQueueItems) break;
          if (typeof cmd === 'function') {
            try {
              cmd();
              processed++;
            } catch (e) {
              // Skip failed commands
            }
          }
        }
        
        // Try getConfig again after queue processing
        if (typeof foundPrebid.getConfig === 'function') {
          const config = foundPrebid.getConfig();
          if (config && Object.keys(config).length > 0) {
            result.config = config;
            result.configSource = foundName + '.getConfig() after queue';
            result.configStatus = 'found';
            return result;
          }
        }
      }
      
      // If we found Prebid but no config
      if (result.diagnostics.prebidFound) {
        result.configStatus = 'detected-not-extracted';
      }
      
    } catch (error) {
      result.diagnostics.error = error.message;
    }
    
    return result;
  })(${globalNamesParam});`;
}