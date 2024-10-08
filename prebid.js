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

    const urls = readline.createInterface({
        input: fs.createReadStream('input.txt')
    });

    const urlArray = [];
    for await (const url of urls) {
        urlArray.push(url.trim());
    }

    // Set concurrency limit
    const concurrencyLimit = 5;

    // A helper function to process a single URL
    const processUrl = async (url) => {
        const page = await browser.newPage();
        page.setDefaultTimeout(75000);

        try {
            console.log(`Processing URL: ${url}`);
            await page.goto(url, { timeout: 70000, waitUntil: 'networkidle2' });

            // Slight delay to ensure the page is fully loaded
            await page.waitForTimeout(7200); // 7.2 seconds delay

            // Collect data from the page
            const pageData = await page.evaluate(() => {
                const data = {};
                data.libraries = [];

                if (window.apstag) {
                    data.libraries.push('apstag');
                }

                if (window.googletag) {
                    data.libraries.push('googletag');
                }

                if (window.ats) {
                    data.libraries.push('ats');
                }

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

            pageData.url = url;

            if (pageData.libraries.length > 0 || (pageData.prebidInstances && pageData.prebidInstances.length > 0)) {
                results.push(pageData);
            }
        } catch (error) {
            console.error(`Error processing URL: ${url}`, error);
        } finally {
            await page.close();
        }
    };

    // A function to handle limited parallel execution
    const asyncPool = async (poolLimit, array, iteratorFn) => {
        const ret = [];
        const executing = [];
        for (const item of array) {
            const p = iteratorFn(item);
            ret.push(p);

            // When the number of executing promises reaches the pool limit, wait for the first one to finish
            if (poolLimit <= executing.length) {
                await Promise.race(executing);
            }

            // Add the new promise to the executing list
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
        }
        return Promise.all(ret);
    };

    try {
        await asyncPool(concurrencyLimit, urlArray, processUrl);
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        console.log('Results:', results);

        try {
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }

            const jsonOutput = JSON.stringify(results, null, 2);
            fs.writeFileSync('output/results.json', jsonOutput, 'utf8');
            console.log('Results have been saved to output/results.json');
        } catch (err) {
            console.error('Failed to write results:', err);
        }

        if (browser) {
            await browser.close();
        }
    }
}

prebidExplorer();
