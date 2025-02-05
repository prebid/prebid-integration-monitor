import * as fs from 'fs';
import * as readline from 'readline';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

async function prebidExplorer() {
    const browser = await puppeteer
        .use(StealthPlugin())
        .launch({
            protocolTimeout: 300000,
            defaultViewport: null,
            headless: true,
        });

    let results = [];

    const page = await browser.newPage();
    page.setDefaultTimeout(55000);

    // Set to Googlebot user agent
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

    const urls = readline.createInterface({
        input: fs.createReadStream('input.txt')
    });

    try {
        for await (const url of urls) {
            const trimmedUrl = url.trim();
            console.log(trimmedUrl)

            /* page.on('request', request => {
                console.log(request.url());
                console.log(request.failure());
            });

            page.on('response', response => {
                console.log(response.ok());
                console.log(response.status());
                console.log(response.statusText());
            }); */

            await page.goto(trimmedUrl, { timeout: 60000, waitUntil: 'networkidle2' });

            // Slight delay to ensure the page is fully loaded
            await page.evaluate(async () => {
                const sleep = ms => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * .10);
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
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        console.log('Results:', results);
        try {
            if (results.length == 0) {
                await browser.close();
                return null
            }


            // Ensure the output directory exists
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }


            // Write results as a JSON array
            const jsonOutput = JSON.stringify(results, null, 2);  // Pretty print with 2 spaces
            fs.appendFileSync('output/Feb/5th.json', jsonOutput, 'utf8');
            console.log('Results have been saved');
        } catch (err) {
            console.error('Failed to write results:', err);
        }

        if (browser) {
            await browser.close();
        }
    }
}

prebidExplorer();
