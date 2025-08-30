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
} from '../config/app-config.js';
import { createAuthenticUserAgent } from './user-agent.js';
import { ProcessingPhase, detectErrorType } from './error-types.js';
import { createIdentityDetectionScript } from './identity-detection.js';
import { createFastPrebidConfigCaptureScript } from './prebid-config-capture.js';
import { createIdentityUsageDetectionScript } from './identity-usage-detector.js';
import { analyzeUnidentified } from './analyze-unidentified.js';

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
export async function configurePage(
  page: Page,
  logger?: WinstonLogger
): Promise<Page> {
  page.setDefaultTimeout(PUPPETEER_DEFAULT_PAGE_TIMEOUT);

  try {
    // Generate authentic user agent that matches Puppeteer's Chrome version
    const authenticUserAgent = await createAuthenticUserAgent(
      {
        platform: 'auto',
        usePuppeteerVersion: true,
      },
      logger
    );

    await page.setUserAgent(authenticUserAgent);
    logger?.debug(`Set authentic user agent: ${authenticUserAgent}`);
  } catch (error) {
    // Fallback to default user agent if dynamic generation fails
    logger?.warn('Failed to generate authentic user agent, using fallback', {
      error,
    });
    await page.setUserAgent(DEFAULT_USER_AGENT);
  }

  // Set realistic viewport size (common desktop resolution)
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
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
        '2': { name: 'Microsoft Edge PDF Plugin' },
      }),
    });

    // Override languages to be consistent with user agent
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Set realistic hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // Set realistic memory info
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // Override permissions API to avoid permission prompts
    if (navigator.permissions) {
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({
          query: () => Promise.resolve({ state: 'denied' }),
        }),
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
          requestPermission: () => Promise.resolve('denied'),
        },
      });
    }

    // Auto-dismiss geolocation requests
    if (navigator.geolocation) {
      Object.defineProperty(navigator, 'geolocation', {
        get: () => ({
          getCurrentPosition: () => {},
          watchPosition: () => {},
          clearWatch: () => {},
        }),
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
export async function dismissPopups(
  page: Page,
  logger?: WinstonLogger
): Promise<void> {
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
      '.close:has-text("×")',
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
            await new Promise((resolve) => setTimeout(resolve, 500));
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
      const timeout =
        attempt === 1 ? 60000 : Math.max(30000, 60000 - attempt * 10000);

      // Use domcontentloaded for initial navigation (faster)
      await page.goto(url, {
        timeout,
        waitUntil: 'domcontentloaded',
      });
      
      // Wait for document.readyState to be complete
      await page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: 10000 }
      ).catch(() => {});
      
      // Additional wait for lazy-loaded identity solutions and CDPs
      // Many identity providers and CDPs load after DOMContentLoaded
      await page.waitForFunction(
        () => {
          interface ExtendedWindow extends Window {
            // Identity solutions
            __uid2?: unknown;
            __uid2_advertising_token?: unknown;
            ID5?: unknown;
            __tcfapi?: unknown;
            __lotl?: unknown;
            lotamePanorama?: unknown;
            criteo_pubtag?: unknown;
            pubcid?: unknown;
            sharedId?: unknown;
            __liQ?: unknown; // LiveIntent
            // CDP platforms
            analytics?: { track?: Function };
            _satellite?: unknown; // Adobe
            utag?: unknown; // Tealium
            tealiumCDH?: unknown;
          }
          const win = window as ExtendedWindow;
          
          // Check if any common identity or CDP solutions are still loading
          const hasIdentity = win.__uid2 !== undefined || 
                            win.ID5 !== undefined || 
                            win.__tcfapi !== undefined ||
                            win.__lotl !== undefined ||
                            win.criteo_pubtag !== undefined ||
                            win.pubcid !== undefined ||
                            win.__liQ !== undefined;
          
          const hasCDP = win.analytics !== undefined ||
                        win._satellite !== undefined ||
                        win.utag !== undefined;
          
          // Wait until we find at least one, or document is complete
          return hasIdentity || hasCDP || document.readyState === 'complete';
        },
        { timeout: 3000 }
      ).catch(() => {});
      
      // Brief wait for final async operations
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      // Enhanced post-navigation checks
      await performPostNavigationChecks(page, url, logger);

      logger?.debug(
        `Successfully navigated to ${url} (final URL: ${page.url()})`
      );
      return; // Success!
    } catch (error) {
      lastError = error as Error;
      const detailedError = detectErrorType(
        lastError,
        ProcessingPhase.NAVIGATION,
        url,
        attempt
      );

      logger?.debug(`Navigation attempt ${attempt} failed for ${url}:`, {
        error: error,
        category: detailedError.category,
        subCategory: detailedError.subCategory,
        code: detailedError.code,
        metadata: detailedError.metadata,
      });

      // Enhanced error classification for smarter retries
      if (!shouldRetryNavigation(error as Error, attempt, maxRetries)) {
        // Attach detailed error info before throwing
        (error as any).detailedError = detailedError;
        throw error;
      }

      if (attempt <= maxRetries) {
        // Progressive backoff with jitter to avoid thundering herd
        const baseWait = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const waitTime = Math.min(baseWait + jitter, 8000);
        logger?.debug(`Waiting ${Math.round(waitTime)}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  // If we get here, all retries failed
  if (lastError) {
    // Ensure the last error has detailed error information
    if (!(lastError as any).detailedError) {
      (lastError as any).detailedError = detectErrorType(
        lastError,
        ProcessingPhase.NAVIGATION,
        url,
        maxRetries + 1
      );
    }
    throw lastError;
  } else {
    const finalError = new Error(
      `Failed to navigate to ${url} after ${maxRetries + 1} attempts`
    );
    (finalError as any).detailedError = detectErrorType(
      finalError,
      ProcessingPhase.NAVIGATION,
      url,
      maxRetries + 1
    );
    throw finalError;
  }
}

/**
 * Enhanced post-navigation validation and setup
 * @param page - The Puppeteer page instance
 * @param originalUrl - The original URL we attempted to navigate to
 * @param logger - Optional logger for debugging
 */
async function performPostNavigationChecks(
  page: Page,
  originalUrl: string,
  logger?: WinstonLogger
): Promise<void> {
  // Minimal stabilization wait since we already waited in navigation
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Dismiss popups that might interfere with content detection
  await dismissPopups(page, logger);

  // Only check for domain parking redirects, not page content
  const currentUrl = page.url();
  
  // Quick frame check before proceeding
  if (page.isClosed()) {
    throw new Error('Page was closed during navigation checks');
  }

  // Check for major redirects that might indicate issues
  const originalDomain = new URL(originalUrl).hostname;
  const currentDomain = new URL(currentUrl).hostname;

  if (originalDomain !== currentDomain) {
    logger?.debug(
      `Domain redirect detected: ${originalDomain} -> ${currentDomain}`
    );

    // Common problematic redirect patterns
    const problematicDomains = [
      'parking',
      'sedo.com',
      'godaddy.com',
      'namecheap.com',
    ];
    if (problematicDomains.some((domain) => currentDomain.includes(domain))) {
      const error = new Error(
        `Redirected to problematic domain: ${currentDomain}`
      );
      (error as any).detailedError = detectErrorType(
        error,
        ProcessingPhase.PAGE_LOAD,
        originalUrl
      );
      throw error;
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
function shouldRetryNavigation(
  error: Error,
  attempt: number,
  maxRetries: number
): boolean {
  const errorMessage = error.message.toLowerCase();

  // Never retry these permanent failures
  const permanentErrors = [
    'net::err_name_not_resolved',
    'net::err_cert_authority_invalid',
    'net::err_cert_common_name_invalid',
    'net::err_cert_date_invalid',
    'net::err_connection_refused',
  ];

  if (permanentErrors.some((permError) => errorMessage.includes(permError))) {
    return false;
  }

  // Retry timeouts and temporary failures
  const retryableErrors = [
    'timeout',
    'net::err_connection_timed_out',
    'net::err_connection_reset',
    'net::err_network_changed',
    'navigation failed',
    'target closed',
  ];

  const isRetryable = retryableErrors.some((retryError) =>
    errorMessage.includes(retryError)
  );
  return isRetryable && attempt <= maxRetries;
}

/**
 * Enhanced dynamic content triggering specifically optimized for ad tech detection
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
export async function triggerDynamicContent(
  page: Page,
  logger?: WinstonLogger
): Promise<void> {
  try {
    logger?.debug(
      'Triggering dynamic content loading optimized for ad tech...'
    );

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
async function simulateUserInteraction(
  page: Page,
  logger?: WinstonLogger
): Promise<void> {
  try {
    // Mouse movement to trigger hover events that might load ads
    await page.mouse.move(100, 100);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.mouse.move(500, 300);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Click on non-interactive areas to trigger focus events
    await page.evaluate(() => {
      // Trigger various events that ad networks listen for
      document.body.click();

      // Dispatch custom events that some ad techs use
      const events = ['DOMContentLoaded', 'load', 'scroll', 'resize'];
      events.forEach((eventType) => {
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
async function performSmartScrolling(
  page: Page,
  logger?: WinstonLogger
): Promise<void> {
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
          if (
            totalHeight >= scrollHeight - viewportHeight ||
            scrollCount >= maxScrolls
          ) {
            clearInterval(timer);

            // Scroll to key positions where ads commonly load
            const keyPositions = [
              0,
              scrollHeight * 0.25,
              scrollHeight * 0.5,
              scrollHeight * 0.75,
              0,
            ];
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
async function waitForAdTechInitialization(
  page: Page,
  logger?: WinstonLogger
): Promise<void> {
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
            () =>
              (window as any).googletag && (window as any).googletag.apiReady,
            // Amazon A9/UAM
            () => (window as any).apstag && (window as any).apstag.initialized,
            // Header bidding signals
            () => (window as any).pbjs && (window as any).pbjs.libLoaded,
            // General ad loading completion
            () =>
              document.querySelectorAll(
                '[id*="google_ads"], [id*="ad-"], .ad-container, .advertisement'
              ).length > 0,
          ];

          const hasSignal = signals.some((check) => {
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
          attributes: true,
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
  maxRetries: number = 2,
  discoveryMode: boolean = false,
  extractMetadata: boolean = false,
  adUnitDetail: 'basic' | 'standard' | 'full' = 'basic',
  moduleDetail: 'simple' | 'categorized' = 'simple',
  identityDetail: 'basic' | 'enhanced' = 'basic',
  prebidConfigDetail: 'none' | 'raw' | 'analyzed' = 'none',
  identityUsageDetail: 'none' | 'comprehensive' = 'none'
): Promise<any> {
  let lastError: Error | null = null;
  
  // Early frame check to fail fast
  if (page.isClosed()) {
    throw new Error('Page was closed before data extraction');
  }
  
  // Quick frame validity test
  try {
    await page.evaluate(() => document.readyState).catch((e) => {
      throw new Error(`Frame not accessible: ${e.message}`);
    });
  } catch (frameError) {
    logger?.info(`Frame check failed, skipping extraction`);
    throw frameError;
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logger?.debug(`Data extraction attempt ${attempt}`);

      // Import the constants we need
      const { PBJS_VERSION_WAIT_TIMEOUT_MS, PBJS_VERSION_WAIT_INTERVAL_MS } =
        await import('../config/app-config.js');

      const extractedPageData = await page.evaluate(
        async (pbjsTimeoutMs, pbjsIntervalMs, discoveryMode, extractMetadata, adUnitDetail, moduleDetail, identityDetail) => {
          // Define a type for the window object to avoid using 'any' repeatedly
          interface CustomWindow extends Window {
            apstag?: unknown; // Amazon Publisher Services UAM tag
            googletag?: unknown; // Google Publisher Tag
            ats?: unknown; // LiveRamp ATS.js
            _pbjsGlobals?: string[]; // Standard Prebid.js global variable names array
            // Additional ad tech libraries
            Criteo?: unknown; // Criteo
            IX?: unknown; // Index Exchange
            PubMatic?: unknown; // PubMatic
            openx?: unknown; // OpenX
            rubicon?: unknown; // Rubicon/Magnite
            sovrn?: unknown; // Sovrn
            triplelift?: unknown; // TripleLift
            smartadserver?: unknown; // Smart AdServer
            xandr?: unknown; // Xandr/AppNexus
            // Identity solutions
            __uid2?: unknown; // The Trade Desk UID 2.0
            __uid2_advertising_token?: string; // UID 2.0 token
            ID5?: unknown; // ID5 Universal ID
            parrable?: unknown; // Parrable ID
            // Customer Data Platforms
            tealiumCDH?: unknown; // Tealium
            analytics?: any; // Segment (often uses window.analytics)
            _satellite?: unknown; // Adobe Launch/DTM
            utag?: unknown; // Tealium Universal Tag
            // CMP-related properties
            __tcfapi?: Function; // TCF v2 API
            __cmp?: Function; // TCF v1 API (legacy)
            __uspapi?: Function; // CCPA/USP API
            OneTrust?: any; // OneTrust CMP
            OnetrustActiveGroups?: unknown; // OneTrust groups
            __qcCmpApi?: unknown; // Quantcast Choice
            quantcastChoice?: unknown; // Quantcast Choice alternative
            truste?: unknown; // TrustArc (legacy name)
            TrustArc?: unknown; // TrustArc
            Cookiebot?: any; // Cookiebot CMP
            Didomi?: any; // Didomi CMP
            didomiOnReady?: unknown; // Didomi ready callback
            UC?: unknown; // Usercentrics
            usercentrics?: unknown; // Usercentrics alternative
            _sp_?: unknown; // Sourcepoint
            _sp_queue?: unknown; // Sourcepoint queue
            Osano?: unknown; // Osano CMP
            [key: string]: any; // Index signature for dynamic access to Prebid instances (e.g., window['pbjs'])
          }

          const customWindow = window as CustomWindow;
          const data: any = {
            libraries: [],
            identitySolutions: [],
            cdpPlatforms: [],
            cmpInfo: {},
            unknownAdTech: [],
            date: new Date().toISOString().slice(0, 10),
            prebidInstances: [],
          };

          // Detect ad tech libraries with error handling
          try {
            // Core ad tech
            if (customWindow.apstag) data.libraries.push('apstag');
            if (customWindow.googletag) data.libraries.push('googletag');
            if (customWindow.ats) data.libraries.push('ats');

            // Additional ad tech libraries
            if (customWindow.Criteo) data.libraries.push('Criteo');
            if (customWindow.IX) data.libraries.push('IndexExchange');
            if (customWindow.PubMatic) data.libraries.push('PubMatic');
            if (customWindow.openx) data.libraries.push('OpenX');
            if (customWindow.rubicon) data.libraries.push('Rubicon');
            if (customWindow.sovrn) data.libraries.push('Sovrn');
            if (customWindow.triplelift) data.libraries.push('TripleLift');
            if (customWindow.smartadserver)
              data.libraries.push('SmartAdServer');
            if (customWindow.xandr) data.libraries.push('Xandr');

            // Identity solutions - Basic mode (default)
            if (identityDetail === 'basic') {
              // Basic detection - simple array of provider names
              if (customWindow.__uid2 || customWindow.__uid2_advertising_token)
                data.identitySolutions.push('UID2.0');
              if (customWindow.ID5) data.identitySolutions.push('ID5');
              if (customWindow.parrable) data.identitySolutions.push('Parrable');
              if (customWindow.__liQ) data.identitySolutions.push('LiveIntent');
              if (customWindow.__lotl || customWindow.lotamePanorama) data.identitySolutions.push('Lotame Panorama');
              if (customWindow.criteo_pubtag) data.identitySolutions.push('Criteo ID');
              if (customWindow.merkleId) data.identitySolutions.push('Merkle ID');
              if (customWindow.fabrickId) data.identitySolutions.push('Neustar Fabrick');
              if (customWindow.zeotapIdPlus) data.identitySolutions.push('Zeotap ID+');
              if (customWindow.quantcastId) data.identitySolutions.push('Quantcast ID');
              if (customWindow.sharedId) data.identitySolutions.push('SharedID');
              if (customWindow.pubcid) data.identitySolutions.push('PubCommon ID');
              if (customWindow.unifiedId) data.identitySolutions.push('The Trade Desk UnifiedID');
              if (customWindow.intentIqId) data.identitySolutions.push('IntentIQ');
              if (customWindow.hadronId) data.identitySolutions.push('Hadron ID');
              if (customWindow.connectId) data.identitySolutions.push('Yahoo ConnectID');
              if (customWindow.tapadId) data.identitySolutions.push('Tapad Graph');
              if (customWindow.idxId) data.identitySolutions.push('IDx');
              if (customWindow.britepoolId) data.identitySolutions.push('BritePool');
              if (customWindow.amxId) data.identitySolutions.push('AMX RTB');
              if (customWindow.admixerId) data.identitySolutions.push('AdMixer');
              if (customWindow.dmdId) data.identitySolutions.push('DMD ID');
              if (customWindow.kpuid) data.identitySolutions.push('Kinesso ID');
              if (customWindow.novatiq) data.identitySolutions.push('Novatiq Hyper ID');
              
              // Check cookies for additional identity solutions
              try {
                const cookies = document.cookie.split(';').map(c => c.trim());
                for (const cookie of cookies) {
                  const [name] = cookie.split('=');
                  const cookieName = name.trim();
                  
                  // Map cookie names to identity solutions (avoid duplicates)
                  if (cookieName.includes('uid2_advertising_token') && !data.identitySolutions.includes('UID2.0'))
                    data.identitySolutions.push('UID2.0');
                  if ((cookieName.includes('id5id') || cookieName === 'id5_consent') && !data.identitySolutions.includes('ID5'))
                    data.identitySolutions.push('ID5');
                  if ((cookieName === 'idex' || cookieName === 'tuuid' || cookieName === 'li_did') && !data.identitySolutions.includes('LiveIntent'))
                    data.identitySolutions.push('LiveIntent');
                  if ((cookieName === '_cc_id' || cookieName === 'panoramaId') && !data.identitySolutions.includes('Lotame Panorama'))
                    data.identitySolutions.push('Lotame Panorama');
                  if ((cookieName.includes('cto_bundle') || cookieName.includes('cto_idcpy')) && !data.identitySolutions.includes('Criteo ID'))
                    data.identitySolutions.push('Criteo ID');
                  if ((cookieName === 'sharedid' || cookieName === '_sharedid') && !data.identitySolutions.includes('SharedID'))
                    data.identitySolutions.push('SharedID');
                  if ((cookieName === '_pubcid' || cookieName === 'pubcid') && !data.identitySolutions.includes('PubCommon ID'))
                    data.identitySolutions.push('PubCommon ID');
                  if (cookieName === '__qca' && !data.identitySolutions.includes('Quantcast ID'))
                    data.identitySolutions.push('Quantcast ID');
                  if ((cookieName === '__uid' || cookieName === 'unified_id') && !data.identitySolutions.includes('The Trade Desk UnifiedID'))
                    data.identitySolutions.push('The Trade Desk UnifiedID');
                  if ((cookieName === 'intentIqId' || cookieName === 'iiq_id') && !data.identitySolutions.includes('IntentIQ'))
                    data.identitySolutions.push('IntentIQ');
                  if ((cookieName === '_parrable_id' || cookieName === 'tpc') && !data.identitySolutions.includes('Parrable'))
                    data.identitySolutions.push('Parrable');
                }
              } catch (e) {
                // Cookie access might be blocked
              }
            }

            // Customer Data Platforms
            if (customWindow.tealiumCDH || customWindow.utag)
              data.cdpPlatforms.push('Tealium');
            if (
              customWindow.analytics &&
              typeof customWindow.analytics.track === 'function'
            )
              data.cdpPlatforms.push('Segment');
            if (customWindow._satellite) data.cdpPlatforms.push('Adobe');

            // Consent Management Platforms (CMPs)
            try {
              // Helper to get TCF data synchronously with timeout
              const getTCFData = async () => {
                return new Promise((resolve) => {
                  const timeout = setTimeout(() => {
                    resolve(null);
                  }, 500); // 500ms timeout for TCF API

                  if (typeof customWindow.__tcfapi === 'function') {
                    try {
                      customWindow.__tcfapi('getTCData', 2, (tcData: any, success: boolean) => {
                        clearTimeout(timeout);
                        if (success && tcData) {
                          resolve({
                            tcfVersion: '2.x',
                            gdprApplies: tcData.gdprApplies,
                            consentString: tcData.tcString,
                            cmpId: tcData.cmpId,
                            version: tcData.cmpVersion ? String(tcData.cmpVersion) : undefined
                          });
                        } else {
                          resolve(null);
                        }
                      });
                    } catch {
                      clearTimeout(timeout);
                      resolve(null);
                    }
                  } else if (typeof customWindow.__cmp === 'function') {
                    clearTimeout(timeout);
                    // TCF v1 API (legacy)
                    resolve({ tcfVersion: '1.x' });
                  } else {
                    clearTimeout(timeout);
                    resolve(null);
                  }
                });
              };

              // Helper to get USP data synchronously
              const getUSPData = async () => {
                return new Promise((resolve) => {
                  if (typeof customWindow.__uspapi === 'function') {
                    try {
                      customWindow.__uspapi('getUSPData', 1, (uspData: any, success: boolean) => {
                        if (success && uspData) {
                          resolve({
                            ccpaApplies: true,
                            uspString: uspData.uspString
                          });
                        } else {
                          resolve(null);
                        }
                      });
                    } catch {
                      resolve(null);
                    }
                  } else {
                    resolve(null);
                  }
                });
              };

              // Get TCF/USP data
              const [tcfData, uspData] = await Promise.all([getTCFData(), getUSPData()]);
              
              if (tcfData) {
                Object.assign(data.cmpInfo, tcfData);
              }
              
              if (uspData) {
                Object.assign(data.cmpInfo, uspData);
              }

              // OneTrust detection
              if (customWindow.OneTrust || customWindow.OnetrustActiveGroups) {
                data.cmpInfo.name = 'OneTrust';
                if (customWindow.OneTrust && customWindow.OneTrust.getGeolocationData) {
                  try {
                    const geoData = customWindow.OneTrust.getGeolocationData();
                    if (geoData && geoData.country) {
                      data.cmpInfo.gdprApplies = ['EU', 'UK', 'GB'].includes(geoData.country);
                    }
                  } catch {}
                }
              }

              // Quantcast Choice detection
              if (customWindow.__qcCmpApi || customWindow.quantcastChoice) {
                data.cmpInfo.name = 'Quantcast Choice';
              }

              // TrustArc detection  
              if (customWindow.truste || customWindow.TrustArc) {
                data.cmpInfo.name = 'TrustArc';
              }

              // Cookiebot detection
              if (customWindow.Cookiebot) {
                data.cmpInfo.name = 'Cookiebot';
                if (customWindow.Cookiebot.consent) {
                  data.cmpInfo.consentString = customWindow.Cookiebot.consent.stamp;
                }
              }

              // Didomi detection
              if (customWindow.Didomi || customWindow.didomiOnReady) {
                data.cmpInfo.name = 'Didomi';
                if (customWindow.Didomi && customWindow.Didomi.getUserStatus) {
                  try {
                    const userStatus = customWindow.Didomi.getUserStatus();
                    if (userStatus) {
                      data.cmpInfo.consentString = userStatus.consent_string;
                    }
                  } catch {}
                }
              }

              // Usercentrics detection
              if (customWindow.UC || customWindow.usercentrics) {
                data.cmpInfo.name = 'Usercentrics';
              }

              // Sourcepoint detection
              if (customWindow._sp_ || customWindow._sp_queue) {
                data.cmpInfo.name = 'Sourcepoint';
              }

              // Osano detection
              if (customWindow.Osano) {
                data.cmpInfo.name = 'Osano';
              }

              // Keep cmpInfo as empty object if no CMP detected (consistent with other fields)
              // This ensures the field is always present in the output
            } catch (cmpError) {
              // Ignore CMP detection errors, keep empty object
              data.cmpInfo = {};
            }

            // Discovery mode: Find potential unknown ad tech (only if enabled)
            if (discoveryMode) {
              const adTechPatterns = [
                'bid',
                'ad',
                'ssp',
                'dsp',
                'rtb',
                'programmatic',
                'auction',
                'impression',
              ];
              const knownVars = [
                'apstag',
                'googletag',
                'ats',
                'Criteo',
                'IX',
                'PubMatic',
                'openx',
                'rubicon',
                'sovrn',
                'triplelift',
                'smartadserver',
                'xandr',
                '__uid2',
                'ID5',
                'parrable',
              ];

              for (const key in customWindow) {
                if (knownVars.includes(key) || key.startsWith('_pbjs'))
                  continue;

                const keyLower = key.toLowerCase();
                if (
                  adTechPatterns.some((pattern) => keyLower.includes(pattern))
                ) {
                  try {
                    const value = customWindow[key];
                    if (
                      value &&
                      typeof value === 'object' &&
                      !Array.isArray(value) &&
                      !(value instanceof Element)
                    ) {
                      data.unknownAdTech.push({
                        variable: key,
                        hasVersion: 'version' in value,
                        hasFunctions: Object.keys(value).some(
                          (k) => typeof value[k] === 'function'
                        ),
                        properties: Object.keys(value).slice(0, 5), // First 5 properties for analysis
                      });
                    }
                  } catch (e) {
                    // Skip if we can't access the property
                  }
                }
              }
            }
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
                  const isFullyLoaded =
                    pbjsInstance.libLoaded === true ||
                    typeof pbjsInstance.requestBids === 'function' ||
                    typeof pbjsInstance.addAdUnits === 'function';

                  if (isFullyLoaded) {
                    // Get all modules
                    const allModules = pbjsInstance.installedModules.map(String);
                    
                    if (moduleDetail === 'categorized') {
                      // Categorize modules when requested
                      const userIdModules: string[] = [];
                      const analyticsModules: string[] = [];
                      const bidderModules: string[] = [];
                      const rtdModules: string[] = [];
                      const videoModules: string[] = [];
                      const consentModules: string[] = [];
                      const remainingModules: string[] = [];
                      
                      // Pattern definitions
                      const userIdPatterns = [
                        'IdSystem', 'userId', 'uid2', 'identity', 'sharedId', 'unifiedId', 'id5',
                        'parrableId', 'criteoId', 'lotamePanorama', 'liveIntent', 'merkle', 
                        'zeotap', 'quantcast', 'pubProvided', 'admixer', 'amx', 'britepoolId',
                        'dmdId', 'hadronId', 'idx', 'intentIq', 'justId', 'kinessoId', 
                        'mwOpenLink', 'netId', 'novatiq', 'oneKey', 'pairId', 'pubCommonId',
                        'tapadId', 'trustpid', 'uid2', 'utiq', 'verizonMedia', 'zeotapIdPlus'
                      ];
                      
                      const analyticsPatterns = ['AnalyticsAdapter', 'Analytics', 'analytics'];
                      const bidderPatterns = ['BidAdapter', 'Adapter'];
                      const rtdPatterns = ['RtdProvider', 'RtdModule', 'rtdModule'];
                      const isRtdCoreModule = (module: string) => module === 'rtdModule';
                      
                      const videoPatterns = [
                        'Video', 'video', 'adpod', 'adPod', 'instream', 'outstream',
                        'vast', 'vpaid', 'ima'
                      ];
                      
                      const consentPatterns = [
                        'consentManagement', 'consentManagementGpp', 'consentManagementUsp',
                        'consentManagementTcf', 'gdprEnforcement', 'gppControl', 'tcfControl',
                        'ccpaControl', 'privacyControl', 'usPrivacy', 'consent', 'gdpr', 'ccpa', 'gpp'
                      ];
                      
                      // Categorize each module
                      allModules.forEach((module: string) => {
                        const moduleLower = module.toLowerCase();
                        
                        if (userIdPatterns.some(pattern => moduleLower.includes(pattern.toLowerCase()))) {
                          userIdModules.push(module);
                        }
                        else if (analyticsPatterns.some(pattern => moduleLower.includes(pattern.toLowerCase()))) {
                          analyticsModules.push(module);
                        }
                        else if (!isRtdCoreModule(module) && rtdPatterns.some(pattern => module.includes(pattern))) {
                          rtdModules.push(module);
                        }
                        else if (videoPatterns.some(pattern => moduleLower.includes(pattern.toLowerCase()))) {
                          videoModules.push(module);
                        }
                        else if (consentPatterns.some(pattern => moduleLower.includes(pattern.toLowerCase()))) {
                          consentModules.push(module);
                        }
                        else if (bidderPatterns.some(pattern => module.includes(pattern))) {
                          bidderModules.push(module);
                        }
                        else {
                          remainingModules.push(module);
                        }
                      });
                      
                      // Get active bidders for categorized mode
                      const activeBidders = pbjsInstance.getBidderCodes?.() ||
                        pbjsInstance.adUnits?.flatMap((au: any) =>
                          au.bids?.map((bid: any) => bid.bidder)
                        ).filter((bidder: string, index: number, arr: string[]) =>
                          bidder && arr.indexOf(bidder) === index
                        ) || [];
                      
                      // Find inactive bid adapters
                      const inactiveBidAdapters: string[] = [];
                      if (bidderModules.length > 0 && activeBidders.length > 0) {
                        const bidderToAdapterMap: Record<string, string> = {
                          'yahooAds': 'yahoosspBidAdapter',
                          'yahooPrebidServer': 'prebidServerBidAdapter',
                          'ayPrebidServer': 'prebidServerBidAdapter',
                        };
                        
                        bidderModules.forEach((adapterModule: string) => {
                          const bidderName = adapterModule.replace(/BidAdapter$/, '');
                          const isActive = activeBidders.some((activeBidder: string) => {
                            if (activeBidder === bidderName) return true;
                            if (bidderToAdapterMap[activeBidder] === adapterModule) return true;
                            if (activeBidder.toLowerCase() === bidderName.toLowerCase()) return true;
                            if (adapterModule === 'prebidServerBidAdapter' && 
                                (activeBidder.includes('PrebidServer') || activeBidder.includes('prebidServer'))) {
                              return true;
                            }
                            return false;
                          });
                          
                          if (!isActive) {
                            inactiveBidAdapters.push(adapterModule);
                          }
                        });
                      }
                      
                      return {
                        globalVarName: globalVarName,
                        version: pbjsInstance.version,
                        timeout: pbjsInstance.getConfig?.()?.bidderTimeout,
                        adUnits: pbjsInstance.adUnits?.length || 0,
                        adUnitTypes: adUnitDetail === 'basic' ? (pbjsInstance.adUnits || [])
                          .reduce((types: string[], au: any) => {
                            if (au.mediaTypes) {
                              if (au.mediaTypes.banner && !types.includes('banner')) types.push('banner');
                              if (au.mediaTypes.video && !types.includes('video')) types.push('video');
                              if (au.mediaTypes.native && !types.includes('native')) types.push('native');
                            }
                            return types;
                          }, []) : undefined,
                        bidders: activeBidders,
                        inactiveBidAdapters: inactiveBidAdapters.length > 0 ? inactiveBidAdapters : undefined,
                        userIds: userIdModules.length > 0 ? userIdModules : undefined,
                        analyticsAdapters: analyticsModules.length > 0 ? analyticsModules : undefined,
                        rtdModules: rtdModules.length > 0 ? rtdModules : undefined,
                        videoModules: videoModules.length > 0 ? videoModules : undefined,
                        consentModules: consentModules.length > 0 ? consentModules : undefined,
                        modules: remainingModules.length > 0 ? remainingModules : undefined,
                        _initState: 'complete',
                      };
                    } else {
                      // Simple mode - return all modules in one array
                      return {
                        globalVarName: globalVarName,
                        version: pbjsInstance.version,
                        modules: allModules,
                        _initState: 'complete',
                      };
                    }
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
                    _initState: 'partial', // Temporary marker for tool metadata
                  };
                }

                // Stage 3: Check for Prebid command queue (pre-initialization)
                if (Array.isArray(pbjsInstance) && pbjsInstance.length > 0) {
                  lastPartialInstance = {
                    globalVarName: globalVarName,
                    version: 'queue-detected',
                    modules: [],
                    _initState: 'queue', // Temporary marker for tool metadata
                  };
                }
              } catch (e) {
                // Continue polling on errors - might be frame attachment issues
              }

              // Use shorter intervals initially, then longer ones
              const interval =
                elapsedTime < pbjsTimeoutMs / 3
                  ? pbjsIntervalMs
                  : pbjsIntervalMs * 2;
              await new Promise((resolve) => setTimeout(resolve, interval));
              elapsedTime += interval;
            }

            // Return partial instance if we found one but couldn't get complete data
            return lastPartialInstance;
          };

          // Check for Prebid.js instances if _pbjsGlobals array exists
          const prebidInitStates: Record<string, 'complete' | 'partial' | 'queue'> = {};
          
          try {
            if (
              customWindow._pbjsGlobals &&
              Array.isArray(customWindow._pbjsGlobals)
            ) {
              for (const globalVarName of customWindow._pbjsGlobals) {
                try {
                  const instanceData = await getPbjsInstanceData(globalVarName);
                  if (instanceData) {
                    // Extract the initialization state from the temporary marker
                    const initState = (instanceData as any)._initState;
                    if (initState) {
                      prebidInitStates[globalVarName] = initState;
                      // Remove the temporary marker before adding to prebidInstances
                      delete (instanceData as any)._initState;
                    }
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

          // Add toolMetadata if we have any prebid initialization states
          if (Object.keys(prebidInitStates).length > 0) {
            data.toolMetadata = {
              prebidInitStates: prebidInitStates
            };
          }

          return data;
        },
        PBJS_VERSION_WAIT_TIMEOUT_MS,
        PBJS_VERSION_WAIT_INTERVAL_MS,
        discoveryMode,
        extractMetadata,
        adUnitDetail,
        moduleDetail,
        identityDetail
      );

      logger?.debug(`Data extraction attempt ${attempt} succeeded`);
      
      // If enhanced identity detection is enabled, run the comprehensive detection
      if (identityDetail === 'enhanced') {
        try {
          const identityDetectionScript = createIdentityDetectionScript();
          const enhancedIdentityResult: any = await page.evaluate(identityDetectionScript);
          
          if (enhancedIdentityResult && enhancedIdentityResult.providers) {
            extractedPageData.identityProviders = enhancedIdentityResult;
            // Also populate the basic array for backward compatibility
            extractedPageData.identitySolutions = enhancedIdentityResult.providers.map((p: any) => p.name);
          }
        } catch (error) {
          logger?.debug('Enhanced identity detection failed:', error);
        }
      }
      
      // Handle Prebid config capture based on flag
      if (prebidConfigDetail !== 'none' && extractedPageData.prebidInstances && extractedPageData.prebidInstances.length > 0) {
        try {
          // Extract global variable names from prebidInstances
          const globalNames = extractedPageData.prebidInstances.map((instance: any) => instance.globalVarName).filter(Boolean);
          
          logger?.info(`🔍 TRACE [PREBID_CONFIG] Starting capture with known globals: ${globalNames.join(', ')}`);
          
          // Test basic string evaluation first
          const testEval = await page.evaluate('(function() { return "test-success"; })()');
          logger?.info(`🔍 TRACE [PREBID_CONFIG] Test eval result: ${testEval}`);
          
          // Use minimal fast script for better performance
        const prebidConfigScript = createFastPrebidConfigCaptureScript(globalNames);
          logger?.info(`🔍 TRACE [PREBID_CONFIG] Script generated, length: ${prebidConfigScript.length} chars`);
          
          // Log first 200 chars of script to verify it's correct
          logger?.debug(`🔍 TRACE [PREBID_CONFIG] Script preview: ${prebidConfigScript.substring(0, 200)}...`);
          
          // Execute the IIFE directly - Puppeteer evaluates strings as JavaScript
          let prebidConfigResult: any;
          try {
            prebidConfigResult = await page.evaluate(prebidConfigScript);
          } catch (evalError) {
            logger?.error(`🔍 TRACE [PREBID_CONFIG] ❌ Evaluation error:`, evalError);
            throw evalError;
          }
          
          // Debug logging with telemetry
          if (!prebidConfigResult) {
            logger?.warn('🔍 TRACE [PREBID_CONFIG] ❌ Capture returned null/undefined');
          } else {
            logger?.info(`🔍 TRACE [PREBID_CONFIG] ✅ Capture returned result:`, {
              status: prebidConfigResult.configStatus,
              source: prebidConfigResult.configSource || 'none',
              hasConfig: !!prebidConfigResult.config,
              diagnostics: prebidConfigResult.diagnostics ? {
                prebidFound: prebidConfigResult.diagnostics.prebidFound,
                prebidState: prebidConfigResult.diagnostics.prebidState,
                triedMethods: prebidConfigResult.diagnostics.triedMethods?.length || 0
              } : null
            });
          }
          
          if (prebidConfigResult) {
            // Store the entire result including config, source, and diagnostics
            if (prebidConfigResult.configStatus === 'found' || prebidConfigResult.configStatus === 'partial') {
              extractedPageData.prebidConfig = {
                config: prebidConfigResult.config,
                configSource: prebidConfigResult.configSource,
                configStatus: prebidConfigResult.configStatus
              };
            } else if (prebidConfigResult.configStatus === 'detected-not-extracted') {
              // Config was detected but couldn't be extracted
              extractedPageData.prebidConfig = {
                config: null,
                configSource: prebidConfigResult.configSource,
                configStatus: prebidConfigResult.configStatus,
                note: 'Config detected in inline scripts but could not be safely extracted'
              };
            } else {
              // No config found - include diagnostics for debugging
              extractedPageData.prebidConfig = {
                config: null,
                configStatus: 'not-found',
                diagnostics: prebidConfigResult.diagnostics
              };
              logger?.debug(`Prebid config not found. Diagnostics: ${JSON.stringify(prebidConfigResult.diagnostics)}`);
            }
          }
        } catch (error) {
          logger?.debug('Prebid config capture failed:', error);
        }
      }
      
      // Handle identity usage capture separately
      if (identityUsageDetail === 'comprehensive') {
        try {
          const identityUsageScript = createIdentityUsageDetectionScript();
          const identityUsageResult: any = await page.evaluate(identityUsageScript);
          
          if (identityUsageResult && !identityUsageResult.error) {
            // Add analysis of unidentified storage items if any exist
            if (identityUsageResult.correlatedStorage?.unidentified?.length > 0) {
              const unidentifiedAnalysis = analyzeUnidentified(
                identityUsageResult.correlatedStorage.unidentified
              );
              identityUsageResult.correlatedStorage.unidentifiedAnalysis = unidentifiedAnalysis;
            }
            extractedPageData.identityUsage = identityUsageResult;
          }
        } catch (error) {
          logger?.debug('Identity usage detection failed:', error);
        }
      }
      
      return extractedPageData;
    } catch (error) {
      lastError = error as Error;
      const detailedError = detectErrorType(
        lastError,
        ProcessingPhase.DATA_EXTRACTION,
        page.url(),
        attempt
      );

      logger?.debug(`Data extraction attempt ${attempt} failed:`, {
        error: error,
        category: detailedError.category,
        subCategory: detailedError.subCategory,
        code: detailedError.code,
        metadata: detailedError.metadata,
      });

      // Check if this is a detached frame error - don't retry these
      if (error instanceof Error && 
          (error.message.includes('detached Frame') || 
           error.message.includes('frame was detached') ||
           error.message.includes('Navigating frame'))) {
        logger?.info(`Frame detached during data extraction - not retrying`);
        // Don't retry frame errors - they indicate the page is problematic
        (error as any).detailedError = detailedError;
        throw error;
      } else {
        // For other errors, don't retry either
        (error as any).detailedError = detailedError;
        throw error;
      }
    }
  }

  // If we get here, all retries failed
  if (lastError) {
    if (!(lastError as any).detailedError) {
      (lastError as any).detailedError = detectErrorType(
        lastError,
        ProcessingPhase.DATA_EXTRACTION,
        page.url(),
        maxRetries + 1
      );
    }
    throw lastError;
  } else {
    const finalError = new Error('Data extraction failed after all retries');
    (finalError as any).detailedError = detectErrorType(
      finalError,
      ProcessingPhase.DATA_EXTRACTION,
      page.url(),
      maxRetries + 1
    );
    throw finalError;
  }
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
  data: { url, logger, discoveryMode = false, extractMetadata = false, adUnitDetail = 'basic', moduleDetail = 'simple', identityDetail = 'basic', prebidConfigDetail = 'none', identityUsageDetail = 'none' },
}: {
  page: Page;
  data: { 
    url: string; 
    logger: WinstonLogger; 
    discoveryMode?: boolean;
    extractMetadata?: boolean;
    adUnitDetail?: 'basic' | 'standard' | 'full';
    moduleDetail?: 'simple' | 'categorized';
    identityDetail?: 'basic' | 'enhanced';
    prebidConfigDetail?: 'none' | 'raw' | 'analyzed';
    identityUsageDetail?: 'none' | 'comprehensive';
  };
}): Promise<TaskResult> => {
  const trimmedUrl: string = url.trim(); // Ensure URL is trimmed before processing
  logger.info(`Attempting to process URL: ${trimmedUrl}`);
  
  // DEBUG: Alert if Amazon is being processed
  if (trimmedUrl.toLowerCase().includes('amazon.com') && !trimmedUrl.toLowerCase().includes('amazonappservices')) {
    logger.error(`🚨 DEBUG: AMAZON.COM DETECTED! This should not happen with range 146001+`);
    logger.error(`Stack trace:`, new Error().stack);
  }
  try {
    await configurePage(page, logger); // Use the configurePage from this module

    // Use enhanced navigation with retry logic
    await navigateWithRetry(page, trimmedUrl, logger);

    // Trigger dynamic content loading (lazy loading, etc.)
    await triggerDynamicContent(page, logger);

    // Wait for DOM to stabilize and identity solutions to load
    await waitForDOMStability(page, logger, 3000);
    
    // Wait for consent management and identity solutions to initialize
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let consentReady = false;
        
        // Check for standard consent APIs
        setTimeout(() => {
          // TCF v2 API (GDPR) - industry standard
          if (typeof (window as any).__tcfapi === 'function') {
            (window as any).__tcfapi('addEventListener', 2, (tcData: any, success: boolean) => {
              if (success && (tcData.eventStatus === 'tcloaded' || tcData.eventStatus === 'useractioncomplete')) {
                consentReady = true;
                setTimeout(resolve, 500); // Allow time for consent-dependent operations
              }
            });
            // Timeout if consent doesn't load
            setTimeout(() => { if (!consentReady) resolve(undefined); }, 2000);
          } 
          // USP API (CCPA) - industry standard
          else if (typeof (window as any).__uspapi === 'function') {
            (window as any).__uspapi('getUSPData', 1, () => {
              setTimeout(resolve, 500);
            });
            setTimeout(resolve, 1500); // Fallback timeout
          }
          // GPP API (Global Privacy Platform) - newer standard
          else if (typeof (window as any).__gpp === 'function') {
            setTimeout(resolve, 1000);
          }
          // No consent API detected, proceed after brief wait
          else {
            setTimeout(resolve, 1000);
          }
        }, 500);
      });
    }).catch(() => {});

    // Use frame-safe data extraction with retry logic for detached frame errors
    const extractedPageData: PageData = (await extractDataSafely(
      page,
      logger,
      2,
      discoveryMode,
      extractMetadata,
      adUnitDetail,
      moduleDetail,
      identityDetail,
      prebidConfigDetail,
      identityUsageDetail
    )) as PageData;

    extractedPageData.url = trimmedUrl; // Assign the processed URL to the extracted data

    // Handle Prebid config capture based on flag
    if (prebidConfigDetail !== 'none' && extractedPageData.prebidInstances && extractedPageData.prebidInstances.length > 0) {
      try {
        // Extract global variable names from prebidInstances
        const globalNames = extractedPageData.prebidInstances.map((instance: any) => instance.globalVarName).filter(Boolean);
        
        logger.info(`🔍 TRACE [PREBID_CONFIG] Starting capture in processPageTask for ${trimmedUrl} with globals: ${globalNames.join(', ')}`);
        
        // Test basic string evaluation first
        const testEval = await page.evaluate('(function() { return "test-success"; })()');
        logger.info(`🔍 TRACE [PREBID_CONFIG] Test eval result in processPageTask: ${testEval}`);
        
        // Use minimal fast script for better performance
        const prebidConfigScript = createFastPrebidConfigCaptureScript(globalNames);
        logger.info(`🔍 TRACE [PREBID_CONFIG] Script generated in processPageTask, length: ${prebidConfigScript.length} chars`);
        
        // Execute the IIFE directly - Puppeteer evaluates strings as JavaScript
        let prebidConfigResult: any;
        try {
          prebidConfigResult = await page.evaluate(prebidConfigScript);
        } catch (evalError) {
          logger.error(`🔍 TRACE [PREBID_CONFIG] ❌ Evaluation error in processPageTask:`, evalError);
          throw evalError;
        }
        
        // Debug logging with telemetry
        if (!prebidConfigResult) {
          logger.warn('🔍 TRACE [PREBID_CONFIG] ❌ Capture returned null/undefined in processPageTask');
        } else {
          logger.info(`🔍 TRACE [PREBID_CONFIG] ✅ Capture in processPageTask returned:`, {
            status: prebidConfigResult.configStatus,
            source: prebidConfigResult.configSource || 'none',
            hasConfig: !!prebidConfigResult.config,
            diagnostics: prebidConfigResult.diagnostics ? {
              prebidFound: prebidConfigResult.diagnostics.prebidFound,
              prebidState: prebidConfigResult.diagnostics.prebidState,
              triedMethods: prebidConfigResult.diagnostics.triedMethods?.length || 0
            } : null
          });
        }
        
        if (prebidConfigResult) {
          // Store the entire result including config, source, and diagnostics
          if (prebidConfigResult.configStatus === 'found' || prebidConfigResult.configStatus === 'partial') {
            extractedPageData.prebidConfig = {
              config: prebidConfigResult.config,
              configSource: prebidConfigResult.configSource,
              configStatus: prebidConfigResult.configStatus
            };
          } else if (prebidConfigResult.configStatus === 'detected-not-extracted') {
            // Config was detected but couldn't be extracted
            extractedPageData.prebidConfig = {
              config: null,
              configSource: prebidConfigResult.configSource,
              configStatus: prebidConfigResult.configStatus,
              note: 'Config detected in inline scripts but could not be safely extracted'
            };
          } else {
            // No config found - include diagnostics for debugging
            extractedPageData.prebidConfig = {
              config: null,
              configStatus: 'not-found',
              diagnostics: prebidConfigResult.diagnostics
            };
            logger.debug(`Prebid config not found. Diagnostics: ${JSON.stringify(prebidConfigResult.diagnostics)}`);
          }
        }
      } catch (error) {
        logger.debug('Prebid config capture failed (processPageTask):', error);
      }
    }
    
    // Handle identity usage capture separately
    if (identityUsageDetail === 'comprehensive') {
      try {
        const identityUsageScript = createIdentityUsageDetectionScript();
        const identityUsageResult: any = await page.evaluate(identityUsageScript);
        
        if (identityUsageResult && !identityUsageResult.error) {
          // Add analysis of unidentified storage items if any exist
          if (identityUsageResult.correlatedStorage?.unidentified?.length > 0) {
            const unidentifiedAnalysis = analyzeUnidentified(
              identityUsageResult.correlatedStorage.unidentified
            );
            identityUsageResult.correlatedStorage.unidentifiedAnalysis = unidentifiedAnalysis;
          }
          extractedPageData.identityUsage = identityUsageResult;
        }
      } catch (error) {
        logger?.debug('Identity usage detection failed:', error);
      }
    }

    // Determine if meaningful data was extracted
    const hasLibraries =
      extractedPageData.libraries && extractedPageData.libraries.length > 0;
    const hasPrebidInstances =
      extractedPageData.prebidInstances &&
      extractedPageData.prebidInstances.length > 0;

    if (hasLibraries || hasPrebidInstances) {
      // Log success with more detail
      const libraryCount = extractedPageData.libraries?.length || 0;
      const prebidCount = extractedPageData.prebidInstances?.length || 0;
      const identityCount = extractedPageData.identitySolutions?.length || 0;
      const cdpCount = extractedPageData.cdpPlatforms?.length || 0;
      const hasCMP = extractedPageData.cmpInfo ? 1 : 0;

      // Enhanced logging if using enhanced identity detection
      const logData: any = {
        libraries: libraryCount,
        prebidInstances: prebidCount,
        identitySolutions: identityCount,
        cdpPlatforms: cdpCount,
        cmp: hasCMP,
        cmpName: extractedPageData.cmpInfo?.name,
        firstPrebidVersion: extractedPageData.prebidInstances?.[0]?.version,
      };
      
      if (extractedPageData.identityProviders) {
        logData.identityBreakdown = {
          total: extractedPageData.identityProviders.summary.totalProviders,
          firstParty: extractedPageData.identityProviders.summary.firstPartyCount,
          thirdParty: extractedPageData.identityProviders.summary.thirdPartyCount,
          deterministic: extractedPageData.identityProviders.summary.deterministicCount,
          probabilistic: extractedPageData.identityProviders.summary.probabilisticCount,
        };
      }

      logger.info(`✅ Successfully extracted ad tech data from ${trimmedUrl}`, logData);
      return { type: 'success', data: extractedPageData };
    } else {
      logger.warn(
        `⚠️ No relevant ad library or Prebid.js data found on ${trimmedUrl}`
      );
      return { type: 'no_data', url: trimmedUrl };
    }
  } catch (e: unknown) {
    const pageError = e as Error;

    // Use new detailed error detection system
    const detailedError = detectErrorType(
      pageError,
      ProcessingPhase.DATA_EXTRACTION,
      trimmedUrl
    );

    logger.error(`Error processing ${trimmedUrl}: ${detailedError.message}`, {
      url: trimmedUrl,
      category: detailedError.category,
      subCategory: detailedError.subCategory,
      phase: detailedError.phase,
      errorCode: detailedError.code,
      metadata: detailedError.metadata,
      originalStack: pageError.stack,
    });

    return {
      type: 'error',
      url: trimmedUrl,
      error: {
        code: detailedError.code,
        message: detailedError.message,
        stack: pageError.stack,
        detailedError,
      },
    };
  }
};
