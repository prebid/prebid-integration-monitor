/**
 * @fileoverview Unit tests for processPageTask function
 * Tests the core page processing functionality with various scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Page } from 'puppeteer';
import type { Logger as WinstonLogger } from 'winston';
import { processPageTask, configurePage, navigateWithRetry, extractDataSafely } from '../puppeteer-task.js';
import type { TaskResult, PageData } from '../../common/types.js';

// Mock logger
const mockLogger: WinstonLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

// Mock page with comprehensive methods
const createMockPage = (overrides: Partial<Page> = {}): Page => {
  const mockPage = {
    goto: vi.fn(),
    setDefaultTimeout: vi.fn(),
    setUserAgent: vi.fn(),
    setViewport: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    evaluate: vi.fn(),
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Test Page'),
    $: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
    ...overrides,
  } as any;

  return mockPage;
};

describe('processPageTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Success scenarios', () => {
    it('should return success result with Prebid.js data', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: ['googletag'],
        prebidInstances: [{
          globalVarName: 'pbjs',
          version: '7.48.0',
          modules: ['bidderFactory', 'core']
        }]
      };

      const mockPage = createMockPage({
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: '  https://example.com  ', logger: mockLogger }
      });

      expect(result.type).toBe('success');
      expect((result as any).data.url).toBe('https://example.com');
      expect((result as any).data.prebidInstances).toHaveLength(1);
      expect(mockLogger.info).toHaveBeenCalledWith('Attempting to process URL: https://example.com');
      expect(mockLogger.info).toHaveBeenCalledWith('Successfully extracted data from https://example.com');
    });

    it('should return success result with only ad libraries (no Prebid)', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: ['googletag', 'apstag'],
        prebidInstances: []
      };

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('success');
      expect((result as any).data.libraries).toEqual(['googletag', 'apstag']);
      expect((result as any).data.prebidInstances).toHaveLength(0);
    });

    it('should trim whitespace from URLs', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: ['googletag'],
        prebidInstances: []
      };

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: '  \n\t https://example.com \t\n  ', logger: mockLogger }
      });

      expect((result as any).data.url).toBe('https://example.com');
      expect(mockLogger.info).toHaveBeenCalledWith('Attempting to process URL: https://example.com');
    });
  });

  describe('No data scenarios', () => {
    it('should return no_data result when no ad tech is found', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: [],
        prebidInstances: []
      };

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('no_data');
      expect((result as any).url).toBe('https://example.com');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No relevant ad library or Prebid.js data found on https://example.com'
      );
    });

    it('should handle undefined libraries array', async () => {
      const mockPageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: undefined,
        prebidInstances: []
      } as any;

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('no_data');
    });
  });

  describe('Error scenarios', () => {
    it('should handle DNS resolution errors', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://nonexistent.invalid', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('ERR_NAME_NOT_RESOLVED');
      expect((result as any).url).toBe('https://nonexistent.invalid');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing https://nonexistent.invalid'),
        expect.objectContaining({
          url: 'https://nonexistent.invalid',
          errorCode: 'ERR_NAME_NOT_RESOLVED'
        })
      );
    });

    it('should handle timeout errors', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('Navigation timeout of 30000 ms exceeded')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://slow.example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('TIMEOUT');
    });

    it('should handle certificate errors', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('net::ERR_CERT_AUTHORITY_INVALID')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://badssl.example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('ERR_CERT_AUTHORITY_INVALID');
    });

    it('should handle Puppeteer timeout errors', async () => {
      const timeoutError = new Error('Protocol error (Page.navigate): Cannot navigate to invalid URL');
      timeoutError.name = 'TimeoutError';

      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(timeoutError),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('PUPPETEER_TIMEOUT');
    });

    it('should handle detached frame errors', async () => {
      const mockPage = createMockPage({
        evaluate: vi.fn().mockRejectedValue(new Error('Execution context was destroyed, most likely because of a navigation detached Frame')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('DETACHED_FRAME');
    });

    it('should handle protocol errors', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('Protocol error (Runtime.callFunctionOn): Session closed')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('PROTOCOL_ERROR');
    });

    it('should handle session closed errors', async () => {
      const mockPage = createMockPage({
        evaluate: vi.fn().mockRejectedValue(new Error('Session closed. Most likely the page has been closed.')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('SESSION_CLOSED');
    });

    it('should handle unknown errors gracefully', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('Some unexpected error')),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('UNKNOWN_PROCESSING_ERROR');
      expect((result as any).error.message).toBe('Some unexpected error');
    });

    it('should handle non-Error exceptions', async () => {
      const mockPage = createMockPage({
        goto: vi.fn().mockRejectedValue('String error'),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('error');
      expect((result as any).error.code).toBe('UNKNOWN_PROCESSING_ERROR');
    });
  });

  describe('Helper function integration', () => {
    it('should call configurePage correctly', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: ['googletag'],
        prebidInstances: []
      };

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(mockPage.setDefaultTimeout).toHaveBeenCalled();
      expect(mockPage.setUserAgent).toHaveBeenCalled();
      expect(mockPage.setViewport).toHaveBeenCalled();
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it('should handle navigation retry logic', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: [],
        prebidInstances: []
      };

      const mockPage = createMockPage({
        goto: vi.fn()
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce(undefined),
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('no_data');
      expect(mockPage.goto).toHaveBeenCalledTimes(2);
    });
  });

  describe('Data extraction edge cases', () => {
    it('should handle empty Prebid instances array', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: ['googletag'],
        prebidInstances: []
      };

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('success');
      expect((result as any).data.prebidInstances).toEqual([]);
    });

    it('should handle multiple Prebid instances', async () => {
      const mockPageData: PageData = {
        url: 'https://example.com',
        date: '2025-06-28',
        libraries: [],
        prebidInstances: [
          {
            globalVarName: 'pbjs',
            version: '7.48.0',
            modules: ['core', 'bidderFactory']
          },
          {
            globalVarName: 'headerBiddingPbjs',
            version: '7.49.0',
            modules: ['core', 'bidderFactory', 'userId']
          }
        ]
      };

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue(mockPageData),
      });

      const result = await processPageTask({
        page: mockPage,
        data: { url: 'https://example.com', logger: mockLogger }
      });

      expect(result.type).toBe('success');
      expect((result as any).data.prebidInstances).toHaveLength(2);
      expect((result as any).data.prebidInstances[0].globalVarName).toBe('pbjs');
      expect((result as any).data.prebidInstances[1].globalVarName).toBe('headerBiddingPbjs');
    });
  });
});