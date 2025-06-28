/**
 * @fileoverview This module defines core data structures and Puppeteer tasks
 * related to extracting Prebid.js information from web pages. It includes
 * interfaces for representing page data, Prebid instances, task results,
 * and the main Puppeteer page processing logic.
 */

import { Page } from 'puppeteer';
import type { Logger as WinstonLogger } from 'winston';
// Import shared types that are directly used or returned by functions in this module.
// Types like PrebidInstance, TaskResultType, TaskResultSuccess etc. are indirectly
// used via PageData and TaskResult, so they don't need separate imports here.
import type { PageData, TaskResult } from '../common/types.js';
import {
  DEFAULT_USER_AGENT,
  PUPPETEER_DEFAULT_PAGE_TIMEOUT,
  PBJS_VERSION_WAIT_TIMEOUT_MS,
  PBJS_VERSION_WAIT_INTERVAL_MS,
} from '../config/app-config.js';
import { createAuthenticUserAgent } from './user-agent.js';

/**
 * Configures a given Puppeteer {@link Page} instance with standard settings
 * suitable for web scraping tasks with enhanced authenticity.
 * This includes setting a default navigation timeout, an authentic user agent
 * that matches the actual Chrome version, and additional browser properties
 * for better bot detection avoidance.
 *
 * @param {Page} page - The Puppeteer `Page` instance to be configured.
 * @param {WinstonLogger} [logger] - Optional logger for debugging user agent generation.
 * @returns {Promise<Page>} A promise that resolves with the same `Page` instance after configuration.
 * @example
 * const browser = await puppeteer.launch();
 * const page = await browser.newPage();
 * await configurePage(page, logger);
 * // page is now configured with authentic settings.
 */
export async function configurePage(page: Page, logger?: WinstonLogger): Promise<Page> {
  page.setDefaultTimeout(PUPPETEER_DEFAULT_PAGE_TIMEOUT);
  
  try {
    // Generate authentic user agent that matches Puppeteer's Chrome version
    const authenticUserAgent = await createAuthenticUserAgent({
      platform: 'auto',
      usePuppeteerVersion: true
    }, logger);
    
    await page.setUserAgent(authenticUserAgent);
    logger?.debug(`Set authentic user agent: ${authenticUserAgent}`);
  } catch (error) {
    // Fallback to default user agent if dynamic generation fails
    logger?.warn('Failed to generate authentic user agent, using fallback', { error });
    await page.setUserAgent(DEFAULT_USER_AGENT);
  }
  
  // Set realistic viewport size (common desktop resolution)
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true
  });
  
  // Note: HTTPS errors are handled through launch args instead of page.setIgnoreHTTPSErrors
  
  // Set additional browser properties for authenticity
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver property that indicates automation
    delete (navigator as any).webdriver;
    
    // Override plugins length to appear more like a real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => ({
        length: 3,
        '0': { name: 'Chrome PDF Plugin' },
        '1': { name: 'Chromium PDF Plugin' },
        '2': { name: 'Microsoft Edge PDF Plugin' }
      })
    });
    
    // Override languages to be consistent with user agent
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
    
    // Set realistic hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8
    });
    
    // Set realistic memory info
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8
    });
    
    // Override permissions API to avoid permission prompts
    if (navigator.permissions) {
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({
          query: () => Promise.resolve({ state: 'denied' })
        })
      });
    }
  });
  
  // Set up automatic popup/modal/notification dismissal
  await page.evaluateOnNewDocument(() => {
    // Auto-dismiss common notification permission requests
    if ('Notification' in window && window.Notification) {
      Object.defineProperty(window, 'Notification', {
        value: {
          permission: 'denied',
          requestPermission: () => Promise.resolve('denied')
        }
      });
    }
    
    // Auto-dismiss geolocation requests
    if (navigator.geolocation) {
      Object.defineProperty(navigator, 'geolocation', {
        get: () => ({
          getCurrentPosition: () => {},
          watchPosition: () => {},
          clearWatch: () => {}
        })
      });
    }
  });
  
  return page;
}

/**
 * Attempts to dismiss common popups, modals, and overlays that might block content
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
export async function dismissPopups(page: Page, logger?: WinstonLogger): Promise<void> {
  try {
    // Common selectors for cookie consent banners, modals, and popups
    const popupSelectors = [
      // Cookie consent banners
      '[class*="cookie"] button[class*="accept"]',
      '[class*="cookie"] button[class*="agree"]',
      '[class*="consent"] button[class*="accept"]',
      '[class*="consent"] button[class*="agree"]',
      'button[data-accept="cookie"]',
      'button[id*="cookie"][id*="accept"]',
      
      // Generic modal close buttons
      '[class*="modal"] [class*="close"]',
      '[class*="popup"] [class*="close"]',
      '[class*="overlay"] [class*="close"]',
      'button[aria-label="Close"]',
      'button[aria-label="close"]',
      '[data-dismiss="modal"]',
      
      // Age verification
      'button[class*="age"][class*="confirm"]',
      'button[class*="verify"][class*="age"]',
      'input[value*="Yes"][type="button"]',
      
      // Newsletter signups
      '[class*="newsletter"] [class*="close"]',
      '[class*="subscribe"] [class*="close"]',
      
      // Generic "X" close buttons
      'button:has-text("×")',
      'button:has-text("✕")',
      'span:has-text("×")',
      '.close:has-text("×")'
    ];

    for (const selector of popupSelectors) {
      try {
        // Use a short timeout to quickly check if element exists
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isIntersectingViewport();
          if (isVisible) {
            await element.click();
            logger?.debug(`Dismissed popup using selector: ${selector}`);
            // Wait a moment for any animation to complete
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } catch (error) {
        // Ignore individual selector failures
        continue;
      }
    }

    // Handle notification permission dialogs (browser-level)
    await page.evaluate(() => {
      // Deny any pending notification requests
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          Notification.requestPermission().then(() => {
            // Request will be auto-denied by our override
          });
        } catch (e) {
          // Ignore errors
        }
      }
    });

  } catch (error) {
    logger?.debug('Error during popup dismissal:', error);
    // Don't throw - popup dismissal is best effort
  }
}

/**
 * Enhanced navigation function with retry logic and error handling
 * @param page - The Puppeteer page instance
 * @param url - The URL to navigate to
 * @param logger - Optional logger for debugging
 * @param maxRetries - Maximum number of retry attempts
 * @returns Promise that resolves when navigation is complete
 */
export async function navigateWithRetry(
  page: Page, 
  url: string, 
  logger?: WinstonLogger, 
  maxRetries: number = 2
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logger?.debug(`Navigation attempt ${attempt} for ${url}`);
      
      // Use progressive timeout strategy - longer for first attempt
      const timeout = attempt === 1 ? 60000 : Math.max(30000, 60000 - (attempt * 10000));
      
      // Use multiple wait conditions for better reliability
      await page.goto(url, { 
        timeout, 
        waitUntil: ['networkidle2', 'domcontentloaded']
      });
      
      // Enhanced post-navigation checks
      await performPostNavigationChecks(page, url, logger);
      
      logger?.debug(`Successfully navigated to ${url} (final URL: ${page.url()})`);
      return; // Success!
      
    } catch (error) {
      lastError = error as Error;
      logger?.debug(`Navigation attempt ${attempt} failed for ${url}:`, error);
      
      // Enhanced error classification for smarter retries
      if (!shouldRetryNavigation(error as Error, attempt, maxRetries)) {
        throw error;
      }
      
      if (attempt <= maxRetries) {
        // Progressive backoff with jitter to avoid thundering herd
        const baseWait = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const waitTime = Math.min(baseWait + jitter, 8000);
        logger?.debug(`Waiting ${Math.round(waitTime)}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error(`Failed to navigate to ${url} after ${maxRetries + 1} attempts`);
}

/**
 * Enhanced post-navigation validation and setup
 * @param page - The Puppeteer page instance
 * @param originalUrl - The original URL we attempted to navigate to
 * @param logger - Optional logger for debugging
 */
async function performPostNavigationChecks(page: Page, originalUrl: string, logger?: WinstonLogger): Promise<void> {
  // Wait for initial page stabilization
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Dismiss popups that might interfere with content detection
  await dismissPopups(page, logger);
  
  // Check for problematic redirects or error pages
  const currentUrl = page.url();
  const pageTitle = await page.title().catch(() => '');
  const pageContent = await page.content().catch(() => '');
  
  // Enhanced error page detection
  const errorIndicators = [
    'parked-content', 'domain parked', 'this domain may be for sale',
    'page not found', '404', 'server error', '500', 'access denied',
    'site temporarily unavailable', 'under construction'
  ];
  
  const hasErrorIndicator = errorIndicators.some(indicator => 
    pageTitle.toLowerCase().includes(indicator) || 
    pageContent.toLowerCase().includes(indicator) ||
    currentUrl.toLowerCase().includes(indicator)
  );
  
  if (hasErrorIndicator) {
    throw new Error(`Page appears to be unavailable or redirected to error page (${pageTitle})`);
  }
  
  // Check for major redirects that might indicate issues
  const originalDomain = new URL(originalUrl).hostname;
  const currentDomain = new URL(currentUrl).hostname;
  
  if (originalDomain !== currentDomain) {
    logger?.debug(`Domain redirect detected: ${originalDomain} -> ${currentDomain}`);
    
    // Common problematic redirect patterns
    const problematicDomains = ['parking', 'sedo.com', 'godaddy.com', 'namecheap.com'];
    if (problematicDomains.some(domain => currentDomain.includes(domain))) {
      throw new Error(`Redirected to problematic domain: ${currentDomain}`);
    }
  }
}

/**
 * Determine if navigation error should trigger a retry
 * @param error - The error that occurred
 * @param attempt - Current attempt number
 * @param maxRetries - Maximum retry attempts
 * @returns true if should retry, false otherwise
 */
function shouldRetryNavigation(error: Error, attempt: number, maxRetries: number): boolean {
  const errorMessage = error.message.toLowerCase();
  
  // Never retry these permanent failures
  const permanentErrors = [
    'net::err_name_not_resolved',
    'net::err_cert_authority_invalid', 
    'net::err_cert_common_name_invalid',
    'net::err_cert_date_invalid',
    'net::err_connection_refused'
  ];
  
  if (permanentErrors.some(permError => errorMessage.includes(permError))) {
    return false;
  }
  
  // Retry timeouts and temporary failures
  const retryableErrors = [
    'timeout',
    'net::err_connection_timed_out',
    'net::err_connection_reset',
    'net::err_network_changed',
    'navigation failed',
    'target closed'
  ];
  
  const isRetryable = retryableErrors.some(retryError => errorMessage.includes(retryError));
  return isRetryable && attempt <= maxRetries;
}

/**
 * Enhanced dynamic content triggering specifically optimized for ad tech detection
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
export async function triggerDynamicContent(page: Page, logger?: WinstonLogger): Promise<void> {
  try {
    logger?.debug('Triggering dynamic content loading optimized for ad tech...');
    
    // Phase 1: Simulate real user behavior for better ad loading
    await simulateUserInteraction(page, logger);
    
    // Phase 2: Smart scrolling to trigger lazy-loaded content
    await performSmartScrolling(page, logger);
    
    // Phase 3: Wait for ad tech libraries to initialize
    await waitForAdTechInitialization(page, logger);
    
    logger?.debug('Enhanced dynamic content loading completed');
  } catch (error) {
    logger?.debug('Error during enhanced dynamic content loading:', error);
    // Don't throw - this is best effort
  }
}

/**
 * Simulate realistic user interactions that often trigger ad loading
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
async function simulateUserInteraction(page: Page, logger?: WinstonLogger): Promise<void> {
  try {
    // Mouse movement to trigger hover events that might load ads
    await page.mouse.move(100, 100);
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.mouse.move(500, 300);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Click on non-interactive areas to trigger focus events
    await page.evaluate(() => {
      // Trigger various events that ad networks listen for
      document.body.click();
      
      // Dispatch custom events that some ad techs use
      const events = ['DOMContentLoaded', 'load', 'scroll', 'resize'];
      events.forEach(eventType => {
        try {
          const event = new Event(eventType, { bubbles: true });
          document.dispatchEvent(event);
        } catch (e) {
          // Ignore event dispatch errors
        }
      });
    });
    
    logger?.debug('User interaction simulation completed');
  } catch (error) {
    logger?.debug('Error during user interaction simulation:', error);
  }
}

/**
 * Intelligent scrolling that pauses to allow ad loading at key viewport positions
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
async function performSmartScrolling(page: Page, logger?: WinstonLogger): Promise<void> {
  try {
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 150; // Slightly larger steps
        const pauseDuration = 300; // Longer pause for ad loading
        let scrollCount = 0;
        const maxScrolls = 20; // Prevent infinite scrolling
        
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          const viewportHeight = window.innerHeight;
          
          // Scroll by distance
          window.scrollBy(0, distance);
          totalHeight += distance;
          scrollCount++;
          
          // Stop scrolling if we've reached the bottom or max scrolls
          if (totalHeight >= scrollHeight - viewportHeight || scrollCount >= maxScrolls) {
            clearInterval(timer);
            
            // Scroll to key positions where ads commonly load
            const keyPositions = [0, scrollHeight * 0.25, scrollHeight * 0.5, scrollHeight * 0.75, 0];
            let positionIndex = 0;
            
            const positionTimer = setInterval(() => {
              if (positionIndex < keyPositions.length) {
                window.scrollTo(0, keyPositions[positionIndex]);
                positionIndex++;
              } else {
                clearInterval(positionTimer);
                resolve();
              }
            }, 800); // Wait at each position for ad loading
          }
        }, pauseDuration);
      });
    });
    
    logger?.debug('Smart scrolling completed');
  } catch (error) {
    logger?.debug('Error during smart scrolling:', error);
  }
}

/**
 * Wait for common ad technology initialization patterns
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
async function waitForAdTechInitialization(page: Page, logger?: WinstonLogger): Promise<void> {
  try {
    // Wait for common ad tech initialization signals
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        let checkCount = 0;
        const maxChecks = 15; // 7.5 seconds total
        
        const checkInitialization = () => {
          checkCount++;
          
          // Check for common ad tech initialization signals
          const signals = [
            // Google Ad Manager / DFP
            () => (window as any).googletag && (window as any).googletag.apiReady,
            // Amazon A9/UAM
            () => (window as any).apstag && (window as any).apstag.initialized,
            // Header bidding signals
            () => (window as any).pbjs && (window as any).pbjs.libLoaded,
            // General ad loading completion
            () => document.querySelectorAll('[id*="google_ads"], [id*="ad-"], .ad-container, .advertisement').length > 0
          ];
          
          const hasSignal = signals.some(check => {
            try {
              return check();
            } catch (e) {
              return false;
            }
          });
          
          if (hasSignal || checkCount >= maxChecks) {
            resolve();
          } else {
            setTimeout(checkInitialization, 500);
          }
        };
        
        // Start checking after a brief delay
        setTimeout(checkInitialization, 1000);
      });
    });
    
    logger?.debug('Ad tech initialization wait completed');
  } catch (error) {
    logger?.debug('Error waiting for ad tech initialization:', error);
  }
}

/**
 * Waits for DOM to stabilize and checks for frame attachment issues
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 * @param maxWaitMs - Maximum time to wait for stability
 * @returns Promise that resolves when DOM is stable
 */
export async function waitForDOMStability(
  page: Page, 
  logger?: WinstonLogger, 
  maxWaitMs: number = 3000
): Promise<void> {
  try {
    logger?.debug('Waiting for DOM stability...');
    
    // Wait for page to be fully loaded and stable
    await page.evaluate((timeout) => {
      return new Promise<void>((resolve) => {
        let lastMutationTime = Date.now();
        let stabilityCheckInterval: NodeJS.Timeout;
        
        // Check for DOM stability
        const checkStability = () => {
          const now = Date.now();
          // If no mutations for 1 second, consider stable
          if (now - lastMutationTime >= 1000) {
            clearInterval(stabilityCheckInterval);
            resolve();
          }
        };
        
        // Set up mutation observer to track DOM changes
        const observer = new MutationObserver(() => {
          lastMutationTime = Date.now();
        });
        
        // Observe changes to the entire document
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
        
        // Start checking for stability
        stabilityCheckInterval = setInterval(checkStability, 200);
        
        // Timeout after specified time
        setTimeout(() => {
          observer.disconnect();
          clearInterval(stabilityCheckInterval);
          resolve();
        }, timeout);
      });
    }, maxWaitMs);
    
    logger?.debug('DOM stability check completed');
  } catch (error) {
    logger?.debug('Error during DOM stability check:', error);
    // Don't throw - this is best effort
  }
}

/**
 * Frame-safe data extraction with error handling for detached frames
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 * @param maxRetries - Maximum number of retry attempts
 * @returns Promise resolving to extracted page data
 */
export async function extractDataSafely(
  page: Page, 
  logger?: WinstonLogger, 
  maxRetries: number = 2
): Promise<any> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logger?.debug(`Data extraction attempt ${attempt}`);
      
      // Import the constants we need
      const { PBJS_VERSION_WAIT_TIMEOUT_MS, PBJS_VERSION_WAIT_INTERVAL_MS } = await import('../config/app-config.js');
      
      const extractedPageData = await page.evaluate(
        async (pbjsTimeoutMs, pbjsIntervalMs) => {
          // Define a type for the window object to avoid using 'any' repeatedly
          interface CustomWindow extends Window {
            apstag?: unknown; // Amazon Publisher Services UAM tag
            googletag?: unknown; // Google Publisher Tag
            ats?: unknown; // LiveRamp ATS.js
            _pbjsGlobals?: string[]; // Standard Prebid.js global variable names array
            [key: string]: any; // Index signature for dynamic access to Prebid instances (e.g., window['pbjs'])
          }
          
          const customWindow = window as CustomWindow;
          const data: any = {
            libraries: [],
            date: new Date().toISOString().slice(0, 10),
            prebidInstances: [],
          };

          // Detect other libraries with error handling
          try {
            if (customWindow.apstag) data.libraries.push('apstag');
            if (customWindow.googletag) data.libraries.push('googletag');
            if (customWindow.ats) data.libraries.push('ats');
          } catch (e) {
            // Ignore individual library detection errors
          }

          // Enhanced polling function with multi-stage detection for better reliability
          const getPbjsInstanceData = async (globalVarName: string) => {
            let elapsedTime = 0;
            let lastPartialInstance = null;
            
            while (elapsedTime < pbjsTimeoutMs) {
              try {
                const pbjsInstance = customWindow[globalVarName];
                
                // Stage 1: Check for fully initialized instance
                if (
                  pbjsInstance &&
                  typeof pbjsInstance.version === 'string' &&
                  pbjsInstance.version.length > 0 &&
                  Array.isArray(pbjsInstance.installedModules)
                ) {
                  // Additional validation for complete initialization
                  const isFullyLoaded = (
                    pbjsInstance.libLoaded === true ||
                    typeof pbjsInstance.requestBids === 'function' ||
                    typeof pbjsInstance.addAdUnits === 'function'
                  );
                  
                  if (isFullyLoaded) {
                    return {
                      globalVarName: globalVarName,
                      version: pbjsInstance.version,
                      modules: pbjsInstance.installedModules.map(String),
                      initializationState: 'complete'
                    };
                  }
                }
                
                // Stage 2: Check for partially loaded instance (still initializing)
                if (pbjsInstance && typeof pbjsInstance === 'object') {
                  // Store partial instance info but continue polling
                  lastPartialInstance = {
                    globalVarName: globalVarName,
                    version: pbjsInstance.version || 'unknown',
                    modules: Array.isArray(pbjsInstance.installedModules) 
                      ? pbjsInstance.installedModules.map(String) 
                      : [],
                    initializationState: 'partial'
                  };
                }
                
                // Stage 3: Check for Prebid command queue (pre-initialization)
                if (Array.isArray(pbjsInstance) && pbjsInstance.length > 0) {
                  lastPartialInstance = {
                    globalVarName: globalVarName,
                    version: 'queue-detected',
                    modules: [],
                    initializationState: 'queue'
                  };
                }
                
              } catch (e) {
                // Continue polling on errors - might be frame attachment issues
              }
              
              // Use shorter intervals initially, then longer ones
              const interval = elapsedTime < pbjsTimeoutMs / 3 ? pbjsIntervalMs : pbjsIntervalMs * 2;
              await new Promise((resolve) => setTimeout(resolve, interval));
              elapsedTime += interval;
            }
            
            // Return partial instance if we found one but couldn't get complete data
            return lastPartialInstance;
          };

          // Check for Prebid.js instances if _pbjsGlobals array exists
          try {
            if (
              customWindow._pbjsGlobals &&
              Array.isArray(customWindow._pbjsGlobals)
            ) {
              for (const globalVarName of customWindow._pbjsGlobals) {
                try {
                  const instanceData = await getPbjsInstanceData(globalVarName);
                  if (instanceData) {
                    data.prebidInstances.push(instanceData);
                  }
                } catch (e) {
                  // Skip this instance if there's an error
                  continue;
                }
              }
            }
          } catch (e) {
            // If we can't access _pbjsGlobals, that's okay
          }
          
          return data;
        },
        PBJS_VERSION_WAIT_TIMEOUT_MS,
        PBJS_VERSION_WAIT_INTERVAL_MS
      );
      
      logger?.debug(`Data extraction attempt ${attempt} succeeded`);
      return extractedPageData;
      
    } catch (error) {
      lastError = error as Error;
      logger?.debug(`Data extraction attempt ${attempt} failed:`, error);
      
      // Check if this is a detached frame error that we can retry
      if (error instanceof Error && error.message.includes('detached Frame')) {
        if (attempt <= maxRetries) {
          logger?.debug(`Detached frame error detected, retrying in ${attempt * 500}ms...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 500));
          
          // Wait for DOM to stabilize before retry
          await waitForDOMStability(page, logger, 2000);
          continue;
        }
      } else {
        // For non-frame errors, don't retry
        throw error;
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('Data extraction failed after all retries');
}

/**
 * Processes a single web page using Puppeteer to extract Prebid.js configurations
 * and other specified ad technology library information.
 *
 * The function performs the following steps:
 * 1. **Navigation**: Navigates to the provided URL, waiting until the network is idle.
 * 2. **Configuration**: Applies standard page configurations (timeout, user-agent) using {@link configurePage}.
 * 3. **Data Extraction**: Executes JavaScript within the page's context to:
 *    a. Detect presence of common ad libraries (Amazon Publisher Services UAM, Google Publisher Tag, LiveRamp ATS.js).
 *    b. Poll for Prebid.js global variables (`_pbjsGlobals`) to become available.
 *    c. For each detected Prebid.js instance, extract its version and list of installed modules.
 *       This polling mechanism uses `PBJS_VERSION_WAIT_TIMEOUT_MS` and `PBJS_VERSION_WAIT_INTERVAL_MS`
 *       which are passed into the `page.evaluate` context.
 * 4. **Result Handling**:
 *    - If Prebid.js instances or other ad libraries are found, returns a `TaskResultSuccess` object
 *      containing the extracted {@link PageData}.
 *    - If no relevant ad technology is detected, returns a `TaskResultNoData` object.
 *    - If any error occurs during the process (e.g., navigation timeout, script execution error),
 *      it logs the error and returns a `TaskResultError` object with structured {@link ErrorDetails}.
 *
 * This function is designed to be robust for use with `puppeteer-cluster` or similar parallel processing tools.
 *
 * @param {object} taskArgs - The arguments for the task.
 * @param {Page} taskArgs.page - The Puppeteer `Page` instance to be used for processing.
 * @param {object} taskArgs.data - An object containing the data for this specific task.
 * @param {string} taskArgs.data.url - The absolute URL of the web page to be processed.
 * @param {WinstonLogger} taskArgs.data.logger - An instance of WinstonLogger for logging messages specific to this task.
 * @param {number} taskArgs.data.pbjsTimeoutMs - Timeout in milliseconds for waiting for Prebid.js version.
 * @param {number} taskArgs.data.pbjsIntervalMs - Interval in milliseconds for polling for Prebid.js version.
 * @returns {Promise<TaskResult>} A promise that resolves to a {@link TaskResult} object,
 *                                indicating the outcome (`success`, `no_data`, or `error`) and relevant data.
 * @example
 * // Typically used as a task by puppeteer-cluster:
 * // await cluster.task(processPageTask);
 * // cluster.queue({
 * //   url: "https://example.com",
 * //   logger: myLoggerInstance,
 * //   pbjsTimeoutMs: 15000, // from app-config
 * //   pbjsIntervalMs: 100    // from app-config
 * // });
 */
export const processPageTask = async ({
  page,
  data: { url, logger },
}: {
  page: Page;
  data: { url: string; logger: WinstonLogger };
}): Promise<TaskResult> => {
  const trimmedUrl: string = url.trim(); // Ensure URL is trimmed before processing
  logger.info(`Attempting to process URL: ${trimmedUrl}`);
  try {
    await configurePage(page, logger); // Use the configurePage from this module
    
    // Use enhanced navigation with retry logic
    await navigateWithRetry(page, trimmedUrl, logger);
    
    // Trigger dynamic content loading (lazy loading, etc.)
    await triggerDynamicContent(page, logger);
    
    // Wait for DOM to stabilize before data extraction
    await waitForDOMStability(page, logger);

    // Use frame-safe data extraction with retry logic for detached frame errors
    const extractedPageData: PageData = await extractDataSafely(page, logger) as PageData;

    extractedPageData.url = trimmedUrl; // Assign the processed URL to the extracted data

    // Determine if meaningful data was extracted
    const hasLibraries =
      extractedPageData.libraries && extractedPageData.libraries.length > 0;
    const hasPrebidInstances =
      extractedPageData.prebidInstances &&
      extractedPageData.prebidInstances.length > 0;

    if (hasLibraries || hasPrebidInstances) {
      logger.info(`Successfully extracted data from ${trimmedUrl}`);
      return { type: 'success', data: extractedPageData };
    } else {
      logger.warn(
        `No relevant ad library or Prebid.js data found on ${trimmedUrl}`
      );
      return { type: 'no_data', url: trimmedUrl };
    }
  } catch (e: unknown) {
    const pageError = e as Error; // Keep original error for stack
    let errorCode = 'UNKNOWN_PROCESSING_ERROR';
    const originalMessage =
      pageError.message || 'Unknown error during page processing';

    // Attempt to extract a more specific error code
    const netErrorMatch = originalMessage.match(/net::([A-Z_]+)/);
    if (netErrorMatch && netErrorMatch[1]) {
      errorCode = netErrorMatch[1];
    } else if (originalMessage.includes('detached Frame')) {
      // Frame detachment errors (should be rare now with our retry logic)
      errorCode = 'DETACHED_FRAME';
    } else if (originalMessage.toLowerCase().includes('timeout')) {
      errorCode = 'TIMEOUT';
    } else if (originalMessage.toLowerCase().includes('navigation failed')) {
      // More generic navigation error
      errorCode = 'NAVIGATION_FAILED';
    } else if (pageError.name === 'TimeoutError') {
      // Puppeteer's own TimeoutError
      errorCode = 'PUPPETEER_TIMEOUT';
    } else if (originalMessage.includes('Protocol error')) {
      // Chrome DevTools protocol errors
      errorCode = 'PROTOCOL_ERROR';
    } else if (originalMessage.includes('Session closed')) {
      // Browser session closed unexpectedly
      errorCode = 'SESSION_CLOSED';
    }

    logger.error(`Error processing ${trimmedUrl}: ${originalMessage}`, {
      url: trimmedUrl,
      errorCode,
      originalStack: pageError.stack,
    });

    return {
      type: 'error',
      url: trimmedUrl,
      error: {
        code: errorCode,
        message: originalMessage,
        stack: pageError.stack,
      },
    };
  }
};
