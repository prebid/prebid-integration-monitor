/**
 * Global process error handler to catch uncaught exceptions and unhandled rejections
 * This helps prevent the process from crashing due to errors in third-party libraries
 */

import type { Logger as WinstonLogger } from 'winston';

let logger: WinstonLogger | null = null;
let isHandlerInstalled = false;

export function installProcessErrorHandler(winstonLogger: WinstonLogger): void {
  if (isHandlerInstalled) {
    return;
  }

  logger = winstonLogger;
  isHandlerInstalled = true;

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    // Check if this is a known lifecycle error that we can handle gracefully
    if (
      error.message &&
      (error.message.includes('Unable to get browser page') ||
        error.message.includes('Requesting main frame too early'))
    ) {
      logger?.debug('Browser lifecycle error (uncaught):', error.message);
      // For browser lifecycle errors, we don't exit - let the process continue
      return;
    }

    logger?.error('Uncaught Exception:', error);
    // For other uncaught exceptions, still exit as they might be critical
    logger?.error('Process will exit due to uncaught exception');
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any) => {
    // Check if this is a known lifecycle error
    if (
      reason &&
      reason.message &&
      (reason.message.includes('Unable to get browser page') ||
        reason.message.includes('Requesting main frame too early'))
    ) {
      logger?.debug(
        'Browser lifecycle error (unhandled rejection):',
        reason.message
      );
      // Don't exit - let the process continue
      return;
    }

    logger?.error('Unhandled Promise Rejection:', reason);
    // For now, don't exit on unhandled rejections to be more resilient
    logger?.warn('Unhandled rejection detected but process will continue');
  });

  logger?.info('Process error handlers installed');
}

export function uninstallProcessErrorHandler(): void {
  if (!isHandlerInstalled) {
    return;
  }

  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');

  isHandlerInstalled = false;
  logger = null;
}
