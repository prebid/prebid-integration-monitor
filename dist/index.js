/**
 * @fileoverview Original entry point for the application.
 * @deprecated This file is deprecated and no longer the primary entry point.
 * The application now uses the oclif CLI framework, with `bin/run.js` (for production)
 * and `bin/dev.js` (for development) serving as the main entry points.
 * This file is kept for potential reference or future refactoring but should not be
 * executed directly in the standard oclif workflow.
 */
// This file is the original entry point. Oclif (bin/run.js and bin/dev.js) is now used instead.
import loggerModule, { initializeLogger } from './utils/logger.js';
initializeLogger('logs'); // Initialize with a default log directory
const logger = loggerModule.instance;
logger.info('DEBUG: src/index.ts is being executed - this should not happen if oclif is the entry point.');
logger.warn('src/index.ts executed - this might indicate an issue with entry point configuration. Oclif should use bin/run or bin/dev.');
