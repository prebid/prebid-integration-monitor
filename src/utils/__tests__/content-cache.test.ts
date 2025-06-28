import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContentCache, getContentCache, closeContentCache } from '../content-cache.js';
import type { Logger as WinstonLogger } from 'winston';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
vi.mock('fs');
const mockFs = vi.mocked(fs);

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as WinstonLogger;

describe('ContentCache', () => {
  let cache: ContentCache;
  const testCacheDir = '/tmp/test-cache';

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.unlinkSync.mockReturnValue(undefined);
    mockFs.statSync.mockReturnValue({ size: 1000 } as any);
    
    cache = new ContentCache(mockLogger, {
      cacheDir: testCacheDir,
      maxSize: 1024 * 1024, // 1MB
      ttl: 60000, // 1 minute
      persistent: false // Disable for testing
    });
  });

  afterEach(() => {
    closeContentCache();
  });

  describe('Basic Cache Operations', () => {
    it('should store and retrieve content', () => {
      const url = 'https://example.com/test';
      const content = 'test content';

      cache.set(url, content);
      const retrieved = cache.get(url);

      expect(retrieved).toBe(content);
    });

    it('should return null for non-existent entries', () => {
      const result = cache.get('https://nonexistent.com');
      expect(result).toBeNull();
    });

    it('should delete specific entries', () => {
      const url = 'https://example.com/test';
      const content = 'test content';

      cache.set(url, content);
      expect(cache.get(url)).toBe(content);

      const deleted = cache.delete(url);
      expect(deleted).toBe(true);
      expect(cache.get(url)).toBeNull();
    });

    it('should clear all entries', () => {
      cache.set('https://example1.com', 'content1');
      cache.set('https://example2.com', 'content2');

      expect(cache.get('https://example1.com')).toBe('content1');
      expect(cache.get('https://example2.com')).toBe('content2');

      cache.clear();

      expect(cache.get('https://example1.com')).toBeNull();
      expect(cache.get('https://example2.com')).toBeNull();
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTtlCache = new ContentCache(mockLogger, {
        ttl: 10, // 10ms
        persistent: false
      });

      const url = 'https://example.com/test';
      const content = 'test content';

      shortTtlCache.set(url, content);
      expect(shortTtlCache.get(url)).toBe(content);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(shortTtlCache.get(url)).toBeNull();
    });

    it('should clean up expired entries', async () => {
      const shortTtlCache = new ContentCache(mockLogger, {
        ttl: 10, // 10ms
        persistent: false
      });

      shortTtlCache.set('https://example1.com', 'content1');
      shortTtlCache.set('https://example2.com', 'content2');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      const statsBefore = shortTtlCache.getStats();
      shortTtlCache.cleanup();
      const statsAfter = shortTtlCache.getStats();

      expect(statsAfter.entries).toBeLessThan(statsBefore.entries);
    });
  });

  describe('Size Management', () => {
    it('should track cache size correctly', () => {
      const content1 = 'a'.repeat(1000);
      const content2 = 'b'.repeat(2000);

      cache.set('https://example1.com', content1);
      cache.set('https://example2.com', content2);

      const stats = cache.getStats();
      expect(stats.size).toBeGreaterThanOrEqual(3000);
    });

    it('should evict entries when size limit exceeded', () => {
      const smallCache = new ContentCache(mockLogger, {
        maxSize: 5000, // 5KB
        maxEntries: 10,
        persistent: false
      });

      // Add entries that exceed size limit
      for (let i = 0; i < 10; i++) {
        const content = 'x'.repeat(1000); // 1KB each
        smallCache.set(`https://example${i}.com`, content);
      }

      const stats = smallCache.getStats();
      expect(stats.size).toBeLessThanOrEqual(5000);
      expect(stats.entries).toBeLessThan(10);
    });

    it('should not cache content larger than max size', () => {
      const smallCache = new ContentCache(mockLogger, {
        maxSize: 1000,
        persistent: false
      });

      const largeContent = 'x'.repeat(2000);
      smallCache.set('https://example.com', largeContent);

      expect(smallCache.get('https://example.com')).toBeNull();
    });
  });

  describe('Hit Counting and LRU', () => {
    it('should track hit counts', () => {
      const url = 'https://example.com/test';
      const content = 'test content';

      cache.set(url, content);
      
      // Access multiple times
      cache.get(url);
      cache.get(url);
      cache.get(url);

      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should prefer frequently accessed entries during eviction', () => {
      const smallCache = new ContentCache(mockLogger, {
        maxEntries: 3,
        persistent: false
      });

      // Add initial entries
      smallCache.set('https://rarely-used.com', 'content1');
      smallCache.set('https://frequently-used.com', 'content2');
      smallCache.set('https://sometimes-used.com', 'content3');

      // Access one entry frequently
      for (let i = 0; i < 10; i++) {
        smallCache.get('https://frequently-used.com');
      }
      
      smallCache.get('https://sometimes-used.com');

      // Add new entry to trigger eviction
      smallCache.set('https://new-entry.com', 'new content');

      // Frequently used should still be there
      expect(smallCache.get('https://frequently-used.com')).toBe('content2');
      
      // Rarely used should be evicted
      expect(smallCache.get('https://rarely-used.com')).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      cache.set('https://example1.com', 'content1');
      cache.set('https://example2.com', 'content2');
      
      // Access to create hits
      cache.get('https://example1.com');
      cache.get('https://example2.com');

      const stats = cache.getStats();
      
      expect(stats.entries).toBe(2);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.oldestEntry).toBeDefined();
      expect(stats.newestEntry).toBeDefined();
    });

    it('should handle empty cache statistics', () => {
      const stats = cache.getStats();
      
      expect(stats.entries).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.oldestEntry).toBeUndefined();
      expect(stats.newestEntry).toBeUndefined();
    });
  });

  describe('Global Cache Instance', () => {
    it('should return the same instance for multiple calls', () => {
      const cache1 = getContentCache(mockLogger);
      const cache2 = getContentCache(mockLogger);
      
      expect(cache1).toBe(cache2);
    });

    it('should create new instance after closing', () => {
      const cache1 = getContentCache(mockLogger);
      closeContentCache();
      const cache2 = getContentCache(mockLogger);
      
      expect(cache1).not.toBe(cache2);
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      expect(() => {
        new ContentCache(mockLogger, { persistent: true });
      }).not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle cache file corruption gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['corrupt.json']);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Corrupt file');
      });

      expect(() => {
        new ContentCache(mockLogger, { persistent: true });
      }).not.toThrow();
    });
  });
});