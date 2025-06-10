import { Command, Interfaces } from '@oclif/core';
import { prebidExplorer, PrebidExplorerOptions } from '../prebid.js';
import { scanArgs, scanFlags } from '../utils/scan-options.js'; // Updated path
import loggerModule, { initializeLogger } from '../utils/logger.js'; // Import initializeLogger
import { AppError } from '../common/AppError.js';

/**
 * @class Scan
 * @description Oclif command for scanning websites for Prebid.js integrations and other ad technologies.
 * This command allows users to specify a source of URLs from a local file,
 * configure Puppeteer's behavior (e.g., headless mode, concurrency for cluster operations),
 * define output directories for results and logs, and control aspects of the scan like URL ranges or chunking.
 * It utilizes the `prebidExplorer` function to perform the core scanning logic.
 */
export default class Scan extends Command {
  /**
   * @property {object} args - Defines the command-line arguments accepted by this command.
   * @property {object} args.inputFile - Path to a local input file (TXT, CSV, JSON) containing URLs to scan. This argument is required.
   */
  static override args = scanArgs;
  /**
   * @property {string} description - A brief summary of what the command does.
   * Displayed in the CLI help output.
   */
  static override description =
    'Scans websites for Prebid.js integrations and other ad technologies using a list of URLs from a local file.';
  /**
   * @property {string[]} examples - Illustrative examples of how to use the command.
   * Displayed in the CLI help output.
   */
  static override examples = [
    '<%= config.bin %> <%= command.id %> urls.txt --puppeteerType=cluster --concurrency=10',
    '<%= config.bin %> <%= command.id %> urls.csv --range="1-100" --chunkSize=20 --outputDir=./scan_results --logDir=./scan_logs',
    '<%= config.bin %> <%= command.id %> path/to/your/urls.json --numUrls 50',
  ];
  /**
   * @property {object} flags - Defines the command-line flags accepted by this command.
   * Refer to `src/utils/scan-options.ts` for detailed descriptions of each flag.
   */
  static override flags = scanFlags;

  /**
   * Creates the {@link PrebidExplorerOptions} object based on the parsed command-line flags.
   * This private helper method maps CLI flags to the options expected by the `prebidExplorer` function.
   *
   * @private
   * @param {Interfaces.InferredFlags<typeof Scan.flags>} flags - The parsed flags object from oclif.
   * @returns {PrebidExplorerOptions} An options object for `prebidExplorer`.
   */
  private _getPrebidExplorerOptions(
    flags: Interfaces.InferredFlags<typeof Scan.flags>
  ): PrebidExplorerOptions {
    return {
      puppeteerType: flags.puppeteerType as 'vanilla' | 'cluster', // Cast ensured by flag options
      concurrency: flags.concurrency,
      headless: flags.headless,
      monitor: flags.monitor,
      outputDir: flags.outputDir,
      logDir: flags.logDir,
      numUrls: flags.numUrls,
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
   * Validates and sets the input file option for the scan.
   * This method ensures that an input file is provided (as it's a required argument)
   * and sets it in the `options` object for `prebidExplorer`.
   *
   * @private
   * @param {Interfaces.InferredArgs<typeof Scan.args>} args - The parsed arguments object, expecting `args.inputFile`.
   * @param {PrebidExplorerOptions} options - The options object to be updated with the input file path.
   * @throws {Error} If `args.inputFile` is not provided (though oclif's argument parsing should prevent this).
   */
  private _getInputSourceOptions(
    args: Interfaces.InferredArgs<typeof Scan.args>,
    options: PrebidExplorerOptions
  ): void {
    if (args.inputFile) {
      this.log(`Using input file: ${args.inputFile}`);
      options.inputFile = args.inputFile;
    } else {
      // This error should ideally be caught by oclif's argument requirement system,
      // as inputFile in scanArgs is now marked as required: true.
      // Adding a safeguard here.
      this.error(
        'No input file specified. Please provide the inputFile argument.',
        { exit: 1 }
      );
    }
  }

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
  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Scan);

    // Initialize logger here so it's available for all subsequent operations, including option processing.
    // Note: loggerModule.instance will be set by initializeLogger.
    initializeLogger(flags.logDir);
    const logger = loggerModule.instance;

    const options = this._getPrebidExplorerOptions(flags);
    this._getInputSourceOptions(args, options); // This method might call this.error and exit

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
      await prebidExplorer(options);
      this.log('Prebid scan completed successfully.');
    } catch (error: unknown) {
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
          suggestions.push(
            'Ensure Chrome/Chromium is installed correctly and puppeteer has permissions.'
          );
        } else if (error.details?.errorCode?.includes('_FAILED')) {
          suggestions.push(
            'This might indicate a problem with Puppeteer setup or resource accessibility.'
          );
        }
      } else if (error instanceof Error) {
        logger.error(`Error during Prebid scan: ${error.message}`, {
          stack: error.stack,
        });
        userMessage = error.message;
      } else {
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
}
