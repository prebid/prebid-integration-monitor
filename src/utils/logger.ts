/**
 * @module logger
 * @description This module provides a singleton Winston logger instance.
 * It must be initialized by calling `initializeLogger` before use.
 * The logger is configured to log to the console and to files (app.log, error.log).
 * It also integrates with OpenTelemetry for tracing.
 */
import winston, { Logger, Logform } from 'winston';
import fs from 'fs';
import path from 'path';
import { trace } from '@opentelemetry/api';

let logger: Logger;

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
function formatConsoleLogMessage(info: Logform.TransformableInfo): string {
  let message = `${info.timestamp} ${info.level}: ${info.message}`;
  if (info.stack) {
    message += `\n${info.stack}`;
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
export function initializeLogger(logDir: string): Logger {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  logger = winston.createLogger({
    levels: winston.config.npm.levels,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat()
    ),
    transports: [
      new winston.transports.Console({
        level: process.env.LOG_LEVEL_CONSOLE || 'info',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(formatConsoleLogMessage)
        ),
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'app.log'),
        level: process.env.LOG_LEVEL_APP || 'info',
        format: winston.format.combine(
          openTelemetryFormat(),
          winston.format.json()
        ),
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: winston.format.combine(
          openTelemetryFormat(),
          winston.format.json()
        ),
      }),
    ],
    exitOnError: false,
  });

  logger.info(`Logger initialized successfully. Log directory: ${logDir}`);
  return logger;
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
