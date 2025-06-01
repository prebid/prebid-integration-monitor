import * as fs from 'fs'; // Keep fs for readFileSync, existsSync, mkdirSync, writeFileSync
// Import initializeLogger and winston Logger type
import { initializeLogger } from './utils/logger.js';
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer'; // Reverted to simple default import, added Browser and PuppeteerLaunchOptions
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPluginFactory from 'puppeteer-extra-plugin-block-resources'; // Renamed for clarity
import { Cluster } from 'puppeteer-cluster';
// Helper function to configure a new page
async function configurePage(page) {
    page.setDefaultTimeout(55000);
    // Set to Googlebot user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return page;
}
// Declare logger at module level, to be initialized by prebidExplorer
let logger;
const puppeteer = addExtra(puppeteerVanilla); // Initialize puppeteer-extra, cast to any
// Step 2: Modify prebidExplorer to accept an object of type PrebidExplorerOptions
// Step 8: Export the prebidExplorer function
export async function prebidExplorer(options) {
    // Step 3: Update prebid.ts to call this new logger initialization function.
    logger = initializeLogger(options.logDir);
    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());
    // Call the factory (casting to any to bypass potential type def issue) and configure instance
    const blockResources = blockResourcesPluginFactory();
    if (blockResources && blockResources.blockedTypes && typeof blockResources.blockedTypes.add === 'function') {
        // blockResources.blockedTypes is a Set-like object, use its add method
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
    // Step 4: Update to use options.inputFile for reading URLs
    // Step 5: Update to use options.outputDir for saving results
    // Step 6: Implement logic to switch between 'vanilla' Puppeteer and 'cluster'
    // Step 7: Ensure puppeteer.launch options are configurable
    const basePuppeteerOptions = {
        protocolTimeout: 1000000,
        defaultViewport: null,
        headless: options.headless, // Use headless from options
        args: options.puppeteerLaunchOptions?.args || [], // Pass through args
        ...options.puppeteerLaunchOptions // Spread other potential options
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
            // taskResults.push(result); // Results can be collected from cluster.execute or by processing queue returns
            return result;
        });
        try {
            const promises = allUrls.filter(url => url).map(url => {
                processedUrls.add(url); // Mark as processed when queuing starts
                return cluster.queue(url)
                    .then(resultFromQueue => {
                    // Ensure successful results are correctly typed for pushing or further processing
                    return resultFromQueue; // This is already TaskResult
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
                    // Value should be TaskResult. Explicitly cast for diagnostics.
                    taskResults.push(settledResult.value);
                }
                else {
                    // This case should ideally not be reached if .catch handles errors and returns a TaskResult.
                    // However, if cluster.queue() itself throws an error that isn't caught by the .catch
                    // (e.g., an issue before the task even runs, not covered by the task's try/catch),
                    // it might end up here. We need a URL for error reporting.
                    // This part is tricky as the original URL isn't directly available in settledResult.reason if it's a generic error.
                    // For now, we'll log a generic error. This implies a URL might not be processed.
                    // A more robust solution would involve mapping original URLs to promises if this becomes an issue.
                    logger.error('A promise from cluster.queue settled as rejected, which was not expected as errors should be converted to TaskResult.', { reason: settledResult.reason });
                    // To maintain data integrity, we might need to know which URL failed here.
                    // This might require associating URLs with promises more explicitly if direct cluster.queue rejections are possible.
                }
            });
            await cluster.idle(); // Should be quick if all tasks are done via Promise.allSettled
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
            const monthDir = `${options.outputDir}/${month}`; // Use options.outputDir
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
        fs.writeFileSync(options.inputFile, remainingUrls.join('\n'), 'utf8'); // Use options.inputFile
        logger.info(`${options.inputFile} updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);
    }
    catch (err) {
        logger.error('Failed to write results, or update input.txt', { error: err });
    }
}
// Step 7: Remove the direct call to prebidExplorer()
// prebidExplorer();
