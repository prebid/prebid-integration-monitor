import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

// Helper function to execute CLI command
interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Executes a CLI command.
 * @param {string} command - The command to execute.
 * @param {string} [cwd='.'] - The current working directory for the command.
 * @returns {Promise<ExecResult>} A promise that resolves with an object containing stdout, stderr, and the exit code.
 */
function executeCommand(
  command: string,
  cwd: string = '.'
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, NODE_ENV: 'production' };
    if (env.NODE_OPTIONS) {
      env.NODE_OPTIONS = env.NODE_OPTIONS.replace(
        /--loader\s+ts-node\/esm/g,
        ''
      ).trim();
      if (!env.NODE_OPTIONS) delete env.NODE_OPTIONS;
    }

    cp.exec(command, { cwd, env, timeout: 30000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error ? error.code : 0,
      });
    });
  });
}

describe('Scan CLI with URL Deduplication', () => {
  const testDir = path.join(process.cwd(), 'test-cli-temp');
  const testUrlsFile = path.join(testDir, 'test-urls.txt');
  const testDbPath = path.join(testDir, 'data', 'url-tracker.db');
  
  beforeAll(async () => {
    // Ensure the CLI is built
    await executeCommand('npm run build');
    
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Create test URLs file
    const testUrls = [
      'example.com',
      'test.com',
      'google.com'
    ].join('\\n');
    
    fs.writeFileSync(testUrlsFile, testUrls);
    
    // Clean up any existing database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('--skipProcessed flag', () => {
    it('should accept --skipProcessed flag', async () => {
      const result = await executeCommand(
        'node ./bin/run.js scan --help',
        process.cwd()
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('--skipProcessed');
      expect(result.stdout).toContain('Skip URLs that have been previously processed');
    });

    it('should work with --skipProcessed flag and dry run', async () => {
      // Create a minimal test that doesn't actually process URLs
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      // Should exit gracefully with range that selects no URLs
      expect(result.stdout).toContain('No URLs to process');
      expect(result.code).toBe(0);
    });

    it('should show URL filtering logs when enabled', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.stdout).toContain('URL tracking database');
      expect(result.code).toBe(0);
    });
  });

  describe('--resetTracking flag', () => {
    it('should accept --resetTracking flag', async () => {
      const result = await executeCommand(
        'node ./bin/run.js scan --help',
        process.cwd()
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('--resetTracking');
      expect(result.stdout).toContain('Reset the URL tracking database');
    });

    it('should work with --resetTracking flag', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --resetTracking --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.stdout).toContain('Resetting URL tracking database');
      expect(result.code).toBe(0);
    });
  });

  describe('Help and examples', () => {
    it('should show new examples with skipProcessed flag', async () => {
      const result = await executeCommand(
        'node ./bin/run.js scan --help',
        process.cwd()
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('--skipProcessed');
      expect(result.stdout).toContain('top-1000000-domains');
    });

    it('should show flag descriptions in help', async () => {
      const result = await executeCommand(
        'node ./bin/run.js scan --help',
        process.cwd()
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Skip URLs that have been previously processed successfully');
      expect(result.stdout).toContain('Reset the URL tracking database before starting');
    });
  });

  describe('Flag validation', () => {
    it('should allow skipProcessed without resetTracking', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.code).toBe(0);
    });

    it('should allow resetTracking without skipProcessed', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --resetTracking --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.code).toBe(0);
    });

    it('should allow both flags together', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --resetTracking --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.code).toBe(0);
    });
  });

  describe('Database creation', () => {
    it('should create database when skipProcessed is used', async () => {
      const dataDir = path.join(testDir, 'data');
      
      // Ensure data directory doesn't exist initially
      if (fs.existsSync(dataDir)) {
        fs.rmSync(dataDir, { recursive: true });
      }

      await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      // Check that database directory was created
      expect(fs.existsSync(dataDir)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid input file gracefully with skipProcessed', async () => {
      const result = await executeCommand(
        'node ./bin/run.js scan nonexistent.txt --skipProcessed --puppeteerType=vanilla',
        process.cwd()
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Failed to read file');
    });

    it('should handle database errors gracefully', async () => {
      // Create an invalid database file
      const dataDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const dbPath = path.join(dataDir, 'url-tracker.db');
      fs.writeFileSync(dbPath, 'invalid database content');

      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      // Should still complete (may recreate database)
      expect(result.code).toBe(0);
      
      // Clean up
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    });
  });

  describe('Integration with existing flags', () => {
    it('should work with --range flag', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --range=1-2 --puppeteerType=vanilla`,
        process.cwd()
      );

      expect(result.stdout).toContain('Applied range');
      expect(result.code).toBe(0);
    });

    it('should work with --chunkSize flag', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --chunkSize=1 --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.code).toBe(0);
    });

    it('should work with GitHub repository source', async () => {
      const result = await executeCommand(
        'node ./bin/run.js scan --githubRepo https://github.com/test/repo --skipProcessed --numUrls=0',
        process.cwd()
      );

      // Should attempt to fetch from GitHub (will fail but that's expected in test)
      expect(result.stdout).toContain('GitHub');
      expect(result.code).toBe(0);
    });

    it('should work with --puppeteerType=cluster', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=cluster --range=1-0`,
        process.cwd()
      );

      expect(result.code).toBe(0);
    });
  });

  describe('Output verification', () => {
    it('should show correct options in verbose output', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --resetTracking --verbose --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.stdout).toContain('"skipProcessed": true');
      expect(result.stdout).toContain('"resetTracking": true');
      expect(result.code).toBe(0);
    });

    it('should show database statistics', async () => {
      const result = await executeCommand(
        `node ./bin/run.js scan ${testUrlsFile} --skipProcessed --puppeteerType=vanilla --range=1-0`,
        process.cwd()
      );

      expect(result.stdout).toContain('URL tracker statistics');
      expect(result.code).toBe(0);
    });
  });
});