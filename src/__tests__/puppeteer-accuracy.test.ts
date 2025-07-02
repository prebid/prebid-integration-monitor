import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page } from 'puppeteer';
import type { Logger as WinstonLogger } from 'winston';
import {
  navigateWithRetry,
  triggerDynamicContent,
  extractDataSafely,
  processPageTask,
} from '../utils/puppeteer-task.js';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as WinstonLogger;

// Mock page object
const createMockPage = () => {
  const mockPage = {
    goto: vi.fn(),
    url: vi.fn(),
    title: vi.fn(),
    content: vi.fn(),
    evaluate: vi.fn(),
    mouse: {
      move: vi.fn(),
    },
    setDefaultTimeout: vi.fn(),
    setUserAgent: vi.fn(),
    setViewport: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    $: vi.fn(),
  } as unknown as Page;

  return mockPage;
};

describe('Puppeteer Accuracy Optimization Tests', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = createMockPage();
    vi.clearAllMocks();
  });

  describe('Enhanced Navigation', () => {
    it('should handle successful navigation with proper post-checks', async () => {
      vi.mocked(mockPage.goto).mockResolvedValue(undefined as any);
      vi.mocked(mockPage.url).mockReturnValue('https://example.com');
      vi.mocked(mockPage.title).mockResolvedValue('Example Site');
      vi.mocked(mockPage.content).mockResolvedValue(
        '<html><body>Valid content</body></html>'
      );
      vi.mocked(mockPage.$).mockResolvedValue(null);

      await expect(
        navigateWithRetry(mockPage, 'https://example.com', mockLogger)
      ).resolves.not.toThrow();

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          timeout: 60000,
          waitUntil: ['networkidle2', 'domcontentloaded'],
        })
      );
    });

    it('should detect and reject parked domains', async () => {
      vi.mocked(mockPage.goto).mockResolvedValue(undefined as any);
      vi.mocked(mockPage.url).mockReturnValue('https://parking.example.com');
      vi.mocked(mockPage.title).mockResolvedValue('Domain Parked');
      vi.mocked(mockPage.content).mockResolvedValue(
        '<html><body>This domain is parked</body></html>'
      );

      await expect(
        navigateWithRetry(mockPage, 'https://example.com', mockLogger)
      ).rejects.toThrow('Page appears to be unavailable');
    });

    it('should retry timeout errors but not DNS errors', async () => {
      // First attempt: timeout (should retry)
      vi.mocked(mockPage.goto)
        .mockRejectedValueOnce(new Error('Navigation timeout'))
        .mockResolvedValueOnce(undefined as any);

      vi.mocked(mockPage.url).mockReturnValue('https://example.com');
      vi.mocked(mockPage.title).mockResolvedValue('Example Site');
      vi.mocked(mockPage.content).mockResolvedValue(
        '<html><body>Valid content</body></html>'
      );
      vi.mocked(mockPage.$).mockResolvedValue(null);

      await expect(
        navigateWithRetry(mockPage, 'https://example.com', mockLogger)
      ).resolves.not.toThrow();

      expect(mockPage.goto).toHaveBeenCalledTimes(2);
    });

    it('should not retry DNS resolution errors', async () => {
      vi.mocked(mockPage.goto).mockRejectedValue(
        new Error('net::ERR_NAME_NOT_RESOLVED')
      );

      await expect(
        navigateWithRetry(mockPage, 'https://nonexistent.example', mockLogger)
      ).rejects.toThrow('net::ERR_NAME_NOT_RESOLVED');

      expect(mockPage.goto).toHaveBeenCalledTimes(1);
    });
  });

  describe('Enhanced Dynamic Content Loading', () => {
    it('should simulate user interactions for ad tech detection', async () => {
      vi.mocked(mockPage.evaluate).mockResolvedValue(undefined);
      vi.mocked(mockPage.mouse.move).mockResolvedValue(undefined);

      await triggerDynamicContent(mockPage, mockLogger);

      expect(mockPage.mouse.move).toHaveBeenCalledWith(100, 100);
      expect(mockPage.mouse.move).toHaveBeenCalledWith(500, 300);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should handle errors gracefully during content triggering', async () => {
      vi.mocked(mockPage.evaluate).mockRejectedValue(new Error('Page closed'));
      vi.mocked(mockPage.mouse.move).mockRejectedValue(
        new Error('Mouse error')
      );

      await expect(
        triggerDynamicContent(mockPage, mockLogger)
      ).resolves.not.toThrow();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Error during'),
        expect.any(Error)
      );
    });
  });

  describe('Enhanced Data Extraction', () => {
    it('should detect fully initialized Prebid instances', async () => {
      const mockPrebidData = {
        libraries: ['googletag'],
        date: '2024-01-01',
        prebidInstances: [
          {
            globalVarName: 'pbjs',
            version: '8.0.0',
            modules: ['appnexusBidAdapter', 'rubiconBidAdapter'],
          },
        ],
        toolMetadata: {
          prebidInitStates: {
            'pbjs': 'complete'
          }
        }
      };

      vi.mocked(mockPage.evaluate).mockResolvedValue(mockPrebidData);

      const result = await extractDataSafely(mockPage, mockLogger);

      expect(result).toEqual(mockPrebidData);
      expect(result.toolMetadata?.prebidInitStates?.['pbjs']).toBe('complete');
    });

    it('should detect partially loaded Prebid instances', async () => {
      const mockPartialPrebidData = {
        libraries: [],
        date: '2024-01-01',
        prebidInstances: [
          {
            globalVarName: 'pbjs',
            version: '8.0.0',
            modules: [],
          },
        ],
        toolMetadata: {
          prebidInitStates: {
            'pbjs': 'partial'
          }
        }
      };

      vi.mocked(mockPage.evaluate).mockResolvedValue(mockPartialPrebidData);

      const result = await extractDataSafely(mockPage, mockLogger);

      expect(result.toolMetadata?.prebidInitStates?.['pbjs']).toBe('partial');
    });

    it('should detect Prebid command queue', async () => {
      const mockQueuePrebidData = {
        libraries: [],
        date: '2024-01-01',
        prebidInstances: [
          {
            globalVarName: 'pbjs',
            version: 'queue-detected',
            modules: [],
          },
        ],
        toolMetadata: {
          prebidInitStates: {
            'pbjs': 'queue'
          }
        }
      };

      vi.mocked(mockPage.evaluate).mockResolvedValue(mockQueuePrebidData);

      const result = await extractDataSafely(mockPage, mockLogger);

      expect(result.toolMetadata?.prebidInitStates?.['pbjs']).toBe('queue');
      expect(result.prebidInstances[0].version).toBe('queue-detected');
    });

    it('should retry on detached frame errors', async () => {
      vi.mocked(mockPage.evaluate)
        .mockRejectedValueOnce(new Error('detached Frame error'))
        .mockResolvedValue({
          libraries: [],
          date: '2024-01-01',
          prebidInstances: [],
        });

      const result = await extractDataSafely(mockPage, mockLogger);

      // Should complete successfully despite initial error
      expect(result).toBeDefined();
      expect(result.prebidInstances).toEqual([]);
      // Should have called evaluate multiple times (retry logic)
      expect(
        vi.mocked(mockPage.evaluate).mock.calls.length
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Complete Task Processing Accuracy', () => {
    it('should successfully process a page with Prebid', async () => {
      const mockTaskData = {
        url: 'https://example.com',
        logger: mockLogger,
      };

      const mockPageData = {
        url: 'https://example.com',
        libraries: ['googletag'],
        date: '2024-01-01',
        prebidInstances: [
          {
            globalVarName: 'pbjs',
            version: '8.0.0',
            modules: ['appnexusBidAdapter', 'rubiconBidAdapter'],
          },
        ],
        toolMetadata: {
          prebidInitStates: {
            'pbjs': 'complete'
          }
        }
      };

      // Mock all the required page methods
      vi.mocked(mockPage.goto).mockResolvedValue(undefined as any);
      vi.mocked(mockPage.url).mockReturnValue('https://example.com');
      vi.mocked(mockPage.title).mockResolvedValue('Example Site');
      vi.mocked(mockPage.content).mockResolvedValue(
        '<html><body>Valid content</body></html>'
      );
      vi.mocked(mockPage.$).mockResolvedValue(null);
      vi.mocked(mockPage.evaluate).mockResolvedValue(mockPageData);
      vi.mocked(mockPage.mouse.move).mockResolvedValue(undefined);
      vi.mocked(mockPage.setDefaultTimeout).mockReturnValue(undefined);
      vi.mocked(mockPage.setUserAgent).mockResolvedValue(undefined);
      vi.mocked(mockPage.setViewport).mockResolvedValue(undefined);
      vi.mocked(mockPage.evaluateOnNewDocument).mockResolvedValue(
        undefined as any
      );

      const result = await processPageTask({
        page: mockPage,
        data: mockTaskData,
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.data.url).toBe('https://example.com');
        expect(result.data.prebidInstances).toHaveLength(1);
        expect(result.data.prebidInstances?.[0]?.version).toBe('8.0.0');
      }
    });

    it('should handle pages with no Prebid data', async () => {
      const mockTaskData = {
        url: 'https://example-no-prebid.com',
        logger: mockLogger,
      };

      const mockPageData = {
        url: 'https://example-no-prebid.com',
        libraries: [],
        date: '2024-01-01',
        prebidInstances: [],
      };

      // Mock all the required page methods
      vi.mocked(mockPage.goto).mockResolvedValue(undefined as any);
      vi.mocked(mockPage.url).mockReturnValue('https://example-no-prebid.com');
      vi.mocked(mockPage.title).mockResolvedValue('Example Site');
      vi.mocked(mockPage.content).mockResolvedValue(
        '<html><body>Valid content</body></html>'
      );
      vi.mocked(mockPage.$).mockResolvedValue(null);
      vi.mocked(mockPage.evaluate).mockResolvedValue(mockPageData);
      vi.mocked(mockPage.mouse.move).mockResolvedValue(undefined);
      vi.mocked(mockPage.setDefaultTimeout).mockReturnValue(undefined);
      vi.mocked(mockPage.setUserAgent).mockResolvedValue(undefined);
      vi.mocked(mockPage.setViewport).mockResolvedValue(undefined);
      vi.mocked(mockPage.evaluateOnNewDocument).mockResolvedValue(
        undefined as any
      );

      const result = await processPageTask({
        page: mockPage,
        data: mockTaskData,
      });

      expect(result.type).toBe('no_data');
      if (result.type === 'no_data') {
        expect(result.url).toBe('https://example-no-prebid.com');
      }
    });

    it('should handle and categorize different error types', async () => {
      const mockTaskData = {
        url: 'https://error-example.com',
        logger: mockLogger,
      };

      // Mock navigation failure
      vi.mocked(mockPage.setDefaultTimeout).mockReturnValue(undefined);
      vi.mocked(mockPage.setUserAgent).mockResolvedValue(undefined);
      vi.mocked(mockPage.setViewport).mockResolvedValue(undefined);
      vi.mocked(mockPage.evaluateOnNewDocument).mockResolvedValue(
        undefined as any
      );
      vi.mocked(mockPage.goto).mockRejectedValue(
        new Error('net::ERR_CONNECTION_TIMEOUT')
      );

      const result = await processPageTask({
        page: mockPage,
        data: mockTaskData,
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.url).toBe('https://error-example.com');
        expect(result.error.code).toBe('ERR_CONNECTION_TIMEOUT');
      }
    });
  });

  describe('Performance and Reliability', () => {
    it('should complete processing within reasonable time limits', async () => {
      const startTime = Date.now();

      // Mock fast, successful responses
      vi.mocked(mockPage.goto).mockResolvedValue(undefined as any);
      vi.mocked(mockPage.url).mockReturnValue('https://fast-example.com');
      vi.mocked(mockPage.title).mockResolvedValue('Fast Site');
      vi.mocked(mockPage.content).mockResolvedValue(
        '<html><body>Fast content</body></html>'
      );
      vi.mocked(mockPage.$).mockResolvedValue(null);
      vi.mocked(mockPage.evaluate).mockResolvedValue({
        libraries: [],
        date: '2024-01-01',
        prebidInstances: [],
      });
      vi.mocked(mockPage.mouse.move).mockResolvedValue(undefined);
      vi.mocked(mockPage.setDefaultTimeout).mockReturnValue(undefined);
      vi.mocked(mockPage.setUserAgent).mockResolvedValue(undefined);
      vi.mocked(mockPage.setViewport).mockResolvedValue(undefined);
      vi.mocked(mockPage.evaluateOnNewDocument).mockResolvedValue(
        undefined as any
      );

      await processPageTask({
        page: mockPage,
        data: { url: 'https://fast-example.com', logger: mockLogger },
      });

      const duration = Date.now() - startTime;

      // Should complete within 10 seconds for mocked responses
      expect(duration).toBeLessThan(10000);
    });
  });
});
