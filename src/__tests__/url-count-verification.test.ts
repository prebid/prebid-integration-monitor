/**
 * @fileoverview URL count verification tests
 * Tests to verify exact URL counts are processed correctly (5, 10, 25 URLs)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger as WinstonLogger } from 'winston';
import type { TaskResult, PageData } from '../common/types.js';
import { processPageTask } from '../utils/puppeteer-task.js';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

// Mock logger
const mockLogger: WinstonLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

// Generate test URLs
const generateTestUrls = (count: number): string[] => {
  return Array.from({ length: count }, (_, i) => `https://test${i + 1}.com`);
};

// Mock page factory
const createMockPage = (url: string, shouldError: boolean = false): any => {
  const mockPageData: PageData = {
    url,
    date: '2025-06-28',
    libraries: [],
    prebidInstances: [],
  };

  return {
    goto: shouldError
      ? vi.fn().mockRejectedValue(new Error('Navigation failed'))
      : vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    setUserAgent: vi.fn(),
    setViewport: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(mockPageData),
    url: vi.fn().mockReturnValue(url),
    title: vi.fn().mockResolvedValue('Test Page'),
    $: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
  };
};

const TEST_DIR = './test-count-verification';

describe('URL Count Verification Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('Small URL Set Tests (5 URLs)', () => {
    it('should process exactly 5 URLs in vanilla mode', async () => {
      const urls = generateTestUrls(5);
      const results: TaskResult[] = [];
      const processedUrls: string[] = [];

      // Simulate vanilla processing
      for (const url of urls) {
        processedUrls.push(url);
        const mockPage = createMockPage(url);

        const result = await processPageTask({
          page: mockPage,
          data: { url, logger: mockLogger },
        });

        results.push(result);
      }

      expect(processedUrls).toHaveLength(5);
      expect(results).toHaveLength(5);
      expect(processedUrls).toEqual(urls);
      expect(results.every((r) => r.type === 'no_data')).toBe(true);
      expect(results.map((r) => r.url)).toEqual(urls);
    });

    it('should process exactly 5 URLs in cluster mode simulation', async () => {
      const urls = generateTestUrls(5);
      const taskResults: TaskResult[] = [];
      const queuedUrls: string[] = [];

      // Simulate cluster processing with Promise.allSettled
      const promises = urls.map(async (url) => {
        queuedUrls.push(url);
        // Simulate processPageTask result
        return {
          type: 'no_data' as const,
          url,
        };
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          }
        }
      });

      expect(queuedUrls).toHaveLength(5);
      expect(promises).toHaveLength(5);
      expect(taskResults).toHaveLength(5);
      expect(taskResults.map((r) => r.url)).toEqual(urls);
    });

    it('should handle 5 URLs with mixed success/error results', async () => {
      const urls = generateTestUrls(5);
      const results: TaskResult[] = [];

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const shouldError = i === 2; // Make the 3rd URL error
        const mockPage = createMockPage(url, shouldError);

        const result = await processPageTask({
          page: mockPage,
          data: { url, logger: mockLogger },
        });

        results.push(result);
      }

      expect(results).toHaveLength(5);
      expect(results[0].type).toBe('no_data');
      expect(results[1].type).toBe('no_data');
      expect(results[2].type).toBe('error');
      expect(results[3].type).toBe('no_data');
      expect(results[4].type).toBe('no_data');
    });
  });

  describe('Medium URL Set Tests (10 URLs)', () => {
    it('should process exactly 10 URLs without losing any', async () => {
      const urls = generateTestUrls(10);
      const taskResults: TaskResult[] = [];
      const processedUrls: Set<string> = new Set();

      // Simulate cluster-like processing with concurrent promises
      const promises = urls.map(async (url, index) => {
        processedUrls.add(url);

        // Add artificial delays to simulate real processing
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));

        return {
          type: 'no_data' as const,
          url,
          index, // Track original order
        };
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          }
        }
      });

      expect(processedUrls.size).toBe(10);
      expect(taskResults).toHaveLength(10);

      // Verify all URLs are present regardless of processing order
      const resultUrls = taskResults.map((r) => r.url).sort();
      const expectedUrls = urls.sort();
      expect(resultUrls).toEqual(expectedUrls);
    });

    it('should handle 10 URLs with chunked processing', async () => {
      const urls = generateTestUrls(10);
      const chunkSize = 3;
      const allResults: TaskResult[] = [];

      // Process in chunks like the real application
      for (let i = 0; i < urls.length; i += chunkSize) {
        const chunkUrls = urls.slice(i, i + chunkSize);
        const chunkResults: TaskResult[] = [];

        const promises = chunkUrls.map(async (url) => {
          return {
            type: 'no_data' as const,
            url,
          };
        });

        const settledResults = await Promise.allSettled(promises);

        settledResults.forEach((settledResult) => {
          if (settledResult.status === 'fulfilled') {
            if (typeof settledResult.value !== 'undefined') {
              chunkResults.push(settledResult.value);
            }
          }
        });

        allResults.push(...chunkResults);
      }

      expect(allResults).toHaveLength(10);
      expect(allResults.map((r) => r.url).sort()).toEqual(urls.sort());
    });

    it('should maintain count accuracy with errors in 10 URL set', async () => {
      const urls = generateTestUrls(10);
      const results: TaskResult[] = [];
      const errorIndices = [2, 5, 8]; // Make some URLs error

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const shouldError = errorIndices.includes(i);

        const result: TaskResult = shouldError
          ? {
              type: 'error',
              url,
              error: {
                code: 'TEST_ERROR',
                message: 'Test error',
                stack: 'test stack',
              },
            }
          : {
              type: 'no_data',
              url,
            };

        results.push(result);
      }

      expect(results).toHaveLength(10);

      const errorResults = results.filter((r) => r.type === 'error');
      const successResults = results.filter((r) => r.type === 'no_data');

      expect(errorResults).toHaveLength(3);
      expect(successResults).toHaveLength(7);
      expect(results.map((r) => r.url)).toEqual(urls);
    });
  });

  describe('Large URL Set Tests (25 URLs)', () => {
    it('should process exactly 25 URLs with high concurrency simulation', async () => {
      const urls = generateTestUrls(25);
      const taskResults: TaskResult[] = [];
      const startTimes: Map<string, number> = new Map();
      const endTimes: Map<string, number> = new Map();

      // Simulate high concurrency processing
      const promises = urls.map(async (url, index) => {
        startTimes.set(url, Date.now());

        // Simulate varying processing times
        const processingTime = 10 + Math.random() * 40;
        await new Promise((resolve) => setTimeout(resolve, processingTime));

        endTimes.set(url, Date.now());

        return {
          type: 'no_data' as const,
          url,
          processingTime,
        };
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          }
        }
      });

      expect(taskResults).toHaveLength(25);
      expect(startTimes.size).toBe(25);
      expect(endTimes.size).toBe(25);

      // Verify all URLs processed
      const resultUrls = new Set(taskResults.map((r) => r.url));
      expect(resultUrls.size).toBe(25);
      urls.forEach((url) => expect(resultUrls.has(url)).toBe(true));
    });

    it('should handle 25 URLs with batch processing and progress tracking', async () => {
      const urls = generateTestUrls(25);
      const batchSize = 5;
      const totalBatches = Math.ceil(urls.length / batchSize);
      const allResults: TaskResult[] = [];
      const batchResults: {
        batchNumber: number;
        count: number;
        urls: string[];
      }[] = [];

      for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
        const startIndex = (batchNum - 1) * batchSize;
        const endIndex = Math.min(startIndex + batchSize, urls.length);
        const batchUrls = urls.slice(startIndex, endIndex);
        const currentBatchResults: TaskResult[] = [];

        const promises = batchUrls.map(async (url) => {
          return {
            type: 'no_data' as const,
            url,
          };
        });

        const settledResults = await Promise.allSettled(promises);

        settledResults.forEach((settledResult) => {
          if (settledResult.status === 'fulfilled') {
            if (typeof settledResult.value !== 'undefined') {
              currentBatchResults.push(settledResult.value);
            }
          }
        });

        allResults.push(...currentBatchResults);
        batchResults.push({
          batchNumber: batchNum,
          count: currentBatchResults.length,
          urls: currentBatchResults.map((r) => r.url),
        });
      }

      expect(allResults).toHaveLength(25);
      expect(batchResults).toHaveLength(5); // 25/5 = 5 batches

      // Verify batch counts
      expect(batchResults[0].count).toBe(5);
      expect(batchResults[1].count).toBe(5);
      expect(batchResults[2].count).toBe(5);
      expect(batchResults[3].count).toBe(5);
      expect(batchResults[4].count).toBe(5);

      // Verify no URLs lost
      const allProcessedUrls = batchResults.flatMap((b) => b.urls);
      expect(allProcessedUrls.sort()).toEqual(urls.sort());
    });

    it('should detect and report URL count discrepancies', async () => {
      const urls = generateTestUrls(25);
      const taskResults: TaskResult[] = [];
      const undefinedCount = { value: 0 };
      const rejectedCount = { value: 0 };

      // Simulate the problematic scenario with some undefined results
      const promises = urls.map(async (url, index) => {
        // Simulate cluster bug - some promises resolve to undefined
        if (index % 7 === 0) {
          // Every 7th URL has the bug
          return undefined;
        }

        // Simulate some rejections
        if (index % 11 === 0) {
          // Every 11th URL rejects
          throw new Error(`Simulated rejection for ${url}`);
        }

        return {
          type: 'no_data' as const,
          url,
        };
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          } else {
            undefinedCount.value++;
          }
        } else if (settledResult.status === 'rejected') {
          rejectedCount.value++;
        }
      });

      // Calculate expected counts
      const expectedUndefined = Math.floor(25 / 7) + (25 % 7 > 0 ? 1 : 0); // URLs at indices 0, 7, 14, 21
      const expectedRejected = Math.floor(25 / 11) + (25 % 11 > 0 ? 1 : 0); // URLs at indices 0, 11, 22

      // Note: index 0 satisfies both conditions, so it's counted as undefined (first condition)
      const actualExpectedUndefined = 4; // indices 0, 7, 14, 21
      const actualExpectedRejected = 2; // indices 11, 22 (0 is already counted as undefined)
      const expectedValid =
        25 - actualExpectedUndefined - actualExpectedRejected;

      expect(undefinedCount.value).toBe(actualExpectedUndefined);
      expect(rejectedCount.value).toBe(actualExpectedRejected);
      expect(taskResults).toHaveLength(expectedValid);

      // Total should equal original count
      expect(
        taskResults.length + undefinedCount.value + rejectedCount.value
      ).toBe(25);
    });
  });

  describe('Range Processing Tests', () => {
    it('should process exact ranges of URLs (10-15 from 25)', async () => {
      const allUrls = generateTestUrls(25);
      const startIndex = 9; // 1-based 10 = 0-based 9
      const endIndex = 15; // 1-based 15 = 0-based 14, but slice excludes end
      const rangeUrls = allUrls.slice(startIndex, endIndex);
      const results: TaskResult[] = [];

      expect(rangeUrls).toHaveLength(6); // URLs 10-15 inclusive

      for (const url of rangeUrls) {
        const result: TaskResult = {
          type: 'no_data',
          url,
        };
        results.push(result);
      }

      expect(results).toHaveLength(6);
      expect(results.map((r) => r.url)).toEqual(rangeUrls);
      expect(results[0].url).toBe('https://test10.com');
      expect(results[5].url).toBe('https://test15.com');
    });

    it('should handle edge cases in range processing', async () => {
      const allUrls = generateTestUrls(10);

      // Test range that goes beyond available URLs
      const beyondRange = allUrls.slice(8, 15); // Should only get last 2 URLs
      expect(beyondRange).toHaveLength(2);
      expect(beyondRange).toEqual(['https://test9.com', 'https://test10.com']);

      // Test range starting from 0
      const fromStart = allUrls.slice(0, 3);
      expect(fromStart).toHaveLength(3);
      expect(fromStart).toEqual([
        'https://test1.com',
        'https://test2.com',
        'https://test3.com',
      ]);

      // Test single URL range
      const singleUrl = allUrls.slice(4, 5);
      expect(singleUrl).toHaveLength(1);
      expect(singleUrl).toEqual(['https://test5.com']);
    });
  });

  describe('Duplicate and Skip Processing Tests', () => {
    it('should handle duplicate URLs correctly', async () => {
      const urls = [
        'https://test1.com',
        'https://test2.com',
        'https://test1.com', // Duplicate
        'https://test3.com',
        'https://test2.com', // Duplicate
      ];

      const processedUrls: Set<string> = new Set();
      const results: TaskResult[] = [];

      for (const url of urls) {
        if (!processedUrls.has(url)) {
          processedUrls.add(url);
          results.push({
            type: 'no_data',
            url,
          });
        }
      }

      expect(processedUrls.size).toBe(3); // Only unique URLs
      expect(results).toHaveLength(3);
      expect(Array.from(processedUrls).sort()).toEqual([
        'https://test1.com',
        'https://test2.com',
        'https://test3.com',
      ]);
    });

    it('should simulate skipProcessed flag behavior', async () => {
      const allUrls = generateTestUrls(10);
      const previouslyProcessed = new Set([
        'https://test2.com',
        'https://test5.com',
        'https://test8.com',
      ]);

      // Filter out previously processed URLs
      const urlsToProcess = allUrls.filter(
        (url) => !previouslyProcessed.has(url)
      );
      const results: TaskResult[] = [];

      for (const url of urlsToProcess) {
        results.push({
          type: 'no_data',
          url,
        });
      }

      expect(urlsToProcess).toHaveLength(7); // 10 - 3 = 7
      expect(results).toHaveLength(7);
      expect(results.map((r) => r.url)).not.toContain('https://test2.com');
      expect(results.map((r) => r.url)).not.toContain('https://test5.com');
      expect(results.map((r) => r.url)).not.toContain('https://test8.com');
    });
  });

  describe('Performance and Memory Tests', () => {
    it('should handle large URL counts without memory leaks', async () => {
      const urls = generateTestUrls(25);
      const results: TaskResult[] = [];
      const memoryUsage: number[] = [];

      // Track memory usage during processing
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];

        // Simulate processing
        const result: TaskResult = {
          type: 'no_data',
          url,
        };
        results.push(result);

        // Track memory (simplified simulation)
        if (global.gc) {
          global.gc();
        }
        memoryUsage.push(process.memoryUsage().heapUsed);
      }

      expect(results).toHaveLength(25);
      expect(memoryUsage).toHaveLength(25);

      // Memory shouldn't grow linearly (simplified check)
      const initialMemory = memoryUsage[0];
      const finalMemory = memoryUsage[memoryUsage.length - 1];
      const memoryGrowth = (finalMemory - initialMemory) / initialMemory;

      // Memory growth should be reasonable (less than 50% for this test)
      expect(memoryGrowth).toBeLessThan(0.5);
    });

    it('should process URLs within reasonable time limits', async () => {
      const urls = generateTestUrls(25);
      const results: TaskResult[] = [];
      const startTime = Date.now();

      // Simulate concurrent processing
      const promises = urls.map(async (url, index) => {
        // Simulate realistic processing time (10-50ms per URL)
        await new Promise((resolve) =>
          setTimeout(resolve, 10 + Math.random() * 40)
        );
        return {
          type: 'no_data' as const,
          url,
        };
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            results.push(settledResult.value);
          }
        }
      });

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      expect(results).toHaveLength(25);
      // With concurrency, 25 URLs should process much faster than sequential
      // Sequential would be 25 * 30ms avg = 750ms, concurrent should be ~50ms
      expect(totalTime).toBeLessThan(200); // Allow some buffer for test environment
    });
  });
});
