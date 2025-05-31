const { addExtra } = require('puppeteer-extra')
const puppeteerVanilla = require('puppeteer')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { Cluster } = require('puppeteer-cluster')
const fs = require('fs');
const path = require('path');

const puppeteer = addExtra(puppeteerVanilla)
puppeteer.use(StealthPlugin)

const clusterSearch = async () => {
    let urlsToProcess = [];
    const inputFile = 'input.txt';

    try {
        const fileContent = fs.readFileSync(inputFile, 'utf8');
        urlsToProcess = fileContent.split('\n').map(url => url.trim()).filter(url => url.length > 0);
        if (urlsToProcess.length === 0) {
            console.log(`No URLs found in ${inputFile}.`);
        } else {
            console.log(`Loaded ${urlsToProcess.length} URLs from ${inputFile}.`);
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`${inputFile} not found. Please create it or run preloader.js first.`);
        } else {
            console.error(`Error reading ${inputFile}:`, error.message);
        }
        // Decide if to exit or let the cluster run with an empty queue
        // For now, we'll let it run, and it should simply finish quickly.
    }

    const cluster = await Cluster.launch({
        puppeteer,
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 5, // Value can be adjusted based on system resources and monitoring needs.
        puppeteerOptions: {
            headless: true
        }
    })

    await cluster.task(async ({ page, data: url }) => {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for pbjs to be defined (up to 10 seconds)
            await page.waitForFunction('typeof window.pbjs !== "undefined"', { timeout: 10000 });

            // If waitForFunction succeeded, pbjs should exist.
            // The prebidExists check is somewhat redundant but kept for safety / to align with example.
            const prebidExists = await page.evaluate(() => typeof window.pbjs !== 'undefined');
            let version = 'Prebid object not found after explicit wait'; // Default if something unexpected happens

            if (prebidExists) {
                version = await page.evaluate(() => {
                    try {
                        if (window.pbjs && typeof window.pbjs.version !== 'undefined') {
                            return window.pbjs.version;
                        }
                        return 'pbjs.version not accessible';
                    } catch (e) {
                        return 'Error getting pbjs.version';
                    }
                });
            } else {
                // This case should be rare if waitForFunction is effective
                console.log(`Prebid.js (pbjs) still not found on ${url} after explicit wait.`);
            }

            console.log(`Checked: ${url}, Prebid Version: ${version}`);

        } catch (error) {
            console.error(`Error processing ${url}: ${error.message}`);
            // This will catch timeouts from goto, waitForFunction, or other evaluation errors
        }
    });

    urlsToProcess.forEach(url => cluster.queue(url));

      await cluster.idle();
      await cluster.close();
    }

// Export the function for testing or external use
module.exports = { clusterSearch };

// Run the function only if this script is executed directly
if (require.main === module) {
  clusterSearch().catch(error => {
    console.error("Unhandled error in clusterSearch:", error);
    process.exit(1);
  });
}