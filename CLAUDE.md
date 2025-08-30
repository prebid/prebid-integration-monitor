# Claude AI Agent Instructions

## Project: Prebid Integration Monitor

This document provides comprehensive instructions for Claude AI to effectively work with this codebase. It includes infrastructure details, architecture patterns, testing methodologies, and best practices specific to this project.

## Table of Contents

1. [Critical Rules](#critical-rules)
2. [Technology Stack](#technology-stack--infrastructure)
3. [Architecture Overview](#architecture-overview)
4. [Testing Framework](#testing-framework--methodology)
5. [Development Workflow](#development-workflow)
6. [Data Flow](#data-flow--processing-pipeline)
7. [Error Handling](#error-handling-patterns)
8. [Performance](#performance-considerations)
9. [Common Issues](#common-issues--solutions)
10. [Best Practices](#best-practices)

## Critical Rules

1. **ALWAYS run `npm run build` after modifying any .ts files**
2. **Use Vitest imports, NEVER Jest imports**
3. **Test with small datasets first (--range "1-5")**
4. **Check git status before committing - avoid committing cache/db files**
5. **Run pre-commit validation: `npm run validate:pre-commit`**

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

## Technology Stack & Infrastructure

### Core Technologies

- **Language**: TypeScript (ES Modules)
- **Runtime**: Node.js v16+
- **CLI Framework**: OCLIF v2
- **Test Framework**: Vitest (NOT Jest!)
- **Web Automation**: Puppeteer & Puppeteer Cluster
- **Database**: SQLite with WAL mode
- **Logging**: Winston
- **Linting**: ESLint
- **Formatting**: Prettier
- **Documentation**: TypeDoc

### Key Dependencies

```json
{
  "puppeteer": "^23.11.1",
  "puppeteer-cluster": "^0.24.0",
  "puppeteer-extra": "^3.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2",
  "@oclif/core": "^4.0.0",
  "vitest": "^3.2.0",
  "winston": "^3.11.0",
  "sqlite3": "^5.1.6"
}
```

## Architecture Overview

### Project Structure

```
prebid-integration-monitor/
├── bin/                     # CLI entry points
│   ├── dev.js              # Development mode (ts-node)
│   └── run.js              # Production mode (compiled)
├── src/                    # TypeScript source code
│   ├── commands/           # OCLIF command implementations
│   │   ├── scan.ts         # Main scanning command
│   │   ├── scan-options.ts # CLI flag definitions
│   │   └── stats/          # Statistics commands
│   ├── common/             # Shared types and utilities
│   │   ├── types.ts        # Core TypeScript interfaces
│   │   └── AppError.ts     # Custom error handling
│   ├── utils/              # Core functionality
│   │   ├── puppeteer-task.ts     # Page processing logic
│   │   ├── url-tracker.ts        # SQLite URL deduplication
│   │   ├── results-handler.ts    # Output file management
│   │   ├── cluster-wrapper.ts    # Puppeteer cluster management
│   │   ├── browser-pool.ts       # Browser pool implementation
│   │   ├── content-cache.ts      # GitHub content caching
│   │   ├── domain-validator.ts   # URL validation
│   │   ├── error-types.ts        # Error categorization
│   │   ├── logger.ts             # Winston logger setup
│   │   ├── telemetry.ts          # OpenTelemetry integration
│   │   └── user-agent.ts         # Dynamic UA generation
│   ├── __tests__/          # Integration tests
│   └── prebid.ts           # Main orchestration logic
├── tests/                  # CLI tests
├── dist/                   # Compiled JavaScript
├── data/                   # SQLite database
├── store/                  # Successful extractions (JSON)
├── errors/                 # Error categorization files
├── logs/                   # Application logs
└── .githooks/             # Git pre-commit hooks
```

### Core Components

#### 1. CLI Layer (OCLIF)

- **Entry Point**: `bin/run.js` → `src/commands/scan.ts`
- **Flag Parsing**: `src/commands/scan-options.ts`
- **Validation**: Type-safe flag definitions with OCLIF

#### 2. Processing Engine

- **Orchestrator**: `src/prebid.ts`
- **Page Processor**: `src/utils/puppeteer-task.ts`
- **Cluster Management**: `src/utils/cluster-wrapper.ts`
- **Error Recovery**: Automatic retry with exponential backoff

#### 3. Data Management

- **URL Tracking**: SQLite database with prepared statements
- **Content Caching**: LRU cache for GitHub content
- **Results Storage**: JSON files organized by date
- **Error Tracking**: Categorized error files

#### 4. Performance Optimizations

- **Database**: WAL mode, indexes, connection pooling
- **Memory**: Streaming processing, garbage collection
- **Concurrency**: Dynamic worker allocation
- **Caching**: Multi-level caching strategy

## Flag Reference

### Smart Processing Flags:

- `--prefilterProcessed` - Analyze ranges before processing
- `--forceReprocess` - Explicitly reprocess URLs regardless of previous status
- `--prebidOnly` - Process only URLs where Prebid was previously detected

### Batch Processing:

- `--batchMode` - Enable batch processing
- `--startUrl=N` - Starting URL number (1-based)
- `--totalUrls=N` - Total URLs to process
- `--batchSize=N` - URLs per batch
- `--resumeBatch=N` - Resume from specific batch

### URL Management:

- `--skipProcessed` - Skip already processed URLs
- `--resetTracking` - Clear tracking database
- `--range="start-end"` - Process specific URL range (positions refer to original file, not filtered list)

### Configuration Capture:

- `--prebidConfigDetail=none|raw` - Capture raw Prebid configuration from pbjs.getConfig()
- `--identityUsageDetail=none|comprehensive` - Capture identity usage and storage correlation

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

### Reprocess Known Prebid Sites:

```bash
# Process first 100 Prebid sites with config capture
node ./bin/run.js scan --prebidOnly --range "1-100" --prebidConfigDetail=raw --headless

# Process Prebid sites 1001-2000 with identity usage capture  
node ./bin/run.js scan --prebidOnly --range "1001-2000" --identityUsageDetail=comprehensive --headless

# Batch process all Prebid sites in chunks
node ./bin/run.js scan --prebidOnly --batchMode --startUrl=1 --totalUrls=5000 --batchSize=500 --prebidConfigDetail=raw
```

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

## Range Behavior

When using `--range` with `--skipProcessed`:

1. **Range positions are absolute**: `--range "30001-40000"` always refers to lines 30,001-40,000 in the original file
2. **Skip only applies within range**: Only URLs within the specified range that have been processed are skipped
3. **Original positions maintained**: The range doesn't shift based on how many URLs were previously processed

Example:
- File has URLs at positions 1-100,000
- Positions 1-10,000 were previously processed
- `--range "5001-15000" --skipProcessed` will:
  - Load URLs from positions 5,001-15,000 (10,000 URLs)
  - Skip positions 5,001-10,000 (already processed)
  - Process positions 10,001-15,000 (5,000 new URLs)

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

## Claude AI Best Practices

1. **Always build after TypeScript changes**: `npm run build`
2. **Test with small datasets first**: Use `--range "1-5"` for initial testing
3. **Provide single-line commands**: Avoid line breaks in command examples
4. **Check help output**: Verify new flags are available before testing
5. **Monitor log output**: Watch for processing statistics and suggestions
6. **Use appropriate batch sizes**: 250-1000 for production, 10-50 for testing

Remember: The system now intelligently suggests optimal ranges when current ranges are fully processed!

## Testing Framework & Methodology

### ⚠️ IMPORTANT: This project uses Vitest, NOT Jest!

#### Test Structure

```
src/
├── __tests__/                    # Integration tests
│   ├── batch-processing.test.ts
│   ├── cli-integration-regression.test.ts
│   ├── cluster-stress.test.ts
│   ├── github-range-integration.test.ts
│   ├── health-monitoring.test.ts
│   ├── optimization-integration.test.ts
│   ├── progress-tracking.test.ts
│   ├── promise-resolution-validation.test.ts
│   ├── puppeteer-accuracy.test.ts
│   ├── puppeteer-resilience.test.ts
│   ├── url-count-verification.test.ts
│   └── url-processing-integration.test.ts
└── utils/__tests__/              # Unit tests
    ├── content-cache.test.ts
    ├── file-system-utils.test.ts
    ├── logger.test.ts
    ├── prebid-integration.test.ts
    ├── puppeteer-task.test.ts
    ├── stats-processing.test.ts
    ├── url-loading-optimizations.test.ts
    ├── url-tracker-simple.test.ts
    └── url-tracker.test.ts
```

#### Writing Tests

```typescript
// CORRECT - Vitest imports
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// WRONG - Jest imports (DO NOT USE)
import { describe, it, expect, jest } from '@jest/globals';

// Mocking in Vitest
const mockFn = vi.fn();
vi.mock('./module');
vi.spyOn(object, 'method');
```

#### Running Tests

```bash
npm test                          # Run all tests except CLI
npm run test:all                  # Run all tests
npm run test:critical             # Critical integration tests
npm run test:regression           # Regression test suite
npm run test:stress               # Stress tests
npm run test:health               # Health monitoring tests
npm run test:resilience           # Resilience tests
npm test -- --run                 # Run without watch mode
npm test -- --reporter=verbose    # Verbose output
npm test -- -t "test name"        # Run specific test
```

## Development Workflow

### 1. TypeScript Development

```bash
# Always build after .ts changes
npm run build

# Check TypeScript without emitting
npm run build:check

# Watch mode for development
tsc --watch
```

### 2. Testing Workflow

```bash
# 1. Make changes
# 2. Build
npm run build

# 3. Test specific functionality
npm test -- --run src/utils/__tests__/puppeteer-task.test.ts

# 4. Run integration tests
npm run test:integration

# 5. Full validation
npm run validate:all
```

### 3. Git Workflow

```bash
# Setup git hooks
npm run setup:hooks

# Pre-commit validation runs automatically
git commit -m "message"

# Manual validation
npm run validate:pre-commit
```

## Data Flow & Processing Pipeline

### 1. URL Loading

```
GitHub/File → url-loader.ts → Content Cache → Domain Validation
                    ↓
              Range Processing → URL Deduplication (SQLite)
```

### 2. Page Processing

```
URL Queue → Cluster/Browser Pool → puppeteer-task.ts
                    ↓
            Page Navigation → Data Extraction → Error Handling
                    ↓
              TaskResult Generation
```

### 3. Result Handling

```
TaskResult → results-handler.ts → Success: store/YYYY-MM-DD.json
                    ↓
                Error Categorization → errors/*.txt
                    ↓
              URL Tracker Update → SQLite Database
```

## Error Handling Patterns

### Error Categories

```typescript
// src/utils/error-types.ts
-DNS_RESOLUTION_FAILED -
  CONNECTION_REFUSED -
  NAVIGATION_TIMEOUT -
  INVALID_CERTIFICATE -
  BROWSER_CRASH -
  CONTEXT_DESTROYED -
  PUPPETEER_TIMEOUT -
  UNKNOWN_ERROR;
```

### Error Recovery Strategy

1. **Immediate Retry**: For transient errors
2. **Exponential Backoff**: For rate limiting
3. **Circuit Breaker**: For systematic failures
4. **Graceful Degradation**: Continue processing other URLs

## Performance Considerations

### Memory Management

- **Batch Processing**: Process URLs in chunks
- **Stream Processing**: Don't load entire files
- **Garbage Collection**: Force GC between batches
- **Resource Cleanup**: Always close pages/browsers

### Concurrency Tuning

```javascript
// Optimal settings by machine type
const concurrency = {
  development: 2 - 3,
  production: 5 - 10,
  highMemory: 10 - 20,
};
```

### Database Optimization

```sql
-- Key indexes for performance
CREATE INDEX idx_url_tracker_status ON url_tracker(status);
CREATE INDEX idx_url_tracker_composite ON url_tracker(status, timestamp);
CREATE INDEX idx_url_tracker_url ON url_tracker(url);

-- Pragma settings
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
```

## Common Issues & Solutions

### 1. "Flag doesn't exist" error

```bash
npm run build  # Always rebuild after adding flags
```

### 2. Test import errors

```typescript
// Wrong
import { jest } from '@jest/globals';

// Correct
import { vi } from 'vitest';
```

### 3. Database locked errors

```bash
# Remove stale lock files
rm data/url-tracker.db-shm data/url-tracker.db-wal
```

### 4. Memory issues

```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" npm run scan
```

### 5. Puppeteer crashes

```javascript
// Add browser args
puppeteerOptions: {
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
}
```

## Best Practices

### 1. Code Organization

- One responsibility per file
- Clear separation of concerns
- Type-safe interfaces
- Comprehensive error handling

### 2. Testing

- Test edge cases
- Mock external dependencies
- Use realistic test data
- Clean up test artifacts

### 3. Performance

- Profile before optimizing
- Monitor memory usage
- Use appropriate batch sizes
- Cache expensive operations

### 4. Documentation

- Update CLAUDE.md for AI context
- Document complex logic
- Keep README current
- Use TypeDoc comments

Always verify these patterns when implementing new features!

## Key Interfaces & Types

### Core Types (src/common/types.ts)

```typescript
// Task result types
export type TaskResult = TaskResultSuccess | TaskResultNoData | TaskResultError;

export interface TaskResultSuccess {
  type: 'success';
  data: PageData;
}

export interface TaskResultNoData {
  type: 'no_data';
  url: string;
}

export interface TaskResultError {
  type: 'error';
  url: string;
  error: {
    code: string;
    message: string;
    stack?: string;
  };
}

// Page data structure
export interface PageData {
  url: string;
  date: string;
  libraries: string[];
  prebidInstances: PrebidInstance[];
  cdpPlatforms?: string[];
  identitySolutions?: string[];
}

// Prebid instance
export interface PrebidInstance {
  version?: string;
  timeout?: number;
  adUnits?: number;
  bidders?: string[];
  modules?: string[];
}
```

### CLI Options (src/prebid.ts)

```typescript
export interface PrebidExplorerOptions {
  inputFile?: string;
  githubRepo?: string;
  numUrls?: number;
  puppeteerType: 'vanilla' | 'cluster';
  concurrency: number;
  headless: boolean;
  monitor: boolean;
  outputDir: string;
  logDir: string;
  range?: string;
  chunkSize?: number;
  skipProcessed?: boolean;
  resetTracking?: boolean;
  prefilterProcessed?: boolean;
  forceReprocess?: boolean;
  discoveryMode?: boolean;
  batchMode?: boolean;
  startUrl?: number;
  totalUrls?: number;
  batchSize?: number;
  resumeBatch?: number;
  puppeteerLaunchOptions?: PuppeteerLaunchOptions;
}
```

## Environment Variables

```bash
# Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096"

# Debug mode
DEBUG=puppeteer:*

# Disable Chrome sandbox (Docker/CI)
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## Git Configuration

### .gitignore patterns

```
# Cache files
.cache/

# Database files
data/url-tracker.db
data/url-tracker.db-shm
data/url-tracker.db-wal

# Logs
logs/
*.log

# Test artifacts
test-cli-temp/
test-temp/

# Build output
dist/
```

### Pre-commit hooks (.githooks/pre-commit)

- Runs ESLint
- Runs Prettier
- Runs tests
- Validates TypeScript compilation
- Checks for documentation sync

## NPM Scripts Reference

```bash
# Building
npm run build              # Compile TypeScript
npm run build:check        # Type check only

# Testing
npm test                   # Run tests (excluding CLI)
npm run test:all          # All tests
npm run test:critical     # Critical tests only
npm run test:regression   # Regression suite
npm run test:stress       # Stress tests
npm run test:health       # Health monitoring

# Validation
npm run validate:all      # Full validation suite
npm run validate:pre-commit # Pre-commit checks
npm run validate:integration # Integration validation

# Linting & Formatting
npm run lint              # ESLint
npm run format            # Prettier

# Documentation
npm run docs:generate     # TypeDoc
npm run sync-agent-docs   # Sync AI docs

# Git Hooks
npm run setup:hooks       # Configure git hooks
```

## Debugging Tips

### 1. Enable verbose logging

```bash
node ./bin/run.js scan --verbose --logDir=debug-logs
```

### 2. Debug Puppeteer

```bash
# Disable headless mode
node ./bin/run.js scan --githubRepo ... --range "1-2" --headless=false

# Enable Puppeteer debug logs
DEBUG=puppeteer:* npm run scan
```

### 3. Database debugging

```bash
# Check database contents
sqlite3 data/url-tracker.db "SELECT COUNT(*) FROM url_tracker;"
sqlite3 data/url-tracker.db "SELECT * FROM url_tracker LIMIT 10;"
```

### 4. Memory profiling

```bash
# Generate heap snapshot
node --inspect ./bin/run.js scan ...
# Open chrome://inspect in Chrome
```

## Project Conventions

### File Naming

- TypeScript files: `kebab-case.ts`
- Test files: `*.test.ts`
- Type definition files: `types.ts`

### Code Style

- 2 spaces indentation
- Single quotes for strings
- Semicolons required
- Trailing commas in multiline

### Git Commit Messages

```
feat: add new feature
fix: resolve bug
docs: update documentation
test: add/update tests
refactor: code improvements
perf: performance optimization
chore: maintenance tasks
```

### Error Messages

- User-facing: Clear, actionable
- Logs: Detailed with context
- Always include error codes

This comprehensive guide should help you work effectively with the Prebid Integration Monitor codebase!
