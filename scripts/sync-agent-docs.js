#!/usr/bin/env node

/**
 * @fileoverview Agent documentation synchronization script
 * Ensures all agent markdown files (CLAUDE.md, GEMINI.md, AGENTS.md) stay in sync
 * with shared content while maintaining agent-specific customizations.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
 * Configuration for agent documentation files
 */
const AGENT_CONFIGS = {
  'CLAUDE.md': {
    title: 'Claude AI Agent Instructions',
    persona: 'Claude AI',
    specificSections: [
      'claude-specific-tips',
      'claude-workflow-notes'
    ]
  },
  'GEMINI.md': {
    title: 'Gemini AI Agent Instructions',
    persona: 'Google\'s Gemini AI',
    specificSections: [
      'gemini-specific-tips',
      'gemini-code-generation',
      'gemini-performance-notes'
    ]
  },
  'AGENTS.md': {
    title: 'AI Agent Instructions - Prebid Integration Monitor',
    persona: 'AI agents (Claude, Gemini, GPT, etc.)',
    specificSections: [
      'universal-guidelines',
      'cross-platform-compatibility'
    ]
  }
};

/**
 * Shared content sections that should be identical across all files
 */
const SHARED_SECTIONS = {
  buildProtocol: {
    title: '🚨 CRITICAL: Always Build After TypeScript Changes',
    content: `**NEVER skip this step when modifying .ts files:**
\`\`\`bash
npm run build
\`\`\``
  },
  
  quickTesting: {
    title: 'Quick Testing Protocol',
    content: `### 1. Verify CLI Changes Work
\`\`\`bash
# Check if new flags appear
node ./bin/run.js scan --help

# Test new functionality with small dataset
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-5" --headless
\`\`\`

### 2. Standard Test Commands
\`\`\`bash
# Basic functionality test
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-10" --skipProcessed

# Batch processing test  
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=1 --totalUrls=100 --batchSize=25

# Pre-filtering test (new feature)
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "1-100"
\`\`\``
  },

  flagReference: {
    title: 'Flag Reference',
    content: `### Smart Processing Flags:
- \`--prefilterProcessed\` - Analyze ranges before processing
- \`--forceReprocess\` - Explicitly reprocess URLs regardless of previous status

### Batch Processing:
- \`--batchMode\` - Enable batch processing
- \`--startUrl=N\` - Starting URL number (1-based)
- \`--totalUrls=N\` - Total URLs to process
- \`--batchSize=N\` - URLs per batch
- \`--resumeBatch=N\` - Resume from specific batch

### URL Management:
- \`--skipProcessed\` - Skip already processed URLs
- \`--resetTracking\` - Clear tracking database
- \`--range="start-end"\` - Process specific URL range`
  },

  commonCommands: {
    title: 'Common Commands for Copy-Paste',
    content: `### Resume Batch Processing:
\`\`\`bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=10001 --totalUrls=5000 --batchSize=250 --resumeBatch=6 --skipProcessed --prefilterProcessed --logDir=logs
\`\`\`

### Start New Range:
\`\`\`bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=15001 --totalUrls=3000 --batchSize=250 --skipProcessed --prefilterProcessed --logDir=logs
\`\`\`

### Check Range Efficiency:
\`\`\`bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "20001-25000"
\`\`\`

### Force Reprocess Range:
\`\`\`bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --forceReprocess --range "1-1000" --batchSize=100
\`\`\``
  },

  troubleshooting: {
    title: 'Troubleshooting Guide',
    content: `### "Flag doesn't exist" error:
1. Run \`npm run build\`
2. Check \`src/commands/scan-options.ts\` for flag definition
3. Verify flag is added to \`src/commands/scan.ts\` options mapping

### "0 URLs processed" issue:
- Use \`--prefilterProcessed\` to check range efficiency first
- Consider using \`--forceReprocess\` if you want to reprocess
- Check suggestions for next optimal ranges

### Database issues:
\`\`\`bash
# Reset database
rm data/url-tracker.db

# Or use flag
node ./bin/run.js scan --resetTracking ...
\`\`\`

### Resume batch processing:
1. Check \`batch-progress-*.json\` for last completed batch
2. Use \`--resumeBatch=N\` where N is next batch to process`
  },

  successIndicators: {
    title: 'Success Indicators',
    content: `✅ New flags appear in \`--help\` output  
✅ Commands execute without unknown flag errors  
✅ Appropriate log messages appear  
✅ Database files created/updated  
✅ Batch progress files generated  
✅ Output files created in \`store/\` directory`
  }
};

/**
 * Read existing file content
 */
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

/**
 * Generate agent-specific content based on shared sections
 */
function generateAgentContent(agentFile, config) {
  const persona = config.persona;
  const title = config.title;
  
  let content = `# ${title}

## Project: Prebid Integration Monitor

This document provides instructions for ${persona} to effectively work with this codebase.

## ${SHARED_SECTIONS.buildProtocol.title}

${SHARED_SECTIONS.buildProtocol.content}

## ${SHARED_SECTIONS.quickTesting.title}

${SHARED_SECTIONS.quickTesting.content}

## Architecture Overview

\`\`\`
src/
├── commands/
│   ├── scan.ts              # Main CLI command logic
│   └── scan-options.ts      # Flag definitions (EDIT HERE for new flags)
├── prebid.ts                # Core processing engine  
├── utils/
│   ├── url-tracker.ts       # SQLite database for URL deduplication
│   ├── puppeteer-task.ts    # Individual page processing
│   └── results-handler.ts   # Output file management
└── common/
    └── types.ts             # Shared TypeScript types
\`\`\`

## ${SHARED_SECTIONS.flagReference.title}

${SHARED_SECTIONS.flagReference.content}

## Data Storage Locations

\`\`\`
project-root/
├── data/
│   └── url-tracker.db           # SQLite database for processed URLs
├── store/
│   └── Jun-2025/
│       └── YYYY-MM-DD.json      # Daily successful extractions
├── errors/
│   ├── no_prebid.txt            # URLs with no ad tech
│   ├── error_processing.txt     # Processing errors
│   └── navigation_errors.txt    # Navigation failures
├── batch-progress-*.json        # Batch processing state
└── logs-*/                      # Batch-specific log directories
\`\`\`

## ${SHARED_SECTIONS.commonCommands.title}

${SHARED_SECTIONS.commonCommands.content}

## ${SHARED_SECTIONS.troubleshooting.title}

${SHARED_SECTIONS.troubleshooting.content}

## Performance Optimization

### For Large Domain Lists:
1. Use \`--prefilterProcessed\` to avoid loading already-processed ranges
2. Use appropriate \`--batchSize\` (250-1000 for top domains)
3. Consider \`--puppeteerType=cluster\` with \`--concurrency=3-10\`

### For Testing:
1. Always use small ranges first (\`--range "1-10"\`)
2. Use \`--headless\` for faster processing
3. Check \`--help\` output after any changes

## ${SHARED_SECTIONS.successIndicators.title}

${SHARED_SECTIONS.successIndicators.content}

## ${persona} Best Practices

1. **Always build after TypeScript changes**: \`npm run build\`
2. **Test with small datasets first**: Use \`--range "1-5"\` for initial testing
3. **Provide single-line commands**: Avoid line breaks in command examples
4. **Check help output**: Verify new flags are available before testing
5. **Monitor log output**: Watch for processing statistics and suggestions
6. **Use appropriate batch sizes**: 250-1000 for production, 10-50 for testing

Remember: The system now intelligently suggests optimal ranges when current ranges are fully processed!`;

  // Add agent-specific sections
  if (agentFile === 'CLAUDE.md') {
    content += `

## Development Workflow

1. **Make TypeScript changes**
2. **Run \`npm run build\`**
3. **Test with \`--help\` flag**
4. **Test with small ranges first**
5. **Verify log outputs**
6. **Check database updates**

## Error Patterns to Watch For

1. **Compilation errors** - Always check TypeScript compilation
2. **Flag validation errors** - Test new flags immediately
3. **Database connection issues** - Check if data directory exists
4. **GitHub rate limiting** - Use smaller ranges for testing

Always verify these indicators after implementing new features.`;
  }

  if (agentFile === 'GEMINI.md') {
    content += `

## 🛠️ Development Workflow for Gemini

1. **Edit TypeScript files** (.ts)
2. **Run \`npm run build\`** (MANDATORY)
3. **Test with \`--help\`** to verify flags
4. **Test with small range** (--range "1-5")
5. **Verify logs and output files**
6. **Scale up to production ranges**

## ⚠️ Common Pitfalls for AI Agents

### Issue: "Unknown flag" errors
**Cause:** Forgot to build after TypeScript changes
**Solution:** \`npm run build\`

### Issue: Line breaks in commands
**Cause:** Multi-line commands don't copy-paste well
**Solution:** Always provide single-line commands

### Issue: "0 URLs processed" confusion
**Cause:** All URLs in range already processed
**Solution:** Use \`--prefilterProcessed\` to check efficiency first

## 💡 Gemini-Specific Tips

1. **Code Generation:** When generating TypeScript, ensure proper type definitions
2. **Flag Implementation:** Always add flags to both \`scan-options.ts\` AND map them in \`scan.ts\`
3. **Error Handling:** Wrap database operations in try-catch blocks
4. **Logging:** Use structured logging with appropriate log levels
5. **Testing:** Provide concrete test commands with actual URLs`;
  }

  if (agentFile === 'AGENTS.md') {
    content += `

## Agent Best Practices

1. **Always build after TypeScript changes**: \`npm run build\`
2. **Test with small datasets first**: Use \`--range "1-5"\` for initial testing
3. **Provide single-line commands**: Avoid line breaks in command examples
4. **Check help output**: Verify new flags are available before testing
5. **Monitor log output**: Watch for processing statistics and suggestions
6. **Use appropriate batch sizes**: 250-1000 for production, 10-50 for testing

## Testing Checklist for AI Agents

When implementing new features:

- [ ] TypeScript compiles without errors (\`npm run build\`)
- [ ] New flags appear in \`--help\` output
- [ ] Small range test works (\`--range "1-5"\`)
- [ ] Log messages are appropriate
- [ ] Database updates correctly
- [ ] Output files created as expected
- [ ] Error handling works properly`;
  }

  return content;
}

/**
 * Update agent documentation files
 */
function updateAgentDocs() {
  logHeader('🔄 Synchronizing Agent Documentation');
  
  let updatedFiles = 0;
  let totalFiles = 0;
  
  for (const [fileName, config] of Object.entries(AGENT_CONFIGS)) {
    totalFiles++;
    const filePath = path.join(process.cwd(), fileName);
    const newContent = generateAgentContent(fileName, config);
    const existingContent = readFileContent(filePath);
    
    if (existingContent !== newContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      log(`✅ Updated ${fileName}`, 'green');
      updatedFiles++;
    } else {
      log(`⏭️  ${fileName} already up to date`, 'blue');
    }
  }
  
  log(`\n📊 Summary: ${updatedFiles}/${totalFiles} files updated`, 'cyan');
  return updatedFiles > 0;
}

/**
 * Validate documentation consistency
 */
function validateDocs() {
  logHeader('🔍 Validating Documentation Consistency');
  
  const issues = [];
  
  // Check that all files exist
  for (const fileName of Object.keys(AGENT_CONFIGS)) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) {
      issues.push(`Missing file: ${fileName}`);
    }
  }
  
  // Check for shared content consistency
  const fileContents = {};
  for (const fileName of Object.keys(AGENT_CONFIGS)) {
    const filePath = path.join(process.cwd(), fileName);
    fileContents[fileName] = readFileContent(filePath);
  }
  
  // Validate shared sections are present in all files
  for (const [sectionName, section] of Object.entries(SHARED_SECTIONS)) {
    for (const [fileName, content] of Object.entries(fileContents)) {
      if (content && !content.includes(section.title)) {
        issues.push(`${fileName} missing shared section: ${section.title}`);
      }
    }
  }
  
  if (issues.length === 0) {
    log('✅ All documentation files are consistent', 'green');
  } else {
    log('⚠️  Found documentation issues:', 'yellow');
    issues.forEach(issue => log(`   • ${issue}`, 'red'));
  }
  
  return issues.length === 0;
}

/**
 * Add git hook for automatic synchronization
 */
function setupGitHook() {
  logHeader('🔗 Setting Up Git Hook');
  
  const hookPath = path.join(process.cwd(), '.git', 'hooks', 'pre-commit');
  const hookContent = `#!/bin/sh
# Auto-sync agent documentation before commits

echo "🔄 Syncing agent documentation..."
node scripts/sync-agent-docs.js --auto

# Add any updated docs to the commit
git add CLAUDE.md GEMINI.md AGENTS.md 2>/dev/null || true
`;

  try {
    // Create hooks directory if it doesn't exist
    const hooksDir = path.dirname(hookPath);
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    
    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
    log('✅ Git pre-commit hook installed', 'green');
    log('   Documentation will auto-sync before commits', 'blue');
  } catch (error) {
    log('⚠️  Could not install git hook:', 'yellow');
    log(`   ${error.message}`, 'red');
  }
}

/**
 * Generate documentation status report
 */
function generateStatusReport() {
  logHeader('📋 Documentation Status Report');
  
  const report = {
    timestamp: new Date().toISOString(),
    files: {},
    sharedSections: Object.keys(SHARED_SECTIONS).length,
    lastSync: null
  };
  
  for (const fileName of Object.keys(AGENT_CONFIGS)) {
    const filePath = path.join(process.cwd(), fileName);
    const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    
    report.files[fileName] = {
      exists: !!stats,
      size: stats ? stats.size : 0,
      lastModified: stats ? stats.mtime.toISOString() : null
    };
  }
  
  // Save report
  const reportPath = path.join(process.cwd(), '.agent-docs-status.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // Display summary
  log('📁 File Status:', 'cyan');
  for (const [fileName, info] of Object.entries(report.files)) {
    const status = info.exists ? '✅' : '❌';
    const size = info.exists ? `(${(info.size / 1024).toFixed(1)}KB)` : '';
    log(`   ${status} ${fileName} ${size}`, info.exists ? 'green' : 'red');
  }
  
  log(`\n📊 Shared sections: ${report.sharedSections}`, 'blue');
  log(`📅 Report saved to: .agent-docs-status.json`, 'cyan');
}

/**
 * Main execution function
 */
function main() {
  const args = process.argv.slice(2);
  const isAutoMode = args.includes('--auto');
  const validateOnly = args.includes('--validate');
  const setupHook = args.includes('--setup-hook');
  
  if (!isAutoMode) {
    log('🤖 Agent Documentation Synchronization Tool', 'bright');
  }
  
  if (setupHook) {
    setupGitHook();
    return;
  }
  
  if (validateOnly) {
    const isValid = validateDocs();
    process.exit(isValid ? 0 : 1);
  }
  
  // Update documentation
  const hasUpdates = updateAgentDocs();
  
  // Validate consistency
  const isValid = validateDocs();
  
  // Generate status report
  if (!isAutoMode) {
    generateStatusReport();
  }
  
  if (hasUpdates && !isAutoMode) {
    log('\n💡 Consider committing the updated documentation:', 'yellow');
    log('   git add CLAUDE.md GEMINI.md AGENTS.md', 'cyan');
    log('   git commit -m "sync: update agent documentation"', 'cyan');
  }
  
  if (!isValid) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}