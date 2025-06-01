import * as fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Cluster } from 'puppeteer-cluster';

// Helper function to configure a new page
async function configurePage(page) { // page is passed directly by puppeteer-cluster
    page.setDefaultTimeout(55000);
    // Set to Googlebot user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    return page;
}


async function prebidExplorer() {
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 5, // Set a reasonable maxConcurrency
        puppeteer, // Use the imported puppeteer-extra
        puppeteerOptions: {
            protocolTimeout: 1000000,
            defaultViewport: null,
            headless: true, // Consider 'new' for future compatibility
        },
        perBrowserOptions: [ // Apply StealthPlugin to each browser instance in the cluster
            { plugins: [StealthPlugin()] },
            { plugins: [StealthPlugin()] },
            { plugins: [StealthPlugin()] },
            { plugins: [StealthPlugin()] },
            { plugins: [StealthPlugin()] },
        ],
    });

    let results = [];
    const taskResults = []; // Array to store results from all tasks
    const allUrls = fs.readFileSync('input.txt', 'utf8').split('\n').map(url => url.trim()).filter(url => url.length > 0);
    console.log('Initial URLs read from input.txt:', allUrls); // Log the URLs
    const processedUrls = new Set();
    const noPrebidUrls = new Set();
    const errorUrls = new Set();


    // Define the task for the cluster
    await cluster.task(async ({ page, data: url }) => {
        const trimmedUrl = url; // URL is already trimmed and validated
        console.log(`Processing: ${trimmedUrl}`);
        let taskResult; // To store the result of this specific task

        try {
            await configurePage(page); // Configure the page provided by the cluster
            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

            await page.evaluate(async () => {
                const sleep = ms => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * .10); // 6 seconds delay
            });

            const pageData = await page.evaluate(() => {
                const data = {};
                data.libraries = [];
                data.date = new Date().toISOString().slice(0, 10);

                if (window.apstag) data.libraries.push('apstag');
                if (window.googletag) data.libraries.push('googletag');
                if (window.ats) data.libraries.push('ats');

                if (window._pbjsGlobals && Array.isArray(window._pbjsGlobals)) {
                    data.prebidInstances = [];
                    window._pbjsGlobals.forEach(function(globalVarName) {
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
                taskResult = { type: 'success', data: pageData };
            } else {
                console.log(`No relevant data found for ${trimmedUrl}`);
                taskResult = { type: 'no_data', url: trimmedUrl };
            }
        } catch (pageError) {
            console.error(`Error processing ${trimmedUrl}:`, pageError.message);
            const errorMessage = pageError.message || '';
            const netErrorMatch = errorMessage.match(/net::([A-Z_]+)/);
            let errorCode;
            if (netErrorMatch) {
                errorCode = netErrorMatch[1];
            } else {
                const prefix = `Error processing ${trimmedUrl}: `;
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
        allUrls.forEach(url => {
            if (url) { // Ensure URL is not empty
                cluster.queue(url);
                processedUrls.add(url); // Mark URL as processed when queued
            }
        });

        await cluster.idle(); // Wait for all queued tasks to complete

        // Process results accumulated in taskResults
        for (const taskResult of taskResults) {
            if (!taskResult) {
                console.log(`A task returned no result. This should not happen if tasks always push a result.`);
                // Decide how to handle this, perhaps add the URL to errorUrls if identifiable
                continue;
            }

            if (taskResult.type === 'success') {
                console.log(`Data found for ${taskResult.data.url}`);
                results.push(taskResult.data);
            } else if (taskResult.type === 'no_data') {
                console.log(`No data for ${taskResult.url}, adding to noPrebidUrls.`);
                noPrebidUrls.add(taskResult.url);
            } else if (taskResult.type === 'error') {
                console.log(`Error for ${taskResult.url}: ${taskResult.error}, adding to errorUrls.`);
                errorUrls.add(`${taskResult.url},${taskResult.error}`);
            }
        }

        await cluster.close(); // Close the cluster

    } catch (error) {
        console.error("An unexpected error occurred during cluster processing or setup:", error);
        // Ensure cluster is closed on error if it was initialized
        if (cluster && !cluster.isClosed) {
            await cluster.close();
        }
    } finally {
        console.log('Final Results Array:', results);
        console.log('Final noPrebidUrls Set:', noPrebidUrls);
        console.log('Final errorUrls Set:', errorUrls);
        try {
            const errorsDir = 'errors';
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }
            if (!fs.existsSync(errorsDir)) {
                fs.mkdirSync(errorsDir);
            }

            if (results.length > 0) {
                const now = new Date();
                const month = now.toLocaleString('default', { month: 'short' });
                const year = now.getFullYear();
                const day = String(now.getDate()).padStart(2, '0');
                const monthDir = `output/${month}`;
                const dateFilename = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`;

                if (!fs.existsSync(monthDir)) {
                    fs.mkdirSync(monthDir, { recursive: true });
                }

                const jsonOutput = JSON.stringify(results, null, 2);
                fs.appendFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8');
                console.log(`Results have been appended to ${monthDir}/${dateFilename}`);
            } else {
                console.log('No results to save.');
            }

            if (noPrebidUrls.size > 0) {
                fs.appendFileSync(`${errorsDir}/no_prebid.txt`, Array.from(noPrebidUrls).join('\n') + '\n', 'utf8');
                console.log(`${noPrebidUrls.size} URLs appended to ${errorsDir}/no_prebid.txt`);
            }
            if (errorUrls.size > 0) {
                fs.appendFileSync(`${errorsDir}/error_processing.txt`, Array.from(errorUrls).join('\n') + '\n', 'utf8');
                console.log(`${errorUrls.size} URLs with errors appended to ${errorsDir}/error_processing.txt`);
            }

            // Remaining URLs logic needs to be sure all URLs were attempted.
            // `processedUrls` now correctly reflects all URLs that were passed to `cluster.queue`.
            const remainingUrls = allUrls.filter(url => !processedUrls.has(url));

            fs.writeFileSync('input.txt', remainingUrls.join('\n'), 'utf8');
            console.log(`input.txt updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);

        } catch (err) {
            console.error('Failed to write results, update error files, or update input.txt:', err);
        }
        // Browser closing is handled by cluster.close()
    }
}

prebidExplorer();
