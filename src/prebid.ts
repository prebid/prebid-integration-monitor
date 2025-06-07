/**
 * @fileoverview This is the main orchestrator script for the Prebid Explorer tool.
 * It leverages Puppeteer to launch a browser, load URLs from various sources
 * (local files or GitHub), process each page to extract Prebid.js and other
 * advertising technology information, and then saves these findings.
 *
 * The script is designed to be configurable through command-line options,
 * allowing users to specify URL sources, Puppeteer behavior (vanilla vs. cluster),
 * concurrency, output directories, and more.
 *
 * It coordinates helper modules for URL loading (`url-loader.ts`),
 * Puppeteer task execution (`puppeteer-task.ts`), and results handling
 * (`results-handler.ts`).
 */
import { initializeLogger } from './utils/logger.js';
import type { Logger as WinstonLogger } from 'winston';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla, { Browser, PuppeteerLaunchOptions } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// Using namespace import and attempting to access .default for CJS interop
import * as BlockResourcesModule from 'puppeteer-extra-plugin-block-resources';
import { Cluster } from 'puppeteer-cluster';

// Import functions from new modules
import {
  processFileContent,
  fetchUrlsFromGitHub,
  loadFileContents,
} from './utils/url-loader.js';

import {
  processPageTask, // The core function for processing a single page
  // TaskResult and PageData are now imported from common/types
} from './utils/puppeteer-task.js';

// Import shared types from the new common location
import type { TaskResult, PageData } from './common/types.ts';
import { AppError, AppErrorDetails } from './common/AppError.js';
// Import ResourceType directly as it's used for type annotations, not just through DEFAULT_RESOURCES_TO_BLOCK
import {
  PUPPETEER_PROTOCOL_TIMEOUT,
  DEFAULT_RESOURCES_TO_BLOCK,
  ResourceType, // Use directly
} from './config/app-config.js';

import {
  processAndLogTaskResults,
  writeResultsToFile,
  updateInputFile,
} from './utils/results-handler.js';

/**
 * Defines the configuration options for the `prebidExplorer` function.
 * These options control various aspects of the Prebid.js scanning process.
 * @interface PrebidExplorerOptions
 * @property {string} [inputFile] - Optional path to a local file containing URLs to scan (e.g., .txt, .json, .csv).
 *                                  Used if `githubRepo` is not provided.
 * @property {string} [csvFile] - Optional path to a CSV file. Currently unused, consider for future use or removal.
 *                                (Note: `inputFile` can handle CSVs, making this potentially redundant).
 * @property {string} [githubRepo] - Optional URL of a public GitHub repository or a direct link to a file
 *                                   within such a repository to fetch URLs from. Takes precedence over `inputFile`.
 * @property {number} [numUrls] - Optional. Maximum number of URLs to process when fetching from GitHub or other list sources.
 *                                If undefined, all found URLs are processed (subject to other limits like range).
 * @property {'vanilla' | 'cluster'} puppeteerType - The mode of Puppeteer execution.
 *                                                   'vanilla' uses a single browser instance.
 *                                                   'cluster' uses `puppeteer-cluster` for parallel processing.
 * @property {number} concurrency - The maximum number of concurrent Puppeteer instances or pages
 *                                  when `puppeteerType` is 'cluster'. Ignored for 'vanilla'.
 * @property {boolean} headless - Whether to run Puppeteer in headless mode (no visible browser UI).
 *                                `true` for headless, `false` for headed.
 * @property {boolean} monitor - Whether to enable the `puppeteer-cluster` web monitoring interface
 *                               (typically at `http://localhost:21337`) when `puppeteerType` is 'cluster'.
 * @property {string} outputDir - The directory path where output JSON files containing scan results will be saved.
 *                                Dated subdirectories (e.g., `YYYY-MM-Mon`) will be created within this directory.
 * @property {string} logDir - The directory path where log files (e.g., `app.log`, `error.log`) will be saved.
 * @property {PuppeteerLaunchOptions} [puppeteerLaunchOptions] - Optional. Advanced launch options for Puppeteer,
 *                                                                allowing fine-grained control over the browser instance.
 *                                                                @see https://pptr.dev/api/puppeteer.puppeteerlaunchoptions
 * @property {string} [range] - Optional string specifying a sub-range of URLs to process from the input list (1-based index).
 *                              Examples: "1-100" (first 100), "50-" (from 50th to end), "-200" (up to 200th).
 *                              Useful for splitting large lists or resuming scans.
 * @property {number} [chunkSize] - Optional. Number of URLs to process in each batch or chunk.
 *                                 If 0 or undefined, all URLs (after range filtering) are processed in a single batch
 *                                 (or as per cluster limits). Useful for resource management with very large URL lists.
 */
export interface PrebidExplorerOptions {
  inputFile?: string;
  csvFile?: string;
  githubRepo?: string;
  numUrls?: number;
  puppeteerType: 'vanilla' | 'cluster';
  concurrency: number;
  headless: boolean;
  monitor: boolean;
  outputDir: string;
  logDir: string;
  puppeteerLaunchOptions?: PuppeteerLaunchOptions;
  range?: string;
  chunkSize?: number;
}

let logger: WinstonLogger; // Global logger instance, initialized within prebidExplorer.

// Apply puppeteer-extra plugins.
const puppeteer = addExtra(
  puppeteerVanilla as any,
) as unknown as typeof puppeteerVanilla;

/**
 * Main orchestrator for the Prebid.js scanning process.
 *
 * This function initializes logging and Puppeteer, loads URLs from the specified source (file or GitHub),
 * filters them if a range is provided, and then processes these URLs to detect Prebid.js and other
 * advertising technologies. It can operate Puppeteer in 'vanilla' mode (single browser) or 'cluster'
 * mode for parallel processing. URLs can be processed in chunks for better resource management.
 *
 * **Major Steps:**
 * 1.  **Initialization**: Sets up the logger and applies Puppeteer plugins like `puppeteer-extra-plugin-stealth`
 *     and `puppeteer-extra-plugin-block-resources` (using `DEFAULT_RESOURCES_TO_BLOCK`).
 * 2.  **URL Loading**: Fetches URLs from either a GitHub repository (via `fetchUrlsFromGitHub`) or a local
 *     input file (via `loadFileContents` and `processFileContent`).
 * 3.  **URL Filtering**: If a `range` is specified in options, it slices the URL list accordingly.
 * 4.  **Puppeteer Launch & Processing**:
 *     *   If `chunkSize` is specified, URLs are processed in batches.
 *     *   Based on `puppeteerType`:
 *         *   **'cluster'**: Launches a `puppeteer-cluster` instance. Errors during cluster launch
 *             (e.g., from `Cluster.launch()`) are caught and re-thrown as `AppError` with
 *             `errorCode: 'PUPPETEER_CLUSTER_LAUNCH_FAILED'`.
 *         *   **'vanilla'**: Launches a single Puppeteer browser instance. Errors during browser launch
 *             (e.g., from `puppeteer.launch()`) are caught and re-thrown as `AppError` with
 *             `errorCode: 'PUPPETEER_LAUNCH_FAILED'`.
 *     *   Each URL (or page in a chunk) is processed by `processPageTask`.
 * 5.  **Results Handling**:
 *     *   Aggregates results from all processed URLs.
 *     *   Logs outcomes using `processAndLogTaskResults`.
 *     *   Writes successful results to a JSON file using `writeResultsToFile`.
 *     *   If a local input file was used, updates it by removing successfully processed URLs using `updateInputFile`.
 * 6.  **Error Handling**: A top-level `try...catch...finally` block ensures that critical errors during
 *     the orchestration (including Puppeteer launch failures or unhandled exceptions from tasks) are caught,
 *     logged with details, and re-thrown as an `AppError` with `errorCode: 'PREBID_EXPLORER_FAILURE'`.
 *     The `finally` block attempts to process and save any partial results collected before a critical error.
 *
 * @param {PrebidExplorerOptions} options - Configuration options for the scan.
 * @returns {Promise<void>} Resolves when all processing is complete.
 * @throws {AppError} If a critical error occurs during setup or execution (e.g., `PUPPETEER_LAUNCH_FAILED`,
 *                    `PUPPETEER_CLUSTER_LAUNCH_FAILED`, `PREBID_EXPLORER_FAILURE`). The `details` property
 *                    of the `AppError` will contain `originalError` and a specific `errorCode`.
 * @example
 * const options = {
 *   inputFile: "urls.txt", outputDir: "results", logDir: "logs",
 *   puppeteerType: 'cluster', concurrency: 5, headless: true, monitor: false
 * };
 * prebidExplorer(options).then(() => console.log("Scan complete.")).catch(err => console.error(err));
 */
export async function prebidExplorer(
  options: PrebidExplorerOptions,
): Promise<void> {
  // Initialize at a higher scope to be accessible in finally
  let successfulResults: PageData[] = [];
  let urlsToProcess: string[] = [];
  let urlSourceType = ''; // To track the source for logging and file updates
  // taskResults also needs to be available in the finally block
  const taskResults: TaskResult[] = [];

  try {
    logger = initializeLogger(options.logDir); // Initialize the global logger
    logger.info('Starting Prebid Explorer with options:', options);

  // Apply puppeteer-extra stealth plugin to help avoid bot detection
  (puppeteer as any).use(StealthPlugin());

  // The local 'ResourceType' type definition is removed.
  // We rely on the imported 'ResourceType' via 'DEFAULT_RESOURCES_TO_BLOCK'.

  // Accessing .default property for the factory, or using the module itself if .default is not present
  const factory = ((BlockResourcesModule as any).default ||
    BlockResourcesModule) as any;
  const blockResourcesPluginInstance = factory({
    blockedTypes: DEFAULT_RESOURCES_TO_BLOCK, // Use imported constant from app-config
  });
  (puppeteer as any).use(blockResourcesPluginInstance);
  logger.info(
    `Configured to block resource types: ${Array.from(DEFAULT_RESOURCES_TO_BLOCK).join(', ')}`,
  );

  const basePuppeteerOptions: PuppeteerLaunchOptions = {
    protocolTimeout: PUPPETEER_PROTOCOL_TIMEOUT, // Use imported constant from app-config
    defaultViewport: null,
    headless: options.headless,
    args: options.puppeteerLaunchOptions?.args || [],
    ...(options.puppeteerLaunchOptions || {}),
  };

  // taskResults is declared at a higher scope, no need to re-declare here.
  /** @type {string[]} Array to store all URLs fetched from the specified source. */
  let allUrls: string[] = [];
  /** @type {Set<string>} Set to keep track of URLs that have been processed or are queued for processing. */
  const processedUrls: Set<string> = new Set();
  // urlSourceType is now declared at a higher scope

  // Determine the source of URLs (GitHub or local file) and fetch them.
  if (options.githubRepo) {
    urlSourceType = 'GitHub';
    allUrls = await fetchUrlsFromGitHub(
      options.githubRepo,
      options.numUrls,
      logger,
    );
    if (allUrls.length > 0) {
      logger.info(
        `Successfully loaded ${allUrls.length} URLs from GitHub repository: ${options.githubRepo}`,
      );
    } else {
      logger.warn(
        `No URLs found or fetched from GitHub repository: ${options.githubRepo}.`,
      );
    }
  } else if (options.inputFile) {
    urlSourceType = 'InputFile';
    const fileContent = loadFileContents(options.inputFile, logger);
    if (fileContent) {
      // Determine file type for logging, actual type handling is in processFileContent
      const fileType =
        options.inputFile.substring(options.inputFile.lastIndexOf('.') + 1) ||
        'unknown';
      logger.info(
        `Processing local file: ${options.inputFile} (detected type: ${fileType})`,
      );
      allUrls = await processFileContent(
        options.inputFile,
        fileContent,
        logger,
      );
      if (allUrls.length > 0) {
        logger.info(
          `Successfully loaded ${allUrls.length} URLs from local ${fileType.toUpperCase()} file: ${options.inputFile}`,
        );
      } else {
        logger.warn(
          `No URLs extracted from local ${fileType.toUpperCase()} file: ${options.inputFile}. Check file content and type handling.`,
        );
      }
    } else {
      // loadFileContents already logs the error, but we should ensure allUrls is empty and potentially throw
      allUrls = []; // Ensure allUrls is empty if file read failed
      logger.error(
        `Failed to load content from input file ${options.inputFile}. Cannot proceed with this source.`,
      );
      // For now, it will proceed to the "No URLs to process" check.
    }
  } else {
    // This case should ideally be prevented by CLI validation in scan.ts
    logger.error(
      'No URL source provided. Either --githubRepo or inputFile argument must be specified.',
    );
    throw new Error('No URL source specified.'); // This will be caught by the main try-catch
  }

  // Exit if no URLs were found from the specified source.
  if (allUrls.length === 0) {
    logger.warn(
      `No URLs to process from ${urlSourceType || 'any specified source'}. Exiting.`,
    );
    return;
  }
  logger.info(`Initial total URLs found: ${allUrls.length}`, {
    firstFew: allUrls.slice(0, 5),
  });

  // 1. URL Range Logic
  // Apply URL range filtering if specified in options.
  if (options.range) {
    logger.info(`Applying range: ${options.range}`);
    const originalUrlCount = allUrls.length;
    let [startStr, endStr] = options.range.split('-');
    let start = startStr ? parseInt(startStr, 10) : 1;
    let end = endStr ? parseInt(endStr, 10) : allUrls.length;

    if (isNaN(start) || isNaN(end) || start < 0 || end < 0) {
      logger.warn(
        `Invalid range format: "${options.range}". Proceeding with all URLs. Start and end must be numbers. User input is 1-based.`,
      );
    } else {
      start = start > 0 ? start - 1 : 0;
      end = end > 0 ? end : allUrls.length;

      if (start >= allUrls.length) {
        logger.warn(
          `Start of range (${start + 1}) is beyond the total number of URLs (${allUrls.length}). No URLs to process.`,
        );
        allUrls = [];
      } else if (start > end - 1) {
        logger.warn(
          `Start of range (${start + 1}) is greater than end of range (${end}). Proceeding with URLs from start to end of list.`,
        );
        allUrls = allUrls.slice(start);
      } else {
        allUrls = allUrls.slice(start, end);
        logger.info(
          `Applied range: Processing URLs from ${start + 1} to ${Math.min(end, originalUrlCount)} (0-based index ${start} to ${Math.min(end, originalUrlCount) - 1}). Total URLs after range: ${allUrls.length} (out of ${originalUrlCount}).`,
        );
      }
    }
  }

  if (allUrls.length === 0) {
    logger.warn(
      `No URLs to process after applying range or due to empty initial list. Exiting.`,
    );
    return;
  }
  logger.info(`Total URLs to process after range check: ${allUrls.length}`, {
    firstFew: allUrls.slice(0, 5),
  });

  // urlsToProcess is now declared at a higher scope
  urlsToProcess = allUrls; // This now contains potentially ranged URLs

  // Define the core processing task (used by both vanilla and cluster)

  // 2. Chunk Processing Logic
  const chunkSize =
    options.chunkSize && options.chunkSize > 0 ? options.chunkSize : 0;

  if (chunkSize > 0) {
    logger.info(`Chunked processing enabled. Chunk size: ${chunkSize}`);
    const totalChunks = Math.ceil(urlsToProcess.length / chunkSize);
    logger.info(`Total chunks to process: ${totalChunks}`);

    for (let i = 0; i < urlsToProcess.length; i += chunkSize) {
      const currentChunkUrls = urlsToProcess.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      logger.info(
        `Processing chunk ${chunkNumber} of ${totalChunks}: URLs ${i + 1}-${Math.min(i + chunkSize, urlsToProcess.length)}`,
      );

      if (options.puppeteerType === 'cluster') {
        let cluster: Cluster<
          { url: string; logger: WinstonLogger },
          TaskResult
        > | null = null;
        try {
          try {
            cluster = await Cluster.launch({
              concurrency: Cluster.CONCURRENCY_CONTEXT,
              maxConcurrency: options.concurrency,
          monitor: options.monitor,
          puppeteer,
          puppeteerOptions: basePuppeteerOptions,
        });
          } catch (launchError: unknown) {
            const errorDetails: AppErrorDetails = {
              errorCode: 'PUPPETEER_CLUSTER_LAUNCH_FAILED',
              originalError: launchError as Error,
              puppeteerType: 'cluster',
              chunkProcessing: true,
              chunkNumber,
            };
            logger.error(`Puppeteer Cluster launch failed (chunk ${chunkNumber}): ${(launchError as Error).message}`, { errorDetails });
            throw new AppError(`Puppeteer Cluster launch failed for chunk ${chunkNumber}.`, errorDetails);
          }

        await cluster.task(processPageTask);

        try {
          const chunkPromises = currentChunkUrls
            .filter((url) => url)
            .map((url) => {
              processedUrls.add(url);
              return cluster!.queue({ url, logger });
            });
          const settledChunkResults = await Promise.allSettled(chunkPromises);

          settledChunkResults.forEach((settledResult) => {
            if (settledResult.status === 'fulfilled') {
              if (typeof settledResult.value !== 'undefined') {
                taskResults.push(settledResult.value);
              } else {
                logger.warn(
                  'A task from cluster.queue (chunked) fulfilled but with undefined/null value.',
                  { settledResult },
                );
              }
            } else if (settledResult.status === 'rejected') {
              logger.error(
                `A promise from cluster.queue (chunk ${chunkNumber}) was rejected. This is unexpected if processPageTask is robust.`,
                { reason: settledResult.reason },
              );
            }
          });
          await cluster.idle();
          await cluster.close();
        } catch (error: unknown) {
          logger.error(
            `An error occurred during processing chunk ${chunkNumber} with puppeteer-cluster.`,
            { error: (error as Error).message, stack: (error as Error).stack },
          );
          if (cluster && !(cluster as any).isClosed()) {
            await (cluster as any).close();
          }
          // If Cluster.launch itself failed, the AppError is thrown and will be caught by the outer try-catch.
        }
      } else {
        // 'vanilla' Puppeteer for the current chunk
        let browser: Browser | null = null;
        try {
          try {
            browser = await puppeteer.launch(basePuppeteerOptions);
          } catch (launchError: unknown) {
            const errorDetails: AppErrorDetails = {
              errorCode: 'PUPPETEER_LAUNCH_FAILED',
              originalError: launchError as Error,
              puppeteerType: 'vanilla',
              chunkProcessing: true,
              chunkNumber,
            };
            logger.error(`Vanilla Puppeteer launch failed (chunk ${chunkNumber}): ${(launchError as Error).message}`, { errorDetails });
            throw new AppError(`Vanilla Puppeteer launch failed for chunk ${chunkNumber}.`, errorDetails);
          }
          for (const url of currentChunkUrls) {
            if (url) {
              const page = await browser.newPage();
              const result = await processPageTask({
                page,
                data: { url, logger },
              });
              taskResults.push(result);
              await page.close();
              processedUrls.add(url);
            }
          }
        } catch (error: unknown) {
          if (error instanceof AppError) throw error;

          logger.error(
            `An error occurred during processing chunk ${chunkNumber} with vanilla Puppeteer.`,
            { error: (error as Error).message, stack: (error as Error).stack },
          );
        } finally {
          if (browser) await browser.close();
        }
      }
      logger.info(
        `Finished processing chunk ${chunkNumber} of ${totalChunks}.`,
      );
    }
  } else {
    // Process all URLs at once (no chunking)
    logger.info(
      `Processing all ${urlsToProcess.length} URLs without chunking.`,
    );
    if (options.puppeteerType === 'cluster') {
      let cluster: Cluster<
        { url: string; logger: WinstonLogger },
        TaskResult
      > | null = null;
      try {
        try {
            cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_CONTEXT,
                maxConcurrency: options.concurrency,
                monitor: options.monitor,
                puppeteer,
                puppeteerOptions: basePuppeteerOptions,
            });
        } catch (launchError: unknown) {
            const errorDetails: AppErrorDetails = {
                errorCode: 'PUPPETEER_CLUSTER_LAUNCH_FAILED',
                originalError: launchError as Error,
                puppeteerType: 'cluster',
            };
            logger.error(`Puppeteer Cluster launch failed (non-chunked): ${(launchError as Error).message}`, { errorDetails });
            throw new AppError('Puppeteer Cluster launch failed.', errorDetails);
        }

        await cluster.task(processPageTask);

        const promises = urlsToProcess
          .filter((url) => url)
          .map((url) => {
            processedUrls.add(url);
            return cluster!.queue({ url, logger }); // cluster is non-null here
          });
        const settledResults = await Promise.allSettled(promises);
        settledResults.forEach((settledResult) => {
          if (settledResult.status === 'fulfilled') {
            if (typeof settledResult.value !== 'undefined') {
              taskResults.push(settledResult.value);
            } else {
              logger.warn(
                'A task from cluster.queue (non-chunked) fulfilled but with undefined/null value.',
                { settledResult },
              );
            }
          } else if (settledResult.status === 'rejected') {
            logger.error(
              'A promise from cluster.queue (non-chunked) was rejected. This is unexpected if processPageTask is robust.',
              { reason: settledResult.reason },
            );
          }
        });
        await cluster.idle();
        await cluster.close();
      } catch (error: unknown) {
        if (error instanceof AppError) throw error;

        if (cluster && !(cluster as any).isClosed()) {
          await (cluster as any).close();
        }
        const errorDetails: AppErrorDetails = {
          errorCode: 'PUPPETEER_CLUSTER_PROCESSING_FAILED',
          originalError: error as Error,
          puppeteerType: 'cluster',
        };
        logger.error(`Error in puppeteer-cluster (non-chunked): ${(error as Error).message}`, { errorDetails });
        throw new AppError('Puppeteer cluster processing failed.', errorDetails);
      }
    } else {
      // 'vanilla' Puppeteer
      let browser: Browser | null = null;
      try {
        try {
          browser = await puppeteer.launch(basePuppeteerOptions);
        } catch (launchError: unknown) {
          const errorDetails: AppErrorDetails = {
            errorCode: 'PUPPETEER_LAUNCH_FAILED',
            originalError: launchError as Error,
            puppeteerType: 'vanilla',
          };
          logger.error(`Vanilla Puppeteer launch failed: ${(launchError as Error).message}`, { errorDetails });
          throw new AppError('Vanilla Puppeteer launch failed.', errorDetails);
        }
        for (const url of urlsToProcess) {
          if (url) {
            const page = await browser.newPage();
            const result = await processPageTask({
              page,
              data: { url, logger },
            });
            taskResults.push(result);
            await page.close();
            processedUrls.add(url);
          }
        }
      } catch (error: unknown) {
        if (error instanceof AppError) throw error;

        logger.error(
          'An unexpected error occurred during vanilla Puppeteer processing',
          { error: (error as Error).message, stack: (error as Error).stack },
        );
        const errorDetails: AppErrorDetails = {
          errorCode: 'PUPPETEER_VANILLA_PROCESSING_FAILED',
          originalError: error as Error,
          puppeteerType: 'vanilla',
        };
        throw new AppError('Vanilla Puppeteer processing failed.', errorDetails);
      } finally {
        if (browser) await browser.close();
      }
    }
  }
  // Assign to successfulResults here, after all processing is done and before catch/finally
  successfulResults = processAndLogTaskResults(taskResults, logger);

} catch (error: unknown) {
  // This is a top-level catch for prebidExplorer orchestration errors
  const err = error as Error;
  let appErrorDetails: AppErrorDetails;

  if (err instanceof AppError && err.details) {
    appErrorDetails = {
      ...err.details,
      errorCode: err.details.errorCode || 'PREBID_EXPLORER_FAILURE',
      originalError: err.details.originalError || err,
    };
    // Ensure logger is initialized before using
    if (logger) {
      logger.error(
        `Critical error during Prebid exploration: ${err.message}`,
        {
          errorDetails: appErrorDetails,
          originalStack: err.stack,
        },
      );
    } else {
      console.error(`Critical error (logger not init): ${err.message}`, appErrorDetails);
    }
  } else {
    appErrorDetails = {
      errorCode: 'PREBID_EXPLORER_FAILURE',
      originalError: err,
    };
    if (logger) {
      logger.error(
        `Critical error during Prebid exploration: ${err.message}`,
        {
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack,
        },
      );
    } else {
      console.error(`Critical error (logger not init): ${err.message}`);
    }
  }
  // Re-throw as an AppError to standardize errors propagated from prebidExplorer
  throw new AppError(
    `Critical error during Prebid exploration: ${err.message}`,
    appErrorDetails,
  );
} finally {
  // This block runs regardless of errors in the try block,
  // to ensure any partial results are processed and files are updated.
  // Ensure logger is initialized before using it in finally block
  const currentLogger = logger || initializeLogger(options.logDir, 'prebid-explorer-finally');

  if (taskResults.length > 0 || successfulResults.length > 0) {
    // successfulResults might not be populated if error occurred before its assignment in try
    // Re-process taskResults if successfulResults is empty but taskResults has items
    const finalSuccessfulResults = successfulResults.length > 0 ? successfulResults : processAndLogTaskResults(taskResults, currentLogger);
    if (finalSuccessfulResults.length > 0) {
      writeResultsToFile(finalSuccessfulResults, options.outputDir, currentLogger);
    }

    if (urlSourceType === 'InputFile' && options.inputFile) {
      // urlsToProcess might be empty if error occurred before its initialization.
      updateInputFile(options.inputFile, urlsToProcess || [], taskResults, currentLogger);
    }
  } else if (currentLogger) {
    currentLogger.info('No task results generated, skipping result processing and file updates in finally block.');
  }
}
}

[end of src/prebid.ts]
