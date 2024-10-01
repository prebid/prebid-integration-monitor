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
            headless: true
        });

    let results = [];

    const page = await browser.newPage();
    page.setDefaultTimeout(75000);
  
    const urls = readline.createInterface({
        input: fs.createReadStream('input.txt')
    });

    try {
        for await (const url of urls) {
            console.log(`Line from file: ${url}`);
            
            await page.goto(url, { timeout: 70000, waitUntil: 'networkidle2' });
            await page.evaluate(async () => {
                const sleep = ms => new Promise(res => setTimeout(res, ms));
                await sleep((1000 * 60) * 0.12);
            });

            const prebidData = await page.evaluate(() => {
                const data = [];

                if (window._pbjsGlobals) {
                    // Iterate through all keys in _pbjsGlobals
                    for (const key in window._pbjsGlobals) {
                        if (window._pbjsGlobals.hasOwnProperty(key)) {
                            // Access the properties of each global object
                            const moduleData = window._pbjsGlobals[key];

                            // Check if it has the necessary properties
                            if (moduleData.version && moduleData.installedModules) {
                                data.push({
                                    url: location.href,
                                    version: moduleData.version,
                                    modules: moduleData.installedModules
                                });
                            }
                        }
                    }
                }
                return data.length ? data : null; // Return data if available
            });

            if (prebidData != null) {
                results.push(...prebidData); // Spread operator to push multiple results
            }
        }
    } catch (error) {
        throw new Error(error);
    } finally {
        console.log(results);
        try {
            fs.appendFileSync('output/10k.json', JSON.stringify(results, null, 2)); // Pretty print the JSON
        } catch (err) {
            console.error(err);
        }
        if (browser) {
            await browser.close();
        }
    }
}

prebidExplorer();
