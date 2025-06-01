import winston from 'winston'; // Import Logger type
import fs from 'fs';
import path from 'path';
import { trace } from '@opentelemetry/api';
let logger; // Declare logger variable
export function initializeLogger(logDir) {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    logger = winston.createLogger({
        levels: winston.config.npm.levels,
        format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), // Log the full stack trace for errors
        winston.format.splat() // Essential for formatting messages like printf: logger.info('Hello %s', 'world')
        ),
        transports: [
            new winston.transports.Console({
                level: process.env.LOG_LEVEL_CONSOLE || 'info', // Default to 'info', configurable via env variable
                format: winston.format.combine(winston.format.colorize(), // Colorize log levels
                winston.format.printf(info => {
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
                    // Include other metadata if present (e.g., from splat)
                    const splat = info[Symbol.for('splat')];
                    if (splat) {
                        if (Array.isArray(splat)) {
                            const metadata = splat.map((s) => typeof s === 'object' ? JSON.stringify(s) : s).join(' ');
                            if (metadata) {
                                message += ` ${metadata}`;
                            }
                        }
                        else if (typeof splat === 'object' && splat !== null) {
                            const metadata = JSON.stringify(splat);
                            if (metadata && metadata !== '{}') {
                                message += ` ${metadata}`;
                            }
                        }
                        else {
                            message += ` ${splat}`;
                        }
                    }
                    return message;
                }))
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'app.log'), // Use dynamic logDir
                level: process.env.LOG_LEVEL_APP || 'info',
                format: winston.format.combine(winston.format(info => {
                    const activeSpan = trace.getActiveSpan();
                    if (activeSpan) {
                        const spanContext = activeSpan.spanContext();
                        if (spanContext) {
                            info.trace_id = spanContext.traceId;
                            info.span_id = spanContext.spanId;
                        }
                    }
                    return info;
                })(), winston.format.json() // JSON format for file logs
                )
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'error.log'), // Use dynamic logDir
                level: 'error',
                format: winston.format.combine(winston.format(info => {
                    const activeSpan = trace.getActiveSpan();
                    if (activeSpan) {
                        const spanContext = activeSpan.spanContext();
                        if (spanContext) {
                            info.trace_id = spanContext.traceId;
                            info.span_id = spanContext.spanId;
                        }
                    }
                    return info;
                })(), winston.format.json() // JSON format for file logs
                )
            })
        ],
        exitOnError: false
    });
    // A simple test to ensure logger is working
    logger.info(`Logger initialized successfully. Log directory: ${logDir}`);
    // logger.error('This is a test error message.'); // Optional: remove test messages after setup
    // logger.warn('This is a test warning message.');
    // logger.debug('This is a test debug message (won\'t show in console by default).');
    return logger;
}
// Export the logger instance directly for convenience,
// but ensure initializeLogger is called first from the application entry point.
// This default export might be problematic if not initialized.
// Consider exporting only initializeLogger and managing the instance in the calling code.
export default {
    // Getter to ensure logger is initialized before use
    get instance() {
        if (!logger) {
            // Initialize with a default directory if not already done, or throw error
            // For now, let's assume it will be initialized by the app.
            // Consider throwing an error or initializing with a default path if used before explicit initialization.
            // initializeLogger('logs'); // Default initialization
            throw new Error("Logger has not been initialized. Call initializeLogger(logDir) first.");
        }
        return logger;
    }
};
