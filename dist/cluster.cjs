"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_extra_1 = require("puppeteer-extra");
const puppeteer_1 = __importDefault(require("puppeteer")); // Renaming to puppeteerVanilla for clarity
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Changed to require
// const puppeteer = require('puppeteer'); // This line is replaced by puppeteer-extra initialization
const puppeteer_cluster_1 = require("puppeteer-cluster");
const fs = __importStar(require("fs")); // Keep fs for readFileSync for now
const path = __importStar(require("path"));
const logger_js_1 = __importDefault(require("./utils/logger.js")); // Corrected path, renamed to loggerModule
const logger = logger_js_1.default.instance; // Use the logger instance
const puppeteer = (0, puppeteer_extra_1.addExtra)(puppeteer_1.default); // Reinitialize puppeteer with puppeteer-extra
puppeteer.use(StealthPlugin()); // Apply StealthPlugin
// Helper function to log errors (modified to use Winston)
const logError = (url, message, error) => {
    const logDetails = {
        url: url,
        errorMessage: message, // Renamed to avoid conflict with Winston's 'message'
    };
    if (error) {
        logDetails.errorDetails = error.message || 'N/A';
        logDetails.stack = error.stack;
    }
    // The first argument to logger.error is the primary message string.
    // The second argument is an object for additional metadata.
    logger.error(message, logDetails); // This logger is now the instance
};
// Function to wait for pbjs.version
const getPbjsVersionWithWait = async (pageOrFrame) => {
    return pageOrFrame.evaluate(async () => {
        const timeoutMs = 15000; // 15 seconds
        const intervalMs = 100;
        let elapsedTime = 0;
        while (elapsedTime < timeoutMs) {
            // TODO: Define window.pbjs type more accurately if possible
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
    const cluster = await puppeteer_cluster_1.Cluster.launch({
        puppeteer,
        concurrency: puppeteer_cluster_1.Cluster.CONCURRENCY_CONTEXT,
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
    await cluster.task(async ({ page, data: url }) => {
        try {
            // await page.setIgnoreHTTPSErrors(true); // 1. This line is removed. Global option should suffice.
            // 2. Dialog Handler
            page.on('dialog', async (dialog) => {
                try {
                    const message = dialog.message();
                    await dialog.dismiss();
                    logger.info(`Dismissed dialog for ${url}: ${message}`, { url }); // This logger is now the instance
                    // logError(url, `Dialog dismissed: ${message}`, null); // Replaced by logger.info or logger.warn if needed
                }
                catch (e) {
                    logger.error(`Error dismissing dialog for ${url}`, { url, error: e }); // This logger is now the instance
                    // logError(url, `Error dismissing dialog: ${e.message}`, e); // Replaced by logger.error
                }
            });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
            let version;
            try {
                version = await getPbjsVersionWithWait(page);
            }
            catch (e) {
                logError(url, `Failed to get pbjs.version from main page (or timed out): ${e.message}`, e);
                version = null;
            }
            if (version) {
                logger.info(`PBJS Version: ${version}`, { url }); // This logger is now the instance
            }
            else {
                logger.info(`PBJS Version: Not found on main page after waiting. Checking frames...`, { url }); // This logger is now the instance
                // logError(url, "pbjs.version not found on main page after waiting or initial evaluate failed", null); // Captured by getPbjsVersionWithWait's error log
                const frames = page.frames(); // Added Frame[] type
                let versionFoundInFrame = false;
                if (frames.length > 1) {
                    for (const frame of frames) {
                        if (frame === page.mainFrame())
                            continue;
                        if (frame.isDetached()) {
                            const detachedFrameUrl = frame.url(); // Get URL before it's completely inaccessible
                            logger.warn(`Skipping detached frame: ${detachedFrameUrl}`, { url, frameUrl: detachedFrameUrl }); // This logger is now the instance
                            // console.log(`URL: ${url}, Skipping detached frame: ${detachedFrameUrl}`); // Replaced
                            continue;
                        }
                        try {
                            const frameUrl = frame.url(); // Get URL for logging before potential errors
                            const frameVersion = await getPbjsVersionWithWait(frame);
                            if (frameVersion) {
                                logger.info(`PBJS Version (found in frame ${frameUrl}): ${frameVersion}`, { url, frameUrl }); // This logger is now the instance
                                versionFoundInFrame = true;
                                break;
                            }
                        }
                        catch (frameError) {
                            // Use frame.url() in the error log. If frame.url() itself errors due to detachment, handle it.
                            let currentFrameUrl = 'unknown';
                            try {
                                currentFrameUrl = frame.url();
                            }
                            catch (e) {
                                currentFrameUrl = 'detached or inaccessible';
                            }
                            logError(url, `Error evaluating frame ${currentFrameUrl} or timed out: ${frameError.message}`, frameError);
                        }
                    }
                }
                if (!versionFoundInFrame) {
                    logger.warn(`PBJS Version: Not found in any (accessible/non-timed-out) frame after waiting.`, { url }); // This logger is now the instance
                    // logError(url, "pbjs.version not found in any (accessible/non-timed-out) frame after waiting", null); // Replaced
                }
            }
        }
        catch (e) {
            // This catch is for page.goto() errors or other unexpected issues in the task
            logError(url, "Navigation or task processing error", e); // logError now uses logger.error
            // console.error(`Error processing ${url}: ${e.message}`); // Covered by logError
        }
    });
    // Example URLs to test (replace with actual list if needed)
    // cluster.queue('https://example.com');
    // cluster.queue('https://prebid.org/examples/adops/integration-testing.html');
    const inputFile = path.join(__dirname, 'input.txt'); // __dirname is fine in .cts
    try {
        const urls = fs.readFileSync(inputFile, 'utf8').split('\n').filter(line => line.trim() !== '');
        if (urls.length === 0) {
            logger.warn('input.txt is empty or contains no valid URLs. Exiting.', { file: inputFile }); // This logger is now the instance
            // logError("N/A", "input.txt is empty or contains no valid URLs", null); // Replaced
        }
        else {
            logger.info(`Queueing ${urls.length} URLs from input.txt`, { file: inputFile }); // This logger is now the instance
            urls.forEach((url) => cluster.queue(url));
        }
    }
    catch (error) {
        logger.error(`Failed to read or process input.txt: ${error.message}`, { file: inputFile, error }); // This logger is now the instance
        // logError("N/A", "Failed to read or process input.txt", error); // Replaced
        // If input.txt cannot be read, we might not want to proceed further,
        // or proceed with some default/no URLs. For now, it will just log and proceed to idle.
    }
    await cluster.idle();
    await cluster.close();
};
clusterSearch().catch((error) => {
    // console.error("Unhandled error in clusterSearch:", error); // Replaced by logger
    // The old fs.appendFileSync is removed. Winston's error transport will handle this.
    // The logError function itself uses logger.error.
    // If error is not an Error instance, or for more context:
    const message = "Unhandled error in clusterSearch";
    if (error instanceof Error) {
        logError("N/A", message, error); // logError uses the instance
    }
    else {
        logger.error(message, { errorDetails: String(error) }); // This logger is now the instance
    }
});
