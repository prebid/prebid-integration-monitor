/**
 * @module logger
 * @description This module provides a singleton Winston logger instance.
 * It must be initialized by calling `initializeLogger` before use.
 * The logger is configured to log to the console and to files (app.log, error.log).
 * It also integrates with OpenTelemetry for tracing.
 */
import winston, { Logger, Logform, transports } from 'winston';
import TransportStream from 'winston-transport';
import fs from 'fs';
import path from 'path';
import { trace } from '@opentelemetry/api';

let logger: Logger;
export let isVerbose = false; // Store verbose state at module level and export for testing

/**
 * A Winston log format that enriches the log `info` object with `trace_id` and `span_id`
 * from an active OpenTelemetry span, if one exists.
 *
 * @param {Logform.TransformableInfo} info - The log information object implicitly passed by Winston.
 * @returns {Logform.TransformableInfo} The modified log information object.
 */
const openTelemetryFormat = winston.format((info) => {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    const spanContext = activeSpan.spanContext();
    if (spanContext) {
      info.trace_id = spanContext.traceId;
      info.span_id = spanContext.spanId;
    }
  }
  return info;
});

/**
 * Formats Winston splat (`...rest`) metadata for console logging.
 * It handles arrays by joining their elements (stringifying objects),
 * objects by stringifying them (unless the result is '{}'),
 * and primitives by converting them to strings.
 *
 * @param {any} splat - The splat data passed by Winston. This can be of any type.
 * @returns {string} A string representation of the metadata, suitable for logging.
 *                   Returns an empty string if the splat data is trivial (e.g., undefined, empty array, or empty object stringification).
 */
function formatSplatMetadata(splat: any): string {
  if (Array.isArray(splat)) {
    const metadata = splat
      .map((s: any) => (typeof s === 'object' ? JSON.stringify(s) : s))
      .join(' ');
    return metadata || ''; // Return empty string if metadata is empty after join
  } else if (typeof splat === 'object' && splat !== null) {
    const metadataString = JSON.stringify(splat);
    return metadataString && metadataString !== '{}' ? metadataString : '';
  } else if (splat !== undefined) {
    return String(splat);
  }
  return '';
}

/**
 * Formats a log message for console output.
 * @param {Logform.TransformableInfo} info - The log information object.
 * @returns {string} The formatted log message.
 */
export function formatConsoleLogMessage(info: Logform.TransformableInfo): string {
  // Check if this is an error log and if verbose mode is off
  if ((info.level.includes('error') || info.stack) && !isVerbose) {
    let originalMessage: string =
      typeof info.message === 'string' ? info.message : String(info.message);
    const constructorName = info.constructor?.name; // Safely access constructor name

    // Attempt to remove Winston's default error prefix if present
    // e.g. "Error: Actual error message" -> "Actual error message"
    if (
      typeof constructorName === 'string' &&
      originalMessage.startsWith(`${constructorName}: `)
    ) {
      originalMessage = originalMessage.substring(constructorName.length + 2);
    } else if (
      typeof info.stack === 'string' &&
      originalMessage ===
        (typeof info.name === 'string' ? info.name : String(info.name))
    ) {
      // If info.message is just the error name (e.g. "Error"),
      // and stack is present, try to get a better message from stack.
      const stackLines = info.stack.split('\n');
      if (
        stackLines.length > 0 &&
        typeof stackLines[0] === 'string' &&
        !stackLines[0].startsWith('    at')
      ) {
        originalMessage = stackLines[0];
        const nameStr =
          typeof info.name === 'string' ? info.name : String(info.name);
        // Remove potential error name prefix from stack's first line
        if (originalMessage.startsWith(`${nameStr}: `)) {
          originalMessage = originalMessage.substring(nameStr.length + 2);
        }
      }
    }

    const atIndex =
      typeof originalMessage === 'string'
        ? originalMessage.indexOf(' at ')
        : -1;
    const truncatedMessage =
      atIndex !== -1 && typeof originalMessage === 'string'
        ? originalMessage.substring(0, atIndex)
        : originalMessage;

    // Try to extract URL (best effort)
    let urlPart = '';
    if (typeof originalMessage === 'string') {
      const urlMatch = originalMessage.match(/URL: (\S+)/i); // Example: "Error processing URL: http://example.com : The error"
      if (urlMatch && urlMatch[1]) {
        urlPart = `Error processing ${urlMatch[1]} : `;
      } else {
        // Fallback if specific URL isn't found in the message
        // Check if the message itself might be a URL or contain one early
        const potentialUrlMatch = originalMessage.match(/https?:\/\/[^\s]+/);
        if (potentialUrlMatch) {
          // This is a rough heuristic, might need refinement
          // urlPart = `Error related to ${potentialUrlMatch[0]} : `;
        }
      }
    }
    // We will use info.level which is colorized by winston.format.colorize()
    // instead of hardcoding 'error:'
    return `${info.timestamp} ${info.level}: ${urlPart}${truncatedMessage}`;
  }

  // Default formatting for verbose mode or non-error messages
  let message = `${info.timestamp} ${info.level}: ${typeof info.message === 'string' ? info.message : String(info.message)}`;
  if (isVerbose && typeof info.stack === 'string') {
    // Ensure stack is only added in verbose for errors
    message += `\n${info.stack}`;
  } else if (
    !isVerbose &&
    typeof info.stack === 'string' &&
    info.level &&
    !info.level.includes('error')
  ) {
    // If not verbose, and stack is present, but it's not an error log (e.g. a custom debug log with stack)
    // we might not want to print the stack. This depends on desired behavior.
    // For now, let's assume non-error logs don't print stack unless verbose.
  } else if (
    isVerbose &&
    !info.stack &&
    info.level &&
    info.level.includes('error')
  ) {
    // If verbose, it's an error, but no stack - message is already info.message
  }

  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    const spanContext = activeSpan.spanContext();
    if (spanContext) {
      message += ` (trace_id: ${spanContext.traceId}, span_id: ${spanContext.spanId})`;
    }
  }

  if (
    typeof info.message === 'string' &&
    info.message.startsWith('Initial URLs read from') &&
    typeof info.count === 'number'
  ) {
    message += ` count: ${info.count}`;
  } else {
    const splat = info[Symbol.for('splat')];
    const metadataString = formatSplatMetadata(splat);
    if (metadataString) {
      message += ` ${metadataString}`;
    }
  }
  return message;
}

/**
 * Initializes the Winston logger instance.
 * Creates the log directory if it doesn't exist.
 *
 * @param {string} logDir - The directory where log files will be stored.
 * @returns {Logger} The initialized Winston logger instance.
 * @throws {Error} If an error occurs during logger initialization.
 * @sideEffects Creates the log directory if it doesn't exist.
 */
// Define a simple mock transport for testing
export class MockTransport extends TransportStream {
  public messages: any[] = [];

  constructor(opts?: TransportStream.TransportStreamOptions) {
    super(opts);
  }

  log(info: any, callback: () => void): void {
    setImmediate(() => {
      this.emit('logged', info);
    });
    this.messages.push(info);
    callback();
  }
}

export function initializeLogger(
  logDir: string,
  verboseFlag = false,
  testTransports: TransportStream[] | null = null
): Logger {
  isVerbose = verboseFlag; // Store the verbose flag (already exported)

  let effectiveTransports: TransportStream[];

  if (testTransports) {
    effectiveTransports = testTransports;
  } else {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    effectiveTransports = [
      new transports.Console({
        level: process.env.LOG_LEVEL_CONSOLE || 'info',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(formatConsoleLogMessage)
        ),
      }),
      new transports.File({
        filename: path.join(logDir, 'app.log'),
        level: process.env.LOG_LEVEL_APP || 'info',
        format: winston.format.combine(
          openTelemetryFormat(),
          winston.format.json()
        ),
      }),
      new transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: winston.format.combine(
          openTelemetryFormat(),
          winston.format.json()
        ),
      }),
    ];
  }

  logger = winston.createLogger({
    levels: winston.config.npm.levels,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      // Note: formatConsoleLogMessage is applied per-transport for Console
      // If testTransports are used, they need to handle their own formatting if mimicking Console
    ),
    transports: effectiveTransports,
    exitOnError: false,
  });

  // Avoid logging this during test transport initialization if it's too noisy
  if (!testTransports) {
    logger.info(
      `Logger initialized successfully. Log directory: ${logDir}, Verbose: ${isVerbose}`
    );
  }
  return logger;
}

// Setter for isVerbose for testing purposes
export function setTestIsVerbose(value: boolean): void {
  isVerbose = value;
}

export default {
  /**
   * Gets the singleton logger instance.
   *
   * @returns {Logger} The Winston logger instance.
   * @throws {Error} If `initializeLogger` has not been called.
   */
  get instance() {
    if (!logger) {
      throw new Error(
        'Logger has not been initialized. Call initializeLogger(logDir) first.'
      );
    }
    return logger;
  },
};
