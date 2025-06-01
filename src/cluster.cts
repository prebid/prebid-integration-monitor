import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla from 'puppeteer'; // Renaming to puppeteerVanilla for clarity
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Changed to require
// const puppeteer = require('puppeteer'); // This line is replaced by puppeteer-extra initialization
import { Cluster } from 'puppeteer-cluster';
import * as fs from 'fs';
import * as path from 'path';
import { Page, Frame, Dialog } from 'puppeteer'; // Import Page, Frame, Dialog types

const puppeteer = addExtra(puppeteerVanilla); // Reinitialize puppeteer with puppeteer-extra
puppeteer.use(StealthPlugin()); // Apply StealthPlugin

const errorLogPath: string = path.join(__dirname, 'errors', 'navigation_errors.txt');

// Helper function to log errors
const logError = (url: string, message: string, error: Error | null) => {
  const timestamp: string = new Date().toISOString();
  const logMessage: string = `${timestamp} | URL: ${url} | Message: ${message} | Error: ${error ? error.message : 'N/A'}\n`;
  fs.appendFileSync(errorLogPath, logMessage);
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
                    console.log(`Dismissed dialog for ${url}: ${message}`);
                    logError(url, `Dialog dismissed: ${message}`, null);
                } catch (e: any) {
                    console.error(`Error dismissing dialog for ${url}: ${e.message}`);
                    logError(url, `Error dismissing dialog: ${e.message}`, e);
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
                console.log(`URL: ${url}, PBJS Version: ${version}`);
            } else {
                // This log might be redundant if getPbjsVersionWithWait throws and is caught,
                // but good for cases where it might return null/undefined differently.
                // The error log above will capture the timeout.
                console.log(`URL: ${url}, PBJS Version: Not found on main page after waiting. Checking frames...`);
                // Log that initial check failed, specific error is in the catch block
                logError(url, "pbjs.version not found on main page after waiting or initial evaluate failed", null);
                const frames: Frame[] = page.frames(); // Added Frame[] type
                let versionFoundInFrame: boolean = false;
                if (frames.length > 1) {
                    for (const frame of frames) {
                        if (frame === page.mainFrame()) continue;

                        if (frame.isDetached()) {
                            const detachedFrameUrl: string = frame.url(); // Get URL before it's completely inaccessible
                            logError(url, `Skipping detached frame: ${detachedFrameUrl}`, null);
                            console.log(`URL: ${url}, Skipping detached frame: ${detachedFrameUrl}`);
                            continue;
                        }

                        try {
                            const frameUrl: string = frame.url(); // Get URL for logging before potential errors
                            const frameVersion: string | null = await getPbjsVersionWithWait(frame);
                            if (frameVersion) {
                                console.log(`URL: ${url}, PBJS Version (found in frame ${frameUrl}): ${frameVersion}`);
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
                    console.log(`URL: ${url}, PBJS Version: Not found in any frame after waiting.`);
                    // No need to log "pbjs.version not found in any frame" here if individual frames already logged errors/timeouts.
                    // However, if all frames were skipped (e.g. detached) or simply didn't have pbjs, this is useful.
                    // We can refine this log if it becomes too noisy. For now, keeping the original intent.
                    logError(url, "pbjs.version not found in any (accessible/non-timed-out) frame after waiting", null);
                }
            }
        } catch (e: any) {
            // This catch is for page.goto() errors or other unexpected issues in the task
            logError(url, "Navigation or task processing error", e);
            console.error(`Error processing ${url}: ${e.message}`);
        }
    });

    // Example URLs to test (replace with actual list if needed)
    // cluster.queue('https://example.com');
    // cluster.queue('https://prebid.org/examples/adops/integration-testing.html');

    const inputFile: string = path.join(__dirname, 'input.txt');
    try {
        const urls: string[] = fs.readFileSync(inputFile, 'utf8').split('\n').filter(line => line.trim() !== '');
        if (urls.length === 0) {
            console.log('input.txt is empty or contains no valid URLs. Exiting.');
            logError("N/A", "input.txt is empty or contains no valid URLs", null);
        } else {
            console.log(`Queueing ${urls.length} URLs from input.txt`);
            urls.forEach((url: string) => cluster.queue(url));
        }
    } catch (error: any) {
        console.error(`Failed to read or process input.txt: ${error.message}`);
        logError("N/A", "Failed to read or process input.txt", error);
        // If input.txt cannot be read, we might not want to proceed further,
        // or proceed with some default/no URLs. For now, it will just log and proceed to idle.
    }

    await cluster.idle();
    await cluster.close();
}

clusterSearch().catch((error: Error) => { // Added Error type for catch
    console.error("Unhandled error in clusterSearch:", error);
    const timestamp: string = new Date().toISOString();
    const logMessage: string = `${timestamp} | Message: Unhandled error in clusterSearch | Error: ${error ? error.message : 'N/A'}\n`;
    fs.appendFileSync(errorLogPath, logMessage);
});