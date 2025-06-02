import * as fs from 'fs';
import { initializeLogger } from './utils/logger.js';
import type { Logger as WinstonLogger } from 'winston';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla, { Browser, PuppeteerLaunchOptions } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPluginFactory from 'puppeteer-extra-plugin-block-resources';
import { Cluster } from 'puppeteer-cluster';
import { Page } from 'puppeteer';

// Helper function to configure a new page
async function configurePage(page: Page): Promise<Page> { // page is passed directly by puppeteer-cluster
    page.setDefaultTimeout(55000);
    // Set to a common Chrome user agent
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

export interface PrebidExplorerOptions {
    inputFile: string;
    puppeteerType: 'vanilla' | 'cluster';
    concurrency: number;
    headless: boolean;
    monitor: boolean;
    outputDir: string;
    logDir: string;
    puppeteerLaunchOptions?: PuppeteerLaunchOptions;
}

let logger: WinstonLogger;

const puppeteer = addExtra(puppeteerVanilla as any);

export async function prebidExplorer(options: PrebidExplorerOptions): Promise<void> {
    logger = initializeLogger(options.logDir);

    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());

    const blockResources = (blockResourcesPluginFactory as any)();
    if (blockResources && blockResources.blockedTypes && typeof blockResources.blockedTypes.add === 'function') {
      const typesToBlock: Set<any> = new Set<any>([
          'image', 'font', 'websocket', 'media',
          'texttrack', 'eventsource', 'manifest', 'other'
      ]);
      typesToBlock.forEach(type => blockResources.blockedTypes.add(type));
      puppeteer.use(blockResources); // Use the configured instance
    } else {
      logger.warn('Could not configure blockResourcesPlugin: blockedTypes property or .add method not available on instance.', { plugin: blockResources });
    }

    const basePuppeteerOptions: PuppeteerLaunchOptions = {
        protocolTimeout: 1000000,
        defaultViewport: null,
        headless: options.headless,
        args: options.puppeteerLaunchOptions?.args || [],
        ...options.puppeteerLaunchOptions
    };

    let results: PageData[] = [];
    const taskResults: TaskResult[] = [];
    const allUrls: string[] = fs.readFileSync(options.inputFile, 'utf8').split('\n').map((url: string) => url.trim()).filter((url: string) => url.length > 0);
    logger.info(`Initial URLs read from ${options.inputFile}`, { count: allUrls.length, urls: allUrls });
    const processedUrls: Set<string> = new Set();

    // Define the core processing task (used by both vanilla and cluster)
    const processPageTask = async (page: Page, url: string): Promise<TaskResult> => {
        const trimmedUrl: string = url;
        logger.info(`Processing: ${trimmedUrl}`, { url: trimmedUrl });
        try {
            await configurePage(page);
            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

            await page.evaluate(async () => {
                const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * .10); // 6 seconds delay
            });

            const pageData: PageData = await page.evaluate((): PageData => {
                const data: Partial<PageData> = {};
                data.libraries = [];
                data.date = new Date().toISOString().slice(0, 10);
                if ((window as any).apstag) data.libraries.push('apstag');
                if ((window as any).googletag) data.libraries.push('googletag');
                if ((window as any).ats) data.libraries.push('ats');
                if ((window as any)._pbjsGlobals && Array.isArray((window as any)._pbjsGlobals)) {
                    data.prebidInstances = [];
                    (window as any)._pbjsGlobals.forEach(function(globalVarName: string) {
                        const pbjsInstance = (window as any)[globalVarName];
                        if (pbjsInstance && pbjsInstance.version && pbjsInstance.installedModules) {
                            data.prebidInstances!.push({
                                globalVarName: globalVarName,
                                version: pbjsInstance.version,
                                modules: pbjsInstance.installedModules
                            });
                        }
                    });
                }
                return data as PageData;
            });
            pageData.url = trimmedUrl;
            if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                return { type: 'success', data: pageData };
            } else {
                logger.warn(`No relevant Prebid or ad library data found for ${trimmedUrl}`, { url: trimmedUrl });
                return { type: 'no_data', url: trimmedUrl };
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
            return { type: 'error', url: trimmedUrl, error: errorCode };
        }
    };


    if (options.puppeteerType === 'cluster') {
        const cluster: Cluster<string, TaskResult> = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            maxConcurrency: options.concurrency,
            monitor: options.monitor,
            puppeteer,
            puppeteerOptions: basePuppeteerOptions,
        });

        // The task function now returns TaskResult
        await cluster.task(async ({ page, data: url }: { page: Page, data: string }): Promise<TaskResult> => {
            const result = await processPageTask(page, url);
            return result;
        });

        try {
            const promises = allUrls.filter(url => url).map(url => {
                processedUrls.add(url);
                return cluster.queue(url)
                    .then(resultFromQueue => {
                        return resultFromQueue;
                    })
                    .catch(error => {
                        logger.error(`Error from cluster.queue for ${url}:`, { error });
                        // Create and return a TaskResult for errors during queueing/task execution
                        const errorResult: TaskResult = { type: 'error', url: url, error: 'QUEUE_ERROR_OR_TASK_FAILED' };
                        return errorResult;
                    });
            });

            const settledResults = await Promise.allSettled(promises);

            settledResults.forEach(settledResult => {
                if (settledResult.status === 'fulfilled') {
                    // Ensure that what we receive is indeed a TaskResult, otherwise log and push an error.
                    // This handles cases where cluster.queue might resolve with something unexpected.
                    if (settledResult.value && typeof settledResult.value.type === 'string') {
                        taskResults.push(settledResult.value as TaskResult);
                    } else {
                        logger.error('Unexpected fulfillment value from cluster.queue promise, not a TaskResult.', { value: settledResult.value });
                        // Attempt to find the URL associated with this problematic result if possible.
                        // This is hard here as we don't have the original URL in this direct context.
                        // For now, pushing a generic error. A more robust solution might involve mapping promises to URLs.
                        taskResults.push({ type: 'error', url: 'unknown_url_unexpected_fulfillment', error: 'UNEXPECTED_FULFILLMENT_VALUE' });
                    }
                } else { // status === 'rejected'
                    logger.error('A promise from cluster.queue settled as rejected.', { reason: settledResult.reason });
                    // The URL is not directly available here from settledResult.reason.
                    // This indicates an error deeper than the task execution itself (e.g., cluster internal error).
                    // We need to associate the original URL with the promise to log it here.
                    // For now, pushing a generic error. This path implies the .catch in the .map() failed.
                    taskResults.push({ type: 'error', url: 'unknown_url_promise_rejection', error: 'PROMISE_REJECTED_UNEXPECTEDLY' });
                }
            });

            await cluster.idle();
            await cluster.close();
        } catch (error: any) {
            logger.error("An unexpected error occurred during cluster processing orchestration", { error });
            if (cluster) await cluster.close();
        }
    } else { // 'vanilla' Puppeteer
        let browser: Browser | null = null;
        try {
            browser = await puppeteer.launch(basePuppeteerOptions);
            for (const url of allUrls) {
                if (url) {
                    const page = await browser.newPage();
                    const result = await processPageTask(page, url);
                    taskResults.push(result);
                    await page.close();
                    processedUrls.add(url);
                }
            }
        } catch (error: any) {
            logger.error("An unexpected error occurred during vanilla Puppeteer processing", { error });
        } finally {
            if (browser) await browser.close();
        }
    }

    // Common result processing and file writing logic
    for (const taskResult of taskResults) {
        if (!taskResult) { // This check should ideally be unnecessary if the above logic is sound
            logger.warn(`A task returned a nullish result, which should have been prevented.`);
            continue;
        }
        if (taskResult.type === 'success') {
            logger.info(`Data found for ${taskResult.data.url}`, { url: taskResult.data.url });
            results.push(taskResult.data);
        } else if (taskResult.type === 'no_data') {
            logger.warn('No Prebid data found for URL (summary)', { url: taskResult.url });
        } else if (taskResult.type === 'error') {
            logger.error('Error processing URL (summary)', { url: taskResult.url, error: taskResult.error });
        }
    }

    logger.info('Final Results Array Count:', { count: results.length });

    try {
        if (!fs.existsSync(options.outputDir)) {
            fs.mkdirSync(options.outputDir, { recursive: true });
        }

        if (results.length > 0) {
            const now: Date = new Date();
            const month: string = now.toLocaleString('default', { month: 'short' });
            const year: number = now.getFullYear();
            const day: string = String(now.getDate()).padStart(2, '0');
            const monthDir: string = `${options.outputDir}/${month}`;
            const dateFilename: string = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`;

            if (!fs.existsSync(monthDir)) {
                fs.mkdirSync(monthDir, { recursive: true });
            }

            const jsonOutput: string = JSON.stringify(results, null, 2);
            fs.writeFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8');
            logger.info(`Results have been written to ${monthDir}/${dateFilename}`);
        } else {
            logger.info('No results to save.');
        }

        const remainingUrls: string[] = allUrls.filter((url: string) => !processedUrls.has(url));
        fs.writeFileSync(options.inputFile, remainingUrls.join('\n'), 'utf8');
        logger.info(`${options.inputFile} updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);

    } catch (err: any) {
        logger.error('Failed to write results, or update input.txt', { error: err });
    }
}
