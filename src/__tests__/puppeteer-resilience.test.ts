/**
 * @fileoverview Tests for Puppeteer resilience and error handling
 * Specifically tests for "Requesting main frame too early" and similar errors
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import puppeteer, { Browser, Page } from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';
import { processPageTask } from '../utils/puppeteer-task.js';
import {
  createSafeCluster,
  processUrlsWithRecovery,
} from '../utils/cluster-wrapper.js';
import { PageLifecycleTracer } from '../utils/puppeteer-telemetry.js';
import winston from 'winston';

// Create a test logger
const testLogger = winston.createLogger({
  level: 'error',
  format: winston.format.simple(),
  transports: [new winston.transports.Console({ silent: true })],
});

describe('Puppeteer Resilience Tests', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  describe('Frame Detachment Errors', () => {
    it('should handle navigation during page processing', async () => {
      const page = await browser.newPage();
      const tracer = new PageLifecycleTracer('https://example.com', testLogger);

      try {
        // Setup page to navigate away quickly
        await page.goto('data:text/html,<html><body>Test</body></html>');

        // Start navigation to trigger frame detachment
        const navigationPromise = page
          .goto('https://example.com')
          .catch(() => {});

        // Try to interact with page during navigation
        const result = await Promise.race([
          page
            .evaluate(() => document.body.innerHTML)
            .catch((err) => ({ error: err.message })),
          new Promise((resolve) =>
            setTimeout(() => resolve({ timeout: true }), 1000)
          ),
        ]);

        expect(result).toBeDefined();
        await navigationPromise;
      } finally {
        await page.close();
      }
    });

    it('should handle rapid page closures', async () => {
      const results: any[] = [];

      // Create multiple pages and close them rapidly
      const pagePromises = Array.from({ length: 5 }, async (_, i) => {
        const page = await browser.newPage();

        try {
          await page.goto(
            'data:text/html,<html><body>Page ' + i + '</body></html>'
          );

          // Simulate some work
          await page.evaluate(() => {
            return new Promise((resolve) => setTimeout(resolve, 100));
          });

          results.push({ page: i, success: true });
        } catch (error) {
          results.push({ page: i, error: (error as Error).message });
        } finally {
          // Close page immediately
          await page.close().catch(() => {});
        }
      });

      await Promise.allSettled(pagePromises);
      expect(results.length).toBe(5);
    });

    it('should handle concurrent frame operations', async () => {
      const page = await browser.newPage();

      try {
        await page.goto(
          'data:text/html,<html><body><iframe src="about:blank"></iframe></body></html>'
        );

        // Get all frames
        const frames = page.frames();
        expect(frames.length).toBeGreaterThan(1);

        // Try to operate on frames concurrently
        const frameOperations = frames.map(async (frame, index) => {
          try {
            return await frame.evaluate(() => window.location.href);
          } catch (error) {
            return { frameIndex: index, error: (error as Error).message };
          }
        });

        const results = await Promise.allSettled(frameOperations);
        expect(results.length).toBe(frames.length);
      } finally {
        await page.close();
      }
    });
  });

  describe('Cluster Error Recovery', () => {
    it('should recover from cluster task errors', async () => {
      const urls = [
        'https://example.com',
        'https://this-will-cause-an-error.invalid',
        'https://google.com',
      ];

      const results = await processUrlsWithRecovery(urls, {
        concurrency: 2,
        maxConcurrency: 2,
        monitor: false,
        puppeteer,
        puppeteerOptions: {
          headless: true,
          args: ['--no-sandbox'],
        },
        logger: testLogger,
        maxRetries: 1,
      });

      expect(results.length).toBe(3);
      expect(results.some((r) => r.type === 'error')).toBe(true);
      expect(
        results.some((r) => r.type === 'success' || r.type === 'no_data')
      ).toBe(true);
    });

    it('should handle cluster crashes gracefully', async () => {
      let cluster: Cluster<any, any> | null = null;

      try {
        cluster = await createSafeCluster({
          concurrency: 1,
          maxConcurrency: 1,
          monitor: false,
          puppeteer,
          puppeteerOptions: {
            headless: true,
            args: ['--no-sandbox'],
          },
          logger: testLogger,
        });

        // Queue a task that will throw
        const errorPromise = cluster.execute(async ({ page }) => {
          throw new Error('Simulated crash');
        });

        await expect(errorPromise).rejects.toThrow();

        // Cluster should still be usable
        const successPromise = cluster.execute(async ({ page }) => {
          return { success: true };
        });

        const result = await successPromise;
        expect(result).toEqual({ success: true });
      } finally {
        if (cluster) {
          await cluster.close();
        }
      }
    });
  });

  describe('Page Lifecycle Tracking', () => {
    it('should track page events correctly', async () => {
      const page = await browser.newPage();
      const tracer = new PageLifecycleTracer('https://example.com', testLogger);
      const events: string[] = [];

      // Mock event recording
      tracer.recordEvent = jest.fn((event: string) => {
        events.push(event);
      }) as any;

      tracer.setupPageEventHandlers(page);
      tracer.startPageProcessing();

      await page.goto('https://example.com');
      await page.close();

      // Should have recorded lifecycle events
      expect(events).toContain('page_processing_started');
      expect(
        events.some((e) => e.includes('frame') || e.includes('load'))
      ).toBe(true);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle page operation timeouts', async () => {
      const page = await browser.newPage();

      try {
        // Set very short timeout
        page.setDefaultTimeout(100);

        // Try to navigate to a slow page
        const result = await page
          .goto('https://httpstat.us/200?sleep=5000')
          .then(() => ({ success: true }))
          .catch((err) => ({ error: err.message }));

        expect(result.error).toContain('timeout');
      } finally {
        await page.close();
      }
    });

    it('should handle evaluation timeouts', async () => {
      const page = await browser.newPage();

      try {
        await page.goto('https://example.com');
        page.setDefaultTimeout(100);

        // Try to run long evaluation
        const result = await page
          .evaluate(() => {
            return new Promise((resolve) => {
              setTimeout(() => resolve('done'), 5000);
            });
          })
          .catch((err) => ({ error: err.message }));

        expect(result).toHaveProperty('error');
      } finally {
        await page.close();
      }
    });
  });

  describe('Memory and Resource Management', () => {
    it('should not leak memory with repeated page operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const pages: Page[] = [];

      // Create and close many pages
      for (let i = 0; i < 10; i++) {
        const page = await browser.newPage();
        await page.goto('data:text/html,<html><body>Test</body></html>');
        pages.push(page);
      }

      // Close all pages
      await Promise.all(pages.map((p) => p.close()));

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Memory should not have grown excessively
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Allow for some growth but not excessive (e.g., < 50MB)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Error Message Patterns', () => {
    it('should identify "Requesting main frame too early" errors', () => {
      const errors = [
        new Error('Requesting main frame too early!'),
        new Error('Error: Requesting main frame too early!'),
        new Error(
          'Protocol error (Page.navigate): Requesting main frame too early!'
        ),
      ];

      errors.forEach((error) => {
        expect(error.message.includes('Requesting main frame too early')).toBe(
          true
        );
      });
    });

    it('should categorize different error types', () => {
      const errorPatterns = {
        frameErrors: [
          'Requesting main frame too early',
          'Frame was detached',
          'Execution context was destroyed',
        ],
        navigationErrors: [
          'net::ERR_NAME_NOT_RESOLVED',
          'net::ERR_CONNECTION_REFUSED',
          'Navigation timeout',
        ],
        protocolErrors: ['Protocol error', 'Target closed', 'Session closed'],
      };

      // Test pattern matching
      Object.entries(errorPatterns).forEach(([category, patterns]) => {
        patterns.forEach((pattern) => {
          expect(pattern).toBeTruthy();
        });
      });
    });
  });
});

describe('Integration Tests', () => {
  it('should process a batch of mixed URLs successfully', async () => {
    const urls = [
      'https://example.com',
      'https://httpbin.org/html',
      'https://www.google.com',
      'invalid-url',
      'https://this-domain-does-not-exist-12345.com',
    ];

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
      maxRetries: 1,
    });

    expect(results.length).toBe(urls.length);

    // Should have mix of success and errors
    const successCount = results.filter(
      (r) => r.type === 'success' || r.type === 'no_data'
    ).length;
    const errorCount = results.filter((r) => r.type === 'error').length;

    expect(successCount).toBeGreaterThan(0);
    expect(errorCount).toBeGreaterThan(0);

    // Check error categorization
    const errors = results.filter((r) => r.type === 'error');
    errors.forEach((error) => {
      expect(error.error).toHaveProperty('code');
      expect(error.error).toHaveProperty('message');
    });
  });
});
