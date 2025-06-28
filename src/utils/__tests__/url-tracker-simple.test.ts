import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UrlTracker, getUrlTracker, closeUrlTracker, type UrlTrackerConfig } from '../url-tracker.js';
import type { TaskResult } from '../../common/types.js';
import type { Logger as WinstonLogger } from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create mock logger
const createMockLogger = (): WinstonLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any);

describe('UrlTracker Integration Tests', () => {
  let mockLogger: WinstonLogger;
  let urlTracker: UrlTracker;
  let testDbPath: string;

  beforeEach(() => {
    mockLogger = createMockLogger();
    
    // Create a unique temporary database path for each test
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-tracker-test-'));
    testDbPath = path.join(tempDir, 'test.db');
    
    const config: UrlTrackerConfig = {
      dbPath: testDbPath,
      maxRetries: 3,
      debug: false,
    };
    
    urlTracker = new UrlTracker(mockLogger, config);
  });

  afterEach(() => {
    urlTracker.close();
    closeUrlTracker();
    
    // Clean up test database
    try {
      const dbDir = path.dirname(testDbPath);
      if (fs.existsSync(dbDir)) {
        fs.rmSync(dbDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Basic URL Tracking', () => {
    it('should track URL as not processed initially', () => {
      const result = urlTracker.isUrlProcessed('https://example.com');
      expect(result).toBe(false);
    });

    it('should mark URL as processed and track it', () => {
      const url = 'https://example.com';
      
      // Initially not processed
      expect(urlTracker.isUrlProcessed(url)).toBe(false);
      
      // Mark as processed
      urlTracker.markUrlProcessed(url, 'success');
      
      // Now should be tracked as processed
      expect(urlTracker.isUrlProcessed(url)).toBe(true);
    });

    it('should track different statuses correctly', () => {
      urlTracker.markUrlProcessed('https://success.com', 'success');
      urlTracker.markUrlProcessed('https://nodata.com', 'no_data');
      urlTracker.markUrlProcessed('https://error.com', 'error', 'TIMEOUT');
      
      expect(urlTracker.isUrlProcessed('https://success.com')).toBe(true);
      expect(urlTracker.isUrlProcessed('https://nodata.com')).toBe(true);
      expect(urlTracker.isUrlProcessed('https://error.com')).toBe(false); // errors don't count as "processed"
    });
  });

  describe('URL Filtering', () => {
    it('should filter out processed URLs', () => {
      const urls = [
        'https://processed1.com',
        'https://processed2.com',
        'https://unprocessed.com'
      ];
      
      // Mark first two as processed
      urlTracker.markUrlProcessed(urls[0], 'success');
      urlTracker.markUrlProcessed(urls[1], 'no_data');
      
      const filtered = urlTracker.filterUnprocessedUrls(urls);
      
      expect(filtered).toEqual(['https://unprocessed.com']);
    });

    it('should return empty array when all URLs are processed', () => {
      const urls = ['https://processed1.com', 'https://processed2.com'];
      
      urls.forEach(url => urlTracker.markUrlProcessed(url, 'success'));
      
      const filtered = urlTracker.filterUnprocessedUrls(urls);
      
      expect(filtered).toEqual([]);
    });

    it('should return all URLs when none are processed', () => {
      const urls = ['https://new1.com', 'https://new2.com'];
      
      const filtered = urlTracker.filterUnprocessedUrls(urls);
      
      expect(filtered).toEqual(urls);
    });

    it('should handle empty URL array', () => {
      const filtered = urlTracker.filterUnprocessedUrls([]);
      expect(filtered).toEqual([]);
    });
  });

  describe('Task Results Processing', () => {
    it('should update from task results', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'success',
          data: {
            url: 'https://success.com',
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: []
          }
        },
        {
          type: 'no_data',
          url: 'https://nodata.com'
        },
        {
          type: 'error',
          url: 'https://timeout.com',
          error: {
            code: 'TIMEOUT',
            message: 'Request timeout'
          }
        }
      ];

      urlTracker.updateFromTaskResults(taskResults);

      // Success and no_data should be marked as processed
      expect(urlTracker.isUrlProcessed('https://success.com')).toBe(true);
      expect(urlTracker.isUrlProcessed('https://nodata.com')).toBe(true);
      
      // Timeout error should be retried (not marked as processed)
      expect(urlTracker.isUrlProcessed('https://timeout.com')).toBe(false);
    });

    it('should handle task results without URL field', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'success',
          data: {
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: []
            // No URL field
          }
        }
      ];

      // Should not throw error
      expect(() => {
        urlTracker.updateFromTaskResults(taskResults);
      }).not.toThrow();
    });
  });

  describe('Statistics', () => {
    it('should return processing statistics', () => {
      urlTracker.markUrlProcessed('https://success1.com', 'success');
      urlTracker.markUrlProcessed('https://success2.com', 'success');
      urlTracker.markUrlProcessed('https://nodata.com', 'no_data');
      urlTracker.markUrlProcessed('https://error.com', 'error', 'DNS_ERROR');

      const stats = urlTracker.getStats();

      expect(stats.success).toBe(2);
      expect(stats.no_data).toBe(1);
      expect(stats.error).toBe(1);
    });

    it('should return empty stats for new database', () => {
      const stats = urlTracker.getStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });
  });

  describe('Database Management', () => {
    it('should reset tracking data', () => {
      // Add some data
      urlTracker.markUrlProcessed('https://test.com', 'success');
      expect(urlTracker.isUrlProcessed('https://test.com')).toBe(true);

      // Reset
      urlTracker.resetTracking();

      // Should no longer be tracked
      expect(urlTracker.isUrlProcessed('https://test.com')).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should retry timeout errors', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'error',
          url: 'https://timeout.com',
          error: {
            code: 'TIMEOUT',
            message: 'Request timeout'
          }
        }
      ];

      urlTracker.updateFromTaskResults(taskResults);

      // Should be available for retry
      const retryUrls = urlTracker.getUrlsForRetry(10);
      expect(retryUrls).toContain('https://timeout.com');
    });

    it('should not retry permanent DNS errors', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'error',
          url: 'https://dns-error.com',
          error: {
            code: 'ERR_NAME_NOT_RESOLVED',
            message: 'DNS resolution failed'
          }
        }
      ];

      urlTracker.updateFromTaskResults(taskResults);

      // Should not be available for retry
      const retryUrls = urlTracker.getUrlsForRetry(10);
      expect(retryUrls).not.toContain('https://dns-error.com');
    });
  });
});

describe('Global UrlTracker Management', () => {
  let mockLogger: WinstonLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    closeUrlTracker();
  });

  it('should return singleton instance', () => {
    const tracker1 = getUrlTracker(mockLogger);
    const tracker2 = getUrlTracker(mockLogger);
    
    expect(tracker1).toBe(tracker2);
  });

  it('should create new instance after close', () => {
    const tracker1 = getUrlTracker(mockLogger);
    closeUrlTracker();
    const tracker2 = getUrlTracker(mockLogger);
    
    expect(tracker1).not.toBe(tracker2);
  });
});