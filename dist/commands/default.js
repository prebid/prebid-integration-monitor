import { Command, Flags } from '@oclif/core';
import { initTracer } from '../tracer.js';
import { initializeLogger } from '../utils/logger.js';
import { trace } from '@opentelemetry/api';
let logger; // Module-level logger variable
class Default extends Command {
    // If the original script accepted command-line arguments that should be flags or args:
    // static flags = {
    //   help: Flags.help({char: 'h'}),
    //   // exampleFlag: Flags.string({char: 'f', description: 'example flag'}),
    // };
    // static args = [
    //   {name: 'exampleArg', description: 'example argument'},
    // ];
    async run() {
        const { flags } = await this.parse(Default);
        // Initialize logger with the logDir from flags
        logger = initializeLogger(flags.logDir);
        try {
            // Initialize the tracer as the first step
            initTracer(); // This might still have issues if tracer.js is not found
            logger.info("Default oclif command starting...");
            const tracer = trace.getTracer('prebid-integration-monitor-tracer');
            await tracer.startActiveSpan('application-main-span', async (parentSpan) => {
                logger.info('Inside parent span (oclif command).');
                this.log('Inside parent span (oclif command).'); // oclif logger
                await tracer.startActiveSpan('child-task-span', async (childSpan) => {
                    logger.info('Inside child span, performing a task (oclif command)...');
                    this.log('Inside child span, performing a task (oclif command)...');
                    childSpan.addEvent('Task processing started');
                    // Simulate some work
                    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
                    childSpan.addEvent('Task processing finished');
                    logger.info('Child span task complete (oclif command).');
                    this.log('Child span task complete (oclif command).');
                    childSpan.end();
                });
                logger.info('Parent span continuing after child span (oclif command).');
                this.log('Parent span continuing after child span (oclif command).');
                parentSpan.end();
            });
            logger.info('Main application processing finished (oclif command).');
            this.log('Main application processing finished (oclif command).');
        }
        catch (error) {
            logger.error('Error in oclif command execution:', error);
            this.error(error, { exit: 1 });
        }
    }
}
Default.description = 'Default command for prebid-integration-monitor. Runs the main monitoring logic.';
// Add a logDir flag similar to the scan command for consistency
Default.flags = {
    logDir: Flags.string({
        description: 'Directory to save log files',
        default: 'logs',
    }),
    // help: Flags.help({char: 'h'}), // Example, if needed
};
export default Default;
