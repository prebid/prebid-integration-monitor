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
      
      // Use a longer timeout for the first attempt, shorter for retries
      const timeout = attempt === 1 ? 60000 : 30000;
      
      await page.goto(url, { 
        timeout, 
        waitUntil: 'networkidle2' 
      });
      
      // Wait a moment for any immediate popups/redirects
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Attempt to dismiss any popups
      await dismissPopups(page, logger);
      
      // Check if we got redirected to an error page or parking page
      const currentUrl = page.url();
      const pageTitle = await page.title().catch(() => '');
      
      if (currentUrl.includes('parked-content') || 
          pageTitle.toLowerCase().includes('domain parked') ||
          pageTitle.toLowerCase().includes('this domain may be for sale')) {
        throw new Error('Page appears to be parked or unavailable');
      }
      
      logger?.debug(`Successfully navigated to ${url} (final URL: ${currentUrl})`);
      return; // Success!
      
    } catch (error) {
      lastError = error as Error;
      logger?.debug(`Navigation attempt ${attempt} failed for ${url}:`, error);
      
      // Don't retry certain types of errors
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('net::err_name_not_resolved') ||
            errorMessage.includes('net::err_cert_authority_invalid') ||
            errorMessage.includes('net::err_cert_common_name_invalid')) {
          // DNS or certificate errors are unlikely to be resolved by retrying
          throw error;
        }
      }
      
      if (attempt <= maxRetries) {
        // Wait before retry, with exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        logger?.debug(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error(`Failed to navigate to ${url} after ${maxRetries + 1} attempts`);
}

/**
 * Scrolls the page to trigger lazy-loaded content and dynamic elements
 * @param page - The Puppeteer page instance
 * @param logger - Optional logger for debugging
 */
export async function triggerDynamicContent(page: Page, logger?: WinstonLogger): Promise<void> {
  try {
    logger?.debug('Triggering dynamic content loading...');
    
    // Scroll down to trigger lazy loading
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            // Scroll back to top
            window.scrollTo(0, 0);
            resolve();
          }
        }, 50);
      });
    });
    
    // Wait for any content that was triggered by scrolling
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger?.debug('Dynamic content loading completed');
  } catch (error) {
    logger?.debug('Error during dynamic content loading:', error);
    // Don't throw - this is best effort
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

    // Define a type for the window object to avoid using 'any' repeatedly
    interface CustomWindow extends Window {
      apstag?: unknown; // Amazon Publisher Services UAM tag
      googletag?: unknown; // Google Publisher Tag
      ats?: unknown; // LiveRamp ATS.js
      _pbjsGlobals?: string[]; // Standard Prebid.js global variable names array
      [key: string]: any; // Index signature for dynamic access to Prebid instances (e.g., window['pbjs'])
    }

    const extractedPageData: PageData = await page.evaluate(
      // Parameters pbjsTimeoutMs and pbjsIntervalMs are passed from the outer scope
      async (pbjsTimeoutMs, pbjsIntervalMs): Promise<PageData> => {
        const customWindow = window as CustomWindow; // Cast to our extended window type
        const data: Partial<PageData> = {
          libraries: [],
          date: new Date().toISOString().slice(0, 10),
          prebidInstances: [],
        };

        // Detect other libraries
        if (customWindow.apstag) data.libraries!.push('apstag');
        if (customWindow.googletag) data.libraries!.push('googletag');
        if (customWindow.ats) data.libraries!.push('ats');

        // Polling function for a single Prebid global variable
        const getPbjsInstanceData = async (globalVarName: string) => {
          let elapsedTime = 0;
          // Poll for the Prebid.js instance until timeout or found
          while (elapsedTime < pbjsTimeoutMs) {
            // Use passed-in pbjsTimeoutMs
            const pbjsInstance = customWindow[globalVarName];
            // Check if Prebid.js instance and its properties are valid
            if (
              pbjsInstance &&
              typeof pbjsInstance.version === 'string' &&
              pbjsInstance.version.length > 0 && // Ensure version is not an empty string
              Array.isArray(pbjsInstance.installedModules)
            ) {
              return {
                globalVarName: globalVarName,
                version: pbjsInstance.version,
                modules: pbjsInstance.installedModules.map(String), // Ensure modules are strings
              };
            }
            // Wait for the defined interval before checking again
            await new Promise((resolve) => setTimeout(resolve, pbjsIntervalMs)); // Use passed-in pbjsIntervalMs
            elapsedTime += pbjsIntervalMs; // Increment elapsed time
          }
          return null; // Timeout or instance not found/valid
        };

        // Check for Prebid.js instances if _pbjsGlobals array exists
        if (
          customWindow._pbjsGlobals &&
          Array.isArray(customWindow._pbjsGlobals)
        ) {
          for (const globalVarName of customWindow._pbjsGlobals) {
            const instanceData = await getPbjsInstanceData(globalVarName);
            if (instanceData) {
              data.prebidInstances!.push(instanceData);
            }
          }
        }
        // Cast to PageData. This assumes that if prebidInstances is populated, it will be correctly structured.
        return data as PageData;
      },
      PBJS_VERSION_WAIT_TIMEOUT_MS, // Pass the constant from app-config
      PBJS_VERSION_WAIT_INTERVAL_MS // Pass the constant from app-config
    );

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
    } else if (originalMessage.toLowerCase().includes('timeout')) {
      errorCode = 'TIMEOUT';
    } else if (originalMessage.toLowerCase().includes('navigation failed')) {
      // More generic navigation error
      errorCode = 'NAVIGATION_FAILED';
    } else if (pageError.name === 'TimeoutError') {
      // Puppeteer's own TimeoutError
      errorCode = 'PUPPETEER_TIMEOUT';
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
