/**
 * @fileoverview URL blacklist management for problematic URLs that consistently crash
 * Prevents repeated crashes from known problematic URLs
 */

import type { Logger as WinstonLogger } from 'winston';
import * as fs from 'fs';
import * as path from 'path';

export class UrlBlacklist {
  private blacklist: Set<string> = new Set();
  private blacklistFile: string;
  private logger: WinstonLogger;
  private crashCounts: Map<string, number> = new Map();
  private readonly maxCrashesBeforeBlacklist = 2;

  constructor(
    logger: WinstonLogger,
    blacklistFile = 'data/url-blacklist.json'
  ) {
    this.logger = logger;
    this.blacklistFile = blacklistFile;
    this.loadBlacklist();
  }

  /**
   * Load blacklist from file
   */
  private loadBlacklist(): void {
    try {
      if (fs.existsSync(this.blacklistFile)) {
        const data = fs.readFileSync(this.blacklistFile, 'utf8');
        const blacklistData = JSON.parse(data);
        this.blacklist = new Set(blacklistData.urls || []);

        // Load crash counts
        if (blacklistData.crashCounts) {
          this.crashCounts = new Map(Object.entries(blacklistData.crashCounts));
        }

        this.logger.info(`Loaded ${this.blacklist.size} URLs from blacklist`);
      }
    } catch (error) {
      this.logger.error('Error loading URL blacklist:', error);
    }
  }

  /**
   * Save blacklist to file
   */
  private saveBlacklist(): void {
    try {
      const data = {
        urls: Array.from(this.blacklist),
        crashCounts: Object.fromEntries(this.crashCounts),
        lastUpdated: new Date().toISOString(),
      };

      const dir = path.dirname(this.blacklistFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.blacklistFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Error saving URL blacklist:', error);
    }
  }

  /**
   * Check if URL is blacklisted
   */
  isBlacklisted(url: string): boolean {
    return this.blacklist.has(url);
  }

  /**
   * Record a crash for a URL
   */
  recordCrash(url: string, error: string): void {
    const currentCount = this.crashCounts.get(url) || 0;
    const newCount = currentCount + 1;
    this.crashCounts.set(url, newCount);

    this.logger.warn(`URL ${url} has crashed ${newCount} times`, { error });

    if (newCount >= this.maxCrashesBeforeBlacklist) {
      this.addToBlacklist(url, `Crashed ${newCount} times with: ${error}`);
    }

    this.saveBlacklist();
  }

  /**
   * Add URL to blacklist
   */
  addToBlacklist(url: string, reason: string): void {
    this.blacklist.add(url);
    this.logger.error(`Added ${url} to blacklist: ${reason}`);
    this.saveBlacklist();
  }

  /**
   * Remove URL from blacklist (for testing)
   */
  removeFromBlacklist(url: string): void {
    this.blacklist.delete(url);
    this.crashCounts.delete(url);
    this.saveBlacklist();
  }

  /**
   * Get blacklist statistics
   */
  getStats(): {
    blacklistedCount: number;
    crashingUrls: Array<{ url: string; crashes: number }>;
  } {
    const crashingUrls = Array.from(this.crashCounts.entries())
      .map(([url, crashes]) => ({ url, crashes }))
      .sort((a, b) => b.crashes - a.crashes);

    return {
      blacklistedCount: this.blacklist.size,
      crashingUrls,
    };
  }

  /**
   * Filter out blacklisted URLs
   */
  filterUrls(urls: string[]): { valid: string[]; blacklisted: string[] } {
    const valid: string[] = [];
    const blacklisted: string[] = [];

    for (const url of urls) {
      if (this.isBlacklisted(url)) {
        blacklisted.push(url);
      } else {
        valid.push(url);
      }
    }

    if (blacklisted.length > 0) {
      this.logger.info(`Filtered out ${blacklisted.length} blacklisted URLs`);
    }

    return { valid, blacklisted };
  }
}
