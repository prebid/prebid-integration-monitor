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
      dbPath: config.dbPath || path.join(process.cwd(), 'data', 'url-tracker.db'),
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

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    
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
      
      CREATE INDEX IF NOT EXISTS idx_status ON processed_urls(status);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON processed_urls(timestamp);
      CREATE INDEX IF NOT EXISTS idx_retry ON processed_urls(retry_count);
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
      this.logger.error(`Error checking URL processing status: ${url}`, { error });
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
  public markUrlProcessed(url: string, status: UrlStatus, errorCode?: string): void {
    try {
      const trimmedUrl = url.trim();
      const timestamp = new Date().toISOString();
      
      // Get existing record to determine retry count
      const existing = this.selectStmt.get(trimmedUrl) as UrlRecord | undefined;
      const retryCount = existing ? existing.retryCount + (status === 'retry' ? 1 : 0) : 0;

      this.insertStmt.run(trimmedUrl, status, timestamp, errorCode ?? null, retryCount);
      
      if (this.config.debug) {
        this.logger.debug(`Marked URL as ${status}: ${trimmedUrl}`, { errorCode, retryCount });
      }
    } catch (error) {
      this.logger.error(`Error marking URL as processed: ${url}`, { error, status, errorCode });
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
            const shouldRetry = this.shouldRetryUrl(result.url, result.error.code);
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
      this.logger.info(`Updated URL tracking for ${taskResults.length} task results`);
    } catch (error) {
      this.logger.error('Error updating URL tracking from task results', { error });
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
      
      const results = stmt.all(this.config.maxRetries, limit) as { url: string }[];
      return results.map(r => r.url);
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
    this.logger.info(`Starting import of existing results from: ${storeDirectory}`);
    
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
   * Recursively import URLs from JSON files in directory
   */
  private importDirectoryRecursive(dir: string, callback: (url: string) => void): void {
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
export function getUrlTracker(logger: WinstonLogger, config?: UrlTrackerConfig): UrlTracker {
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