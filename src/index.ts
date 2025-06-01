console.log('DEBUG: Script execution started - src/index.ts'); // Added for debugging
import { initTracer } from './tracer.js'; // Import the tracer initialization function
initTracer(); // Initialize the tracer as the first step

import logger from './utils/logger.js'; // .js extension may be needed depending on tsconfig
import { trace } from '@opentelemetry/api';

logger.info("Application starting...");

const tracer = trace.getTracer('prebid-integration-monitor-tracer');

const main = async () => {
  await tracer.startActiveSpan('application-main-span', async (parentSpan) => {
    logger.info('Inside parent span.');

    await tracer.startActiveSpan('child-task-span', async (childSpan) => {
      logger.info('Inside child span, performing a task...');
      childSpan.addEvent('Task processing started');

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay

      childSpan.addEvent('Task processing finished');
      logger.info('Child span task complete.');
      childSpan.end();
    });

    logger.info('Parent span continuing after child span.');
    parentSpan.end();
  });

  logger.info('Main application processing finished.');
};

main().catch(error => {
  logger.error('Error in main application execution:', error);
  process.exit(1);
});
