import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prebidExplorer, type PrebidExplorerOptions } from '../../prebid.js';
import type { TaskResult } from '../../common/types.js';
import * as urlTracker from '../url-tracker.js';
import * as urlLoader from '../url-loader.js';
import * as resultsHandler from '../results-handler.js';
import * as logger from '../logger.js';

// Mock all dependencies
vi.mock('../url-tracker.js');
vi.mock('../url-loader.js');
vi.mock('../results-handler.js');
vi.mock('../logger.js');
vi.mock('puppeteer-extra', () => ({
  addExtra: vi.fn((puppeteer) => ({
    ...puppeteer,
    use: vi.fn(),
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  })),
}));
vi.mock('puppeteer');
vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(),
}));
vi.mock('puppeteer-extra-plugin-block-resources', () => ({
  default: vi.fn(),
}));

// Mock logger module
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mocked(logger.initializeLogger).mockReturnValue(mockLogger as any);

// Mock URL tracker
const mockUrlTracker = {
  resetTracking: vi.fn(),
  getStats: vi.fn().mockReturnValue({ success: 1000, no_data: 50 }),
  importExistingResults: vi.fn().mockResolvedValue(undefined),
  filterUnprocessedUrls: vi.fn(),
  updateFromTaskResults: vi.fn(),
  close: vi.fn(),
};

vi.mocked(urlTracker.getUrlTracker).mockReturnValue(mockUrlTracker as any);
vi.mocked(urlTracker.closeUrlTracker).mockImplementation(() => {});

// Mock URL loader functions
vi.mocked(urlLoader.loadFileContents).mockReturnValue(
  'google.com\nyoutube.com\nfacebook.com'
);
vi.mocked(urlLoader.processFileContent).mockResolvedValue([
  'https://google.com',
  'https://youtube.com',
  'https://facebook.com',
]);
vi.mocked(urlLoader.fetchUrlsFromGitHub).mockResolvedValue([
  'https://github-url1.com',
  'https://github-url2.com',
]);

// Mock results handler functions
vi.mocked(resultsHandler.processAndLogTaskResults).mockReturnValue([]);
vi.mocked(resultsHandler.writeResultsToStoreFile).mockImplementation(() => {});
vi.mocked(resultsHandler.appendNoPrebidUrls).mockImplementation(() => {});
vi.mocked(resultsHandler.appendErrorUrls).mockImplementation(() => {});
vi.mocked(resultsHandler.updateInputFile).mockImplementation(() => {});

describe('Prebid Explorer URL Filtering Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('URL Filtering with skipProcessed enabled', () => {
    const baseOptions: PrebidExplorerOptions = {
      puppeteerType: 'vanilla',
      concurrency: 1,
      headless: true,
      monitor: false,
      outputDir: 'test-output',
      logDir: 'test-logs',
      skipProcessed: true,
      resetTracking: false,
    };

    it('should import existing results when database is empty', async () => {
      // Mock empty database stats
      mockUrlTracker.getStats.mockReturnValue({});

      const options = {
        ...baseOptions,
        inputFile: 'test.txt',
      };

      await prebidExplorer(options);

      expect(mockUrlTracker.importExistingResults).toHaveBeenCalledWith(
        expect.stringContaining('store')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'URL tracking database is empty. Importing existing results...'
      );
    });

    it('should not import existing results when database has data', async () => {
      // Mock database with existing data
      mockUrlTracker.getStats.mockReturnValue({ success: 1000, no_data: 50 });

      const options = {
        ...baseOptions,
        inputFile: 'test.txt',
      };

      await prebidExplorer(options);

      expect(mockUrlTracker.importExistingResults).not.toHaveBeenCalled();
    });

    it('should filter URLs before processing', async () => {
      const originalUrls = [
        'https://google.com',
        'https://youtube.com',
        'https://facebook.com',
      ];
      const filteredUrls = ['https://youtube.com']; // Only youtube.com not processed

      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(filteredUrls);

      const options = {
        ...baseOptions,
        inputFile: 'test.txt',
      };

      await prebidExplorer(options);

      expect(mockUrlTracker.filterUnprocessedUrls).toHaveBeenCalledWith(
        originalUrls
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'URL filtering complete: 3 total, 1 unprocessed, 2 skipped'
        )
      );
    });

    it('should exit early when all URLs are processed', async () => {
      mockUrlTracker.filterUnprocessedUrls.mockReturnValue([]); // All URLs filtered out

      const options = {
        ...baseOptions,
        inputFile: 'test.txt',
      };

      await prebidExplorer(options);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'All URLs have been previously processed. Exiting.'
      );
      expect(urlTracker.closeUrlTracker).toHaveBeenCalled();
    });

    it('should update URL tracker with results after processing', async () => {
      const filteredUrls = ['https://youtube.com'];
      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(filteredUrls);

      const mockTaskResults: TaskResult[] = [
        {
          type: 'success',
          data: {
            url: 'https://youtube.com',
            libraries: ['googletag'],
            date: '2023-10-27',
            prebidInstances: [],
          },
        },
      ];

      // Mock the processAndLogTaskResults to return the task results
      vi.mocked(resultsHandler.processAndLogTaskResults).mockReturnValue([
        mockTaskResults[0].data,
      ]);

      const options = {
        ...baseOptions,
        inputFile: 'test.txt',
      };

      await prebidExplorer(options);

      expect(mockUrlTracker.updateFromTaskResults).toHaveBeenCalledWith(
        expect.any(Array)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Updated URL tracking database with scan results'
      );
    });

    it('should reset tracking when resetTracking is enabled', async () => {
      const options = {
        ...baseOptions,
        inputFile: 'test.txt',
        resetTracking: true,
      };

      await prebidExplorer(options);

      expect(mockUrlTracker.resetTracking).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Resetting URL tracking database...'
      );
    });

    it('should work with GitHub repository as source', async () => {
      const options = {
        ...baseOptions,
        githubRepo: 'https://github.com/test/repo',
      };

      const githubUrls = ['https://github-url1.com', 'https://github-url2.com'];
      const filteredUrls = ['https://github-url2.com'];

      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(filteredUrls);

      await prebidExplorer(options);

      expect(urlLoader.fetchUrlsFromGitHub).toHaveBeenCalledWith(
        'https://github.com/test/repo',
        undefined,
        mockLogger
      );
      expect(mockUrlTracker.filterUnprocessedUrls).toHaveBeenCalledWith(
        githubUrls
      );
    });
  });

  describe('URL Filtering with skipProcessed disabled', () => {
    const baseOptions: PrebidExplorerOptions = {
      puppeteerType: 'vanilla',
      concurrency: 1,
      headless: true,
      monitor: false,
      outputDir: 'test-output',
      logDir: 'test-logs',
      skipProcessed: false,
      inputFile: 'test.txt',
    };

    it('should not filter URLs when skipProcessed is disabled', async () => {
      await prebidExplorer(baseOptions);

      expect(mockUrlTracker.filterUnprocessedUrls).not.toHaveBeenCalled();
      expect(mockUrlTracker.updateFromTaskResults).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Filtering out previously processed URLs')
      );
    });

    it('should not import existing results when skipProcessed is disabled', async () => {
      await prebidExplorer(baseOptions);

      expect(mockUrlTracker.importExistingResults).not.toHaveBeenCalled();
    });
  });

  describe('Range Processing with URL Filtering', () => {
    it('should apply range filter before URL filtering', async () => {
      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: 'test-output',
        logDir: 'test-logs',
        skipProcessed: true,
        inputFile: 'test.txt',
        range: '1-2', // Only first 2 URLs
      };

      const originalUrls = [
        'https://google.com',
        'https://youtube.com',
        'https://facebook.com',
      ];
      const rangedUrls = ['https://google.com', 'https://youtube.com']; // First 2 after range
      const filteredUrls = ['https://youtube.com']; // After URL filtering

      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(filteredUrls);

      await prebidExplorer(options);

      expect(mockUrlTracker.filterUnprocessedUrls).toHaveBeenCalledWith(
        rangedUrls
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Applied range: Processing URLs from 1 to 2')
      );
    });
  });

  describe('Error Handling in URL Filtering', () => {
    it('should handle URL tracker errors gracefully', async () => {
      mockUrlTracker.filterUnprocessedUrls.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: 'test-output',
        logDir: 'test-logs',
        skipProcessed: true,
        inputFile: 'test.txt',
      };

      // Should not throw, but handle gracefully
      await expect(prebidExplorer(options)).resolves.not.toThrow();
    });

    it('should close URL tracker even if processing fails', async () => {
      // Mock an error during processing
      vi.mocked(urlLoader.processFileContent).mockRejectedValue(
        new Error('File read error')
      );

      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: 'test-output',
        logDir: 'test-logs',
        skipProcessed: true,
        inputFile: 'nonexistent.txt',
      };

      await expect(prebidExplorer(options)).rejects.toThrow();

      // URL tracker should still be closed
      expect(urlTracker.closeUrlTracker).toHaveBeenCalled();
    });
  });

  describe('Chunked Processing with URL Filtering', () => {
    it('should apply URL filtering before chunked processing', async () => {
      const options: PrebidExplorerOptions = {
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: 'test-output',
        logDir: 'test-logs',
        skipProcessed: true,
        inputFile: 'test.txt',
        chunkSize: 2,
      };

      const originalUrls = [
        'https://google.com',
        'https://youtube.com',
        'https://facebook.com',
      ];
      const filteredUrls = ['https://youtube.com', 'https://facebook.com'];

      mockUrlTracker.filterUnprocessedUrls.mockReturnValue(filteredUrls);

      await prebidExplorer(options);

      expect(mockUrlTracker.filterUnprocessedUrls).toHaveBeenCalledWith(
        originalUrls
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Chunked processing enabled. Chunk size: 2')
      );
    });
  });
});
