import { trace, Span } from '@opentelemetry/api';
import type { Logger as WinstonLogger } from 'winston';

/**
 * Executes the main monitoring logic with tracing.
 * @param logger The Winston logger instance.
 * @param oclifLogger The Oclif logger function (this.log).
 * @returns {Promise<void>} A promise that resolves when the monitoring logic has finished.
 */
export async function executeMonitoringLogic(
  logger: WinstonLogger,
  oclifLogger: (message?: string | undefined, ...args: unknown[]) => void
): Promise<void> {
  const tracer = trace.getTracer('prebid-integration-monitor-tracer');

  await tracer.startActiveSpan(
    'application-main-span',
    async (parentSpan: Span) => {
      logger.info('Inside parent span (monitoring_service).');
      oclifLogger('Inside parent span (monitoring_service).');

      await tracer.startActiveSpan(
        'child-task-span',
        async (childSpan: Span) => {
          logger.info(
            'Inside child span, performing a task (monitoring_service)...'
          );
          oclifLogger(
            'Inside child span, performing a task (monitoring_service)...'
          );
          childSpan.addEvent('Task processing started');

          // Simulate some work
          await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay

          childSpan.addEvent('Task processing finished');
          logger.info('Child span task complete (monitoring_service).');
          oclifLogger('Child span task complete (monitoring_service).');
          childSpan.end();
        }
      );

      logger.info(
        'Parent span continuing after child span (monitoring_service).'
      );
      oclifLogger(
        'Parent span continuing after child span (monitoring_service).'
      );
      parentSpan.end();
    }
  );

  logger.info('Main application processing finished (monitoring_service).');
  oclifLogger('Main application processing finished (monitoring_service).');
}
