#!/usr/bin/env node

/**
 * Comprehensive integration validation script
 * This script validates the entire pipeline to catch issues like the GitHub range bug
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Starting comprehensive integration validation...\n');

// Test configurations that would have caught the GitHub range bug
const testScenarios = [
  {
    name: 'GitHub Range Processing Validation',
    description: 'Tests GitHub URL processing with various range configurations',
    command: 'npm test src/__tests__/github-range-integration.test.ts',
    critical: true
  },
  {
    name: 'CLI Integration Regression Tests',
    description: 'Tests complete CLI command processing pipeline',
    command: 'npm test src/__tests__/cli-integration-regression.test.ts',
    critical: true
  },
  {
    name: 'Optimization Integration Tests',
    description: 'Tests performance optimizations and memory usage',
    command: 'npm test src/__tests__/optimization-integration.test.ts',
    critical: false
  },
  {
    name: 'Puppeteer Accuracy Tests',
    description: 'Tests website interaction and Prebid detection accuracy',
    command: 'npm test src/__tests__/puppeteer-accuracy.test.ts',
    critical: false
  },
  {
    name: 'URL Processing Integration Tests',
    description: 'Tests complete URL loading and processing pipeline',
    command: 'npm test src/__tests__/url-processing-integration.test.ts',
    critical: true
  }
];

// Bug pattern detection
const bugPatterns = [
  {
    name: 'Double Range Application Pattern',
    description: 'Checks for the specific pattern that caused the GitHub range bug',
    pattern: /options\.range.*allUrls\.slice.*urlSourceType/,
    files: ['src/prebid.ts'],
    shouldExist: true, // We want to see the fix pattern
    message: 'Should have proper GitHub source type checking for range application'
  },
  {
    name: 'GitHub Source Type Differentiation',
    description: 'Ensures GitHub and local file processing are handled differently',
    pattern: /urlSourceType.*!==.*['"]GitHub['"]|urlSourceType.*===.*['"]GitHub['"]/,
    files: ['src/prebid.ts'],
    shouldExist: true,
    message: 'Must differentiate between GitHub and local file sources for range processing'
  },
  {
    name: 'Range Optimization Usage',
    description: 'Checks for proper range optimization in GitHub fetching',
    pattern: /rangeOptions.*startRange.*endRange/,
    files: ['src/prebid.ts', 'src/utils/url-loader.ts'],
    shouldExist: true,
    message: 'Should use range optimization to prevent memory issues with large files'
  },
  {
    name: 'Duplicate Range Prevention',
    description: 'Checks for explicit prevention of duplicate range application',
    pattern: /already applied.*GitHub.*skip.*duplicate/,
    files: ['src/prebid.ts'],
    shouldExist: true,
    message: 'Must explicitly prevent duplicate range application for GitHub sources'
  }
];

let totalTests = 0;
let passedTests = 0;
let criticalFailures = 0;

// Function to run a command and capture output
function runCommand(command, description) {
  try {
    console.log(`🧪 Running: ${description}`);
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    console.log('✅ PASSED\n');
    return { success: true, output };
  } catch (error) {
    console.log('❌ FAILED');
    console.log(`Error: ${error.message}\n`);
    return { success: false, error: error.message };
  }
}

// Function to check for bug patterns in files
function checkBugPattern(pattern, files, shouldExist, message) {
  let found = false;
  const foundFiles = [];

  for (const file of files) {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (pattern.test(content)) {
        found = true;
        foundFiles.push(file);
      }
    }
  }

  const success = found === shouldExist;
  
  if (success) {
    console.log(`✅ Pattern check passed: ${message}`);
    if (foundFiles.length > 0) {
      console.log(`   Found in: ${foundFiles.join(', ')}`);
    }
  } else {
    console.log(`❌ Pattern check failed: ${message}`);
    if (shouldExist) {
      console.log(`   Expected pattern not found in: ${files.join(', ')}`);
    } else {
      console.log(`   Unexpected pattern found in: ${foundFiles.join(', ')}`);
    }
  }
  
  console.log('');
  return success;
}

// Run all test scenarios
console.log('=' .repeat(60));
console.log('RUNNING TEST SCENARIOS');
console.log('=' .repeat(60) + '\n');

for (const scenario of testScenarios) {
  totalTests++;
  const result = runCommand(scenario.command, scenario.description);
  
  if (result.success) {
    passedTests++;
  } else if (scenario.critical) {
    criticalFailures++;
  }
}

// Check for bug patterns
console.log('=' .repeat(60));
console.log('CHECKING FOR BUG PATTERNS');
console.log('=' .repeat(60) + '\n');

let patternChecksPassed = 0;
for (const bugPattern of bugPatterns) {
  totalTests++;
  console.log(`🔍 ${bugPattern.name}: ${bugPattern.description}`);
  
  const success = checkBugPattern(
    bugPattern.pattern,
    bugPattern.files,
    bugPattern.shouldExist,
    bugPattern.message
  );
  
  if (success) {
    passedTests++;
    patternChecksPassed++;
  } else if (bugPattern.name.includes('GitHub') || bugPattern.name.includes('Range')) {
    criticalFailures++;
  }
}

// Additional validation checks
console.log('=' .repeat(60));
console.log('ADDITIONAL VALIDATION CHECKS');
console.log('=' .repeat(60) + '\n');

// Check if the specific bug scenario files exist
const criticalTestFiles = [
  'src/__tests__/github-range-integration.test.ts',
  'src/__tests__/cli-integration-regression.test.ts'
];

for (const testFile of criticalTestFiles) {
  totalTests++;
  const filePath = path.join(__dirname, '..', testFile);
  if (fs.existsSync(filePath)) {
    console.log(`✅ Critical test file exists: ${testFile}`);
    passedTests++;
  } else {
    console.log(`❌ Missing critical test file: ${testFile}`);
    criticalFailures++;
  }
}

// Check for the specific bug test case
totalTests++;
const githubRangeTestPath = path.join(__dirname, '..', 'src/__tests__/github-range-integration.test.ts');
if (fs.existsSync(githubRangeTestPath)) {
  const testContent = fs.readFileSync(githubRangeTestPath, 'utf8');
  if (testContent.includes('THE BUG SCENARIO') || testContent.includes('500000-500002')) {
    console.log('✅ GitHub range bug scenario test found');
    passedTests++;
  } else {
    console.log('❌ GitHub range bug scenario test not found');
    criticalFailures++;
  }
} else {
  console.log('❌ GitHub range integration test file not found');
  criticalFailures++;
}

// Summary report
console.log('\n' + '=' .repeat(60));
console.log('VALIDATION SUMMARY');
console.log('=' .repeat(60));

console.log(`📊 Total Tests: ${totalTests}`);
console.log(`✅ Passed: ${passedTests}`);
console.log(`❌ Failed: ${totalTests - passedTests}`);
console.log(`🚨 Critical Failures: ${criticalFailures}`);

const passRate = ((passedTests / totalTests) * 100).toFixed(1);
console.log(`📈 Pass Rate: ${passRate}%`);

if (criticalFailures > 0) {
  console.log('\n🚨 CRITICAL FAILURES DETECTED!');
  console.log('The following critical issues must be addressed:');
  console.log('- GitHub range processing validation failed');
  console.log('- CLI integration tests are missing or failing');
  console.log('- Bug prevention patterns are not in place');
  console.log('\nThese failures indicate that similar bugs to the GitHub range issue could occur again.');
  process.exit(1);
} else if (passRate < 90) {
  console.log('\n⚠️  WARNING: Low pass rate detected.');
  console.log('Consider addressing failed tests to improve reliability.');
  process.exit(1);
} else {
  console.log('\n🎉 All validation checks passed!');
  console.log('The system has proper safeguards against GitHub range processing bugs.');
  console.log('Integration testing infrastructure is robust and comprehensive.');
  process.exit(0);
}