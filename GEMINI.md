# Gemini AI Agent Instructions

## Project: Prebid Integration Monitor

This document provides specific instructions for Google's Gemini AI to work effectively with this TypeScript/Node.js codebase.

## 🔧 Essential Build Step

**CRITICAL:** After any TypeScript (.ts) file modifications, always run:
```bash
npm run build
```

This compiles TypeScript to JavaScript and updates the CLI flags. Skip this step and new features won't work!

## 🧪 Testing Protocol for New Features

### Step 1: Verify CLI Compilation
```bash
# Check that new flags appear in help
node ./bin/run.js scan --help
```

### Step 2: Test New Functionality
```bash
# Test with minimal data first
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-5" --prefilterProcessed
```

### Step 3: Validate Integration
```bash
# Test batch processing with new flags
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=1 --totalUrls=50 --batchSize=10 --prefilterProcessed
```

## 📁 Project Structure for Gemini

### Key Files to Understand:
```
src/commands/scan-options.ts  → CLI flag definitions (add new flags here)
src/commands/scan.ts          → CLI command implementation  
src/prebid.ts                 → Core processing logic
src/utils/url-tracker.ts      → Database operations
```

### Data Flow:
1. **CLI** (scan-options.ts) → Parse flags
2. **Command** (scan.ts) → Orchestrate processing 
3. **Core** (prebid.ts) → Load URLs, apply filters, process
4. **Tracker** (url-tracker.ts) → Track processed URLs in SQLite
5. **Output** → JSON files in store/, error files in errors/

## 🚀 Smart Processing Features (New)

### Pre-filtering URLs:
```bash
# Check range efficiency before processing
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "10001-15000"
```

### Force Reprocessing:
```bash
# Explicitly reprocess URLs regardless of previous status
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --forceReprocess --range "1-100"
```

## 📊 Batch Processing Commands

### Start New Batch:
```bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=15001 --totalUrls=3000 --batchSize=250 --skipProcessed --prefilterProcessed --logDir=logs
```

### Resume Existing Batch:
```bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=10001 --totalUrls=5000 --batchSize=250 --resumeBatch=6 --skipProcessed --logDir=logs
```

## 🛠️ Development Workflow for Gemini

1. **Edit TypeScript files** (.ts)
2. **Run `npm run build`** (MANDATORY)
3. **Test with `--help`** to verify flags
4. **Test with small range** (--range "1-5")
5. **Verify logs and output files**
6. **Scale up to production ranges**

## ⚠️ Common Pitfalls for AI Agents

### Issue: "Unknown flag" errors
**Cause:** Forgot to build after TypeScript changes
**Solution:** `npm run build`

### Issue: Line breaks in commands
**Cause:** Multi-line commands don't copy-paste well
**Solution:** Always provide single-line commands

### Issue: "0 URLs processed" confusion
**Cause:** All URLs in range already processed
**Solution:** Use `--prefilterProcessed` to check efficiency first

## 📈 Performance Optimization Guide

### For Large Datasets:
- Use `--prefilterProcessed` to skip fully-processed ranges
- Use `--batchSize=250-1000` for top domain lists
- Use `--concurrency=3-10` with cluster mode

### For Testing:
- Always start with `--range "1-10"`
- Use `--headless` for faster processing
- Monitor log output for processing statistics

## 🔍 Debugging Commands

### Check Database Status:
```bash
# View database statistics
sqlite3 data/url-tracker.db "SELECT status, COUNT(*) FROM processed_urls GROUP BY status;"
```

### Check Processing Results:
```bash
# View recent output files
ls -la store/Jun-2025/
cat errors/no_prebid.txt | tail -10
```

### Batch Progress:
```bash
# Check batch progress files
ls -la batch-progress-*.json
cat batch-progress-10001-15000.json
```

## 🎯 Testing Checklist for Gemini

When implementing new features:

- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] New flags appear in `--help` output
- [ ] Small range test works (`--range "1-5"`)
- [ ] Log messages are appropriate
- [ ] Database updates correctly
- [ ] Output files created as expected
- [ ] Error handling works properly

## 💡 Gemini-Specific Tips

1. **Code Generation:** When generating TypeScript, ensure proper type definitions
2. **Flag Implementation:** Always add flags to both `scan-options.ts` AND map them in `scan.ts`
3. **Error Handling:** Wrap database operations in try-catch blocks
4. **Logging:** Use structured logging with appropriate log levels
5. **Testing:** Provide concrete test commands with actual URLs

## 🚀 Current Smart Features

The system now includes:
- **Intelligent range analysis** - Check processing efficiency before loading URLs
- **Smart suggestions** - Automatically suggest optimal next ranges
- **Force reprocessing** - Explicit reprocessing without database clearing
- **Comprehensive batch statistics** - Detailed progress tracking and reporting

Use `--prefilterProcessed` to leverage these smart features for optimal performance!