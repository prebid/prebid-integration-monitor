#!/usr/bin/env node

/**
 * @fileoverview Data status checker for prebid-integration-monitor
 * Provides quick overview of current data storage state
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function logHeader(message) {
  const line = '='.repeat(60);
  log('\n' + line, 'cyan');
  log(message, 'bright');
  log(line, 'cyan');
}

function checkDatabaseStatus() {
  logHeader('📊 Database Status');

  const dbPath = 'data/url-tracker.db';
  if (!existsSync(dbPath)) {
    log('❌ Database not found: data/url-tracker.db', 'red');
    return;
  }

  try {
    // Get database file size
    const stats = statSync(dbPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    log(`✅ Database found: ${sizeMB} MB`, 'green');
    log(`📅 Last modified: ${stats.mtime.toLocaleString()}`, 'blue');

    // Try to get row count using sqlite3 if available
    try {
      const result = execSync(
        'sqlite3 data/url-tracker.db "SELECT COUNT(*) FROM processed_urls;"',
        { encoding: 'utf8' }
      ).trim();
      log(
        `🔢 Total processed URLs: ${parseInt(result).toLocaleString()}`,
        'green'
      );
    } catch (e) {
      log('⚠️  Cannot read database (sqlite3 command not available)', 'yellow');
    }
  } catch (error) {
    log(`❌ Error checking database: ${error.message}`, 'red');
  }
}

function checkJsonFiles() {
  logHeader('📁 JSON Output Files');

  const storeDir = 'store';
  if (!existsSync(storeDir)) {
    log('❌ Store directory not found', 'red');
    return;
  }

  // Check recent months
  const months = ['Jun-2025', 'May', 'Apr', 'Mar', 'Feb'];
  let totalFiles = 0;
  let totalSize = 0;
  let latestFile = null;
  let latestDate = null;

  for (const month of months) {
    const monthDir = join(storeDir, month);
    if (existsSync(monthDir)) {
      const files = readdirSync(monthDir).filter((f) => f.endsWith('.json'));
      if (files.length > 0) {
        log(`📂 ${month}: ${files.length} files`, 'blue');
        totalFiles += files.length;

        // Check latest file in this month
        for (const file of files) {
          const filePath = join(monthDir, file);
          const stats = statSync(filePath);
          totalSize += stats.size;

          if (!latestDate || stats.mtime > latestDate) {
            latestDate = stats.mtime;
            latestFile = join(month, file);
          }
        }
      }
    }
  }

  log(`\n📊 Summary:`, 'cyan');
  log(`   • Total JSON files: ${totalFiles}`, 'green');
  log(`   • Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`, 'green');
  if (latestFile) {
    log(`   • Latest file: ${latestFile}`, 'green');
    log(`   • Last updated: ${latestDate.toLocaleString()}`, 'blue');

    // Check content of latest file
    try {
      const content = readFileSync(join(storeDir, latestFile), 'utf8');
      const lines = content.split('\n').length;
      log(`   • Latest file size: ${lines} lines`, 'blue');
    } catch (e) {
      log(`   • Could not read latest file`, 'yellow');
    }
  }
}

function checkErrorFiles() {
  logHeader('⚠️  Error Tracking Files');

  const errorDir = 'errors';
  if (!existsSync(errorDir)) {
    log('❌ Errors directory not found', 'red');
    return;
  }

  const errorFiles = [
    'no_prebid.txt',
    'error_processing.txt',
    'navigation_errors.txt',
    'no_prebid_now.txt',
    'preload_errors.txt',
  ];

  let totalErrorUrls = 0;

  for (const filename of errorFiles) {
    const filepath = join(errorDir, filename);
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf8');
        const lineCount = content
          .split('\n')
          .filter((line) => line.trim()).length;
        totalErrorUrls += lineCount;

        const stats = statSync(filepath);
        log(`📄 ${filename}: ${lineCount.toLocaleString()} URLs`, 'blue');
        log(`   Last updated: ${stats.mtime.toLocaleString()}`, 'magenta');
      } catch (e) {
        log(`❌ Error reading ${filename}: ${e.message}`, 'red');
      }
    } else {
      log(`⚪ ${filename}: Not found`, 'yellow');
    }
  }

  log(
    `\n📊 Total error URLs tracked: ${totalErrorUrls.toLocaleString()}`,
    'cyan'
  );
}

function checkBatchProgress() {
  logHeader('🔄 Batch Processing Status');

  // Look for batch progress files
  const progressFiles = readdirSync('.').filter(
    (f) => f.startsWith('batch-progress-') && f.endsWith('.json')
  );

  if (progressFiles.length === 0) {
    log('⚪ No batch progress files found', 'yellow');
    return;
  }

  for (const file of progressFiles) {
    try {
      const content = JSON.parse(readFileSync(file, 'utf8'));
      const rangeMatch = file.match(/batch-progress-(\d+)-(\d+)\.json/);

      if (rangeMatch) {
        const startUrl = parseInt(rangeMatch[1]);
        const endUrl = parseInt(rangeMatch[2]);
        const totalUrls = endUrl - startUrl + 1;

        log(
          `📊 Range ${startUrl.toLocaleString()}-${endUrl.toLocaleString()} (${totalUrls.toLocaleString()} URLs):`,
          'blue'
        );
        log(
          `   • Completed batches: ${content.completedBatches?.length || 0}`,
          'green'
        );
        log(
          `   • Failed batches: ${content.failedBatches?.length || 0}`,
          content.failedBatches?.length > 0 ? 'red' : 'green'
        );

        if (content.startTime) {
          log(
            `   • Started: ${new Date(content.startTime).toLocaleString()}`,
            'magenta'
          );
        }

        if (content.completedBatches && content.completedBatches.length > 0) {
          const lastBatch =
            content.completedBatches[content.completedBatches.length - 1];
          log(
            `   • Last completed: ${new Date(lastBatch.completedAt).toLocaleString()}`,
            'magenta'
          );
          log(`   • Last range: ${lastBatch.range}`, 'blue');
        }
      }
    } catch (e) {
      log(`❌ Error reading ${file}: ${e.message}`, 'red');
    }
  }
}

function checkTodaysActivity() {
  logHeader("📅 Today's Activity");

  const today = new Date().toISOString().slice(0, 10);
  const todayFile = `store/Jun-2025/${today}.json`;

  if (existsSync(todayFile)) {
    try {
      const content = readFileSync(todayFile, 'utf8');
      const lines = content.split('\n').filter((line) => line.trim()).length;
      const stats = statSync(todayFile);

      log(`✅ Today's file exists: ${todayFile}`, 'green');
      log(`   • Content: ${lines} lines`, 'blue');
      log(`   • Last updated: ${stats.mtime.toLocaleString()}`, 'blue');
      log(`   • Size: ${(stats.size / 1024).toFixed(2)} KB`, 'blue');
    } catch (e) {
      log(`❌ Error reading today's file: ${e.message}`, 'red');
    }
  } else {
    log(`⚪ No data file for today (${today})`, 'yellow');
    log(`   This is normal if no new URLs were processed today`, 'magenta');
  }

  // Check for today's log files
  const logDirs = readdirSync('.').filter(
    (d) =>
      d.startsWith('logs-batch-') && existsSync(d) && statSync(d).isDirectory()
  );

  let todaysLogs = 0;
  for (const logDir of logDirs) {
    const logFile = join(logDir, 'app.log');
    if (existsSync(logFile)) {
      const stats = statSync(logFile);
      if (stats.mtime.toDateString() === new Date().toDateString()) {
        todaysLogs++;
      }
    }
  }

  if (todaysLogs > 0) {
    log(`📋 Found ${todaysLogs} batch log directories from today`, 'green');
  } else {
    log(`⚪ No batch processing logs from today`, 'yellow');
  }
}

function provideSuggestions() {
  logHeader('💡 Suggestions & Next Steps');

  log('🔍 To process new URLs:', 'cyan');
  log("   • Use a range beyond what's already processed", 'blue');
  log(
    '   • Example: --startUrl=15001 --totalUrls=5000 --batchSize=250',
    'green'
  );

  log("\n📊 To check what's been processed:", 'cyan');
  log(
    '   • sqlite3 data/url-tracker.db "SELECT COUNT(*) FROM processed_urls;"',
    'green'
  );
  log('   • ls -la store/Jun-2025/', 'green');
  log('   • tail errors/no_prebid.txt', 'green');

  log('\n🔄 If you want to reprocess existing URLs:', 'cyan');
  log('   • Add --resetTracking flag to your command', 'green');
  log('   • Or remove --skipProcessed flag', 'green');

  log('\n🎯 To see processing in action:', 'cyan');
  log('   • Process a small new range: --range "100001-100010"', 'green');
  log('   • Watch the logs for immediate feedback', 'green');
}

// Main execution
async function main() {
  log('🔍 Prebid Integration Monitor - Data Status Check', 'bright');
  log(`📅 Generated: ${new Date().toLocaleString()}`, 'magenta');

  checkDatabaseStatus();
  checkJsonFiles();
  checkErrorFiles();
  checkBatchProgress();
  checkTodaysActivity();
  provideSuggestions();

  log('\n✅ Data status check complete!', 'green');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
