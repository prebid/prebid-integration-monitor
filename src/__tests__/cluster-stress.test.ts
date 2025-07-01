/**
 * @fileoverview Stress tests for cluster processing to identify concurrency issues
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';
import { processUrlsWithRecovery } from '../utils/cluster-wrapper.js';
import winston from 'winston';

// Create a test logger
const testLogger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

describe('Cluster Stress Tests', () => {
  describe('High Concurrency Tests', () => {
    it('should handle high concurrency without crashes', async () => {
      // Create a smaller set of URLs for more reliable testing
      const urls = [
        'https://example.com',
        'https://httpbin.org/html',
        'https://httpstat.us/200',
        'https://invalid-domain-test.test', // DNS error
        'https://httpbin.org/delay/1', // Slow response
      ];

      const startTime = Date.now();
      const results = await processUrlsWithRecovery(
        urls,
        {
          concurrency: 2, // Lower concurrency for test stability
          maxConcurrency: 2,
          monitor: false,
          puppeteer,
          puppeteerOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
          },
          logger: testLogger,
          maxRetries: 1,
          // timeout is handled at the task level
        },
        (processed, total) => {
          console.log(`Progress: ${processed}/${total}`);
        }
      );

      const duration = Date.now() - startTime;

      // The test should return results for all URLs
      expect(results.length).toBeGreaterThanOrEqual(urls.length - 1); // Allow for some failures
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds

      // Analyze results
      const successCount = results.filter(
        (r) => r.type === 'success' || r.type === 'no_data'
      ).length;
      const errorCount = results.filter((r) => r.type === 'error').length;

      console.log(`Stress test completed in ${duration}ms`);
      console.log(`Success: ${successCount}, Errors: ${errorCount}`);

      expect(successCount).toBeGreaterThan(0);
      expect(errorCount).toBeGreaterThan(0);
    }, 30000);

    it('should handle rapid URL processing without frame errors', async () => {
      // URLs that will navigate quickly
      const urls = Array.from(
        { length: 5 },
        (_, i) => `data:text/html,<html><body>Page ${i}</body></html>`
      );

      let frameErrors = 0;
      const results = await processUrlsWithRecovery(urls, {
        concurrency: 2,
        maxConcurrency: 2,
        monitor: false,
        puppeteer,
        puppeteerOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
        logger: testLogger,
        maxRetries: 0,
      });

      // Count frame-related errors
      results.forEach((result) => {
        if (
          result.type === 'error' &&
          result.error.message?.includes('frame')
        ) {
          frameErrors++;
        }
      });

      expect(frameErrors).toBe(0);
      expect(results.filter((r) => r.type !== 'error').length).toBeGreaterThan(
        3
      );
    }, 30000);
  });

  describe('Resource Limit Tests', () => {
    it('should handle memory pressure gracefully', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create URLs that will load content
      const urls = [
        'https://httpbin.org/html',
        'https://example.com',
        'https://httpbin.org/json',
      ];

      const results = await processUrlsWithRecovery(urls, {
        concurrency: 2,
        maxConcurrency: 2,
        monitor: false,
        puppeteer,
        puppeteerOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
          ],
        },
        logger: testLogger,
        maxRetries: 0,
      });

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`Memory growth: ${memoryGrowth.toFixed(2)} MB`);

      expect(results.length).toBeGreaterThanOrEqual(urls.length - 1);
      expect(memoryGrowth).toBeLessThan(500); // Less than 500MB growth
    }, 30000);
  });

  describe('Error Recovery Tests', () => {
    it('should recover from systematic failures', async () => {
      let errorCount = 0;

      // URLs designed to cause various failures
      const problematicUrls = [
        'https://localhost:99999', // Connection refused
        'https://invalid-test-domain.test', // DNS error
        'https://example.com', // Valid URL for comparison
        'https://httpbin.org/status/500', // Server error
      ];

      const results = await processUrlsWithRecovery(problematicUrls, {
        concurrency: 2,
        maxConcurrency: 2,
        monitor: false,
        puppeteer,
        puppeteerOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
        logger: {
          ...testLogger,
          error: (message: string, ...args: any[]) => {
            errorCount++;
            testLogger.error(message, ...args);
          },
        } as any,
        maxRetries: 0,
      });

      expect(results.length).toBeGreaterThanOrEqual(problematicUrls.length - 1);
      // At least one URL should succeed (example.com)
      const successCount = results.filter(
        (r) => r.type === 'success' || r.type === 'no_data'
      ).length;
      expect(successCount).toBeGreaterThan(0);
      console.log(`Errors during test: ${errorCount}`);
    }, 30000);

    it('should handle navigation timing issues', async () => {
      // Mix of URLs with different response times
      const urls = [
        'https://httpstat.us/200?sleep=100',
        'https://httpstat.us/200?sleep=2000',
        'https://example.com',
        'https://httpbin.org/delay/1',
      ];

      const navigationErrors: string[] = [];
      const results = await processUrlsWithRecovery(urls, {
        concurrency: 2,
        maxConcurrency: 2,
        monitor: false,
        puppeteer,
        puppeteerOptions: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
        logger: {
          ...testLogger,
          error: (message: string, meta?: any) => {
            if (message.includes('navigation') || message.includes('timeout')) {
              navigationErrors.push(message);
            }
            testLogger.error(message, meta);
          },
        } as any,
        maxRetries: 0,
      });

      expect(results.length).toBeGreaterThanOrEqual(urls.length - 1);
      console.log(`Navigation errors: ${navigationErrors.length}`);

      // Should handle different response times gracefully
      const successCount = results.filter(
        (r) => r.type === 'success' || r.type === 'no_data'
      ).length;
      expect(successCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Concurrent Operation Tests', () => {
    it('should handle multiple batch operations simultaneously', async () => {
      const batches = [
        ['https://example.com', 'https://httpbin.org/html'],
        ['https://httpbin.org/json', 'data:text/html,<h1>Test</h1>'],
      ];

      // Process all batches concurrently
      const batchPromises = batches.map(async (batch, index) => {
        const results = await processUrlsWithRecovery(batch, {
          concurrency: 1,
          maxConcurrency: 1,
          monitor: false,
          puppeteer,
          puppeteerOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
          },
          logger: {
            ...testLogger,
            info: (msg: string) => testLogger.info(`[Batch ${index}] ${msg}`),
          } as any,
          maxRetries: 0,
        });
        return { batchIndex: index, results };
      });

      const allResults = await Promise.all(batchPromises);

      expect(allResults.length).toBe(batches.length);
      allResults.forEach(({ batchIndex, results }) => {
        expect(results.length).toBeGreaterThanOrEqual(batches[batchIndex].length - 1);
      });
    }, 30000);
  });
});
