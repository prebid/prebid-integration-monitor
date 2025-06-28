#!/usr/bin/env node

/**
 * Batch processing script for the top-1M domains repository
 * Processes domains in chunks of 1000 URLs with progress tracking and resume capability
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/zer0h/top-1000000-domains/master/top-100000-domains';
const BATCH_SIZE = 1000;
const DOMAINS_FILE = 'top-domains-full.txt';
const PROGRESS_FILE = 'batch-progress.json';
const CONCURRENT_LIMIT = 1; // Process one batch at a time to avoid overwhelming the system

class BatchProcessor {
  constructor() {
    this.progress = this.loadProgress();
    this.domains = [];
    this.totalBatches = 0;
    this.currentBatch = this.progress.lastCompletedBatch + 1;
  }

  loadProgress() {
    try {
      if (fs.existsSync(PROGRESS_FILE)) {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      }
    } catch (error) {
      console.warn('Could not load progress file, starting fresh:', error.message);
    }
    
    return {
      lastCompletedBatch: 0,
      totalProcessed: 0,
      startTime: new Date().toISOString(),
      batches: []
    };
  }

  saveProgress() {
    try {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(this.progress, null, 2));
    } catch (error) {
      console.error('Failed to save progress:', error.message);
    }
  }

  async downloadDomains() {
    console.log('📥 Downloading top domains list...');
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(DOMAINS_FILE);
      
      https.get(GITHUB_RAW_URL, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log('✅ Downloaded top domains successfully');
          resolve();
        });
        
        file.on('error', (err) => {
          fs.unlink(DOMAINS_FILE, () => {}); // Delete partial file
          reject(err);
        });
      }).on('error', reject);
    });
  }

  loadDomains() {
    try {
      const content = fs.readFileSync(DOMAINS_FILE, 'utf8');
      this.domains = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      this.totalBatches = Math.ceil(this.domains.length / BATCH_SIZE);
      
      console.log(`📊 Loaded ${this.domains.length} domains`);
      console.log(`📦 Total batches: ${this.totalBatches}`);
      console.log(`🚀 Starting from batch ${this.currentBatch}`);
      
      return true;
    } catch (error) {
      console.error('Failed to load domains:', error.message);
      return false;
    }
  }

  createBatchFile(batchNumber) {
    const startIndex = (batchNumber - 1) * BATCH_SIZE;
    const endIndex = Math.min(startIndex + BATCH_SIZE, this.domains.length);
    const batchDomains = this.domains.slice(startIndex, endIndex);
    
    const batchFile = `batch-${batchNumber}-domains.txt`;
    fs.writeFileSync(batchFile, batchDomains.join('\n'));
    
    return {
      file: batchFile,
      count: batchDomains.length,
      range: `${startIndex + 1}-${endIndex}`
    };
  }

  async processBatch(batchNumber) {
    const batchInfo = this.createBatchFile(batchNumber);
    const startTime = new Date();
    
    console.log(`\n🔄 Processing batch ${batchNumber}/${this.totalBatches}`);
    console.log(`📄 File: ${batchInfo.file}`);
    console.log(`📊 URLs: ${batchInfo.count} (${batchInfo.range})`);
    console.log(`⏰ Started: ${startTime.toLocaleTimeString()}`);
    
    return new Promise((resolve, reject) => {
      const args = [
        './bin/run.js',
        'scan',
        batchInfo.file,
        '--puppeteerType', 'vanilla',
        '--headless',
        '--skipProcessed',
        '--logDir', `logs-batch-${batchNumber}`,
        '--chunkSize', '50', // Process in smaller chunks for stability
        '--verbose'
      ];
      
      const child = spawn('node', args, {
        stdio: ['inherit', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        // Show real-time progress
        const lines = data.toString().split('\n');
        lines.forEach(line => {
          if (line.includes('Attempting to process URL:') || 
              line.includes('Successfully extracted data') ||
              line.includes('No relevant ad library')) {
            console.log(`  ${line.trim()}`);
          }
        });
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`  ⚠️  ${data.toString().trim()}`);
      });
      
      child.on('close', (code) => {
        const endTime = new Date();
        const duration = (endTime - startTime) / 1000;
        
        // Clean up batch file
        try {
          fs.unlinkSync(batchInfo.file);
        } catch (e) {
          // Ignore cleanup errors
        }
        
        const batchResult = {
          batchNumber,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration: `${duration.toFixed(1)}s`,
          urlCount: batchInfo.count,
          exitCode: code,
          success: code === 0
        };
        
        if (code === 0) {
          console.log(`✅ Batch ${batchNumber} completed successfully in ${duration.toFixed(1)}s`);
          
          // Update progress
          this.progress.lastCompletedBatch = batchNumber;
          this.progress.totalProcessed += batchInfo.count;
          this.progress.batches.push(batchResult);
          this.saveProgress();
          
          resolve(batchResult);
        } else {
          console.error(`❌ Batch ${batchNumber} failed with exit code ${code}`);
          batchResult.stdout = stdout;
          batchResult.stderr = stderr;
          this.progress.batches.push(batchResult);
          this.saveProgress();
          
          reject(new Error(`Batch ${batchNumber} failed with exit code ${code}`));
        }
      });
      
      child.on('error', (error) => {
        console.error(`❌ Failed to start batch ${batchNumber}:`, error.message);
        reject(error);
      });
    });
  }

  async run() {
    console.log('🚀 Starting batch processing of top domains');
    console.log('=' .repeat(60));
    
    // Download domains if not exists
    if (!fs.existsSync(DOMAINS_FILE)) {
      await this.downloadDomains();
    }
    
    // Load domains
    if (!this.loadDomains()) {
      process.exit(1);
    }
    
    // Show resume information
    if (this.progress.lastCompletedBatch > 0) {
      console.log(`\n📋 Resuming from batch ${this.currentBatch}`);
      console.log(`✅ Already processed: ${this.progress.totalProcessed} domains`);
      console.log(`⏳ Remaining: ${this.domains.length - this.progress.totalProcessed} domains`);
    }
    
    // Process batches
    let successCount = 0;
    let failureCount = 0;
    
    for (let batch = this.currentBatch; batch <= this.totalBatches; batch++) {
      try {
        await this.processBatch(batch);
        successCount++;
        
        // Show overall progress
        const processedSoFar = this.progress.totalProcessed;
        const progressPercent = ((processedSoFar / this.domains.length) * 100).toFixed(1);
        console.log(`📈 Overall progress: ${processedSoFar}/${this.domains.length} (${progressPercent}%)`);
        
        // Brief pause between batches to avoid overwhelming the system
        if (batch < this.totalBatches) {
          console.log('⏸️  Pausing 10 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
      } catch (error) {
        failureCount++;
        console.error(`❌ Batch ${batch} failed:`, error.message);
        
        // Ask if we should continue or stop
        console.log('\n❓ Batch failed. Continue with next batch? (y/n)');
        
        // For automated processing, we'll continue by default
        // In interactive mode, you could add readline here
        console.log('⏭️  Continuing with next batch...');
        
        // Pause longer after failures
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
    
    // Final summary
    console.log('\n' + '=' .repeat(60));
    console.log('🏁 Batch processing completed!');
    console.log(`✅ Successful batches: ${successCount}`);
    console.log(`❌ Failed batches: ${failureCount}`);
    console.log(`📊 Total processed: ${this.progress.totalProcessed} domains`);
    
    const totalTime = new Date() - new Date(this.progress.startTime);
    const hours = Math.floor(totalTime / (1000 * 60 * 60));
    const minutes = Math.floor((totalTime % (1000 * 60 * 60)) / (1000 * 60));
    console.log(`⏱️  Total time: ${hours}h ${minutes}m`);
  }
}

// Run the batch processor
const processor = new BatchProcessor();
processor.run().catch(error => {
  console.error('💥 Fatal error:', error.message);
  process.exit(1);
});