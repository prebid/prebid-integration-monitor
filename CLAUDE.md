# Claude AI Agent Instructions

## Project: Prebid Integration Monitor

This document provides instructions for Claude AI to effectively work with this codebase.

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

## Flag Reference

### Smart Processing Flags:

- `--prefilterProcessed` - Analyze ranges before processing
- `--forceReprocess` - Explicitly reprocess URLs regardless of previous status

### Batch Processing:

- `--batchMode` - Enable batch processing
- `--startUrl=N` - Starting URL number (1-based)
- `--totalUrls=N` - Total URLs to process
- `--batchSize=N` - URLs per batch
- `--resumeBatch=N` - Resume from specific batch

### URL Management:

- `--skipProcessed` - Skip already processed URLs
- `--resetTracking` - Clear tracking database
- `--range="start-end"` - Process specific URL range

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

1. Run `./resume-batch.sh` to get the correct resume command
2. Or manually check `batch-progress-*.json` for last completed batch
3. Use `--resumeBatch=N` where N is next batch to process

### "Requesting main frame too early" error:

This error occurs when Puppeteer tries to access a page frame that's being navigated/closed. It's a timing issue in Chrome DevTools Protocol, not specific to certain URLs.

The system now implements multiple layers of protection:

1. **Enhanced Cluster Processing** (Automatic):

   - Creates fresh clusters for smaller batches (50 URLs)
   - Isolates page contexts to prevent cascade failures
   - Implements timeouts and automatic recovery
   - Uses more conservative Chrome flags

2. **Page Lifecycle Tracking**:

   - OpenTelemetry tracing for all page events
   - Detailed error tracking with event history
   - Automatic error categorization

3. **Error Recovery**:
   - Individual URL errors don't crash the batch
   - Failed URLs are retried up to 2 times
   - Cluster health monitoring with automatic recreation

To recover from batch failures:

```bash
# Use the resume script
./resume-batch.sh

# Test problematic URLs
./test-problematic-urls.sh
```

If you continue to see this error:

1. Reduce concurrency: `--concurrency=2`
2. Check system resources (CPU/Memory)
3. Review logs for patterns in failing URLs

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

## Claude AI Best Practices

1. **Always build after TypeScript changes**: `npm run build`
2. **Test with small datasets first**: Use `--range "1-5"` for initial testing
3. **Provide single-line commands**: Avoid line breaks in command examples
4. **Check help output**: Verify new flags are available before testing
5. **Monitor log output**: Watch for processing statistics and suggestions
6. **Use appropriate batch sizes**: 250-1000 for production, 10-50 for testing

Remember: The system now intelligently suggests optimal ranges when current ranges are fully processed!

## Development Workflow

1. **Make TypeScript changes**
2. **Run `npm run build`**
3. **Test with `--help` flag**
4. **Test with small ranges first**
5. **Verify log outputs**
6. **Check database updates**

## Testing for Stability

The project now includes comprehensive tests for Puppeteer stability:

### Run Stability Tests:

```bash
# Test resilience to frame errors and crashes
npm run test:resilience

# Run stress tests with high concurrency
npm run test:stress

# Test health monitoring capabilities
npm run test:health

# Run all stability tests
npm run test:stability
```

### What These Tests Cover:

1. **Frame Detachment Errors** - Tests for "Requesting main frame too early" scenarios
2. **High Concurrency** - Stress tests with many simultaneous operations
3. **Error Recovery** - Tests cluster recovery from crashes
4. **Memory Management** - Checks for memory leaks
5. **Performance Monitoring** - Tracks processing times and anomalies

### When to Run:

- Before major releases
- After modifying cluster or Puppeteer handling code
- When investigating stability issues
- As part of CI/CD pipeline

## Error Patterns to Watch For

1. **Compilation errors** - Always check TypeScript compilation
2. **Flag validation errors** - Test new flags immediately
3. **Database connection issues** - Check if data directory exists
4. **GitHub rate limiting** - Use smaller ranges for testing

Always verify these indicators after implementing new features.
