# Claude AI Agent Instructions

## Project: Prebid Integration Monitor

This document provides instructions for Claude AI to effectively work with this codebase.

## Testing New Features Protocol

### Always Run These Commands After Making Changes:

1. **Build the project after TypeScript changes:**
   ```bash
   npm run build
   ```

2. **Test CLI flags and help output:**
   ```bash
   node ./bin/run.js scan --help
   ```

3. **Verify new flags are available:**
   - Check that new flags appear in the help output
   - Test flag validation with invalid inputs

4. **Test common command patterns:**
   ```bash
   # Test GitHub repo processing
   node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-10" --skipProcessed

   # Test batch processing
   node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=1 --totalUrls=100 --batchSize=25 --skipProcessed

   # Test new flags
   node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "1-10"
   ```

## Project Structure

### Key Files:
- `src/commands/scan-options.ts` - CLI flag definitions
- `src/commands/scan.ts` - Main scan command logic
- `src/prebid.ts` - Core processing engine
- `src/utils/url-tracker.ts` - URL deduplication and tracking

### Critical Dependencies:
- **TypeScript compilation required** after any .ts file changes
- **oclif framework** for CLI - flags must be properly exported
- **better-sqlite3** for URL tracking database

## Common Issues and Solutions

### 1. "Flag doesn't exist" Error
**Cause:** TypeScript not compiled after changes
**Solution:** Always run `npm run build` after editing .ts files

### 2. Command Line Formatting
**Issue:** Line breaks in commands cause parsing errors
**Solution:** Provide single-line commands for copy-paste

### 3. Database Location
**Location:** `data/url-tracker.db`
**Reset:** Use `--resetTracking` flag or delete the file

### 4. Batch Progress Files
**Location:** `batch-progress-{start}-{end}.json` in project root
**Purpose:** Track batch completion and enable resume functionality

## Testing Commands

### Essential Test Commands:
```bash
# Quick functionality test
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --range "1-5" --headless

# Batch processing test
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --batchMode --startUrl=1 --totalUrls=50 --batchSize=10

# Pre-filtering test
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --prefilterProcessed --range "1-100"

# Force reprocess test
node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --forceReprocess --range "1-5"
```

## Development Workflow

1. **Make TypeScript changes**
2. **Run `npm run build`**
3. **Test with `--help` flag**
4. **Test with small ranges first**
5. **Verify log outputs**
6. **Check database updates**

## Flag Reference

### New Smart Processing Flags:
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

## Error Patterns to Watch For

1. **Compilation errors** - Always check TypeScript compilation
2. **Flag validation errors** - Test new flags immediately
3. **Database connection issues** - Check if data directory exists
4. **GitHub rate limiting** - Use smaller ranges for testing

## Success Indicators

- New flags appear in `--help` output
- Commands execute without "unknown flag" errors
- Appropriate log messages appear
- Database files are created/updated
- Batch progress files are generated

Always verify these indicators after implementing new features.