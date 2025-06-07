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

/**
 * Configures a given Puppeteer {@link Page} instance with standard settings
 * suitable for web scraping tasks. This includes setting a default navigation
 * timeout and a common desktop Chrome user agent string.
 *
 * @param {Page} page - The Puppeteer `Page` instance to be configured.
 * @returns {Promise<Page>} A promise that resolves with the same `Page` instance after configuration.
 * @example
 * const browser = await puppeteer.launch();
 * const page = await browser.newPage();
 * await configurePage(page);
 * // page is now configured
 */
export async function configurePage(page: Page): Promise<Page> {
  page.setDefaultTimeout(55000); // Increased timeout for potentially slow-loading ad-heavy pages.
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  );
  return page;
}

/**
 * Processes a single page to extract Prebid.js and other ad library data.
 * This function orchestrates the process of:
 * 1. Navigating to the given URL.
 * 2. Waiting for the page to load (including a fixed delay for dynamic ad tech).
 * 3. Executing JavaScript within the page context to extract ad library information,
 *    focusing on Prebid.js instances (version, modules).
 * 4. Handling potential errors during page processing.
 *
 * It is designed to be robust for use with `puppeteer-cluster`.
 *
 * @param {object} taskArgs - The arguments for the task, typically provided by `puppeteer-cluster`.
 * @param {Page} taskArgs.page - The Puppeteer `Page` instance provided by the cluster for this task.
 * @param {object} taskArgs.data - An object containing the URL to process and a logger instance.
 * @param {string} taskArgs.data.url - The absolute URL of the web page to be processed.
 * @param {WinstonLogger} taskArgs.data.logger - An instance of WinstonLogger for logging messages.
 * @returns {Promise<TaskResult>} A promise that resolves to a {@link TaskResult} object,
 *                                indicating the outcome of the processing.
 * @example
 * // This function is typically used as a task by puppeteer-cluster:
 * // await cluster.task(processPageTask);
 * // cluster.queue({ url: "https://example.com", logger: myLoggerInstance });
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

    await page.evaluate(async () => {
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      await sleep(6000);
    });

    // Define a type for the window object to avoid using 'any' repeatedly
    interface CustomWindow extends Window {
      apstag?: unknown; // Amazon Publisher Services UAM tag
      googletag?: unknown; // Google Publisher Tag
      ats?: unknown; // LiveRamp ATS.js
      _pbjsGlobals?: string[]; // Standard Prebid.js global variable names array
      [key: string]: any; // Index signature for dynamic access to Prebid instances (e.g., window['pbjs'])
    }

    const extractedPageData: PageData = await page.evaluate((): PageData => {
      const customWindow = window as CustomWindow; // Cast to our extended window type
      const data: Partial<PageData> = {
        libraries: [],
        date: new Date().toISOString().slice(0, 10),
        prebidInstances: [],
      };

      if (customWindow.apstag) data.libraries!.push('apstag');
      if (customWindow.googletag) data.libraries!.push('googletag');
      if (customWindow.ats) data.libraries!.push('ats');

      if (
        customWindow._pbjsGlobals &&
        Array.isArray(customWindow._pbjsGlobals)
      ) {
        customWindow._pbjsGlobals.forEach((globalVarName: string) => {
          const pbjsInstance = customWindow[globalVarName];
          if (
            pbjsInstance &&
            typeof pbjsInstance.version === 'string' &&
            Array.isArray(pbjsInstance.installedModules)
          ) {
            data.prebidInstances!.push({
              globalVarName: globalVarName,
              version: pbjsInstance.version,
              modules: pbjsInstance.installedModules.map(String), // Ensure modules are strings
            });
          }
        });
      }
      // Cast to PageData. This assumes that if prebidInstances is populated, it will be correctly structured.
      // More robust parsing could be added here if the structure from page context is less predictable.
      return data as PageData;
    });

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
    const pageError = e as Error;
    logger.error(
      `An error occurred while processing ${trimmedUrl}: ${pageError.message}`,
      { url: trimmedUrl, stack: pageError.stack },
    );
    const errorMessage: string =
      pageError.message || 'Unknown error during page processing';
    const netErrorMatch: RegExpMatchArray | null =
      errorMessage.match(/net::([A-Z_]+)/);
    let errorCode: string;
    if (netErrorMatch) {
      errorCode = netErrorMatch[1];
    } else {
      const prefix: string = `Error processing ${trimmedUrl}: `;
      if (errorMessage.startsWith(prefix)) {
        errorCode = errorMessage.substring(prefix.length).trim();
      } else {
        errorCode = errorMessage.trim() || 'UNKNOWN_ERROR';
      }
      errorCode = errorCode.replace(/\s+/g, '_').toUpperCase();
    }
    return { type: 'error', url: trimmedUrl, error: errorCode };
  }
};
