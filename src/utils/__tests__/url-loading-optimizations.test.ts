import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUrlsFromGitHub } from '../url-loader.js';
import { getContentCache, closeContentCache } from '../content-cache.js';
import type { Logger as WinstonLogger } from 'winston';
import { Response } from 'node-fetch';

// Mock dependencies
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

const { default: mockFetch } = await import('node-fetch');

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as WinstonLogger;

describe('URL Loading Optimizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeContentCache(); // Start with clean cache
  });

  afterEach(() => {
    closeContentCache();
  });

  describe('Content Caching', () => {
    it('should cache GitHub content on first fetch', async () => {
      const testContent = 'google.com\nyoutube.com\nfacebook.com';
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(testContent),
        headers: new Map([
          ['content-length', '100'],
          ['etag', '"abc123"']
        ])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result1 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result1).toHaveLength(3);
      expect(result1).toEqual([
        'https://google.com',
        'https://youtube.com', 
        'https://facebook.com'
      ]);
    });

    it('should use cached content on subsequent fetches', async () => {
      const testContent = 'google.com\nyoutube.com\nfacebook.com';
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(testContent),
        headers: new Map([
          ['content-length', '100'],
          ['etag', '"abc123"']
        ])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      // First fetch - should hit network
      const result1 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger
      );

      // Second fetch - should use cache
      const result2 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger
      );

      expect(mockFetch).toHaveBeenCalledTimes(1); // Only called once
      expect(result1).toEqual(result2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Using cached content')
      );
    });

    it('should avoid redundant fetches across different range requests', async () => {
      const testContent = Array.from({ length: 100 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(testContent),
        headers: new Map([
          ['content-length', '1000']
        ])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      // First range request
      const result1 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger,
        { startRange: 1, endRange: 10 }
      );

      // Second range request - should use cached content
      const result2 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains', 
        undefined,
        mockLogger,
        { startRange: 11, endRange: 20 }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1); // Only one HTTP request
      expect(result1).toHaveLength(10);
      expect(result2).toHaveLength(10);
      expect(result1[0]).toBe('https://domain0.com');
      expect(result2[0]).toBe('https://domain10.com');
    });
  });

  describe('Range Optimization', () => {
    it('should only process specified range without loading full file', async () => {
      const largeContent = Array.from({ length: 10000 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(largeContent),
        headers: new Map([['content-length', '100000']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      const startTime = Date.now();
      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/large-domains',
        undefined,
        mockLogger,
        { startRange: 1000, endRange: 1050 }
      );
      const endTime = Date.now();

      expect(result).toHaveLength(50);
      expect(result[0]).toBe('https://domain999.com'); // 0-based index
      expect(result[49]).toBe('https://domain1048.com');
      
      // Should be fast even with large file
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle range beyond file size gracefully', async () => {
      const smallContent = Array.from({ length: 10 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(smallContent),
        headers: new Map([['content-length', '100']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/small-domains',
        undefined,
        mockLogger,
        { startRange: 50, endRange: 100 }
      );

      expect(result).toHaveLength(0); // No domains in that range
    });

    it('should process entire file when no range specified', async () => {
      const testContent = Array.from({ length: 50 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(testContent),
        headers: new Map([['content-length', '500']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger
        // No range options
      );

      expect(result).toHaveLength(50);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not load entire file into memory when using range optimization', async () => {
      const hugeContent = Array.from({ length: 100000 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(hugeContent),
        headers: new Map([['content-length', '1000000']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      const memoryBefore = process.memoryUsage().heapUsed;
      
      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/huge-domains',
        undefined,
        mockLogger,
        { startRange: 1, endRange: 100 }
      );

      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryIncrease = memoryAfter - memoryBefore;

      expect(result).toHaveLength(100);
      // Should not load the entire ~1MB file into memory for processing
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Less than 10MB increase
    });
  });

  describe('Error Handling with Caching', () => {
    it('should not cache failed requests', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Not Found'),
        headers: new Map()
      } as any;

      mockFetch.mockResolvedValueOnce(mockErrorResponse);

      const result1 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/nonexistent',
        undefined,
        mockLogger
      );

      expect(result1).toHaveLength(0);

      // Should try network again on next request
      mockFetch.mockResolvedValueOnce(mockErrorResponse);
      
      const result2 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/nonexistent',
        undefined,
        mockLogger
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result2).toHaveLength(0);
    });

    it('should handle cache corruption gracefully', async () => {
      const cache = getContentCache(mockLogger);
      const testContent = 'google.com\nyoutube.com';

      // Manually corrupt cache by setting invalid content
      (cache as any).cache.set('corrupt-key', {
        content: null, // Invalid content
        timestamp: Date.now(),
        size: 0,
        hits: 1
      });

      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(testContent),
        headers: new Map([['content-length', '20']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      // Should handle corruption and fetch fresh content
      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger
      );

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet processing speed targets', async () => {
      const mediumContent = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(mediumContent),
        headers: new Map([['content-length', '10000']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      const startTime = Date.now();
      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/medium-domains',
        undefined,
        mockLogger
      );
      const endTime = Date.now();

      expect(result).toHaveLength(1000);
      
      // Should process 1000 URLs in under 5 seconds
      expect(endTime - startTime).toBeLessThan(5000);
      
      // Should process at least 200 URLs per second
      const urlsPerSecond = result.length / ((endTime - startTime) / 1000);
      expect(urlsPerSecond).toBeGreaterThan(200);
    });

    it('should demonstrate caching performance benefits', async () => {
      const testContent = Array.from({ length: 5000 }, (_, i) => `domain${i}.com`).join('\n');
      const mockResponse = {
        ok: true,
        status: 200,
        text: () => Promise.resolve(testContent),
        headers: new Map([['content-length', '50000']])
      } as any;

      mockFetch.mockResolvedValueOnce(mockResponse);

      // First request - cold cache
      const start1 = Date.now();
      const result1 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/perf-test',
        undefined,
        mockLogger
      );
      const end1 = Date.now();
      const coldCacheTime = end1 - start1;

      // Second request - warm cache
      const start2 = Date.now();
      const result2 = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/perf-test',
        undefined,
        mockLogger
      );
      const end2 = Date.now();
      const warmCacheTime = end2 - start2;

      expect(result1).toEqual(result2);
      expect(warmCacheTime).toBeLessThan(coldCacheTime / 2); // At least 2x faster
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only one network request
    });
  });
});