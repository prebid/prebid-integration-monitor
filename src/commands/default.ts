import { Command, Flags } from '@oclif/core';
import { initializeTelemetry } from '../utils/telemetry.js';
import { initializeLogger } from '../utils/logger.js'; // Import loggerModule
import type { Logger as WinstonLogger } from 'winston';
import { executeMonitoringLogic } from '../services/monitoring-service.js';
import { AppError } from '../common/AppError.js'; // Import AppError

let logger: WinstonLogger; // Module-level logger variable

/**
 * @class Default
 * @description Default command for the Prebid Integration Monitor CLI.
 * This command initializes essential services like logging and tracing,
 * and then executes the main monitoring logic of the application as defined
 * in `monitoring-service.ts`. It serves as the primary entry point when
 * no specific subcommand is provided.
 */
export default class Default extends Command {
  /**
   * @property {string} description - A brief summary of what the command does.
   * Displayed in the CLI help output.
   */
  static override description =
    'Runs the main monitoring logic for the Prebid Integration Monitor. This is the default command if no other is specified.';

  // Add a logDir flag similar to the scan command for consistency
  /**
   * @property {object} flags - Defines the command-line flags accepted by this command.
   * @property {object} flags.logDir - Flag to specify the directory for saving log files.
   */
  static flags = {
    logDir: Flags.string({
      description: 'Directory to save log files (e.g., app.log, error.log).',
      default: 'logs',
    }),
  };

  /**
   * Executes the default command's primary logic.
   * This method initializes the logger and tracer, then calls `executeMonitoringLogic`
   * from `monitoring-service.ts` to perform the application's main tasks.
   * It includes structured error handling to catch and log errors, providing
   * user-friendly messages and suggestions via `this.error`.
   *
   * @async
   * @public
   * @returns {Promise<void>} A promise that resolves when the command has finished executing,
   *                          or rejects if an unrecoverable error occurs.
   */
  public async run(): Promise<void> {
    const { flags } = await this.parse(Default);
    // Initialize logger with the logDir from flags
    logger = initializeLogger(flags.logDir);
    // Example test log - consider removing or making conditional for production builds.
    logger.info(
      'TEST_CONSOLE_OUTPUT: This is a test message from default command.'
    );

    try {
      // Initialize the telemetry as the first step
      initializeTelemetry('prebid-integration-monitor');
      logger.info('Default oclif command starting...');

      // Call the refactored monitoring logic
      await executeMonitoringLogic(logger, this.log);

      logger.info('Default command processing finished successfully.');
    } catch (error: unknown) {
      let userMessage = 'An unexpected error occurred in the default command.';
      const suggestions = ['Check logs for more details.'];

      if (error instanceof AppError) {
        logger.error(`AppError in default command: ${error.message}`, {
          // Ensure details are stringified if they could be complex objects
          details: error.details
            ? JSON.stringify(error.details, null, 2)
            : undefined,
          stack: error.stack,
        });
        userMessage = error.details?.errorCode
          ? `Default command failed with code: ${error.details.errorCode}. Message: ${error.message}`
          : error.message;
      } else if (error instanceof Error) {
        logger.error(`Error in default command: ${error.message}`, {
          stack: error.stack,
        });
        userMessage = error.message;
      } else {
        logger.error('An unknown error occurred in default command.', {
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
