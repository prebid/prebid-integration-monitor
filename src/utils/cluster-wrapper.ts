/**
 * @fileoverview Safer wrapper around puppeteer-cluster to handle critical errors
 * Provides isolated execution contexts and automatic recovery
 */

import { Cluster } from 'puppeteer-cluster';
import type { Page, Browser } from 'puppeteer';
import type { Logger as WinstonLogger } from 'winston';
import { PageLifecycleTracer } from './puppeteer-telemetry.js';
import type { TaskResult } from '../common/types.js';
import { processPageTask } from './puppeteer-task.js';

export interface SafeClusterOptions {
  concurrency: number;
  maxConcurrency: number;
  monitor: boolean;
  puppeteer: any;
  puppeteerOptions: any;
  logger: WinstonLogger;
  onTaskComplete?: (result: TaskResult) => void;
  maxRetries?: number;
  discoveryMode?: boolean;
  extractMetadata?: boolean;
  adUnitDetail?: 'basic' | 'standard' | 'full';
  moduleDetail?: 'simple' | 'categorized';
  identityDetail?: 'basic' | 'enhanced';
  prebidConfigDetail?: 'none' | 'raw';
  identityUsageDetail?: 'none' | 'comprehensive';
}

/**
 * Wrap task execution with crash detection for fast abort
 */
async function wrapWithCrashDetection(
  page: Page,
  url: string,
  task: (page: Page) => Promise<TaskResult>,
  logger: WinstonLogger
): Promise<TaskResult> {
  let crashDetected = false;
  let checkInterval: NodeJS.Timeout | null = null;
  
  // Monitor for the specific crash pattern
  const crashHandler = (error: Error) => {
    const msg = error.message;
    // ONLY these specific patterns indicate browser being killed
    if (msg.includes('Target closed') || 
        msg.includes('Protocol error (Runtime.callFunctionOn)') ||
        msg.includes('Session closed. Most likely the page has been closed')) {
      crashDetected = true;
      logger.warn(`Browser crash detected for ${url} - aborting immediately`);
    }
  };
  
  page.on('error', crashHandler);
  page.on('pageerror', crashHandler);
  
  try {
    // Set a reasonable timeout but let slow sites complete
    const result = await Promise.race([
      task(page),
      new Promise<TaskResult>((_, reject) => {
        // Check periodically for crash
        checkInterval = setInterval(() => {
          if (crashDetected || page.isClosed()) {
            if (checkInterval) clearInterval(checkInterval);
            reject(new Error('BROWSER_CRASHED_ABORT'));
          }
        }, 250); // Check 4x per second
        
        // Clean up after max time (keep existing 60s for slow sites)
        setTimeout(() => {
          if (checkInterval) clearInterval(checkInterval);
        }, 60000);
      })
    ]);
    return result;
  } catch (error: any) {
    if (error.message === 'BROWSER_CRASHED_ABORT') {
      // Return error result for browser crashes - don't retry
      return {
        type: 'error',
        url: url,
        error: {
          code: 'BROWSER_CRASH_NO_RETRY',
          message: 'Browser crashed - will not retry',
          stack: error.stack,
        },
      };
    }
    throw error;
  } finally {
    // Clean up
    page.off('error', crashHandler);
    page.off('pageerror', crashHandler);
    if (checkInterval) clearInterval(checkInterval);
  }
}

/**
 * Create a safer cluster with enhanced error handling
 */
export async function createSafeCluster(
  options: SafeClusterOptions
): Promise<Cluster<any, any>> {
  const { logger, onTaskComplete, maxRetries = 1 } = options;

  let cluster: Cluster<any, any>;

  try {
    cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT, // CONTEXT mode for better performance
      maxConcurrency: options.maxConcurrency,
      monitor: options.monitor,
      puppeteer: options.puppeteer,
      puppeteerOptions: {
        ...options.puppeteerOptions,
        pipe: true, // Use pipe instead of websocket for stability
        // Add extra args to prevent crashes
        args: [
          ...(options.puppeteerOptions.args || []),
          '--disable-dev-shm-usage', // Prevent shared memory issues
          '--disable-gpu', // Disable GPU to prevent crashes
          '--disable-web-security', // Prevent security restrictions
          '--disable-features=IsolateOrigins,site-per-process', // Prevent process isolation issues
          '--disable-blink-features=AutomationControlled', // Hide automation
        ],
      },
      // Reduce timeout to prevent hanging
      timeout: 30000,
      // Retry navigation errors
      retryLimit: maxRetries,
      retryDelay: 1000,
      // Prevent zombie processes
      sameDomainDelay: 0, // No delay for same domain
      // Monitor for issues
      workerCreationDelay: 100, // Reduced delay for faster worker creation
      skipDuplicateUrls: true,
    });
  } catch (error) {
    logger.error('Failed to create cluster:', error);
    throw error;
  }

  // Track failed URLs to avoid infinite retries
  const failedUrls = new Map<string, number>();

  // Add error handlers to catch cluster-level errors
  cluster.on('taskerror', (err, data) => {
    // Only log debug level for common lifecycle errors
    if (
      err.message &&
      (err.message.includes('Unable to get browser page') ||
        err.message.includes('Requesting main frame too early'))
    ) {
      // Log as warning instead of debug for better visibility
      logger.warn(`Browser lifecycle error for ${data.url}: ${err.message}`);
    } else {
      logger.error(`Cluster task error for ${data.url}:`, err);
    }

    // Check if this is the "Unable to get browser page" error
    if (err.message && err.message.includes('Unable to get browser page')) {
      // Create error result
      const errorResult: TaskResult = {
        type: 'error',
        url: data.url,
        error: {
          code: 'BROWSER_PAGE_ERROR',
          message: err.message,
          stack: err.stack,
        },
      };

      // Call the task complete handler
      onTaskComplete?.(errorResult);

      // Track the failure
      failedUrls.set(data.url, (failedUrls.get(data.url) || 0) + 1);
    }
  });

  // Override the task handler
  await cluster.task(async ({ page, data }) => {
    const { url, logger: taskLogger, discoveryMode } = data;
    const pageTracer = new PageLifecycleTracer(url, taskLogger);

    // Check if URL has failed too many times
    const failCount = failedUrls.get(url) || 0;
    if (failCount >= maxRetries) {
      logger.warn(`Skipping ${url} - failed ${failCount} times`);
      const errorResult: TaskResult = {
        type: 'error',
        url: url,
        error: {
          code: 'MAX_RETRIES_EXCEEDED',
          message: `URL failed ${failCount} times and was skipped`,
          stack: undefined,
        },
      };
      onTaskComplete?.(errorResult);
      return errorResult;
    }

    let result: TaskResult | null = null;
    let hardTimeoutId: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    try {
      // Start tracing
      pageTracer.startPageProcessing();

      // Create a hard timeout that will force cleanup after 65 seconds
      hardTimeoutId = setTimeout(() => {
        isTimedOut = true;
        logger.error(`Page processing timeout for ${url} - forcing cleanup`);
        
        // Force close the page if it's still open
        if (page && !page.isClosed()) {
          page.close().catch(() => {});
        }
      }, 65000);

      // Create a timeout promise
      const timeoutPromise = new Promise<TaskResult>((_, reject) => {
        setTimeout(() => reject(new Error('Page processing timeout')), 25000);
      });

      // Create the processing promise with crash detection
      const processingPromise = wrapWithCrashDetection(
        page,
        url,
        async (page) => {
          try {
            // Check if we've already timed out
            if (isTimedOut) {
              throw new Error('Processing aborted due to timeout');
            }

            // Set conservative page settings
            await page.setDefaultTimeout(20000);
            await page.setDefaultNavigationTimeout(20000);

            // Disable JavaScript execution that might cause issues
            await page.evaluateOnNewDocument(() => {
              // Disable problematic APIs
              Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            // Setup page event handlers
            pageTracer.setupPageEventHandlers(page);

            // Process the page
            const taskResult = await processPageTask({ page, data });
            return taskResult;
          } catch (error) {
            throw error;
          }
        },
        logger
      );

      // Race between timeout and processing (with crash detection)
      result = await Promise.race([processingPromise, timeoutPromise]);

      // Clear the hard timeout if we completed successfully
      if (hardTimeoutId) {
        clearTimeout(hardTimeoutId);
      }

      pageTracer.finish(
        true,
        result.type === 'success' ? result.data : undefined
      );
      onTaskComplete?.(result);

      // Reset fail count on success
      failedUrls.delete(url);

      return result;
    } catch (error: any) {
      // Clear the hard timeout
      if (hardTimeoutId) {
        clearTimeout(hardTimeoutId);
      }

      // Check if we were forcefully timed out
      if (isTimedOut) {
        const timeoutResult: TaskResult = {
          type: 'error',
          url: url,
          error: {
            code: 'HARD_TIMEOUT',
            message: 'Page processing exceeded maximum timeout and was forcefully terminated',
            stack: undefined,
          },
        };
        onTaskComplete?.(timeoutResult);
        return timeoutResult;
      }

      const err = error as Error;
      pageTracer.finishWithError(err);

      // Track failures
      failedUrls.set(url, failCount + 1);

      // Check for critical errors
      if (
        err.message &&
        err.message.includes('Requesting main frame too early')
      ) {
        logger.debug(`Main frame lifecycle error for ${url}`);

        // Return error result instead of crashing
        result = {
          type: 'error',
          url: url,
          error: {
            code: 'PUPPETEER_MAIN_FRAME_ERROR',
            message: err.message,
            stack: err.stack,
          },
        };
      } else {
        result = {
          type: 'error',
          url: url,
          error: {
            code: 'PROCESSING_ERROR',
            message: err.message,
            stack: err.stack,
          },
        };
      }

      onTaskComplete?.(result);
      return result;
    } finally {
      // Ensure page is properly closed
      try {
        if (page && !page.isClosed()) {
          await page.close().catch(() => {});
        }
      } catch (e) {
        // Ignore close errors
      }
    }
  });

  return cluster;
}

/**
 * Process URLs with automatic cluster recovery
 */
export async function processUrlsWithRecovery(
  urls: string[],
  options: SafeClusterOptions,
  onProgress?: (processed: number, total: number) => void
): Promise<TaskResult[]> {
  const { logger } = options;
  const results: TaskResult[] = [];
  const processedUrls = new Set<string>();

  let cluster: Cluster<any, any> | null = null;

  try {
    logger.info(
      `Processing ${urls.length} URLs with concurrency ${options.concurrency}`
    );

    // Create a single cluster for all URLs
    cluster = await createSafeCluster({
      ...options,
      onTaskComplete: (result) => {
        results.push(result);
        const url =
          result.type === 'error' || result.type === 'no_data'
            ? result.url
            : result.data.url;

        // Log immediate feedback for each URL
        if (result.type === 'success') {
          // Success message already logged in puppeteer-task.ts
        } else if (result.type === 'no_data') {
          // No data message already logged in puppeteer-task.ts
        } else if (result.type === 'error') {
          // Only log non-timeout errors immediately (timeout errors are logged later)
          if (!result.error.message?.includes('timeout')) {
            logger.error(`Failed to process ${url}: ${result.error.message}`);
          }
        }

        if (url) {
          processedUrls.add(url);
        }
        onProgress?.(processedUrls.size, urls.length);
      },
    });

    // Queue all URLs at once
    const promises = urls.map((url) => {
      return cluster!
        .queue({
          url,
          logger: options.logger,
          discoveryMode: options.discoveryMode || false,
          extractMetadata: options.extractMetadata || false,
          adUnitDetail: options.adUnitDetail || 'basic',
          moduleDetail: options.moduleDetail || 'simple',
          identityDetail: options.identityDetail || 'basic',
          prebidConfigDetail: options.prebidConfigDetail || 'none',
          identityUsageDetail: options.identityUsageDetail || 'none',
        })
        .catch((err) => {
          logger.error(`Failed to queue ${url}:`, err);

          // Check for specific error types
          let errorCode = 'QUEUE_ERROR';
          if (
            err.message &&
            err.message.includes('Unable to get browser page')
          ) {
            errorCode = 'BROWSER_PAGE_ERROR';
            logger.warn(`Browser page lifecycle error for ${url}: ${err.message}`);
          } else if (
            err.message &&
            err.message.includes('Requesting main frame too early')
          ) {
            errorCode = 'PUPPETEER_MAIN_FRAME_ERROR';
            logger.warn(`Main frame error for ${url}: ${err.message}`);
          }

          results.push({
            type: 'error',
            url: url,
            error: {
              code: errorCode,
              message: err.message,
              stack: err.stack,
            },
          });
          processedUrls.add(url); // Mark as processed to avoid retrying
        });
    });

    // Wait for all URLs to complete
    await Promise.allSettled(promises);
    await cluster.idle();
  } catch (error) {
    logger.error(`Cluster processing error:`, error);

    // Add error results for remaining URLs
    for (const url of urls) {
      if (!processedUrls.has(url)) {
        results.push({
          type: 'error',
          url: url,
          error: {
            code: 'CLUSTER_ERROR',
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
      }
    }
  } finally {
    // Always close the cluster
    if (cluster) {
      try {
        await cluster.close();
      } catch (e) {
        logger.error('Error closing cluster:', e);
      }
    }
  }

  return results;
}
