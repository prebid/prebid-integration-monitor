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
    // Ensure a 'production' like environment for the CLI execution
    const env = { ...process.env, NODE_ENV: 'production' };
    // Remove ts-node/esm loader if present, to avoid it interfering with oclif's compiled command loading
    if (env.NODE_OPTIONS) {
      env.NODE_OPTIONS = env.NODE_OPTIONS.replace(
        /--loader\s+ts-node\/esm/g,
        ''
      ).trim();
      if (!env.NODE_OPTIONS) delete env.NODE_OPTIONS; // Remove if empty
    }

    cp.exec(command, { cwd, env }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error ? error.code : 0,
      });
    });
  });
}

/**
 * Helper to create a dummy input file.
 * @param {string} filePath - The path where the file should be created.
 * @param {string[]} urls - An array of URLs to write to the file, each on a new line.
 * @returns {void}
 */
function createInputFile(filePath: string, urls: string[]): void {
  fs.writeFileSync(filePath, urls.join('\n'));
}

/**
 * Helper to remove files/directories.
 * @param {string} itemPath - The path to the file or directory to remove.
 * @returns {void}
 */
function cleanup(itemPath: string): void {
  if (!fs.existsSync(itemPath)) {
    return;
  }
  if (fs.lstatSync(itemPath).isDirectory()) {
    fs.rmSync(itemPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(itemPath);
  }
}

/**
 * Cleans up a list of specified file or directory paths.
 * @param {string[]} paths - An array of paths to clean up.
 * @returns {void}
 */
function cleanupTestArtifacts(paths: string[]): void {
  paths.forEach((path) => cleanup(path));
}

// Determine the project root directory, assuming tests are in <root>/tests/
const projectRoot = path.resolve(__dirname, '..');
const scanCliCommand = `node ${path.join(projectRoot, 'bin', 'run')} scan`; // Path to SCAN CLI

/**
 * Test suite for the main 'scan' command functionality.
 * Covers default behaviors, input/output options, various command-line flags,
 * and help command verification.
 */
describe('CLI Tests for Scan Command', () => {
  const generalScanTestTimeout = 60000; // Standard timeout for tests involving Puppeteer
  const helpTestTimeout = 10000; // Shorter timeout for non-Puppeteer tests like --help

  const defaultInputFilePath = path.join(projectRoot, 'src', 'input.txt');
  const projectRootInputFilePath = path.join(projectRoot, 'input.txt');
  const testInputFilePath = path.join(projectRoot, 'test_input_cli.txt');
  const testOutputDirPath = path.join(projectRoot, 'test_output_cli');
  const customInputPath = path.join(
    projectRoot,
    'tests',
    'custom_scan_input.txt'
  );

  const testInputActualTxt = path.join(projectRoot, 'test_input_actual.txt');
  const testInputActualCsv = path.join(projectRoot, 'test_input_actual.csv');
  const testInputActualJson = path.join(projectRoot, 'test_input_actual.json');

  const rangeChunkInputPathConst = path.join(
    projectRoot,
    'test_range_chunk_input.txt'
  );
  const testFailedUrlsInputPathConst = path.join(
    projectRoot,
    'test_failed_urls_input.txt'
  );

  const allTestsCleanupPaths = [
    testFailedUrlsInputPathConst,
    defaultInputFilePath,
    testInputFilePath,
    testOutputDirPath,
    customInputPath,
    testInputActualTxt,
    testInputActualCsv,
    testInputActualJson,
    rangeChunkInputPathConst,
  ];

  const eachTestCleanupPaths = [
    defaultInputFilePath,
    testInputFilePath,
    testOutputDirPath,
    customInputPath,
    testInputActualTxt,
    testInputActualCsv,
    testInputActualJson,
  ];

  beforeAll(() => {
    cleanupTestArtifacts(allTestsCleanupPaths);
  });

  afterAll(() => {
    cleanupTestArtifacts(allTestsCleanupPaths);
  });

  beforeEach(() => {
    cleanupTestArtifacts(eachTestCleanupPaths);
  });

  afterEach(() => {});

  it(
    'Scan Command runs with default options (expecting src/input.txt to be used and required)',
    async () => {
      // Since inputFile is required, running without an argument should fail.
      // The default 'src/input.txt' is no longer automatically used if no arg is given.
      const result = await executeCommand(`${scanCliCommand}`, projectRoot);
      expect(result.code).not.toBe(0); // Expect a non-zero exit code
      // Error message might vary based on oclif version, but should indicate missing argument.
      expect(result.stderr).toMatch(/Missing 1 required arg/);
      expect(result.stderr).toMatch(/inputFile/);
    },
    generalScanTestTimeout
  );

  it(
    'Scan Command runs with an explicit input file',
    async () => {
      createInputFile(testInputFilePath, ['https://example.com']);
      const result = await executeCommand(
        `${scanCliCommand} ${testInputFilePath}`,
        projectRoot
      );
      expect(result.code).toBe(
        0,
        `Command failed with code ${result.code}. Stderr: ${result.stderr}`
      );
      expect(result.stdout).toContain(`Using input file: ${testInputFilePath}`);
    },
    generalScanTestTimeout
  );

  it(
    'Scan Command runs with puppeteerType=vanilla',
    async () => {
      createInputFile(testInputFilePath, ['https://example.com']);
      const result = await executeCommand(
        `${scanCliCommand} ${testInputFilePath} --puppeteerType=vanilla`,
        projectRoot
      );

      expect(result.code).toBe(
        0,
        `Command failed with code ${result.code}. Stderr: ${result.stderr}`
      );
      expect(result.stdout).toContain('"puppeteerType": "vanilla"');
      expect(result.stdout).toContain(`Using input file: ${testInputFilePath}`);
    },
    generalScanTestTimeout
  );

  it(
    'Scan Command: Input and output files (custom input, custom output)',
    async () => {
      const testUrls = ['https://example.com', 'https://www.google.com'];
      createInputFile(testInputFilePath, testUrls);

      const result = await executeCommand(
        `${scanCliCommand} ${testInputFilePath} --outputDir=${testOutputDirPath}`,
        projectRoot
      );
      expect(result.code).toBe(
        0,
        `Command failed with code ${result.code}. Stderr: ${result.stderr} Stdout: ${result.stdout}`
      );
      expect(
        fs.existsSync(testOutputDirPath),
        'Output directory was not created'
      ).toBe(true);
      // Further checks for output file creation can be added here if necessary
    },
    generalScanTestTimeout
  );

  it(
    'Scan Command Help',
    async () => {
      const result = await executeCommand(
        `${scanCliCommand} --help`,
        projectRoot
      );
      expect(result.code).toBe(
        0,
        `Help command failed with code ${result.code}. Stderr: ${result.stderr}`
      );
      expect(result.stdout).toContain(
        'Scans websites for Prebid.js integrations'
      );
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('$ app scan INPUTFILE'); // INPUTFILE is now required
      expect(result.stdout).toContain('--puppeteerType');
      expect(result.stdout).toContain('--concurrency');
      expect(result.stdout).toContain('--headless');
      expect(result.stdout).toContain('--outputDir');
      expect(result.stdout).toContain('--logDir');
      expect(result.stdout).not.toContain('--githubRepo'); // Ensure githubRepo is NOT listed for scan
      expect(result.stdout).toContain('--numUrls');
    },
    helpTestTimeout
  );
});

// --- Tests for `load` command ---
const loadCliCommand = `node ${path.join(projectRoot, 'bin', 'run')} load`;
const fixturesDir = path.join(__dirname, 'fixtures');
const testTxtFileFromFixtures = path.join(fixturesDir, 'test-urls.txt');
const mockFetch = global.fetch; // Store original fetch

describe('CLI Tests for Load Command', () => {
  const testTimeout = 10000;

  beforeAll(() => {
    // Ensure fixtures directory and files exist for load command tests
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    // test-urls.txt is created by tests/load.test.ts's beforeEach,
    // but ensure it exists for standalone runs of cli.test.ts
    if (!fs.existsSync(testTxtFileFromFixtures)) {
      fs.writeFileSync(
        testTxtFileFromFixtures,
        'http://example.com/page1\nhttps://example.org/page2\nexample.net/page3'
      );
    }
  });

  beforeEach(() => {
    // Reset fetch mock before each test if it was modified
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore original fetch if it was mocked by a test
    global.fetch = mockFetch;
  });

  it(
    'load command loads URLs from a TXT file',
    async () => {
      const result = await executeCommand(
        `${loadCliCommand} ${testTxtFileFromFixtures}`,
        projectRoot
      );
      expect(result.code).toBe(
        0,
        `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
      );
      expect(result.stdout).toContain('Loaded 3 URLs:');
      expect(result.stdout).toContain('http://example.com/page1');
    },
    testTimeout
  );

  const mockGithubFileUrl =
    'https://github.com/testowner/testrepo/blob/main/load-urls.txt';
  const mockRawGithubUrl =
    'https://raw.githubusercontent.com/testowner/testrepo/main/load-urls.txt';
  const mockGithubContent =
    'http://git.load.com/pageA\nhttps://git.load.org/pageB';

  it(
    'load command loads URLs from a GitHub file URL (mocked)',
    async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(
        async (url: RequestInfo | URL): Promise<Response> => {
          if (url.toString() === mockRawGithubUrl) {
            return {
              ok: true,
              text: async () => mockGithubContent,
              status: 200,
            } as unknown as Response;
          }
          return {
            ok: false,
            status: 404,
            text: async () => 'Not Found',
          } as unknown as Response;
        }
      ) as any;

      const result = await executeCommand(
        `${loadCliCommand} --githubRepo ${mockGithubFileUrl}`,
        projectRoot
      );

      expect(result.code).toBe(
        0,
        `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
      );
      expect(result.stdout).toContain('Loaded 2 URLs:');
      expect(result.stdout).toContain('http://git.load.com/pageA');

      global.fetch = originalFetch; // Restore
    },
    testTimeout
  );

  it(
    'load command errors when no input file or GitHub repo is specified',
    async () => {
      const result = await executeCommand(`${loadCliCommand}`, projectRoot);
      expect(result.code).not.toBe(0); // Expect non-zero exit code for error
      expect(result.stderr).toContain('No input source specified');
    },
    testTimeout
  );
});

// --- Tests for Range and Chunk Functionality (for scan command) ---
describe('CLI Tests for Scan Command Range and Chunk Functionality', () => {
  const testTimeout = 20000;
  const testInputForRangeChunkPath = path.join(
    projectRoot,
    'test_range_chunk_input.txt'
  );
  const testCsvForRangeChunkPath = path.join(
    projectRoot,
    'test_range_chunk.csv'
  );
  const rangeAndChunkTestPaths = [
    testInputForRangeChunkPath,
    testCsvForRangeChunkPath,
  ];

  beforeEach(() => {
    cleanupTestArtifacts(rangeAndChunkTestPaths);
  });

  afterEach(() => {
    cleanupTestArtifacts(rangeAndChunkTestPaths);
  });

  it(
    'scan command should process a valid specific range (e.g., 2-4) from an input file',
    async () => {
      const urls = [
        'https://url1.com',
        'https://url2.com',
        'https://url3.com',
        'https://url4.com',
        'https://url5.com',
      ];
      createInputFile(testInputForRangeChunkPath, urls);
      const command = `${scanCliCommand} ${testInputForRangeChunkPath} --range 2-4`;
      const result = await executeCommand(command, projectRoot);

      expect(result.code).toBe(
        0,
        `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
      );
      expect(result.stdout).toContain(`Initial total URLs found: 5`);
      expect(result.stdout).toContain(`Applying range: 2-4`);
      expect(result.stdout).toContain(
        `Applied range: Processing URLs from 2 to 4 (0-based index 1 to 3). Total URLs after range: 3 (out of 5)`
      );
      expect(result.stdout).toContain(
        `Total URLs to process after range check: 3`
      );
    },
    testTimeout
  );

  it(
    'scan command should process in chunks if chunkSize is smaller than total URLs',
    async () => {
      const urls = Array.from(
        { length: 10 },
        (_, i) => `https://url${i + 1}.com`
      );
      createInputFile(testInputForRangeChunkPath, urls);
      const command = `${scanCliCommand} ${testInputForRangeChunkPath} --chunkSize 3`;
      const result = await executeCommand(command, projectRoot);

      expect(result.code).toBe(
        0,
        `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
      );
      expect(result.stdout).toContain(`Initial total URLs found: 10`);
      expect(result.stdout).toContain(
        `Total URLs to process after range check: 10`
      );
      expect(result.stdout).toMatch(/"chunkSize": 3/);
      expect(result.stdout).toContain(
        `Chunked processing enabled. Chunk size: 3`
      );
      expect(result.stdout).toContain(`Total chunks to process: 4`);
      expect(result.stdout).toContain(`Processing chunk 1 of 4: URLs 1-3`);
      expect(result.stdout).toContain(`Processing chunk 4 of 4: URLs 10-10`);
    },
    testTimeout * 6
  );
});

// --- Tests for Local File Inputs (for scan command) ---
describe('CLI Tests for Scan Command Local File Inputs', () => {
  const testTimeout = 20000;
  const localTestOutputDirPath = path.join(
    projectRoot,
    'test_output_local_files_scan'
  );

  const testInputActualTxtScan = path.join(
    projectRoot,
    'test_input_actual_scan.txt'
  );
  const testInputActualCsvScan = path.join(
    projectRoot,
    'test_input_actual_scan.csv'
  );
  const testInputActualJsonScan = path.join(
    projectRoot,
    'test_input_actual_scan.json'
  );
  const testFailedUrlsInputPathScan = path.join(
    projectRoot,
    'test_failed_urls_input_scan.txt'
  );

  const localFileInputTestPaths = [
    testFailedUrlsInputPathScan,
    testInputActualTxtScan,
    testInputActualCsvScan,
    testInputActualJsonScan,
    localTestOutputDirPath,
  ];

  beforeEach(() => {
    cleanupTestArtifacts(localFileInputTestPaths);
  });

  afterEach(() => {
    cleanupTestArtifacts(localFileInputTestPaths);
  });

  describe('TXT File Input Tests for Scan', () => {
    it(
      'scan command should only remove successfully processed URLs from .txt file, leaving failed ones',
      async () => {
        const urlsToTest = [
          'https://example.com',
          'http://nonexistentdomain.faketld',
          'https://www.google.com',
          'http://anothernonexistent.faketld',
        ];
        createInputFile(testFailedUrlsInputPathScan, urlsToTest);
        const command = `${scanCliCommand} ${testFailedUrlsInputPathScan} --concurrency=1`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(
          0,
          `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
        );
        const remainingContent = fs
          .readFileSync(testFailedUrlsInputPathScan, 'utf-8')
          .trim();
        const remainingUrls = remainingContent
          .split('\n')
          .filter((line) => line.trim() !== '');
        expect(remainingUrls).toContain('http://nonexistentdomain.faketld');
        expect(remainingUrls).toContain('http://anothernonexistent.faketld');
        expect(remainingUrls.length).toBe(2);
        expect(result.stdout).toContain(
          `${testFailedUrlsInputPathScan} updated.`
        );
      },
      generalScanTestTimeout * 2
    );

    it(
      'scan command should load URLs from a local .txt file specified by inputFile argument',
      async () => {
        const urls = [
          'http://txt-example1.com',
          'https://txt-example2.com/path',
        ];
        createInputFile(testInputActualTxtScan, urls);
        const command = `${scanCliCommand} ${testInputActualTxtScan}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(
          0,
          `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
        );
        expect(result.stdout).toContain(
          `Using input file: ${testInputActualTxtScan}`
        );
        expect(result.stdout).toContain(
          `Processing local file: ${testInputActualTxtScan} (detected type: txt)`
        );
        expect(result.stdout).toContain(
          `Successfully loaded ${urls.length} URLs from local TXT file: ${testInputActualTxtScan}`
        );
        const inputFileContent = fs.readFileSync(
          testInputActualTxtScan,
          'utf-8'
        );
        expect(inputFileContent.trim()).toBe(
          '',
          'TXT input file should be empty after processing'
        );
      },
      testTimeout
    );
  });

  describe('CSV File Input Tests for Scan', () => {
    it(
      'scan command should load URLs from local .csv file and not empty it',
      async () => {
        const csvContent = [
          'url_header',
          'http://csv-example1.com',
          'https://csv-example2.com/path',
          'not_a_url',
        ].join('\n');
        fs.writeFileSync(testInputActualCsvScan, csvContent);
        const expectedValidUrls = 2;
        const command = `${scanCliCommand} ${testInputActualCsvScan}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(
          0,
          `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
        );
        expect(result.stdout).toContain(
          `Processing local file: ${testInputActualCsvScan} (detected type: csv)`
        );
        expect(result.stdout).toContain(
          `Successfully loaded ${expectedValidUrls} URLs from local CSV file: ${testInputActualCsvScan}`
        );
        expect(result.stdout).toContain(
          `Skipping modification of original CSV input file: ${testInputActualCsvScan}`
        );
        const inputFileContent = fs.readFileSync(
          testInputActualCsvScan,
          'utf-8'
        );
        expect(inputFileContent.trim()).toBe(
          csvContent.trim(),
          'CSV input file should NOT be empty'
        );
      },
      testTimeout
    );
  });

  describe('JSON File Input Tests for Scan', () => {
    it(
      'scan command should load URLs from local .json (array) and not empty it',
      async () => {
        const urls = ['http://json-array1.com', 'https://json-array2.com/path'];
        fs.writeFileSync(testInputActualJsonScan, JSON.stringify(urls));
        const command = `${scanCliCommand} ${testInputActualJsonScan}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(
          0,
          `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
        );
        expect(result.stdout).toContain(
          `Processing local file: ${testInputActualJsonScan} (detected type: json)`
        );
        expect(result.stdout).toContain(
          `Successfully loaded ${urls.length} URLs from local JSON file: ${testInputActualJsonScan}`
        );
        expect(result.stdout).toContain(
          `Skipping modification of original JSON input file: ${testInputActualJsonScan}`
        );
      },
      testTimeout
    );

    it(
      'scan command should load URLs from local .json (object) and not empty it',
      async () => {
        const jsonObj = {
          site1: 'http://json-obj1.com',
          nested: { link: 'https://json-obj3.com/nested/path' },
        };
        fs.writeFileSync(
          testInputActualJsonScan,
          JSON.stringify(jsonObj, null, 2)
        );
        const expectedValidUrls = 2;
        const command = `${scanCliCommand} ${testInputActualJsonScan}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(
          0,
          `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`
        );
        expect(result.stdout).toContain(
          `Extracted ${expectedValidUrls} URLs from parsed JSON structure in ${testInputActualJsonScan}`
        );
        expect(result.stdout).toContain(
          `Successfully loaded ${expectedValidUrls} URLs from local JSON file: ${testInputActualJsonScan}`
        );
        expect(result.stdout).toContain(
          `Skipping modification of original JSON input file: ${testInputActualJsonScan}`
        );
      },
      testTimeout
    );
  });
});
// End of tests
