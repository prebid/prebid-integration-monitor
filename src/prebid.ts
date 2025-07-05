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
import * as path from 'path';
import * as fs from 'fs';

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
import type { TaskResult } from './common/types.ts';

import {
  processAndLogTaskResults,
  writeResultsToStoreFile,
  appendNoPrebidUrls,
  appendErrorUrls,
  updateInputFile,
  createErrorFileHeaders,
} from './utils/results-handler.js';

import { getUrlTracker, closeUrlTracker } from './utils/url-tracker.js';
import { filterValidUrls } from './utils/domain-validator.js';
import {
  PageLifecycleTracer,
  ClusterHealthMonitor,
  withPageTelemetry,
} from './utils/puppeteer-telemetry.js';
import { processUrlsWithRecovery } from './utils/cluster-wrapper.js';
import { processUrlsWithBrowserPool } from './utils/browser-pool.js';
import { ENHANCED_PUPPETEER_ARGS } from './config/app-config.js';
import { PreflightChecker } from './utils/preflight-check.js';
import { DomainHealthTracker } from './utils/error-recovery.js';
import { ErrorCategory, ProcessingPhase } from './utils/error-types.js';
import {
  initializeTelemetry,
  URLLoadingTracer,
  URLFilteringTracer,
} from './utils/telemetry.js';
import {
  installProcessErrorHandler,
  uninstallProcessErrorHandler,
} from './utils/process-error-handler.js';

/**
 * Defines the configuration options for the `prebidExplorer` function.
 * These options control various aspects of the Prebid.js scanning process,
 * including URL sources, Puppeteer settings, concurrency, and output.
 */
export interface PrebidExplorerOptions {
  /** Optional path to an input file containing URLs to scan (e.g., .txt, .json, .csv). */
  inputFile?: string; // Make optional as it might not be needed if githubRepo is used
  /** Optional path to a CSV file (currently unused, consider for future use or removal). */
  csvFile?: string;
  /** Optional URL of a GitHub repository or direct file link to fetch URLs from. */
  githubRepo?: string;
  /** Optional maximum number of URLs to process from the source. */
  numUrls?: number;
  /** The type of Puppeteer execution: 'vanilla' (single browser instance) or 'cluster' (multiple instances). */
  puppeteerType: 'vanilla' | 'cluster';
  /** The maximum number of concurrent Puppeteer instances/pages when using 'cluster' mode. */
  concurrency: number;
  /** Whether to run Puppeteer in headless mode. */
  headless: boolean;
  /** Whether to enable Puppeteer cluster monitoring (if 'cluster' mode is used). */
  monitor: boolean;
  /** The directory where output JSON files will be saved. */
  /** The directory where output JSON files containing scan results will be saved. */
  outputDir: string;
  /** The directory where log files (e.g., activity logs, error logs) will be saved. */
  logDir: string;
  /**
   * Optional Puppeteer launch options to customize browser instantiation.
   * @see https://pptr.dev/api/puppeteer.puppeteerlaunchoptions
   * @example { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
   */
  puppeteerLaunchOptions?: PuppeteerLaunchOptions;
  /**
   * Optional string specifying a range of URLs to process from the input list (1-based index).
   * Useful for splitting large lists or resuming partial scans.
   * @example "1-100", "50-", "-200"
   */
  range?: string;
  /**
   * Optional number of URLs to process in each batch or chunk.
   * If set to 0 or undefined, all URLs are processed in a single batch (or per cluster limits).
   * Useful for managing resources or if processing needs to be intermittent.
   */
  chunkSize?: number;
  /**
   * Whether to skip URLs that have been previously processed successfully.
   * When enabled, uses SQLite database to track and filter out processed URLs.
   * Defaults to false for backward compatibility.
   */
  skipProcessed?: boolean;
  /**
   * Whether to reset the URL tracking database before starting.
   * When enabled, clears all previously tracked URLs.
   * Defaults to false.
   */
  resetTracking?: boolean;
  /**
   * Whether to check database BEFORE loading URLs to skip entirely processed ranges.
   * More efficient than skipProcessed for large lists as it avoids loading unnecessary URLs.
   * Defaults to false.
   */
  prefilterProcessed?: boolean;
  /**
   * Whether to force reprocessing of URLs even if they were previously processed.
   * Explicit alternative to resetTracking that doesn't clear the entire database.
   * Defaults to false.
   */
  forceReprocess?: boolean;
  /**
   * Whether to enable discovery mode to detect unknown ad tech libraries.
   * When enabled, captures unrecognized global variables that match ad tech patterns.
   * Defaults to false.
   */
  discoveryMode?: boolean;
  /**
   * Whether to extract comprehensive page metadata including Schema.org, OpenGraph,
   * Twitter Cards, and site categorization signals. Adds significant data to output.
   * Defaults to false.
   */
  extractMetadata?: boolean;
  /**
   * Whether to enable pre-flight checks (DNS, SSL) to skip dead/invalid sites
   * before browser launch. Reduces errors but adds initial overhead.
   * Defaults to false.
   */
  preflightCheck?: boolean;
  /**
   * Whether to skip URLs that fail DNS resolution during pre-flight check.
   * Requires preflightCheck to be enabled. Defaults to true.
   */
  skipDNSFailed?: boolean;
  /**
   * Whether to skip URLs that fail SSL validation during pre-flight check.
   * Requires preflightCheck to be enabled. Defaults to false.
   */
  skipSSLFailed?: boolean;
  /**
   * Level of detail for ad unit extraction:
   * - "basic": Media types only (e.g., ["banner", "video"])
   * - "standard": Media types and sizes
   * - "full": All details including mimes, protocols, etc.
   * Defaults to "basic".
   */
  adUnitDetail?: 'basic' | 'standard' | 'full';
  /**
   * Level of module categorization:
   * - "simple": All modules in single array for backward compatibility
   * - "categorized": Separate modules into userIds, analytics, consent, video, rtd, etc.
   * Defaults to "simple".
   */
  moduleDetail?: 'simple' | 'categorized';
}

let logger: WinstonLogger; // Global logger instance, initialized within prebidExplorer.

// Apply puppeteer-extra plugins.
// The 'as any' and 'as unknown as typeof puppeteerVanilla' casts are a common way
// to handle the dynamic nature of puppeteer-extra plugins while retaining type safety
// for the core puppeteerVanilla methods.
const puppeteer = addExtra(
  puppeteerVanilla as any // Changed from unknown to any
) as unknown as typeof puppeteerVanilla;

/**
 * The main entry point for the Prebid Explorer tool.
 * This asynchronous function orchestrates the entire process of:
 * 1. Initializing logging.
 * 2. Applying Puppeteer plugins (Stealth, Block Resources).
 * 3. Determining the source of URLs (GitHub or local file) and loading them.
 * 4. Filtering URLs based on the specified range, if any.
 * 5. Launching Puppeteer (either a single instance or a cluster for concurrency).
 * 6. Processing each URL in chunks (if specified) using the `processPageTask`.
 * 7. Collecting and logging results from each task.
 * 8. Writing aggregated successful results to JSON files.
 * 9. Updating the input file if applicable (e.g., removing successfully processed URLs).
 *
 * @param {PrebidExplorerOptions} options - An object containing all configuration settings
 *                                          for the current run of the Prebid Explorer.
 * @returns {Promise<void>} A promise that resolves when all URLs have been processed and
 *                          results have been handled, or rejects if a critical error occurs
 *                          during setup or orchestration.
 * @example
 * const options = {
 *   inputFile: "urls.txt",
 *   outputDir: "output_results",
 *   logDir: "logs",
 *   puppeteerType: 'cluster',
 *   concurrency: 5,
 *   headless: true,
 *   monitor: false,
 *   chunkSize: 100,
 *   range: "1-500"
 * };
 * prebidExplorer(options)
 *   .then(() => console.log("Prebid Explorer finished."))
 *   .catch(error => console.error("Prebid Explorer failed:", error));
 */
export async function prebidExplorer(
  options: PrebidExplorerOptions
): Promise<void> {
  logger = initializeLogger(options.logDir); // Initialize the global logger
  initializeTelemetry('prebid-integration-monitor');

  // Install global error handlers to catch puppeteer-cluster errors
  installProcessErrorHandler(logger);

  logger.info('Starting Prebid Explorer with options:', options);

  // Initialize error file headers for better organization
  createErrorFileHeaders(logger);

  // Initialize URL tracker for deduplication
  const urlTracker = getUrlTracker(logger);

  // Reset tracking if requested
  if (options.resetTracking) {
    logger.info('Resetting URL tracking database...');
    urlTracker.resetTracking();
  }

  // Import existing results if skip-processed is enabled and database is empty
  if (options.skipProcessed) {
    const stats = urlTracker.getStats();
    if (Object.keys(stats).length === 0) {
      logger.info(
        'URL tracking database is empty. Importing existing results...'
      );
      await urlTracker.importExistingResults(path.join(process.cwd(), 'store'));
    }
    logger.info('URL tracker statistics:', stats);
  }

  // Apply puppeteer-extra stealth plugin to help avoid bot detection
  // Cast puppeteer to any before calling use
  (puppeteer as any).use(StealthPlugin()); // Changed cast

  // Define specific type for blocked resource types for clarity
  type ResourceType =
    | 'image'
    | 'font'
    | 'websocket'
    | 'media'
    | 'texttrack'
    | 'eventsource'
    | 'manifest'
    | 'other'
    | 'stylesheet'
    | 'script'
    | 'xhr';

  const resourcesToBlock: Set<ResourceType> = new Set<ResourceType>([
    'image',
    'font',
    'media', // Common non-essential resources for ad tech scanning
    'texttrack',
    'eventsource',
    'manifest',
    'other',
    // 'stylesheet', 'script', 'xhr', 'websocket' are usually essential and not blocked.
  ]);
  // Accessing .default property for the factory, or using the module itself if .default is not present
  const factory = ((BlockResourcesModule as any).default ||
    BlockResourcesModule) as any;
  const blockResourcesPluginInstance = factory({
    // Changed factory definition and call
    blockedTypes: resourcesToBlock,
  });
  // Cast puppeteer to any before calling use
  (puppeteer as any).use(blockResourcesPluginInstance); // Changed cast
  logger.info(
    `Configured to block resource types: ${Array.from(resourcesToBlock).join(', ')}`
  );

  const basePuppeteerOptions: PuppeteerLaunchOptions = {
    protocolTimeout: 1000000, // Increased timeout for browser protocol communication.
    defaultViewport: null, // Sets the viewport to null, effectively using the default viewport of the browser window.
    headless: options.headless,
    args: [
      ...ENHANCED_PUPPETEER_ARGS, // Use enhanced args for better stability
      ...(options.puppeteerLaunchOptions?.args || []), // Allow additional custom args
    ],
    ...(options.puppeteerLaunchOptions || {}), // Ensures options.puppeteerLaunchOptions is an object before spreading
  };

  // results array is correctly typed with PageData from puppeteer-task.ts
  let taskResults: TaskResult[] = []; // Using let to allow reassignment after retry
  /** @type {string[]} Array to store all URLs fetched from the specified source. */
  let allUrls: string[] = [];
  /** @type {Set<string>} Set to keep track of URLs that have been processed or are queued for processing. */
  const processedUrls: Set<string> = new Set();
  /** @type {string} String to identify the source of URLs (e.g., 'GitHub', 'InputFile'). */
  let urlSourceType = ''; // To track the source for logging and file updates

  // Determine the source of URLs (GitHub or local file) and fetch them.
  const urlLoadingTracer = new URLLoadingTracer(
    options.githubRepo || options.inputFile || 'unknown',
    logger
  );

  if (options.githubRepo) {
    urlSourceType = 'GitHub';

    // Parse range for optimization
    let rangeOptions: { startRange?: number; endRange?: number } | undefined;
    if (options.range) {
      const [startStr, endStr] = options.range.split('-');
      rangeOptions = {
        startRange: startStr ? parseInt(startStr, 10) : undefined,
        endRange: endStr ? parseInt(endStr, 10) : undefined,
      };
      logger.info(`Using optimized range processing: ${options.range}`);
      logger.info(`DEBUG: Parsed range - startRange=${rangeOptions.startRange}, endRange=${rangeOptions.endRange}`);
    }

    const urlLimit = options.range ? undefined : options.numUrls;
    logger.info(`DEBUG: Calling fetchUrlsFromGitHub with urlLimit=${urlLimit}, rangeOptions=${JSON.stringify(rangeOptions)}`);
    allUrls = await fetchUrlsFromGitHub(
      options.githubRepo,
      urlLimit,
      logger,
      rangeOptions
    );
    urlLoadingTracer.recordUrlCount(allUrls.length, 'github_fetch');
    if (allUrls.length > 0) {
      logger.info(
        `Successfully loaded ${allUrls.length} URLs from GitHub repository: ${options.githubRepo}`
      );
    } else {
      logger.warn(
        `No URLs found or fetched from GitHub repository: ${options.githubRepo}.`
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
        `Processing local file: ${options.inputFile} (detected type: ${fileType})`
      );
      allUrls = await processFileContent(
        options.inputFile,
        fileContent,
        logger
      );
      urlLoadingTracer.recordUrlCount(allUrls.length, 'file_processing');
      if (allUrls.length > 0) {
        logger.info(
          `Successfully loaded ${allUrls.length} URLs from local ${fileType.toUpperCase()} file: ${options.inputFile}`
        );
      } else {
        logger.warn(
          `No URLs extracted from local ${fileType.toUpperCase()} file: ${options.inputFile}. Check file content and type handling.`
        );
      }
    } else {
      // loadFileContents already logs the error, but we should ensure allUrls is empty and potentially throw
      allUrls = []; // Ensure allUrls is empty if file read failed
      logger.error(
        `Failed to load content from input file ${options.inputFile}. Cannot proceed with this source.`
      );
      // Depending on desired behavior, you might want to throw an error here
      // For now, it will proceed to the "No URLs to process" check.
    }
  } else {
    // This case should ideally be prevented by CLI validation in scan.ts
    logger.error(
      'No URL source provided. Either --githubRepo or inputFile argument must be specified.'
    );
    throw new Error('No URL source specified.');
  }

  // Exit if no URLs were found from the specified source.
  if (allUrls.length === 0) {
    urlLoadingTracer.finish(0);
    logger.warn(
      `No URLs to process from ${urlSourceType || 'any specified source'}. Exiting.`
    );
    return;
  }
  urlLoadingTracer.finish(allUrls.length);
  logger.info(`Initial total URLs found: ${allUrls.length}`, {
    firstFew: allUrls.slice(0, 5),
  });
  
  // DEBUG: Check for Amazon
  if (allUrls.some(url => url.toLowerCase().includes('amazon.com'))) {
    logger.error('🚨 DEBUG: Amazon.com found in URL list! This should not happen with range 146001+');
    const amazonIndex = allUrls.findIndex(url => url.toLowerCase().includes('amazon.com'));
    logger.error(`Amazon found at index ${amazonIndex}: ${allUrls[amazonIndex]}`);
  }

  // 1. URL Range Logic
  // Apply URL range filtering if specified in options, but only for non-GitHub sources
  // (GitHub sources already apply range optimization during fetching)
  const filteringTracer = new URLFilteringTracer(allUrls.length, logger);

  if (options.range && urlSourceType !== 'GitHub') {
    logger.info(`Applying range: ${options.range}`);
    const originalUrlCount = allUrls.length;
    let [startStr, endStr] = options.range.split('-');
    let start = startStr ? parseInt(startStr, 10) : 1;
    let end = endStr ? parseInt(endStr, 10) : allUrls.length;

    if (isNaN(start) || isNaN(end) || start < 0 || end < 0) {
      // Allow start = 0 for internal 0-based, but user input is 1-based
      logger.warn(
        `Invalid range format: "${options.range}". Proceeding with all URLs. Start and end must be numbers. User input is 1-based.`
      );
    } else {
      // Convert 1-based to 0-based indices
      start = start > 0 ? start - 1 : 0; // If user enters 0 or negative, treat as start from beginning
      end = end > 0 ? end : allUrls.length; // If user enters 0 or negative for end, or leaves it empty, treat as end of list

      if (start >= allUrls.length) {
        logger.warn(
          `Start of range (${start + 1}) is beyond the total number of URLs (${allUrls.length}). No URLs to process.`
        );
        allUrls = [];
      } else if (start > end - 1) {
        logger.warn(
          `Start of range (${start + 1}) is greater than end of range (${end}). Proceeding with URLs from start to end of list.`
        );
        allUrls = allUrls.slice(start);
      } else {
        allUrls = allUrls.slice(start, end); // end is exclusive for slice, matches 0-based end index
        filteringTracer.recordRangeFiltering(
          originalUrlCount,
          allUrls.length,
          options.range
        );
        logger.info(
          `Applied range: Processing URLs from ${start + 1} to ${Math.min(end, originalUrlCount)} (0-based index ${start} to ${Math.min(end, originalUrlCount) - 1}). Total URLs after range: ${allUrls.length} (out of ${originalUrlCount}).`
        );
      }
    }
  } else if (options.range && urlSourceType === 'GitHub') {
    logger.info(
      `Range ${options.range} already applied during GitHub fetch optimization. Skipping duplicate range filtering.`
    );
    filteringTracer.recordRangeFiltering(
      allUrls.length,
      allUrls.length,
      options.range
    );
  }

  if (allUrls.length === 0) {
    logger.warn(
      `No URLs to process after applying range or due to empty initial list. Exiting.`
    );
    return;
  }
  logger.info(`Total URLs to process after range check: ${allUrls.length}`, {
    firstFew: allUrls.slice(0, 5),
  });

  // Debug logging for range issues
  if (options.range) {
    logger.info(`DEBUG: Processing with range ${options.range}, allUrls.length=${allUrls.length}`);
    logger.info(`DEBUG: First 5 URLs: ${allUrls.slice(0, 5).join(', ')}`);
    logger.info(`DEBUG: Last 5 URLs: ${allUrls.slice(-5).join(', ')}`);
  }

  // Pre-filter processed URLs if requested (more efficient for large lists)
  if (options.prefilterProcessed) {
    logger.info('Pre-filtering processed URLs before loading full range...');

    // Analyze the current range efficiency
    if (options.range) {
      const [startStr, endStr] = options.range.split('-');
      const start = startStr ? parseInt(startStr, 10) - 1 : 0; // Convert to 0-based
      const end = endStr ? parseInt(endStr, 10) : allUrls.length;

      // Reload all URLs temporarily to analyze efficiency
      let fullUrlList: string[] = [];
      if (options.githubRepo) {
        fullUrlList = await fetchUrlsFromGitHub(
          options.githubRepo,
          undefined,
          logger
        );
      } else if (options.inputFile) {
        const fileContent = loadFileContents(options.inputFile, logger);
        if (fileContent) {
          fullUrlList = await processFileContent(
            options.inputFile,
            fileContent,
            logger
          );
        }
      }

      if (fullUrlList.length > 0) {
        const analysis = urlTracker.analyzeUrlRange(
          start,
          Math.min(end, fullUrlList.length),
          fullUrlList
        );

        logger.info('Range analysis results:', {
          totalInRange: analysis.totalInRange,
          processedCount: analysis.processedCount,
          unprocessedCount: analysis.unprocessedCount,
          processedPercentage: analysis.processedPercentage.toFixed(1) + '%',
        });
        
        // Show sample URLs from the range to help user verify they're looking at the right range
        if (allUrls.length > 0) {
          logger.info(`Sample URLs from range ${options.range}:`, {
            first5: allUrls.slice(0, 5),
            last5: allUrls.slice(-5),
          });
        }

        if (analysis.isFullyProcessed) {
          logger.info(
            '🎯 RANGE FULLY PROCESSED: All URLs in this range have been processed!'
          );

          // Suggest next ranges
          const suggestions = urlTracker.suggestNextRanges(
            fullUrlList,
            1000,
            3
          );
          if (suggestions.length > 0) {
            logger.info('💡 SUGGESTED NEXT RANGES:');
            suggestions.forEach((suggestion, index) => {
              logger.info(
                `   ${index + 1}. --range "${suggestion.startUrl}-${suggestion.endUrl}" (~${suggestion.estimatedUnprocessed} unprocessed, ${suggestion.efficiency.toFixed(1)}% efficiency)`
              );
            });
          }

          logger.info(
            'Use --forceReprocess to reprocess this range, or choose a different range.'
          );
          closeUrlTracker();
          return;
        } else if (analysis.processedPercentage > 80) {
          logger.warn(
            `⚠️  LOW EFFICIENCY: ${analysis.processedPercentage.toFixed(1)}% of URLs already processed`
          );
          logger.info(
            'Consider using --forceReprocess or choosing a different range for better efficiency.'
          );
        }
      }
    }
  }

  // Track URLs skipped due to skip-processed
  let urlsSkippedProcessed = 0;

  // Handle different processing modes
  if (options.forceReprocess) {
    logger.info(
      '🔄 FORCE REPROCESS: Processing all URLs regardless of previous status'
    );
    // Don't filter anything - process all URLs
  } else if (options.skipProcessed) {
    logger.info('Filtering out previously processed URLs within the range...');
    const originalCount = allUrls.length;
    
    // When we have a range, we need to maintain positional integrity
    // The range should always refer to positions in the original file
    if (options.range) {
      // Filter but keep track of original positions
      const filteredUrls: string[] = [];
      for (const url of allUrls) {
        if (!urlTracker.isUrlProcessed(url)) {
          filteredUrls.push(url);
        } else {
          urlsSkippedProcessed++;
        }
      }
      allUrls = filteredUrls;
      
      logger.info(
        `Range filtering complete: ${originalCount} URLs in range ${options.range}, ${allUrls.length} unprocessed, ${urlsSkippedProcessed} skipped`
      );
    } else {
      // For non-range processing, use the existing bulk filter
      allUrls = urlTracker.filterUnprocessedUrls(allUrls);
      urlsSkippedProcessed = originalCount - allUrls.length;
    }
    
    filteringTracer.recordProcessedFiltering(
      originalCount,
      allUrls.length,
      urlsSkippedProcessed
    );

    if (allUrls.length === 0) {
      logger.info('All URLs have been previously processed.');

      // Log summary even when exiting early
      const originalUrlCount = originalCount;
      const skippedUrlCount = urlsSkippedProcessed;
      const processedUrlCount = 0;

      logger.info('========================================');
      logger.info('SCAN SUMMARY');
      logger.info('========================================');

      if (options.range) {
        logger.info(`📋 URL range processed: ${options.range}`);
      }

      logger.info(`📊 Total URLs in range: ${originalUrlCount}`);
      logger.info(`🔄 URLs actually processed: ${processedUrlCount}`);
      logger.info(`⏭️  URLs skipped (already processed): ${skippedUrlCount}`);
      logger.info(`💡 All URLs in this range were previously processed.`);
      logger.info(`   Use --forceReprocess to reprocess them anyway.`);
      logger.info('========================================');

      closeUrlTracker();
      return;
    }
  }

  // Pre-filter URLs for valid domains to avoid expensive Puppeteer operations on invalid domains
  logger.info('Pre-filtering URLs for domain validity...');
  const preFilterCount = allUrls.length;
  allUrls = await filterValidUrls(allUrls, logger, false); // Pattern-only validation for speed
  filteringTracer.recordDomainFiltering(preFilterCount, allUrls.length);
  logger.info(
    `Domain pre-filtering complete: ${preFilterCount} total, ${allUrls.length} valid, ${preFilterCount - allUrls.length} filtered out`
  );

  if (allUrls.length === 0) {
    filteringTracer.finish(0);
    logger.warn('No valid URLs remaining after domain filtering. Exiting.');
    closeUrlTracker();
    return;
  }

  filteringTracer.finish(allUrls.length);

  // Initialize domain health tracker for error recovery
  const domainHealthTracker = new DomainHealthTracker(logger);

  // Pre-flight checks if enabled
  let urlsToProcess = allUrls;
  let preflightSkipped = 0;
  
  if (options.preflightCheck) {
    logger.info('========================================');
    logger.info('🔍 STARTING PRE-FLIGHT CHECKS');
    logger.info('========================================');
    
    const preflightChecker = new PreflightChecker(domainHealthTracker, logger);
    const preflightStartTime = Date.now();
    
    const preflightResults = await preflightChecker.checkUrls(urlsToProcess, {
      checkDNS: true,
      checkSSL: true,
      checkHealth: true,
      dnsConcurrency: 50,
      sslConcurrency: 10
    });
    
    const preflightDuration = (Date.now() - preflightStartTime) / 1000;
    logger.info(`Pre-flight checks completed in ${preflightDuration.toFixed(1)} seconds`);
    
    // Filter URLs based on pre-flight results
    const originalPreflightCount = urlsToProcess.length;
    const processableUrls: string[] = [];
    const skippedUrls: string[] = [];
    
    for (const url of urlsToProcess) {
      const result = preflightResults.get(url);
      if (!result) {
        processableUrls.push(url);
        continue;
      }
      
      // Skip based on flags
      if (!result.passedDNS && options.skipDNSFailed) {
        skippedUrls.push(url);
        logger.debug(`Skipping ${url}: DNS lookup failed`);
      } else if (!result.passedSSL && options.skipSSLFailed) {
        skippedUrls.push(url);
        logger.debug(`Skipping ${url}: SSL validation failed`);
      } else {
        processableUrls.push(url);
        
        // Log warnings for URLs we're still processing
        if (result.warnings && result.warnings.length > 0) {
          logger.debug(`Processing ${url} with warnings: ${result.warnings.join(', ')}`);
        }
      }
    }
    
    urlsToProcess = processableUrls;
    preflightSkipped = skippedUrls.length;
    
    // Write skipped URLs to error files
    if (skippedUrls.length > 0) {
      const dnsFailedUrls = skippedUrls.filter(url => {
        const result = preflightResults.get(url);
        return result && !result.passedDNS;
      });
      
      const sslFailedUrls = skippedUrls.filter(url => {
        const result = preflightResults.get(url);
        return result && result.passedDNS && !result.passedSSL;
      });
      
      // Write DNS failures to navigation errors file
      if (dnsFailedUrls.length > 0) {
        const timestamp = new Date().toISOString();
        const dnsErrorEntries = dnsFailedUrls.map(url => {
          const result = preflightResults.get(url);
          return `[${timestamp}] | Category: network/dns | Phase: preflight | Code: DNS_RESOLUTION_FAILED | URL: ${url} | Message: ${result?.skipReason || 'DNS lookup failed'}`;
        });
        
        const navigationErrorPath = path.join(process.cwd(), 'errors', 'navigation_errors.txt');
        try {
          fs.appendFileSync(navigationErrorPath, dnsErrorEntries.join('\n') + '\n', 'utf8');
          logger.info(`Wrote ${dnsFailedUrls.length} DNS failures to navigation_errors.txt`);
        } catch (error) {
          logger.error('Failed to write DNS errors to file', error);
        }
      }
      
      // Write SSL failures to SSL errors file
      if (sslFailedUrls.length > 0) {
        const timestamp = new Date().toISOString();
        const sslErrorEntries = sslFailedUrls.map(url => {
          const result = preflightResults.get(url);
          return `[${timestamp}] | Category: ssl/validation | Phase: preflight | Code: SSL_VALIDATION_FAILED | URL: ${url} | Message: ${result?.skipReason || 'SSL validation failed'}`;
        });
        
        const sslErrorPath = path.join(process.cwd(), 'errors', 'ssl_errors.txt');
        try {
          fs.appendFileSync(sslErrorPath, sslErrorEntries.join('\n') + '\n', 'utf8');
          logger.info(`Wrote ${sslFailedUrls.length} SSL failures to ssl_errors.txt`);
        } catch (error) {
          logger.error('Failed to write SSL errors to file', error);
        }
      }
    }
    
    logger.info('========================================');
    logger.info('PRE-FLIGHT CHECK SUMMARY');
    logger.info('========================================');
    logger.info(`📊 Total URLs checked: ${originalPreflightCount}`);
    logger.info(`✅ Passed pre-flight: ${processableUrls.length}`);
    logger.info(`❌ Failed pre-flight: ${preflightSkipped}`);
    
    if (preflightSkipped > 0) {
      const dnsFailCount = skippedUrls.filter(url => {
        const result = preflightResults.get(url);
        return result && !result.passedDNS;
      }).length;
      
      const sslFailCount = skippedUrls.filter(url => {
        const result = preflightResults.get(url);
        return result && result.passedDNS && !result.passedSSL;
      }).length;
      
      if (dnsFailCount > 0) {
        logger.info(`   🚫 DNS failures: ${dnsFailCount}`);
      }
      if (sslFailCount > 0) {
        logger.info(`   🔒 SSL failures: ${sslFailCount}`);
      }
    }
    logger.info('========================================');
    
    if (urlsToProcess.length === 0) {
      logger.warn('No URLs passed pre-flight checks. Exiting.');
      closeUrlTracker();
      return;
    }
  }

  // Define the core processing task (used by both vanilla and cluster)
  // Note: The actual definition of processPageTask is now imported.
  // We pass it to the cluster or call it directly, along with the logger.

  // 2. Chunk Processing Logic
  /** @type {number} Size of chunks for processing URLs. 0 means no chunking. */
  const chunkSize =
    options.chunkSize && options.chunkSize > 0 ? options.chunkSize : 0;

  // Process URLs in chunks if chunkSize is specified.
  if (chunkSize > 0) {
    logger.info(`Chunked processing enabled. Chunk size: ${chunkSize}`);
    const totalChunks = Math.ceil(urlsToProcess.length / chunkSize);
    logger.info(`Total chunks to process: ${totalChunks}`);

    for (let i = 0; i < urlsToProcess.length; i += chunkSize) {
      const currentChunkUrls = urlsToProcess.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      logger.info(
        `Processing chunk ${chunkNumber} of ${totalChunks}: URLs ${i + 1}-${Math.min(i + chunkSize, urlsToProcess.length)}`
      );

      // Process the current chunk using either 'cluster' or 'vanilla' Puppeteer mode.
      if (options.puppeteerType === 'cluster') {
        // Use the safer processUrlsWithRecovery for chunked processing too
        logger.info(
          `Using enhanced cluster processing with automatic recovery for chunk ${chunkNumber}...`
        );

        try {
          await processUrlsWithRecovery(
            currentChunkUrls,
            {
              concurrency: options.concurrency,
              maxConcurrency: options.concurrency,
              monitor: options.monitor,
              puppeteer,
              puppeteerOptions: basePuppeteerOptions,
              logger,
              maxRetries: 2,
              onTaskComplete: (result) => {
                // Track results as they complete
                taskResults.push(result);
                const url =
                  result.type === 'error' || result.type === 'no_data'
                    ? result.url
                    : result.data.url;
                if (url) {
                  processedUrls.add(url);
                }
              },
            },
            (processed, total) => {
              // Progress callback for chunk
              if (processed % 10 === 0 || processed === total) {
                logger.info(
                  `Chunk ${chunkNumber} progress: ${processed}/${total} URLs processed`
                );
              }
            }
          );

          // Results are already added via onTaskComplete callback
          // Just ensure all URLs are marked as processed
          currentChunkUrls.forEach((url) => processedUrls.add(url));
        } catch (error) {
          logger.error(
            `Fatal error in chunk ${chunkNumber} cluster processing:`,
            error
          );

          // Add error results for any URLs in this chunk that weren't processed
          for (const url of currentChunkUrls) {
            if (
              !taskResults.some(
                (r) =>
                  (r.type === 'error' || r.type === 'no_data'
                    ? r.url
                    : r.data?.url) === url
              )
            ) {
              taskResults.push({
                type: 'error',
                url: url,
                error: {
                  code: 'CHUNK_PROCESSING_ERROR',
                  message: `Chunk ${chunkNumber} processing failed: ${(error as Error).message}`,
                  stack: (error as Error).stack,
                },
              });
            }
          }
        }
      } else {
        // 'vanilla' Puppeteer for the current chunk
        let browser: Browser | null = null;
        try {
          browser = await puppeteer.launch(basePuppeteerOptions);
          for (const url of currentChunkUrls) {
            if (url) {
              const page = await browser.newPage();
              // Call the imported processPageTask directly
              const result = await processPageTask({
                page,
                data: { 
                  url, 
                  logger, 
                  discoveryMode: options.discoveryMode,
                  extractMetadata: options.extractMetadata,
                  adUnitDetail: options.adUnitDetail 
                },
              });
              taskResults.push(result);
              await page.close();
              processedUrls.add(url); // Add to global processedUrls
            }
          }
        } catch (error: unknown) {
          logger.error(
            `An error occurred during processing chunk ${chunkNumber} with vanilla Puppeteer.`,
            { error }
          );
        } finally {
          if (browser) await browser.close();
        }
      }
      logger.info(
        `Finished processing chunk ${chunkNumber} of ${totalChunks}.`
      );
    }
  } else {
    // Process all URLs at once (no chunking)
    logger.info(
      `Processing all ${urlsToProcess.length} URLs without chunking.`
    );

    // Use safer cluster processing for better stability
    if (options.puppeteerType === 'cluster' && urlsToProcess.length > 0) {
      logger.info(
        'Using enhanced cluster processing with automatic recovery...'
      );

      try {
        const clusterResults = await processUrlsWithRecovery(
          urlsToProcess,
          {
            concurrency: options.concurrency,
            maxConcurrency: options.concurrency,
            monitor: options.monitor,
            puppeteer,
            puppeteerOptions: basePuppeteerOptions,
            logger,
            maxRetries: 2,
          },
          (processed, total) => {
            if (processed % 10 === 0) {
              logger.info(`Progress: ${processed}/${total} URLs processed`);
            }
          }
        );

        taskResults.push(...clusterResults);
        urlsToProcess.forEach((url) => processedUrls.add(url));
      } catch (error) {
        logger.error(
          'Cluster processing failed, falling back to browser pool:',
          error
        );

        // Fallback to browser pool if cluster fails
        try {
          logger.info('Using browser pool as fallback...');
          const poolResults = await processUrlsWithBrowserPool(
            urlsToProcess,
            {
              concurrency: options.concurrency,
              puppeteerOptions: basePuppeteerOptions,
              logger,
            },
            (processed, total) => {
              if (processed % 10 === 0) {
                logger.info(
                  `Progress: ${processed}/${total} URLs processed (browser pool)`
                );
              }
            }
          );

          taskResults.push(...poolResults);
          urlsToProcess.forEach((url) => processedUrls.add(url));
        } catch (poolError) {
          logger.error('Browser pool also failed:', poolError);
          throw poolError;
        }
      }
    } else if (options.puppeteerType === 'cluster') {
      const cluster: Cluster<
        { url: string; logger: WinstonLogger; discoveryMode?: boolean; extractMetadata?: boolean; adUnitDetail?: 'basic' | 'standard' | 'full'; moduleDetail?: 'simple' | 'categorized' },
        TaskResult
      > = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: options.concurrency,
        monitor: options.monitor,
        puppeteer,
        puppeteerOptions: basePuppeteerOptions,
      });

      // Create cluster health monitor
      const clusterHealthMonitor = new ClusterHealthMonitor(logger);
      clusterHealthMonitor.startMonitoring(cluster);

      // Register cluster error handlers
      cluster.on('taskerror', (err, data) => {
        // Only log debug level for common lifecycle errors
        if (
          err.message &&
          err.message.includes('Requesting main frame too early')
        ) {
          logger.debug(
            `Main frame lifecycle error for ${data.url}: ${err.message}`
          );

          // Create error result to ensure it's tracked
          const errorResult: TaskResult = {
            type: 'error',
            url: data.url,
            error: {
              code: 'PUPPETEER_MAIN_FRAME_ERROR',
              message: err.message,
              stack: err.stack,
            },
          };

          // Ensure the error is recorded
          if (
            !taskResults.some(
              (r) =>
                (r.type === 'error' || r.type === 'no_data') &&
                r.url === data.url
            )
          ) {
            taskResults.push(errorResult);
          }
        } else {
          logger.error(`Cluster task error for ${data.url}:`, err);
        }
      });

      // Register a wrapper task that properly calls processPageTask and collects results
      await cluster.task(async ({ page, data }) => {
        const pageTracer = new PageLifecycleTracer(data.url, logger);
        const span = pageTracer.startPageProcessing();

        try {
          // Set aggressive timeouts to prevent hanging
          await page.setDefaultTimeout(30000); // 30 second timeout
          await page.setDefaultNavigationTimeout(30000);

          // Setup page event handlers for tracking
          pageTracer.setupPageEventHandlers(page);

          // Add page error handler to catch frame errors
          page.on('error', (error) => {
            if (error.message.includes('Requesting main frame too early')) {
              logger.debug(
                `Page lifecycle error for ${data.url}: ${error.message}`
              );
              // Don't let this crash the cluster
              pageTracer.recordEvent('critical_main_frame_error', error);
            } else {
              logger.error(`Page error for ${data.url}:`, error);
            }
          });

          const result = await processPageTask({ page, data });
          taskResults.push(result);
          pageTracer.finish(
            true,
            result.type === 'success' ? result.data : undefined
          );
          return result;
        } catch (error: unknown) {
          const err = error as Error;
          pageTracer.finishWithError(err);

          // Handle "Requesting main frame too early" error specifically
          if (
            err.message &&
            err.message.includes('Requesting main frame too early')
          ) {
            logger.debug(
              `Puppeteer lifecycle error for ${data.url}: ${err.message}`
            );
            const errorResult: TaskResult = {
              type: 'error',
              url: data.url,
              error: {
                code: 'PUPPETEER_MAIN_FRAME_ERROR',
                message: err.message,
                stack: err.stack,
              },
            };
            taskResults.push(errorResult);
            return errorResult;
          }
          // For other errors, also return error result instead of throwing
          const errorResult: TaskResult = {
            type: 'error',
            url: data.url,
            error: {
              code: 'UNKNOWN_ERROR',
              message: err.message,
              stack: err.stack,
            },
          };
          taskResults.push(errorResult);
          return errorResult;
        }
      });

      try {
        const promises = urlsToProcess
          .filter((url) => url)
          .map((url) => {
            processedUrls.add(url);

            // Wrap cluster.queue in try-catch to handle queue errors
            try {
              return cluster.queue({
                url,
                logger,
                discoveryMode: options.discoveryMode,
                extractMetadata: options.extractMetadata,
                adUnitDetail: options.adUnitDetail,
                moduleDetail: options.moduleDetail,
              });
            } catch (queueError) {
              logger.error(`Failed to queue URL ${url}:`, queueError);
              // Create error result for queue failures
              const errorResult: TaskResult = {
                type: 'error',
                url: url,
                error: {
                  code: 'QUEUE_ERROR',
                  message: (queueError as Error).message,
                  stack: (queueError as Error).stack,
                },
              };
              taskResults.push(errorResult);
              return Promise.resolve(); // Return resolved promise to continue
            }
          });

        await Promise.allSettled(promises);

        // Check cluster health before closing
        const healthStatus = clusterHealthMonitor.getHealthStatus();
        if (!healthStatus.healthy) {
          logger.warn('Cluster unhealthy at end of processing:', healthStatus);
        }

        // Results are now collected directly in the cluster task handler
        await cluster.idle();
        await cluster.close();
        clusterHealthMonitor.stopMonitoring();
      } catch (error: unknown) {
        logger.error(
          'An unexpected error occurred during cluster processing orchestration',
          { error }
        );
        // Cast cluster to any before calling isClosed and close
        if (cluster && !(cluster as any).isClosed())
          // Changed cast
          await (cluster as any).close();
      }
    } else {
      // 'vanilla' Puppeteer
      let browser: Browser | null = null;
      try {
        browser = await puppeteer.launch(basePuppeteerOptions);
        for (const url of urlsToProcess) {
          if (url) {
            const page = await browser.newPage();
            const result = await processPageTask({
              page,
              data: { 
                url, 
                logger, 
                discoveryMode: options.discoveryMode,
                extractMetadata: options.extractMetadata,
                adUnitDetail: options.adUnitDetail 
              },
            });
            taskResults.push(result);
            await page.close();
            processedUrls.add(url);
          }
        }
      } catch (error: unknown) {
        logger.error(
          'An unexpected error occurred during vanilla Puppeteer processing',
          { error }
        );
      } finally {
        if (browser) await browser.close();
      }
    }
  }

  // Separate timeout errors for retry
  const timeoutErrors: { url: string; originalError: TaskResult }[] = [];
  const nonTimeoutResults: TaskResult[] = [];

  for (const result of taskResults) {
    if (
      result.type === 'error' &&
      result.error.message &&
      result.error.message.toLowerCase().includes('timeout')
    ) {
      timeoutErrors.push({ url: result.url, originalError: result });
    } else {
      nonTimeoutResults.push(result);
    }
  }

  // Retry timeout errors at the end of batch with more lenient settings
  if (timeoutErrors.length > 0) {
    logger.info('========================================');
    logger.info(`RETRYING ${timeoutErrors.length} TIMEOUT ERRORS`);
    logger.info('========================================');
    logger.info('Using extended timeout and relaxed settings for retries...');

    const retryResults: TaskResult[] = [];
    
    // Create a special puppeteer instance with even more lenient settings for retries
    const retryPuppeteerOptions: PuppeteerLaunchOptions = {
      ...basePuppeteerOptions,
      protocolTimeout: 180000, // 3 minutes
    };

    if (options.puppeteerType === 'cluster') {
      try {
        // Process timeout retries with special settings
        const cluster = await Cluster.launch({
          puppeteer,
          concurrency: Cluster.CONCURRENCY_CONTEXT,
          maxConcurrency: Math.min(options.concurrency, 3), // Lower concurrency for retries
          puppeteerOptions: retryPuppeteerOptions,
          monitor: false,
          timeout: 150000, // 2.5 minutes per page
        });

        await cluster.task(async ({ page, data }) => {
          try {
            // Even more aggressive timeout for retries
            page.setDefaultTimeout(120000); // 2 minutes
            page.setDefaultNavigationTimeout(120000);
            
            const result = await processPageTask({ 
              page, 
              data: { 
                url: data.url, 
                logger, 
                discoveryMode: options.discoveryMode,
                extractMetadata: options.extractMetadata 
              } 
            });
            retryResults.push(result);
          } catch (error) {
            // If retry also fails, keep original error
            const originalResult = timeoutErrors.find(e => e.url === data.url)?.originalError;
            if (originalResult) {
              retryResults.push(originalResult);
            }
          }
        });

        // Queue all timeout URLs for retry
        for (const { url } of timeoutErrors) {
          await cluster.queue({ 
            url, 
            logger,
            discoveryMode: options.discoveryMode,
            extractMetadata: options.extractMetadata,
            adUnitDetail: options.adUnitDetail
          });
        }

        await cluster.idle();
        await cluster.close();
      } catch (error) {
        logger.error('Retry cluster failed:', error);
        // Keep original errors if retry cluster fails
        retryResults.push(...timeoutErrors.map(e => e.originalError));
      }
    } else {
      // Vanilla puppeteer retry
      let browser: Browser | null = null;
      try {
        browser = await puppeteer.launch(retryPuppeteerOptions);
        
        for (const { url, originalError } of timeoutErrors) {
          try {
            const page = await browser.newPage();
            page.setDefaultTimeout(120000);
            page.setDefaultNavigationTimeout(120000);
            
            const result = await processPageTask({
              page,
              data: { 
                url, 
                logger, 
                discoveryMode: options.discoveryMode,
                extractMetadata: options.extractMetadata,
                adUnitDetail: options.adUnitDetail 
              },
            });
            retryResults.push(result);
            await page.close();
          } catch (error) {
            // Keep original error if retry fails
            retryResults.push(originalError);
            logger.debug(`Retry failed for ${url}, keeping original error`);
          }
        }
      } catch (error) {
        logger.error('Retry browser launch failed:', error);
        retryResults.push(...timeoutErrors.map(e => e.originalError));
      } finally {
        if (browser) await browser.close();
      }
    }

    // Log retry summary
    const retrySuccesses = retryResults.filter(r => r.type === 'success').length;
    const retryNoData = retryResults.filter(r => r.type === 'no_data').length;
    const retryFailures = retryResults.filter(r => r.type === 'error').length;
    
    logger.info('========================================');
    logger.info('RETRY SUMMARY');
    logger.info('========================================');
    logger.info(`✅ Successful on retry: ${retrySuccesses}`);
    logger.info(`🚫 No data on retry: ${retryNoData}`);
    logger.info(`❌ Still failed: ${retryFailures}`);
    logger.info('========================================');

    // Merge retry results with non-timeout results
    taskResults = [...nonTimeoutResults, ...retryResults];
  }

  // Use functions from results-handler.ts
  const successfulResults = processAndLogTaskResults(taskResults, logger);

  // Update domain health tracker with results
  for (const result of taskResults) {
    const url = result.type === 'error' || result.type === 'no_data' 
      ? result.url 
      : result.data.url;
    
    // Skip if no URL is available
    if (!url) continue;
    
    if (result.type === 'success' || result.type === 'no_data') {
      // Record as success (even no_data means the page loaded successfully)
      const responseTime = 5000; // Default response time, ideally we'd track actual timing
      domainHealthTracker.recordSuccess(url, responseTime);
    } else if (result.type === 'error') {
      // Record failure with detailed error if available
      if (result.error.detailedError) {
        domainHealthTracker.recordFailure(url, result.error.detailedError);
      } else {
        // Create a basic DetailedError for compatibility
        domainHealthTracker.recordFailure(url, {
          code: result.error.code || 'UNKNOWN_ERROR',
          message: result.error.message || 'Unknown error',
          category: ErrorCategory.UNKNOWN,
          subCategory: 'general',
          phase: ProcessingPhase.DATA_EXTRACTION,
          url: url,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  // Update URL tracker with results if skip-processed is enabled
  if (options.skipProcessed) {
    urlTracker.updateFromTaskResults(taskResults);
    logger.info('Updated URL tracking database with scan results');
  }

  // Write results to store directory by default
  writeResultsToStoreFile(successfulResults, process.cwd(), logger);

  // Append URLs to error files based on task results
  appendNoPrebidUrls(taskResults, logger);
  appendErrorUrls(taskResults, logger);

  if (urlSourceType === 'InputFile' && options.inputFile) {
    updateInputFile(options.inputFile, urlsToProcess, taskResults, logger);
  }

  // Generate comprehensive processing summary
  const originalUrlCount =
    allUrls.length + (preFilterCount - allUrls.length) + urlsSkippedProcessed; // Total before any filtering
  const skippedUrlCount = urlsSkippedProcessed;
  const processedUrlCount = taskResults.length;

  // Debug logging to understand what's happening
  logger.debug('Processing summary calculation:', {
    'allUrls.length': allUrls.length,
    preFilterCount: preFilterCount,
    urlsSkippedProcessed: urlsSkippedProcessed,
    originalUrlCount: originalUrlCount,
    processedUrlCount: processedUrlCount,
    'taskResults.length': taskResults.length,
  });
  const successfulExtractions = successfulResults.length;
  const errorCount = taskResults.filter((r) => r.type === 'error').length;
  const noDataCount = taskResults.filter((r) => r.type === 'no_data').length;

  // Get final database statistics
  const finalStats = urlTracker.getStats();
  const totalInDatabase = Object.values(finalStats).reduce(
    (sum, count) => sum + count,
    0
  );

  // Check if output file was created
  const today = new Date().toISOString().slice(0, 10);
  const outputPath = `store/Jun-2025/${today}.json`;
  let outputFileCreated = false;
  try {
    const fs = await import('fs');
    outputFileCreated = fs.existsSync(outputPath);
  } catch (e) {
    // If we can't check, assume it wasn't created
  }

  // Log comprehensive summary
  logger.info('========================================');
  logger.info('SCAN SUMMARY');
  logger.info('========================================');

  if (options.range) {
    logger.info(`📋 URL range processed: ${options.range}`);
  }

  logger.info(`📊 Total URLs in range: ${originalUrlCount}`);
  logger.info(`🔄 URLs actually processed: ${processedUrlCount}`);

  // Always show skipped count when using skipProcessed, even if 0
  if (options.skipProcessed) {
    logger.info(`⏭️  URLs skipped (already processed): ${skippedUrlCount}`);

    // Add helpful context when all URLs are skipped
    if (skippedUrlCount > 0 && processedUrlCount === 0) {
      logger.info(`💡 All URLs in this range were previously processed.`);
      logger.info(`   Use --forceReprocess to reprocess them anyway.`);
    }
  }

  logger.info(`🎯 Successful data extractions: ${successfulExtractions}`);
  logger.info(`⚠️  Errors encountered: ${errorCount}`);
  logger.info(`🚫 No ad tech found: ${noDataCount}`);

  if (outputFileCreated) {
    logger.info(`📁 Output file created: ${outputPath}`);
  } else {
    logger.info(`📁 No output file created (no successful extractions)`);
  }

  logger.info(
    `💾 Database total: ${totalInDatabase.toLocaleString()} processed URLs`
  );

  // Add helpful guidance
  if (successfulExtractions === 0 && processedUrlCount === 0) {
    logger.info('');
    logger.info('💡 No data was extracted because:');
    if (skippedUrlCount > 0) {
      logger.info(
        `   • ${skippedUrlCount} URLs were already processed (use --resetTracking to reprocess)`
      );
    }
    if (noDataCount > 0) {
      logger.info(`   • ${noDataCount} URLs had no ad technology detected`);
    }
    if (errorCount > 0) {
      logger.info(
        `   • ${errorCount} URLs encountered errors during processing`
      );
    }
    if (skippedUrlCount === originalUrlCount) {
      logger.info(
        '   • All URLs in this range have been previously processed!'
      );
    }
  }

  if (options.skipProcessed) {
    logger.info('');
    logger.info('🔧 Options for next run:');
    if (skippedUrlCount === originalUrlCount) {
      logger.info(
        '   • Process new range (all URLs in current range already done)'
      );
      if (options.range) {
        const rangeMatch = options.range.match(/(\d+)-(\d+)/);
        if (rangeMatch) {
          const endNum = parseInt(rangeMatch[2]);
          const suggestedStart = endNum + 1;
          const suggestedEnd = endNum + 1000;
          logger.info(
            `   • Suggested: --range "${suggestedStart}-${suggestedEnd}"`
          );
        }
      }
    } else {
      logger.info('   • Continue with next range: --range "1001-2000"');
    }
    logger.info('   • Reprocess this range: --resetTracking');
    logger.info('   • Process without deduplication: remove --skipProcessed');
  }

  logger.info('========================================');

  // Close URL tracker connection
  closeUrlTracker();

  // Uninstall process error handlers
  uninstallProcessErrorHandler();
}
