import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import loggerModule, { initializeLogger } from '../utils/logger.js';
import { getUrlTracker } from '../utils/url-tracker.js';

export default class DatabaseStats extends Command {
  static override description = 'Show database statistics and sync status';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --detailed',
    '<%= config.bin %> <%= command.id %> --check-sync',
  ];

  static override flags = {
    detailed: Flags.boolean({
      description: 'Show detailed breakdown by status',
      default: false,
    }),
    checkSync: Flags.boolean({
      description: 'Check if database is in sync with store files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DatabaseStats);
    
    // Initialize logger
    initializeLogger('logs', false);
    const logger = loggerModule.instance;
    
    // Initialize URL tracker
    const urlTracker = getUrlTracker(logger);
    
    try {
      // Get database statistics
      const stats = urlTracker.getDatabaseStats();
      const prebidCount = urlTracker.getPrebidUrlCount();
      const totalCount = urlTracker.getTotalCount();
      const successCount = urlTracker.getTotalCount('success');
      const noDataCount = urlTracker.getTotalCount('no_data');
      const errorCount = urlTracker.getTotalCount('error');
      
      // Print main statistics
      console.log('\n========================================');
      console.log('📊 DATABASE STATISTICS');
      console.log('========================================');
      console.log(`📁 Database: ${stats.path}`);
      console.log(`💾 Size: ${(stats.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`🔢 Total URLs tracked: ${totalCount.toLocaleString()}`);
      console.log(`✅ URLs with Prebid: ${prebidCount.toLocaleString()}`);
      console.log('\n📈 Status Breakdown:');
      console.log(`   - Success: ${successCount.toLocaleString()} (${((successCount / totalCount) * 100).toFixed(1)}%)`);
      console.log(`   - No Data: ${noDataCount.toLocaleString()} (${((noDataCount / totalCount) * 100).toFixed(1)}%)`);
      console.log(`   - Error: ${errorCount.toLocaleString()} (${((errorCount / totalCount) * 100).toFixed(1)}%)`);
      
      if (flags.detailed) {
        // Get more detailed stats
        const allStats = urlTracker.getStats();
        console.log('\n📋 Detailed Statistics:');
        for (const [status, count] of Object.entries(allStats)) {
          console.log(`   - ${status}: ${count.toLocaleString()}`);
        }
      }
      
      if (flags.checkSync) {
        console.log('\n🔄 Checking sync status with store files...');
        
        const storePath = path.join(process.cwd(), 'store');
        
        if (!fs.existsSync(storePath)) {
          console.log('❌ Store directory not found');
        } else {
          // Count unique URLs with Prebid in store files
          const prebidUrlsInStore = new Set<string>();
          let totalFilesChecked = 0;
          let totalEntriesChecked = 0;
          
          // Check root JSON files
          const rootJsonFiles = fs.readdirSync(storePath)
            .filter(file => file.endsWith('.json'));
          
          for (const jsonFile of rootJsonFiles) {
            try {
              const filePath = path.join(storePath, jsonFile);
              const fileContent = fs.readFileSync(filePath, 'utf8');
              const data = JSON.parse(fileContent);
              const entries = Array.isArray(data) ? data : [data];
              
              totalFilesChecked++;
              
              for (const entry of entries) {
                totalEntriesChecked++;
                if (entry && entry.url && entry.prebidInstances && 
                    Array.isArray(entry.prebidInstances) && 
                    entry.prebidInstances.length > 0) {
                  prebidUrlsInStore.add(entry.url);
                }
              }
            } catch (error) {
              // Skip files with errors
            }
          }
          
          // Check month directories
          const monthDirs = fs.readdirSync(storePath)
            .filter(item => {
              const itemPath = path.join(storePath, item);
              return fs.statSync(itemPath).isDirectory() && 
                     (item.match(/^[A-Z][a-z]{2}-\d{4}$/) || item.match(/^[A-Z][a-z]{2}$/));
            });
          
          for (const monthDir of monthDirs) {
            const monthPath = path.join(storePath, monthDir);
            const jsonFiles = fs.readdirSync(monthPath)
              .filter(file => file.endsWith('.json'));
            
            for (const jsonFile of jsonFiles) {
              try {
                const filePath = path.join(monthPath, jsonFile);
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(fileContent);
                const entries = Array.isArray(data) ? data : [data];
                
                totalFilesChecked++;
                
                for (const entry of entries) {
                  totalEntriesChecked++;
                  if (entry && entry.url && entry.prebidInstances && 
                      Array.isArray(entry.prebidInstances) && 
                      entry.prebidInstances.length > 0) {
                    prebidUrlsInStore.add(entry.url);
                  }
                }
              } catch (error) {
                // Skip files with errors
              }
            }
          }
          
          const storeUrlCount = prebidUrlsInStore.size;
          const difference = storeUrlCount - prebidCount;
          const syncPercentage = prebidCount > 0 ? ((prebidCount / storeUrlCount) * 100).toFixed(1) : '0';
          
          console.log('\n📊 Sync Status:');
          console.log(`   - Files checked: ${totalFilesChecked}`);
          console.log(`   - Total entries: ${totalEntriesChecked.toLocaleString()}`);
          console.log(`   - Unique Prebid URLs in store: ${storeUrlCount.toLocaleString()}`);
          console.log(`   - Unique Prebid URLs in database: ${prebidCount.toLocaleString()}`);
          
          if (difference === 0) {
            console.log('\n✅ Database is fully synced with store files!');
          } else if (difference > 0) {
            console.log(`\n⚠️  Database is missing ${difference.toLocaleString()} URLs (${syncPercentage}% synced)`);
            console.log('   Run "sync-database" command to import missing URLs');
          } else {
            console.log(`\n🔍 Database has ${Math.abs(difference).toLocaleString()} more URLs than store files`);
            console.log('   This might indicate deleted store files or manual database entries');
          }
        }
      }
      
      console.log('\n========================================');
      
    } catch (error) {
      logger.error('Failed to get database statistics:', error);
      throw error;
    } finally {
      urlTracker.close();
    }
  }
}