import * as fs from 'fs';
import { initializeLogger } from './utils/logger.js';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPluginFactory from 'puppeteer-extra-plugin-block-resources';
import { Cluster } from 'puppeteer-cluster';
// Helper function to configure a new page
async function configurePage(page) {
    page.setDefaultTimeout(55000);
    // Set to a common Chrome user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return page;
}
let logger;
const puppeteer = addExtra(puppeteerVanilla);
export async function prebidExplorer(options) {
    logger = initializeLogger(options.logDir);
    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());
    const blockResources = blockResourcesPluginFactory();
    if (blockResources && blockResources.blockedTypes && typeof blockResources.blockedTypes.add === 'function') {
        const typesToBlock = new Set([
            'image', 'font', 'websocket', 'media',
            'texttrack', 'eventsource', 'manifest', 'other'
        ]);
        typesToBlock.forEach(type => blockResources.blockedTypes.add(type));
        puppeteer.use(blockResources); // Use the configured instance
    }
    else {
        logger.warn('Could not configure blockResourcesPlugin: blockedTypes property or .add method not available on instance.', { plugin: blockResources });
    }
    const basePuppeteerOptions = {
        protocolTimeout: 1000000,
        defaultViewport: null,
        headless: options.headless,
        args: options.puppeteerLaunchOptions?.args || [],
        ...options.puppeteerLaunchOptions
    };
    let results = [];
    const taskResults = [];
    const allUrls = fs.readFileSync(options.inputFile, 'utf8').split('\n').map((url) => url.trim()).filter((url) => url.length > 0);
    logger.info(`Initial URLs read from ${options.inputFile}`, { count: allUrls.length, urls: allUrls });
    const processedUrls = new Set();
    // Define the core processing task (used by both vanilla and cluster)
    const processPageTask = async (page, url) => {
        const trimmedUrl = url;
        logger.info(`Processing: ${trimmedUrl}`, { url: trimmedUrl });
        try {
            await configurePage(page);
            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });
            await page.evaluate(async () => {
                const sleep = (ms) => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * .10); // 6 seconds delay
            });
            const pageData = await page.evaluate(() => {
                const data = {};
                data.libraries = [];
                data.date = new Date().toISOString().slice(0, 10);
                if (window.apstag)
                    data.libraries.push('apstag');
                if (window.googletag)
                    data.libraries.push('googletag');
                if (window.ats)
                    data.libraries.push('ats');
                if (window._pbjsGlobals && Array.isArray(window._pbjsGlobals)) {
                    data.prebidInstances = [];
                    window._pbjsGlobals.forEach(function (globalVarName) {
                        const pbjsInstance = window[globalVarName];
                        if (pbjsInstance && pbjsInstance.version && pbjsInstance.installedModules) {
                            data.prebidInstances.push({
                                globalVarName: globalVarName,
                                version: pbjsInstance.version,
                                modules: pbjsInstance.installedModules
                            });
                        }
                    });
                }
                return data;
            });
            pageData.url = trimmedUrl;
            if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                return { type: 'success', data: pageData };
            }
            else {
                logger.warn(`No relevant Prebid or ad library data found for ${trimmedUrl}`, { url: trimmedUrl });
                return { type: 'no_data', url: trimmedUrl };
            }
        }
        catch (pageError) {
            logger.error(`Error processing ${trimmedUrl}`, { url: trimmedUrl, error: pageError });
            const errorMessage = pageError.message || '';
            const netErrorMatch = errorMessage.match(/net::([A-Z_]+)/);
            let errorCode;
            if (netErrorMatch) {
                errorCode = netErrorMatch[1];
            }
            else {
                const prefix = `Error processing ${trimmedUrl}: `;
                if (errorMessage.startsWith(prefix)) {
                    errorCode = errorMessage.substring(prefix.length).trim();
                }
                else {
                    errorCode = errorMessage.trim() || 'UNKNOWN_ERROR';
                }
                errorCode = errorCode.replace(/\s+/g, '_').toUpperCase();
            }
            return { type: 'error', url: trimmedUrl, error: errorCode };
        }
    };
    if (options.puppeteerType === 'cluster') {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            maxConcurrency: options.concurrency,
            monitor: options.monitor,
            puppeteer,
            puppeteerOptions: basePuppeteerOptions,
        });
        // The task function now returns TaskResult
        await cluster.task(async ({ page, data: url }) => {
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
                    const errorResult = { type: 'error', url: url, error: 'QUEUE_ERROR_OR_TASK_FAILED' };
                    return errorResult;
                });
            });
            const settledResults = await Promise.allSettled(promises);
            settledResults.forEach(settledResult => {
                if (settledResult.status === 'fulfilled') {
                    taskResults.push(settledResult.value);
                }
                else {
                    logger.error('A promise from cluster.queue settled as rejected, which was not expected as errors should be converted to TaskResult.', { reason: settledResult.reason });
                }
            });
            await cluster.idle();
            await cluster.close();
        }
        catch (error) {
            logger.error("An unexpected error occurred during cluster processing orchestration", { error });
            if (cluster)
                await cluster.close();
        }
    }
    else { // 'vanilla' Puppeteer
        let browser = null;
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
        }
        catch (error) {
            logger.error("An unexpected error occurred during vanilla Puppeteer processing", { error });
        }
        finally {
            if (browser)
                await browser.close();
        }
    }
    // Common result processing and file writing logic
    for (const taskResult of taskResults) {
        if (!taskResult) {
            logger.warn(`A task returned no result. This should not happen.`);
            continue;
        }
        if (taskResult.type === 'success') {
            logger.info(`Data found for ${taskResult.data.url}`, { url: taskResult.data.url });
            results.push(taskResult.data);
        }
        else if (taskResult.type === 'no_data') {
            logger.warn('No Prebid data found for URL (summary)', { url: taskResult.url });
        }
        else if (taskResult.type === 'error') {
            logger.error('Error processing URL (summary)', { url: taskResult.url, error: taskResult.error });
        }
    }
    logger.info('Final Results Array Count:', { count: results.length });
    try {
        if (!fs.existsSync(options.outputDir)) {
            fs.mkdirSync(options.outputDir, { recursive: true });
        }
        if (results.length > 0) {
            const now = new Date();
            const month = now.toLocaleString('default', { month: 'short' });
            const year = now.getFullYear();
            const day = String(now.getDate()).padStart(2, '0');
            const monthDir = `${options.outputDir}/${month}`;
            const dateFilename = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`;
            if (!fs.existsSync(monthDir)) {
                fs.mkdirSync(monthDir, { recursive: true });
            }
            const jsonOutput = JSON.stringify(results, null, 2);
            fs.writeFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8');
            logger.info(`Results have been written to ${monthDir}/${dateFilename}`);
        }
        else {
            logger.info('No results to save.');
        }
        const remainingUrls = allUrls.filter((url) => !processedUrls.has(url));
        fs.writeFileSync(options.inputFile, remainingUrls.join('\n'), 'utf8');
        logger.info(`${options.inputFile} updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);
    }
    catch (err) {
        logger.error('Failed to write results, or update input.txt', { error: err });
    }
}
