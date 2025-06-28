# Comprehensive Testing Strategy for URL Loading Pipeline

## Overview
This document outlines a comprehensive testing strategy to prevent issues like the ones we just encountered from happening in the future. The goal is to catch problems early through automated testing.

## Current Issues We Solved
1. **Domain parsing logic not handling files without extensions**
2. **GitHub URL fetching returning 0 URLs due to parsing logic mismatch**
3. **Range processing causing timeout issues on large files**
4. **Telemetry system conflicts between OpenTelemetry and simplified systems**

## 1. Unit Tests for URL Loading Pipeline

### Test Suite: `url-loader.test.ts`

```typescript
describe('URL Loading Pipeline', () => {
  describe('processFileContent', () => {
    it('should parse domain files without extensions', async () => {
      const content = 'google.com\nyoutube.com\nfacebook.com';
      const result = await processFileContent('top-domains', content, mockLogger);
      expect(result).toEqual(['https://google.com', 'https://youtube.com', 'https://facebook.com']);
    });

    it('should handle .txt files with schemeless domains', async () => {
      const content = 'example.com\ntest.org';
      const result = await processFileContent('domains.txt', content, mockLogger);
      expect(result).toContain('https://example.com');
    });

    it('should parse fully qualified URLs', async () => {
      const content = 'https://example.com\nhttp://test.org';
      const result = await processFileContent('urls.txt', content, mockLogger);
      expect(result).toEqual(['https://example.com', 'http://test.org']);
    });
  });

  describe('fetchUrlsFromGitHub', () => {
    it('should handle GitHub URLs with range optimization', async () => {
      // Mock fetch response with domain list
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('google.com\nyoutube.com\nfacebook.com\nbaidu.com\nyahoo.com'),
        status: 200,
        headers: { get: () => '100' }
      });

      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        undefined,
        mockLogger,
        { startRange: 2, endRange: 4 }
      );

      expect(result).toEqual(['https://youtube.com', 'https://facebook.com', 'https://baidu.com']);
    });

    it('should respect numUrls limit when no range specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('domain1.com\ndomain2.com\ndomain3.com'),
        status: 200,
        headers: { get: () => '100' }
      });

      const result = await fetchUrlsFromGitHub(
        'https://github.com/test/repo/blob/main/domains',
        2,
        mockLogger
      );

      expect(result).toHaveLength(2);
    });
  });
});
```

### Test Suite: `range-optimization.test.ts`

```typescript
describe('Range Optimization', () => {
  it('should only process requested range to prevent timeouts', async () => {
    const largeContent = Array.from({ length: 100000 }, (_, i) => `domain${i}.com`).join('\n');
    
    const startTime = Date.now();
    const result = await processContentWithRangeOptimization(
      largeContent,
      'large-domains',
      1000,
      1050,
      mockLogger
    );
    const endTime = Date.now();

    expect(result).toHaveLength(50);
    expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    expect(result[0]).toBe('https://domain999.com'); // 0-based index
  });

  it('should fallback to full processing for small files', async () => {
    const smallContent = 'domain1.com\ndomain2.com\ndomain3.com';
    
    const result = await processContentWithRangeOptimization(
      smallContent,
      'small-domains',
      undefined,
      undefined,
      mockLogger
    );

    expect(result).toHaveLength(3);
  });
});
```

## 2. Integration Tests

### Test Suite: `batch-processing.test.ts`

```typescript
describe('Batch Processing Integration', () => {
  it('should handle GitHub repo with range processing', async () => {
    // Test with actual small GitHub repo or mock
    const result = await prebidExplorer({
      githubRepo: 'https://github.com/test/small-domain-list/blob/main/domains',
      range: '1-10',
      puppeteerType: 'vanilla',
      concurrency: 1,
      headless: true,
      monitor: false,
      outputDir: 'test-output',
      logDir: 'test-logs'
    });

    // Should complete without timeout
    expect(result).toBeDefined();
  });

  it('should not timeout on large ranges with optimization', async () => {
    const startTime = Date.now();
    
    await prebidExplorer({
      githubRepo: 'https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains',
      range: '50000-50100',
      puppeteerType: 'vanilla',
      concurrency: 1,
      headless: true,
      monitor: false,
      outputDir: 'test-output',
      logDir: 'test-logs'
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
  });
});
```

## 3. Performance Tests

### Test Suite: `performance.test.ts`

```typescript
describe('Performance Tests', () => {
  it('should handle large domain lists efficiently', async () => {
    const metrics = await measurePerformance(async () => {
      return fetchUrlsFromGitHub(
        'https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains',
        undefined,
        mockLogger,
        { startRange: 10000, endRange: 10100 }
      );
    });

    expect(metrics.duration).toBeLessThan(5000); // 5 seconds max
    expect(metrics.memoryUsage).toBeLessThan(100 * 1024 * 1024); // 100MB max
  });

  it('should not load entire file when using range optimization', async () => {
    const memoryBefore = process.memoryUsage().heapUsed;
    
    await fetchUrlsFromGitHub(
      'https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains',
      undefined,
      mockLogger,
      { startRange: 1, endRange: 100 }
    );

    const memoryAfter = process.memoryUsage().heapUsed;
    const memoryIncrease = memoryAfter - memoryBefore;
    
    // Should not load entire ~90k domain list into memory
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // 10MB max increase
  });
});
```

## 4. End-to-End Tests

### Test Suite: `e2e-pipeline.test.ts`

```typescript
describe('End-to-End Pipeline Tests', () => {
  it('should process GitHub domain list with batch mode', async () => {
    const command = [
      'node', './bin/run.js', 'scan',
      '--githubRepo', 'https://github.com/test/small-domains/blob/main/list',
      '--batchMode',
      '--startUrl=1',
      '--totalUrls=20',
      '--batchSize=10',
      '--skipProcessed',
      '--logDir=test-e2e'
    ];

    const result = await runCommand(command, { timeout: 30000 });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('BATCH PROCESSING COMPLETE');
    expect(result.stdout).not.toContain('tracer is not defined');
    expect(result.stdout).not.toContain('NO VALID URLS FOUND');
  });

  it('should handle telemetry initialization correctly', async () => {
    const command = ['node', './bin/run.js', 'scan', '--help'];
    const result = await runCommand(command);
    
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('tracer is not defined');
  });
});
```

## 5. Regression Tests

### Test Suite: `regression.test.ts`

```typescript
describe('Regression Tests', () => {
  it('should not regress on domain parsing for files without extensions', async () => {
    // Test the specific issue we just fixed
    const githubContent = 'google.com\nyoutube.com\nfacebook.com';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(githubContent),
      status: 200,
      headers: { get: () => '100' }
    });

    const result = await fetchUrlsFromGitHub(
      'https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains',
      undefined,
      mockLogger
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatch(/^https:\/\//);
  });

  it('should not timeout on range requests beyond numUrls limit', async () => {
    // Ensure we don't regress on the numUrls vs range issue
    const mockContent = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`).join('\n');
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockContent),
      status: 200,
      headers: { get: () => '10000' }
    });

    const result = await fetchUrlsFromGitHub(
      'https://github.com/test/domains/blob/main/list',
      100, // numUrls limit
      mockLogger,
      { startRange: 500, endRange: 520 } // Range beyond numUrls
    );

    expect(result.length).toBe(20); // Should get the range, not be limited by numUrls
  });
});
```

## 6. Test Automation Setup

### Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest --exclude tests/cli.test.ts",
    "test:unit": "vitest src/**/*.test.ts",
    "test:integration": "vitest tests/integration/**/*.test.ts",
    "test:e2e": "vitest tests/e2e/**/*.test.ts",
    "test:performance": "vitest tests/performance/**/*.test.ts --reporter=verbose",
    "test:regression": "vitest tests/regression/**/*.test.ts",
    "test:coverage": "vitest --coverage",
    "test:watch": "vitest --watch"
  }
}
```

### Add Pre-commit Hook:

```bash
#!/bin/sh
# .git/hooks/pre-commit

echo "Running URL loading pipeline tests..."
npm run test:unit -- --run
npm run test:regression -- --run

if [ $? -ne 0 ]; then
  echo "Tests failed. Commit aborted."
  exit 1
fi
```

## 7. CI/CD Pipeline Tests

### GitHub Actions Workflow:

```yaml
# .github/workflows/url-pipeline-tests.yml
name: URL Loading Pipeline Tests

on: [push, pull_request]

jobs:
  test-url-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run regression tests
        run: npm run test:regression
      
      - name: Test GitHub URL parsing
        run: |
          timeout 30s node ./bin/run.js scan \
            --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains \
            --range "1-10" \
            --logDir test-ci
      
      - name: Verify no timeout issues
        run: |
          if grep -q "NO VALID URLS FOUND" test-ci/app.log; then
            echo "URL parsing regression detected"
            exit 1
          fi
```

## 8. Monitoring and Alerting

### Add Performance Monitoring:

```typescript
// src/utils/performance-monitor.ts
export class URLPipelineMonitor {
  static trackPerformance(operation: string, duration: number, urlCount: number) {
    const metrics = {
      operation,
      duration,
      urlCount,
      urlsPerSecond: urlCount / (duration / 1000),
      timestamp: new Date().toISOString()
    };
    
    // Log performance metrics
    logger.info('Performance metrics', metrics);
    
    // Alert on performance degradation
    if (metrics.urlsPerSecond < 100) { // Less than 100 URLs/second
      logger.warn('URL processing performance below threshold', metrics);
    }
  }
}
```

## Summary

This comprehensive testing strategy will help prevent the issues we encountered:

1. **Unit tests** catch basic parsing logic errors
2. **Integration tests** verify component interactions
3. **Performance tests** prevent timeout and memory issues
4. **E2E tests** validate the complete pipeline
5. **Regression tests** ensure we don't reintroduce fixed bugs
6. **CI/CD automation** runs tests on every change
7. **Performance monitoring** alerts on degradation

By implementing this strategy, we can catch issues like domain parsing failures, timeout problems, and telemetry conflicts before they reach production.