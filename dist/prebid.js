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
import { processAndLogTaskResults, writeResultsToStoreFile, appendNoPrebidUrls, appendErrorUrls, updateInputFile, } from './utils/results-handler.js';
import { getUrlTracker, closeUrlTracker } from './utils/url-tracker.js';
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
    logger.info('Starting Prebid Explorer with options:', options);
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
        args: options.puppeteerLaunchOptions?.args || [],
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
    if (options.githubRepo) {
        urlSourceType = 'GitHub';
        allUrls = await fetchUrlsFromGitHub(options.githubRepo, options.numUrls, logger);
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
        logger.warn(`No URLs to process from ${urlSourceType || 'any specified source'}. Exiting.`);
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
                logger.info(`Applied range: Processing URLs from ${start + 1} to ${Math.min(end, originalUrlCount)} (0-based index ${start} to ${Math.min(end, originalUrlCount) - 1}). Total URLs after range: ${allUrls.length} (out of ${originalUrlCount}).`);
            }
        }
    }
    if (allUrls.length === 0) {
        logger.warn(`No URLs to process after applying range or due to empty initial list. Exiting.`);
        return;
    }
    logger.info(`Total URLs to process after range check: ${allUrls.length}`, {
        firstFew: allUrls.slice(0, 5),
    });
    // Filter out already processed URLs if skip-processed is enabled
    if (options.skipProcessed) {
        logger.info('Filtering out previously processed URLs...');
        const originalCount = allUrls.length;
        allUrls = urlTracker.filterUnprocessedUrls(allUrls);
        logger.info(`URL filtering complete: ${originalCount} total, ${allUrls.length} unprocessed, ${originalCount - allUrls.length} skipped`);
        if (allUrls.length === 0) {
            logger.info('All URLs have been previously processed. Exiting.');
            closeUrlTracker();
            return;
        }
    }
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
                // Register the imported processPageTask with the cluster
                await cluster.task(processPageTask);
                try {
                    const chunkPromises = currentChunkUrls
                        .filter((url) => url)
                        .map((url) => {
                        processedUrls.add(url); // Add to global processedUrls as it's queued
                        return cluster.queue({ url, logger }); // Pass url and logger
                        // No specific .then or .catch here, as results are collected from settledChunkResults
                        // Error handling for queueing itself might be needed if cluster.queue can throw directly
                        // However, task errors are handled by processPageTask and returned as TaskResultError.
                    });
                    // Wait for all promises in the chunk to settle
                    const settledChunkResults = await Promise.allSettled(chunkPromises);
                    settledChunkResults.forEach((settledResult) => {
                        if (settledResult.status === 'fulfilled') {
                            // Ensure that settledResult.value is not undefined (e.g. void) before pushing.
                            // processPageTask is expected to always return a TaskResult.
                            if (typeof settledResult.value !== 'undefined') {
                                taskResults.push(settledResult.value);
                            }
                            else {
                                // This case might occur if a task somehow resolves with no value,
                                // though processPageTask is expected to always return a TaskResult.
                                logger.warn('A task from cluster.queue (chunked) fulfilled but with undefined/null value.', { settledResult });
                            }
                        }
                        else if (settledResult.status === 'rejected') {
                            // This typically means an error occurred before processPageTask could even run or return a TaskResultError
                            // (e.g., an issue with Puppeteer itself or the cluster queue mechanism for that specific task).
                            // It's important to log this, as it might not be captured by processPageTask's own error handling.
                            logger.error(`A promise from cluster.queue (chunk ${chunkNumber}) was rejected. This is unexpected if processPageTask is robust.`, { reason: settledResult.reason });
                            // Optionally, create a TaskResultError here if the URL can be reliably determined.
                            // const urlFromRejectedPromise = ... (this might be tricky to get reliably from the settledResult.reason)
                            // if (urlFromRejectedPromise) {
                            //     taskResults.push({ type: 'error', url: urlFromRejectedPromise, error: 'PROMISE_REJECTED_IN_QUEUE' });
                            // }
                        }
                    });
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
                                data: { url, logger },
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
            await cluster.task(processPageTask);
            try {
                const promises = urlsToProcess
                    .filter((url) => url)
                    .map((url) => {
                    processedUrls.add(url);
                    return cluster.queue({ url, logger });
                });
                const settledResults = await Promise.allSettled(promises);
                settledResults.forEach((settledResult) => {
                    if (settledResult.status === 'fulfilled') {
                        // Ensure that settledResult.value is not undefined (e.g. void) before pushing.
                        if (typeof settledResult.value !== 'undefined') {
                            taskResults.push(settledResult.value);
                        }
                        else {
                            logger.warn('A task from cluster.queue (non-chunked) fulfilled but with undefined/null value.', { settledResult });
                        }
                    }
                    else if (settledResult.status === 'rejected') {
                        logger.error('A promise from cluster.queue (non-chunked) was rejected. This is unexpected if processPageTask is robust.', { reason: settledResult.reason });
                        // Optionally, create a TaskResultError here
                        // const urlFromRejectedPromise = ...
                        // if (urlFromRejectedPromise) {
                        //     taskResults.push({ type: 'error', url: urlFromRejectedPromise, error: 'PROMISE_REJECTED_IN_QUEUE' });
                        // }
                    }
                });
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
                            data: { url, logger },
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
    // Close URL tracker connection
    closeUrlTracker();
}
