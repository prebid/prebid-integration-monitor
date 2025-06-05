/**
 * @file cluster.cts
 * @description This script utilizes puppeteer-cluster to efficiently scan a list of URLs
 *              for Prebid.js (pbjs) versions. It leverages puppeteer-extra with the
 *              stealth plugin to appear more like a regular browser.
 *
 *              The script reads URLs from an 'input.txt' file located in the same
 *              directory. For each URL, it attempts to find `pbjs.version` on the
 *              main page and within any iframes. It includes robust error handling
 *              and logging mechanisms.
 *
 * @requires puppeteer-extra
 * @requires puppeteer-extra-plugin-stealth
 * @requires puppeteer-cluster
 * @requires fs
 * @requires path
 * @requires ./utils/logger.js
 */
import { addExtra } from 'puppeteer-extra';
import puppeteerVanilla, { PuppeteerLaunchOptions } from 'puppeteer'; // Renaming to puppeteerVanilla for clarity, import PuppeteerLaunchOptions
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Changed to require
import { Cluster } from 'puppeteer-cluster'; // Import Cluster
import * as fs from 'fs'; // Keep fs for readFileSync for now
import * as path from 'path';
import { Page, Frame, Dialog } from 'puppeteer'; // Import Page, Frame, Dialog types
import loggerModule from './utils/logger.js'; // Corrected path, renamed to loggerModule
const logger = loggerModule.instance; // Use the logger instance

// --- Constants for Configuration ---
/** Maximum number of concurrent workers in the cluster. */
const MAX_CONCURRENCY = 1;
/** Number of times to retry a task if it fails. */
const RETRY_LIMIT = 3;
/** Delay in milliseconds before retrying a failed task. */
const RETRY_DELAY_MS = 10000;
/** Maximum time in milliseconds for a task (including retries) to run. */
const TASK_TIMEOUT_MS = 120000;
/** Maximum time in milliseconds for page navigation (page.goto). */
const PAGE_NAVIGATION_TIMEOUT_MS = 60000;
/** Timeout in milliseconds for waiting for pbjs.version to appear on a page/frame. */
const PBJS_VERSION_WAIT_TIMEOUT_MS = 15000;
/** Interval in milliseconds for checking for pbjs.version on a page/frame. */
const PBJS_VERSION_WAIT_INTERVAL_MS = 100;

/**
 * Custom error class for timeouts that occur specifically when waiting for `pbjs.version`.
 * This allows for more specific error handling if needed by the caller.
 */
class PbjsVersionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PbjsVersionTimeoutError";
  }
}

// --- Cluster Configuration ---

/**
 * Interface for Puppeteer Cluster configuration settings.
 */
interface ClusterConfig {
  concurrency: typeof Cluster.CONCURRENCY_CONTEXT | typeof Cluster.CONCURRENCY_PAGE | typeof Cluster.CONCURRENCY_BROWSER; // More specific type
  maxConcurrency: number;
  retryLimit: number;
  retryDelay: number;
  timeout: number;
  puppeteerOptions: PuppeteerLaunchOptions;
}

/**
 * Configuration object for the Puppeteer Cluster.
 * This groups all settings for launching and managing the cluster.
 */
const CLUSTER_CONFIG: ClusterConfig = {
    concurrency: Cluster.CONCURRENCY_CONTEXT, // Uses a new browser context for each task
    maxConcurrency: MAX_CONCURRENCY,           // Max number of concurrent workers
    puppeteerOptions: {
        headless: true, // Run in headless mode (true/false/'new') - Consider making this configurable
        args: [
            '--no-sandbox', // Required for running Puppeteer in some environments (e.g., Docker without specific user setup)
            '--disable-setuid-sandbox', // Disables the setuid sandbox (often used with --no-sandbox)
            '--disable-web-security', // Disables web security features (useful for cross-origin iframes, use with caution)
            '--disable-dev-shm-usage', // Prevents issues with shared memory in certain Linux environments (e.g., Docker)
            '--disable-accelerated-2d-canvas', // Disables GPU acceleration for 2D canvas (stability)
            '--disable-gpu', // Disables GPU hardware acceleration (stability/compatibility)
            '--disable-features=TranslateUI,BlinkGenPropertyTrees,IsolateOrigins,site-per-process'
        ],
        ignoreHTTPSErrors: true // Ignores HTTPS errors (e.g., self-signed certificates)
    },
    retryLimit: RETRY_LIMIT,       // Number of retries if a task fails
    retryDelay: RETRY_DELAY_MS,    // Delay between retries in milliseconds
    timeout: TASK_TIMEOUT_MS       // Timeout for the entire task (including retries) in milliseconds
};

/**
 * Reads a list of URLs from a specified file.
 * Each URL should be on a new line. Empty lines are ignored.
 * @param {string} filePath - The path to the file containing URLs.
 * @returns {string[]} An array of URL strings.
 * @throws {Error} If the file cannot be read (e.g., file not found, permissions).
 */
const loadUrlsFromFile = (filePath: string): string[] => {
    // This function is synchronous. The `clusterSearch` function will wrap its call
    // in a try-catch block to handle potential errors like file not found.
    const fileContent: string = fs.readFileSync(filePath, 'utf8');
    return fileContent.split('\n').filter(line => line.trim() !== '');
};

const puppeteer = addExtra(puppeteerVanilla); // Reinitialize puppeteer with puppeteer-extra
puppeteer.use(StealthPlugin()); // Apply StealthPlugin

// Helper function to log errors (modified to use Winston)
/**
 * Logs an error message along with associated URL and error details.
 * Uses the global Winston logger instance.
 * @param {string} url - The URL where the error occurred or 'N/A' if not applicable.
 * @param {string} message - A descriptive message for the error.
 * @param {Error | any | null} error - The error object or details. Can be of type Error, any, or null.
 * @param {string} [actionContext] - Optional. The action or step being performed when the error occurred.
 */
const logError = (url: string, message: string, error: Error | any | null, actionContext?: string) => { // Allow 'any' for error to capture various types
  const logDetails: { url: string, errorMessage: string, errorDetails?: string, stack?: string, actionContext?: string } = {
    url: url,
    errorMessage: message, // Renamed to avoid conflict with Winston's 'message'
  };
  if (error) {
    logDetails.errorDetails = error.message || 'N/A';
    logDetails.stack = error.stack;
  }
  if (actionContext) {
    logDetails.actionContext = actionContext;
  }
  // The first argument to logger.error is the primary message string.
  // The second argument is an object for additional metadata.
  logger.error(message, logDetails); // Message remains the primary consumable log line
};

/**
 * Handles dialogs encountered on a page by dismissing them and logging the action.
 * @param {Dialog} dialog - The Puppeteer Dialog object.
 * @param {string} url - The URL of the page where the dialog appeared, for logging.
 * @returns {Promise<void>}
 */
const handleDialog = async (dialog: Dialog, url: string): Promise<void> => {
    try {
        const message: string = dialog.message();
        await dialog.dismiss();
        logger.info(`Dismissed dialog for ${url}: ${message}`, { url });
    } catch (e: any) {
        logError(url, "Error dismissing dialog", e, "dismissing dialog");
    }
};

// Function to wait for pbjs.version
/**
 * Attempts to retrieve the `pbjs.version` from a given Puppeteer Page or Frame.
 * It waits for up to `PBJS_VERSION_WAIT_TIMEOUT_MS` for `window.pbjs.version`
 * to be available and be a non-empty string.
 * @param {Page | Frame} pageOrFrame - The Puppeteer Page or Frame object to evaluate.
 * @returns {Promise<string | null>} A promise that resolves to the `pbjs.version` string if found.
 * @throws {PbjsVersionTimeoutError} If `pbjs.version` is not found or is invalid after the timeout.
 *                                   This error is intended to be caught by the calling function.
 */
const getPbjsVersionWithWait = async (pageOrFrame: Page | Frame): Promise<string | null> => {
    // Pass constants as arguments to the evaluate function
    // This makes the dependencies of the page context explicit
    return pageOrFrame.evaluate(async (timeoutMs, intervalMs) => {
        let elapsedTime: number = 0;
        // Loop until the elapsed time reaches the defined timeout.
        while (elapsedTime < timeoutMs) {
            // TODO: Define window.pbjs type more accurately if possible.
            // Using 'any' for window.pbjs as its structure can vary or is not strictly typed here.
            // The runtime check for pbjs and pbjs.version (string, length > 0) provides some safety.
            if ((window as any).pbjs &&
                typeof (window as any).pbjs.version === 'string' &&
                (window as any).pbjs.version.length > 0) { // Ensure version is not an empty string
                return (window as any).pbjs.version; // Version found, return it.
            }
            // Wait for the defined interval before checking again.
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            elapsedTime += intervalMs;
        }
        // If the loop completes without returning, pbjs.version was not found within the timeout.
        // This error is created in the page context and serialized back.
        throw new PbjsVersionTimeoutError('pbjs.version not found or invalid after timeout');
    }, PBJS_VERSION_WAIT_TIMEOUT_MS, PBJS_VERSION_WAIT_INTERVAL_MS);
};

/**
 * Attempts to retrieve the PBJS version from the main page.
 * Logs the outcome (version found, not found, or error).
 * @param {Page} page - The Puppeteer Page object.
 * @param {string} url - The URL of the page, for logging.
 * @returns {Promise<string | null>} The PBJS version string if found, otherwise null.
 */
const getPbjsVersionFromPage = async (page: Page, url: string): Promise<string | null> => {
    try {
        const version = await getPbjsVersionWithWait(page);
        if (version) {
            // This specific logging is now part of the main task logic
            // logger.info(`PBJS Version: ${version}`, { url });
        }
        return version;
    } catch (e: any) {
        logError(url, `Failed to get pbjs.version from main page (or timed out): ${e.message}`, e, "getting pbjs.version from main page");
        return null;
    }
};

/**
 * Iterates through all frames on a page to find a PBJS version.
 * It skips the main frame and handles detached or inaccessible frames.
 * Logs the outcome for each frame and returns the first version found.
 * @param {Page} page - The Puppeteer Page object.
 * @param {string} url - The URL of the main page, for logging context.
 * @returns {Promise<string | null>} The first PBJS version string found in an iframe, otherwise null.
 */
const getPbjsVersionFromFrames = async (page: Page, url: string): Promise<string | null> => {
    const frames: Frame[] = page.frames();
    if (frames.length > 1) {
        for (const frame of frames) {
            if (frame === page.mainFrame()) continue;

            if (frame.isDetached()) {
                const detachedFrameUrl: string = frame.url(); // Get URL before it's completely inaccessible
                logger.warn(`Skipping detached frame: ${detachedFrameUrl}`, { url, frameUrl: detachedFrameUrl });
                continue;
            }

            try {
                const frameUrl: string = frame.url(); // Get URL for logging before potential errors
                const frameVersion: string | null = await getPbjsVersionWithWait(frame);
                if (frameVersion) {
                    logger.info(`PBJS Version (found in frame ${frameUrl}): ${frameVersion}`, { url, frameUrl });
                    return frameVersion; // Return the first version found
                }
            } catch (frameError: any) {
                // Use frame.url() in the error log. If frame.url() itself errors due to detachment, handle it.
                let currentFrameUrl: string = 'unknown';
                try {
                    currentFrameUrl = frame.url();
                } catch (e: any) {
                    currentFrameUrl = 'detached or inaccessible';
                }
                logError(url, `Error evaluating frame ${currentFrameUrl} or timed out: ${frameError.message}`, frameError, "evaluating frame for pbjs.version");
            }
        }
    }
    return null; // No version found in any frame
};

/**
 * Main function to initialize and run the Puppeteer cluster for scanning URLs.
 * It sets up the cluster with specified concurrency, Puppeteer launch options,
 * retry mechanisms, and timeouts. It then defines the core task for processing each URL,
 * which includes navigating to the page, handling dialogs, and attempting to extract
 * `pbjs.version` from both the main page and any embedded iframes.
 * URLs are read from an 'input.txt' file, and progress/errors are logged.
 * @returns {Promise<void>} A promise that resolves when the cluster has processed all queued URLs and has been closed.
 *                          It may throw an error if unhandled exceptions occur during setup or execution.
 */
const clusterSearch = async (): Promise<void> => {
    const cluster: Cluster<string, any> = await Cluster.launch({ // Added types for Cluster
        puppeteer, // The Puppeteer instance (with stealth plugin) to use
        ...CLUSTER_CONFIG // Spread the rest of the configuration
    });

    await cluster.task(async ({ page, data: url }: { page: Page, data: string }) => { // Added types for task callback
        try {

            // 2. Dialog Handler
            page.on('dialog', (dialog: Dialog) => handleDialog(dialog, url));

            await page.goto(url, { waitUntil: 'networkidle0', timeout: PAGE_NAVIGATION_TIMEOUT_MS });
            const version: string | null = await getPbjsVersionFromPage(page, url);

            if (version) {
                logger.info(`PBJS Version: ${version}`, { url });
            } else {
                // Log that it wasn't found on the main page, then proceed to check frames.
                // The getPbjsVersionFromPage function already logs errors/timeouts for the main page.
                logger.info(`PBJS Version: Not found on main page. Checking frames...`, { url });
                const versionFromFrames = await getPbjsVersionFromFrames(page, url);
                if (!versionFromFrames) {
                    // getPbjsVersionFromFrames will log if a version is found in a specific frame.
                    // If it returns null, then we log that it wasn't found in any frame.
                    logger.warn(`PBJS Version: Not found in any (accessible/non-timed-out) frame after waiting.`, { url });
                }
                // If versionFromFrames is not null, it means it was found and logged by getPbjsVersionFromFrames.
            }
        } catch (e: any) {
            // This catch is for page.goto() errors or other unexpected issues in the task
            logError(url, "Navigation or task processing error", e, "processing URL in cluster task");
        }
    });

    const inputFile: string = path.join(__dirname, 'input.txt'); // __dirname is fine in .cts
    try {
        const urls: string[] = loadUrlsFromFile(inputFile);
        if (urls.length === 0) {
            logger.warn('input.txt is empty or contains no valid URLs. Exiting.', { file: inputFile });
        } else {
            logger.info(`Queueing ${urls.length} URLs from input.txt`, { file: inputFile });
            urls.forEach((url: string) => cluster.queue(url));
        }
    } catch (error: any) {
        logger.error(`Failed to read or process input.txt: ${error.message}`, { file: inputFile, error });
    }

    await cluster.idle();
    await cluster.close();
}

clusterSearch().catch((error: Error) => { // Added Error type for catch
    const message = "Unhandled error in clusterSearch";
    if (error instanceof Error) {
        logError("N/A", message, error, "running clusterSearch"); // logError uses the instance
    } else {
        // For non-Error objects, we might not have a stack, so actionContext is still useful.
        logger.error(message, { errorDetails: String(error), actionContext: "running clusterSearch" });
    }
});