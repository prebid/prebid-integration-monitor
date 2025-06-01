import * as fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import blockResourcesPlugin from 'puppeteer-extra-plugin-block-resources';
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


async function prebidExplorer(): Promise<void> {
    // Apply puppeteer-extra plugins
    puppeteer.use(StealthPlugin());
    puppeteer.use(blockResourcesPlugin({
        blockedTypes: new Set<any>([ // Added 'any' for blockedTypes
            'image',
            'font',
            'websocket',
            'media',
            'texttrack',
            'eventsource',
            'manifest',
            'other'
        ])
    }));

    const cluster: Cluster<string, any> = await Cluster.launch({ // Added types for Cluster
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 5, // Set a reasonable maxConcurrency
        puppeteer, // Use the puppeteer-extra instance with plugins
        puppeteerOptions: {
            protocolTimeout: 1000000,
            defaultViewport: null,
            headless: true, // Consider 'new' for future compatibility
        },
    });

    let results: PageData[] = []; // Typed results
    const taskResults: TaskResult[] = []; // Array to store results from all tasks
    const allUrls: string[] = fs.readFileSync('input.txt', 'utf8').split('\n').map((url: string) => url.trim()).filter((url: string) => url.length > 0);
    console.log('Initial URLs read from input.txt:', allUrls); // Log the URLs
    const processedUrls: Set<string> = new Set();
    const noPrebidUrls: Set<string> = new Set();
    const errorUrls: Set<string> = new Set();


    // Define the task for the cluster
    await cluster.task(async ({ page, data: url }: { page: Page, data: string }) => { // Added types for task callback
        const trimmedUrl: string = url; // URL is already trimmed and validated
        console.log(`Processing: ${trimmedUrl}`);
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
                console.log(`No relevant data found for ${trimmedUrl}`);
                taskResult = { type: 'no_data', url: trimmedUrl };
            }
        } catch (pageError: any) {
            console.error(`Error processing ${trimmedUrl}:`, pageError.message);
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

    } catch (error: any) {
        console.error("An unexpected error occurred during cluster processing or setup:", error);
        // Ensure cluster is closed on error if it was initialized
        // Removed !cluster.isClosed as it's a private property.
        // cluster.close() is idempotent so calling it again if already closed is not an issue.
        if (cluster) {
            await cluster.close();
        }
    } finally {
        console.log('Final Results Array:', results);
        console.log('Final noPrebidUrls Set:', noPrebidUrls);
        console.log('Final errorUrls Set:', errorUrls);
        try {
            const errorsDir: string = 'errors';
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }
            if (!fs.existsSync(errorsDir)) {
                fs.mkdirSync(errorsDir);
            }

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
            const remainingUrls: string[] = allUrls.filter((url: string) => !processedUrls.has(url));

            fs.writeFileSync('input.txt', remainingUrls.join('\n'), 'utf8');
            console.log(`input.txt updated. ${processedUrls.size} URLs processed, ${remainingUrls.length} URLs remain.`);

        } catch (err: any) {
            console.error('Failed to write results, update error files, or update input.txt:', err);
        }
        // Browser closing is handled by cluster.close()
    }
}

prebidExplorer();
