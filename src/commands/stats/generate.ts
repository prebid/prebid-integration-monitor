import { Command, Flags } from '@oclif/core'; // Added Flags for consistency, though not used yet
import { updateAndCleanStats } from '../../utils/update-stats.js';
import loggerModule, { initializeLogger } from '../../utils/logger.js'; // Import initializeLogger
import { AppError } from '../../common/AppError.js';

/**
 * @class StatsGenerate
 * @description Oclif command for generating or updating API statistics.
 * This command triggers the processing of stored website scan data. The process involves
 * summarizing the data, cleaning it by removing outdated or irrelevant entries,
 * and applying categorization based on Prebid.js versions and modules.
 * The final output is an aggregated statistics file (typically `api/api.json`)
 * used to understand Prebid.js adoption and usage trends.
 */
export default class StatsGenerate extends Command {
  /**
   * @property {string} description - A brief summary of what the command does.
   * Displayed in the CLI help output.
   */
  static override description =
    'Generates or updates the API statistics file (api/api.json) by processing stored website scan data. This includes summarizing data, cleaning it, and applying version and module categorization.';

  /**
   * @property {string[]} examples - Illustrative examples of how to use the command.
   * Displayed in the CLI help output.
   */
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '$ prebid-explorer stats:generate', // More user-friendly example
  ];

  /**
   * @property {object} flags - Defines the command-line flags accepted by this command.
   * Currently, includes a `logDir` flag for consistency in log output management.
   */
  static override flags = { // Added flags for logDir consistency
    logDir: Flags.string({
      description: 'Directory to save log files (e.g., app.log, error.log).',
      default: 'logs',
    }),
  };

  /**
   * Executes the statistics generation process.
   * This method initializes the logger, then calls `updateAndCleanStats` from `update-stats.js`
   * to perform the core logic of reading scan data, processing it, and writing the
   * aggregated statistics to `api/api.json`. It includes structured error handling.
   *
   * @async
   * @public
   * @returns {Promise<void>} A promise that resolves when statistics generation is complete,
   *                          or an error is handled and the CLI exits.
   */
  public async run(): Promise<void> {
    const { flags } = await this.parse(StatsGenerate); // Parse flags
    const logger = initializeLogger(flags.logDir); // Initialize logger with logDir

    this.log('Starting statistics generation process...');

    try {
      // updateAndCleanStats handles its own detailed logging internally.
      await updateAndCleanStats();
      this.log('Statistics generation process completed successfully.');
      this.log('The file api/api.json has been updated.');
    } catch (error: unknown) {
      let userMessage = 'An error occurred during statistics generation.';
      const suggestions = [
        'Check logs for more details from the updateAndCleanStats script.',
        "Ensure that the scan data directory (typically 'store') contains valid JSON files.",
        "Verify file permissions for reading scan data and writing to the 'api' directory.",
      ];

      if (error instanceof AppError) {
        logger.error(`AppError during statistics generation: ${error.message}`, {
          details: error.details ? JSON.stringify(error.details, null, 2) : undefined,
          stack: error.stack,
        });
        userMessage = error.details?.errorCode
          ? `Statistics generation failed with code: ${error.details.errorCode}. Message: ${error.message}`
          : error.message;
        if (error.details?.errorCode === 'STATS_DATA_READ_ERROR' || error.details?.errorCode?.startsWith('FS_')) {
            suggestions.push('This might be a file system or data parsing issue.');
        }
      } else if (error instanceof Error) {
        logger.error(`Error during statistics generation: ${error.message}`, {
          stack: error.stack,
        });
        userMessage = error.message;
      } else {
        logger.error('An unknown error occurred during statistics generation.', { errorDetail: JSON.stringify(error, null, 2) });
      }

      this.error(userMessage, {
        exit: 1,
        suggestions,
      });
    }
  }
}
