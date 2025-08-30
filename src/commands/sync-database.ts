import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import loggerModule, { initializeLogger } from '../utils/logger.js';
import { getUrlTracker } from '../utils/url-tracker.js';
import type { Logger as WinstonLogger } from 'winston';

interface StoredResult {
  url: string;
  date?: string;
  prebidInstances?: Array<{ globalVarName?: string; version?: string }>;
  libraries?: string[];
  identitySolutions?: string[];
  cdpPlatforms?: string[];
  unknownAdTech?: string[];
}

export default class SyncDatabase extends Command {
  static override description = 'Sync store JSON files with the URL tracking database';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --month Aug-2025',
    '<%= config.bin %> <%= command.id %> --verbose',
  ];

  static override flags = {
    dryRun: Flags.boolean({
      description: 'Preview what would be imported without making changes',
      default: false,
    }),
    month: Flags.string({
      description: 'Sync only a specific month directory (e.g., Aug-2025)',
      required: false,
    }),
    verbose: Flags.boolean({
      description: 'Show detailed progress and debug information',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force update all URLs, even if they exist in database',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SyncDatabase);
    
    // Initialize logger
    initializeLogger('logs', flags.verbose);
    const logger = loggerModule.instance;
    logger.info('Starting database sync from store files...');
    
    if (flags.dryRun) {
      logger.info('🔍 DRY RUN MODE - No changes will be made to the database');
    }
    
    // Initialize URL tracker
    const urlTracker = getUrlTracker(logger);
    
    const storePath = path.join(process.cwd(), 'store');
    
    if (!fs.existsSync(storePath)) {
      this.error('Store directory not found. Have you run any scans yet?');
    }
    
    // Track statistics
    const stats = {
      totalFiles: 0,
      totalEntries: 0,
      urlsWithPrebid: 0,
      urlsWithoutPrebid: 0,
      newUrlsAdded: 0,
      existingUrlsUpdated: 0,
      errors: 0,
      skipped: 0,
    };
    
    // Collect all URLs to process
    const urlsToProcess = new Map<string, {
      hasPrebid: boolean;
      hasAdTech: boolean;
      source: string;
      date?: string;
    }>();
    
    try {
      // Process JSON files in root store directory
      const rootJsonFiles = fs.readdirSync(storePath)
        .filter(file => file.endsWith('.json'));
      
      if (rootJsonFiles.length > 0 && !flags.month) {
        logger.info(`Processing ${rootJsonFiles.length} JSON files in store root...`);
        for (const jsonFile of rootJsonFiles) {
          await this.processJsonFile(
            path.join(storePath, jsonFile),
            urlsToProcess,
            stats,
            logger
          );
        }
      }
      
      // Get month directories
      const monthDirs = fs.readdirSync(storePath)
        .filter(item => {
          const itemPath = path.join(storePath, item);
          return fs.statSync(itemPath).isDirectory() && 
                 (item.match(/^[A-Z][a-z]{2}-\d{4}$/) || item.match(/^[A-Z][a-z]{2}$/));
        });
      
      // Filter by specific month if requested
      const dirsToProcess = flags.month 
        ? monthDirs.filter(dir => dir === flags.month)
        : monthDirs;
      
      if (flags.month && dirsToProcess.length === 0) {
        this.error(`Month directory '${flags.month}' not found`);
      }
      
      logger.info(`Processing ${dirsToProcess.length} month directories...`);
      
      // Process each month directory
      for (const monthDir of dirsToProcess) {
        const monthPath = path.join(storePath, monthDir);
        logger.info(`📁 Processing month: ${monthDir}`);
        
        const jsonFiles = fs.readdirSync(monthPath)
          .filter(file => file.endsWith('.json'));
        
        for (const jsonFile of jsonFiles) {
          await this.processJsonFile(
            path.join(monthPath, jsonFile),
            urlsToProcess,
            stats,
            logger
          );
        }
      }
      
      // Now sync with database
      logger.info(`\n📊 Found ${urlsToProcess.size} unique URLs to process`);
      logger.info(`   - ${stats.urlsWithPrebid} with Prebid`);
      logger.info(`   - ${stats.urlsWithoutPrebid} without Prebid`);
      
      if (!flags.dryRun) {
        logger.info('\n🔄 Syncing with database...');
        
        // Process in batches for better performance
        const batchSize = 1000;
        const urlArray = Array.from(urlsToProcess.entries());
        
        for (let i = 0; i < urlArray.length; i += batchSize) {
          const batch = urlArray.slice(i, Math.min(i + batchSize, urlArray.length));
          
          for (const [url, data] of batch) {
            try {
              // Check if URL exists in database
              const exists = urlTracker.isUrlProcessed(url);
              
              if (!exists || flags.force) {
                // Determine status based on data
                const status = data.hasAdTech ? 'success' : 'no_data';
                
                // Mark URL as processed with appropriate status
                urlTracker.markUrlProcessed(url, status, undefined, data.hasPrebid);
                
                if (exists) {
                  stats.existingUrlsUpdated++;
                } else {
                  stats.newUrlsAdded++;
                }
              } else {
                // URL exists and not forcing - just update has_prebid if needed
                if (data.hasPrebid) {
                  // This will preserve existing status but ensure has_prebid is set
                  urlTracker.markUrlProcessed(url, 'success', undefined, true);
                  stats.existingUrlsUpdated++;
                } else {
                  stats.skipped++;
                }
              }
            } catch (error) {
              logger.error(`Error processing URL ${url}: ${error}`);
              stats.errors++;
            }
          }
          
          if (flags.verbose) {
            logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urlArray.length / batchSize)}`);
          }
        }
      }
      
      // Print final statistics
      this.printStats(stats, flags.dryRun);
      
      // Verify database state
      if (!flags.dryRun) {
        const dbPrebidCount = urlTracker.getPrebidUrlCount();
        const dbTotalCount = urlTracker.getTotalCount();
        
        logger.info('\n✅ Database sync complete!');
        logger.info(`📊 Database now contains:`);
        logger.info(`   - Total URLs: ${dbTotalCount.toLocaleString()}`);
        logger.info(`   - URLs with Prebid: ${dbPrebidCount.toLocaleString()}`);
      }
      
    } catch (error) {
      logger.error('Sync failed:', error);
      throw error;
    } finally {
      urlTracker.close();
    }
  }
  
  private async processJsonFile(
    filePath: string,
    urlsToProcess: Map<string, any>,
    stats: any,
    logger: WinstonLogger
  ): Promise<void> {
    stats.totalFiles++;
    
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      
      // Handle both array and single object formats
      const entries = Array.isArray(data) ? data : [data];
      
      for (const entry of entries) {
        if (!entry || !entry.url) continue;
        
        stats.totalEntries++;
        
        const hasPrebid = entry.prebidInstances && 
                         Array.isArray(entry.prebidInstances) && 
                         entry.prebidInstances.length > 0;
        
        const hasAdTech = hasPrebid || 
                         (entry.libraries && entry.libraries.length > 0) ||
                         (entry.identitySolutions && entry.identitySolutions.length > 0) ||
                         (entry.cdpPlatforms && entry.cdpPlatforms.length > 0);
        
        if (hasPrebid) {
          stats.urlsWithPrebid++;
        } else {
          stats.urlsWithoutPrebid++;
        }
        
        // Store or update URL data (keeping the most recent info)
        const existing = urlsToProcess.get(entry.url);
        if (!existing || (entry.date && (!existing.date || entry.date > existing.date))) {
          urlsToProcess.set(entry.url, {
            hasPrebid: hasPrebid || (existing?.hasPrebid ?? false), // Once Prebid, always Prebid
            hasAdTech,
            source: filePath,
            date: entry.date,
          });
        } else if (hasPrebid && !existing.hasPrebid) {
          // Update existing to mark as having Prebid
          existing.hasPrebid = true;
        }
      }
    } catch (error) {
      logger.error(`Error processing ${filePath}: ${error}`);
      stats.errors++;
    }
  }
  
  private printStats(stats: any, isDryRun: boolean): void {
    console.log('\n========================================');
    console.log('📊 SYNC STATISTICS');
    console.log('========================================');
    console.log(`📁 Files processed: ${stats.totalFiles}`);
    console.log(`📄 Total entries: ${stats.totalEntries.toLocaleString()}`);
    console.log(`✅ URLs with Prebid: ${stats.urlsWithPrebid.toLocaleString()}`);
    console.log(`❌ URLs without Prebid: ${stats.urlsWithoutPrebid.toLocaleString()}`);
    
    if (!isDryRun) {
      console.log(`\n🆕 New URLs added: ${stats.newUrlsAdded.toLocaleString()}`);
      console.log(`🔄 Existing URLs updated: ${stats.existingUrlsUpdated.toLocaleString()}`);
      console.log(`⏭️  URLs skipped: ${stats.skipped.toLocaleString()}`);
      
      if (stats.errors > 0) {
        console.log(`❌ Errors: ${stats.errors}`);
      }
    }
    console.log('========================================');
  }
}