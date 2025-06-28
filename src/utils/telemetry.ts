/**
 * @fileoverview Comprehensive debugging and monitoring for URL processing pipeline
 * Provides detailed logging and tracing to understand why URLs aren't being processed
 */

import type { Logger as WinstonLogger } from 'winston';

/**
 * Initialize telemetry (simplified to enhanced logging)
 */
export function initializeTelemetry(serviceName = 'prebid-integration-monitor') {
  console.log(`🔍 Enhanced debugging enabled for ${serviceName}`);
}

/**
 * Shutdown telemetry
 */
export async function shutdownTelemetry() {
  console.log('🔍 Debugging session complete');
}

/**
 * Generate unique trace ID for following operations
 */
function generateTraceId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Tracer for URL loading operations
 */
export class URLLoadingTracer {
  private traceId: string;
  private logger: WinstonLogger;
  private startTime: number;

  constructor(source: string, logger: WinstonLogger) {
    this.traceId = generateTraceId();
    this.logger = logger;
    this.startTime = Date.now();
    
    this.logger.info('🔍 TRACE [URL_LOADING] Starting', { 
      traceId: this.traceId,
      source,
      sourceType: source.includes('github') ? 'github' : 'file',
      timestamp: new Date().toISOString()
    });
  }

  recordUrlCount(count: number, stage: string) {
    this.logger.info(`🔍 TRACE [URL_LOADING] ${stage}`, { 
      traceId: this.traceId,
      stage, 
      count,
      timestamp: new Date().toISOString()
    });
  }

  recordError(error: Error) {
    this.logger.error('🔍 TRACE [URL_LOADING] ERROR', { 
      traceId: this.traceId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  finish(finalCount: number) {
    const duration = Date.now() - this.startTime;
    this.logger.info('🔍 TRACE [URL_LOADING] COMPLETED', { 
      traceId: this.traceId,
      finalCount,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Tracer for URL filtering operations
 */
export class URLFilteringTracer {
  private traceId: string;
  private logger: WinstonLogger;
  private startTime: number;

  constructor(initialCount: number, logger: WinstonLogger) {
    this.traceId = generateTraceId();
    this.logger = logger;
    this.startTime = Date.now();
    
    this.logger.info('🔍 TRACE [URL_FILTERING] Starting', { 
      traceId: this.traceId,
      initialCount,
      timestamp: new Date().toISOString()
    });
  }

  recordRangeFiltering(beforeCount: number, afterCount: number, range?: string) {
    const filtered = beforeCount - afterCount;
    
    this.logger.info('🔍 TRACE [URL_FILTERING] Range applied', {
      traceId: this.traceId,
      range: range || 'none',
      beforeCount,
      afterCount,
      filtered,
      filterPercentage: beforeCount > 0 ? ((filtered / beforeCount) * 100).toFixed(1) : '0',
      timestamp: new Date().toISOString()
    });

    if (filtered === beforeCount) {
      this.logger.warn('🔍 TRACE [URL_FILTERING] ⚠️  RANGE FILTERED ALL URLS!', {
        traceId: this.traceId,
        range,
        beforeCount,
        issue: 'Range filtering removed all URLs - check range validity'
      });
    }
  }

  recordProcessedFiltering(beforeCount: number, afterCount: number, skipped: number) {
    const skipPercentage = beforeCount > 0 ? ((skipped / beforeCount) * 100).toFixed(1) : '0';
    
    this.logger.info('🔍 TRACE [URL_FILTERING] Processed URLs filtered', {
      traceId: this.traceId,
      beforeCount,
      afterCount,
      skipped,
      skipPercentage,
      timestamp: new Date().toISOString()
    });

    if (skipped === beforeCount && beforeCount > 0) {
      this.logger.warn('🔍 TRACE [URL_FILTERING] ⚠️  ALL URLS ALREADY PROCESSED!', {
        traceId: this.traceId,
        beforeCount,
        skipped,
        issue: 'All URLs in range have been previously processed'
      });
    } else if (parseFloat(skipPercentage) > 80) {
      this.logger.warn('🔍 TRACE [URL_FILTERING] ⚠️  HIGH SKIP RATE!', {
        traceId: this.traceId,
        skipPercentage,
        skipped,
        beforeCount,
        issue: 'Most URLs already processed - consider different range'
      });
    }
  }

  recordDomainFiltering(beforeCount: number, afterCount: number) {
    const filtered = beforeCount - afterCount;
    
    this.logger.info('🔍 TRACE [URL_FILTERING] Domain validation applied', {
      traceId: this.traceId,
      beforeCount,
      afterCount,
      filtered,
      filterPercentage: beforeCount > 0 ? ((filtered / beforeCount) * 100).toFixed(1) : '0',
      timestamp: new Date().toISOString()
    });

    if (filtered === beforeCount) {
      this.logger.error('🔍 TRACE [URL_FILTERING] ❌ DOMAIN FILTERING REMOVED ALL URLS!', {
        traceId: this.traceId,
        beforeCount,
        issue: 'All URLs failed domain validation - check URL format'
      });
    }
  }

  finish(finalCount: number) {
    const duration = Date.now() - this.startTime;
    this.logger.info('🔍 TRACE [URL_FILTERING] COMPLETED', { 
      traceId: this.traceId,
      finalCount,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Tracer for batch processing operations
 */
export class BatchProcessingTracer {
  private traceId: string;
  private logger: WinstonLogger;
  private startTime: number;

  constructor(batchNumber: number, range: string, logger: WinstonLogger) {
    this.traceId = generateTraceId();
    this.logger = logger;
    this.startTime = Date.now();
    
    this.logger.info('🔍 TRACE [BATCH_PROCESSING] Starting', { 
      traceId: this.traceId,
      batchNumber,
      range,
      timestamp: new Date().toISOString()
    });
  }

  recordUrlCounts(processed: number, skipped: number, successful: number, errors: number) {
    this.logger.info('🔍 TRACE [BATCH_PROCESSING] Results', {
      traceId: this.traceId,
      processed,
      skipped,
      successful,
      errors,
      noData: processed - successful - errors,
      timestamp: new Date().toISOString()
    });

    if (processed === 0 && skipped === 0) {
      this.logger.error('🔍 TRACE [BATCH_PROCESSING] ❌ NO URLS PROCESSED OR SKIPPED!', {
        traceId: this.traceId,
        issue: 'Batch completed but no URLs were processed or skipped - possible system issue'
      });
    }
  }

  recordError(error: Error) {
    this.logger.error('🔍 TRACE [BATCH_PROCESSING] ERROR', { 
      traceId: this.traceId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  finish(success: boolean = true) {
    const duration = (Date.now() - this.startTime) / 1000;
    
    this.logger.info('🔍 TRACE [BATCH_PROCESSING] COMPLETED', { 
      traceId: this.traceId,
      duration,
      success,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Tracer for GitHub URL fetching
 */
export class GitHubFetchTracer {
  private traceId: string;
  private logger: WinstonLogger;
  private startTime: number;

  constructor(repoUrl: string, logger: WinstonLogger) {
    this.traceId = generateTraceId();
    this.logger = logger;
    this.startTime = Date.now();
    
    const rawUrl = this.convertToRawUrl(repoUrl);
    
    this.logger.info('🔍 TRACE [GITHUB_FETCH] Starting', { 
      traceId: this.traceId,
      repoUrl,
      rawUrl,
      timestamp: new Date().toISOString()
    });
  }

  private convertToRawUrl(repoUrl: string): string {
    return repoUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  recordHttpRequest(url: string, statusCode?: number, contentLength?: number) {
    this.logger.info('🔍 TRACE [GITHUB_FETCH] HTTP Request', {
      traceId: this.traceId,
      url,
      statusCode,
      contentLength,
      timestamp: new Date().toISOString()
    });

    if (statusCode && statusCode >= 400) {
      this.logger.error('🔍 TRACE [GITHUB_FETCH] ❌ HTTP ERROR!', {
        traceId: this.traceId,
        url,
        statusCode,
        issue: statusCode === 404 ? 'File not found' : `HTTP error ${statusCode}`
      });
    }
  }

  recordParsingResults(rawLines: number, validUrls: number, duplicatesRemoved: number) {
    this.logger.info('🔍 TRACE [GITHUB_FETCH] Content parsed', {
      traceId: this.traceId,
      rawLines,
      validUrls,
      duplicatesRemoved,
      parseSuccessRate: rawLines > 0 ? ((validUrls / rawLines) * 100).toFixed(1) : '0',
      timestamp: new Date().toISOString()
    });

    if (rawLines > 0 && validUrls === 0) {
      this.logger.error('🔍 TRACE [GITHUB_FETCH] ❌ NO VALID URLS FOUND!', {
        traceId: this.traceId,
        rawLines,
        issue: 'File has content but no valid URLs extracted - check file format'
      });
    }
  }

  recordError(error: Error, step: string) {
    this.logger.error('🔍 TRACE [GITHUB_FETCH] ERROR', { 
      traceId: this.traceId,
      error: error.message,
      step,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  finish(finalUrlCount: number) {
    const duration = Date.now() - this.startTime;
    
    this.logger.info('🔍 TRACE [GITHUB_FETCH] COMPLETED', { 
      traceId: this.traceId,
      finalUrlCount,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });

    if (finalUrlCount === 0) {
      this.logger.error('🔍 TRACE [GITHUB_FETCH] ❌ ZERO URLS RETURNED!', {
        traceId: this.traceId,
        issue: 'GitHub fetch completed but returned no URLs - check source and format'
      });
    }
  }
}

/**
 * Create a simple trace wrapper for functions
 */
export function traced<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  logger?: WinstonLogger
): T {
  return ((...args: any[]) => {
    const traceId = generateTraceId();
    const startTime = Date.now();
    
    if (logger) {
      logger.debug(`🔍 TRACE [${name}] Starting`, { traceId });
    }
    
    try {
      const result = fn(...args);
      
      if (result instanceof Promise) {
        return result
          .then((res) => {
            const duration = Date.now() - startTime;
            if (logger) {
              logger.debug(`🔍 TRACE [${name}] Completed`, { traceId, durationMs: duration });
            }
            return res;
          })
          .catch((error) => {
            const duration = Date.now() - startTime;
            if (logger) {
              logger.error(`🔍 TRACE [${name}] Failed`, { 
                traceId, 
                error: error.message, 
                durationMs: duration 
              });
            }
            throw error;
          });
      } else {
        const duration = Date.now() - startTime;
        if (logger) {
          logger.debug(`🔍 TRACE [${name}] Completed`, { traceId, durationMs: duration });
        }
        return result;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      if (logger) {
        logger.error(`🔍 TRACE [${name}] Failed`, { 
          traceId, 
          error: (error as Error).message, 
          durationMs: duration 
        });
      }
      throw error;
    }
  }) as T;
}