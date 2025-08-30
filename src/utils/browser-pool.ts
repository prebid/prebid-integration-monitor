/**
 * @fileoverview Browser pool implementation for managing multiple browser instances
 * Provides better stability than puppeteer-cluster for certain scenarios
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import type { Logger as WinstonLogger } from 'winston';
import { PageLifecycleTracer } from './puppeteer-telemetry.js';
import type { TaskResult } from '../common/types.js';
import { processPageTask } from './puppeteer-task.js';

export interface BrowserPoolOptions {
  maxBrowsers: number;
  puppeteerOptions: any;
  logger: WinstonLogger;
  discoveryMode?: boolean;
  extractMetadata?: boolean;
  adUnitDetail?: 'basic' | 'standard' | 'full';
  moduleDetail?: 'simple' | 'categorized';
  identityDetail?: 'basic' | 'enhanced';
  prebidConfigDetail?: 'none' | 'raw';
  identityUsageDetail?: 'none' | 'comprehensive';
}

interface BrowserInstance {
  browser: Browser;
  pages: number;
  lastUsed: number;
  errors: number;
}

export class BrowserPool {
  private browsers: BrowserInstance[] = [];
  private options: BrowserPoolOptions;
  private logger: WinstonLogger;
  private maxPagesPerBrowser = 5;
  private browserErrorThreshold = 3;

  constructor(options: BrowserPoolOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  private async createBrowser(): Promise<BrowserInstance> {
    const browser = await puppeteer.launch({
      ...this.options.puppeteerOptions,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });

    return {
      browser,
      pages: 0,
      lastUsed: Date.now(),
      errors: 0,
    };
  }

  private async getHealthyBrowser(): Promise<BrowserInstance> {
    // Clean up unhealthy browsers
    for (let i = this.browsers.length - 1; i >= 0; i--) {
      const instance = this.browsers[i];
      if (
        instance.errors >= this.browserErrorThreshold ||
        !instance.browser.isConnected()
      ) {
        this.logger.warn(
          `Removing unhealthy browser instance with ${instance.errors} errors`
        );
        try {
          await instance.browser.close();
        } catch (e) {
          // Ignore close errors
        }
        this.browsers.splice(i, 1);
      }
    }

    // Find browser with capacity
    let browser = this.browsers.find(
      (b) =>
        b.pages < this.maxPagesPerBrowser &&
        b.browser.isConnected() &&
        b.errors < this.browserErrorThreshold
    );

    // Create new browser if needed
    if (!browser && this.browsers.length < this.options.maxBrowsers) {
      this.logger.info('Creating new browser instance');
      browser = await this.createBrowser();
      this.browsers.push(browser);
    }

    // If still no browser and at capacity, wait for one to free up
    if (!browser) {
      this.logger.info('All browsers at capacity, waiting...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.getHealthyBrowser();
    }

    browser.lastUsed = Date.now();
    return browser;
  }

  async processUrl(
    url: string,
    discoveryMode: boolean = false
  ): Promise<TaskResult> {
    const pageTracer = new PageLifecycleTracer(url, this.logger);
    let browserInstance: BrowserInstance | null = null;
    let page: Page | null = null;

    try {
      // Get a healthy browser
      browserInstance = await this.getHealthyBrowser();
      browserInstance.pages++;

      // Create page with timeout
      const pagePromise = browserInstance.browser.newPage();
      const timeoutPromise = new Promise<Page>((_, reject) => {
        setTimeout(() => reject(new Error('Page creation timeout')), 5000);
      });

      page = await Promise.race([pagePromise, timeoutPromise]);

      // Process the page
      pageTracer.startPageProcessing();
      pageTracer.setupPageEventHandlers(page);

      const result = await processPageTask({
        page,
        data: { 
          url, 
          logger: this.logger, 
          discoveryMode: this.options.discoveryMode || false,
          extractMetadata: this.options.extractMetadata || false,
          adUnitDetail: this.options.adUnitDetail || 'basic',
          moduleDetail: this.options.moduleDetail || 'simple',
          identityDetail: this.options.identityDetail || 'basic',
          prebidConfigDetail: this.options.prebidConfigDetail || 'none',
          identityUsageDetail: this.options.identityUsageDetail || 'none',
        },
      });

      pageTracer.finish(
        true,
        result.type === 'success' ? result.data : undefined
      );

      // Reset error count on success
      browserInstance.errors = 0;

      return result;
    } catch (error: any) {
      const err = error as Error;
      pageTracer.finishWithError(err);

      // Track browser errors
      if (browserInstance) {
        browserInstance.errors++;
      }

      this.logger.error(`Error processing ${url}:`, err);

      return {
        type: 'error',
        url: url,
        error: {
          code: err.message.includes('Unable to get browser page')
            ? 'BROWSER_PAGE_ERROR'
            : 'PROCESSING_ERROR',
          message: err.message,
          stack: err.stack,
        },
      };
    } finally {
      // Clean up
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }

      if (browserInstance) {
        browserInstance.pages--;
      }
    }
  }

  async close(): Promise<void> {
    this.logger.info('Closing browser pool...');

    await Promise.all(
      this.browsers.map(async (instance) => {
        try {
          await instance.browser.close();
        } catch (e) {
          this.logger.error('Error closing browser:', e);
        }
      })
    );

    this.browsers = [];
  }
}

/**
 * Process URLs using browser pool instead of cluster
 */
export async function processUrlsWithBrowserPool(
  urls: string[],
  options: {
    concurrency: number;
    puppeteerOptions: any;
    logger: WinstonLogger;
    discoveryMode?: boolean;
    extractMetadata?: boolean;
    adUnitDetail?: 'basic' | 'standard' | 'full';
    moduleDetail?: 'simple' | 'categorized';
    identityDetail?: 'basic' | 'enhanced';
    prebidConfigDetail?: 'none' | 'raw';
    identityUsageDetail?: 'none' | 'comprehensive';
  },
  onProgress?: (processed: number, total: number) => void
): Promise<TaskResult[]> {
  const { logger, concurrency } = options;
  const results: TaskResult[] = [];
  const pool = new BrowserPool({
    maxBrowsers: Math.max(1, Math.floor(concurrency / 5)), // Fewer browsers, more pages each
    puppeteerOptions: options.puppeteerOptions,
    logger,
    discoveryMode: options.discoveryMode,
    extractMetadata: options.extractMetadata,
    adUnitDetail: options.adUnitDetail,
    moduleDetail: options.moduleDetail,
    identityDetail: options.identityDetail,
    prebidConfigDetail: options.prebidConfigDetail,
    identityUsageDetail: options.identityUsageDetail,
  });

  try {
    // Process URLs in batches
    const batchSize = concurrency;

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, Math.min(i + batchSize, urls.length));
      logger.info(
        `Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} URLs)`
      );

      // Process batch concurrently
      const batchPromises = batch.map(async (url) => {
        try {
          const result = await pool.processUrl(url);
          results.push(result);
          onProgress?.(results.length, urls.length);
          return result;
        } catch (error) {
          logger.error(`Failed to process ${url}:`, error);
          const errorResult: TaskResult = {
            type: 'error',
            url: url,
            error: {
              code: 'POOL_ERROR',
              message: (error as Error).message,
              stack: (error as Error).stack,
            },
          };
          results.push(errorResult);
          onProgress?.(results.length, urls.length);
          return errorResult;
        }
      });

      await Promise.all(batchPromises);

      // Brief pause between batches
      if (i + batchSize < urls.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    await pool.close();
  }

  return results;
}
