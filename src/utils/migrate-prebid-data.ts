#!/usr/bin/env node

/**
 * Migration script to update the database with Prebid detection data from store JSON files
 * Once a URL has Prebid detected, it will always be marked as has_prebid = 1
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new transports.Console()],
});

interface StoredResult {
  url: string;
  prebidInstances?: Array<{ globalVarName?: string; version?: string }>;
}

async function migratePrebidData(): Promise<void> {
  const dbPath = path.join(process.cwd(), 'data', 'url-tracker.db');
  const storePath = path.join(process.cwd(), 'store');

  logger.info(`Opening database: ${dbPath}`);
  const db = new Database(dbPath);

  try {
    // First, add the has_prebid column if it doesn't exist
    logger.info('Adding has_prebid column if needed...');
    try {
      db.exec(`ALTER TABLE processed_urls ADD COLUMN has_prebid INTEGER DEFAULT 0`);
      logger.info('Added has_prebid column to processed_urls table');
    } catch (error) {
      // Column probably already exists
      logger.info('has_prebid column already exists');
    }

    // Create index for better query performance
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_has_prebid ON processed_urls(has_prebid)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_status_prebid ON processed_urls(status, has_prebid)`);
      logger.info('Created indexes on has_prebid column');
    } catch (error) {
      logger.warn('Some indexes may already exist');
    }

    // Prepare update statement - only update if not already set to 1
    const updateStmt = db.prepare(`
      UPDATE processed_urls 
      SET has_prebid = 1 
      WHERE url = ? AND has_prebid = 0
    `);

    // Track statistics
    let totalFiles = 0;
    let totalEntries = 0;
    let urlsWithPrebidFound = 0;
    let updatedUrls = 0;
    const prebidUrlSet = new Set<string>();

    // Get all month directories
    if (!fs.existsSync(storePath)) {
      logger.error(`Store directory not found: ${storePath}`);
      return;
    }

    const monthDirs = fs.readdirSync(storePath)
      .filter(item => {
        const itemPath = path.join(storePath, item);
        return fs.statSync(itemPath).isDirectory() && 
               (item.match(/^[A-Z][a-z]{2}-\d{4}$/) || item.match(/^[A-Z][a-z]{2}$/));
      });

    logger.info(`Found ${monthDirs.length} month directories to process`);

    // Helper function to process JSON files
    const processJsonFile = (filePath: string) => {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        // Handle both array and single object formats
        const entries = Array.isArray(data) ? data : [data];
        
        for (const entry of entries) {
          totalEntries++;
          
          // If this URL has Prebid instances, add it to our set
          if (entry && entry.url && entry.prebidInstances && 
              Array.isArray(entry.prebidInstances) && 
              entry.prebidInstances.length > 0) {
            prebidUrlSet.add(entry.url);
            urlsWithPrebidFound++;
          }
        }
        
      } catch (error) {
        logger.error(`Error processing ${filePath}: ${error}`);
      }
    };

    // First pass: collect all URLs that have ever had Prebid
    logger.info('Pass 1: Scanning all files to find URLs with Prebid...');
    
    // Process JSON files in root store directory
    const rootJsonFiles = fs.readdirSync(storePath)
      .filter(file => file.endsWith('.json'));
    
    if (rootJsonFiles.length > 0) {
      logger.info(`Processing ${rootJsonFiles.length} JSON files in store root...`);
      for (const jsonFile of rootJsonFiles) {
        const filePath = path.join(storePath, jsonFile);
        totalFiles++;
        processJsonFile(filePath);
      }
    }
    
    // Process month directories
    for (const monthDir of monthDirs) {
      const monthPath = path.join(storePath, monthDir);
      
      // Get all JSON files in the month directory
      const jsonFiles = fs.readdirSync(monthPath)
        .filter(file => file.endsWith('.json'));

      for (const jsonFile of jsonFiles) {
        const filePath = path.join(monthPath, jsonFile);
        totalFiles++;
        processJsonFile(filePath);
      }
    }

    logger.info(`Found ${prebidUrlSet.size} unique URLs with Prebid (from ${urlsWithPrebidFound} total occurrences)`);

    // Second pass: update database for all URLs that have ever had Prebid
    logger.info('Pass 2: Updating database...');
    
    // Start a transaction for all updates
    const transaction = db.transaction((urls: string[]) => {
      for (const url of urls) {
        const result = updateStmt.run(url);
        if (result.changes > 0) {
          updatedUrls++;
        }
      }
    });

    // Convert Set to Array and execute transaction
    const urlArray = Array.from(prebidUrlSet);
    if (urlArray.length > 0) {
      transaction(urlArray);
    }

    // Log final statistics
    logger.info('=== Migration Complete ===');
    logger.info(`Total files processed: ${totalFiles}`);
    logger.info(`Total entries processed: ${totalEntries}`);
    logger.info(`Total occurrences of URLs with Prebid: ${urlsWithPrebidFound}`);
    logger.info(`Unique URLs with Prebid detected: ${prebidUrlSet.size}`);
    logger.info(`Database records updated: ${updatedUrls}`);

    // Verify the update
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM processed_urls WHERE has_prebid = 1');
    const result = countStmt.get() as { count: number };
    logger.info(`Total URLs in database with has_prebid=1: ${result.count}`);

    // Show some examples
    const exampleStmt = db.prepare('SELECT url FROM processed_urls WHERE has_prebid = 1 ORDER BY url LIMIT 5');
    const examples = exampleStmt.all() as Array<{ url: string }>;
    logger.info('Example URLs with Prebid:');
    examples.forEach(row => logger.info(`  - ${row.url}`));

  } catch (error) {
    logger.error(`Migration failed: ${error}`);
    throw error;
  } finally {
    db.close();
    logger.info('Database connection closed');
  }
}

// Run the migration if this script is executed directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  migratePrebidData()
    .then(() => {
      logger.info('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

export { migratePrebidData };