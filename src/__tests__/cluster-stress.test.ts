/**
 * @fileoverview Stress tests for cluster processing to identify concurrency issues
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import puppeteer from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';
import { processUrlsWithRecovery } from '../utils/cluster-wrapper.js';
import winston from 'winston';
import * as os from 'os';

// Create a test logger
const testLogger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

describe('Cluster Stress Tests', () => {
  const cpuCount = os.cpus().length;

  describe('High Concurrency Tests', () => {
    it('should handle high concurrency without crashes', async () => {
      // Create many URLs that will cause various behaviors
      const urls = Array.from({ length: 50 }, (_, i) => {
        if (i % 10 === 0) return 'https://httpstat.us/500'; // Server errors
        if (i % 7 === 0) return 'https://httpstat.us/200?sleep=2000'; // Slow responses
        if (i % 5 === 0) return `https://invalid-domain-${i}.test`; // DNS errors
        return `https://httpbin.org/html`; // Normal pages
      });

      const startTime = Date.now();
      const results = await processUrlsWithRecovery(
        urls,
        {
          concurrency: Math.min(cpuCount * 2, 10), // High concurrency
          maxConcurrency: Math.min(cpuCount * 2, 10),
          monitor: false,
          puppeteer,
          puppeteerOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
          },
          logger: testLogger,
          maxRetries: 1,
        },
        (processed, total) => {
          console.log(`Progress: ${processed}/${total}`);
        }
      );

      const duration = Date.now() - startTime;

      expect(results.length).toBe(urls.length);
      expect(duration).toBeLessThan(60000); // Should complete within 60 seconds

      // Analyze results
      const successCount = results.filter(
        (r) => r.type === 'success' || r.type === 'no_data'
      ).length;
      const errorCount = results.filter((r) => r.type === 'error').length;

      console.log(`Stress test completed in ${duration}ms`);
      console.log(`Success: ${successCount}, Errors: ${errorCount}`);

      expect(successCount).toBeGreaterThan(0);
      expect(errorCount).toBeGreaterThan(0);
    }, 60000);

    it('should handle rapid URL processing without frame errors', async () => {
      // URLs that will navigate quickly
      const urls = Array.from(
        { length: 20 },
        (_, i) => `data:text/html,<html><body>Page ${i}</body></html>`
      );

      let frameErrors = 0;
      const results = await processUrlsWithRecovery(urls, {
        concurrency: 5,
        maxConcurrency: 5,
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
        15
      );
    }, 30000);
  });

  describe('Resource Limit Tests', () => {
    it('should handle memory pressure gracefully', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create URLs that will load heavy content
      const urls = Array.from(
        { length: 20 },
        () => 'https://httpbin.org/image/jpeg' // Returns images
      );

      const results = await processUrlsWithRecovery(urls, {
        concurrency: 3,
        maxConcurrency: 3,
        monitor: false,
        puppeteer,
        puppeteerOptions: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--max-old-space-size=256', // Limit memory
          ],
        },
        logger: testLogger,
        maxRetries: 0,
      });

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`Memory growth: ${memoryGrowth.toFixed(2)} MB`);

      expect(results.length).toBe(urls.length);
      expect(memoryGrowth).toBeLessThan(500); // Less than 500MB growth
    }, 60000);
  });

  describe('Error Recovery Tests', () => {
    it('should recover from systematic failures', async () => {
      let clusterCrashes = 0;

      // URLs designed to cause various failures
      const problematicUrls = [
        'chrome://crash', // Will crash the page
        'about:crash', // Will crash the page
        'https://localhost:99999', // Connection refused
        'https://0.0.0.0', // Invalid
        'javascript:while(true){}', // Infinite loop
        'https://example.com', // Valid URL for comparison
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
            if (message.includes('cluster')) {
              clusterCrashes++;
            }
            testLogger.error(message, ...args);
          },
        } as any,
        maxRetries: 0,
      });

      expect(results.length).toBe(problematicUrls.length);
      expect(
        results.every((r) => r.type === 'error' || r.type === 'no_data')
      ).toBe(false);
      console.log(`Cluster crashes during test: ${clusterCrashes}`);
    }, 30000);

    it('should handle navigation timing issues', async () => {
      // Create a mock server that delays responses
      const urls = Array.from({ length: 10 }, (_, i) => {
        // Mix of fast and slow responses
        const delay = i % 3 === 0 ? 3000 : 100;
        return `https://httpstat.us/200?sleep=${delay}`;
      });

      const navigationErrors: string[] = [];
      const results = await processUrlsWithRecovery(urls, {
        concurrency: 5,
        maxConcurrency: 5,
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

      expect(results.length).toBe(urls.length);
      console.log(`Navigation errors: ${navigationErrors.length}`);

      // Should handle timeouts gracefully
      const timeoutErrors = results.filter(
        (r) => r.type === 'error' && r.error.message?.includes('timeout')
      );
      expect(timeoutErrors.length).toBeLessThan(urls.length / 2);
    }, 45000);
  });

  describe('Concurrent Operation Tests', () => {
    it('should handle multiple batch operations simultaneously', async () => {
      const batches = [
        ['https://example.com', 'https://google.com'],
        ['https://httpbin.org/html', 'https://httpbin.org/json'],
        ['https://github.com', 'https://stackoverflow.com'],
      ];

      // Process all batches concurrently
      const batchPromises = batches.map(async (batch, index) => {
        const results = await processUrlsWithRecovery(batch, {
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
            info: (msg: string) => testLogger.info(`[Batch ${index}] ${msg}`),
          } as any,
          maxRetries: 1,
        });
        return { batchIndex: index, results };
      });

      const allResults = await Promise.all(batchPromises);

      expect(allResults.length).toBe(batches.length);
      allResults.forEach(({ batchIndex, results }) => {
        expect(results.length).toBe(batches[batchIndex].length);
      });
    }, 45000);
  });
});
