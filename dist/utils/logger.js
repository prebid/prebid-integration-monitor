import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { trace } from '@opentelemetry/api';
const logDir = 'logs';
// Create logs directory if it doesn't exist
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true }); // Added recursive: true for safety, though 'logs' is top-level here
}
const logger = winston.createLogger({
    levels: winston.config.npm.levels, // Standard npm levels (error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6)
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
            filename: path.join(logDir, 'app.log'),
            level: process.env.LOG_LEVEL_APP || 'info', // Default to 'info', configurable
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
            filename: path.join(logDir, 'error.log'),
            level: 'error', // Log only 'error' level and above to this file
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
    exitOnError: false // Do not exit on handled exceptions
});
// A simple test to ensure logger is working
logger.info('Logger initialized successfully.');
logger.error('This is a test error message.');
logger.warn('This is a test warning message.');
logger.debug('This is a test debug message (won\'t show in console by default).');
export default logger;
