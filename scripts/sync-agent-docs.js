#!/usr/bin/env node

/**
 * @fileoverview Agent documentation synchronization script
 * Ensures all agent markdown files (CLAUDE.md, GEMINI.md, AGENTS.md) are identical
 * so any AI agent can work with the project using the same comprehensive context.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
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

/**
 * Agent documentation files that should be kept identical
 */
const AGENT_FILES = ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];

/**
 * Calculate file hash for comparison
 */
function getFileHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Read file content safely
 */
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Find the most comprehensive/recent documentation file
 */
function findMasterFile() {
  let masterFile = null;
  let masterContent = null;
  let masterSize = 0;
  let masterTime = 0;

  for (const fileName of AGENT_FILES) {
    const filePath = path.join(process.cwd(), fileName);
    const content = readFileContent(filePath);

    if (content) {
      const stats = fs.statSync(filePath);
      const size = content.length;
      const modTime = stats.mtimeMs;

      // Prefer the largest file (most comprehensive)
      // If sizes are similar (within 5%), prefer the most recently modified
      if (
        !masterFile ||
        size > masterSize * 1.05 ||
        (size >= masterSize * 0.95 && modTime > masterTime)
      ) {
        masterFile = fileName;
        masterContent = content;
        masterSize = size;
        masterTime = modTime;
      }
    }
  }

  return { fileName: masterFile, content: masterContent, size: masterSize };
}

/**
 * Sync all documentation files to be identical
 */
function syncDocs() {
  logHeader('📝 Syncing Agent Documentation Files');

  // Find the master file (most comprehensive/recent)
  const master = findMasterFile();

  if (!master.fileName) {
    log('❌ No agent documentation files found!', 'red');
    log(
      '   Please create at least one of: CLAUDE.md, GEMINI.md, or AGENTS.md',
      'yellow'
    );
    return false;
  }

  log(
    `\n📋 Using ${master.fileName} as master (${master.size} characters)`,
    'cyan'
  );

  const masterHash = getFileHash(master.content);
  let updatedFiles = 0;
  let identicalFiles = 0;

  // Sync all files to match the master
  for (const fileName of AGENT_FILES) {
    const filePath = path.join(process.cwd(), fileName);
    const currentContent = readFileContent(filePath);

    if (!currentContent) {
      // File doesn't exist, create it
      fs.writeFileSync(filePath, master.content, 'utf8');
      log(`✅ Created ${fileName} (identical to ${master.fileName})`, 'green');
      updatedFiles++;
    } else if (getFileHash(currentContent) !== masterHash) {
      // File exists but differs, update it
      // Create backup first
      const backupPath = filePath + '.backup';
      fs.writeFileSync(backupPath, currentContent, 'utf8');

      // Update the file
      fs.writeFileSync(filePath, master.content, 'utf8');
      log(`✅ Updated ${fileName} to match ${master.fileName}`, 'green');
      log(`   📋 Backup saved to ${fileName}.backup`, 'blue');
      updatedFiles++;
    } else {
      // File is already identical
      identicalFiles++;
      if (fileName === master.fileName) {
        log(`✓ ${fileName} (master file)`, 'blue');
      } else {
        log(`✓ ${fileName} already identical`, 'blue');
      }
    }
  }

  // Update status file
  updateStatusFile();

  log(`\n📊 Summary:`, 'cyan');
  log(`   Master file: ${master.fileName} (${master.size} characters)`, 'cyan');
  log(`   Files updated: ${updatedFiles}`, updatedFiles > 0 ? 'green' : 'cyan');
  log(`   Files already in sync: ${identicalFiles}`, 'cyan');

  return updatedFiles > 0;
}

/**
 * Update the status file with sync information
 */
function updateStatusFile() {
  const statusPath = path.join(process.cwd(), '.agent-docs-status.json');

  const fileInfo = {};
  for (const fileName of AGENT_FILES) {
    const filePath = path.join(process.cwd(), fileName);
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      fileInfo[fileName] = {
        exists: true,
        size: content.length,
        lastModified: stats.mtime.toISOString(),
      };
    } catch (error) {
      fileInfo[fileName] = {
        exists: false,
        size: 0,
        lastModified: null,
      };
    }
  }

  const status = {
    timestamp: new Date().toISOString(),
    files: fileInfo,
    lastSync: new Date().toISOString(),
    syncVersion: '2.0.0', // Version 2: maintains identical files
  };

  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

/**
 * Validate that all files are identical
 */
function validateDocs() {
  logHeader('🔍 Validating Documentation Consistency');

  const hashes = {};
  const sizes = {};
  let allExist = true;

  for (const fileName of AGENT_FILES) {
    const filePath = path.join(process.cwd(), fileName);
    const content = readFileContent(filePath);

    if (content) {
      hashes[fileName] = getFileHash(content);
      sizes[fileName] = content.length;
      log(`✓ ${fileName} exists (${sizes[fileName]} characters)`, 'green');
    } else {
      log(`✗ ${fileName} is missing`, 'red');
      allExist = false;
    }
  }

  if (!allExist) {
    log('\n❌ Not all documentation files exist', 'red');
    return false;
  }

  // Check if all hashes are identical
  const uniqueHashes = new Set(Object.values(hashes));

  if (uniqueHashes.size === 1) {
    log('\n✅ All documentation files are identical!', 'green');
    return true;
  } else {
    log('\n❌ Documentation files are not synchronized:', 'red');

    // Show differences
    const hashGroups = {};
    for (const [fileName, hash] of Object.entries(hashes)) {
      if (!hashGroups[hash]) hashGroups[hash] = [];
      hashGroups[hash].push(fileName);
    }

    let groupNum = 1;
    for (const [hash, files] of Object.entries(hashGroups)) {
      log(`   Group ${groupNum}: ${files.join(', ')}`, 'yellow');
      groupNum++;
    }

    return false;
  }
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes('--help') || args.includes('-h')) {
      log('Usage: node sync-agent-docs.js [options]', 'cyan');
      log('\nOptions:', 'cyan');
      log('  --help, -h     Show this help message');
      log('  --validate     Validate that all files are identical');
      log('  --status       Show current status of documentation files');
      log(
        '\nThis script ensures CLAUDE.md, GEMINI.md, and AGENTS.md are identical'
      );
      log('so any AI agent can work with the project using the same context.');
      return;
    }

    if (args.includes('--validate')) {
      const isValid = validateDocs();
      process.exit(isValid ? 0 : 1);
    }

    if (args.includes('--status')) {
      validateDocs();
      return;
    }

    // Default action: sync the files
    const updated = syncDocs();

    if (updated) {
      log(
        '\n✨ Documentation sync complete! All agent files are now identical.',
        'green'
      );
    } else {
      log('\n✨ All documentation files are already in sync!', 'green');
    }
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { syncDocs, validateDocs, AGENT_FILES };
