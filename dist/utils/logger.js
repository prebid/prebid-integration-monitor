import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { trace } from '@opentelemetry/api';
let logger;
export function initializeLogger(logDir) {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    logger = winston.createLogger({
        levels: winston.config.npm.levels,
        format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.splat()),
        transports: [
            new winston.transports.Console({
                level: process.env.LOG_LEVEL_CONSOLE || 'info',
                format: winston.format.combine(winston.format.colorize(), winston.format.printf(info => {
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
                    if (typeof info.message === 'string' && info.message.startsWith('Initial URLs read from') && typeof info.count === 'number') {
                        message += ` count: ${info.count}`;
                    }
                    else {
                        const splat = info[Symbol.for('splat')];
                        if (splat) {
                            if (Array.isArray(splat)) {
                                const metadata = splat.map((s) => typeof s === 'object' ? JSON.stringify(s) : s).join(' ');
                                if (metadata) {
                                    message += ` ${metadata}`;
                                }
                            }
                            else if (typeof splat === 'object' && splat !== null) {
                                const metadataString = JSON.stringify(splat);
                                if (metadataString && metadataString !== '{}') {
                                    if (!(typeof info.message === 'string' && info.message.startsWith('Initial URLs read from') && info.urls && typeof info.count === 'number')) {
                                        message += ` ${metadataString}`;
                                    }
                                }
                            }
                            else {
                                message += ` ${splat}`;
                            }
                        }
                    }
                    return message;
                }))
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'app.log'),
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
                })(), winston.format.json())
            }),
            new winston.transports.File({
                filename: path.join(logDir, 'error.log'),
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
                })(), winston.format.json())
            })
        ],
        exitOnError: false
    });
    logger.info(`Logger initialized successfully. Log directory: ${logDir}`);
    return logger;
}
export default {
    get instance() {
        if (!logger) {
            throw new Error("Logger has not been initialized. Call initializeLogger(logDir) first.");
        }
        return logger;
    }
};
