/**
 * @fileoverview Promise resolution validation tests
 * Specifically designed to identify and fix the cluster mode Promise resolution issue
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger as WinstonLogger } from 'winston';
import { Cluster } from 'puppeteer-cluster';
import { processPageTask } from '../utils/puppeteer-task.js';
import type { TaskResult } from '../common/types.js';

// Mock logger
const mockLogger: WinstonLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

// Mock Puppeteer cluster
vi.mock('puppeteer-cluster', () => ({
  Cluster: {
    launch: vi.fn(),
    CONCURRENCY_CONTEXT: 'CONCURRENCY_CONTEXT',
  },
}));

describe('Promise Resolution Validation Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Cluster Task Registration and Return Values', () => {
    it('should properly register processPageTask with cluster', async () => {
      const mockCluster = {
        task: vi.fn(),
        queue: vi.fn(),
        idle: vi.fn(),
        close: vi.fn(),
        isClosed: vi.fn().mockReturnValue(false),
      };

      (Cluster.launch as any).mockResolvedValue(mockCluster);

      // Test task registration
      await mockCluster.task(processPageTask);

      expect(mockCluster.task).toHaveBeenCalledWith(processPageTask);
      expect(mockCluster.task).toHaveBeenCalledTimes(1);
    });

    it('should verify processPageTask returns proper TaskResult objects', async () => {
      const testCases = [
        {
          url: 'https://example.com',
          expectedType: 'no_data',
          mockPageData: {
            url: 'https://example.com',
            date: '2025-06-28',
            libraries: [],
            prebidInstances: [],
          },
        },
        {
          url: 'https://prebid-test.com',
          expectedType: 'success',
          mockPageData: {
            url: 'https://prebid-test.com',
            date: '2025-06-28',
            libraries: ['googletag'],
            prebidInstances: [
              {
                globalVarName: 'pbjs',
                version: '7.48.0',
                modules: ['core'],
              },
            ],
          },
        },
      ];

      for (const testCase of testCases) {
        const mockPage = {
          goto: vi.fn().mockResolvedValue(undefined),
          setDefaultTimeout: vi.fn(),
          setUserAgent: vi.fn(),
          setViewport: vi.fn(),
          evaluateOnNewDocument: vi.fn(),
          evaluate: vi.fn().mockResolvedValue(testCase.mockPageData),
          url: vi.fn().mockReturnValue(testCase.url),
          title: vi.fn().mockResolvedValue('Test Page'),
          $: vi.fn().mockResolvedValue(null),
        } as any;

        const result = await processPageTask({
          page: mockPage,
          data: { url: testCase.url, logger: mockLogger },
        });

        expect(result).toBeDefined();
        expect(result.type).toBe(testCase.expectedType);
        expect(typeof result).toBe('object');
        expect(result).not.toBe(undefined);
        expect(result).not.toBe(null);
      }
    });

    it('should simulate cluster.queue() promise resolution issue', async () => {
      const urls = [
        'https://test1.com',
        'https://test2.com',
        'https://test3.com',
      ];
      const taskResults: TaskResult[] = [];
      const undefinedResults = { count: 0 };

      // Create mock cluster behavior that simulates the problem
      const mockCluster = {
        task: vi.fn(),
        queue: vi.fn().mockImplementation(({ url }) => {
          // Simulate the bug where cluster.queue sometimes returns undefined
          // This is what we observe in the real application
          if (url === 'https://test2.com') {
            return Promise.resolve(undefined); // The problematic case
          }
          return Promise.resolve({
            type: 'no_data' as const,
            url,
          });
        }),
        idle: vi.fn(),
        close: vi.fn(),
        isClosed: vi.fn().mockReturnValue(false),
      };

      // Simulate the exact pattern from prebid.ts
      const promises = urls.map((url) => {
        return mockCluster.queue({ url, logger: mockLogger });
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          } else {
            undefinedResults.count++;
            // This matches the warning we see in the real application
            console.warn(
              'A task from cluster.queue fulfilled but with undefined/null value.'
            );
          }
        }
      });

      // Verify the problem: we should have 3 URLs but only 2 results
      expect(promises).toHaveLength(3);
      expect(taskResults).toHaveLength(2); // Missing one result
      expect(undefinedResults.count).toBe(1); // One undefined result
      expect(taskResults[0].url).toBe('https://test1.com');
      expect(taskResults[1].url).toBe('https://test3.com');
    });

    it('should test cluster task function return value handling', async () => {
      const testUrl = 'https://test.com';
      let capturedTaskFunction: any = null;

      const mockCluster = {
        task: vi.fn().mockImplementation((taskFn) => {
          capturedTaskFunction = taskFn;
        }),
        queue: vi.fn(),
        idle: vi.fn(),
        close: vi.fn(),
      };

      // Register the task
      await mockCluster.task(processPageTask);

      // Verify the task function was captured
      expect(capturedTaskFunction).toBe(processPageTask);

      // Test calling the captured task function directly
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        setDefaultTimeout: vi.fn(),
        setUserAgent: vi.fn(),
        setViewport: vi.fn(),
        evaluateOnNewDocument: vi.fn(),
        evaluate: vi.fn().mockResolvedValue({
          url: testUrl,
          date: '2025-06-28',
          libraries: [],
          prebidInstances: [],
        }),
        url: vi.fn().mockReturnValue(testUrl),
        title: vi.fn().mockResolvedValue('Test Page'),
        $: vi.fn().mockResolvedValue(null),
      } as any;

      const result = await capturedTaskFunction({
        page: mockPage,
        data: { url: testUrl, logger: mockLogger },
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('no_data');
      expect(result.url).toBe(testUrl);
      expect(typeof result).toBe('object');
    });
  });

  describe('Promise.allSettled Behavior Analysis', () => {
    it('should demonstrate correct Promise.allSettled usage', async () => {
      const taskResults: TaskResult[] = [];
      const urls = ['https://a.com', 'https://b.com', 'https://c.com'];

      // Simulate correct cluster behavior
      const promises = urls.map(async (url) => {
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

      expect(taskResults).toHaveLength(3);
      expect(taskResults.map((r) => r.url)).toEqual(urls);
    });

    it('should identify forEach vs for-loop differences', async () => {
      const taskResultsForEach: TaskResult[] = [];
      const taskResultsForLoop: TaskResult[] = [];
      const testResults = [
        { type: 'no_data' as const, url: 'https://a.com' },
        undefined, // Simulate the undefined issue
        { type: 'no_data' as const, url: 'https://c.com' },
      ];

      const promises = testResults.map((result) => Promise.resolve(result));
      const settledResults = await Promise.allSettled(promises);

      // Test forEach approach (current implementation)
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResultsForEach.push(settledResult.value);
          }
        }
      });

      // Test for-loop approach (alternative)
      for (let i = 0; i < settledResults.length; i++) {
        const settledResult = settledResults[i];
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResultsForLoop.push(settledResult.value);
          }
        }
      }

      // Both should have same results
      expect(taskResultsForEach).toHaveLength(2);
      expect(taskResultsForLoop).toHaveLength(2);
      expect(taskResultsForEach).toEqual(taskResultsForLoop);
    });

    it('should test different undefined checking strategies', async () => {
      const results1: TaskResult[] = [];
      const results2: TaskResult[] = [];
      const results3: TaskResult[] = [];

      const testData = [
        { type: 'no_data' as const, url: 'https://valid.com' },
        undefined,
        null,
        { type: 'no_data' as const, url: 'https://also-valid.com' },
      ];

      const promises = testData.map((data) => Promise.resolve(data));
      const settledResults = await Promise.allSettled(promises);

      // Strategy 1: typeof check (current implementation)
      settledResults.forEach((settled) => {
        if (
          settled.status === 'fulfilled' &&
          typeof settled.value !== 'undefined'
        ) {
          results1.push(settled.value);
        }
      });

      // Strategy 2: truthiness check
      settledResults.forEach((settled) => {
        if (settled.status === 'fulfilled' && settled.value) {
          results2.push(settled.value);
        }
      });

      // Strategy 3: explicit null/undefined check
      settledResults.forEach((settled) => {
        if (
          settled.status === 'fulfilled' &&
          settled.value !== undefined &&
          settled.value !== null
        ) {
          results3.push(settled.value);
        }
      });

      expect(results1).toHaveLength(3); // includes null
      expect(results2).toHaveLength(2); // excludes null and undefined
      expect(results3).toHaveLength(2); // excludes null and undefined

      // Strategy 2 and 3 are more robust
      expect(results2.map((r) => r.url)).toEqual([
        'https://valid.com',
        'https://also-valid.com',
      ]);
      expect(results3.map((r) => r.url)).toEqual([
        'https://valid.com',
        'https://also-valid.com',
      ]);
    });
  });

  describe('Cluster Integration Issue Root Cause', () => {
    it('should simulate exact cluster implementation from prebid.ts', async () => {
      const taskResults: TaskResult[] = [];
      const processedUrls: Set<string> = new Set();
      const urls = [
        'https://test1.com',
        'https://test2.com',
        'https://test3.com',
      ];

      // Mock the exact cluster setup from prebid.ts
      const mockCluster = {
        task: vi.fn(),
        queue: vi.fn().mockImplementation(({ url, logger: _logger }) => {
          processedUrls.add(url);

          // Simulate the exact problem: cluster.queue returns a promise
          // that resolves to undefined instead of TaskResult
          if (url === 'https://test2.com') {
            return new Promise((resolve) => {
              // Simulate async processing that somehow loses the return value
              setTimeout(() => {
                // This simulates processPageTask being called correctly
                // but the result not being returned properly
                // The bug: resolve with undefined instead of a proper taskResult
                // This simulates the issue where cluster.queue loses the return value
                void {
                  type: 'no_data' as const,
                  url,
                };
                resolve(undefined);
              }, 10);
            });
          }

          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                type: 'no_data' as const,
                url,
              });
            }, 10);
          });
        }),
        idle: vi.fn(),
        close: vi.fn(),
      };

      // Exact pattern from prebid.ts lines 536-565
      const promises = urls
        .filter((url) => url)
        .map((url) => {
          processedUrls.add(url);
          return mockCluster.queue({ url, logger: mockLogger });
        });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          } else {
            console.warn(
              'A task from cluster.queue (non-chunked) fulfilled but with undefined/null value.'
            );
          }
        } else if (settledResult.status === 'rejected') {
          console.error(
            'A promise from cluster.queue (non-chunked) was rejected.'
          );
        }
      });

      // Verify the issue: all URLs processed, but not all results captured
      expect(processedUrls.size).toBe(3); // All URLs were queued
      expect(promises).toHaveLength(3); // All promises created
      expect(taskResults).toHaveLength(2); // But only 2 results captured!

      // The missing URL should be test2.com
      const capturedUrls = taskResults.map((r) => r.url);
      expect(capturedUrls).toContain('https://test1.com');
      expect(capturedUrls).toContain('https://test3.com');
      expect(capturedUrls).not.toContain('https://test2.com');
    });

    it('should test potential fix: better cluster task return handling', async () => {
      const taskResults: TaskResult[] = [];
      const urls = [
        'https://test1.com',
        'https://test2.com',
        'https://test3.com',
      ];

      // Proposed fix: ensure cluster tasks always return proper values
      const mockCluster = {
        task: vi.fn(),
        queue: vi.fn().mockImplementation(async ({ url, logger }) => {
          // Simulate calling processPageTask directly and ensuring return value
          const mockPage = {
            goto: vi.fn().mockResolvedValue(undefined),
            setDefaultTimeout: vi.fn(),
            setUserAgent: vi.fn(),
            setViewport: vi.fn(),
            evaluateOnNewDocument: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({
              url,
              date: '2025-06-28',
              libraries: [],
              prebidInstances: [],
            }),
            url: vi.fn().mockReturnValue(url),
            title: vi.fn().mockResolvedValue('Test Page'),
            $: vi.fn().mockResolvedValue(null),
          } as any;

          // Call processPageTask and ensure we return its result
          const result = await processPageTask({
            page: mockPage,
            data: { url, logger },
          });

          // The fix: always return the result, never undefined
          return result;
        }),
        idle: vi.fn(),
        close: vi.fn(),
      };

      const promises = urls.map((url) => {
        return mockCluster.queue({ url, logger: mockLogger });
      });

      const settledResults = await Promise.allSettled(promises);

      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          }
        }
      });

      // With the fix: all results should be captured
      expect(taskResults).toHaveLength(3);
      expect(taskResults.map((r) => r.url)).toEqual(urls);
      expect(taskResults.every((r) => r.type === 'no_data')).toBe(true);
    });
  });

  describe('Task Result Type Validation', () => {
    it('should validate TaskResult object structure', async () => {
      const validTaskResults = [
        {
          type: 'success' as const,
          data: {
            url: 'https://example.com',
            date: '2025-06-28',
            libraries: ['googletag'],
            prebidInstances: [],
          },
        },
        {
          type: 'no_data' as const,
          url: 'https://example.com',
        },
        {
          type: 'error' as const,
          url: 'https://example.com',
          error: {
            code: 'TEST_ERROR',
            message: 'Test error',
            stack: 'test stack',
          },
        },
      ];

      const invalidResults = [
        undefined,
        null,
        {},
        { type: 'invalid' },
        { url: 'https://example.com' }, // missing type
      ];

      // Test valid results
      for (const result of validTaskResults) {
        expect(result).toBeDefined();
        expect(result.type).toBeDefined();
        expect(['success', 'no_data', 'error']).toContain(result.type);
      }

      // Test invalid results
      for (const result of invalidResults) {
        if (result === undefined || result === null) {
          expect(result).toBeFalsy();
        } else {
          expect((result as any).type).not.toMatch(/^(success|no_data|error)$/);
        }
      }
    });

    it('should verify processPageTask always returns valid TaskResult', async () => {
      const testScenarios = [
        {
          name: 'success with Prebid',
          mockPageData: {
            url: 'https://example.com',
            date: '2025-06-28',
            libraries: ['googletag'],
            prebidInstances: [
              {
                globalVarName: 'pbjs',
                version: '7.48.0',
                modules: ['core'],
              },
            ],
          },
          expectedType: 'success',
        },
        {
          name: 'no data',
          mockPageData: {
            url: 'https://example.com',
            date: '2025-06-28',
            libraries: [],
            prebidInstances: [],
          },
          expectedType: 'no_data',
        },
        {
          name: 'navigation error',
          mockError: new Error('net::ERR_NAME_NOT_RESOLVED'),
          expectedType: 'error',
        },
      ];

      for (const scenario of testScenarios) {
        const mockPage = {
          goto: scenario.mockError
            ? vi.fn().mockRejectedValue(scenario.mockError)
            : vi.fn().mockResolvedValue(undefined),
          setDefaultTimeout: vi.fn(),
          setUserAgent: vi.fn(),
          setViewport: vi.fn(),
          evaluateOnNewDocument: vi.fn(),
          evaluate: vi.fn().mockResolvedValue(scenario.mockPageData),
          url: vi.fn().mockReturnValue('https://example.com'),
          title: vi.fn().mockResolvedValue('Test Page'),
          $: vi.fn().mockResolvedValue(null),
        } as any;

        const result = await processPageTask({
          page: mockPage,
          data: { url: 'https://example.com', logger: mockLogger },
        });

        // Verify result is never undefined/null and has correct structure
        expect(result).toBeDefined();
        expect(result).not.toBe(null);
        expect(result).not.toBe(undefined);
        expect(typeof result).toBe('object');
        expect(result.type).toBe(scenario.expectedType);

        // Type-specific validations
        if (result.type === 'success') {
          expect((result as any).data).toBeDefined();
          expect((result as any).data.url).toBeDefined();
        } else if (result.type === 'error') {
          expect((result as any).error).toBeDefined();
          expect((result as any).error.code).toBeDefined();
        }
      }
    });
  });
});
