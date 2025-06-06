import { Command, Flags } from '@oclif/core';
import { initTracer } from '../tracer.js';
import { initializeLogger } from '../utils/logger.js';
import { executeMonitoringLogic } from '../services/monitoring-service.js';
let logger; // Module-level logger variable
/**
 * Default command for prebid-integration-monitor.
 * This command runs the main monitoring logic for the application.
 */
export default class Default extends Command {
    /**
     * A brief description of what the command does.
     * This is displayed when running `prebid-integration-monitor --help`.
     */
    static description = 'Default command for prebid-integration-monitor. Runs the main monitoring logic.';
    // Add a logDir flag similar to the scan command for consistency
    /**
     * Defines the flags (command-line options) accepted by this command.
     */
    static flags = {
        logDir: Flags.string({
            description: 'Directory to save log files',
            default: 'logs',
        }),
    };
    // If the original script accepted command-line arguments that should be flags or args:
    // static flags = {
    //   help: Flags.help({char: 'h'}),
    //   // exampleFlag: Flags.string({char: 'f', description: 'example flag'}),
    // };
    // static args = [
    //   {name: 'exampleArg', description: 'example argument'},
    // ];
    /**
     * The main execution method for the command.
     * This method is called when the command is run.
     * It initializes the logger and tracer, then calls `executeMonitoringLogic`
     * from `monitoring-service.ts` to perform the main application tasks.
     * @returns {Promise<void>} A promise that resolves when the command has finished executing.
     */
    async run() {
        const { flags } = await this.parse(Default);
        // Initialize logger with the logDir from flags
        logger = initializeLogger(flags.logDir);
        logger.info('TEST_CONSOLE_OUTPUT: This is a test message from default command.');
        try {
            // Initialize the tracer as the first step
            initTracer();
            logger.info("Default oclif command starting...");
            // Call the refactored monitoring logic
            // Pass logger and this.log to the service
            // this.log is passed directly. If context issues arise, this.log.bind(this) can be used.
            await executeMonitoringLogic(logger, this.log);
            // The following lines were part of the original tracer logic,
            // and are now handled within executeMonitoringLogic or are implicitly covered.
            // logger.info('Main application processing finished (oclif command).');
            // this.log('Main application processing finished (oclif command).');
        }
        catch (error) {
            logger.error('Error in oclif command execution:', error);
            this.error(error, { exit: 1 });
        }
    }
}
