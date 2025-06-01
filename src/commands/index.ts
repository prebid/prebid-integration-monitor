import {Command, Flags} from '@oclif/core';
import { initTracer } from '../../tracer.js'; // Adjusted path
import logger from '../../utils/logger.js'; // Adjusted path
import { trace } from '@opentelemetry/api';

export default class Index extends Command {
  static description = 'Default command for prebid-integration-monitor. Runs the main monitoring logic.'

  // If the original script accepted command-line arguments that should be flags or args:
  // static flags = {
  //   help: Flags.help({char: 'h'}),
  //   // exampleFlag: Flags.string({char: 'f', description: 'example flag'}),
  // };

  // static args = [
  //   {name: 'exampleArg', description: 'example argument'},
  // ];

  async run(): Promise<void> {
    try {
      // Initialize the tracer as the first step
      initTracer();
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

    } catch (error) {
      logger.error('Error in oclif command execution:', error);
      this.error(error as Error, {exit: 1});
    }
  }
}
