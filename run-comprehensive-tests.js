#!/usr/bin/env node

/**
 * @fileoverview Comprehensive test runner for URL processing verification
 * Automated test execution with detailed reporting and analysis
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
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

const TEST_RESULTS_DIR = './test-results';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

class TestRunner {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      testSuites: [],
      errors: [],
      performance: {},
      summary: {}
    };

    this.testSuites = [
      {
        name: 'Unit Tests - processPageTask',
        path: 'src/utils/__tests__/puppeteer-task.test.ts',
        description: 'Core page processing function unit tests',
        priority: 'high'
      },
      {
        name: 'Integration Tests - Cluster vs Vanilla',
        path: 'src/__tests__/url-processing-integration.test.ts',
        description: 'Compare cluster and vanilla mode processing',
        priority: 'high'
      },
      {
        name: 'Promise Resolution Validation',
        path: 'src/__tests__/promise-resolution-validation.test.ts',
        description: 'Identify and fix Promise resolution issues',
        priority: 'high'
      },
      {
        name: 'URL Count Verification',
        path: 'src/__tests__/url-count-verification.test.ts',
        description: 'Verify exact URL counts (5, 10, 25 URLs)',
        priority: 'high'
      }
    ];
  }

  log(message, color = 'reset') {
    console.log(`${COLORS[color]}${message}${COLORS.reset}`);
  }

  logHeader(message) {
    const line = '='.repeat(60);
    this.log('\n' + line, 'cyan');
    this.log(message, 'bright');
    this.log(line, 'cyan');
  }

  logSubheader(message) {
    this.log('\n' + '-'.repeat(40), 'blue');
    this.log(message, 'yellow');
    this.log('-'.repeat(40), 'blue');
  }

  async setupTestEnvironment() {
    this.logHeader('Setting Up Test Environment');

    // Create test results directory
    if (!existsSync(TEST_RESULTS_DIR)) {
      mkdirSync(TEST_RESULTS_DIR, { recursive: true });
      this.log('✓ Created test results directory', 'green');
    }

    // Check dependencies
    try {
      execSync('npm list vitest', { stdio: 'pipe' });
      this.log('✓ Vitest is available', 'green');
    } catch (error) {
      this.log('✗ Vitest not found - installing...', 'yellow');
      try {
        execSync('npm install vitest --save-dev', { stdio: 'inherit' });
        this.log('✓ Vitest installed successfully', 'green');
      } catch (installError) {
        this.log('✗ Failed to install Vitest', 'red');
        throw installError;
      }
    }

    // Verify TypeScript compilation
    try {
      this.log('Checking TypeScript compilation...', 'blue');
      execSync('npm run build', { stdio: 'pipe' });
      this.log('✓ TypeScript compilation successful', 'green');
    } catch (error) {
      this.log('⚠ TypeScript compilation issues detected', 'yellow');
      this.results.errors.push({
        type: 'compilation',
        message: 'TypeScript compilation failed',
        details: error.message
      });
    }
  }

  async runTestSuite(testSuite) {
    this.logSubheader(`Running: ${testSuite.name}`);
    this.log(`Description: ${testSuite.description}`, 'blue');
    this.log(`Priority: ${testSuite.priority.toUpperCase()}`, testSuite.priority === 'high' ? 'red' : 'yellow');
    this.log(`Path: ${testSuite.path}`, 'magenta');

    const startTime = Date.now();
    const suiteResult = {
      name: testSuite.name,
      path: testSuite.path,
      priority: testSuite.priority,
      startTime: new Date().toISOString(),
      duration: 0,
      status: 'unknown',
      tests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      output: ''
    };

    try {
      // Check if test file exists
      if (!existsSync(testSuite.path)) {
        throw new Error(`Test file not found: ${testSuite.path}`);
      }

      // Run the specific test suite
      const command = `npx vitest run ${testSuite.path} --reporter=json --reporter=verbose`;
      this.log(`Executing: ${command}`, 'blue');

      const output = execSync(command, { 
        encoding: 'utf8',
        stdio: 'pipe',
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      suiteResult.output = output;
      suiteResult.status = 'passed';
      
      // Parse JSON output for detailed results
      try {
        const lines = output.split('\n');
        const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('"testResults"'));
        
        if (jsonLine) {
          const testData = JSON.parse(jsonLine);
          if (testData.testResults && testData.testResults.length > 0) {
            const testResult = testData.testResults[0];
            suiteResult.tests = testResult.assertionResults?.length || 0;
            suiteResult.passed = testResult.assertionResults?.filter(a => a.status === 'passed').length || 0;
            suiteResult.failed = testResult.assertionResults?.filter(a => a.status === 'failed').length || 0;
            suiteResult.skipped = testResult.assertionResults?.filter(a => a.status === 'pending').length || 0;
          }
        }
      } catch (parseError) {
        // Fallback: parse from verbose output
        const testMatches = output.match(/✓|✗|⏭/g);
        if (testMatches) {
          suiteResult.tests = testMatches.length;
          suiteResult.passed = (output.match(/✓/g) || []).length;
          suiteResult.failed = (output.match(/✗/g) || []).length;
          suiteResult.skipped = (output.match(/⏭/g) || []).length;
        }
      }

      this.log(`✓ Test suite completed successfully`, 'green');
      this.log(`  Tests: ${suiteResult.tests}, Passed: ${suiteResult.passed}, Failed: ${suiteResult.failed}, Skipped: ${suiteResult.skipped}`, 'blue');

    } catch (error) {
      suiteResult.status = 'failed';
      suiteResult.errors.push({
        message: error.message,
        output: error.stdout?.toString() || '',
        error: error.stderr?.toString() || ''
      });

      this.log(`✗ Test suite failed: ${error.message}`, 'red');
      
      // Try to extract meaningful error information
      if (error.stdout) {
        const errorLines = error.stdout.toString().split('\n')
          .filter(line => line.includes('Error') || line.includes('Failed') || line.includes('✗'))
          .slice(0, 5);
        errorLines.forEach(line => this.log(`  ${line}`, 'red'));
      }
    }

    suiteResult.duration = Date.now() - startTime;
    suiteResult.endTime = new Date().toISOString();

    // Update overall results
    this.results.totalTests += suiteResult.tests;
    this.results.passedTests += suiteResult.passed;
    this.results.failedTests += suiteResult.failed;
    this.results.skippedTests += suiteResult.skipped;
    this.results.testSuites.push(suiteResult);

    return suiteResult;
  }

  async runAllTests() {
    this.logHeader('Running Comprehensive URL Processing Tests');
    
    const startTime = Date.now();

    for (const testSuite of this.testSuites) {
      await this.runTestSuite(testSuite);
    }

    const totalDuration = Date.now() - startTime;

    // Generate performance metrics
    this.results.performance = {
      totalDuration,
      averageTestTime: this.results.totalTests > 0 ? totalDuration / this.results.totalTests : 0,
      testsPerSecond: this.results.totalTests > 0 ? (this.results.totalTests / totalDuration) * 1000 : 0,
      suitesPerformed: this.testSuites.length,
      averageSuiteTime: totalDuration / this.testSuites.length
    };

    // Generate summary
    this.results.summary = {
      overallStatus: this.results.failedTests === 0 ? 'PASSED' : 'FAILED',
      passRate: this.results.totalTests > 0 ? (this.results.passedTests / this.results.totalTests * 100).toFixed(2) : 0,
      criticalIssues: this.results.testSuites.filter(s => s.priority === 'high' && s.status === 'failed').length,
      recommendations: this.generateRecommendations()
    };

    return this.results;
  }

  generateRecommendations() {
    const recommendations = [];

    // Check for Promise resolution issues
    const promiseTest = this.results.testSuites.find(s => s.name.includes('Promise Resolution'));
    if (promiseTest && promiseTest.failed > 0) {
      recommendations.push({
        priority: 'HIGH',
        issue: 'Promise Resolution Issues Detected',
        description: 'Cluster mode is not properly returning TaskResult objects',
        action: 'Fix cluster.task registration and ensure proper return value handling'
      });
    }

    // Check for URL count discrepancies
    const countTest = this.results.testSuites.find(s => s.name.includes('URL Count'));
    if (countTest && countTest.failed > 0) {
      recommendations.push({
        priority: 'HIGH',
        issue: 'URL Count Verification Failed',
        description: 'Not all URLs are being processed or results captured',
        action: 'Investigate Promise.allSettled handling and result accumulation'
      });
    }

    // Check integration test failures
    const integrationTest = this.results.testSuites.find(s => s.name.includes('Integration'));
    if (integrationTest && integrationTest.failed > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        issue: 'Integration Test Failures',
        description: 'Cluster and vanilla modes showing inconsistent behavior',
        action: 'Review mode-specific implementations and ensure consistency'
      });
    }

    // Performance recommendations
    if (this.results.performance.averageTestTime > 1000) {
      recommendations.push({
        priority: 'LOW',
        issue: 'Performance Concerns',
        description: 'Tests are running slower than expected',
        action: 'Optimize test setup and mock implementations'
      });
    }

    return recommendations;
  }

  generateDetailedReport() {
    this.logHeader('Generating Detailed Test Report');

    const report = {
      metadata: {
        timestamp: this.results.timestamp,
        testRunner: 'Comprehensive URL Processing Test Suite',
        version: '1.0.0',
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch
        }
      },
      ...this.results
    };

    // Save JSON report
    const jsonReportPath = join(TEST_RESULTS_DIR, `test-report-${TIMESTAMP}.json`);
    writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));
    this.log(`✓ JSON report saved: ${jsonReportPath}`, 'green');

    // Generate markdown report
    const markdownReport = this.generateMarkdownReport(report);
    const mdReportPath = join(TEST_RESULTS_DIR, `test-report-${TIMESTAMP}.md`);
    writeFileSync(mdReportPath, markdownReport);
    this.log(`✓ Markdown report saved: ${mdReportPath}`, 'green');

    return report;
  }

  generateMarkdownReport(report) {
    return `# Comprehensive URL Processing Test Report

**Generated:** ${report.metadata.timestamp}
**Environment:** Node.js ${report.metadata.environment.nodeVersion} on ${report.metadata.environment.platform}

## Executive Summary

| Metric | Value |
|--------|-------|
| Overall Status | **${report.summary.overallStatus}** |
| Total Tests | ${report.totalTests} |
| Pass Rate | ${report.summary.passRate}% |
| Critical Issues | ${report.summary.criticalIssues} |
| Duration | ${(report.performance.totalDuration / 1000).toFixed(2)}s |

## Test Suite Results

${report.testSuites.map(suite => `
### ${suite.name}
- **Status:** ${suite.status.toUpperCase()}
- **Priority:** ${suite.priority.toUpperCase()}
- **Tests:** ${suite.tests} (✓ ${suite.passed}, ✗ ${suite.failed}, ⏭ ${suite.skipped})
- **Duration:** ${(suite.duration / 1000).toFixed(2)}s
- **Description:** ${this.testSuites.find(s => s.name === suite.name)?.description || 'N/A'}

${suite.errors.length > 0 ? `**Errors:**
${suite.errors.map(error => `- ${error.message}`).join('\n')}` : ''}
`).join('\n')}

## Performance Metrics

| Metric | Value |
|--------|-------|
| Total Duration | ${(report.performance.totalDuration / 1000).toFixed(2)}s |
| Average Test Time | ${report.performance.averageTestTime.toFixed(2)}ms |
| Tests Per Second | ${report.performance.testsPerSecond.toFixed(2)} |
| Suites Performed | ${report.performance.suitesPerformed} |

## Recommendations

${report.summary.recommendations.map(rec => `
### ${rec.priority} PRIORITY: ${rec.issue}
**Description:** ${rec.description}
**Action:** ${rec.action}
`).join('\n')}

## Detailed Analysis

### Promise Resolution Issue Investigation
${report.testSuites.find(s => s.name.includes('Promise Resolution'))?.status === 'failed' 
  ? `❌ **CONFIRMED**: Promise resolution issues detected in cluster mode. This explains why TaskResult objects are not being captured properly.`
  : `✅ **VERIFIED**: Promise resolution is working correctly in test scenarios.`}

### URL Count Verification
${report.testSuites.find(s => s.name.includes('URL Count'))?.status === 'failed'
  ? `❌ **ISSUE**: URL count verification failed. Not all URLs are being processed or results captured.`
  : `✅ **VERIFIED**: URL counts are accurate across different scenarios.`}

### Integration Testing
${report.testSuites.find(s => s.name.includes('Integration'))?.status === 'failed'
  ? `❌ **INCONSISTENCY**: Cluster and vanilla modes showing different behavior.`
  : `✅ **CONSISTENT**: Cluster and vanilla modes behave consistently.`}

---
*Report generated by Comprehensive URL Processing Test Suite v1.0.0*
`;
  }

  async displaySummary() {
    this.logHeader('Test Execution Summary');

    const status = this.results.summary.overallStatus;
    const statusColor = status === 'PASSED' ? 'green' : 'red';

    this.log(`Overall Status: ${status}`, statusColor);
    this.log(`Total Test Suites: ${this.testSuites.length}`, 'blue');
    this.log(`Total Tests: ${this.results.totalTests}`, 'blue');
    this.log(`Passed: ${this.results.passedTests}`, 'green');
    this.log(`Failed: ${this.results.failedTests}`, this.results.failedTests > 0 ? 'red' : 'blue');
    this.log(`Skipped: ${this.results.skippedTests}`, 'yellow');
    this.log(`Pass Rate: ${this.results.summary.passRate}%`, 'cyan');
    this.log(`Duration: ${(this.results.performance.totalDuration / 1000).toFixed(2)}s`, 'magenta');

    if (this.results.summary.criticalIssues > 0) {
      this.log(`\n🚨 CRITICAL ISSUES FOUND: ${this.results.summary.criticalIssues}`, 'red');
    }

    if (this.results.summary.recommendations.length > 0) {
      this.log('\n📋 RECOMMENDATIONS:', 'yellow');
      this.results.summary.recommendations.forEach((rec, i) => {
        this.log(`${i + 1}. [${rec.priority}] ${rec.issue}`, rec.priority === 'HIGH' ? 'red' : 'yellow');
        this.log(`   Action: ${rec.action}`, 'blue');
      });
    }

    if (status === 'PASSED') {
      this.log('\n🎉 All tests passed! URL processing is working correctly.', 'green');
    } else {
      this.log('\n⚠️  Issues detected. Review the detailed report for fixes.', 'red');
    }
  }
}

// Main execution
async function main() {
  const runner = new TestRunner();

  try {
    await runner.setupTestEnvironment();
    await runner.runAllTests();
    const report = runner.generateDetailedReport();
    await runner.displaySummary();

    // Exit with appropriate code
    process.exit(runner.results.summary.overallStatus === 'PASSED' ? 0 : 1);

  } catch (error) {
    runner.log(`\n💥 Test execution failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default TestRunner;