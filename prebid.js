import * as fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Cluster } from 'puppeteer-cluster';
import path from 'path'; // Added path for consistency, though not strictly used in this snippet yet

// puppeteer-extra already includes StealthPlugin
// puppeteer.use(StealthPlugin()); // This is usually done once

export default async function prebidExplorer() {
    const allUrls = fs.readFileSync('input.txt', 'utf8').split('\n').map(url => url.trim()).filter(url => url.length > 0);

    // Results and error tracking, to be populated after cluster processing
    let results = [];
    const processedUrls = new Set(); // To keep track of URLs that went through processing
    const noPrebidUrls = new Set();
    const errorUrls = new Set();

    if (allUrls.length === 0) {
        console.log("No URLs found in input.txt. Exiting.");
        return;
    }
    console.log(`Loaded ${allUrls.length} URLs from input.txt.`);

    const cluster = await Cluster.launch({
        puppeteer, // Use the puppeteer-extra instance
        concurrency: Cluster.CONCURRENCY_PAGE, // Use page concurrency; CONTEXT might also work
        maxConcurrency: 5, // Adjust as needed
        // monitor: true, // Enable for progress monitoring, consider for debugging
        puppeteerOptions: {
            protocolTimeout: 1000000,
            defaultViewport: null,
            headless: true, // Consider 'new'
            // args: ['--no-sandbox', '--disable-setuid-sandbox'] // Uncomment if running in certain CI environments
        }
    });

    // Define the task for processing each URL
    await cluster.task(async ({ page, data: url }) => {
        const trimmedUrl = url; // URL is already trimmed from initial loading
        console.log(`Processing: ${trimmedUrl}`);

        try {
            // Configure page (moved from helper, applied to cluster's page)
            page.setDefaultTimeout(55000);
            await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });

            // Removed 6-second fixed delay:
            // await page.evaluate(async () => {
            //     const sleep = ms => new Promise(res => setTimeout(res, ms));
            //     await sleep((1000 * 60) * .10);
            // });

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
            processedUrls.add(trimmedUrl); // Mark as processed attempt

            if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                // For now, log result. Will collect properly later.
                // console.log(`Data found for ${trimmedUrl}:`, pageData);
                return { status: 'success', data: pageData };
            } else {
                // console.log(`No relevant data found for ${trimmedUrl}`);
                return { status: 'no_data', url: trimmedUrl };
            }
        } catch (pageError) {
            console.error(`Error processing ${trimmedUrl}:`, pageError.message);
            processedUrls.add(trimmedUrl); // Mark as processed attempt even on error
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

            // Log DETACHED IFRAME or Target closed errors, but don't attempt to recreate page here.
            // Cluster handles page lifecycle. If a page crashes, the task might fail or retry based on cluster config.
            if (errorMessage.includes('DETACHED IFRAME') || errorMessage.includes('Target closed')) {
                console.warn(`Detached iframe or target closed error detected for ${trimmedUrl}.`);
            }
            return { status: 'error', url: trimmedUrl, error: errorCode };
        }
    });

    // Queue all URLs
    for (const url of allUrls) {
        cluster.queue(url, (taskResult) => {
            // This callback is executed once a task is finished.
            // We can process results here.
            if (taskResult) { // taskResult might be undefined if queue function itself had an issue (rare)
                if (taskResult.status === 'success') {
                    results.push(taskResult.data);
                } else if (taskResult.status === 'no_data') {
                    noPrebidUrls.add(taskResult.url);
                } else if (taskResult.status === 'error') {
                    errorUrls.add(`${taskResult.url},${taskResult.error}`);
                }
            }
        });
    }

    try {
        await cluster.idle(); // Wait for all tasks to complete
    } catch (clusterError) {
        console.error("An error occurred during cluster processing:", clusterError);
    } finally {
        await cluster.close(); // Close the cluster/browser

        // --- All file writing and post-processing happens here, after cluster is done ---
        console.log('All URLs processed. Writing results...');
        // console.log('Collected Results:', results); // For debugging

        try {
            const errorsDir = 'errors';
            if (!fs.existsSync('output')) fs.mkdirSync('output');
            if (!fs.existsSync(errorsDir)) fs.mkdirSync(errorsDir);

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
                // Append results as JSON, one object per line for easier appending if run multiple times a day
                // Or, if it's meant to overwrite/create a new file daily, use writeFileSync.
                // For now, sticking to appending behavior.
                const jsonOutput = results.map(res => JSON.stringify(res)).join('\n');
                fs.appendFileSync(path.join(monthDir, dateFilename), jsonOutput + '\n', 'utf8');
                console.log(`Results have been appended to ${path.join(monthDir, dateFilename)}`);
            } else {
                console.log('No results to save.');
            }

            if (noPrebidUrls.size > 0) {
                fs.appendFileSync(path.join(errorsDir, 'no_prebid.txt'), Array.from(noPrebidUrls).join('\n') + '\n', 'utf8');
                console.log(`${noPrebidUrls.size} URLs appended to ${path.join(errorsDir, 'no_prebid.txt')}`);
            }
            if (errorUrls.size > 0) {
                fs.appendFileSync(path.join(errorsDir, 'error_processing.txt'), Array.from(errorUrls).join('\n') + '\n', 'utf8');
                console.log(`${errorUrls.size} URLs with errors appended to ${path.join(errorsDir, 'error_processing.txt')}`);
            }

            // Update input.txt: Write back only URLs that were not processed successfully (e.g. errors, or if script was interrupted)
            // The current logic relies on `processedUrls` which tracks attempts.
            // A more robust way for "remaining" would be to filter `allUrls` by those NOT in `results` (by URL) and not in `noPrebidUrls`.
            // For simplicity, keeping the original logic of removing all attempted URLs.
            // This means if a URL errored, it's still removed from input.txt. This behavior is retained from original.
            const remainingUrls = allUrls.filter(url => !processedUrls.has(url)); // This will be empty if all URLs are processed.
            fs.writeFileSync('input.txt', remainingUrls.join('\n'), 'utf8');
            console.log(`input.txt updated. ${processedUrls.size} URLs attempted, ${remainingUrls.length} URLs remain (if any).`);

        } catch (err) {
            console.error('Failed to write results, update error files, or update input.txt:', err);
        }
    }
}

// Direct invocation removed for module testability
// prebidExplorer().catch(error => {
//     console.error("Unhandled error in prebidExplorer:", error);
//     process.exit(1); // Exit with error code if prebidExplorer fails catastrophically
// });

// To allow direct execution (e.g., via `node prebid.js`)
// Note: This specific check `process.argv[1] === new URL(import.meta.url).pathname` might need adjustment
// depending on how Node.js resolves paths in various execution scenarios (e.g. symlinks).
// A more robust check might involve resolving both paths or using a library if exactness is critical.
// However, this is a common pattern for simple direct execution detection in ES modules.
if (process.argv[1] && import.meta.url && process.argv[1] === new URL(import.meta.url).pathname) {
    (async () => {
        try {
            await prebidExplorer();
            console.log("prebidExplorer finished successfully.");
        } catch (err) {
            console.error("Error running prebidExplorer directly:", err);
            process.exit(1);
        }
    })();
}
