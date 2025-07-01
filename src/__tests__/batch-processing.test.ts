import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prebidExplorer, type PrebidExplorerOptions } from '../prebid.js';
import type { TaskResult, TaskResultSuccess } from '../common/types.js';
import type { Logger as WinstonLogger } from 'winston';
import * as fs from 'fs';

// Mock all dependencies
vi.mock('fs');
vi.mock('../utils/logger.js', () => ({
  initializeLogger: vi.fn(() => createMockLogger()),
  default: {
    instance: createMockLogger(),
  },
}));

vi.mock('../utils/url-tracker.js', () => ({
  getUrlTracker: vi.fn(() => mockUrlTracker),
  closeUrlTracker: vi.fn(),
}));

vi.mock('../utils/url-loader.js', () => ({
  loadFileContents: vi.fn(),
  processFileContent: vi.fn(),
  fetchUrlsFromGitHub: vi.fn(),
}));

vi.mock('../utils/domain-validator.js', () => ({
  filterValidUrls: vi.fn((urls) => urls),
}));

vi.mock('../utils/results-handler.js', () => ({
  processAndLogTaskResults: vi.fn((results) => {
    // Transform TaskResult[] to PageData[]
    return results.filter((r) => r.type === 'success').map((r) => r.data);
  }),
  writeResultsToStoreFile: vi.fn(),
  appendNoPrebidUrls: vi.fn(),
  appendErrorUrls: vi.fn(),
  updateInputFile: vi.fn(),
  createErrorFileHeaders: vi.fn(),
}));

vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn(() => mockBrowser),
  },
}));

vi.mock('puppeteer-cluster', () => ({
  Cluster: {
    launch: vi.fn(() => mockCluster),
    CONCURRENCY_CONTEXT: 'CONCURRENCY_CONTEXT',
  },
}));

vi.mock('puppeteer-extra', () => ({
  addExtra: vi.fn((pup) => pup),
}));

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));

vi.mock('puppeteer-extra-plugin-block-resources', () => ({
  default: vi.fn(() => ({})),
  __esModule: true,
}));

// Mock logger
function createMockLogger(): WinstonLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

// Mock URL tracker
const mockUrlTracker = {
  resetTracking: vi.fn(),
  importExistingResults: vi.fn(),
  getStats: vi.fn(() => ({})),
  filterUnprocessedUrls: vi.fn((urls) => urls),
  updateFromTaskResults: vi.fn(),
  isUrlProcessed: vi.fn(() => false),
  markUrlProcessed: vi.fn(),
  getUrlsForRetry: vi.fn(() => []),
  close: vi.fn(),
};

// Mock browser and page
const mockPage = {
  goto: vi.fn(),
  close: vi.fn(),
  setDefaultTimeout: vi.fn(),
  setUserAgent: vi.fn(),
  setViewport: vi.fn(),
  evaluateOnNewDocument: vi.fn(),
  evaluate: vi.fn(),
  title: vi.fn().mockResolvedValue('Test Page'),
  url: vi.fn().mockReturnValue('https://example.com'),
  $: vi.fn(),
};

const mockBrowser = {
  newPage: vi.fn(() => mockPage),
  close: vi.fn(),
};

// Mock cluster
const mockCluster = {
  task: vi.fn(),
  queue: vi.fn(),
  idle: vi.fn(),
  close: vi.fn(),
  isClosed: vi.fn(() => false),
};

describe('Batch Processing Tests', () => {
  let mockLogger: WinstonLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();

    // Mock fs operations
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => '');

    // Reset all mock implementations
    mockUrlTracker.getStats.mockReturnValue({});
    mockUrlTracker.filterUnprocessedUrls.mockImplementation((urls) => urls);

    // Mock successful page processing by default
    mockPage.goto.mockResolvedValue(null as any);
    mockPage.evaluate.mockResolvedValue({
      libraries: ['googletag'],
      date: '2023-10-27',
      prebidInstances: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Small Batch Processing with Vanilla Puppeteer', () => {
    it('should process 3 URLs in chunks of 2 (2 batches)', async () => {
      const testUrls = [
        'https://batch1-url1.com',
        'https://batch1-url2.com',
        'https://batch2-url1.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 2,
      };

      // Track which URLs were processed in which order
      const processedUrls: string[] = [];
      let browserCreateCount = 0;
      let browserCloseCount = 0;

      mockBrowser.newPage.mockImplementation(() => {
        return mockPage;
      });

      mockPage.goto.mockImplementation((url: string) => {
        processedUrls.push(url);
        return Promise.resolve(null);
      });

      // Mock browser lifecycle
      const puppeteer = await import('puppeteer');
      vi.mocked(puppeteer.default.launch).mockImplementation(() => {
        browserCreateCount++;
        return Promise.resolve(mockBrowser);
      });

      mockBrowser.close.mockImplementation(() => {
        browserCloseCount++;
        return Promise.resolve();
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify batch processing occurred
      expect(browserCreateCount).toBe(2); // One browser per chunk
      expect(browserCloseCount).toBe(2);

      // Verify all URLs were processed
      expect(processedUrls).toHaveLength(3);
      expect(processedUrls.sort()).toEqual(testUrls.sort());

      // Verify batch-specific logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Chunked processing enabled. Chunk size: 2'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Total chunks to process: 2'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing chunk 1 of 2: URLs 1-2'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing chunk 2 of 2: URLs 3-3'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Finished processing chunk 1 of 2.'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Finished processing chunk 2 of 2.'
      );

      // Verify results were collected from all batches
      expect(totalResults).toHaveLength(3);
    });

    it('should process 5 URLs in chunks of 2 (3 batches)', async () => {
      const testUrls = [
        'https://batch1-url1.com',
        'https://batch1-url2.com',
        'https://batch2-url1.com',
        'https://batch2-url2.com',
        'https://batch3-url1.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 2,
      };

      let browserCreateCount = 0;
      const puppeteer = await import('puppeteer');
      vi.mocked(puppeteer.default.launch).mockImplementation(() => {
        browserCreateCount++;
        return Promise.resolve(mockBrowser);
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify batch processing occurred correctly
      expect(browserCreateCount).toBe(3); // Three chunks: 2+2+1

      // Verify chunk logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Total chunks to process: 3'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing chunk 1 of 3: URLs 1-2'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing chunk 2 of 3: URLs 3-4'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing chunk 3 of 3: URLs 5-5'
      );

      // Verify all results collected
      expect(totalResults).toHaveLength(5);
    });
  });

  describe('Small Batch Processing with Cluster Mode', () => {
    it('should process 4 URLs in chunks of 2 using cluster', async () => {
      const testUrls = [
        'https://cluster-batch1-url1.com',
        'https://cluster-batch1-url2.com',
        'https://cluster-batch2-url1.com',
        'https://cluster-batch2-url2.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'cluster',
        concurrency: 2,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 2,
      };

      let clusterCreateCount = 0;
      let clusterCloseCount = 0;
      let totalQueuedTasks: Array<{ url: string; logger: WinstonLogger }> = [];

      const { Cluster } = await import('puppeteer-cluster');
      vi.mocked(Cluster.launch).mockImplementation(() => {
        clusterCreateCount++;
        return Promise.resolve(mockCluster);
      });

      mockCluster.close.mockImplementation(() => {
        clusterCloseCount++;
        return Promise.resolve();
      });

      mockCluster.queue.mockImplementation(
        (data: { url: string; logger: WinstonLogger }) => {
          totalQueuedTasks.push(data);
          return Promise.resolve({
            type: 'success',
            data: {
              url: data.url,
              libraries: ['googletag'],
              date: '2023-10-27',
              prebidInstances: [],
            },
          } as TaskResult);
        }
      );

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify cluster processing occurred
      expect(clusterCreateCount).toBe(2); // One cluster per chunk
      expect(clusterCloseCount).toBe(2);

      // Verify all URLs were queued
      expect(totalQueuedTasks).toHaveLength(4);
      const queuedUrls = totalQueuedTasks.map((task) => task.url);
      expect(queuedUrls.sort()).toEqual(testUrls.sort());

      // Verify results collected from all chunks
      expect(totalResults).toHaveLength(4);

      // Verify cluster operations
      expect(mockCluster.task).toHaveBeenCalledTimes(2); // Once per chunk
      expect(mockCluster.idle).toHaveBeenCalledTimes(2);
    });

    it('should handle cluster errors gracefully in batch mode', async () => {
      const testUrls = [
        'https://good-cluster-batch.com',
        'https://error-cluster-batch.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'cluster',
        concurrency: 2,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 1, // One URL per chunk
      };

      let chunkNumber = 0;
      mockCluster.queue.mockImplementation(
        (data: { url: string; logger: WinstonLogger }) => {
          if (data.url === 'https://error-cluster-batch.com') {
            return Promise.reject(new Error('Cluster processing failed'));
          }
          return Promise.resolve({
            type: 'success',
            data: {
              url: data.url,
              libraries: ['googletag'],
              date: '2023-10-27',
              prebidInstances: [],
            },
          } as TaskResult);
        }
      );

      // Mock cluster error for second chunk
      const { Cluster } = await import('puppeteer-cluster');
      vi.mocked(Cluster.launch).mockImplementation(() => {
        chunkNumber++;
        if (chunkNumber === 2) {
          // Simulate cluster launch failure for second chunk
          mockCluster.queue.mockRejectedValue(
            new Error('Cluster launch failed')
          );
        }
        return Promise.resolve(mockCluster);
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify error handling
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('An error occurred during processing chunk'),
        expect.any(Object)
      );

      // Should still have processed the successful chunk
      expect(totalResults.length).toBeGreaterThan(0);
    });
  });

  describe('Batch Processing with Mixed Results', () => {
    it('should handle varying result types across batches', async () => {
      const testUrls = [
        'https://success-batch.com',
        'https://no-data-batch.com',
        'https://error-batch.com',
        'https://success-batch2.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 2,
      };

      // Mock different outcomes for different URLs
      mockPage.goto.mockImplementation((url: string) => {
        if (url === 'https://error-batch.com') {
          return Promise.reject(new Error('Navigation failed'));
        }
        return Promise.resolve(null);
      });

      mockPage.evaluate.mockImplementation(() => {
        const url = mockPage.url();
        if (url === 'https://no-data-batch.com') {
          return Promise.resolve({
            libraries: [],
            date: '2023-10-27',
            prebidInstances: [],
          });
        }
        return Promise.resolve({
          libraries: ['googletag'],
          date: '2023-10-27',
          prebidInstances: [],
        });
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);

        // Count result types (unused variables removed)
        // These counts were calculated but not used in the test
        // If needed for future assertions, uncomment:
        // const successCount = results.filter((r) => r.type === 'success').length;
        // const noDataCount = results.filter((r) => r.type === 'no_data').length;
        // const errorCount = results.filter((r) => r.type === 'error').length;

        return results.filter((r) => r.type === 'success');
      });

      await prebidExplorer(options);

      // Verify all results were collected
      expect(totalResults).toHaveLength(4);

      // Verify result distribution
      const successResults = totalResults.filter((r) => r.type === 'success');
      const noDataResults = totalResults.filter((r) => r.type === 'no_data');
      const errorResults = totalResults.filter((r) => r.type === 'error');

      expect(successResults).toHaveLength(2); // success-batch.com, success-batch2.com
      expect(noDataResults).toHaveLength(1); // no-data-batch.com
      expect(errorResults).toHaveLength(1); // error-batch.com
    });
  });

  describe('Batch Processing with URL Filtering', () => {
    it('should apply URL filtering per batch correctly', async () => {
      const testUrls = Array.from(
        { length: 6 },
        (_, i) => `https://batch-filter${i + 1}.com`
      );

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 3,
        skipProcessed: true,
      };

      // Mock URL tracker to filter different URLs
      mockUrlTracker.filterUnprocessedUrls.mockImplementation(
        (urls: string[]) => {
          // Remove every other URL to simulate some being processed
          return urls.filter((_, index) => index % 2 === 0);
        }
      );

      const processedUrls: string[] = [];
      mockPage.goto.mockImplementation((url: string) => {
        processedUrls.push(url);
        return Promise.resolve(null);
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify only unprocessed URLs were attempted
      expect(processedUrls).toHaveLength(3); // Every other URL: 1, 3, 5
      expect(processedUrls).toEqual([
        'https://batch-filter1.com',
        'https://batch-filter3.com',
        'https://batch-filter5.com',
      ]);

      // Verify URL tracker was called for filtering
      expect(mockUrlTracker.filterUnprocessedUrls).toHaveBeenCalledWith(
        testUrls
      );
    });
  });

  describe('Batch Processing Edge Cases', () => {
    it('should handle single URL in chunk correctly', async () => {
      const testUrls = ['https://single-batch-url.com'];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 5, // Chunk size larger than URL count
      };

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Should process as single chunk
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Total chunks to process: 1'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing chunk 1 of 1: URLs 1-1'
      );
      expect(totalResults).toHaveLength(1);
    });

    it('should handle empty chunks gracefully', async () => {
      const testUrls: string[] = [];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 3,
      };

      await prebidExplorer(options);

      // Should exit early without processing
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No URLs to process')
      );
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should disable chunking when chunkSize is 0', async () => {
      const testUrls = [
        'https://no-chunk1.com',
        'https://no-chunk2.com',
        'https://no-chunk3.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        chunkSize: 0, // Disable chunking
      };

      let browserCreateCount = 0;
      const puppeteer = await import('puppeteer');
      vi.mocked(puppeteer.default.launch).mockImplementation(() => {
        browserCreateCount++;
        return Promise.resolve(mockBrowser);
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Should use single browser instance (no chunking)
      expect(browserCreateCount).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Processing all 3 URLs without chunking.'
      );
      expect(totalResults).toHaveLength(3);
    });
  });
});
