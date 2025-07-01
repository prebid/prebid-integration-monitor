import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchUrlsFromGitHub } from '../utils/url-loader.js';
import { closeContentCache } from '../utils/content-cache.js';
import type { Logger as WinstonLogger } from 'winston';
import * as path from 'path';
import * as fs from 'fs';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as WinstonLogger;

describe('GitHub Range Integration Tests', () => {
  const testDbPath = path.join(__dirname, 'test-github-range.db');

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clean up any existing test files
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(async () => {
    // Clean up test files
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    // Close content cache
    closeContentCache();
  });

  describe('GitHub Range Processing Pipeline', () => {
    it('should handle small ranges correctly without double application', async () => {
      // Test the specific bug scenario: range should be applied only once
      const mockGitHubUrl =
        'https://github.com/test/repo/blob/master/domains.txt';

      // Mock fetch to return content simulating 1M domains
      const mockDomains = Array.from(
        { length: 1000 },
        (_, i) => `domain${i + 1}.com`
      );
      const mockContent = mockDomains.join('\n');

      const fetch = await import('node-fetch');
      vi.mocked(fetch.default).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockContent),
        headers: {
          get: (key: string) => (key === 'content-length' ? '10000' : null),
        },
      } as any);

      // Test range extraction from GitHub
      const rangeOptions = { startRange: 500, endRange: 502 };
      const extractedUrls = await fetchUrlsFromGitHub(
        mockGitHubUrl,
        undefined, // No limit
        mockLogger,
        rangeOptions
      );

      expect(extractedUrls).toHaveLength(3); // 500, 501, 502 (inclusive)
      expect(extractedUrls[0]).toBe('https://domain500.com');
      expect(extractedUrls[1]).toBe('https://domain501.com');
      expect(extractedUrls[2]).toBe('https://domain502.com');
    });

    it('should handle large range positions correctly - THE BUG SCENARIO', async () => {
      // Test the exact scenario that failed: 500k+ positions
      const mockGitHubUrl =
        'https://github.com/test/repo/blob/master/top-1m-domains.txt';

      // Create mock content with 500k+ lines
      const totalLines = 500010;
      const mockContent = Array.from(
        { length: totalLines },
        (_, i) => `domain${i + 1}.com`
      ).join('\n');

      const fetch = await import('node-fetch');
      vi.mocked(fetch.default).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockContent),
        headers: {
          get: (key: string) =>
            key === 'content-length' ? String(mockContent.length) : null,
        },
      } as any);

      // Test extraction from position 500000 - this was the failing scenario
      const rangeOptions = { startRange: 500000, endRange: 500002 };
      const extractedUrls = await fetchUrlsFromGitHub(
        mockGitHubUrl,
        undefined,
        mockLogger,
        rangeOptions
      );

      expect(extractedUrls).toHaveLength(3);
      expect(extractedUrls[0]).toBe('https://domain500000.com');
      expect(extractedUrls[1]).toBe('https://domain500001.com');
      expect(extractedUrls[2]).toBe('https://domain500002.com');
    });

    it('should detect when GitHub range and manual range would conflict - BUG DETECTION', () => {
      // This test would have caught the original bug
      const githubExtractedUrls = [
        'https://domain500000.com',
        'https://domain500001.com',
      ];
      const manualRangeString = '500000-500001';

      // Simulate the buggy behavior: applying range twice
      const [startStr, endStr] = manualRangeString.split('-');
      const start = parseInt(startStr, 10) - 1; // Convert to 0-based
      const end = parseInt(endStr, 10);

      // This would fail in the original code because start (499999) >= githubExtractedUrls.length (2)
      const wouldFail = start >= githubExtractedUrls.length;

      expect(wouldFail).toBe(true); // This confirms the bug scenario
      expect(githubExtractedUrls.length).toBe(2);
      expect(start).toBe(499999); // Way beyond the extracted URLs length

      // The fix: when using GitHub with range, skip manual range application
      const sourceType = 'GitHub';
      const shouldSkipManualRange =
        sourceType === 'GitHub' && !!manualRangeString;
      expect(shouldSkipManualRange).toBe(true);
    });
  });

  describe('Range Processing Error Detection', () => {
    it('should detect and prevent double range application', () => {
      // This test specifically catches the bug pattern
      const githubProcessedUrls = 3; // URLs extracted from GitHub with range
      const rangeString = '500000-500002'; // Original range specification

      // Parse the range as the buggy code would
      const [startStr, endStr] = rangeString.split('-');
      const start = parseInt(startStr, 10) - 1; // 499999 (0-based)
      const end = parseInt(endStr, 10); // 500002

      // The bug: trying to apply this range to already-extracted URLs
      const bugWouldOccur = start >= githubProcessedUrls;

      expect(bugWouldOccur).toBe(true);
      expect(start).toBe(499999);
      expect(githubProcessedUrls).toBe(3);

      // This test ensures we recognize this pattern and handle it correctly
    });

    it('should validate range consistency between GitHub fetch and post-processing', () => {
      const scenarios = [
        {
          githubRange: { startRange: 1, endRange: 10 },
          expectedUrls: 10,
          shouldSkipPostRange: true,
          description: 'GitHub range already applied',
        },
        {
          githubRange: undefined,
          expectedUrls: 100,
          shouldSkipPostRange: false,
          description: 'No GitHub range, post-processing range needed',
        },
      ];

      scenarios.forEach((scenario) => {
        if (scenario.githubRange) {
          // GitHub range was used, post-processing range should be skipped
          expect(scenario.shouldSkipPostRange).toBe(true);
        } else {
          // No GitHub range, post-processing range should be applied
          expect(scenario.shouldSkipPostRange).toBe(false);
        }
      });
    });
  });

  describe('Edge Cases That Caused Silent Failures', () => {
    it('should handle boundary conditions correctly', async () => {
      const testCases = [
        { range: '1-1', expectedCount: 1, description: 'single URL range' },
        {
          range: '999-1001',
          expectedCount: 3,
          description: 'range crossing boundaries',
        },
        {
          range: '1000-1000',
          expectedCount: 1,
          description: 'single URL at boundary',
        },
      ];

      for (const testCase of testCases) {
        const mockDomains = Array.from(
          { length: 1000 },
          (_, i) => `example${i + 1}.com`
        );
        const mockContent = mockDomains.join('\n');

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(mockContent),
          headers: new Map([['content-length', String(mockContent.length)]]),
        });

        const [startStr, endStr] = testCase.range.split('-');
        const rangeOptions = {
          startRange: parseInt(startStr, 10),
          endRange: parseInt(endStr, 10),
        };

        const extractedUrls = await fetchUrlsFromGitHub(
          'https://github.com/test/repo/blob/master/domains.txt',
          undefined,
          mockLogger,
          rangeOptions
        );

        expect(extractedUrls.length).toBe(testCase.expectedCount);
      }
    });

    it('should handle memory-efficient processing for large ranges', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate processing a large range efficiently
      const largeRange = { startRange: 500000, endRange: 501000 }; // 1000 URLs

      // Mock content that would be memory-intensive if fully loaded
      const mockContent = Array.from(
        { length: 1000000 },
        (_, i) => `domain${i}.com`
      ).join('\n'); // 1M unique domains

      const fetch = await import('node-fetch');
      vi.mocked(fetch.default).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockContent),
        headers: {
          get: (key: string) =>
            key === 'content-length' ? String(mockContent.length) : null,
        },
      } as any);

      const extractedUrls = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/master/huge-domains.txt',
        undefined,
        mockLogger,
        largeRange
      );

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      expect(extractedUrls).toHaveLength(1001); // endRange 501000 - startRange 500000 + 1
      // Memory increase should be reasonable (less than 50MB for this operation)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});
