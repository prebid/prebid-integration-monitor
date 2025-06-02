// This file is the original entry point. Oclif (bin/run.js and bin/dev.js) is now used instead.
import loggerModule, { initializeLogger } from './utils/logger.js';

initializeLogger('logs');
const logger = loggerModule.instance;

console.log('DEBUG: src/index.ts is being executed - this should not happen if oclif is the entry point.');
logger.warn('src/index.ts executed - this might indicate an issue with entry point configuration. Oclif should use bin/run or bin/dev.');
