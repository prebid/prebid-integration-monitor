/**
 * @fileoverview Content caching utility to prevent redundant GitHub fetches
 * Implements in-memory and file-based caching with TTL support
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Logger as WinstonLogger } from 'winston';

/**
 * Cache entry interface
 */
interface CacheEntry {
  content: string;
  url: string;
  timestamp: number;
  etag?: string;
  size: number;
  hits: number;
}

/**
 * Cache configuration options
 */
interface CacheConfig {
  /** Maximum cache size in bytes (default: 100MB) */
  maxSize?: number;
  /** Time to live in milliseconds (default: 30 minutes) */
  ttl?: number;
  /** Cache directory path */
  cacheDir?: string;
  /** Enable persistent file-based caching */
  persistent?: boolean;
  /** Maximum number of cache entries */
  maxEntries?: number;
}

/**
 * Content cache for GitHub URLs and other remote content
 * Prevents redundant HTTP requests during batch processing
 */
export class ContentCache {
  private cache = new Map<string, CacheEntry>();
  private config: Required<CacheConfig>;
  private logger: WinstonLogger;
  private currentSize = 0;

  constructor(logger: WinstonLogger, config: CacheConfig = {}) {
    this.logger = logger;
    this.config = {
      maxSize: config.maxSize || 100 * 1024 * 1024, // 100MB
      ttl: config.ttl || 30 * 60 * 1000, // 30 minutes
      cacheDir: config.cacheDir || path.join(process.cwd(), '.cache'),
      persistent: config.persistent ?? true,
      maxEntries: config.maxEntries || 1000
    };

    this.initializeCache();
  }

  /**
   * Initialize cache directory and load persistent cache
   */
  private initializeCache(): void {
    if (this.config.persistent) {
      try {
        if (!fs.existsSync(this.config.cacheDir)) {
          fs.mkdirSync(this.config.cacheDir, { recursive: true });
          this.logger.info(`Created cache directory: ${this.config.cacheDir}`);
        }
        this.loadPersistentCache();
      } catch (error) {
        this.logger.warn('Failed to initialize persistent cache', { error });
      }
    }
  }

  /**
   * Generate cache key from URL
   */
  private getCacheKey(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  /**
   * Get cache file path for a URL
   */
  private getCacheFilePath(url: string): string {
    const key = this.getCacheKey(url);
    return path.join(this.config.cacheDir, `${key}.json`);
  }

  /**
   * Check if cache entry is valid (not expired)
   */
  private isValidEntry(entry: CacheEntry): boolean {
    const now = Date.now();
    return (now - entry.timestamp) < this.config.ttl;
  }

  /**
   * Load persistent cache entries from disk
   */
  private loadPersistentCache(): void {
    try {
      const files = fs.readdirSync(this.config.cacheDir);
      let loadedCount = 0;
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = path.join(this.config.cacheDir, file);
          const data = fs.readFileSync(filePath, 'utf8');
          const entry: CacheEntry = JSON.parse(data);
          
          if (this.isValidEntry(entry)) {
            const key = this.getCacheKey(entry.url);
            this.cache.set(key, entry);
            this.currentSize += entry.size;
            loadedCount++;
          } else {
            // Clean up expired cache file
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // Skip invalid cache files
        }
      }
      
      if (loadedCount > 0) {
        this.logger.info(`Loaded ${loadedCount} cache entries from disk`);
      }
    } catch (error) {
      this.logger.warn('Failed to load persistent cache', { error });
    }
  }

  /**
   * Save cache entry to disk
   */
  private saveCacheEntry(url: string, entry: CacheEntry): void {
    if (!this.config.persistent) return;
    
    try {
      const filePath = this.getCacheFilePath(url);
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    } catch (error) {
      this.logger.warn(`Failed to save cache entry for ${url}`, { error });
    }
  }

  /**
   * Remove cache entry from disk
   */
  private removeCacheFile(url: string): void {
    if (!this.config.persistent) return;
    
    try {
      const filePath = this.getCacheFilePath(url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      this.logger.debug(`Failed to remove cache file for ${url}`, { error });
    }
  }

  /**
   * Evict least recently used entries to make space
   */
  private evictEntries(): void {
    if (this.cache.size <= this.config.maxEntries && this.currentSize <= this.config.maxSize) {
      return;
    }

    // Sort by hits and timestamp (LRU + LFU combination)
    const entries = Array.from(this.cache.entries()).sort((a, b) => {
      const [, entryA] = a;
      const [, entryB] = b;
      
      // First sort by hits (least used first)
      if (entryA.hits !== entryB.hits) {
        return entryA.hits - entryB.hits;
      }
      
      // Then by timestamp (oldest first)
      return entryA.timestamp - entryB.timestamp;
    });

    // Remove entries until we're under limits
    const targetEntries = Math.floor(this.config.maxEntries * 0.8); // Remove 20%
    const targetSize = Math.floor(this.config.maxSize * 0.8);
    
    let removedCount = 0;
    for (const [key, entry] of entries) {
      if (this.cache.size <= targetEntries && this.currentSize <= targetSize) {
        break;
      }
      
      this.cache.delete(key);
      this.currentSize -= entry.size;
      this.removeCacheFile(entry.url);
      removedCount++;
    }
    
    if (removedCount > 0) {
      this.logger.info(`Evicted ${removedCount} cache entries to free space`);
    }
  }

  /**
   * Get content from cache
   */
  public get(url: string): string | null {
    const key = this.getCacheKey(url);
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    if (!this.isValidEntry(entry)) {
      this.cache.delete(key);
      this.currentSize -= entry.size;
      this.removeCacheFile(url);
      return null;
    }
    
    // Update hit count and timestamp for LRU tracking
    entry.hits++;
    entry.timestamp = Date.now();
    
    this.logger.debug(`Cache hit for ${url} (${entry.hits} hits)`);
    return entry.content;
  }

  /**
   * Store content in cache
   */
  public set(url: string, content: string, etag?: string): void {
    const key = this.getCacheKey(url);
    const size = Buffer.byteLength(content, 'utf8');
    
    // Check if content would exceed max size limits
    if (size > this.config.maxSize) {
      this.logger.warn(`Content too large to cache: ${url} (${size} bytes)`);
      return;
    }
    
    const entry: CacheEntry = {
      content,
      url,
      timestamp: Date.now(),
      etag,
      size,
      hits: 1
    };
    
    // Remove existing entry if it exists
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.currentSize -= existingEntry.size;
    }
    
    // Add new entry
    this.cache.set(key, entry);
    this.currentSize += size;
    
    // Evict entries if necessary
    this.evictEntries();
    
    // Save to disk
    this.saveCacheEntry(url, entry);
    
    this.logger.debug(`Cached content for ${url} (${size} bytes)`);
  }

  /**
   * Remove specific URL from cache
   */
  public delete(url: string): boolean {
    const key = this.getCacheKey(url);
    const entry = this.cache.get(key);
    
    if (entry) {
      this.cache.delete(key);
      this.currentSize -= entry.size;
      this.removeCacheFile(url);
      this.logger.debug(`Removed cache entry for ${url}`);
      return true;
    }
    
    return false;
  }

  /**
   * Clear all cache entries
   */
  public clear(): void {
    const entryCount = this.cache.size;
    
    // Clear memory cache
    this.cache.clear();
    this.currentSize = 0;
    
    // Clear persistent cache
    if (this.config.persistent) {
      try {
        const files = fs.readdirSync(this.config.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.config.cacheDir, file));
          }
        }
      } catch (error) {
        this.logger.warn('Failed to clear persistent cache', { error });
      }
    }
    
    this.logger.info(`Cleared ${entryCount} cache entries`);
  }

  /**
   * Get cache statistics
   */
  public getStats(): {
    entries: number;
    size: number;
    maxSize: number;
    hitRate: number;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hits, 0);
    const totalRequests = totalHits + entries.length; // Approximate
    
    return {
      entries: this.cache.size,
      size: this.currentSize,
      maxSize: this.config.maxSize,
      hitRate: totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : undefined,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : undefined
    };
  }

  /**
   * Cleanup expired entries
   */
  public cleanup(): void {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isValidEntry(entry)) {
        this.cache.delete(key);
        this.currentSize -= entry.size;
        this.removeCacheFile(entry.url);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      this.logger.info(`Cleaned up ${removedCount} expired cache entries`);
    }
  }
}

// Global cache instance
let globalCache: ContentCache | null = null;

/**
 * Get or create global cache instance
 */
export function getContentCache(logger: WinstonLogger, config?: CacheConfig): ContentCache {
  if (!globalCache) {
    globalCache = new ContentCache(logger, config);
  }
  return globalCache;
}

/**
 * Close global cache instance
 */
export function closeContentCache(): void {
  if (globalCache) {
    globalCache.cleanup();
    globalCache = null;
  }
}