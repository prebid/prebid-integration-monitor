import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prebidExplorer, type PrebidExplorerOptions } from '../prebid.js';
import type { TaskResult, TaskResultSuccess, TaskResultNoData, TaskResultError } from '../common/types.js';
import type { Logger as WinstonLogger } from 'winston';
import * as fs from 'fs';

// Mock all dependencies
vi.mock('fs');
vi.mock('../utils/logger.js', () => ({
  initializeLogger: vi.fn(() => createMockLogger()),
  default: {
    instance: createMockLogger()
  }
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
    return results
      .filter(r => r.type === 'success')
      .map(r => r.data);
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
  }
}));

vi.mock('puppeteer-cluster', () => ({
  Cluster: {
    launch: vi.fn(() => mockCluster),
    CONCURRENCY_CONTEXT: 'CONCURRENCY_CONTEXT'
  }
}));

vi.mock('puppeteer-extra', () => ({
  addExtra: vi.fn((pup) => pup)
}));

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({}))
}));

vi.mock('puppeteer-extra-plugin-block-resources', () => ({
  default: vi.fn(() => ({})),
  __esModule: true
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
  url: vi.fn(),
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

describe('Progress Tracking and Statistics Tests', () => {
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
      prebidInstances: []
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Comprehensive Statistics Logging', () => {
    it('should log accurate scan summary with all statistics', async () => {
      const testUrls = Array.from({ length: 20 }, (_, i) => `https://stats-test${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
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
        skipProcessed: true,
        range: '5-15' // Process URLs 5-15 (11 URLs)
      };

      // Mock URL tracker filtering (simulate 3 already processed)
      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(
        testUrls.slice(4, 15).filter((_, i) => i % 3 !== 0) // Remove every 3rd URL
      );

      // Mock varying processing results
      let processCount = 0;
      mockPage.goto.mockImplementation((url: string) => {
        processCount++;
        mockPage.url.mockReturnValue(url);
        
        // Simulate some errors
        if (processCount === 3 || processCount === 7) {
          return Promise.reject(new Error('Navigation failed'));
        }
        return Promise.resolve(null);
      });

      mockPage.evaluate.mockImplementation(() => {
        const url = mockPage.url();
        // Simulate some no-data results
        if (url.includes('stats-test8') || url.includes('stats-test12')) {
          return Promise.resolve({
            libraries: [],
            date: '2023-10-27',
            prebidInstances: []
          });
        }
        return Promise.resolve({
          libraries: ['googletag'],
          date: '2023-10-27',
          prebidInstances: []
        });
      });

      // Mock final database statistics
      mockUrlTracker.getStats.mockReturnValue({
        success: 1500,
        no_data: 300,
        error: 200
      });

      // Mock output file existence check
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('2023-10-27.json'); // Simulate output file exists
      });

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      let capturedResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        capturedResults = [...results];
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify comprehensive scan summary logging
      expect(mockLogger.info).toHaveBeenCalledWith('SCAN SUMMARY');
      expect(mockLogger.info).toHaveBeenCalledWith('========================================');
      
      // Verify range information
      expect(mockLogger.info).toHaveBeenCalledWith('📋 URL range processed: 5-15');
      
      // Verify URL counts
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/📊 Total URLs in range: \d+/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/🔄 URLs actually processed: \d+/)
      );
      
      // Verify skip processed information
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/⏭️  URLs skipped \(already processed\): \d+/)
      );
      
      // Verify result statistics
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/🎯 Successful data extractions: \d+/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/⚠️  Errors encountered: \d+/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/🚫 No ad tech found: \d+/)
      );
      
      // Verify output file information
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/📁 Output file created: store\/Jun-2025\/\d{4}-\d{2}-\d{2}\.json/)
      );
      
      // Verify database statistics
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/💾 Database total: 2,000 processed URLs/)
      );
      
      // Verify guidance section
      expect(mockLogger.info).toHaveBeenCalledWith('🔧 Options for next run:');
      expect(mockLogger.info).toHaveBeenCalledWith('   • Continue with next range: --range "1001-2000"');
      expect(mockLogger.info).toHaveBeenCalledWith('   • Reprocess this range: --resetTracking');
      expect(mockLogger.info).toHaveBeenCalledWith('   • Process without deduplication: remove --skipProcessed');
    });

    it('should provide helpful guidance when no data is extracted', async () => {
      const testUrls = Array.from({ length: 5 }, (_, i) => `https://no-data-test${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
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
        skipProcessed: true
      };

      // Mock scenarios where no data is extracted
      mockUrlTracker.filterUnprocessedUrls.mockReturnValue([
        'https://no-data-test3.com',
        'https://no-data-test5.com'
      ]); // 3 URLs already processed

      // Mock all remaining URLs having issues
      mockPage.goto.mockImplementation((url: string) => {
        mockPage.url.mockReturnValue(url);
        if (url.includes('test3')) {
          return Promise.reject(new Error('Navigation failed'));
        }
        return Promise.resolve(null);
      });

      mockPage.evaluate.mockResolvedValue({
        libraries: [],
        date: '2023-10-27',
        prebidInstances: []
      });

      // Mock no output file created
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        return []; // No successful extractions
      });

      await prebidExplorer(options);

      // Verify guidance for no data scenario
      expect(mockLogger.info).toHaveBeenCalledWith('💡 No data was extracted because:');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/• \d+ URLs were already processed \(use --resetTracking to reprocess\)/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/• \d+ URLs had no ad technology detected/)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/• \d+ URLs encountered errors during processing/)
      );
      
      expect(mockLogger.info).toHaveBeenCalledWith('📁 No output file created (no successful extractions)');
    });
  });

  describe('Progress Tracking During Processing', () => {
    it('should track progress accurately in chunk processing mode', async () => {
      const testUrls = Array.from({ length: 8 }, (_, i) => `https://chunk-progress${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
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
        chunkSize: 3
      };

      const processedUrls: string[] = [];
      mockPage.goto.mockImplementation((url: string) => {
        processedUrls.push(url);
        mockPage.url.mockReturnValue(url);
        return Promise.resolve(null);
      });

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      let totalResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        totalResults.push(...results);
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify chunk progress logging
      expect(mockLogger.info).toHaveBeenCalledWith('Chunked processing enabled. Chunk size: 3');
      expect(mockLogger.info).toHaveBeenCalledWith('Total chunks to process: 3');
      
      // Verify individual chunk processing
      expect(mockLogger.info).toHaveBeenCalledWith('Processing chunk 1 of 3: URLs 1-3');
      expect(mockLogger.info).toHaveBeenCalledWith('Processing chunk 2 of 3: URLs 4-6');
      expect(mockLogger.info).toHaveBeenCalledWith('Processing chunk 3 of 3: URLs 7-8');
      
      expect(mockLogger.info).toHaveBeenCalledWith('Finished processing chunk 1 of 3.');
      expect(mockLogger.info).toHaveBeenCalledWith('Finished processing chunk 2 of 3.');
      expect(mockLogger.info).toHaveBeenCalledWith('Finished processing chunk 3 of 3.');
    });

    it('should track cluster queue and idle operations', async () => {
      const testUrls = Array.from({ length: 6 }, (_, i) => `https://cluster-progress${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'cluster',
        concurrency: 3,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt'
      };

      let queuedCount = 0;
      mockCluster.queue.mockImplementation((data: { url: string; logger: WinstonLogger }) => {
        queuedCount++;
        
        return Promise.resolve({
          type: 'success',
          data: {
            url: data.url,
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: []
          }
        } as TaskResult);
      });

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify all URLs were queued
      expect(queuedCount).toBe(6);
      
      // Verify cluster lifecycle
      expect(mockCluster.task).toHaveBeenCalledTimes(1);
      expect(mockCluster.idle).toHaveBeenCalledTimes(1);
      expect(mockCluster.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL Range and Filtering Statistics', () => {
    it('should accurately track URL counts through filtering pipeline', async () => {
      const originalUrls = Array.from({ length: 50 }, (_, i) => `https://pipeline-test${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(originalUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
        range: '10-30', // 21 URLs
        skipProcessed: true
      };

      // Mock domain filtering (removes 3 URLs)
      const { filterValidUrls } = await import('../utils/domain-validator.js');
      const rangeUrls = originalUrls.slice(9, 30); // URLs 10-30
      const domainFilteredUrls = rangeUrls.filter((_, i) => i % 7 !== 0); // Remove every 7th
      vi.mocked(filterValidUrls).mockResolvedValue(domainFilteredUrls);

      // Mock URL tracker filtering (removes 5 more URLs)
      const finalUrls = domainFilteredUrls.filter((_, i) => i % 4 !== 0); // Remove every 4th
      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(finalUrls);

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        expect(results).toHaveLength(finalUrls.length);
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify filtering pipeline logging
      expect(mockLogger.info).toHaveBeenCalledWith('Applying range: 10-30');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Applied range: Processing URLs from 10 to 30/)
      );
      
      expect(mockLogger.info).toHaveBeenCalledWith('Pre-filtering URLs for domain validity...');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Domain pre-filtering complete: \d+ total, \d+ valid, \d+ filtered out/)
      );
      
      expect(mockLogger.info).toHaveBeenCalledWith('Filtering out previously processed URLs...');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/URL filtering complete: \d+ total, \d+ unprocessed, \d+ skipped/)
      );
    });

    it('should handle edge case where all URLs are filtered out', async () => {
      const testUrls = Array.from({ length: 10 }, (_, i) => `https://filtered-out${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
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
        skipProcessed: true
      };

      // Mock all URLs being filtered out
      mockUrlTracker.filterUnprocessedUrls.mockReturnValue([]);

      await prebidExplorer(options);

      // Verify early exit logging
      expect(mockLogger.info).toHaveBeenCalledWith('All URLs have been previously processed. Exiting.');
      
      // Verify no processing occurred
      expect(mockPage.goto).not.toHaveBeenCalled();
    });
  });

  describe('Database Statistics Integration', () => {
    it('should update URL tracker and log database statistics', async () => {
      const testUrls = Array.from({ length: 12 }, (_, i) => `https://db-stats${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
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
        skipProcessed: true
      };

      // Mock varying processing results
      let processCount = 0;
      mockPage.goto.mockImplementation((url: string) => {
        processCount++;
        mockPage.url.mockReturnValue(url);
        
        if (processCount <= 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(null);
      });

      mockPage.evaluate.mockImplementation(() => {
        const url = mockPage.url();
        if (url.includes('db-stats7') || url.includes('db-stats8')) {
          return Promise.resolve({
            libraries: [],
            date: '2023-10-27',
            prebidInstances: []
          });
        }
        return Promise.resolve({
          libraries: ['googletag'],
          date: '2023-10-27',
          prebidInstances: []
        });
      });

      // Mock initial and final database stats
      mockUrlTracker.getStats
        .mockReturnValueOnce({ success: 100, no_data: 20, error: 10 }) // Initial
        .mockReturnValueOnce({ success: 107, no_data: 22, error: 13 }); // Final

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      let capturedResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        capturedResults = [...results];
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify URL tracker integration
      expect(mockUrlTracker.updateFromTaskResults).toHaveBeenCalledWith(capturedResults);
      expect(mockLogger.info).toHaveBeenCalledWith('Updated URL tracking database with scan results');
      
      // Verify initial stats logging
      expect(mockLogger.info).toHaveBeenCalledWith('URL tracker statistics:', { success: 100, no_data: 20, error: 10 });
      
      // Verify final database statistics
      expect(mockLogger.info).toHaveBeenCalledWith('💾 Database total: 142 processed URLs');
    });

    it('should handle database import and reset operations', async () => {
      const testUrls = ['https://db-ops-test.com'];
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
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
        skipProcessed: true,
        resetTracking: true
      };

      // Mock empty database initially
      mockUrlTracker.getStats
        .mockReturnValueOnce({}) // Empty stats trigger import
        .mockReturnValueOnce({ imported: 50 }); // After import

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify reset operation
      expect(mockLogger.info).toHaveBeenCalledWith('Resetting URL tracking database...');
      expect(mockUrlTracker.resetTracking).toHaveBeenCalled();
      
      // Verify import operation
      expect(mockLogger.info).toHaveBeenCalledWith('URL tracking database is empty. Importing existing results...');
      expect(mockUrlTracker.importExistingResults).toHaveBeenCalledWith(
        expect.stringContaining('store')
      );
    });
  });

  describe('Performance and Timing Statistics', () => {
    it('should track processing performance across different modes', async () => {
      const testUrls = Array.from({ length: 5 }, (_, i) => `https://perf-test${i + 1}.com`);
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt'
      };

      // Add artificial delay to simulate processing time
      mockPage.goto.mockImplementation(async (url: string) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        mockPage.url.mockReturnValue(url);
        return Promise.resolve(null);
      });

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      const startTime = Date.now();
      await prebidExplorer(options);
      const endTime = Date.now();

      // Verify processing occurred (timing validation)
      expect(endTime - startTime).toBeGreaterThan(200); // At least 5 * 50ms
      expect(mockPage.goto).toHaveBeenCalledTimes(5);
    });
  });

  describe('Result File Statistics', () => {
    it('should accurately report output file creation status', async () => {
      const testUrls = [
        'https://output-test1.com',
        'https://output-test2.com',
        'https://output-test3.com'
      ];
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt'
      };

      // Mock file existence check for output file
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        return path.includes('.json') && path.includes('store/Jun-2025/');
      });

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        return results
          .filter(r => r.type === 'success')
          .map(r => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify output file status reporting
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/📁 Output file created: store\/Jun-2025\/\d{4}-\d{2}-\d{2}\.json/)
      );
    });

    it('should report when no output file is created', async () => {
      const testUrls = ['https://no-output-test.com'];
      
      const { loadFileContents, processFileContent } = await import('../utils/url-loader.js');
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt'
      };

      // Mock no successful data extraction
      mockPage.evaluate.mockResolvedValue({
        libraries: [],
        date: '2023-10-27',
        prebidInstances: []
      });

      // Mock no output file created
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { processAndLogTaskResults } = await import('../utils/results-handler.js');
      const mockProcessResults = vi.mocked(processAndLogTaskResults);
      
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        return []; // No successful results
      });

      await prebidExplorer(options);

      expect(mockLogger.info).toHaveBeenCalledWith('📁 No output file created (no successful extractions)');
    });
  });
});