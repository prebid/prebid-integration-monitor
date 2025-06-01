import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer'; // Renaming to puppeteerVanilla for clarity
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Changed to require
// const puppeteer = require('puppeteer'); // This line is replaced by puppeteer-extra initialization
import { Cluster } from 'puppeteer-cluster';
import * as fs from 'fs'; // Keep fs for readFileSync for now
import * as path from 'path';
import { Page, Frame, Dialog } from 'puppeteer'; // Import Page, Frame, Dialog types
import logger from './utils/logger.js'; // Corrected path

const puppeteer = addExtra(puppeteerVanilla); // Reinitialize puppeteer with puppeteer-extra
puppeteer.use(StealthPlugin()); // Apply StealthPlugin

// Helper function to log errors (modified to use Winston)
const logError = (url: string, message: string, error: Error | any | null) => { // Allow 'any' for error to capture various types
  const logDetails: { url: string, errorMessage: string, errorDetails?: string, stack?: string } = {
    url: url,
    errorMessage: message, // Renamed to avoid conflict with Winston's 'message'
  };
  if (error) {
    logDetails.errorDetails = error.message || 'N/A';
    logDetails.stack = error.stack;
  }
  // The first argument to logger.error is the primary message string.
  // The second argument is an object for additional metadata.
  logger.error(message, logDetails);
};

// Function to wait for pbjs.version
const getPbjsVersionWithWait = async (pageOrFrame: Page | Frame): Promise<string | null> => {
    return pageOrFrame.evaluate(async () => {
        const timeoutMs: number = 15000; // 15 seconds
        const intervalMs: number = 100;
        let elapsedTime: number = 0;
        while (elapsedTime < timeoutMs) {
            // TODO: Define window.pbjs type more accurately if possible
            if ((window as any).pbjs && typeof (window as any).pbjs.version === 'string' && (window as any).pbjs.version.length > 0) {
                return (window as any).pbjs.version;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            elapsedTime += intervalMs;
        }
        // Throw an error if not found after timeout, to be caught by the calling try-catch
        throw new Error('pbjs.version not found or invalid after timeout');
    });
};

const clusterSearch = async (): Promise<void> => {
    const cluster: Cluster<string, any> = await Cluster.launch({ // Added types for Cluster
        puppeteer,
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 1, // Keeping concurrency low for demonstration and resource management
        puppeteerOptions: {
            headless: true, // Consider making this configurable
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees,IsolateOrigins,site-per-process'
            ],
            ignoreHTTPSErrors: true
        },
        retryLimit: 3,
        retryDelay: 10000,
        timeout: 120000 // Increased timeout for the whole task including retries
    });

    await cluster.task(async ({ page, data: url }: { page: Page, data: string }) => { // Added types for task callback
        try {
            // await page.setIgnoreHTTPSErrors(true); // 1. This line is removed. Global option should suffice.

            // 2. Dialog Handler
            page.on('dialog', async (dialog: Dialog) => { // Added Dialog type
                try {
                    const message: string = dialog.message();
                    await dialog.dismiss();
                    logger.info(`Dismissed dialog for ${url}: ${message}`, { url });
                    // logError(url, `Dialog dismissed: ${message}`, null); // Replaced by logger.info or logger.warn if needed
                } catch (e: any) {
                    logger.error(`Error dismissing dialog for ${url}`, { url, error: e });
                    // logError(url, `Error dismissing dialog: ${e.message}`, e); // Replaced by logger.error
                }
            });

            await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
            let version: string | null;
            try {
                version = await getPbjsVersionWithWait(page);
            } catch (e: any) {
                logError(url, `Failed to get pbjs.version from main page (or timed out): ${e.message}`, e);
                version = null;
            }

            if (version) {
                logger.info(`PBJS Version: ${version}`, { url });
            } else {
                logger.info(`PBJS Version: Not found on main page after waiting. Checking frames...`, { url });
                // logError(url, "pbjs.version not found on main page after waiting or initial evaluate failed", null); // Captured by getPbjsVersionWithWait's error log
                const frames: Frame[] = page.frames(); // Added Frame[] type
                let versionFoundInFrame: boolean = false;
                if (frames.length > 1) {
                    for (const frame of frames) {
                        if (frame === page.mainFrame()) continue;

                        if (frame.isDetached()) {
                            const detachedFrameUrl: string = frame.url(); // Get URL before it's completely inaccessible
                            logger.warn(`Skipping detached frame: ${detachedFrameUrl}`, { url, frameUrl: detachedFrameUrl });
                            // console.log(`URL: ${url}, Skipping detached frame: ${detachedFrameUrl}`); // Replaced
                            continue;
                        }

                        try {
                            const frameUrl: string = frame.url(); // Get URL for logging before potential errors
                            const frameVersion: string | null = await getPbjsVersionWithWait(frame);
                            if (frameVersion) {
                                logger.info(`PBJS Version (found in frame ${frameUrl}): ${frameVersion}`, { url, frameUrl });
                                versionFoundInFrame = true;
                                break;
                            }
                        } catch (frameError: any) {
                            // Use frame.url() in the error log. If frame.url() itself errors due to detachment, handle it.
                            let currentFrameUrl: string = 'unknown';
                            try {
                                currentFrameUrl = frame.url();
                            } catch (e: any) {
                                currentFrameUrl = 'detached or inaccessible';
                            }
                            logError(url, `Error evaluating frame ${currentFrameUrl} or timed out: ${frameError.message}`, frameError);
                        }
                    }
                }
                if (!versionFoundInFrame) {
                    logger.warn(`PBJS Version: Not found in any (accessible/non-timed-out) frame after waiting.`, { url });
                    // logError(url, "pbjs.version not found in any (accessible/non-timed-out) frame after waiting", null); // Replaced
                }
            }
        } catch (e: any) {
            // This catch is for page.goto() errors or other unexpected issues in the task
            logError(url, "Navigation or task processing error", e); // logError now uses logger.error
            // console.error(`Error processing ${url}: ${e.message}`); // Covered by logError
        }
    });

    // Example URLs to test (replace with actual list if needed)
    // cluster.queue('https://example.com');
    // cluster.queue('https://prebid.org/examples/adops/integration-testing.html');

    const inputFile: string = path.join(__dirname, 'input.txt'); // __dirname is fine in .cts
    try {
        const urls: string[] = fs.readFileSync(inputFile, 'utf8').split('\n').filter(line => line.trim() !== '');
        if (urls.length === 0) {
            logger.warn('input.txt is empty or contains no valid URLs. Exiting.', { file: inputFile });
            // logError("N/A", "input.txt is empty or contains no valid URLs", null); // Replaced
        } else {
            logger.info(`Queueing ${urls.length} URLs from input.txt`, { file: inputFile });
            urls.forEach((url: string) => cluster.queue(url));
        }
    } catch (error: any) {
        logger.error(`Failed to read or process input.txt: ${error.message}`, { file: inputFile, error });
        // logError("N/A", "Failed to read or process input.txt", error); // Replaced
        // If input.txt cannot be read, we might not want to proceed further,
        // or proceed with some default/no URLs. For now, it will just log and proceed to idle.
    }

    await cluster.idle();
    await cluster.close();
}

clusterSearch().catch((error: Error) => { // Added Error type for catch
    // console.error("Unhandled error in clusterSearch:", error); // Replaced by logger
    // The old fs.appendFileSync is removed. Winston's error transport will handle this.
    // The logError function itself uses logger.error.
    // If error is not an Error instance, or for more context:
    const message = "Unhandled error in clusterSearch";
    if (error instanceof Error) {
        logError("N/A", message, error);
    } else {
        logger.error(message, { errorDetails: String(error) });
    }
});