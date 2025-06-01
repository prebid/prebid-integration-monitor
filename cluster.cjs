const { addExtra } = require('puppeteer-extra');
const puppeteerVanilla = require('puppeteer'); // Renaming to puppeteerVanilla for clarity
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// const puppeteer = require('puppeteer'); // This line is replaced by puppeteer-extra initialization
const { Cluster } = require('puppeteer-cluster');
const fs = require('fs');
const path = require('path');

const puppeteer = addExtra(puppeteerVanilla); // Reinitialize puppeteer with puppeteer-extra
puppeteer.use(StealthPlugin()); // Apply StealthPlugin

const errorLogPath = path.join(__dirname, 'errors', 'navigation_errors.txt');

// Helper function to log errors
const logError = (url, message, error) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} | URL: ${url} | Message: ${message} | Error: ${error ? error.message : 'N/A'}\n`;
  fs.appendFileSync(errorLogPath, logMessage);
};

// Function to wait for pbjs.version
const getPbjsVersionWithWait = async (pageOrFrame) => {
    return pageOrFrame.evaluate(async () => {
        const timeoutMs = 15000; // 15 seconds
        const intervalMs = 100;
        let elapsedTime = 0;
        while (elapsedTime < timeoutMs) {
            if (window.pbjs && typeof window.pbjs.version === 'string' && window.pbjs.version.length > 0) {
                return window.pbjs.version;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            elapsedTime += intervalMs;
        }
        // Throw an error if not found after timeout, to be caught by the calling try-catch
        throw new Error('pbjs.version not found or invalid after timeout');
    });
};

const clusterSearch = async () => {
    const cluster = await Cluster.launch({
        puppeteer,
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 1, // Keeping concurrency low for demonstration and resource management
        puppeteerOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Common args for running in restricted environments
        }
    });

    await cluster.task(async ({ page, data: url }) => {
        try {
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
            let version;
            try {
                version = await getPbjsVersionWithWait(page);
            } catch (e) {
                logError(url, `Failed to get pbjs.version from main page (or timed out): ${e.message}`, e);
                version = null;
            }

            if (version) {
                console.log(`URL: ${url}, PBJS Version: ${version}`);
            } else {
                // This log might be redundant if getPbjsVersionWithWait throws and is caught,
                // but good for cases where it might return null/undefined differently.
                // The error log above will capture the timeout.
                console.log(`URL: ${url}, PBJS Version: Not found on main page after waiting. Checking frames...`);
                // Log that initial check failed, specific error is in the catch block
                logError(url, "pbjs.version not found on main page after waiting or initial evaluate failed", null);
                const frames = page.frames();
                let versionFoundInFrame = false;
                if (frames.length > 1) { // Only check frames if there are any besides the main one
                    for (const frame of frames) {
                        // Skip the main frame, already checked
                        if (frame === page.mainFrame()) continue;
                        try {
                            const frameVersion = await getPbjsVersionWithWait(frame);
                            if (frameVersion) {
                                console.log(`URL: ${url}, PBJS Version (found in frame ${frame.url()}): ${frameVersion}`);
                                versionFoundInFrame = true;
                                break;
                            }
                        } catch (frameError) {
                            logError(url, `Error evaluating frame ${frame.url()} or timed out: ${frameError.message}`, frameError);
                        }
                    }
                }
                if (!versionFoundInFrame) {
                    console.log(`URL: ${url}, PBJS Version: Not found in any frame after waiting.`);
                    logError(url, "pbjs.version not found in any frame after waiting", null);
                }
            }
        } catch (e) {
            // This catch is for page.goto() errors or other unexpected issues in the task
            logError(url, "Navigation or task processing error", e);
            console.error(`Error processing ${url}: ${e.message}`);
        }
    });

    // Example URLs to test (replace with actual list if needed)
    // cluster.queue('https://example.com');
    // cluster.queue('https://prebid.org/examples/adops/integration-testing.html');

    const inputFile = path.join(__dirname, 'input.txt');
    try {
        const urls = fs.readFileSync(inputFile, 'utf8').split('\n').filter(line => line.trim() !== '');
        if (urls.length === 0) {
            console.log('input.txt is empty or contains no valid URLs. Exiting.');
            logError("N/A", "input.txt is empty or contains no valid URLs", null);
        } else {
            console.log(`Queueing ${urls.length} URLs from input.txt`);
            urls.forEach(url => cluster.queue(url));
        }
    } catch (error) {
        console.error(`Failed to read or process input.txt: ${error.message}`);
        logError("N/A", "Failed to read or process input.txt", error);
        // If input.txt cannot be read, we might not want to proceed further,
        // or proceed with some default/no URLs. For now, it will just log and proceed to idle.
    }

    await cluster.idle();
    await cluster.close();
}

clusterSearch().catch(error => {
    console.error("Unhandled error in clusterSearch:", error);
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} | Message: Unhandled error in clusterSearch | Error: ${error ? error.message : 'N/A'}\n`;
    fs.appendFileSync(errorLogPath, logMessage);
});