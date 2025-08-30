/**
 * Prebid Configuration Capture Module
 * Captures raw Prebid.js configuration directly from pbjs.getConfig()
 */

export function createPrebidConfigCaptureScript(): string {
  return `
    (function() {
      try {
        // Check for Prebid.js instances
        const prebidInstances = [];
        const globalVars = Object.keys(window);
        
        for (const key of globalVars) {
          if (key.includes('pbjs') || key === 'pbjs') {
            const obj = window[key];
            if (obj && typeof obj === 'object' && typeof obj.getConfig === 'function') {
              prebidInstances.push({
                name: key,
                instance: obj
              });
            }
          }
        }

        if (prebidInstances.length === 0) {
          return null;
        }

        // Use the first instance found (or 'pbjs' if available)
        const pbjs = window.pbjs || prebidInstances[0].instance;
        
        // Get raw config directly
        if (typeof pbjs.getConfig === 'function') {
          return pbjs.getConfig();
        }

        return null;
      } catch (error) {
        return {
          error: error.message,
          stack: error.stack
        };
      }
    })();
  `;
}