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
      logger.debug(`Lifecycle error for ${data.url}: ${err.message}`);
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

    try {
      // Start tracing
      pageTracer.startPageProcessing();

      // Create a timeout promise
      const timeoutPromise = new Promise<TaskResult>((_, reject) => {
        setTimeout(() => reject(new Error('Page processing timeout')), 25000);
      });

      // Create the processing promise
      const processingPromise = (async () => {
        try {
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
      })();

      // Race between timeout and processing
      result = await Promise.race([processingPromise, timeoutPromise]);

      pageTracer.finish(
        true,
        result.type === 'success' ? result.data : undefined
      );
      onTaskComplete?.(result);

      // Reset fail count on success
      failedUrls.delete(url);

      return result;
    } catch (error: any) {
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
          discoveryMode: false,
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
            logger.debug(`Browser page lifecycle error for ${url}`);
          } else if (
            err.message &&
            err.message.includes('Requesting main frame too early')
          ) {
            errorCode = 'PUPPETEER_MAIN_FRAME_ERROR';
            logger.debug(`Main frame error for ${url}`);
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
