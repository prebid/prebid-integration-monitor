import * as fs from 'fs'; // Keep fs for readFileSync, existsSync, mkdirSync, writeFileSync
import logger from './utils/logger.js'; // .js extension may be needed
import { INPUT_FILE_PATH } from './utils/parser.js';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer'; // Reverted to simple default import
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPluginFactory from 'puppeteer-extra-plugin-block-resources'; // Renamed for clarity
import { Cluster } from 'puppeteer-cluster';
import { Page } from 'puppeteer'; // Import Page type

// Helper function to configure a new page
async function configurePage(page: Page): Promise<Page> { // page is passed directly by puppeteer-cluster
    page.setDefaultTimeout(55000);
    // Set to Googlebot user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return page;
}

// Define interfaces for page data
interface PrebidInstance {
    globalVarName: string;
    version: string;
    modules: string[];
}

interface PageData {
    libraries: string[];
    date: string;
    prebidInstances?: PrebidInstance[];
    url?: string; // Added url to PageData
}

interface TaskResultSuccess {
    type: 'success';
    data: PageData;
}

interface TaskResultNoData {
    type: 'no_data';
    url: string;
}

interface TaskResultError {
    type: 'error';
    url: string;
    error: string;
}

type TaskResult = TaskResultSuccess | TaskResultNoData | TaskResultError;


const puppeteer = addExtra(puppeteerVanilla as any); // Initialize puppeteer-extra, cast to any

async function prebidExplorer(): Promise<void> {
    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());

    // Call the factory (casting to any to bypass potential type def issue) and configure instance
    const blockResources = (blockResourcesPluginFactory as any)();
    if (blockResources && blockResources.blockedTypes && typeof blockResources.blockedTypes.add === 'function') {
      // blockResources.blockedTypes is a Set-like object, use its add method
      const typesToBlock: Set<any> = new Set<any>([
          'image', 'font', 'websocket', 'media',
          'texttrack', 'eventsource', 'manifest', 'other'
      ]);
      typesToBlock.forEach(type => blockResources.blockedTypes.add(type));
      puppeteer.use(blockResources); // Use the configured instance
    } else {
      logger.warn('Could not configure blockResourcesPlugin: blockedTypes property or .add method not available on instance.', { plugin: blockResources });
    }

    const cluster: Cluster<string, any> = await Cluster.launch({ // Added types for Cluster
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 5, // Set a reasonable maxConcurrency
        // monitor: true, // Enable this for debugging cluster behavior, consider making it configurable
        puppeteer, // Use the puppeteer-extra instance with plugins
        puppeteerOptions: {
            protocolTimeout: 1000000, // Increased from default 180000
            defaultViewport: null,
            headless: true, // Consider 'new' for future compatibility
        },
    });

    let results: PageData[] = []; // Typed results
    const taskResults: TaskResult[] = []; // Array to store results from all tasks
    const allUrls: string[] = fs.readFileSync(INPUT_FILE_PATH, 'utf8').split('\n').map((url: string) => url.trim()).filter((url: string) => url.length > 0);
    logger.info('Initial URLs read from input.txt', { count: allUrls.length, urls: allUrls }); // Log the URLs
    const processedUrls: Set<string> = new Set();
    // noPrebidUrls and errorUrls sets are effectively replaced by logger calls with specific metadata


    // Define the task for the cluster
    await cluster.task(async ({ page, data: url }: { page: Page, data: string }) => { // Added types for task callback
        const trimmedUrl: string = url; // URL is already trimmed and validated
        logger.info(`Processing: ${trimmedUrl}`, { url: trimmedUrl });
        let taskResult: TaskResult; // To store the result of this specific task

        try {
            await configurePage(page); // Configure the page provided by the cluster
            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

            await page.evaluate(async () => {
                const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * .10); // 6 seconds delay
            });

            const pageData: PageData = await page.evaluate((): PageData => {
                const data: Partial<PageData> = {}; // Use Partial for incremental building
                data.libraries = [];
                data.date = new Date().toISOString().slice(0, 10);

                // TODO: Define window types more accurately if possible
                if ((window as any).apstag) data.libraries.push('apstag');
                if ((window as any).googletag) data.libraries.push('googletag');
                if ((window as any).ats) data.libraries.push('ats');

                if ((window as any)._pbjsGlobals && Array.isArray((window as any)._pbjsGlobals)) {
                    data.prebidInstances = [];
                    (window as any)._pbjsGlobals.forEach(function(globalVarName: string) {
                        const pbjsInstance = (window as any)[globalVarName];
                        if (pbjsInstance && pbjsInstance.version && pbjsInstance.installedModules) {
                            data.prebidInstances!.push({ // Use non-null assertion as we initialized it
                                globalVarName: globalVarName,
                                version: pbjsInstance.version,
                                modules: pbjsInstance.installedModules
                            });
                        }
                    });
                }
                return data as PageData; // Cast to PageData
            });

            pageData.url = trimmedUrl;

            if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                taskResult = { type: 'success', data: pageData };
            } else {
                logger.warn(`No relevant Prebid or ad library data found for ${trimmedUrl}`, { url: trimmedUrl });
                taskResult = { type: 'no_data', url: trimmedUrl };
            }
        } catch (pageError: any) {
            logger.error(`Error processing ${trimmedUrl}`, { url: trimmedUrl, error: pageError });
            const errorMessage: string = pageError.message || '';
            const netErrorMatch: RegExpMatchArray | null = errorMessage.match(/net::([A-Z_]+)/);
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
            taskResult = { type: 'error', url: trimmedUrl, error: errorCode };
        }
        taskResults.push(taskResult); // Push result to the central array
    });

    try {
        allUrls.forEach((url: string) => {
            if (url) { // Ensure URL is not empty
                cluster.queue(url);
                processedUrls.add(url); // Mark URL as processed when queued
            }
        });

        await cluster.idle(); // Wait for all queued tasks to complete

        // Process results accumulated in taskResults
        for (const taskResult of taskResults) {
            if (!taskResult) {
                logger.warn(`A task returned no result. This should not happen.`);
                // Decide how to handle this, perhaps add the URL to errorUrls if identifiable
                continue;
            }

            if (taskResult.type === 'success') {
                logger.info(`Data found for ${taskResult.data.url}`, { url: taskResult.data.url });
                results.push(taskResult.data);
            } else if (taskResult.type === 'no_data') {
                // Already logged by the task itself, but we can add a summary log if needed.
                // For now, this is handled by logger.warn in the task.
                // No need for the separate noPrebidUrls set.
                logger.warn('No Prebid data found for URL (summary)', { url: taskResult.url });
            } else if (taskResult.type === 'error') {
                // Already logged by the task itself.
                // No need for the separate errorUrls set.
                logger.error('Error processing URL (summary)', { url: taskResult.url, error: taskResult.error });
            }
        }

        await cluster.close(); // Close the cluster

    } catch (error: any) {
        logger.error("An unexpected error occurred during cluster processing or setup", { error });
        // Ensure cluster is closed on error if it was initialized
        // Removed !cluster.isClosed as it's a private property.
        // cluster.close() is idempotent so calling it again if already closed is not an issue.
        if (cluster) {
            await cluster.close();
        }
    } finally {
        logger.info('Final Results Array Count:', { count: results.length });
        // The specific URLs for noPrebidUrls and errorUrls are now in the logs.
        // We don't need to log the sets themselves.

        try {
            // const errorsDir: string = 'errors'; // This directory is handled by Winston's file transports ('logs/')
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }
            // if (!fs.existsSync(errorsDir)) { // Not needed anymore
            //     fs.mkdirSync(errorsDir);
            // }

            if (results.length > 0) {
                const now: Date = new Date();
                const month: string = now.toLocaleString('default', { month: 'short' });
                const year: number = now.getFullYear();
                const day: string = String(now.getDate()).padStart(2, '0');
                const monthDir: string = `output/${month}`;
                const dateFilename: string = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`;

                if (!fs.existsSync(monthDir)) {
                    fs.mkdirSync(monthDir, { recursive: true });
                }

                const jsonOutput: string = JSON.stringify(results, null, 2);
                // Changed from append to write, assuming one run produces one complete file for the day.
                // If appending is desired, fs.appendFileSync can be kept. For now, using write for simplicity.
                fs.writeFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8');
                logger.info(`Results have been written to ${monthDir}/${dateFilename}`);
            } else {
                logger.info('No results to save.');
            }

            // The error files (no_prebid.txt, error_processing.txt) are replaced by Winston's logging.
            // If a summary text file is still desired, it would need to be reconstructed from logs or by keeping the sets.
            // For this refactoring, we assume Winston's structured logs are the primary source for error analysis.

            // Remaining URLs logic needs to be sure all URLs were attempted.
            // `processedUrls` now correctly reflects all URLs that were passed to `cluster.queue`.
            const remainingUrls: string[] = allUrls.filter((url: string) => !processedUrls.has(url));

            fs.writeFileSync(INPUT_FILE_PATH, remainingUrls.join('\n'), 'utf8');
            logger.info(`input.txt updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);

        } catch (err: any) {
            logger.error('Failed to write results, or update input.txt', { error: err });
        }
        // Browser closing is handled by cluster.close()
    }
}

prebidExplorer();
