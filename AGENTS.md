# AI Agent Instructions - Prebid Integration Monitor

## Universal Agent Guidelines

This document provides instructions for AI agents (Claude, Gemini, GPT, etc.) working with this codebase.

## 🚨 CRITICAL: Always Build After TypeScript Changes

**NEVER skip this step when modifying .ts files:**
```bash
npm run build
```

## Quick Testing Protocol

### 1. Verify CLI Changes Work
```bash
# Check if new flags appear
node ./bin/run.js scan --help

# Test new functionality with small dataset
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-5" --headless
```

### 2. Standard Test Commands
```bash
# Basic functionality test
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-10" --skipProcessed

# Batch processing test  
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=1 --totalUrls=100 --batchSize=25

# Pre-filtering test (new feature)
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "1-100"
```

## Architecture Overview

```
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
```

## Flag Categories

### Core Processing:
- `--puppeteerType` - vanilla|cluster
- `--concurrency` - Number of parallel browsers
- `--headless` - Browser visibility (default: true)

### URL Management:
- `--githubRepo` - Process URLs from GitHub repository
- `--range` - Specific URL range (e.g., "1-1000")
- `--skipProcessed` - Skip already processed URLs
- `--prefilterProcessed` - ⭐ NEW: Check efficiency before processing
- `--forceReprocess` - ⭐ NEW: Reprocess regardless of previous status

### Batch Processing:
- `--batchMode` - Enable automatic batch processing
- `--startUrl` - Starting URL number (1-based)
- `--totalUrls` - Total URLs to process
- `--batchSize` - URLs per batch (default: 250)
- `--resumeBatch` - Resume from specific batch number

## Data Storage Locations

```
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
```

## Common Commands for Copy-Paste

### Resume Batch Processing:
```bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=10001 --totalUrls=5000 --batchSize=250 --resumeBatch=6 --skipProcessed --prefilterProcessed --logDir=logs
```

### Start New Range:
```bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=15001 --totalUrls=3000 --batchSize=250 --skipProcessed --prefilterProcessed --logDir=logs
```

### Check Range Efficiency:
```bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "20001-25000"
```

### Force Reprocess Range:
```bash
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --forceReprocess --range "1-1000" --batchSize=100
```

## Troubleshooting Guide

### "Flag doesn't exist" error:
1. Run `npm run build`
2. Check `src/commands/scan-options.ts` for flag definition
3. Verify flag is added to `src/commands/scan.ts` options mapping

### "0 URLs processed" issue:
- Use `--prefilterProcessed` to check range efficiency first
- Consider using `--forceReprocess` if you want to reprocess
- Check suggestions for next optimal ranges

### Database issues:
```bash
# Reset database
rm data/url-tracker.db

# Or use flag
node ./bin/run.js scan --resetTracking ...
```

### Resume batch processing:
1. Check `batch-progress-*.json` for last completed batch
2. Use `--resumeBatch=N` where N is next batch to process

## Performance Optimization

### For Large Domain Lists:
1. Use `--prefilterProcessed` to avoid loading already-processed ranges
2. Use appropriate `--batchSize` (250-1000 for top domains)
3. Consider `--puppeteerType=cluster` with `--concurrency=3-10`

### For Testing:
1. Always use small ranges first (`--range "1-10"`)
2. Use `--headless` for faster processing
3. Check `--help` output after any changes

## Success Indicators

✅ New flags appear in `--help` output  
✅ Commands execute without unknown flag errors  
✅ Appropriate log messages appear  
✅ Database files created/updated  
✅ Batch progress files generated  
✅ Output files created in `store/` directory  

## Agent Best Practices

1. **Always build after TypeScript changes**: `npm run build`
2. **Test with small datasets first**: Use `--range "1-5"` for initial testing
3. **Provide single-line commands**: Avoid line breaks in command examples
4. **Check help output**: Verify new flags are available before testing
5. **Monitor log output**: Watch for processing statistics and suggestions
6. **Use appropriate batch sizes**: 250-1000 for production, 10-50 for testing

Remember: The system now intelligently suggests optimal ranges when current ranges are fully processed!