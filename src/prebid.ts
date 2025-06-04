import { initializeLogger } from './utils/logger.js';
import type { Logger as WinstonLogger } from 'winston';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla, { PuppeteerLaunchOptions } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPluginFactory from 'puppeteer-extra-plugin-block-resources';
import { UrlProcessor } from './utils/urlProcessor.js';
import { PuppeteerTaskRunner, setPuppeteerInstance } from './utils/puppeteerTaskRunner.js';
import { ResultsProcessor } from './utils/resultsProcessor.js';

/**
 * Represents a Prebid.js instance found on a page.
 */
export interface PrebidInstance {
    /** The global variable name of the Prebid.js instance (e.g., 'pbjs'). */
    globalVarName: string;
    /** The version of the Prebid.js instance. */
    version: string;
    /** An array of installed Prebid.js modules. */
    modules: string[];
}

/**
 * Represents data extracted from a web page.
 */
export interface PageData {
    /** An array of ad libraries found on the page (e.g., 'apstag', 'googletag'). */
    libraries: string[];
    /** The date when the page was scanned, in YYYY-MM-DD format. */
    date: string;
    /** An array of Prebid.js instances found on the page. */
    prebidInstances?: PrebidInstance[];
    /** The URL of the scanned page. */
    url?: string;
}

/**
 * Represents a successful task result.
 */
export interface TaskResultSuccess {
    /** Indicates a successful outcome. */
    type: 'success';
    /** The data extracted from the page. */
    data: PageData;
}

/**
 * Represents a task result where no relevant data was found.
 */
export interface TaskResultNoData {
    /** Indicates that no relevant data was found on the page. */
    type: 'no_data';
    /** The URL of the scanned page. */
    url: string;
}

/**
 * Represents a task result where an error occurred.
 */
export interface TaskResultError {
    /** Indicates an error occurred during processing. */
    type: 'error';
    /** The URL of the page where the error occurred. */
    url: string;
    /** A string describing the error. */
    error: string;
}

/**
 * Represents the possible outcomes of a page processing task.
 */
export type TaskResult = TaskResultSuccess | TaskResultNoData | TaskResultError;

/**
 * Defines the options for the Prebid Explorer.
 */
export interface PrebidExplorerOptions {
    /** Path to a local file containing URLs to scan (e.g., .txt, .csv, .json). */
    inputFile?: string;
    /** @deprecated CSV file specific option, prefer inputFile. */
    csvFile?: string;
    /** URL of a GitHub repository or a direct link to a file in a repository to scan for URLs. */
    githubRepo?: string;
    /** The maximum number of URLs to process from the source. */
    numUrls?: number;
    /** The type of Puppeteer setup to use: 'vanilla' for single browser or 'cluster' for multiple browsers. */
    puppeteerType: 'vanilla' | 'cluster';
    /** The number of concurrent pages/browsers to use when puppeteerType is 'cluster'. */
    concurrency: number;
    /** Whether to run Puppeteer in headless mode. */
    headless: boolean;
    /** Whether to enable Puppeteer cluster monitoring (if applicable). */
    monitor: boolean;
    /** The directory where output files (JSON results) will be saved. */
    outputDir: string;
    /** The directory where log files will be saved. */
    logDir: string;
    /** Additional launch options for Puppeteer. */
    puppeteerLaunchOptions?: PuppeteerLaunchOptions;
    /** A range of URLs to process from the input list (e.g., "1-100"). 1-based indexing. */
    range?: string;
    /** The number of URLs to process in each chunk. 0 or undefined means no chunking. */
    chunkSize?: number;
}

/**
 * Logger instance for the Prebid Explorer.
 * @internal
 */
let logger: WinstonLogger;

/**
 * Puppeteer instance with extra plugins.
 * @internal
 */
const puppeteer = addExtra(puppeteerVanilla as any);


/**
 * Main function for the Prebid Explorer.
 * This function orchestrates the process of fetching URLs, scanning them with Puppeteer,
 * and saving the results.
 * @param options - The {@link PrebidExplorerOptions} to configure the scan.
 * @returns A promise that resolves when the exploration is complete.
 */
export async function prebidExplorer(options: PrebidExplorerOptions): Promise<void> {
    logger = initializeLogger(options.logDir);
    setPuppeteerInstance(puppeteer); // Provide the puppeteer instance to the runner


    // Initialize utility classes
    const urlProcessor = new UrlProcessor(logger);
    const taskRunner = new PuppeteerTaskRunner(options, logger, puppeteer);
    const resultsProcessor = new ResultsProcessor(options, logger);

    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());

    const blockResources = (blockResourcesPluginFactory as any)();
    if (blockResources && blockResources.blockedTypes && typeof blockResources.blockedTypes.add === 'function') {
      const typesToBlock: Set<string> = new Set<string>([
          'image', 'font', 'websocket', 'media',
          'texttrack', 'eventsource', 'manifest', 'other'
      ]);
      typesToBlock.forEach(type => blockResources.blockedTypes.add(type));
      puppeteer.use(blockResources);
    } else {
      logger.warn('Could not configure blockResourcesPlugin: blockedTypes property or .add method not available on instance.', { plugin: blockResources });
    }

    let allUrls: string[] = [];
    let urlSourceType = '';
    const processedUrls = new Set<string>(); // Keep track of URLs sent to tasks

    // 1. Fetch URLs using UrlProcessor
    if (options.githubRepo) {
        urlSourceType = 'GitHub';
        allUrls = await urlProcessor.fetchUrlsFromGitHub(options.githubRepo, options.numUrls);
        if (allUrls.length > 0) {
            logger.info(`Successfully loaded ${allUrls.length} URLs from GitHub repository: ${options.githubRepo}`);
        } else {
            logger.warn(`No URLs found or fetched from GitHub repository: ${options.githubRepo}.`);
        }
    } else if (options.inputFile) {
        urlSourceType = 'InputFile';
        const fileContent = urlProcessor.loadFileContents(options.inputFile);
        if (fileContent) {
            const fileType = options.inputFile.substring(options.inputFile.lastIndexOf('.') + 1) || 'unknown';
            logger.info(`Processing local file: ${options.inputFile} (detected type: ${fileType})`);
            allUrls = await urlProcessor.processFileContent(options.inputFile, fileContent);
            if (allUrls.length > 0) {
                logger.info(`Successfully loaded ${allUrls.length} URLs from local ${fileType.toUpperCase()} file: ${options.inputFile}`);
            } else {
                logger.warn(`No URLs extracted from local ${fileType.toUpperCase()} file: ${options.inputFile}.`);
            }
        } else {
            allUrls = [];
            logger.error(`Failed to load content from input file ${options.inputFile}. Cannot proceed with this source.`);
        }
    } else {
        logger.error('No URL source provided. Either --githubRepo or inputFile argument must be specified.');
        throw new Error('No URL source specified.');
    }

    if (allUrls.length === 0) {
        logger.warn(`No URLs to process from ${urlSourceType || 'any specified source'}. Exiting.`);
        return;
    }
    logger.info(`Initial total URLs found: ${allUrls.length}`, { firstFew: allUrls.slice(0, 5) });

    // 2. Apply Range Logic (if any)
    if (options.range) {
        logger.info(`Applying range: ${options.range}`);
        const originalUrlCount = allUrls.length;
        let [startStr, endStr] = options.range.split('-');
        let start = startStr ? parseInt(startStr, 10) : 1;
        let end = endStr ? parseInt(endStr, 10) : allUrls.length;

        if (isNaN(start) || isNaN(end) || start < 0 || end < 0) {
            logger.warn(`Invalid range format: "${options.range}". Proceeding with all URLs.`);
        } else {
            start = start > 0 ? start - 1 : 0;
            end = end > 0 ? end : allUrls.length;

            if (start >= allUrls.length) {
                logger.warn(`Start of range (${start + 1}) is beyond the total number of URLs (${allUrls.length}). No URLs to process.`);
                allUrls = [];
            } else if (start > end -1) {
                 logger.warn(`Start of range (${start + 1}) is greater than end of range (${end}). Proceeding with URLs from start to end of list.`);
                 allUrls = allUrls.slice(start);
            } else {
                allUrls = allUrls.slice(start, end);
                logger.info(`Applied range: Processing URLs from ${start + 1} to ${Math.min(end, originalUrlCount)}. Total URLs after range: ${allUrls.length}`);
            }
        }
    }

    if (allUrls.length === 0) {
        logger.warn(`No URLs to process after applying range or due to empty initial list. Exiting.`);
        return;
    }
    logger.info(`Total URLs to process after range check: ${allUrls.length}`, { firstFew: allUrls.slice(0, 5) });

    const urlsToProcess = allUrls; // Final list of URLs to be processed

    // 3. Run Puppeteer tasks using PuppeteerTaskRunner
    // The `processedUrls` set will be populated by the taskRunner
    const taskResults: TaskResult[] = await taskRunner.runTasks(urlsToProcess, processedUrls);

    // 4. Process and save results using ResultsProcessor
    resultsProcessor.saveResults(taskResults, processedUrls, urlsToProcess, urlSourceType);

    logger.info('Prebid Explorer run completed.');
}
