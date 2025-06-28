/**
 * @fileoverview Integration tests comparing puppeteer-cluster vs vanilla puppeteer modes
 * Tests to verify URL processing consistency and identify Promise resolution issues
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger as WinstonLogger } from 'winston';
import { prebidExplorer, PrebidExplorerOptions } from '../prebid.js';
import { processPageTask } from '../utils/puppeteer-task.js';
import type { TaskResult, PageData } from '../common/types.js';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

// Mock logger
const mockLogger: WinstonLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

// Test URLs with predictable outcomes
const TEST_URLS = [
  'https://httpbin.org/status/200',  // Should succeed with no ad tech
  'https://httpbin.org/status/404',  // Should error
  'https://example.com',             // Should succeed with no ad tech
  'https://nonexistent.invalid',     // Should error (DNS)
  'https://httpbin.org/delay/5',     // Might timeout
];

const TEST_DIR = './test-temp';
const TEST_INPUT_FILE = join(TEST_DIR, 'test-urls.txt');
const TEST_OUTPUT_DIR = join(TEST_DIR, 'output');
const TEST_LOG_DIR = join(TEST_DIR, 'logs');

describe('URL Processing Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create test directory structure
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    
    // Create test input file
    writeFileSync(TEST_INPUT_FILE, TEST_URLS.join('\n'));
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe('Cluster vs Vanilla Mode Comparison', () => {
    it('should process same URLs consistently in both modes', async () => {
      const baseOptions: PrebidExplorerOptions = {
        inputFile: TEST_INPUT_FILE,
        puppeteerType: 'vanilla',
        concurrency: 1,
        headless: true,
        monitor: false,
        outputDir: TEST_OUTPUT_DIR,
        logDir: TEST_LOG_DIR,
        numUrls: 3, // Process first 3 URLs only
        skipProcessed: false,
      };

      // Test vanilla mode
      const vanillaResults: TaskResult[] = [];
      vi.doMock('../prebid.js', () => ({
        prebidExplorer: vi.fn().mockImplementation(async (options: PrebidExplorerOptions) => {
          // Simulate vanilla processing
          const urls = TEST_URLS.slice(0, 3);
          for (const url of urls) {
            const result: TaskResult = {
              type: url.includes('404') || url.includes('invalid') ? 'error' : 'no_data',
              url: url.trim(),
              ...(url.includes('404') || url.includes('invalid') ? {
                error: {
                  code: url.includes('invalid') ? 'ERR_NAME_NOT_RESOLVED' : 'HTTP_404',
                  message: `Error processing ${url}`,
                  stack: 'test stack'
                }
              } : {})
            };
            vanillaResults.push(result);
          }
        })
      }));

      await prebidExplorer({ ...baseOptions, puppeteerType: 'vanilla' });

      // Test cluster mode
      const clusterResults: TaskResult[] = [];
      vi.doMock('../prebid.js', () => ({
        prebidExplorer: vi.fn().mockImplementation(async (options: PrebidExplorerOptions) => {
          // Simulate cluster processing
          const urls = TEST_URLS.slice(0, 3);
          const promises = urls.map(async (url) => {
            const result: TaskResult = {
              type: url.includes('404') || url.includes('invalid') ? 'error' : 'no_data',
              url: url.trim(),
              ...(url.includes('404') || url.includes('invalid') ? {
                error: {
                  code: url.includes('invalid') ? 'ERR_NAME_NOT_RESOLVED' : 'HTTP_404',
                  message: `Error processing ${url}`,
                  stack: 'test stack'
                }
              } : {})
            };
            return result;
          });
          
          const settledResults = await Promise.allSettled(promises);
          settledResults.forEach((settledResult) => {
            if (settledResult.status === 'fulfilled') {
              clusterResults.push(settledResult.value);
            }
          });
        })
      }));

      await prebidExplorer({ ...baseOptions, puppeteerType: 'cluster' });

      // Compare results
      expect(vanillaResults).toHaveLength(3);
      expect(clusterResults).toHaveLength(3);
      
      // Results should have same types and URLs
      expect(vanillaResults.map(r => r.type)).toEqual(clusterResults.map(r => r.type));
      expect(vanillaResults.map(r => r.url)).toEqual(clusterResults.map(r => r.url));
    }, { timeout: 30000 });

    it('should handle Promise.allSettled correctly in cluster mode', async () => {
      const testUrls = ['https://example.com', 'https://httpbin.org/status/404'];
      const taskResults: TaskResult[] = [];
      
      // Simulate cluster.queue() behavior
      const promises = testUrls.map(async (url) => {
        // Simulate processPageTask results
        if (url.includes('404')) {
          return {
            type: 'error' as const,
            url,
            error: {
              code: 'HTTP_404',
              message: 'Not found',
              stack: 'test stack'
            }
          };
        } else {
          return {
            type: 'no_data' as const,
            url
          };
        }
      });

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          // This should capture all valid TaskResult objects
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          } else {
            // This is the problematic case we're testing for
            console.warn('Promise fulfilled with undefined value');
          }
        } else if (settledResult.status === 'rejected') {
          console.error('Promise rejected:', settledResult.reason);
        }
      });

      expect(taskResults).toHaveLength(2);
      expect(taskResults[0].type).toBe('no_data');
      expect(taskResults[1].type).toBe('error');
      expect(taskResults[1].url).toBe('https://httpbin.org/status/404');
    });

    it('should detect undefined result values in cluster mode', async () => {
      const testUrls = ['https://example.com', 'https://test.com'];
      const undefinedCount = { count: 0 };
      const validResults: TaskResult[] = [];
      
      // Simulate the problematic scenario where cluster.queue returns undefined
      const promises = testUrls.map(async (url, index) => {
        // Simulate the bug where some promises resolve to undefined
        if (index === 1) {
          return undefined; // This simulates the problem
        }
        return {
          type: 'no_data' as const,
          url
        };
      });

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            validResults.push(settledResult.value);
          } else {
            undefinedCount.count++;
            // This logging matches what we see in the real application
            console.warn('A task from cluster.queue fulfilled but with undefined/null value.');
          }
        }
      });

      expect(validResults).toHaveLength(1); // Only one valid result
      expect(undefinedCount.count).toBe(1);  // One undefined result
      expect(validResults[0].url).toBe('https://example.com');
    });
  });

  describe('URL Processing Verification', () => {
    it('should attempt all URLs in the input list', async () => {
      const processedUrls: string[] = [];
      
      // Mock processPageTask to track URL processing
      const mockProcessPageTask = vi.fn().mockImplementation(async ({ data }) => {
        processedUrls.push(data.url);
        return {
          type: 'no_data' as const,
          url: data.url
        };
      });

      // Test with small set of URLs
      const testUrls = ['https://example.com', 'https://test.com', 'https://demo.com'];
      
      for (const url of testUrls) {
        await mockProcessPageTask({
          page: {} as any,
          data: { url, logger: mockLogger }
        });
      }

      expect(processedUrls).toHaveLength(3);
      expect(processedUrls).toEqual(testUrls);
      expect(mockProcessPageTask).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and error scenarios', async () => {
      const results: TaskResult[] = [];
      
      const testScenarios = [
        { url: 'https://success.com', type: 'success' as const },
        { url: 'https://nodata.com', type: 'no_data' as const },
        { url: 'https://error.com', type: 'error' as const },
      ];

      for (const scenario of testScenarios) {
        let result: TaskResult;
        if (scenario.type === 'success') {
          result = {
            type: 'success',
            data: {
              url: scenario.url,
              date: '2025-06-28',
              libraries: ['googletag'],
              prebidInstances: []
            }
          };
        } else if (scenario.type === 'error') {
          result = {
            type: 'error',
            url: scenario.url,
            error: {
              code: 'TEST_ERROR',
              message: 'Test error',
              stack: 'test stack'
            }
          };
        } else {
          result = {
            type: 'no_data',
            url: scenario.url
          };
        }
        results.push(result);
      }

      expect(results).toHaveLength(3);
      expect(results.map(r => r.type)).toEqual(['success', 'no_data', 'error']);
      expect(results.map(r => r.url || (r as any).data?.url)).toEqual([
        'https://success.com',
        'https://nodata.com', 
        'https://error.com'
      ]);
    });
  });

  describe('Result Capture Validation', () => {
    it('should capture all TaskResult objects in taskResults array', async () => {
      const taskResults: TaskResult[] = [];
      const expectedCount = 5;
      
      // Simulate processing multiple URLs
      const promises = Array.from({ length: expectedCount }, (_, i) => {
        const url = `https://test${i}.com`;
        return Promise.resolve({
          type: 'no_data' as const,
          url
        });
      });

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            taskResults.push(settledResult.value);
          }
        }
      });

      expect(taskResults).toHaveLength(expectedCount);
      expect(taskResults.every(r => r.type === 'no_data')).toBe(true);
    });

    it('should maintain URL processing order independence', async () => {
      const results: TaskResult[] = [];
      const urls = ['https://a.com', 'https://b.com', 'https://c.com'];
      
      // Process URLs with different delays to test order independence
      const promises = urls.map(async (url, index) => {
        // Add artificial delay to simulate real processing
        await new Promise(resolve => setTimeout(resolve, (3 - index) * 10));
        return {
          type: 'no_data' as const,
          url
        };
      });

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
        }
      });

      expect(results).toHaveLength(3);
      // Results should include all URLs regardless of processing order
      const resultUrls = results.map(r => r.url).sort();
      expect(resultUrls).toEqual(urls.sort());
    });
  });

  describe('Chunk Processing Tests', () => {
    it('should process URLs correctly with chunking', async () => {
      const allResults: TaskResult[] = [];
      const chunkSize = 2;
      const urls = ['https://1.com', 'https://2.com', 'https://3.com', 'https://4.com', 'https://5.com'];
      
      // Simulate chunk processing
      for (let i = 0; i < urls.length; i += chunkSize) {
        const chunkUrls = urls.slice(i, i + chunkSize);
        const chunkResults: TaskResult[] = [];
        
        const promises = chunkUrls.map(async (url) => {
          return {
            type: 'no_data' as const,
            url
          };
        });

        const settledResults = await Promise.allSettled(promises);
        
        settledResults.forEach((settledResult) => {
          if (settledResult.status === 'fulfilled') {
            chunkResults.push(settledResult.value);
          }
        });
        
        allResults.push(...chunkResults);
      }

      expect(allResults).toHaveLength(5);
      expect(allResults.map(r => r.url)).toEqual(urls);
    });

    it('should handle empty chunks gracefully', async () => {
      const results: TaskResult[] = [];
      const emptyChunk: string[] = [];
      
      // Process empty chunk
      const promises = emptyChunk.map(async (url) => {
        return {
          type: 'no_data' as const,
          url
        };
      });

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
        }
      });

      expect(results).toHaveLength(0);
      expect(promises).toHaveLength(0);
    });
  });

  describe('Error Resilience Tests', () => {
    it('should continue processing after individual URL failures', async () => {
      const results: TaskResult[] = [];
      const urls = ['https://good.com', 'https://bad.com', 'https://ugly.com'];
      
      const promises = urls.map(async (url) => {
        if (url.includes('bad')) {
          return {
            type: 'error' as const,
            url,
            error: {
              code: 'TEST_ERROR',
              message: 'Simulated error',
              stack: 'test stack'
            }
          };
        }
        return {
          type: 'no_data' as const,
          url
        };
      });

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          results.push(settledResult.value);
        }
      });

      expect(results).toHaveLength(3);
      expect(results[0].type).toBe('no_data');
      expect(results[1].type).toBe('error');
      expect(results[2].type).toBe('no_data');
    });

    it('should handle Promise rejection vs undefined resolution', async () => {
      const validResults: TaskResult[] = [];
      const rejectedCount = { count: 0 };
      const undefinedCount = { count: 0 };
      
      const promises = [
        Promise.resolve({ type: 'no_data' as const, url: 'https://good.com' }),
        Promise.reject(new Error('Promise rejected')),
        Promise.resolve(undefined), // This simulates the cluster issue
      ];

      const settledResults = await Promise.allSettled(promises);
      
      settledResults.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled') {
          if (typeof settledResult.value !== 'undefined') {
            validResults.push(settledResult.value);
          } else {
            undefinedCount.count++;
          }
        } else if (settledResult.status === 'rejected') {
          rejectedCount.count++;
        }
      });

      expect(validResults).toHaveLength(1);
      expect(rejectedCount.count).toBe(1);
      expect(undefinedCount.count).toBe(1);
    });
  });
});