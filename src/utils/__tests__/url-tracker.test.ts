import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UrlTracker,
  getUrlTracker,
  closeUrlTracker,
  type UrlTrackerConfig,
} from '../url-tracker.js';
import type {
  TaskResult,
  TaskResultSuccess,
  TaskResultNoData,
  TaskResultError,
} from '../../common/types.js';
import type { Logger as WinstonLogger } from 'winston';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
vi.mock('fs');
// Create mocks outside the vi.mock call
const mockDb = {
  pragma: vi.fn(),
  exec: vi.fn(),
  prepare: vi.fn(),
  close: vi.fn(),
};

const mockStatement = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
};

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => mockDb),
  };
});

// Create mock logger
const createMockLogger = (): WinstonLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as any;

describe('UrlTracker', () => {
  let mockLogger: WinstonLogger;
  let urlTracker: UrlTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();

    // Setup mock to return statement
    mockDb.prepare.mockReturnValue(mockStatement);

    // Mock fs.existsSync and fs.mkdirSync
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => '');
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockReturnValue('[]');

    urlTracker = new UrlTracker(mockLogger);
  });

  afterEach(() => {
    closeUrlTracker();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default config', () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('data'),
        { recursive: true }
      );
      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE')
      );
      expect(mockDb.prepare).toHaveBeenCalledTimes(4); // 4 prepared statements
    });

    it('should initialize with custom config', () => {
      const config: UrlTrackerConfig = {
        dbPath: '/custom/path/test.db',
        maxRetries: 5,
        debug: true,
      };

      const customTracker = new UrlTracker(mockLogger, config);

      expect(fs.mkdirSync).toHaveBeenCalledWith('/custom/path', {
        recursive: true,
      });
    });
  });

  describe('URL Processing Status Tracking', () => {
    beforeEach(() => {
      // Setup mock responses for different scenarios
      mockStatement.get.mockReturnValue(null); // No existing record by default
      mockStatement.run.mockReturnValue({ changes: 1 });
    });

    it('should check if URL is processed (not found)', () => {
      mockStatement.get.mockReturnValue(null);

      const result = urlTracker.isUrlProcessed('https://example.com');

      expect(result).toBe(false);
      expect(mockStatement.get).toHaveBeenCalledWith('https://example.com');
    });

    it('should check if URL is processed (found with success status)', () => {
      mockStatement.get.mockReturnValue({ url: 'https://example.com' });

      const result = urlTracker.isUrlProcessed('https://example.com');

      expect(result).toBe(true);
    });

    it('should mark URL as processed with success status', () => {
      urlTracker.markUrlProcessed('https://example.com', 'success');

      expect(mockStatement.run).toHaveBeenCalledWith(
        'https://example.com',
        'success',
        expect.any(String), // timestamp
        null, // no error code
        0 // retry count
      );
    });

    it('should mark URL as processed with error status', () => {
      urlTracker.markUrlProcessed('https://example.com', 'error', 'TIMEOUT');

      expect(mockStatement.run).toHaveBeenCalledWith(
        'https://example.com',
        'error',
        expect.any(String),
        'TIMEOUT',
        0
      );
    });

    it('should increment retry count for retry status', () => {
      // Mock existing record with retry count 1
      mockStatement.get.mockReturnValue({
        url: 'https://example.com',
        retryCount: 1,
      });

      urlTracker.markUrlProcessed('https://example.com', 'retry', 'TIMEOUT');

      expect(mockStatement.run).toHaveBeenCalledWith(
        'https://example.com',
        'retry',
        expect.any(String),
        'TIMEOUT',
        2 // incremented retry count
      );
    });
  });

  describe('URL Filtering', () => {
    it('should filter out processed URLs', () => {
      const urls = [
        'https://example.com',
        'https://test.com',
        'https://new.com',
      ];

      // Mock that first two URLs are processed
      mockStatement.get
        .mockReturnValueOnce({ url: 'https://example.com' }) // processed
        .mockReturnValueOnce({ url: 'https://test.com' }) // processed
        .mockReturnValueOnce(null); // not processed

      const result = urlTracker.filterUnprocessedUrls(urls);

      expect(result).toEqual(['https://new.com']);
      expect(mockStatement.get).toHaveBeenCalledTimes(3);
    });

    it('should return empty array when all URLs are processed', () => {
      const urls = ['https://example.com', 'https://test.com'];

      mockStatement.get.mockReturnValue({ url: 'mock' });

      const result = urlTracker.filterUnprocessedUrls(urls);

      expect(result).toEqual([]);
    });

    it('should return all URLs when none are processed', () => {
      const urls = ['https://example.com', 'https://test.com'];

      mockStatement.get.mockReturnValue(null);

      const result = urlTracker.filterUnprocessedUrls(urls);

      expect(result).toEqual(urls);
    });

    it('should handle empty URL list', () => {
      const result = urlTracker.filterUnprocessedUrls([]);

      expect(result).toEqual([]);
      expect(mockStatement.get).not.toHaveBeenCalled();
    });
  });

  describe('Task Results Processing', () => {
    it('should update tracking from successful task results', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'success',
          data: {
            url: 'https://example.com',
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: [],
          },
        } as TaskResultSuccess,
        {
          type: 'no_data',
          url: 'https://test.com',
        } as TaskResultNoData,
        {
          type: 'error',
          url: 'https://error.com',
          error: {
            code: 'TIMEOUT',
            message: 'Request timeout',
          },
        } as TaskResultError,
      ];

      // Mock that error URL should be retried
      mockStatement.get.mockReturnValue({ retryCount: 0 });

      urlTracker.updateFromTaskResults(taskResults);

      // Should have called markUrlProcessed for each result
      expect(mockStatement.run).toHaveBeenCalledTimes(3);
      expect(mockStatement.run).toHaveBeenNthCalledWith(
        1,
        'https://example.com',
        'success',
        expect.any(String),
        null,
        0
      );
      expect(mockStatement.run).toHaveBeenNthCalledWith(
        2,
        'https://test.com',
        'no_data',
        expect.any(String),
        null,
        0
      );
      expect(mockStatement.run).toHaveBeenNthCalledWith(
        3,
        'https://error.com',
        'retry',
        expect.any(String),
        'TIMEOUT',
        1
      );
    });

    it('should handle task results with optional URL field', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'success',
          data: {
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: [],
            // url is optional and missing
          },
        } as TaskResultSuccess,
      ];

      urlTracker.updateFromTaskResults(taskResults);

      // Should not call markUrlProcessed since URL is missing
      expect(mockStatement.run).not.toHaveBeenCalled();
    });

    it('should not retry permanent errors', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'error',
          url: 'https://error.com',
          error: {
            code: 'ERR_NAME_NOT_RESOLVED',
            message: 'DNS resolution failed',
          },
        } as TaskResultError,
      ];

      urlTracker.updateFromTaskResults(taskResults);

      expect(mockStatement.run).toHaveBeenCalledWith(
        'https://error.com',
        'error',
        expect.any(String),
        'ERR_NAME_NOT_RESOLVED',
        0
      );
    });

    it('should not retry after max retries exceeded', () => {
      const taskResults: TaskResult[] = [
        {
          type: 'error',
          url: 'https://error.com',
          error: {
            code: 'TIMEOUT',
            message: 'Request timeout',
          },
        } as TaskResultError,
      ];

      // Mock existing record with max retries reached
      mockStatement.get.mockReturnValue({ retryCount: 3 });

      urlTracker.updateFromTaskResults(taskResults);

      expect(mockStatement.run).toHaveBeenCalledWith(
        'https://error.com',
        'error',
        expect.any(String),
        'TIMEOUT',
        3
      );
    });
  });

  describe('Statistics and Retry Management', () => {
    it('should get processing statistics', () => {
      const mockStats = [
        { status: 'success', count: 100 },
        { status: 'no_data', count: 20 },
        { status: 'error', count: 5 },
      ];

      mockStatement.all.mockReturnValue(mockStats);

      const stats = urlTracker.getStats();

      expect(stats).toEqual({
        success: 100,
        no_data: 20,
        error: 5,
      });
    });

    it('should get URLs for retry', () => {
      const mockRetryUrls = [
        { url: 'https://retry1.com' },
        { url: 'https://retry2.com' },
      ];

      mockStatement.all.mockReturnValue(mockRetryUrls);

      const retryUrls = urlTracker.getUrlsForRetry(10);

      expect(retryUrls).toEqual(['https://retry1.com', 'https://retry2.com']);
      expect(mockStatement.all).toHaveBeenCalledWith(3, 10); // maxRetries=3, limit=10
    });

    it('should handle empty retry list', () => {
      mockStatement.all.mockReturnValue([]);

      const retryUrls = urlTracker.getUrlsForRetry();

      expect(retryUrls).toEqual([]);
    });
  });

  describe('Database Management', () => {
    it('should reset tracking data', () => {
      urlTracker.resetTracking();

      expect(mockDb.exec).toHaveBeenCalledWith('DELETE FROM processed_urls');
    });

    it('should close database connection', () => {
      urlTracker.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe('Import Existing Results', () => {
    it('should import URLs from JSON files', async () => {
      const mockFileContent = JSON.stringify([
        { url: 'https://imported1.com', libraries: [] },
        { url: 'https://imported2.com', libraries: [] },
      ]);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        {
          name: 'results.json',
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue(mockFileContent);

      await urlTracker.importExistingResults('/test/store');

      expect(mockStatement.run).toHaveBeenCalledTimes(2);
      expect(mockStatement.run).toHaveBeenNthCalledWith(
        1,
        'https://imported1.com',
        'success',
        expect.any(String),
        null,
        0
      );
      expect(mockStatement.run).toHaveBeenNthCalledWith(
        2,
        'https://imported2.com',
        'success',
        expect.any(String),
        null,
        0
      );
    });

    it('should handle non-existent store directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await urlTracker.importExistingResults('/nonexistent/store');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Store directory does not exist')
      );
      expect(mockStatement.run).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON files gracefully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        {
          name: 'bad.json',
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      await urlTracker.importExistingResults('/test/store');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error importing file'),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully in isUrlProcessed', () => {
      mockStatement.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = urlTracker.isUrlProcessed('https://example.com');

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error checking URL processing status'),
        expect.any(Object)
      );
    });

    it('should handle database errors gracefully in markUrlProcessed', () => {
      mockStatement.run.mockImplementation(() => {
        throw new Error('Database error');
      });

      expect(() => {
        urlTracker.markUrlProcessed('https://example.com', 'success');
      }).not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error marking URL as processed'),
        expect.any(Object)
      );
    });

    it('should handle database errors in filterUnprocessedUrls', () => {
      mockStatement.get.mockImplementation(() => {
        throw new Error('Database error');
      });

      const urls = ['https://example.com'];
      const result = urlTracker.filterUnprocessedUrls(urls);

      // Should return all URLs if filtering fails
      expect(result).toEqual(urls);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error filtering unprocessed URLs'),
        expect.any(Object)
      );
    });
  });
});

describe('Global UrlTracker Management', () => {
  let mockLogger: WinstonLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeUrlTracker();
  });

  it('should create singleton instance', () => {
    const tracker1 = getUrlTracker(mockLogger);
    const tracker2 = getUrlTracker(mockLogger);

    expect(tracker1).toBe(tracker2);
  });

  it('should close singleton instance', () => {
    const tracker = getUrlTracker(mockLogger);
    const closeSpy = vi.spyOn(tracker, 'close');

    closeUrlTracker();

    expect(closeSpy).toHaveBeenCalled();
  });

  it('should create new instance after close', () => {
    const tracker1 = getUrlTracker(mockLogger);
    closeUrlTracker();
    const tracker2 = getUrlTracker(mockLogger);

    expect(tracker1).not.toBe(tracker2);
  });
});
