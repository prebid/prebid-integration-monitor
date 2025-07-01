import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prebidExplorer, type PrebidExplorerOptions } from '../prebid.js';
import type {
  TaskResult,
  TaskResultSuccess,
  TaskResultNoData,
  TaskResultError,
} from '../common/types.js';
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

describe('Error Scenario Tests', () => {
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

  describe('Mixed Valid/Invalid URLs - Vanilla Mode', () => {
    const baseOptions: PrebidExplorerOptions = {
      puppeteerType: 'vanilla',
      concurrency: 1,
      headless: true,
      monitor: false,
      outputDir: './output',
      logDir: './logs',
      inputFile: 'test-urls.txt',
    };

    it('should handle mix of valid URLs, DNS errors, and timeouts', async () => {
      const testUrls = [
        'https://valid-site1.com',
        'https://invalid-dns.nonexistent',
        'https://valid-site2.com',
        'https://timeout-site.com',
        'https://valid-site3.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      // Mock different error types
      mockPage.goto.mockImplementation((url: string) => {
        mockPage.url.mockReturnValue(url);

        if (url.includes('invalid-dns')) {
          return Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'));
        } else if (url.includes('timeout-site')) {
          const timeoutError = new Error(
            'Navigation timeout of 30000 ms exceeded'
          );
          timeoutError.name = 'TimeoutError';
          return Promise.reject(timeoutError);
        }
        return Promise.resolve(null);
      });

      // Mock successful data extraction for valid sites
      mockPage.evaluate.mockImplementation(() => {
        const url = mockPage.url();
        if (url.includes('valid-site')) {
          return Promise.resolve({
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: [],
          });
        }
        return Promise.resolve({
          libraries: [],
          date: '2023-10-27',
          prebidInstances: [],
        });
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let capturedResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        capturedResults = [...results];

        // Verify all URLs attempted
        expect(results).toHaveLength(5);

        // Check result distribution
        const successCount = results.filter((r) => r.type === 'success').length;
        const errorCount = results.filter((r) => r.type === 'error').length;

        expect(successCount).toBe(3); // valid-site1, valid-site2, valid-site3
        expect(errorCount).toBe(2); // invalid-dns, timeout-site

        // Verify error types
        const errorResults = results.filter(
          (r) => r.type === 'error'
        ) as TaskResultError[];
        const errorCodes = errorResults.map((e) => e.error.code);
        expect(errorCodes).toContain('ERR_NAME_NOT_RESOLVED');
        expect(errorCodes).toContain('PUPPETEER_TIMEOUT');

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(baseOptions);

      // Verify all URLs were attempted
      expect(mockPage.goto).toHaveBeenCalledTimes(5);
      expect(capturedResults).toHaveLength(5);

      // Verify error logging occurred
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing'),
        expect.objectContaining({
          url: expect.any(String),
          errorCode: expect.any(String),
        })
      );
    });

    it('should handle certificate errors and protocol errors', async () => {
      const testUrls = [
        'https://self-signed-cert.com',
        'https://protocol-error.com',
        'https://valid-site.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      mockPage.goto.mockImplementation((url: string) => {
        mockPage.url.mockReturnValue(url);

        if (url.includes('self-signed-cert')) {
          return Promise.reject(new Error('net::ERR_CERT_AUTHORITY_INVALID'));
        } else if (url.includes('protocol-error')) {
          return Promise.reject(
            new Error('Protocol error (Page.navigate): Target closed')
          );
        }
        return Promise.resolve(null);
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        expect(results).toHaveLength(3);

        const errorResults = results.filter(
          (r) => r.type === 'error'
        ) as TaskResultError[];
        expect(errorResults).toHaveLength(2);

        const errorCodes = errorResults.map((e) => e.error.code);
        expect(errorCodes).toContain('ERR_CERT_AUTHORITY_INVALID');
        expect(errorCodes).toContain('PROTOCOL_ERROR');

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(baseOptions);

      expect(mockPage.goto).toHaveBeenCalledTimes(3);
    });

    it('should handle JavaScript execution errors', async () => {
      const testUrls = [
        'https://js-error-site.com',
        'https://frame-detached.com',
        'https://valid-site.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      // Navigation succeeds but JS execution fails
      mockPage.goto.mockResolvedValue(null as any);

      mockPage.evaluate.mockImplementation(() => {
        const url = mockPage.url();
        if (url.includes('js-error-site')) {
          return Promise.reject(
            new Error('Evaluation failed: ReferenceError: pbjs is not defined')
          );
        } else if (url.includes('frame-detached')) {
          return Promise.reject(
            new Error(
              'Execution context was destroyed, most likely because of a detached Frame'
            )
          );
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

      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        expect(results).toHaveLength(3);

        const errorResults = results.filter(
          (r) => r.type === 'error'
        ) as TaskResultError[];
        expect(errorResults).toHaveLength(2);

        const errorCodes = errorResults.map((e) => e.error.code);
        expect(errorCodes).toContain('UNKNOWN_PROCESSING_ERROR'); // JS error
        expect(errorCodes).toContain('DETACHED_FRAME'); // Frame error

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(baseOptions);

      expect(mockPage.evaluate).toHaveBeenCalledTimes(3);
    });
  });

  describe('Mixed Valid/Invalid URLs - Cluster Mode', () => {
    const baseOptions: PrebidExplorerOptions = {
      puppeteerType: 'cluster',
      concurrency: 3,
      headless: true,
      monitor: false,
      outputDir: './output',
      logDir: './logs',
      inputFile: 'test-urls.txt',
    };

    it('should handle mixed results in cluster mode with proper Promise resolution', async () => {
      const testUrls = [
        'https://cluster-valid1.com',
        'https://cluster-error1.com',
        'https://cluster-valid2.com',
        'https://cluster-error2.com',
        'https://cluster-nodata.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      // Mock cluster queue responses
      mockCluster.queue.mockImplementation(
        (data: { url: string; logger: WinstonLogger }) => {
          const url = data.url;

          if (url.includes('cluster-error1')) {
            return Promise.resolve({
              type: 'error',
              url: url,
              error: {
                code: 'ERR_NAME_NOT_RESOLVED',
                message: 'DNS resolution failed',
              },
            } as TaskResultError);
          } else if (url.includes('cluster-error2')) {
            return Promise.resolve({
              type: 'error',
              url: url,
              error: {
                code: 'TIMEOUT',
                message: 'Navigation timeout',
              },
            } as TaskResultError);
          } else if (url.includes('cluster-nodata')) {
            return Promise.resolve({
              type: 'no_data',
              url: url,
            } as TaskResultNoData);
          } else {
            return Promise.resolve({
              type: 'success',
              data: {
                url: url,
                libraries: ['googletag'],
                date: '2023-10-27',
                prebidInstances: [],
              },
            } as TaskResultSuccess);
          }
        }
      );

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      let capturedResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        capturedResults = [...results];

        // Verify all promises resolved and results captured
        expect(results).toHaveLength(5);

        // Check result distribution
        const successCount = results.filter((r) => r.type === 'success').length;
        const errorCount = results.filter((r) => r.type === 'error').length;
        const noDataCount = results.filter((r) => r.type === 'no_data').length;

        expect(successCount).toBe(2); // cluster-valid1, cluster-valid2
        expect(errorCount).toBe(2); // cluster-error1, cluster-error2
        expect(noDataCount).toBe(1); // cluster-nodata

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(baseOptions);

      expect(mockCluster.queue).toHaveBeenCalledTimes(5);
      expect(capturedResults).toHaveLength(5);
    });

    it('should handle cluster queue rejections vs task result errors', async () => {
      const testUrls = [
        'https://queue-reject.com',
        'https://task-error.com',
        'https://valid-cluster.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      // Mock different types of failures
      mockCluster.queue.mockImplementation(
        (data: { url: string; logger: WinstonLogger }) => {
          const url = data.url;

          if (url.includes('queue-reject')) {
            // Promise rejection (cluster infrastructure error)
            return Promise.reject(new Error('Cluster internal error'));
          } else if (url.includes('task-error')) {
            // Task completes but returns error result
            return Promise.resolve({
              type: 'error',
              url: url,
              error: {
                code: 'PROCESSING_ERROR',
                message: 'Page processing failed',
              },
            } as TaskResultError);
          } else {
            return Promise.resolve({
              type: 'success',
              data: {
                url: url,
                libraries: ['googletag'],
                date: '2023-10-27',
                prebidInstances: [],
              },
            } as TaskResultSuccess);
          }
        }
      );

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        // Should only have results from resolved promises
        expect(results).toHaveLength(2); // task-error + valid-cluster

        const errorResult = results.find(
          (r) => r.type === 'error'
        ) as TaskResultError;
        expect(errorResult.error.code).toBe('PROCESSING_ERROR');

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(baseOptions);

      // Verify rejected promise was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('was rejected'),
        expect.objectContaining({
          reason: expect.any(Error),
        })
      );
    });
  });

  describe('Error Resilience and Recovery', () => {
    it('should continue processing after browser crashes in vanilla mode', async () => {
      const testUrls = [
        'https://before-crash.com',
        'https://crash-browser.com',
        'https://after-crash.com',
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
      };

      // Mock browser crash during second URL
      mockPage.goto.mockImplementation((url: string) => {
        mockPage.url.mockReturnValue(url);

        if (url.includes('crash-browser')) {
          throw new Error('Browser crashed unexpectedly');
        }
        return Promise.resolve(null);
      });

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        expect(results).toHaveLength(3);

        // Should have 2 success, 1 error
        const successCount = results.filter((r) => r.type === 'success').length;
        const errorCount = results.filter((r) => r.type === 'error').length;

        expect(successCount).toBe(2);
        expect(errorCount).toBe(1);

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      expect(mockPage.goto).toHaveBeenCalledTimes(3);
    });

    it('should handle partial chunk failures gracefully', async () => {
      const testUrls = [
        'https://chunk1-good.com',
        'https://chunk1-bad.com',
        'https://chunk2-good.com',
        'https://chunk2-bad.com',
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

      mockPage.goto.mockImplementation((url: string) => {
        mockPage.url.mockReturnValue(url);

        if (url.includes('-bad')) {
          return Promise.reject(new Error('Simulated failure'));
        }
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

      // All URLs should be attempted despite partial failures
      expect(totalResults).toHaveLength(4);
      expect(totalResults.filter((r) => r.type === 'success')).toHaveLength(2);
      expect(totalResults.filter((r) => r.type === 'error')).toHaveLength(2);
    });
  });

  describe('Domain Validation and Filtering', () => {
    it('should handle invalid domains filtered by domain validator', async () => {
      const testUrls = [
        'https://valid-domain.com',
        'invalid-url-format',
        'https://another-valid.com',
        'ftp://unsupported-protocol.com',
        'https://final-valid.com',
      ];

      const { loadFileContents, processFileContent } = await import(
        '../utils/url-loader.js'
      );
      vi.mocked(loadFileContents).mockReturnValue('file content');
      vi.mocked(processFileContent).mockResolvedValue(testUrls);

      // Mock domain validator to filter out invalid URLs
      const { filterValidUrls } = await import('../utils/domain-validator.js');
      vi.mocked(filterValidUrls).mockResolvedValue([
        'https://valid-domain.com',
        'https://another-valid.com',
        'https://final-valid.com',
      ]);

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: './output',
        logDir: './logs',
        inputFile: 'test-urls.txt',
      };

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        // Should only process valid URLs
        expect(results).toHaveLength(3);

        const resultUrls = results.map((r) =>
          r.type === 'success'
            ? r.data.url
            : r.type === 'no_data'
              ? r.url
              : r.url
        );
        expect(resultUrls).toEqual([
          'https://valid-domain.com',
          'https://another-valid.com',
          'https://final-valid.com',
        ]);

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      await prebidExplorer(options);

      // Verify domain filtering was applied
      expect(filterValidUrls).toHaveBeenCalledWith(testUrls, mockLogger, false);
      expect(mockPage.goto).toHaveBeenCalledTimes(3); // Only valid URLs
    });
  });

  describe('Error Message and Stack Trace Verification', () => {
    it('should capture detailed error information in TaskResultError', async () => {
      const testUrls = ['https://detailed-error.com'];

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
      };

      const detailedError = new Error('Detailed error with stack trace');
      detailedError.stack =
        'Error: Detailed error with stack trace\n    at processPage\n    at line 123';

      mockPage.goto.mockRejectedValue(detailedError);

      const { processAndLogTaskResults } = await import(
        '../utils/results-handler.js'
      );
      const mockProcessResults = vi.mocked(processAndLogTaskResults);

      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        expect(results).toHaveLength(1);

        const errorResult = results[0] as TaskResultError;
        expect(errorResult.type).toBe('error');
        expect(errorResult.url).toBe('https://detailed-error.com');
        expect(errorResult.error.code).toBe('UNKNOWN_PROCESSING_ERROR');
        expect(errorResult.error.message).toBe(
          'Detailed error with stack trace'
        );
        expect(errorResult.error.stack).toContain('at processPage');

        return [];
      });

      await prebidExplorer(options);

      // Verify error was logged with details
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing https://detailed-error.com'),
        expect.objectContaining({
          url: 'https://detailed-error.com',
          errorCode: 'UNKNOWN_PROCESSING_ERROR',
          originalStack: expect.stringContaining('at processPage'),
        })
      );
    });
  });

  describe('Statistics and Error Tracking', () => {
    it('should accurately track error statistics across mixed results', async () => {
      const testUrls = [
        'https://success1.com',
        'https://dns-error.com',
        'https://success2.com',
        'https://timeout-error.com',
        'https://no-data.com',
        'https://success3.com',
        'https://cert-error.com',
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
        skipProcessed: true,
      };

      // Mock different outcomes
      mockPage.goto.mockImplementation((url: string) => {
        mockPage.url.mockReturnValue(url);

        if (url.includes('dns-error')) {
          return Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'));
        } else if (url.includes('timeout-error')) {
          const timeoutError = new Error('Navigation timeout');
          timeoutError.name = 'TimeoutError';
          return Promise.reject(timeoutError);
        } else if (url.includes('cert-error')) {
          return Promise.reject(new Error('net::ERR_CERT_COMMON_NAME_INVALID'));
        }
        return Promise.resolve(null);
      });

      mockPage.evaluate.mockImplementation(() => {
        const url = mockPage.url();
        if (url.includes('no-data')) {
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

      let capturedResults: TaskResult[] = [];
      mockProcessResults.mockImplementation((results: TaskResult[]) => {
        capturedResults = [...results];

        expect(results).toHaveLength(7);

        const successCount = results.filter((r) => r.type === 'success').length;
        const errorCount = results.filter((r) => r.type === 'error').length;
        const noDataCount = results.filter((r) => r.type === 'no_data').length;

        expect(successCount).toBe(3); // success1, success2, success3
        expect(errorCount).toBe(3); // dns-error, timeout-error, cert-error
        expect(noDataCount).toBe(1); // no-data

        return results
          .filter((r) => r.type === 'success')
          .map((r) => (r as TaskResultSuccess).data);
      });

      // Mock URL tracker to verify error tracking
      mockUrlTracker.updateFromTaskResults.mockImplementation(
        (results: TaskResult[]) => {
          const errorResults = results.filter(
            (r) => r.type === 'error'
          ) as TaskResultError[];
          expect(errorResults).toHaveLength(3);

          const errorCodes = errorResults.map((e) => e.error.code);
          expect(errorCodes).toContain('ERR_NAME_NOT_RESOLVED');
          expect(errorCodes).toContain('PUPPETEER_TIMEOUT');
          expect(errorCodes).toContain('ERR_CERT_COMMON_NAME_INVALID');
        }
      );

      await prebidExplorer(options);

      expect(capturedResults).toHaveLength(7);
      expect(mockUrlTracker.updateFromTaskResults).toHaveBeenCalledTimes(1);
    });
  });
});
