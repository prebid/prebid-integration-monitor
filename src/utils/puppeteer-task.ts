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

/**
 * Configures a given Puppeteer {@link Page} instance with standard settings
 * suitable for web scraping tasks.
 * This includes setting a default navigation timeout using `PUPPETEER_DEFAULT_PAGE_TIMEOUT`
 * and a common desktop Chrome user agent string using `DEFAULT_USER_AGENT`.
 *
 * @param {Page} page - The Puppeteer `Page` instance to be configured.
 * @returns {Promise<Page>} A promise that resolves with the same `Page` instance after configuration.
 * @example
 * const browser = await puppeteer.launch();
 * const page = await browser.newPage();
 * await configurePage(page);
 * // page is now configured with default timeout and user agent.
 */
export async function configurePage(page: Page): Promise<Page> {
  page.setDefaultTimeout(PUPPETEER_DEFAULT_PAGE_TIMEOUT);
  await page.setUserAgent(DEFAULT_USER_AGENT);
  return page;
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
    await configurePage(page); // Use the configurePage from this module
    await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

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
      PBJS_VERSION_WAIT_INTERVAL_MS, // Pass the constant from app-config
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
        `No relevant ad library or Prebid.js data found on ${trimmedUrl}`,
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
