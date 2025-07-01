/**
 * @fileoverview URL tracking service using SQLite for persistent deduplication.
 * Provides efficient URL tracking across scan runs to avoid reprocessing
 * previously scanned URLs, especially useful for large datasets like
 * top-1M domain lists.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { Logger as WinstonLogger } from 'winston';
import type { TaskResult } from '../common/types.js';

/**
 * URL processing status enumeration
 */
export type UrlStatus = 'success' | 'no_data' | 'error' | 'retry';

/**
 * Interface for URL tracking record
 */
export interface UrlRecord {
  url: string;
  status: UrlStatus;
  timestamp: string;
  errorCode?: string;
  retryCount: number;
}

/**
 * Configuration options for URL tracker
 */
export interface UrlTrackerConfig {
  /** Database file path. Defaults to './data/url-tracker.db' */
  dbPath?: string;
  /** Maximum retry attempts for failed URLs. Defaults to 3 */
  maxRetries?: number;
  /** Whether to enable debug logging. Defaults to false */
  debug?: boolean;
}

/**
 * SQLite-based URL tracking service for persistent deduplication across scan runs.
 * Efficiently tracks millions of URLs with fast lookup performance.
 */
export class UrlTracker {
  private db!: Database.Database;
  private config: Required<UrlTrackerConfig>;
  private logger: WinstonLogger;

  // Prepared statements for performance
  private insertStmt!: Database.Statement;
  private updateStmt!: Database.Statement;
  private selectStmt!: Database.Statement;
  private bulkCheckStmt!: Database.Statement;

  constructor(logger: WinstonLogger, config: UrlTrackerConfig = {}) {
    this.logger = logger;
    this.config = {
      dbPath:
        config.dbPath || path.join(process.cwd(), 'data', 'url-tracker.db'),
      maxRetries: config.maxRetries || 3,
      debug: config.debug || false,
    };

    this.initializeDatabase();
    this.prepareSqlStatements();
  }

  /**
   * Initialize SQLite database and create tables if they don't exist
   */
  private initializeDatabase(): void {
    // Ensure data directory exists
    const dbDir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      this.logger.info(`Created database directory: ${dbDir}`);
    }

    // Open/create database
    this.db = new Database(this.config.dbPath);
    this.logger.info(`Initialized URL tracker database: ${this.config.dbPath}`);

    // Enable WAL mode for better concurrent access and performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL'); // Better performance while maintaining durability
    this.db.pragma('cache_size = 10000'); // 10MB cache
    this.db.pragma('temp_store = MEMORY'); // Store temp tables in memory
    this.db.pragma('mmap_size = 268435456'); // 256MB memory mapping

    // Create table with optimized schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_urls (
        url TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        error_code TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      
      -- Primary indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_status ON processed_urls(status);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON processed_urls(timestamp);
      CREATE INDEX IF NOT EXISTS idx_retry ON processed_urls(retry_count);
      
      -- Composite indexes for complex queries
      CREATE INDEX IF NOT EXISTS idx_status_timestamp ON processed_urls(status, timestamp);
      CREATE INDEX IF NOT EXISTS idx_status_retry ON processed_urls(status, retry_count);
      
      -- Analyze table for query optimizer
      ANALYZE processed_urls;
    `);

    this.logger.info('URL tracker database schema initialized');
  }

  /**
   * Prepare SQL statements for optimal performance
   */
  private prepareSqlStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_urls 
      (url, status, timestamp, error_code, retry_count, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    this.updateStmt = this.db.prepare(`
      UPDATE processed_urls 
      SET status = ?, timestamp = ?, error_code = ?, retry_count = ?, updated_at = datetime('now')
      WHERE url = ?
    `);

    this.selectStmt = this.db.prepare(`
      SELECT * FROM processed_urls WHERE url = ?
    `);

    this.bulkCheckStmt = this.db.prepare(`
      SELECT url FROM processed_urls WHERE url = ? AND status IN ('success', 'no_data')
    `);
  }

  /**
   * Check if a URL has been successfully processed
   * @param url The URL to check
   * @returns true if URL was successfully processed or has no_data
   */
  public isUrlProcessed(url: string): boolean {
    try {
      const result = this.bulkCheckStmt.get(url.trim());
      return !!result;
    } catch (error) {
      this.logger.error(`Error checking URL processing status: ${url}`, {
        error,
      });
      return false;
    }
  }

  /**
   * Filter out already processed URLs from a list
   * @param urls Array of URLs to filter
   * @returns Array of unprocessed URLs
   */
  public filterUnprocessedUrls(urls: string[]): string[] {
    if (!urls || urls.length === 0) return [];

    const unprocessedUrls: string[] = [];
    const transaction = this.db.transaction((urlList: string[]) => {
      for (const url of urlList) {
        if (!this.isUrlProcessed(url)) {
          unprocessedUrls.push(url);
        }
      }
    });

    try {
      transaction(urls);
      this.logger.info(
        `Filtered URLs: ${urls.length} total, ${unprocessedUrls.length} unprocessed, ${urls.length - unprocessedUrls.length} already processed`
      );
      return unprocessedUrls;
    } catch (error) {
      this.logger.error('Error filtering unprocessed URLs', { error });
      return urls; // Return all URLs if filtering fails
    }
  }

  /**
   * Mark a URL as processed with given status
   * @param url The URL to mark
   * @param status Processing status
   * @param errorCode Optional error code for failed URLs
   */
  public markUrlProcessed(
    url: string,
    status: UrlStatus,
    errorCode?: string
  ): void {
    try {
      const trimmedUrl = url.trim();
      const timestamp = new Date().toISOString();

      // Get existing record to determine retry count
      const existing = this.selectStmt.get(trimmedUrl) as UrlRecord | undefined;
      const retryCount = existing
        ? existing.retryCount + (status === 'retry' ? 1 : 0)
        : 0;

      this.insertStmt.run(
        trimmedUrl,
        status,
        timestamp,
        errorCode ?? null,
        retryCount
      );

      if (this.config.debug) {
        this.logger.debug(`Marked URL as ${status}: ${trimmedUrl}`, {
          errorCode,
          retryCount,
        });
      }
    } catch (error) {
      this.logger.error(`Error marking URL as processed: ${url}`, {
        error,
        status,
        errorCode,
      });
    }
  }

  /**
   * Bulk update URL statuses from task results
   * @param taskResults Array of task results to process
   */
  public updateFromTaskResults(taskResults: TaskResult[]): void {
    if (!taskResults || taskResults.length === 0) return;

    const transaction = this.db.transaction((results: TaskResult[]) => {
      for (const result of results) {
        switch (result.type) {
          case 'success':
            if (result.data.url) {
              this.markUrlProcessed(result.data.url, 'success');
            }
            break;
          case 'no_data':
            this.markUrlProcessed(result.url, 'no_data');
            break;
          case 'error':
            const shouldRetry = this.shouldRetryUrl(
              result.url,
              result.error.code
            );
            this.markUrlProcessed(
              result.url,
              shouldRetry ? 'retry' : 'error',
              result.error.code
            );
            break;
        }
      }
    });

    try {
      transaction(taskResults);
      this.logger.info(
        `Updated URL tracking for ${taskResults.length} task results`
      );
    } catch (error) {
      this.logger.error('Error updating URL tracking from task results', {
        error,
      });
    }
  }

  /**
   * Determine if a failed URL should be retried
   * @param url The URL that failed
   * @param errorCode The error code
   * @returns true if URL should be retried
   */
  private shouldRetryUrl(url: string, errorCode: string): boolean {
    const existing = this.selectStmt.get(url.trim()) as UrlRecord | undefined;
    const currentRetryCount = existing ? existing.retryCount : 0;

    // Don't retry permanent failures
    const permanentErrors = ['ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED'];
    if (permanentErrors.includes(errorCode)) {
      return false;
    }

    // Retry timeouts and temporary failures up to max retries
    return currentRetryCount < this.config.maxRetries;
  }

  /**
   * Get URLs that should be retried
   * @param limit Maximum number of URLs to return
   * @returns Array of URLs marked for retry
   */
  public getUrlsForRetry(limit: number = 1000): string[] {
    try {
      const stmt = this.db.prepare(`
        SELECT url FROM processed_urls 
        WHERE status = 'retry' AND retry_count < ?
        ORDER BY updated_at ASC
        LIMIT ?
      `);

      const results = stmt.all(this.config.maxRetries, limit) as {
        url: string;
      }[];
      return results.map((r) => r.url);
    } catch (error) {
      this.logger.error('Error getting URLs for retry', { error });
      return [];
    }
  }

  /**
   * Get processing statistics
   * @returns Object with processing counts by status
   */
  public getStats(): Record<string, number> {
    try {
      const stmt = this.db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM processed_urls 
        GROUP BY status
      `);

      const results = stmt.all() as { status: string; count: number }[];
      const stats: Record<string, number> = {};

      for (const { status, count } of results) {
        stats[status] = count;
      }

      return stats;
    } catch (error) {
      this.logger.error('Error getting URL processing stats', { error });
      return {};
    }
  }

  /**
   * Import existing results from JSON store files
   * @param storeDirectory Path to the store directory
   */
  public async importExistingResults(storeDirectory: string): Promise<void> {
    this.logger.info(
      `Starting import of existing results from: ${storeDirectory}`
    );

    try {
      if (!fs.existsSync(storeDirectory)) {
        this.logger.warn(`Store directory does not exist: ${storeDirectory}`);
        return;
      }

      let importCount = 0;
      const transaction = this.db.transaction(() => {
        this.importDirectoryRecursive(storeDirectory, (url: string) => {
          this.markUrlProcessed(url, 'success');
          importCount++;
        });
      });

      transaction();
      this.logger.info(`Successfully imported ${importCount} existing results`);
    } catch (error) {
      this.logger.error('Error importing existing results', { error });
    }
  }

  /**
   * Perform database maintenance operations for optimal performance
   * @param options Maintenance options
   */
  public performMaintenance(
    options: {
      vacuum?: boolean;
      analyze?: boolean;
      reindex?: boolean;
      cleanupOld?: boolean;
      olderThanDays?: number;
    } = {}
  ): void {
    try {
      this.logger.info('Starting database maintenance operations...');
      const startTime = Date.now();

      // Clean up old records if requested
      if (options.cleanupOld) {
        const daysThreshold = options.olderThanDays || 90;
        const cleanupStmt = this.db.prepare(`
          DELETE FROM processed_urls 
          WHERE created_at < datetime('now', '-${daysThreshold} days')
          AND status IN ('error', 'retry')
        `);
        const cleanupResult = cleanupStmt.run();
        this.logger.info(
          `Cleaned up ${cleanupResult.changes} old records older than ${daysThreshold} days`
        );
      }

      // Re-analyze tables for query optimizer
      if (options.analyze !== false) {
        this.db.exec('ANALYZE processed_urls;');
        this.logger.info('Table analysis completed');
      }

      // Reindex tables if requested
      if (options.reindex) {
        this.db.exec('REINDEX;');
        this.logger.info('Database reindexing completed');
      }

      // Vacuum database if requested
      if (options.vacuum) {
        this.db.exec('VACUUM;');
        this.logger.info('Database vacuum completed');
      }

      const duration = Date.now() - startTime;
      this.logger.info(`Database maintenance completed in ${duration}ms`);
    } catch (error) {
      this.logger.error('Error during database maintenance', { error });
    }
  }

  /**
   * Get database performance statistics
   */
  public getDatabaseStats(): {
    size: number;
    pageCount: number;
    pageSize: number;
    indexCount: number;
    walSize?: number;
  } {
    try {
      const stats = {
        size: 0,
        pageCount: 0,
        pageSize: 0,
        indexCount: 0,
        walSize: 0,
      };

      // Get basic database info
      const pageCountResult = this.db.pragma('page_count', {
        simple: true,
      }) as number;
      const pageSizeResult = this.db.pragma('page_size', {
        simple: true,
      }) as number;

      stats.pageCount = pageCountResult;
      stats.pageSize = pageSizeResult;
      stats.size = pageCountResult * pageSizeResult;

      // Get index count
      const indexResult = this.db
        .prepare(
          `
        SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'index'
      `
        )
        .get() as { count: number };
      stats.indexCount = indexResult.count;

      // Get WAL file size if it exists
      try {
        const walPath = this.config.dbPath + '-wal';
        if (fs.existsSync(walPath)) {
          stats.walSize = fs.statSync(walPath).size;
        }
      } catch (e) {
        // WAL file might not exist
      }

      return stats;
    } catch (error) {
      this.logger.error('Error getting database stats', { error });
      return { size: 0, pageCount: 0, pageSize: 0, indexCount: 0 };
    }
  }

  /**
   * Recursively import URLs from JSON files in directory
   */
  private importDirectoryRecursive(
    dir: string,
    callback: (url: string) => void
  ): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.importDirectoryRecursive(fullPath, callback);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const data = JSON.parse(content);

          if (Array.isArray(data)) {
            for (const item of data) {
              if (item && typeof item.url === 'string') {
                callback(item.url);
              }
            }
          }
        } catch (error) {
          this.logger.warn(`Error importing file ${fullPath}`, { error });
        }
      }
    }
  }

  /**
   * Reset URL tracking (clear all data)
   */
  public resetTracking(): void {
    try {
      this.db.exec('DELETE FROM processed_urls');
      this.logger.info('URL tracking data has been reset');
    } catch (error) {
      this.logger.error('Error resetting URL tracking', { error });
    }
  }

  /**
   * Analyze URL range to check processing status
   * @param startIndex Starting index (0-based)
   * @param endIndex Ending index (0-based, exclusive)
   * @param allUrls Array of all URLs to analyze
   * @returns Range analysis with processing statistics
   */
  public analyzeUrlRange(
    startIndex: number,
    endIndex: number,
    allUrls: string[]
  ): {
    totalInRange: number;
    processedCount: number;
    unprocessedCount: number;
    processedPercentage: number;
    isFullyProcessed: boolean;
    nextUnprocessedIndex?: number;
  } {
    const rangeUrls = allUrls.slice(startIndex, endIndex);
    const processedUrls = rangeUrls.filter((url) => this.isUrlProcessed(url));

    const totalInRange = rangeUrls.length;
    const processedCount = processedUrls.length;
    const unprocessedCount = totalInRange - processedCount;
    const processedPercentage =
      totalInRange > 0 ? (processedCount / totalInRange) * 100 : 0;
    const isFullyProcessed = unprocessedCount === 0;

    // Find next unprocessed URL index in the full array
    let nextUnprocessedIndex: number | undefined;
    if (!isFullyProcessed) {
      for (let i = startIndex; i < endIndex; i++) {
        if (!this.isUrlProcessed(allUrls[i])) {
          nextUnprocessedIndex = i;
          break;
        }
      }
    }

    return {
      totalInRange,
      processedCount,
      unprocessedCount,
      processedPercentage,
      isFullyProcessed,
      nextUnprocessedIndex,
    };
  }

  /**
   * Find optimal next range for processing
   * @param allUrls Array of all URLs
   * @param batchSize Size of batches to suggest
   * @param maxSuggestions Maximum number of range suggestions to return
   * @returns Array of suggested ranges with their processing status
   */
  public suggestNextRanges(
    allUrls: string[],
    batchSize: number,
    maxSuggestions: number = 3
  ): Array<{
    startIndex: number;
    endIndex: number;
    startUrl: number; // 1-based
    endUrl: number; // 1-based
    totalUrls: number;
    estimatedUnprocessed: number;
    efficiency: number; // percentage of unprocessed URLs in range
  }> {
    const suggestions: Array<{
      startIndex: number;
      endIndex: number;
      startUrl: number;
      endUrl: number;
      totalUrls: number;
      estimatedUnprocessed: number;
      efficiency: number;
    }> = [];

    // Sample ranges to find gaps efficiently (don't check every single URL)
    const sampleSize = Math.min(1000, Math.floor(allUrls.length / 100)); // Sample 1% or max 1000 URLs
    const step = Math.max(1, Math.floor(allUrls.length / sampleSize));

    for (
      let i = 0;
      i < allUrls.length && suggestions.length < maxSuggestions;
      i += batchSize
    ) {
      const endIndex = Math.min(i + batchSize, allUrls.length);

      // Sample URLs in this range to estimate efficiency
      let sampledProcessed = 0;
      let sampledTotal = 0;

      for (let j = i; j < endIndex; j += step) {
        if (this.isUrlProcessed(allUrls[j])) {
          sampledProcessed++;
        }
        sampledTotal++;
      }

      const estimatedProcessedPercentage =
        sampledTotal > 0 ? (sampledProcessed / sampledTotal) * 100 : 0;
      const efficiency = 100 - estimatedProcessedPercentage;
      const estimatedUnprocessed = Math.round((batchSize * efficiency) / 100);

      // Only suggest ranges with significant unprocessed URLs
      if (efficiency > 20) {
        // At least 20% unprocessed
        suggestions.push({
          startIndex: i,
          endIndex,
          startUrl: i + 1, // Convert to 1-based
          endUrl: endIndex, // 1-based inclusive
          totalUrls: endIndex - i,
          estimatedUnprocessed,
          efficiency,
        });
      }
    }

    // Sort by efficiency (most unprocessed first)
    return suggestions.sort((a, b) => b.efficiency - a.efficiency);
  }

  /**
   * Check if a range of URLs is worth processing
   * @param startIndex Starting index (0-based)
   * @param endIndex Ending index (0-based, exclusive)
   * @param allUrls Array of all URLs
   * @param minEfficiency Minimum percentage of unprocessed URLs required (default: 10%)
   * @returns true if range has enough unprocessed URLs to be worth processing
   */
  public isRangeWorthProcessing(
    startIndex: number,
    endIndex: number,
    allUrls: string[],
    minEfficiency: number = 10
  ): boolean {
    const analysis = this.analyzeUrlRange(startIndex, endIndex, allUrls);
    const efficiency =
      (analysis.unprocessedCount / analysis.totalInRange) * 100;
    return efficiency >= minEfficiency;
  }

  /**
   * Close database connection
   */
  public close(): void {
    try {
      this.db.close();
      this.logger.info('URL tracker database connection closed');
    } catch (error) {
      this.logger.error('Error closing URL tracker database', { error });
    }
  }
}

/**
 * Global URL tracker instance for singleton pattern
 */
let globalUrlTracker: UrlTracker | null = null;

/**
 * Get or create global URL tracker instance
 * @param logger Winston logger instance
 * @param config Optional configuration
 * @returns UrlTracker instance
 */
export function getUrlTracker(
  logger: WinstonLogger,
  config?: UrlTrackerConfig
): UrlTracker {
  if (!globalUrlTracker) {
    globalUrlTracker = new UrlTracker(logger, config);
  }
  return globalUrlTracker;
}

/**
 * Close global URL tracker instance
 */
export function closeUrlTracker(): void {
  if (globalUrlTracker) {
    globalUrlTracker.close();
    globalUrlTracker = null;
  }
}
