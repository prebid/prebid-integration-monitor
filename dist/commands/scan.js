import { Command } from '@oclif/core';
import { prebidExplorer } from '../prebid.js';
import { scanArgs, scanFlags } from './scan-options.js';
import loggerModule, { initializeLogger } from '../utils/logger.js'; // Import initializeLogger
import { AppError } from '../common/AppError.js';
import * as readline from 'readline';
import { loadFileContents, processFileContent } from '../utils/url-loader.js';
/**
 * @class Scan
 * @description Oclif command for scanning websites for Prebid.js integrations and other ad technologies.
 * This command allows users to specify a source of URLs (either a local file or a GitHub repository),
 * configure Puppeteer's behavior (e.g., headless mode, concurrency for cluster operations),
 * define output directories for results and logs, and control aspects of the scan like URL ranges or chunking.
 * It utilizes the `prebidExplorer` function to perform the core scanning logic.
 */
export default class Scan extends Command {
    /**
     * @property {object} args - Defines the command-line arguments accepted by this command.
     * @property {object} args.inputFile - Path to a local input file containing URLs.
     *                                     Supports `.txt`, `.csv`, or `.json` files.
     *                                     This is optional if `--githubRepo` is used.
     */
    static args = scanArgs;
    /**
     * @property {string} description - A brief summary of what the command does.
     * Displayed in the CLI help output.
     */
    static description = 'Scans websites for Prebid.js integrations and other ad technologies. \nInput can be a local file (TXT, CSV, JSON) or URLs from stdin.';
    /**
     * @property {string[]} examples - Illustrative examples of how to use the command.
     * Displayed in the CLI help output.
     */
    static examples = [
        '<%= config.bin %> <%= command.id %> urls.txt --puppeteerType=cluster --concurrency=10',
        'cat urls.txt | <%= config.bin %> <%= command.id %> --puppeteerType=vanilla --outputDir ./scan_results',
        '<%= config.bin %> <%= command.id %> urls.csv --range="1-100" --chunkSize=20 --outputDir=./scan_results --logDir=./scan_logs',
    ];
    /**
     * @property {object} flags - Defines the command-line flags accepted by this command.
     * Refer to `scan-options.ts` for detailed descriptions of each flag.
     */
    static flags = scanFlags;
    /**
     * Creates the {@link PrebidExplorerOptions} object based on the parsed command-line flags.
     * This private helper method maps CLI flags to the options expected by the `prebidExplorer` function.
     *
     * @private
     * @param {Interfaces.InferredFlags<typeof Scan.flags>} flags - The parsed flags object from oclif.
     * @returns {PrebidExplorerOptions} An options object for `prebidExplorer`.
     */
    _getPrebidExplorerOptions(flags) {
        return {
            puppeteerType: flags.puppeteerType, // Cast ensured by flag options
            concurrency: flags.concurrency,
            headless: flags.headless,
            monitor: flags.monitor,
            outputDir: flags.outputDir,
            logDir: flags.logDir,
            // numUrls: flags.numUrls, // Removed
            range: flags.range,
            chunkSize: flags.chunkSize,
            puppeteerLaunchOptions: {
                headless: flags.headless, // Ensure headless state is consistent
                args: ['--no-sandbox', '--disable-setuid-sandbox'], // Default args for broader compatibility
                // Other user-provided puppeteerLaunchOptions might be merged here if a flag for them is added
            },
            // inputFile and githubRepo are determined and added by _getInputSourceOptions
        };
    }
    /**
     * Determines the input source (file or GitHub repository) based on provided arguments and flags.
     * It updates the `options` object with `inputFile` or `githubRepo` accordingly.
     * This method prioritizes `githubRepo` if both are somehow provided (though CLI flags should prevent this).
     * It logs the chosen source and warns if `inputFile` is ignored.
     *
     * @private
     * @param {Interfaces.InferredArgs<typeof Scan.args>} args - The parsed arguments object.
     * @param {Interfaces.InferredFlags<typeof Scan.flags>} flags - The parsed flags object.
     * @param {PrebidExplorerOptions} options - The options object to be updated.
     * @throws {Error} If no input source (neither `inputFile` argument nor `githubRepo` flag) is specified.
     */
    // Removed _getInputSourceOptions as URL source is handled directly in run()
    /**
     * Executes the scan command.
     * This method orchestrates the scanning process by:
     * 1. Parsing command-line arguments and flags.
     * 2. Initializing the logger using the `logDir` flag.
     * 3. Preparing options for the `prebidExplorer` function.
     * 4. Invoking `prebidExplorer` to perform the scan.
     * 5. Handling successful completion or errors, logging appropriately, and exiting.
     *
     * @async
     * @public
     * @returns {Promise<void>} A promise that resolves when the scan is complete or an error is handled.
     */
    async run() {
        const { args, flags } = await this.parse(Scan);
        // Initialize logger here so it's available for all subsequent operations, including option processing.
        // Note: loggerModule.instance will be set by initializeLogger.
        initializeLogger(flags.logDir);
        const logger = loggerModule.instance;
        let urlsToScan = [];
        if (args.inputFile) {
            logger.info(`Reading URLs from input file: ${args.inputFile}`);
            const fileContent = loadFileContents(args.inputFile, logger);
            if (fileContent) {
                const fileName = args.inputFile.split('/').pop() || args.inputFile;
                urlsToScan = await processFileContent(fileName, fileContent, logger);
                if (urlsToScan.length === 0) {
                    logger.warn(`No URLs found in ${args.inputFile}. Exiting.`);
                    this.exit(0); // Exit gracefully if no URLs
                }
                logger.info(`Successfully read ${urlsToScan.length} URLs from ${args.inputFile}.`);
            }
            else {
                this.error(`Failed to read from input file: ${args.inputFile}`, {
                    exit: 1,
                });
            }
        }
        else if (!process.stdin.isTTY) {
            logger.info('Reading URLs from stdin...');
            try {
                urlsToScan = await this.readUrlsFromStdin(logger);
                if (urlsToScan.length === 0) {
                    logger.warn('No URLs read from stdin. Exiting.');
                    this.exit(0); // Exit gracefully if no URLs
                }
                logger.info(`Successfully read ${urlsToScan.length} URLs from stdin.`);
            }
            catch (error) {
                logger.error('Failed to read URLs from stdin:', error.message); // Cast error
                this.error(`Error reading from stdin: ${error.message}`, { exit: 1 });
            }
        }
        else {
            this.error('No input specified. Provide an input file argument or pipe data from stdin.', { exit: 1 });
        }
        const options = {
            ...this._getPrebidExplorerOptions(flags),
            urlsToScan, // Pass the loaded URLs
        };
        // Remove inputFile from options if urlsToScan is populated, to avoid confusion in prebidExplorer
        if (options.urlsToScan && options.urlsToScan.length > 0) {
            delete options.inputFile;
        }
        logger.info(`Starting Prebid scan with options:`);
        // Log the options (excluding potentially sensitive puppeteerLaunchOptions if necessary in future)
        const loggableOptions = { ...options };
        if (loggableOptions.puppeteerLaunchOptions) {
            // For brevity or security, you might choose to summarize or exclude puppeteerLaunchOptions
            loggableOptions.puppeteerLaunchOptions = {
                args: loggableOptions.puppeteerLaunchOptions.args,
                headless: loggableOptions.puppeteerLaunchOptions.headless,
            };
        }
        logger.info(JSON.stringify(loggableOptions, null, 2));
        try {
            // Pass eventEmitter if prebidExplorer is designed to use it
            await prebidExplorer(options /* , eventEmitter */);
            this.log('Prebid scan completed successfully.');
        }
        catch (error) {
            // Logger should already be initialized here.
            let userMessage = 'An unexpected error occurred during the Prebid scan.';
            let suggestions = ['Check logs for more details.'];
            if (error instanceof AppError) {
                logger.error(`AppError during Prebid scan: ${error.message}`, {
                    details: error.details
                        ? JSON.stringify(error.details, null, 2)
                        : undefined,
                    stack: error.stack,
                });
                userMessage = error.details?.errorCode
                    ? `Scan failed with code: ${error.details.errorCode}. Message: ${error.message}`
                    : error.message;
                if (error.details?.errorCode === 'PUPPETEER_LAUNCH_FAILED') {
                    suggestions.push('Ensure Chrome/Chromium is installed correctly and puppeteer has permissions.');
                }
                else if (error.details?.errorCode?.includes('_FAILED')) {
                    suggestions.push('This might indicate a problem with Puppeteer setup or resource accessibility.');
                }
            }
            else if (error instanceof Error) {
                logger.error(`Error during Prebid scan: ${error.message}`, {
                    stack: error.stack,
                });
                userMessage = error.message;
            }
            else {
                logger.error('An unknown error occurred during Prebid scan.', {
                    errorDetail: JSON.stringify(error, null, 2),
                });
            }
            this.error(userMessage, {
                exit: 1,
                suggestions,
            });
        }
    }
    // Helper method to read URLs from stdin
    async readUrlsFromStdin(logger) {
        const lines = [];
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false,
        });
        return new Promise((resolve, reject) => {
            rl.on('line', (line) => {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    // Basic regex for schemeless domains (e.g., example.com)
                    if (trimmedLine.startsWith('http://') ||
                        trimmedLine.startsWith('https://') ||
                        trimmedLine.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
                        lines.push(trimmedLine);
                    }
                    else {
                        logger.warn(`Skipping invalid line from stdin: ${line}`);
                    }
                }
            });
            rl.on('close', () => resolve(lines));
            rl.on('error', (err) => reject(err));
        });
    }
}
