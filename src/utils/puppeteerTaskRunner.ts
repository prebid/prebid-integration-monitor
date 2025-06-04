import type { Logger as WinstonLogger } from 'winston';
import { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';
import { PrebidExplorerOptions, PageData, TaskResult } from '../prebid.js';

// This 'puppeteer' instance should be the one from prebid.ts (addExtra(puppeteerVanilla as any))
// It needs to be passed to this class or initialized similarly.
// For now, this will be a placeholder. The actual instance will be passed from prebid.ts
let puppeteerInstance: any;

/**
 * @internal
 * Configures a Puppeteer page with default settings.
 * @param page - The Puppeteer page instance to configure.
 * @returns A promise that resolves with the configured page.
 */
async function configurePage(page: Page): Promise<Page> {
    page.setDefaultTimeout(55000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return page;
}

/**
 * @internal
 * Utility class for running Puppeteer tasks to scan URLs.
 */
export class PuppeteerTaskRunner {
    private logger: WinstonLogger;
    private options: PrebidExplorerOptions;
    private puppeteer: any; // Store the passed puppeteer instance

    constructor(options: PrebidExplorerOptions, logger: WinstonLogger, puppeteer: any) {
        this.options = options;
        this.logger = logger;
        this.puppeteer = puppeteer; // Use the passed puppeteer instance
    }

    /**
     * Core task to process a single page and extract Prebid-related data.
     * @param {object} params - The parameters object.
     * @param {Page} params.page - The Puppeteer page instance.
     * @param {string} params.data - The URL to process (passed as `data` by puppeteer-cluster).
     * @returns A promise that resolves with a {@link TaskResult}.
     */
    private async processPageTask({ page, data: url }: { page: Page, data: string }): Promise<TaskResult> {
        const trimmedUrl: string = url;
        this.logger.info(`Processing: ${trimmedUrl}`, { url: trimmedUrl });
        try {
            await configurePage(page);
            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

            await page.evaluate(async () => {
                const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
                await sleep(6000);
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
                this.logger.warn(`No relevant Prebid or ad library data found for ${trimmedUrl}`, { url: trimmedUrl });
                return { type: 'no_data', url: trimmedUrl };
            }
        } catch (pageError: any) {
            this.logger.error(`Error processing ${trimmedUrl}`, { url: trimmedUrl, error: pageError });
            const errorMessage: string = pageError.message || 'Unknown error';
            const netErrorMatch: RegExpMatchArray | null = errorMessage.match(/net::([A-Z_]+)/);
            let errorCode: string;

            if (netErrorMatch) {
                errorCode = netErrorMatch[1];
            } else {
                const prefix: string = `Error processing ${trimmedUrl}: `;
                if (errorMessage.startsWith(prefix)) {
                    errorCode = errorMessage.substring(prefix.length).trim();
                } else {
                    errorCode = errorMessage.trim();
                }
                errorCode = errorCode.replace(/\s+/g, '_').toUpperCase() || 'UNKNOWN_PAGE_ERROR';
            }
            return { type: 'error', url: trimmedUrl, error: errorCode };
        }
    }

    /**
     * Runs the Puppeteer tasks for the given URLs.
     * @param urlsToProcess - An array of URLs to scan.
     * @param processedUrlsSet - A Set to keep track of processed URLs (will be updated by this method).
     * @returns A promise that resolves with an array of {@link TaskResult}.
     */
    public async runTasks(urlsToProcess: string[], processedUrlsSet: Set<string>): Promise<TaskResult[]> {
        const taskResults: TaskResult[] = [];
        const basePuppeteerOptions: PuppeteerLaunchOptions = {
            protocolTimeout: 1000000,
            defaultViewport: null,
            headless: this.options.headless,
            args: this.options.puppeteerLaunchOptions?.args || [],
            ...this.options.puppeteerLaunchOptions
        };

        const chunkSize = this.options.chunkSize && this.options.chunkSize > 0 ? this.options.chunkSize : 0;

        if (chunkSize > 0) {
            this.logger.info(`Chunked processing enabled. Chunk size: ${chunkSize}`);
            const totalChunks = Math.ceil(urlsToProcess.length / chunkSize);
            this.logger.info(`Total chunks to process: ${totalChunks}`);

            for (let i = 0; i < urlsToProcess.length; i += chunkSize) {
                const currentChunkUrls = urlsToProcess.slice(i, i + chunkSize);
                const chunkNumber = Math.floor(i / chunkSize) + 1;
                this.logger.info(`Processing chunk ${chunkNumber} of ${totalChunks}: URLs ${i + 1}-${Math.min(i + chunkSize, urlsToProcess.length)}`);

                await this.executeChunk(currentChunkUrls, basePuppeteerOptions, taskResults, processedUrlsSet, chunkNumber);
                this.logger.info(`Finished processing chunk ${chunkNumber} of ${totalChunks}.`);
            }
        } else {
            this.logger.info(`Processing all ${urlsToProcess.length} URLs without chunking.`);
            await this.executeChunk(urlsToProcess, basePuppeteerOptions, taskResults, processedUrlsSet);
        }
        return taskResults;
    }

    private async executeChunk(
        urlsInChunk: string[],
        basePuppeteerOptions: PuppeteerLaunchOptions,
        taskResults: TaskResult[],
        processedUrlsSet: Set<string>,
        chunkNumber?: number
    ): Promise<void> {
        if (this.options.puppeteerType === 'cluster') {
            const cluster: Cluster<string, TaskResult> = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_CONTEXT,
                maxConcurrency: this.options.concurrency,
                monitor: this.options.monitor,
                puppeteer: this.puppeteer,
                puppeteerOptions: basePuppeteerOptions,
            });

            await cluster.task(this.processPageTask.bind(this) as any);

            try {
                const promises = urlsInChunk.filter(url => url).map(url => {
                    processedUrlsSet.add(url);
                    return cluster.queue(url)
                        .then(resultFromQueue => resultFromQueue)
                        .catch(error => {
                            const logContext = chunkNumber ? `in chunk ${chunkNumber}` : '';
                            this.logger.error(`Error from cluster.queue for ${url} ${logContext}:`, { error });
                            return { type: 'error', url: url, error: 'QUEUE_ERROR_OR_TASK_FAILED' } as TaskResult;
                        });
                });
                const settledResults = await Promise.allSettled(promises);
                settledResults.forEach(settledResult => {
                    if (settledResult.status === 'fulfilled') {
                        if (settledResult.value !== undefined && settledResult.value !== null) {
                            taskResults.push(settledResult.value);
                        } else {
                            const logContext = chunkNumber ? `(chunk ${chunkNumber})` : '(non-chunked)';
                            this.logger.warn(`A task from cluster.queue ${logContext} settled with undefined/null value.`, { settledResult });
                        }
                    } else {
                        this.logger.error(`A promise from cluster.queue ${chunkNumber ? `(chunk ${chunkNumber})` : ''} settled as rejected.`, { reason: settledResult.reason });
                    }
                });
                await cluster.idle();
                await cluster.close();
            } catch (error: any) {
                const logContext = chunkNumber ? `chunk ${chunkNumber}` : 'cluster processing';
                this.logger.error(`An error occurred during processing ${logContext} with puppeteer-cluster.`, { error });
                if (cluster) await cluster.close();
            }
        } else {
            let browser: Browser | null = null;
            try {
                browser = await this.puppeteer.launch(basePuppeteerOptions);
                if (browser) {
                    for (const url of urlsInChunk) {
                        if (url) {
                            const page = await browser.newPage();
                            const result = await this.processPageTask({ page, data: url });
                            taskResults.push(result);
                            await page.close();
                            processedUrlsSet.add(url);
                        }
                    }
                } else {
                    this.logger.error(`Browser instance could not be launched and was null/undefined during vanilla processing for chunk ${chunkNumber || 'N/A'}.`);
                }
            } catch (error: any) {
                const logContext = chunkNumber ? `chunk ${chunkNumber}` : 'vanilla processing';
                this.logger.error(`An error occurred during ${logContext} with vanilla Puppeteer.`, { error });
            } finally {
                if (browser) {
                    await browser.close();
                }
            }
        }
    }
}

export function setPuppeteerInstance(instance: any) {
    puppeteerInstance = instance;
}
