import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { UrlTracker } from '../utils/url-tracker.js';
import { loadFileContents } from '../utils/url-loader.js';

describe('Range behavior with skipProcessed', () => {
  const testDbPath = path.join(process.cwd(), 'test-temp', 'test-range-db.db');
  const testInputFile = path.join(process.cwd(), 'test-temp', 'test-urls.txt');
  let urlTracker: UrlTracker;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(path.dirname(testDbPath))) {
      fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    }

    // Create test file with 20 URLs
    const testUrls = Array.from({ length: 20 }, (_, i) => `https://example${i + 1}.com`);
    fs.writeFileSync(testInputFile, testUrls.join('\n'));

    // Create URL tracker with mock logger
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any;

    urlTracker = new UrlTracker(logger, { dbPath: testDbPath });

    // Pre-populate some URLs as processed
    // Mark URLs 5-10 as already processed
    for (let i = 5; i <= 10; i++) {
      urlTracker.markUrlProcessed(`https://example${i}.com`, 'success');
    }
  });

  afterEach(() => {
    if (urlTracker) {
      urlTracker.close();
    }
    // Clean up test files
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testInputFile)) {
      fs.unlinkSync(testInputFile);
    }
    // Clean up test directory
    const testDir = path.dirname(testDbPath);
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir, { recursive: true });
    }
  });

  it('should maintain original positions when using range with skipProcessed', () => {
    // Test range 5-15 (1-based) which includes both processed and unprocessed URLs
    
    // Load all URLs
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
    const fileContent = loadFileContents(testInputFile, logger);
    const allUrls = fileContent!.split('\n').filter(Boolean);
    
    // Apply range (convert to 0-based)
    const start = 4; // 5 - 1
    const end = 15;
    const rangeUrls = allUrls.slice(start, end);
    
    // Expected URLs in range 5-15 (1-based)
    const expectedUrlsInRange = [
      'https://example5.com',   // position 5 - already processed
      'https://example6.com',   // position 6 - already processed
      'https://example7.com',   // position 7 - already processed
      'https://example8.com',   // position 8 - already processed
      'https://example9.com',   // position 9 - already processed
      'https://example10.com',  // position 10 - already processed
      'https://example11.com',  // position 11 - not processed
      'https://example12.com',  // position 12 - not processed
      'https://example13.com',  // position 13 - not processed
      'https://example14.com',  // position 14 - not processed
      'https://example15.com',  // position 15 - not processed
    ];
    
    expect(rangeUrls).toEqual(expectedUrlsInRange);
    
    // Filter out processed URLs
    const unprocessedInRange = rangeUrls.filter(url => !urlTracker.isUrlProcessed(url));
    
    // Should only get URLs 11-15 (positions 11-15 in original file)
    const expectedUnprocessed = [
      'https://example11.com',
      'https://example12.com',
      'https://example13.com',
      'https://example14.com',
      'https://example15.com',
    ];
    
    expect(unprocessedInRange).toEqual(expectedUnprocessed);
    expect(unprocessedInRange.length).toBe(5);
  });

  it('should process correct URLs when range starts beyond processed URLs', () => {
    // Test range 15-20 which should all be unprocessed
    
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
    const fileContent = loadFileContents(testInputFile, logger);
    const allUrls = fileContent!.split('\n').filter(Boolean);
    
    // Apply range
    const start = 14; // 15 - 1
    const end = 20;
    const rangeUrls = allUrls.slice(start, end);
    
    // All should be unprocessed
    const unprocessedInRange = rangeUrls.filter(url => !urlTracker.isUrlProcessed(url));
    
    expect(unprocessedInRange).toEqual(rangeUrls);
    expect(unprocessedInRange.length).toBe(6); // positions 15-20
  });

  it('should handle range that includes only processed URLs', () => {
    // Test range 5-10 which are all processed
    
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
    const fileContent = loadFileContents(testInputFile, logger);
    const allUrls = fileContent!.split('\n').filter(Boolean);
    
    // Apply range
    const start = 4; // 5 - 1
    const end = 10;
    const rangeUrls = allUrls.slice(start, end);
    
    // All should be processed
    const unprocessedInRange = rangeUrls.filter(url => !urlTracker.isUrlProcessed(url));
    
    expect(unprocessedInRange).toEqual([]);
    
    // Verify all URLs in range are marked as processed
    for (const url of rangeUrls) {
      expect(urlTracker.isUrlProcessed(url)).toBe(true);
    }
  });
});