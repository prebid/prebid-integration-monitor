// This file was the original entry point.
// With oclif, the CLI entry points are now bin/run.js and bin/dev.js.
// Commands are located in src/commands/
// The main logic previously in this file has been moved to src/commands/index.ts

console.log('DEBUG: src/index.ts is being executed - this should not happen if oclif is the entry point.');
logger.warn('src/index.ts executed - this might indicate an issue with entry point configuration. Oclif should use bin/run or bin/dev.');

// Intentionally leaving it almost empty.
// If there's any specific library setup or global configuration
// that *must* happen before oclif itself loads, it could potentially go here,
// but that's an advanced and uncommon use case.
// For now, oclif's `init` hook or the command's `init` method is preferred for setup.
import logger from './utils/logger.js';
