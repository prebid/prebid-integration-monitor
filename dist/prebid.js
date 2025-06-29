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
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// Using namespace import and attempting to access .default for CJS interop
import * as BlockResourcesModule from 'puppeteer-extra-plugin-block-resources';
import { Cluster } from 'puppeteer-cluster';
import * as path from 'path';
// Import functions from new modules
import { processFileContent, fetchUrlsFromGitHub, loadFileContents, } from './utils/url-loader.js';
import { processPageTask, // The core function for processing a single page
// TaskResult and PageData are now imported from common/types
 } from './utils/puppeteer-task.js';
import { processAndLogTaskResults, writeResultsToStoreFile, appendNoPrebidUrls, appendErrorUrls, updateInputFile, createErrorFileHeaders, } from './utils/results-handler.js';
import { getUrlTracker, closeUrlTracker } from './utils/url-tracker.js';
import { filterValidUrls } from './utils/domain-validator.js';
import { ENHANCED_PUPPETEER_ARGS } from './config/app-config.js';
import { initializeTelemetry, URLLoadingTracer, URLFilteringTracer } from './utils/telemetry.js';
let logger; // Global logger instance, initialized within prebidExplorer.
// Apply puppeteer-extra plugins.
// The 'as any' and 'as unknown as typeof puppeteerVanilla' casts are a common way
// to handle the dynamic nature of puppeteer-extra plugins while retaining type safety
// for the core puppeteerVanilla methods.
const puppeteer = addExtra(puppeteerVanilla // Changed from unknown to any
);
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
export async function prebidExplorer(options) {
    logger = initializeLogger(options.logDir); // Initialize the global logger
    initializeTelemetry('prebid-integration-monitor');
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
            logger.info('URL tracking database is empty. Importing existing results...');
            await urlTracker.importExistingResults(path.join(process.cwd(), 'store'));
        }
        logger.info('URL tracker statistics:', stats);
    }
    // Apply puppeteer-extra stealth plugin to help avoid bot detection
    // Cast puppeteer to any before calling use
    puppeteer.use(StealthPlugin()); // Changed cast
    const resourcesToBlock = new Set([
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
    const factory = (BlockResourcesModule.default ||
        BlockResourcesModule);
    const blockResourcesPluginInstance = factory({
        // Changed factory definition and call
        blockedTypes: resourcesToBlock,
    });
    // Cast puppeteer to any before calling use
    puppeteer.use(blockResourcesPluginInstance); // Changed cast
    logger.info(`Configured to block resource types: ${Array.from(resourcesToBlock).join(', ')}`);
    const basePuppeteerOptions = {
        protocolTimeout: 1000000, // Increased timeout for browser protocol communication.
        defaultViewport: null, // Sets the viewport to null, effectively using the default viewport of the browser window.
        headless: options.headless,
        args: [
            ...ENHANCED_PUPPETEER_ARGS, // Use enhanced args for better stability
            ...(options.puppeteerLaunchOptions?.args || []) // Allow additional custom args
        ],
        ...(options.puppeteerLaunchOptions || {}), // Ensures options.puppeteerLaunchOptions is an object before spreading
    };
    // results array is correctly typed with PageData from puppeteer-task.ts
    const taskResults = []; // Correctly typed with TaskResult from puppeteer-task.ts
    /** @type {string[]} Array to store all URLs fetched from the specified source. */
    let allUrls = [];
    /** @type {Set<string>} Set to keep track of URLs that have been processed or are queued for processing. */
    const processedUrls = new Set();
    /** @type {string} String to identify the source of URLs (e.g., 'GitHub', 'InputFile'). */
    let urlSourceType = ''; // To track the source for logging and file updates
    // Determine the source of URLs (GitHub or local file) and fetch them.
    const urlLoadingTracer = new URLLoadingTracer(options.githubRepo || options.inputFile || 'unknown', logger);
    if (options.githubRepo) {
        urlSourceType = 'GitHub';
        // Parse range for optimization
        let rangeOptions;
        if (options.range) {
            const [startStr, endStr] = options.range.split('-');
            rangeOptions = {
                startRange: startStr ? parseInt(startStr, 10) : undefined,
                endRange: endStr ? parseInt(endStr, 10) : undefined
            };
            logger.info(`Using optimized range processing: ${options.range}`);
        }
        const urlLimit = options.range ? undefined : options.numUrls;
        allUrls = await fetchUrlsFromGitHub(options.githubRepo, urlLimit, logger, rangeOptions);
        urlLoadingTracer.recordUrlCount(allUrls.length, 'github_fetch');
        if (allUrls.length > 0) {
            logger.info(`Successfully loaded ${allUrls.length} URLs from GitHub repository: ${options.githubRepo}`);
        }
        else {
            logger.warn(`No URLs found or fetched from GitHub repository: ${options.githubRepo}.`);
        }
    }
    else if (options.inputFile) {
        urlSourceType = 'InputFile';
        const fileContent = loadFileContents(options.inputFile, logger);
        if (fileContent) {
            // Determine file type for logging, actual type handling is in processFileContent
            const fileType = options.inputFile.substring(options.inputFile.lastIndexOf('.') + 1) ||
                'unknown';
            logger.info(`Processing local file: ${options.inputFile} (detected type: ${fileType})`);
            allUrls = await processFileContent(options.inputFile, fileContent, logger);
            urlLoadingTracer.recordUrlCount(allUrls.length, 'file_processing');
            if (allUrls.length > 0) {
                logger.info(`Successfully loaded ${allUrls.length} URLs from local ${fileType.toUpperCase()} file: ${options.inputFile}`);
            }
            else {
                logger.warn(`No URLs extracted from local ${fileType.toUpperCase()} file: ${options.inputFile}. Check file content and type handling.`);
            }
        }
        else {
            // loadFileContents already logs the error, but we should ensure allUrls is empty and potentially throw
            allUrls = []; // Ensure allUrls is empty if file read failed
            logger.error(`Failed to load content from input file ${options.inputFile}. Cannot proceed with this source.`);
            // Depending on desired behavior, you might want to throw an error here
            // For now, it will proceed to the "No URLs to process" check.
        }
    }
    else {
        // This case should ideally be prevented by CLI validation in scan.ts
        logger.error('No URL source provided. Either --githubRepo or inputFile argument must be specified.');
        throw new Error('No URL source specified.');
    }
    // Exit if no URLs were found from the specified source.
    if (allUrls.length === 0) {
        urlLoadingTracer.finish(0);
        logger.warn(`No URLs to process from ${urlSourceType || 'any specified source'}. Exiting.`);
        return;
    }
    urlLoadingTracer.finish(allUrls.length);
    logger.info(`Initial total URLs found: ${allUrls.length}`, {
        firstFew: allUrls.slice(0, 5),
    });
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
            logger.warn(`Invalid range format: "${options.range}". Proceeding with all URLs. Start and end must be numbers. User input is 1-based.`);
        }
        else {
            // Convert 1-based to 0-based indices
            start = start > 0 ? start - 1 : 0; // If user enters 0 or negative, treat as start from beginning
            end = end > 0 ? end : allUrls.length; // If user enters 0 or negative for end, or leaves it empty, treat as end of list
            if (start >= allUrls.length) {
                logger.warn(`Start of range (${start + 1}) is beyond the total number of URLs (${allUrls.length}). No URLs to process.`);
                allUrls = [];
            }
            else if (start > end - 1) {
                logger.warn(`Start of range (${start + 1}) is greater than end of range (${end}). Proceeding with URLs from start to end of list.`);
                allUrls = allUrls.slice(start);
            }
            else {
                allUrls = allUrls.slice(start, end); // end is exclusive for slice, matches 0-based end index
                filteringTracer.recordRangeFiltering(originalUrlCount, allUrls.length, options.range);
                logger.info(`Applied range: Processing URLs from ${start + 1} to ${Math.min(end, originalUrlCount)} (0-based index ${start} to ${Math.min(end, originalUrlCount) - 1}). Total URLs after range: ${allUrls.length} (out of ${originalUrlCount}).`);
            }
        }
    }
    else if (options.range && urlSourceType === 'GitHub') {
        logger.info(`Range ${options.range} already applied during GitHub fetch optimization. Skipping duplicate range filtering.`);
        filteringTracer.recordRangeFiltering(allUrls.length, allUrls.length, options.range);
    }
    if (allUrls.length === 0) {
        logger.warn(`No URLs to process after applying range or due to empty initial list. Exiting.`);
        return;
    }
    logger.info(`Total URLs to process after range check: ${allUrls.length}`, {
        firstFew: allUrls.slice(0, 5),
    });
    // Pre-filter processed URLs if requested (more efficient for large lists)
    if (options.prefilterProcessed) {
        logger.info('Pre-filtering processed URLs before loading full range...');
        // Analyze the current range efficiency
        if (options.range) {
            const [startStr, endStr] = options.range.split('-');
            const start = startStr ? parseInt(startStr, 10) - 1 : 0; // Convert to 0-based
            const end = endStr ? parseInt(endStr, 10) : allUrls.length;
            // Reload all URLs temporarily to analyze efficiency
            let fullUrlList = [];
            if (options.githubRepo) {
                fullUrlList = await fetchUrlsFromGitHub(options.githubRepo, undefined, logger);
            }
            else if (options.inputFile) {
                const fileContent = loadFileContents(options.inputFile, logger);
                if (fileContent) {
                    fullUrlList = await processFileContent(options.inputFile, fileContent, logger);
                }
            }
            if (fullUrlList.length > 0) {
                const analysis = urlTracker.analyzeUrlRange(start, Math.min(end, fullUrlList.length), fullUrlList);
                logger.info('Range analysis results:', {
                    totalInRange: analysis.totalInRange,
                    processedCount: analysis.processedCount,
                    unprocessedCount: analysis.unprocessedCount,
                    processedPercentage: analysis.processedPercentage.toFixed(1) + '%'
                });
                if (analysis.isFullyProcessed) {
                    logger.info('🎯 RANGE FULLY PROCESSED: All URLs in this range have been processed!');
                    // Suggest next ranges
                    const suggestions = urlTracker.suggestNextRanges(fullUrlList, 1000, 3);
                    if (suggestions.length > 0) {
                        logger.info('💡 SUGGESTED NEXT RANGES:');
                        suggestions.forEach((suggestion, index) => {
                            logger.info(`   ${index + 1}. --range "${suggestion.startUrl}-${suggestion.endUrl}" (~${suggestion.estimatedUnprocessed} unprocessed, ${suggestion.efficiency.toFixed(1)}% efficiency)`);
                        });
                    }
                    logger.info('Use --forceReprocess to reprocess this range, or choose a different range.');
                    closeUrlTracker();
                    return;
                }
                else if (analysis.processedPercentage > 80) {
                    logger.warn(`⚠️  LOW EFFICIENCY: ${analysis.processedPercentage.toFixed(1)}% of URLs already processed`);
                    logger.info('Consider using --forceReprocess or choosing a different range for better efficiency.');
                }
            }
        }
    }
    // Track URLs skipped due to skip-processed
    let urlsSkippedProcessed = 0;
    // Handle different processing modes
    if (options.forceReprocess) {
        logger.info('🔄 FORCE REPROCESS: Processing all URLs regardless of previous status');
        // Don't filter anything - process all URLs
    }
    else if (options.skipProcessed) {
        logger.info('Filtering out previously processed URLs...');
        const originalCount = allUrls.length;
        allUrls = urlTracker.filterUnprocessedUrls(allUrls);
        urlsSkippedProcessed = originalCount - allUrls.length;
        filteringTracer.recordProcessedFiltering(originalCount, allUrls.length, urlsSkippedProcessed);
        logger.info(`URL filtering complete: ${originalCount} total, ${allUrls.length} unprocessed, ${urlsSkippedProcessed} skipped`);
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
    logger.info(`Domain pre-filtering complete: ${preFilterCount} total, ${allUrls.length} valid, ${preFilterCount - allUrls.length} filtered out`);
    if (allUrls.length === 0) {
        filteringTracer.finish(0);
        logger.warn('No valid URLs remaining after domain filtering. Exiting.');
        closeUrlTracker();
        return;
    }
    filteringTracer.finish(allUrls.length);
    /** @type {string[]} URLs to be processed after applying range and other filters. */
    const urlsToProcess = allUrls; // This now contains potentially ranged URLs
    // Define the core processing task (used by both vanilla and cluster)
    // Note: The actual definition of processPageTask is now imported.
    // We pass it to the cluster or call it directly, along with the logger.
    // 2. Chunk Processing Logic
    /** @type {number} Size of chunks for processing URLs. 0 means no chunking. */
    const chunkSize = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : 0;
    // Process URLs in chunks if chunkSize is specified.
    if (chunkSize > 0) {
        logger.info(`Chunked processing enabled. Chunk size: ${chunkSize}`);
        const totalChunks = Math.ceil(urlsToProcess.length / chunkSize);
        logger.info(`Total chunks to process: ${totalChunks}`);
        for (let i = 0; i < urlsToProcess.length; i += chunkSize) {
            const currentChunkUrls = urlsToProcess.slice(i, i + chunkSize);
            const chunkNumber = Math.floor(i / chunkSize) + 1;
            logger.info(`Processing chunk ${chunkNumber} of ${totalChunks}: URLs ${i + 1}-${Math.min(i + chunkSize, urlsToProcess.length)}`);
            // Process the current chunk using either 'cluster' or 'vanilla' Puppeteer mode.
            if (options.puppeteerType === 'cluster') {
                const cluster = await Cluster.launch({
                    concurrency: Cluster.CONCURRENCY_CONTEXT,
                    maxConcurrency: options.concurrency,
                    monitor: options.monitor,
                    puppeteer,
                    puppeteerOptions: basePuppeteerOptions,
                });
                // Register a wrapper task that properly calls processPageTask and collects results
                await cluster.task(async ({ page, data }) => {
                    const result = await processPageTask({ page, data });
                    // Push result directly to taskResults array since cluster.queue doesn't return values
                    taskResults.push(result);
                    return result;
                });
                try {
                    const chunkPromises = currentChunkUrls
                        .filter((url) => url)
                        .map((url) => {
                        processedUrls.add(url); // Add to global processedUrls as it's queued
                        return cluster.queue({ url, logger, discoveryMode: options.discoveryMode }); // Pass url, logger, and discoveryMode
                        // No specific .then or .catch here, as results are collected from settledChunkResults
                        // Error handling for queueing itself might be needed if cluster.queue can throw directly
                        // However, task errors are handled by processPageTask and returned as TaskResultError.
                    });
                    // Wait for all promises in the chunk to settle
                    await Promise.allSettled(chunkPromises);
                    // Results are now collected directly in the cluster task handler
                    await cluster.idle();
                    await cluster.close();
                }
                catch (error) {
                    logger.error(`An error occurred during processing chunk ${chunkNumber} with puppeteer-cluster.`, { error });
                    // Cast cluster to any before calling isClosed and close
                    if (cluster && !cluster.isClosed())
                        // Changed cast
                        await cluster.close(); // Ensure cluster is closed on error
                }
            }
            else {
                // 'vanilla' Puppeteer for the current chunk
                let browser = null;
                try {
                    browser = await puppeteer.launch(basePuppeteerOptions);
                    for (const url of currentChunkUrls) {
                        if (url) {
                            const page = await browser.newPage();
                            // Call the imported processPageTask directly
                            const result = await processPageTask({
                                page,
                                data: { url, logger, discoveryMode: options.discoveryMode },
                            });
                            taskResults.push(result);
                            await page.close();
                            processedUrls.add(url); // Add to global processedUrls
                        }
                    }
                }
                catch (error) {
                    logger.error(`An error occurred during processing chunk ${chunkNumber} with vanilla Puppeteer.`, { error });
                }
                finally {
                    if (browser)
                        await browser.close();
                }
            }
            logger.info(`Finished processing chunk ${chunkNumber} of ${totalChunks}.`);
        }
    }
    else {
        // Process all URLs at once (no chunking)
        logger.info(`Processing all ${urlsToProcess.length} URLs without chunking.`);
        if (options.puppeteerType === 'cluster') {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_CONTEXT,
                maxConcurrency: options.concurrency,
                monitor: options.monitor,
                puppeteer,
                puppeteerOptions: basePuppeteerOptions,
            });
            // Register a wrapper task that properly calls processPageTask and collects results
            await cluster.task(async ({ page, data }) => {
                const result = await processPageTask({ page, data });
                // Push result directly to taskResults array since cluster.queue doesn't return values
                taskResults.push(result);
                return result;
            });
            try {
                const promises = urlsToProcess
                    .filter((url) => url)
                    .map((url) => {
                    processedUrls.add(url);
                    return cluster.queue({ url, logger, discoveryMode: options.discoveryMode });
                });
                await Promise.allSettled(promises);
                // Results are now collected directly in the cluster task handler
                await cluster.idle();
                await cluster.close();
            }
            catch (error) {
                logger.error('An unexpected error occurred during cluster processing orchestration', { error });
                // Cast cluster to any before calling isClosed and close
                if (cluster && !cluster.isClosed())
                    // Changed cast
                    await cluster.close();
            }
        }
        else {
            // 'vanilla' Puppeteer
            let browser = null;
            try {
                browser = await puppeteer.launch(basePuppeteerOptions);
                for (const url of urlsToProcess) {
                    if (url) {
                        const page = await browser.newPage();
                        const result = await processPageTask({
                            page,
                            data: { url, logger, discoveryMode: options.discoveryMode },
                        });
                        taskResults.push(result);
                        await page.close();
                        processedUrls.add(url);
                    }
                }
            }
            catch (error) {
                logger.error('An unexpected error occurred during vanilla Puppeteer processing', { error });
            }
            finally {
                if (browser)
                    await browser.close();
            }
        }
    }
    // Use functions from results-handler.ts
    const successfulResults = processAndLogTaskResults(taskResults, logger);
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
    const originalUrlCount = allUrls.length + (preFilterCount - allUrls.length) + urlsSkippedProcessed; // Total before any filtering
    const skippedUrlCount = urlsSkippedProcessed;
    const processedUrlCount = taskResults.length;
    // Debug logging to understand what's happening
    logger.debug('Processing summary calculation:', {
        'allUrls.length': allUrls.length,
        'preFilterCount': preFilterCount,
        'urlsSkippedProcessed': urlsSkippedProcessed,
        'originalUrlCount': originalUrlCount,
        'processedUrlCount': processedUrlCount,
        'taskResults.length': taskResults.length
    });
    const successfulExtractions = successfulResults.length;
    const errorCount = taskResults.filter(r => r.type === 'error').length;
    const noDataCount = taskResults.filter(r => r.type === 'no_data').length;
    // Get final database statistics
    const finalStats = urlTracker.getStats();
    const totalInDatabase = Object.values(finalStats).reduce((sum, count) => sum + count, 0);
    // Check if output file was created
    const today = new Date().toISOString().slice(0, 10);
    const outputPath = `store/Jun-2025/${today}.json`;
    let outputFileCreated = false;
    try {
        const fs = await import('fs');
        outputFileCreated = fs.existsSync(outputPath);
    }
    catch (e) {
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
    }
    else {
        logger.info(`📁 No output file created (no successful extractions)`);
    }
    logger.info(`💾 Database total: ${totalInDatabase.toLocaleString()} processed URLs`);
    // Add helpful guidance
    if (successfulExtractions === 0 && processedUrlCount === 0) {
        logger.info('');
        logger.info('💡 No data was extracted because:');
        if (skippedUrlCount > 0) {
            logger.info(`   • ${skippedUrlCount} URLs were already processed (use --resetTracking to reprocess)`);
        }
        if (noDataCount > 0) {
            logger.info(`   • ${noDataCount} URLs had no ad technology detected`);
        }
        if (errorCount > 0) {
            logger.info(`   • ${errorCount} URLs encountered errors during processing`);
        }
        if (skippedUrlCount === originalUrlCount) {
            logger.info('   • All URLs in this range have been previously processed!');
        }
    }
    if (options.skipProcessed) {
        logger.info('');
        logger.info('🔧 Options for next run:');
        if (skippedUrlCount === originalUrlCount) {
            logger.info('   • Process new range (all URLs in current range already done)');
            if (options.range) {
                const rangeMatch = options.range.match(/(\d+)-(\d+)/);
                if (rangeMatch) {
                    const endNum = parseInt(rangeMatch[2]);
                    const suggestedStart = endNum + 1;
                    const suggestedEnd = endNum + 1000;
                    logger.info(`   • Suggested: --range "${suggestedStart}-${suggestedEnd}"`);
                }
            }
        }
        else {
            logger.info('   • Continue with next range: --range "1001-2000"');
        }
        logger.info('   • Reprocess this range: --resetTracking');
        logger.info('   • Process without deduplication: remove --skipProcessed');
    }
    logger.info('========================================');
    // Close URL tracker connection
    closeUrlTracker();
}
