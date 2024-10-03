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
    page.setDefaultTimeout(75000);

    const urls = readline.createInterface({
        input: fs.createReadStream('input.txt')
    });

    try {
        for await (const url of urls) {
            const trimmedUrl = url.trim();
            console.log(`Processing URL: ${trimmedUrl}`);

            await page.goto(trimmedUrl, { timeout: 70000, waitUntil: 'networkidle2' });

            // Slight delay to ensure the page is fully loaded
            await page.waitForTimeout(7000);

            // Collect data from the page
            const pageData = await page.evaluate(() => {
                const data = {};

                // Initialize libraries array
                data.libraries = [];

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

                // Check for Prebid.js
                if (window._pbjsGlobals && window._pbjsGlobals.includes('pbjs')) {
                    data.version = pbjs.version;
                    data.modules = pbjs.installedModules;
                }

                return data;
            });

            // Add the input URL to the pageData
            pageData.url = trimmedUrl;

            // Only push data if any libraries are found or Prebid.js is present
            if (pageData.libraries.length > 0 || pageData.version) {
                results.push(pageData);
            }
        }
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        console.log('Results:', results);
        try {
            // Ensure the output directory exists
            if (!fs.existsSync('output')) {
                fs.mkdirSync('output');
            }

            // Write results as a JSON array
            const jsonOutput = JSON.stringify(results, null, 2);  // Pretty print with 2 spaces
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
