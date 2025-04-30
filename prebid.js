import * as fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Helper function to configure a new page
async function configurePage(browser) {
    const page = await browser.newPage();
    page.setDefaultTimeout(55000);
    // Set to Googlebot user agent
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    return page;
}


async function prebidExplorer() {
    const browser = await puppeteer
        .use(StealthPlugin())
        .launch({
            protocolTimeout: 1000000,
            defaultViewport: null,
            headless: true, // Consider 'new' for future compatibility, but 'true' is fine for now
        });

    let results = [];
    // Read all URLs from input.txt into an array
    const allUrls = fs.readFileSync('input.txt', 'utf8').split('\n').map(url => url.trim()).filter(url => url.length > 0);
    const processedUrls = new Set();
    const noPrebidUrls = new Set(); // Keep track of URLs without prebid/libs
    const errorUrls = new Set(); // Keep track of URLs that caused errors (stores "url,error_code")


    let page = await configurePage(browser); // Use the helper function

    // Remove the readline interface as we read the file directly now
    /* const urls = readline.createInterface({
        input: fs.createReadStream('input.txt')
    }); */

    try {
        // Iterate over the array of URLs
        for (const url of allUrls) {
            const trimmedUrl = url; // Already trimmed
            console.log(`Processing: ${trimmedUrl}`)

            /* page.on('request', request => {
                console.log(request.url());
                console.log(request.failure());
            });

            page.on('response', response => {
                console.log(response.ok());
                console.log(response.status());
                console.log(response.statusText());
            }); */

            try { // Add try-catch around page processing for individual URL errors
                await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

                // Slight delay to ensure the page is fully loaded
                await page.evaluate(async () => {
                    const sleep = ms => new Promise(res => setTimeout(res, ms));
                    await sleep((1000 * 60) * .10); // 6 seconds delay
                })

                // Collect data from the page
                const pageData = await page.evaluate(() => {
                    const data = {};

                    // Initialize libraries array
                    data.libraries = [];

                    data.date = new Date().toISOString().slice(0, 10)

                    // Check for apstag
                    if (window.apstag) {
                        data.libraries.push('apstag');
                    }

                    // Check for googletag
                    if (window.googletag) {
                        data.libraries.push('googletag');
                    }

                    // Check for ats
                    if (window.ats) {
                        data.libraries.push('ats');
                    }

                    // Check for Prebid.js instances
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

                // Add the input URL to the pageData
                pageData.url = trimmedUrl;

                // Only push data if any libraries are found or Prebid.js is present
                if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                    results.push(pageData);
                    // Mark URL as processed if data was found
                    processedUrls.add(trimmedUrl);
                } else {
                    // Mark URL as processed because no relevant data was found
                    processedUrls.add(trimmedUrl);
                    noPrebidUrls.add(trimmedUrl); // Add to the set for logging later
                    console.log(`No relevant data found for ${trimmedUrl}`);
                }
            } catch (pageError) {
                console.error(`Error processing ${trimmedUrl}:`, pageError.message);
                // Mark URL as processed because an error occurred
                processedUrls.add(trimmedUrl);
                // Extract error code after "net::" or the general message after the URL prefix
                const errorMessage = pageError.message || '';
                const netErrorMatch = errorMessage.match(/net::([A-Z_]+)/);
                let errorCode;
                if (netErrorMatch) {
                    errorCode = netErrorMatch[1];
                } else {
                    // Try to get the message part after "Error processing URL: "
                    const prefix = `Error processing ${trimmedUrl}: `;
                    if (errorMessage.startsWith(prefix)) {
                        errorCode = errorMessage.substring(prefix.length).trim();
                    } else {
                        // Fallback if the message format is unexpected
                        errorCode = errorMessage.trim() || 'UNKNOWN_ERROR';
                    }
                    // Replace spaces with underscores and convert to uppercase for consistency if needed
                    errorCode = errorCode.replace(/\s+/g, '_').toUpperCase();
                    // Limit length if necessary
                    // errorCode = errorCode.substring(0, 50); // Example length limit
                }
                errorUrls.add(`${trimmedUrl},${errorCode}`); // Add "url,error_code" to the set for logging later

                // Check for DETACHED IFRAME error to reset the page
                if (errorMessage.includes('DETACHED IFRAME') || errorMessage.includes('Target closed')) {
                    console.warn(`Detached iframe or target closed error detected for ${trimmedUrl}. Closing current page and opening a new one.`);
                    try {
                        await page.close();
                    } catch (closeError) {
                        console.error(`Error closing the page after detached iframe error: ${closeError.message}`);
                        // If closing fails, we might need to terminate the browser instance,
                        // but for now, we'll try creating a new page anyway.
                    }
                    page = await configurePage(browser); // Create and configure a new page
                    console.log("New page created. Continuing with the next URL.");
                    continue; // Skip to the next URL in the loop
                }
            }
        }
    } catch (error) {
        // Catch errors outside the loop (e.g., browser launch)
        console.error("An unexpected error occurred:", error);
    } finally {
        console.log('Results:', results);
        try {
            // Ensure the output and errors directories exist
            const errorsDir = 'errors';
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }
            if (!fs.existsSync(errorsDir)) {
                fs.mkdirSync(errorsDir);
            }

            // Write results if any
            if (results.length > 0) {
                 // Ensure the monthly directory exists (e.g., output/Apr)
                const now = new Date();
                const month = now.toLocaleString('default', { month: 'short' }); // e.g., Apr
                const year = now.getFullYear();
                const day = String(now.getDate()).padStart(2, '0');
                const monthDir = `output/${month}`;
                const dateFilename = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${day}.json`; // YYYY-MM-DD.json

                if (!fs.existsSync(monthDir)) {
                    fs.mkdirSync(monthDir, { recursive: true }); // Create parent dirs if needed
                }

                // Write results as a JSON array
                const jsonOutput = JSON.stringify(results, null, 2);  // Pretty print with 2 spaces
                // Use dynamic path
                fs.appendFileSync(`${monthDir}/${dateFilename}`, jsonOutput + '\n', 'utf8'); // Append with newline
                console.log(`Results have been appended to ${monthDir}/${dateFilename}`);
            } else {
                 console.log('No results to save.');
            }

            // Append URLs to error files if any
            if (noPrebidUrls.size > 0) {
                fs.appendFileSync(`${errorsDir}/no_prebid.txt`, Array.from(noPrebidUrls).join('\n') + '\n', 'utf8');
                console.log(`${noPrebidUrls.size} URLs appended to ${errorsDir}/no_prebid.txt`);
            }
            if (errorUrls.size > 0) {
                // errorUrls now contains strings like "url,error_code"
                fs.appendFileSync(`${errorsDir}/error_processing.txt`, Array.from(errorUrls).join('\n') + '\n', 'utf8');
                 console.log(`${errorUrls.size} URLs with errors appended to ${errorsDir}/error_processing.txt`);
            }


            // Calculate remaining URLs (all original URLs minus the processed ones)
            const remainingUrls = allUrls.filter(url => !processedUrls.has(url));

            // Write remaining URLs back to input.txt
            fs.writeFileSync('input.txt', remainingUrls.join('\n'), 'utf8');
            console.log(`input.txt updated. ${processedUrls.size} URLs removed, ${remainingUrls.length} URLs remain.`);


        } catch (err) {
            console.error('Failed to write results, update error files, or update input.txt:', err);
        }

        if (browser) {
            await browser.close();
        }
    }
}

prebidExplorer();
