/**
 * Utility to extract URLs where Prebid was detected from stored results
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Logger as WinstonLogger } from 'winston';

export interface PrebidUrlExtractorOptions {
  outputDir: string;
  limit: number; // Required to prevent loading all URLs
  logger?: WinstonLogger;
}

export interface PrebidUrlSummaryOptions {
  outputDir: string;
  logger?: WinstonLogger;
}

/**
 * Extracts URLs where Prebid was detected from stored JSON results
 * @param options - Configuration options including required limit
 * @returns Array of URLs where Prebid was found (up to limit)
 */
export async function extractPrebidUrls(options: PrebidUrlExtractorOptions): Promise<string[]> {
  const { outputDir, limit, logger } = options;
  const prebidUrls = new Set<string>();

  try {
    // Check if output directory exists
    if (!fs.existsSync(outputDir)) {
      logger?.warn(`Output directory ${outputDir} does not exist. No Prebid URLs to extract.`);
      return [];
    }

    // Get all month directories (e.g., Jan-2025, Feb-2025)
    const monthDirs = fs.readdirSync(outputDir)
      .filter(item => {
        const itemPath = path.join(outputDir, item);
        return fs.statSync(itemPath).isDirectory() && item.match(/^[A-Z][a-z]{2}-\d{4}$/);
      });

    if (monthDirs.length === 0) {
      logger?.warn('No month directories found in output directory.');
      return [];
    }

    // Process each month directory
    for (const monthDir of monthDirs) {
      const monthPath = path.join(outputDir, monthDir);
      
      // Get all JSON files in the month directory
      const jsonFiles = fs.readdirSync(monthPath)
        .filter(file => file.endsWith('.json'));

      // Process each JSON file
      for (const jsonFile of jsonFiles) {
        const filePath = path.join(monthPath, jsonFile);
        
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(fileContent);

          // Handle both array and single object formats
          const entries = Array.isArray(data) ? data : [data];

          // Extract URLs where Prebid was detected
          for (const entry of entries) {
            if (entry && entry.prebidInstances && Array.isArray(entry.prebidInstances) && 
                entry.prebidInstances.length > 0 && entry.url) {
              prebidUrls.add(entry.url);
              
              // Check if we've reached the limit
              if (prebidUrls.size >= limit) {
                logger?.info(`Reached limit of ${limit} URLs, stopping extraction`);
                return Array.from(prebidUrls).sort();
              }
            }
          }
        } catch (error) {
          logger?.debug(`Error reading or parsing ${filePath}: ${error}`);
          // Continue processing other files
        }
      }
    }

    const urlArray = Array.from(prebidUrls).sort().slice(0, limit);
    logger?.info(`Extracted ${urlArray.length} unique Prebid URLs (limit: ${limit})`);
    
    return urlArray;
  } catch (error) {
    logger?.error('Error extracting Prebid URLs:', error);
    return [];
  }
}

/**
 * Gets a summary of Prebid URLs by month
 * @param options - Configuration options
 * @returns Summary statistics of Prebid URLs
 */
export async function getPrebidUrlSummary(options: PrebidUrlSummaryOptions): Promise<{
  total: number;
  byMonth: Record<string, number>;
  dateRange?: { earliest: string; latest: string };
}> {
  const { outputDir, logger } = options;
  const summary: {
    total: number;
    byMonth: Record<string, number>;
    dateRange?: { earliest: string; latest: string };
  } = {
    total: 0,
    byMonth: {}
  };

  const allUrls = new Set<string>();
  const dates: string[] = [];

  try {
    if (!fs.existsSync(outputDir)) {
      return summary;
    }

    const monthDirs = fs.readdirSync(outputDir)
      .filter(item => {
        const itemPath = path.join(outputDir, item);
        return fs.statSync(itemPath).isDirectory() && item.match(/^[A-Z][a-z]{2}-\d{4}$/);
      });

    for (const monthDir of monthDirs) {
      const monthPath = path.join(outputDir, monthDir);
      const monthUrls = new Set<string>();
      
      const jsonFiles = fs.readdirSync(monthPath)
        .filter(file => file.endsWith('.json'));

      for (const jsonFile of jsonFiles) {
        const filePath = path.join(monthPath, jsonFile);
        
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const data = JSON.parse(fileContent);
          const entries = Array.isArray(data) ? data : [data];

          for (const entry of entries) {
            if (entry && entry.prebidInstances && Array.isArray(entry.prebidInstances) && 
                entry.prebidInstances.length > 0 && entry.url) {
              monthUrls.add(entry.url);
              allUrls.add(entry.url);
              if (entry.date) {
                dates.push(entry.date);
              }
            }
          }
        } catch (error) {
          // Continue processing
        }
      }

      if (monthUrls.size > 0) {
        summary.byMonth[monthDir] = monthUrls.size;
      }
    }

    summary.total = allUrls.size;

    // Determine date range
    if (dates.length > 0) {
      dates.sort();
      summary.dateRange = {
        earliest: dates[0],
        latest: dates[dates.length - 1]
      };
    }

    return summary;
  } catch (error) {
    logger?.error('Error getting Prebid URL summary:', error);
    return summary;
  }
}