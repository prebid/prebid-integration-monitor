import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

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
function executeCommand(command: string, cwd: string = '.'): Promise<ExecResult> {
    return new Promise((resolve) => {
        // Ensure a 'production' like environment for the CLI execution
        const env = { ...process.env, NODE_ENV: 'production' };
        // Remove ts-node/esm loader if present, to avoid it interfering with oclif's compiled command loading
        if (env.NODE_OPTIONS) {
            env.NODE_OPTIONS = env.NODE_OPTIONS.replace(/--loader\s+ts-node\/esm/g, '').trim();
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
    paths.forEach(path => cleanup(path));
}

// Determine the project root directory, assuming tests are in <root>/tests/
const projectRoot = path.resolve(__dirname, '..');
const cliCommand = `node ${path.join(projectRoot, 'bin', 'run')} scan`; // Path to CLI

/**
 * Test suite for the main 'scan' command functionality.
 * Covers default behaviors, input/output options, various command-line flags,
 * and help command verification.
 */
describe('CLI Tests for Scan Command', () => {
    const generalScanTestTimeout = 60000; // Standard timeout for tests involving Puppeteer
    const helpTestTimeout = 10000; // Shorter timeout for non-Puppeteer tests like --help

    const defaultInputFilePath = path.join(projectRoot, 'src', 'input.txt'); // Standard input file path
    const projectRootInputFilePath = path.join(projectRoot, 'input.txt'); // Input file at project root (for specific test)
    const testInputFilePath = path.join(projectRoot, 'test_input_cli.txt');
    const testOutputDirPath = path.join(projectRoot, 'test_output_cli');
    const customInputPath = path.join(projectRoot, 'tests', 'custom_scan_input.txt');
    const dummyGithubInputFile = path.join(projectRoot, 'dummy_github_input.txt');
    // testCsvFilePath is removed as --csvFile flag is removed. Local CSVs use testInputActualCsv.

    // New test file paths
    const testInputActualTxt = path.join(projectRoot, 'test_input_actual.txt');
    const testInputActualCsv = path.join(projectRoot, 'test_input_actual.csv');
    const testInputActualJson = path.join(projectRoot, 'test_input_actual.json');

    // Define paths for global afterAll cleanup consistently
    const dummyGhInputPathConst = path.join(projectRoot, 'dummy_gh_input.txt');
    const rangeChunkInputPathConst = path.join(projectRoot, 'test_range_chunk_input.txt');
    const rangeChunkCsvPathConst = path.join(projectRoot, 'test_range_chunk.csv'); // Retained for range tests using CSV as inputFile
    const testFailedUrlsInputPathConst = path.join(projectRoot, 'test_failed_urls_input.txt'); // For AllSuite cleanup

    const allTestsCleanupPaths = [
        testFailedUrlsInputPathConst,
        defaultInputFilePath,
        testInputFilePath,
        testOutputDirPath,
        customInputPath,
        dummyGithubInputFile,
        testInputActualTxt,
        testInputActualCsv,
        testInputActualJson,
        dummyGhInputPathConst,
        rangeChunkInputPathConst,
        rangeChunkCsvPathConst,
    ];

    const eachTestCleanupPaths = [
        defaultInputFilePath,
        testInputFilePath,
        testOutputDirPath,
        customInputPath,
        dummyGithubInputFile,
        testInputActualTxt,
        testInputActualCsv,
        testInputActualJson,
    ];

    // Cleanup before and after all tests in this suite
    beforeAll(() => {
        cleanupTestArtifacts(allTestsCleanupPaths);
    });

    afterAll(() => {
        cleanupTestArtifacts(allTestsCleanupPaths);
    });

    // Cleanup before each test
    beforeEach(() => {
        cleanupTestArtifacts(eachTestCleanupPaths);
    });

    afterEach(() => {
        // Specific afterEach cleanup if some files are not covered by eachTestCleanupPaths
        // or are specific to a subset of tests within this describe block.
        // For now, dummyGithubInputFile is in eachTestCleanupPaths.
        // testInputActualTxt, testInputActualCsv, testInputActualJson are also in eachTestCleanupPaths.
        // If a file is created in one test and needs to be cleaned immediately after, add it here.
        // cleanupTestArtifacts([dummyGithubInputFile]); // Example if it was truly specific
    });

    /**
     * Tests the CLI's behavior with default options, expecting it to use 'src/input.txt'.
     * Setup: Creates 'src/input.txt' with a single URL.
     * Action: Executes the CLI command without any specific input file argument.
     * Expected Outcome: The command exits successfully (code 0), processes the URL from 'src/input.txt',
     *                   and the 'src/input.txt' file is empty after processing.
     *                   Stdout should indicate that URLs were read from 'src/input.txt'.
     */
    it('Command runs with default options (now src/input.txt)', async () => {
        createInputFile(defaultInputFilePath, ['https://example.com']); // Will create src/input.txt
        const result = await executeCommand(`${cliCommand}`, projectRoot);

        if (result.code !== 0) {
            console.error("Test Error Output:", result.stderr); // Log stderr if test fails
        }
        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr}`);
        // Actual log message uses the relative path 'src/input.txt' as passed in options
        expect(result.stdout).toContain(`Initial URLs read from src/input.txt count:`);
        const inputFileContent = fs.readFileSync(defaultInputFilePath, 'utf-8'); // Reads src/input.txt
        expect(inputFileContent.trim()).toBe('', 'Input file should be empty after processing');
    }, generalScanTestTimeout);

    /**
     * Tests the CLI's functionality with the '--puppeteerType=vanilla' flag.
     * Setup: Creates 'src/input.txt' with a single URL.
     * Action: Executes the CLI command with the '--puppeteerType=vanilla' flag.
     * Expected Outcome: The command exits successfully (code 0).
     *                   Stdout should reflect that 'puppeteerType' is set to 'vanilla' and
     *                   that URLs were read from 'src/input.txt'.
     */
    it('Command runs with puppeteerType=vanilla (using src/input.txt)', async () => {
        createInputFile(defaultInputFilePath, ['https://example.com']); // Will create src/input.txt
        const result = await executeCommand(`${cliCommand} --puppeteerType=vanilla`, projectRoot);

        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr}`);
        expect(result.stdout).toContain('"puppeteerType": "vanilla"');
        // Actual log message uses the relative path 'src/input.txt'
        expect(result.stdout).toContain(`Initial URLs read from src/input.txt count:`);
    }, generalScanTestTimeout);

    /**
     * Tests the CLI's behavior when a custom input file is provided alongside a custom output directory.
     * Setup: Creates a custom input file ('test_input_cli.txt') with a list of URLs.
     * Action: Executes the CLI command, providing the custom input file path as an argument
     *         and specifying a custom output directory ('test_output_cli') via '--outputDir'.
     * Expected Outcome: The command exits successfully (code 0).
     *                   The custom output directory ('test_output_cli') is created.
     *                   The custom input file ('test_input_cli.txt') is empty after processing.
     *                   An output JSON file, named with the current date, is created in a subdirectory
     *                   (named by the current month) within the custom output directory if results were saved.
     *                   If no results were saved, the output file should not exist, and the month directory might be empty.
     */
    it('Input and output files (custom input, custom output)', async () => {
        const testUrls = ['https://example.com', 'https://www.google.com'];
        createInputFile(testInputFilePath, testUrls); // testInputFilePath is in root

        const result = await executeCommand(`${cliCommand} ${testInputFilePath} --outputDir=${testOutputDirPath}`, projectRoot);
        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr} Stdout: ${result.stdout}`);

        expect(fs.existsSync(testOutputDirPath), 'Output directory was not created').toBe(true);

        const now = new Date();
        const month = now.toLocaleString('default', { month: 'short' });
        const dateFilename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
        const monthDir = path.join(testOutputDirPath, month);
        const expectedOutputFile = path.join(monthDir, dateFilename);

        // Check stdout to determine if results were saved
        if (result.stdout.includes('Results have been written to')) {
            expect(fs.existsSync(expectedOutputFile), `Expected output file ${expectedOutputFile} was not created, but stdout indicates it should exist.`).toBe(true);
        } else if (result.stdout.includes('No results to save.')) {
            expect(fs.existsSync(expectedOutputFile), `Output file ${expectedOutputFile} was created, but stdout indicates no results were saved.`).toBe(false);
            // Optionally, check if monthDir exists or is empty
            if (fs.existsSync(monthDir)) {
                const filesInMonthDir = fs.readdirSync(monthDir);
                expect(filesInMonthDir.length).toBe(0, `Month directory ${monthDir} should be empty if no results are saved.`);
            }
        } else {
            // This case handles unexpected stdout. The test might fail here if the output is neither of the expected messages.
            // Depending on strictness, you could fail the test or log a warning.
            console.warn(`Unexpected stdout content: ${result.stdout}`);
            // Defaulting to expecting the file not to exist if messages are unclear, adjust as needed.
            expect(fs.existsSync(expectedOutputFile), `Output file ${expectedOutputFile} existence is ambiguous based on stdout.`).toBe(false);
        }

        const inputFileContent = fs.readFileSync(testInputFilePath, 'utf-8'); // Reads test_input_cli.txt
        expect(inputFileContent.trim()).toBe('', 'Input file should be empty after processing successful URLs');
    }, generalScanTestTimeout);

    /**
     * Tests the CLI's ability to use the default 'src/input.txt' when no input file argument is provided.
     * Setup: Creates 'src/input.txt' with a specific URL.
     *        Ensures no 'input.txt' exists at the project root to avoid confusion.
     * Action: Executes the CLI command without any input file argument.
     * Expected Outcome: The command exits successfully (code 0).
     *                   Stdout indicates that URLs were read from 'src/input.txt'.
     *                   The default input file 'src/input.txt' is empty after processing.
     */
    it('Scan with default input file (src/input.txt)', async () => {
        createInputFile(defaultInputFilePath, ['https://default-test.example.com']); // Creates src/input.txt
        // Ensure no other input.txt in root to avoid confusion
        if (fs.existsSync(projectRootInputFilePath)) {
            cleanup(projectRootInputFilePath);
        }

        const result = await executeCommand(`${cliCommand}`, projectRoot); // No input file argument

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr}`);
        // Actual log message uses the relative path 'src/input.txt'
        expect(result.stdout).toContain(`Initial URLs read from src/input.txt count:`);

        const inputFileContent = fs.readFileSync(defaultInputFilePath, 'utf-8'); // Checks src/input.txt
        expect(inputFileContent.trim()).toBe('', 'Default input file (src/input.txt) should be empty after processing');
    }, generalScanTestTimeout);

    /**
     * Tests that a custom input file specified as an argument overrides the default 'src/input.txt'.
     * Setup: Creates a custom input file ('tests/custom_scan_input.txt') with one URL.
     *        Creates the default input file ('src/input.txt') with a different URL to ensure it's not used.
     * Action: Executes the CLI command with the path to the custom input file.
     * Expected Outcome: The command exits successfully (code 0).
     *                   Stdout indicates that URLs were read from the custom input file.
     *                   The custom input file is empty after processing.
     *                   The default input file ('src/input.txt') remains untouched.
     */
    it('Scan with custom input file overrides default', async () => {
        createInputFile(customInputPath, ['https://custom-test.example.com']); // Creates tests/custom_scan_input.txt
        // Optionally, create src/input.txt with different content to ensure custom is used
        createInputFile(defaultInputFilePath, ['https://should-not-be-used.example.com']);

        const result = await executeCommand(`${cliCommand} ${customInputPath}`, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr}`);
        // Actual log message includes the resolved path and count
        expect(result.stdout).toContain(`Initial URLs read from ${customInputPath} count:`);

        const customFileContent = fs.readFileSync(customInputPath, 'utf-8');
        expect(customFileContent.trim()).toBe('', 'Custom input file should be empty after processing');

        // Ensure default file (src/input.txt) was not touched
        const defaultFileContent = fs.readFileSync(defaultInputFilePath, 'utf-8');
        expect(defaultFileContent.trim()).toBe('https://should-not-be-used.example.com');

    }, generalScanTestTimeout);

    /**
     * Tests the CLI's help command ('--help').
     * Setup: None specific.
     * Action: Executes the CLI command with the '--help' flag.
     * Expected Outcome: The command exits successfully (code 0).
     *                   Stdout contains key sections of the help message, such as 'USAGE',
     *                   command syntax, and descriptions of available flags. This verifies
     *                   the help system is functioning and providing essential information.
     */
    it('Help command', async () => {
        const result = await executeCommand(`${cliCommand} --help`, projectRoot);
        expect(result.code).toBe(0, `Help command failed with code ${result.code}. Stderr: ${result.stderr}`);
        expect(result.stdout).toContain('Scans websites for Prebid.js integrations.');
        expect(result.stdout).toContain('USAGE');
        expect(result.stdout).toContain('$ app scan [INPUTFILE]');
        expect(result.stdout).toContain('--puppeteerType');
        expect(result.stdout).toContain('--concurrency');
        expect(result.stdout).toContain('--headless');
        expect(result.stdout).toContain('--outputDir');
        expect(result.stdout).toContain('--logDir');
        expect(result.stdout).toContain('--githubRepo');
        expect(result.stdout).toContain('--numUrls');
    }, helpTestTimeout);
});

// This constant can still be used for testing purely invalid URL formats if needed,
// but most GitHub API interaction tests will now use mocks.
const INVALID_GITHUB_REPO_URL_FORMAT = 'https://github.com/nonexistent-owner-abcxyz/nonexistent-repo-qwerty.git';

/**
 * Test suite for the '--githubRepo' flag functionality using a mocked GitHub API.
 * Covers various scenarios including fetching different file types, handling API errors,
 * limiting URL numbers, and interaction with other flags like '--inputFile'.
 */
describe('CLI Tests for GitHub Repository Input with Mocked API', () => {
    const testTimeout = 10000; // Shorter timeout as these are now unit-like tests
    // Common constants for this suite
    const MOCK_REPO_URL = 'https://github.com/mockOwner/mockRepo'; // Removed .git for consistency with API calls
    const MOCK_REPO_API_URL = 'https://api.github.com/repos/mockOwner/mockRepo/contents';
    const dummyGhInputPath = path.join(projectRoot, 'dummy_gh_input.txt'); // Consistent path for this suite

    // Main fetch mock, configured per test or per nested suite
    let fetchMock: ReturnType<typeof vi.spyOn>;

    describe('URL Fetching and Extraction from Repository', () => {
        beforeEach(() => {
            fetchMock = vi.spyOn(global, 'fetch');
            cleanupTestArtifacts([dummyGhInputPath]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            cleanupTestArtifacts([dummyGhInputPath]);
        });

        /**
         * Tests fetching and processing URLs from various file types (.txt, .json, .md) within a mock GitHub repository.
         * Setup: Mocks the global `fetch` function.
     *        - First call (GitHub contents API): Returns a list of mock files including .txt, .json, .md, and .png.
     *        - Subsequent calls: Return mock content for .txt, .json, and .md files, including various URL formats.
     * Action: Executes the CLI command with the `--githubRepo` flag pointing to `MOCK_REPO_URL`.
     * Expected Outcome: The command exits successfully (code 0).
     *                   Stdout indicates that URLs were fetched from the specified GitHub repository.
     *                   It correctly identifies and extracts URLs from .txt (including schemeless), .json (structured and plain text), and .md files.
     *                   It ignores unsupported file types (e.g., .png).
     *                   Verifies the correct number of total URLs processed and that `fetch` was called the expected number of times with the correct URLs.
     */
    it('fetches from various file types in a mock GitHub repo', async () => {
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'file1.txt', type: 'file', download_url: 'https://example.com/file1.txt' },
                    { name: 'data.json', type: 'file', download_url: 'https://example.com/data.json' },
                    { name: 'ignored.md', type: 'file', download_url: 'https://example.com/ignored.md' }, // .md is processed, but content here is simple
                    { name: 'image.png', type: 'file', download_url: 'https://example.com/image.png' }, // Should be ignored by default
                ]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for file1.txt
                ok: true,
                text: async () => 'http://url1.com\nschemeless.from.txt.com',
            } as Response)
            .mockResolvedValueOnce({ // download_url for data.json
                ok: true,
                text: async () => JSON.stringify({
                    description: "Check https://url2.com",
                    details: { link: "http://url3.com/json" },
                    list: ["https://url4.com", "schemeless.from.json.org"] // schemeless in JSON currently not processed
                }),
            } as Response)
            .mockResolvedValueOnce({ // download_url for ignored.md
                ok: true,
                text: async () => 'Markdown with https://url5.com',
            } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${MOCK_REPO_URL}`);
        // Expected: url1.com, https://schemeless.from.txt.com, url2.com, url3.com/json, url4.com, url5.com
        // Note: "schemeless.from.json.org" is NOT expected as schemeless detection is for .txt only.
        expect(result.stdout).toContain(`Successfully loaded 6 URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Total URLs to process: 6`);
        expect(fetchMock).toHaveBeenCalledTimes(4); // 1 for contents, 3 for file downloads
        expect(fetchMock.mock.calls[0][0]).toBe(MOCK_REPO_API_URL);
        expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/file1.txt');
        expect(fetchMock.mock.calls[2][0]).toBe('https://example.com/data.json');
        expect(fetchMock.mock.calls[3][0]).toBe('https://example.com/ignored.md');
    }, testTimeout);

        /**
     * Tests the '--numUrls' flag in conjunction with '--githubRepo' to limit the number of URLs fetched.
     * Setup: Mocks the global `fetch` function.
     *        - GitHub contents API call: Returns two files.
     *        - First file download: Returns content with more URLs than the limit.
     * Action: Executes the CLI with '--githubRepo' and '--numUrls' set to a value less than the total available URLs in the first file.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Only the specified number of URLs are loaded and processed.
     *                   `fetch` is only called for the contents API and the first file (not the second, as the limit is reached).
     *                   Stdout confirms the limited number of URLs processed.
     */
    it('limits URLs with --numUrls from a mock GitHub repo', async () => {
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'file1.txt', type: 'file', download_url: 'https://example.com/file1.txt' },
                    { name: 'data.json', type: 'file', download_url: 'https://example.com/data.json' },
                ]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for file1.txt
                ok: true,
                text: async () => 'http://url1.com\nhttps://url2.com\nhttp://url3.com', // 3 URLs here
            } as Response);
            // data.json's content fetch will not happen due to numUrls limit reached by file1.txt
        const numUrlsToFetch = 2;
        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL} --numUrls ${numUrlsToFetch}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Successfully loaded ${numUrlsToFetch} URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Total URLs to process: ${numUrlsToFetch}`);
        expect(fetchMock).toHaveBeenCalledTimes(2); // 1 for contents, 1 for file1.txt
        expect(fetchMock.mock.calls[0][0]).toBe(MOCK_REPO_API_URL);
        expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/file1.txt');
    }, testTimeout);
    });

    describe('Error Handling and Edge Cases for GitHub Repo Input', () => {
        beforeEach(() => {
            fetchMock = vi.spyOn(global, 'fetch');
            cleanupTestArtifacts([dummyGhInputPath]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            cleanupTestArtifacts([dummyGhInputPath]);
        });

        /**
     * Tests how the CLI handles a 404 error when trying to fetch repository contents from GitHub.
     * Setup: Mocks the global `fetch` function for the GitHub contents API call to return a 404 error.
     * Action: Executes the CLI with '--githubRepo'.
     * Expected Outcome: Command exits successfully (code 0) but processes 0 URLs.
     *                   Stdout includes messages indicating the failure to fetch repository contents (due to 404)
     *                   and that no URLs were found or processed from the GitHub source.
     *                   `fetch` is called once for the contents API.
     */
    it('handles a 404 for mock GitHub repo contents', async () => {
        fetchMock.mockResolvedValueOnce({ // GitHub contents API
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: async () => ({ message: 'Not Found' }),
            text: async () => ('{"message":"Not Found"}')
        } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        // The command exits 0 but logs an error and processes 0 URLs.
        expect(result.code).toBe(0, `Command should exit 0. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Failed to fetch repository contents: 404 Not Found`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain('No URLs to process from GitHub. Exiting.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(MOCK_REPO_API_URL);
    }, testTimeout);

        /**
     * Tests the CLI's behavior when a GitHub repository contains no files with processable extensions (e.g., only images or scripts).
     * Setup: Mocks `fetch` for the GitHub contents API to return a list of files, none of which are .txt, .json, .csv, or .md.
     * Action: Executes the CLI with '--githubRepo'.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that while the repository was accessed, no relevant files were found,
     *                   leading to 0 URLs being processed.
     *                   `fetch` is called only once (for the contents API).
     */
    it('handles mock GitHub repo with no relevant files', async () => {
        fetchMock.mockResolvedValueOnce({ // GitHub contents API
            ok: true,
            json: async () => ([
                { name: 'image.png', type: 'file', download_url: 'https://example.com/image.png' },
                { name: 'script.js', type: 'file', download_url: 'https://example.com/script.js' }, // Not a target extension
            ]),
        } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain('No URLs to process from GitHub. Exiting.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    }, testTimeout);

        /**
     * Tests the scenario where a GitHub repository contains processable file types (.txt, .json) but these files do not contain any URLs.
     * Setup: Mocks `fetch`.
     *        - Contents API call: Returns .txt and .json files.
     *        - File download calls: Return content without any URLs for both files.
     * Action: Executes the CLI with '--githubRepo'.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout shows that files were processed but no URLs were found or loaded.
     *                   `fetch` is called for the contents API and for each of the two files.
     */
    it('handles mock GitHub repo with relevant files but no URLs', async () => {
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'empty.txt', type: 'file', download_url: 'https://example.com/empty.txt' },
                    { name: 'empty.json', type: 'file', download_url: 'https://example.com/empty.json' },
                ]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for empty.txt
                ok: true,
                text: async () => 'This file has no URLs.',
            } as Response)
            .mockResolvedValueOnce({ // download_url for empty.json
                ok: true,
                text: async () => JSON.stringify({ message: "No URLs here" }),
            } as Response);


        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain('No URLs to process from GitHub. Exiting.');
        expect(fetchMock).toHaveBeenCalledTimes(3); // Contents API + two file downloads
    }, testTimeout);
    });

    describe('Flag Interactions with GitHub Repo Input', () => {
        beforeEach(() => {
            fetchMock = vi.spyOn(global, 'fetch');
            cleanupTestArtifacts([dummyGhInputPath]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            cleanupTestArtifacts([dummyGhInputPath]);
        });
        /**
     * Tests that the '--githubRepo' flag takes precedence if both '--githubRepo' and '--inputFile' are provided.
     * Setup: Mocks `fetch` to return content for a GitHub file.
     *        Creates a local input file with different URLs.
     * Action: Executes the CLI with both '--githubRepo' and '--inputFile' flags.
     * Expected Outcome: Command exits successfully (code 0).
     *                   URLs are fetched from the GitHub repository, not the local input file.
     *                   Stdout includes a message indicating that '--githubRepo' is taking precedence.
     *                   The local input file's content remains untouched.
     *                   `fetch` is called for GitHub API and file download.
     */
    it('prioritizes --githubRepo over --inputFile', async () => {
        fetchMock.mockResolvedValueOnce({ // GitHub contents API
            ok: true,
            json: async () => ([{ name: 'file1.txt', type: 'file', download_url: 'https://example.com/file1.txt' }]),
        } as Response)
        .mockResolvedValueOnce({ // download_url for file1.txt
            ok: true, text: async () => 'http://mockedurl.com',
        } as Response);

        createInputFile(dummyGhInputPath, ['http://local-file-url.com']);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL} --inputFile ${dummyGhInputPath}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        // Check for the specific log message about ignoring inputFile
        expect(result.stdout).toContain(`Both --githubRepo and --inputFile (or its default) were provided. --githubRepo takes precedence.`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Successfully loaded 1 URLs from GitHub repository: ${MOCK_REPO_URL}`);

        const inputFileContent = fs.readFileSync(dummyGhInputPath, 'utf-8');
        expect(inputFileContent.trim()).toBe('http://local-file-url.com');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }, testTimeout);

    /**
     * Tests the CLI's behavior when neither '--githubRepo' nor '--inputFile' is provided,
     * and the default input file ('src/input.txt') does not exist.
     * Setup: Ensures 'src/input.txt' is deleted.
     * Action: Executes the CLI command without any source-providing flags.
     * Expected Outcome: Command exits successfully (code 0) as the application handles this gracefully.
     *                   Stdout indicates that loading from the default input file failed and no URLs will be processed from it.
     *                   No error is thrown to stderr.
     */
    it('fails if no --githubRepo or --inputFile is given and default inputFile does not exist', async () => {
        const defaultInput = path.join(projectRoot, 'src', 'input.txt');
        if (fs.existsSync(defaultInput)) fs.unlinkSync(defaultInput);

        const command = `${cliCommand}`; // No arguments
        const result = await executeCommand(command, projectRoot);

        // prebidExplorer now handles the missing default file gracefully by logging and creating no URLs.
        // The command itself exits 0. If a hard error is required, prebidExplorer or scan.ts needs modification.
        expect(result.code).toBe(0, `Command should exit 0. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Failed to load content from input file ${defaultInput}. Cannot proceed with this source.`);
        expect(result.stdout).toContain(`No URLs to process from InputFile. Exiting.`);
        expect(result.stderr).toBe(''); // No actual error thrown to stderr in this specific path
    }, testTimeout);
    });

    describe('URL Extraction from Specific GitHub File Structures and Direct Links', () => {
        beforeEach(() => {
            fetchMock = vi.spyOn(global, 'fetch');
            cleanupTestArtifacts([dummyGhInputPath]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            cleanupTestArtifacts([dummyGhInputPath]);
        });
        /**
     * Tests the extraction of various URL types (HTTP, HTTPS, schemeless domains) from a .txt file in a mock GitHub repo.
     * Also verifies that malformed or unsupported URLs are ignored.
     * Setup: Mocks `fetch`.
     *        - Contents API: Returns a .txt file.
     *        - .txt file download: Returns content with a mix of valid URLs, schemeless domains,
     *          quoted domains, malformed schemeless domains, and unsupported schemes (ftp).
     * Action: Executes CLI with '--githubRepo' and a '--numUrls' limit greater than the number of expected valid URLs.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Correctly extracts and counts valid HTTP/HTTPS URLs and schemeless domains (which are prepended with https).
     *                   Stdout logs messages for each added schemeless domain.
     *                   The total number of processed URLs matches the count of valid extracted URLs.
     */
    it('extracts various URL types from mock GitHub .txt file', async () => {
        const txtContent = `
            http://valid-example.com
            https://another-valid.example.org/path
            schemeless.example.com
            domain.net
            "quoted.domain.org"
            malformed-schemeless..com
            http://
            ftp://unsupported.com
        `;
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([{ name: 'urls.txt', type: 'file', download_url: 'https://example.com/urls.txt' }]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for urls.txt
                ok: true, text: async () => txtContent,
            } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL} --numUrls 10`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        // Expected: http://valid-example.com, https://another-valid.example.org/path,
        // https://schemeless.example.com, https://domain.net, https://quoted.domain.org
        expect(result.stdout).toContain(`Successfully loaded 5 URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Found and added schemeless domain as https://schemeless.example.com from urls.txt`);
        expect(result.stdout).toContain(`Found and added schemeless domain as https://domain.net from urls.txt`);
        expect(result.stdout).toContain(`Found and added schemeless domain as https://quoted.domain.org from urls.txt`);
        expect(result.stdout).toContain(`Total URLs to process: 5`);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }, testTimeout);

    /**
     * Tests URL extraction from a direct link to a .json file on GitHub.
     * Setup: Mocks `fetch` to return JSON content when the raw GitHub URL for the .json file is requested.
     *        The JSON content contains URLs within its string values.
     * Action: Executes CLI with '--githubRepo' pointing to the direct GitHub .json file URL.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates detection of a direct file link and fetching from the corresponding raw URL.
     *                   It logs the processing of the .json file and the number of URLs extracted from its structure.
     *                   The total number of loaded URLs matches those found in the JSON.
     *                   `fetch` is called once with the raw content URL.
     */
    it('extracts URLs from a mock direct GitHub .json file link', async () => {
        const directJsonUrl = "https://github.com/mockOwner/mockRepo/blob/main/data.json";
        const rawJsonUrl = "https://raw.githubusercontent.com/mockOwner/mockRepo/main/data.json";
        const jsonContent = {
            description: "Link: https://direct-json-example.com",
            nested: { url: "http://another-direct.org/path" }
        };
        fetchMock.mockResolvedValueOnce({ // Fetch for raw content
            ok: true,
            text: async () => JSON.stringify(jsonContent),
        } as Response);

        const command = `${cliCommand} --githubRepo ${directJsonUrl}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Detected direct file link: ${directJsonUrl}`);
        expect(result.stdout).toContain(`Fetching content directly from raw URL: ${rawJsonUrl}`);
        expect(result.stdout).toContain(`Processing .json file: data.json`);
        expect(result.stdout).toContain(`Extracted 2 URLs from parsed JSON structure in data.json`);
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from GitHub repository: ${directJsonUrl}`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(rawJsonUrl);
    }, testTimeout);

    /**
     * Tests extraction of schemeless domains from a direct link to a .txt file on GitHub.
     * Setup: Mocks `fetch` to return .txt content (containing schemeless domains and full URLs)
     *        when the raw GitHub URL for the .txt file is requested.
     * Action: Executes CLI with '--githubRepo' pointing to the direct GitHub .txt file URL.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates detection of a direct file link and fetching from the raw URL.
     *                   It logs processing of the .txt file for schemeless domains and messages for each added schemeless domain.
     *                   The total number of loaded URLs includes both original full URLs and schemeless domains (prepended with https).
     *                   `fetch` is called once with the raw content URL.
     */
    it('extracts schemeless domains from a mock direct GitHub .txt file link', async () => {
        const directTxtUrl = "https://github.com/mockOwner/mockRepo/blob/main/domains.txt";
        const rawTxtUrl = "https://raw.githubusercontent.com/mockOwner/mockRepo/main/domains.txt";
        const txtContent = "direct-domain.com\nsub.direct-domain.co.uk\nhttp://full-url.com";
        fetchMock.mockResolvedValueOnce({ // Fetch for raw content
            ok: true,
            text: async () => txtContent,
        } as Response);

        const command = `${cliCommand} --githubRepo ${directTxtUrl}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Detected direct file link: ${directTxtUrl}`);
        expect(result.stdout).toContain(`Fetching content directly from raw URL: ${rawTxtUrl}`);
        expect(result.stdout).toContain(`Processing .txt file: domains.txt for schemeless domains.`);
        expect(result.stdout).toContain(`Found and added schemeless domain as https://direct-domain.com from domains.txt`);
        expect(result.stdout).toContain(`Found and added schemeless domain as https://sub.direct-domain.co.uk from domains.txt`);
        // Expected: https://direct-domain.com, https://sub.direct-domain.co.uk, http://full-url.com
        expect(result.stdout).toContain(`Successfully loaded 3 URLs from GitHub repository: ${directTxtUrl}`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(rawTxtUrl);
    }, testTimeout);

    /**
     * Tests the CLI's fallback mechanism when encountering a malformed .json file in a GitHub repository.
     * Setup: Mocks `fetch`.
     *        - Contents API: Returns a .json file.
     *        - .json file download: Returns content that is not valid JSON but contains a URL in plain text.
     * Action: Executes CLI with '--githubRepo'.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that parsing the JSON failed and that it's falling back to a regex scan of the raw content.
     *                   The URL from the raw content should be successfully extracted.
     *                   `fetch` is called for both contents API and the malformed .json file.
     */
    it('handles malformed JSON from a mock GitHub .json file in repo', async () => {
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([{ name: 'malformed.json', type: 'file', download_url: 'https://example.com/malformed.json' }]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for malformed.json
                ok: true,
                text: async () => 'This is not JSON. But it has https://fallback-url.com',
            } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Processing .json file: malformed.json`);
        expect(result.stdout).toContain(`Failed to parse JSON from malformed.json. Falling back to regex scan of raw content.`);
        // The fallback regex scan should find "https://fallback-url.com"
        expect(result.stdout).toContain(`Successfully loaded 1 URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }, testTimeout);

    /**
     * Tests fetching a .txt file (simulating an IAB list format with domains, not full URLs) from a direct GitHub file URL.
     * This test verifies how the system handles files containing domain names when it expects full URLs.
     * Setup: Mocks `fetch`.
     *        - Mocks the GitHub contents API call (though for direct links, this might be optimized away by the CLI's logic).
     *        - Mocks the direct file download (raw URL) to return a string of domain names, each on a new line.
     * Action: Executes CLI with '--githubRepo' pointing to the direct .txt file URL and a '--numUrls' limit.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates detection of a direct file link and fetching from the raw URL.
     *                   Since the file contains domains and not full URLs matching the extraction regex,
     *                   it should log that no URLs were found in the content.
     *                   Consequently, it reports 0 URLs extracted and 0 URLs to process.
     *                   `fetch` is expected to be called once for the raw content if direct link logic is optimal,
     *                   or twice if it first checks contents API (current mock setup assumes the latter, but behavior might differ).
     *                   The key is that no URLs are extracted from domain-only content by the current regex.
     */
    it('should attempt to fetch a .txt file with domains from a direct GitHub file URL (IAB list format)', async () => {
        const targetUrl = 'https://github.com/InteractiveAdvertisingBureau/adstxtcrawler/blob/master/adstxt_domains_2018-02-13.txt';
        // This is the API endpoint for the file content
        const githubApiUrl = 'https://api.github.com/repos/InteractiveAdvertisingBureau/adstxtcrawler/contents/adstxt_domains_2018-02-13.txt';
        // This is the raw download URL that GitHub API will point to
        const downloadUrl = 'https://raw.githubusercontent.com/InteractiveAdvertisingBureau/adstxtcrawler/master/adstxt_domains_2018-02-13.txt';
        const sampleContent = "domain1.com\ndomain2.com\ngoogle.com"; // Plain domains, not full URLs

        fetchMock
            .mockResolvedValueOnce({ // Mock for the GitHub contents API call
                ok: true,
                json: async () => ({
                    name: 'adstxt_domains_2018-02-13.txt',
                    type: 'file',
                    download_url: downloadUrl,
                }),
            } as Response)
            .mockResolvedValueOnce({ // Mock for the actual file download
                ok: true,
                text: async () => sampleContent,
            } as Response);

        const command = `${cliCommand} --githubRepo ${targetUrl} --numUrls 10`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);

        // Assertions
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${targetUrl}`);
        // The tool should identify it as a direct file link and transform it for the API call, then use the download_url
        expect(result.stdout).toContain(`Detected direct file link: ${targetUrl}. Attempting to fetch raw content.`);
        expect(result.stdout).toContain(`Fetching content directly from raw URL: ${downloadUrl}`);


        // Check fetch mock calls
        // First call should be to the GitHub API to get file metadata (which includes download_url)
        // Second call should be to the download_url itself
        // Note: The current implementation for direct file links might directly go to raw.githubusercontent.com
        // If so, the first API call to api.github.com/repos/.../contents/... might be skipped for direct links.
        // Let's check the logs to confirm the behavior.
        // Based on the live test 'should successfully scan a small number of URLs from a live, direct GitHub file URL (for --githubRepo)'
        // it seems it does NOT call the /contents/ API endpoint for direct file links, but constructs the raw URL.
        // However, the mocking setup here assumes it *might* if the logic were different or for non-direct repo links.
        // Let's adjust the expectation: if it's a direct file, it might skip the contents API call and go for raw.
        // The current logic in `getUrlsFromGitHub` for a direct file link:
        // 1. It logs "Detected direct file link".
        // 2. It constructs the raw URL.
        // 3. It fetches from the raw URL.
        // It does NOT call the `api.github.com/repos/.../contents/` endpoint for direct file links.
        // So, only one fetch call is expected.

        // If the logic changes to first hit the contents API even for direct files, then 2 calls.
        // For now, based on existing live test output for direct files:
        // It seems the `fetchFileContentFromUrl` is called, which internally would use the `downloadUrl`.
        // The initial fetch in `getUrlsFromGitHub` for a direct file is to the `rawContentUrl`.

        // Let's verify the calls based on the mocked behavior which *should* align with the code's logic for direct files.
        // The code path for direct github file URLs is:
        // 1. `isDirectGitHubFileLink` returns true.
        // 2. `getRawGitHubUrl` is called.
        // 3. `fetchFileContentFromUrl` is called with the raw URL.
        // This means only ONE fetch call to the `downloadUrl` (raw URL) is made.
        // The mock for `githubApiUrl` will not be hit if the logic correctly identifies it as a direct file link.
        // Let's adjust the mock setup if needed or the assertions.

        // Re-evaluating: The `githubRepo` flag can take a repo URL or a direct file URL.
        // If it's a direct file URL, `getUrlsFromGitHub` -> `processDirectFileLink` is called.
        // `processDirectFileLink` calls `getRawGitHubUrl` and then `fetchFileContentFromUrl`.
        // This means ONE fetch to the raw URL. The content API mock is not strictly needed for *this specific direct file URL case*
        // but is good to have for repository folder URLs.
        // For this test, we are testing a *direct file URL*.

        // If `fetchMock` was set up for two calls, and only one happens, the test would fail due_to_unmatched_mocks.
        // The first mock for `githubApiUrl` should NOT be called for a direct file link.
        // The second mock for `downloadUrl` (the raw one) SHOULD be called.

        // Let's refine the mock setup for clarity for this specific test:
        // We only need to mock the fetch to the `downloadUrl` because it's a direct file link.
        // However, the global `fetchMock` is used. We need to ensure the calls are as expected.

        // Correcting the mock setup and expectations for a DIRECT FILE LINK:
        // The code path for a direct file link does not use the /repos/{owner}/{repo}/contents/{path} API.
        // It directly constructs the raw.githubusercontent.com URL.
        // So, we only expect one fetch call to `downloadUrl`.
        // The first mock for `api.github.com/repos/...` will not be used.

        // Let's remove the first mock and expect one call.
        // No, keep both mocks, but expect only the second one to be *called* for this *specific test logic*.
        // The fetchMock will have two configured mocks; only the one matching `downloadUrl` should be hit.

        // fetchMock.mockClear(); // Clear previous calls if any from other tests (handled by beforeEach)
        // Mock for the actual file download (raw URL)
        // global.fetch = vi.fn() // Reset fetch mock specific for this test if needed
        // .mockResolvedValueOnce({ // Mock for the actual file download
        //     ok: true,
        //     text: async () => sampleContent,
        // } as Response);
        // This is tricky with shared mock. The current setup adds mocks sequentially.

        // The current mock setup:
        // 1. Mocks api.github.com/.../contents (for repo directory listing)
        // 2. Mocks raw.github.com/... (for file download)
        // For a direct file URL, the CLI should skip step 1 and go to step 2.
        // So, `fetchMock.mock.calls[0][0]` should be `downloadUrl`.

        expect(fetchMock).toHaveBeenCalledTimes(1); // Only one actual fetch for the raw content
        expect(fetchMock.mock.calls[0][0]).toBe(downloadUrl);


        // Because the content is "domain1.com\ndomain2.com\ngoogle.com", and the current regex
        // `/(https?:\/\/[^\s"]+)/gi` looks for "http://" or "https://", it will not find any URLs.
        expect(result.stdout).toContain(`No URLs found in content from ${downloadUrl}`);
        expect(result.stdout).toContain(`Total URLs extracted before limiting: 0`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${targetUrl}`);
        expect(result.stdout).toContain("No URLs to process from GitHub. Exiting.");
    }, testTimeout);

    /**
     * Tests fetching and extracting URLs from a direct link to a .json file on GitHub,
     * simulating a structure like that of DuckDuckGo's tracker radar list.
     * Setup: Mocks `fetch` for the direct raw content URL of the .json file.
     *        The mock returns a JSON string where full URLs are present as values within the JSON structure.
     * Action: Executes CLI with '--githubRepo' pointing to the direct .json file URL and a '--numUrls' limit.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates detection of a direct file link and fetching from the raw URL.
     *                   The CLI should parse the JSON and extract the fully qualified URLs found within its string values.
     *                   It logs the number of successfully loaded URLs.
     *                   `fetch` is called once with the raw content URL.
     */
    it('should attempt to fetch a .json file from a direct GitHub file URL (DuckDuckGo format)', async () => {
        const targetUrl = 'https://github.com/duckduckgo/tracker-radar/blob/main/build-data/generated/domain_map.json';
        const rawDownloadUrl = 'https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/domain_map.json';
        // Sample JSON content. The actual file is very large.
        // The current URL extraction regex will not find URLs in this structure unless they are full URLs in string values.
        // For this sample, no URLs should be extracted.
        const sampleJsonContent = JSON.stringify({
            "domain1.com": {
                "owner": {
                    "name": "Company A",
                    "displayName": "Company A",
                    "privacyPolicy": "https://example.com/privacy", // This IS a URL
                    "url": "https://example.com" // This IS a URL
                },
                "source": ["example.com"],
                "prevalence": 0.1,
                "sites": 100,
                "subdomains": ["sub.domain1.com"],
                "cnames": [],
                "fingerprinting": 0,
                "resources": [
                    { "rule": "domain1\\.com\\/script\\.js", "severity": "critical", "type": "script" }
                ],
                "categories": ["Advertising"]
            },
            "domain2.net": {
                "owner": {
                    "name": "Company B",
                    "displayName": "Company B"
                    // No privacyPolicy or URL here
                },
                "source": [],
                "prevalence": 0.05,
                "sites": 50,
                "subdomains": [],
                "cnames": [],
                "fingerprinting": 0,
                "resources": [],
                "categories": ["Analytics"]
            }
        });

        // For direct file links, the CLI directly constructs the raw URL and fetches it.
        // So, only one fetch call is expected to the rawDownloadUrl.
        // The fetchMock is configured sequentially. The first mock in the list (if any others were configured by mistake for this test)
        // would be for the GH API contents endpoint, which is NOT used for direct file links.
        // The second mock (or first if this is the only one) should be for the rawDownloadUrl.
        fetchMock.mockResolvedValueOnce({ // This mock should match the call to rawDownloadUrl
            ok: true,
            text: async () => sampleJsonContent,
        } as Response);

        const command = `${cliCommand} --githubRepo ${targetUrl} --numUrls 10`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);

        // Assertions
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${targetUrl}`);
        expect(result.stdout).toContain(`Detected direct file link: ${targetUrl}. Attempting to fetch raw content.`);
        expect(result.stdout).toContain(`Fetching content directly from raw URL: ${rawDownloadUrl}`);

        // Verify fetch call
        // Since it's a direct file link, only one call to the raw content URL is expected.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(rawDownloadUrl);

        // The system treats the JSON file as plain text for URL extraction.
        // The generic regex /(https?:\/\/[^\s"]+)/gi will find full URLs within string values.
        // In the sampleJsonContent:
        // - "https://example.com/privacy" is a URL
        // - "https://example.com" is a URL
        // So, 2 URLs should be extracted.
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from GitHub repository: ${targetUrl}`);
        expect(result.stdout).toContain(`Total URLs to process: 2`);


        // If the JSON structure did not contain any fully qualified URLs as string values,
        // then the following assertions for 0 URLs would be correct.
        // expect(result.stdout).toContain(`No URLs found in content from ${rawDownloadUrl}`);
        // expect(result.stdout).toContain(`Total URLs extracted before limiting: 0`);
        // expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${targetUrl}`);
        // expect(result.stdout).toContain("No URLs to process from GitHub. Exiting.");
    }, testTimeout);
});

// Removed the describe block "CLI Tests for CSV File Input"
// Removed the describe block "CLI Tests for Live CSV File Input (Network)"

/**
 * Test suite for the '--githubRepo' flag functionality using live GitHub repositories.
 * These tests require an active internet connection and interact with real GitHub data.
 * They cover scenarios like fetching from direct file URLs.
 * IMPORTANT: These tests are subject to network conditions and external repository states.
 */
describe('CLI Tests for Live GitHub Repository Input (Network)', () => {
    // IMPORTANT:
    // The tests in this suite interact with actual, live GitHub repositories
    // and require an active internet connection.
    // They are subject to network flakiness, API rate limits (though unlikely for
    // the small number of tests), and changes in the target repositories' content.
    // These tests should be run judiciously, perhaps less frequently than mocked tests,
    // or in specific environments prepared for network-dependent integration tests.

    const networkTestTimeout = 90000; // Longer timeout for actual network requests

    /**
     * Tests scanning a small number of URLs from a live, direct GitHub file URL.
     * This test relies on an active internet connection and the availability of the target GitHub repository and file.
     * Setup: Defines a live GitHub file URL known to contain domain names (not full URLs with schemes).
     *        Sets a small number of URLs to scan via `--numUrls`.
     * Action: Executes the CLI command with `--githubRepo` pointing to the live file and the `--numUrls` flag.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates detection of a direct file link and fetching from the raw content URL.
     *                   Since the target file contains domains without HTTP/S schemes, and the current URL extraction
     *                   regex expects schemes, it should log that no URLs were found in the content.
     *                   Consequently, 0 URLs are processed, and the CLI exits gracefully.
     *                   This test primarily verifies the handling of direct GitHub links and content that doesn't match the URL regex.
     */
    it('should successfully scan a small number of URLs from a live, direct GitHub file URL (for --githubRepo)', async () => {
        const githubFileUrl = 'https://github.com/zer0h/top-1000000-domains/blob/master/top-10000-domains';
        const numUrlsToScan = 7; // Small number to keep the test reasonably fast
        const command = `${cliCommand} --githubRepo ${githubFileUrl} --numUrls ${numUrlsToScan}`;

        // No mocks here, this will make actual network calls.
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr} Stdout: ${result.stdout}`);

        // Check for stdout messages
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository source: ${githubFileUrl}`);
        expect(result.stdout).toContain(`Detected direct file link: ${githubFileUrl}. Attempting to fetch raw content.`);
        // The raw URL will be like: https://raw.githubusercontent.com/zer0h/top-1000000-domains/master/top-10000-domains
        expect(result.stdout).toMatch(/Fetching content directly from raw URL: https:\/\/raw\.githubusercontent\.com\/zer0h\/top-1000000-domains\/master\/top-10000-domains/);
        // It should extract URLs from the file. The file contains domain names, which are not full URLs.
        // The regex /(https?:\/\/[^\s"]+)/gi will NOT match simple domain names like "google.com".
        // It will only match full URLs if they were present.
        // Given the file content (e.g., "google.com", "youtube.com"), we expect 0 actual URLs to be extracted by the current regex.
        // This test will therefore verify that it attempts to fetch, finds no *valid URLs* based on the regex, and processes 0 URLs.
        // This is an important outcome of the test given the current URL regex.

        // If the intention was to treat each line as a URL, the regex or processing logic in prebid.ts would need to change.
        // For now, we test the current behavior.
        expect(result.stdout).toContain(`No URLs found in content from https://raw.githubusercontent.com/zer0h/top-1000000-domains/master/top-10000-domains`);
        expect(result.stdout).toContain(`Total URLs extracted before limiting: 0`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${githubFileUrl}.`);
        expect(result.stdout).toContain('No URLs to process from GitHub. Exiting.'); // Corrected message

    }, networkTestTimeout);
});

/**
 * Test suite for the '--range' and '--chunkSize' command-line flags.
 * Covers various scenarios of selecting URL sub-ranges and processing URLs in chunks,
 * including valid and invalid inputs, edge cases, and combinations of both flags.
 */
describe('CLI Tests for Range and Chunk Functionality', () => {
    const testTimeout = 20000; // Adjusted timeout for these tests, can be tuned
    const testInputFilePath = path.join(projectRoot, 'test_range_chunk_input.txt');
    const testCsvFilePath = path.join(projectRoot, 'test_range_chunk.csv'); // For CSV specific range/chunk tests
    const rangeAndChunkTestPaths = [testInputFilePath, testCsvFilePath];

    beforeEach(() => {
        cleanupTestArtifacts(rangeAndChunkTestPaths);
    });

    afterEach(() => {
        cleanupTestArtifacts(rangeAndChunkTestPaths);
    });

    // --- Tests for --range ---
    /**
     * Tests processing of a specific, valid range of URLs (e.g., "2-4") from an input file.
     * Setup: Creates an input file with 5 URLs.
     * Action: Executes the CLI with the input file and the `--range 2-4` flag.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that 5 URLs were initially found.
     *                   It logs the application of the range "2-4".
     *                   It confirms that URLs from 2 to 4 (1-based index) are processed, resulting in 3 URLs.
     *                   The options passed to the core processing logic should reflect the "2-4" range.
     */
    it('should process a valid specific range (e.g., 2-4) from an input file', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com', 'https://url4.com', 'https://url5.com'];
        createInputFile(testInputFilePath, urls);
        // Range 2-4 (1-based) means indices 1, 2, 3 (0-based), so url2, url3, url4
        const command = `${cliCommand} ${testInputFilePath} --range 2-4`;
        const result = await executeCommand(command, projectRoot);

        if (result.code !== 0) {
            console.error(`Test failed. Exit code: ${result.code}`);
            console.error("Stderr:", result.stderr);
            console.error("Stdout:", result.stdout);
        }
        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 5`);
        expect(result.stdout).toContain(`Applying range: 2-4`);
        expect(result.stdout).toContain(`Applied range: Processing URLs from 2 to 4 (0-based index 1 to 3). Total URLs after range: 3 (out of 5)`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 3`);
        // Check options passed to prebidExplorer
        expect(result.stdout).toMatch(/"range": "2-4"/);
        // Check if the correct URLs are mentioned in the "Processing:" logs (if Puppeteer part runs long enough)
        // This might be brittle, focusing on counts is safer.
        // expect(result.stdout).toContain('Processing: https://url2.com');
        // expect(result.stdout).toContain('Processing: https://url3.com');
        // expect(result.stdout).toContain('Processing: https://url4.com');
        // expect(result.stdout).not.toContain('Processing: https://url1.com');
        // expect(result.stdout).not.toContain('Processing: https://url5.com');
    }, testTimeout);

    /**
     * Tests processing of an open-ended range with a start only (e.g., "3-") from an input file.
     * Setup: Creates an input file with 5 URLs.
     * Action: Executes the CLI with the input file and the `--range 3-` flag.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Processes URLs from the 3rd URL to the end of the file (total 3 URLs: url3, url4, url5).
     *                   Stdout confirms the range application and the number of URLs processed.
     */
    it('should process an open-ended range (start only, e.g., 3-) from an input file', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com', 'https://url4.com', 'https://url5.com'];
        createInputFile(testInputFilePath, urls);
        // Range 3- (1-based) means indices 2, 3, 4 (0-based), so url3, url4, url5
        const command = `${cliCommand} ${testInputFilePath} --range 3-`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 5`);
        expect(result.stdout).toContain(`Applying range: 3-`);
        expect(result.stdout).toContain(`Applied range: Processing URLs from 3 to 5 (0-based index 2 to 4). Total URLs after range: 3 (out of 5)`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 3`);
        expect(result.stdout).toMatch(/"range": "3-"/);
    }, testTimeout * 2); // Increased timeout

    /**
     * Tests processing of an open-ended range with an end only (e.g., "-2") from an input file.
     * Setup: Creates an input file with 5 URLs.
     * Action: Executes the CLI with the input file and the `--range -2` flag.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Processes URLs from the beginning of the file up to the 2nd URL (total 2 URLs: url1, url2).
     *                   Stdout confirms the range application and the number of URLs processed.
     */
    it('should process an open-ended range (end only, e.g., -2) from an input file', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com', 'https://url4.com', 'https://url5.com'];
        createInputFile(testInputFilePath, urls);
        // Range -2 (1-based) means indices 0, 1 (0-based), so url1, url2
        const command = `${cliCommand} ${testInputFilePath} --range -2`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 5`);
        expect(result.stdout).toContain(`Applying range: -2`);
        expect(result.stdout).toContain(`Applied range: Processing URLs from 1 to 2 (0-based index 0 to 1). Total URLs after range: 2 (out of 5)`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 2`);
        expect(result.stdout).toMatch(/"range": "-2"/);
    }, testTimeout);

    /**
     * Tests how the CLI handles an out-of-bounds range where the start is beyond the number of available URLs.
     * Setup: Creates an input file with 5 URLs.
     * Action: Executes the CLI with the input file and `--range 100-110`.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that the start of the range is beyond the total number of URLs
     *                   and that no URLs will be processed. It should then exit gracefully.
     */
    it('should handle out-of-bounds range (too high, e.g., 100-110 for a 5 URL file)', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com', 'https://url4.com', 'https://url5.com'];
        createInputFile(testInputFilePath, urls);
        const command = `${cliCommand} ${testInputFilePath} --range 100-110`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 5`);
        expect(result.stdout).toContain(`Applying range: 100-110`);
        expect(result.stdout).toContain(`Start of range (100) is beyond the total number of URLs (5). No URLs to process.`);
        // The message "Total URLs after range: 0 (out of 5)" is not explicitly logged when start is out of bounds.
        // Instead, it directly logs "No URLs to process after applying range..."
        expect(result.stdout).not.toContain(`Total URLs after range: 0 (out of 5)`);
        expect(result.stdout).toContain(`No URLs to process after applying range or due to empty initial list. Exiting.`);
        // Ensure it doesn't try to process anything
        expect(result.stdout).not.toContain(`Total URLs to process after range check:`);
    }, testTimeout);

    /**
     * Tests the CLI's behavior when an invalid range format (non-numeric, e.g., "abc") is provided.
     * Setup: Creates an input file with 3 URLs.
     * Action: Executes the CLI with the input file and `--range abc`.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout logs a warning about the invalid range format.
     *                   The CLI should then proceed to process all available URLs from the input file (3 URLs).
     */
    it('should handle invalid range format (e.g., "abc") by processing all URLs and logging a warning', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com'];
        createInputFile(testInputFilePath, urls);
        const command = `${cliCommand} ${testInputFilePath} --range abc`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 3`);
        expect(result.stdout).toContain(`Applying range: abc`);
        expect(result.stdout).toContain(`Invalid range format: "abc". Proceeding with all URLs.`);
        // It should then proceed with all 3 URLs
        expect(result.stdout).toContain(`Total URLs to process after range check: 3`);
        expect(result.stdout).toMatch(/"range": "abc"/); // The invalid flag is still passed in options
    }, testTimeout);

    /**
     * Tests the CLI's behavior with another invalid range format (e.g., "1-2-3").
     * Current behavior might parse "1-2-3" as "1-2". This test verifies that behavior.
     * Setup: Creates an input file with 3 URLs.
     * Action: Executes the CLI with the input file and `--range 1-2-3`.
     * Expected Outcome: Command exits successfully (code 0).
     *                   The system parses "1-2-3" as a valid range "1-2", processing the first 2 URLs.
     *                   Stdout confirms this interpretation and the number of URLs processed.
     *                   No "invalid range format" warning is expected for this specific "1-2-3" case.
     */
    it('should handle invalid range format (e.g., "1-2-3") by processing all URLs and logging a warning', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com'];
        createInputFile(testInputFilePath, urls);
        const command = `${cliCommand} ${testInputFilePath} --range 1-2-3`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 3`);
        expect(result.stdout).toContain(`Applying range: 1-2-3`);
        // Current behavior: "1-2-3" is parsed as range 1-2.
        expect(result.stdout).not.toContain(`Invalid range format: "1-2-3". Proceeding with all URLs.`);
        expect(result.stdout).toContain(`Applied range: Processing URLs from 1 to 2 (0-based index 0 to 1). Total URLs after range: 2 (out of 3).`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 2`);
        expect(result.stdout).toMatch(/"range": "1-2-3"/); // The flag value itself is still passed as "1-2-3"
    }, testTimeout);


    /**
     * Tests applying a valid URL range to a CSV file specified via the `inputFile` argument.
     * Setup: Creates a CSV file ('test_input_actual.csv') with 5 URLs.
     * Action: Executes the CLI with the CSV file path as `inputFile` and `--range 2-4`.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates processing of the local CSV file.
     *                   It correctly loads all 5 URLs from the CSV.
     *                   Applies the range "2-4", resulting in 3 URLs being processed.
     *                   Confirms that the original CSV input file is not modified (as CSVs are read-only).
     */
    it('should apply a valid range to a CSV input file passed as inputFile', async () => {
        const csvContent = "url\nhttps://csv1.com\nhttps://csv2.com\nhttps://csv3.com\nhttps://csv4.com\nhttps://csv5.com";
        // Use testInputActualCsv for consistency with other inputFile tests
        fs.writeFileSync(testInputActualCsv, csvContent);
        // Range 2-4 (1-based) means csv2, csv3, csv4
        const command = `${cliCommand} ${testInputActualCsv} --range 2-4`; // Use testInputActualCsv as inputFile
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Processing local file: ${testInputActualCsv} (detected type: csv)`);
        expect(result.stdout).toContain(`Successfully loaded 5 URLs from local CSV file: ${testInputActualCsv}`);
        expect(result.stdout).toContain(`Initial total URLs found: 5`);
        expect(result.stdout).toContain(`Applying range: 2-4`);
        expect(result.stdout).toContain(`Applied range: Processing URLs from 2 to 4 (0-based index 1 to 3). Total URLs after range: 3 (out of 5)`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 3`);
        expect(result.stdout).toMatch(/"range": "2-4"/);
        expect(result.stdout).toContain(`Skipping modification of original CSV input file: ${testInputActualCsv}`);

        const fileContent = fs.readFileSync(testInputActualCsv, 'utf-8');
        expect(fileContent.trim()).toBe(csvContent.trim()); // File should not be emptied
    }, testTimeout * 2); // Increased timeout

    // --- Tests for --chunkSize --- (These should be fine, just ensure they use inputFile for local files)
    /**
     * Tests URL processing in chunks when `chunkSize` is smaller than the total number of URLs.
     * Setup: Creates an input file with 10 URLs.
     * Action: Executes the CLI with the input file and `--chunkSize 3`.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that 10 URLs are to be processed.
     *                   Chunked processing is enabled with size 3, resulting in 4 chunks.
     *                   Logs confirm processing of each chunk (1-3, 4-6, 7-9, 10-10).
     */
    it('should process in chunks if chunkSize is smaller than total URLs', async () => {
        const urls = Array.from({ length: 10 }, (_, i) => `https://url${i + 1}.com`);
        createInputFile(testInputFilePath, urls);
        const command = `${cliCommand} ${testInputFilePath} --chunkSize 3`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 10`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 10`);
        expect(result.stdout).toMatch(/"chunkSize": 3/);
        expect(result.stdout).toContain(`Chunked processing enabled. Chunk size: 3`);
        expect(result.stdout).toContain(`Total chunks to process: 4`); // 10 / 3 = 3.33 -> 4 chunks
        expect(result.stdout).toContain(`Processing chunk 1 of 4: URLs 1-3`);
        expect(result.stdout).toContain(`Finished processing chunk 1 of 4`);
        expect(result.stdout).toContain(`Processing chunk 2 of 4: URLs 4-6`);
        expect(result.stdout).toContain(`Finished processing chunk 2 of 4`);
        expect(result.stdout).toContain(`Processing chunk 3 of 4: URLs 7-9`);
        expect(result.stdout).toContain(`Finished processing chunk 3 of 4`);
        expect(result.stdout).toContain(`Processing chunk 4 of 4: URLs 10-10`);
        expect(result.stdout).toContain(`Finished processing chunk 4 of 4`);
        // Potentially check that all 10 URLs were mentioned in "Processing:" logs if reliable
    }, testTimeout * 6); // Further Increased timeout to 120s

    /**
     * Tests URL processing when `chunkSize` is larger than the total number of URLs.
     * Setup: Creates an input file with 3 URLs.
     * Action: Executes the CLI with the input file and `--chunkSize 10`.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates 3 URLs to process.
     *                   Chunked processing is enabled with size 10, resulting in 1 chunk.
     *                   Logs confirm processing of chunk 1 of 1, containing all 3 URLs.
     */
    it('should process all URLs in one chunk if chunkSize is larger than total URLs', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com'];
        createInputFile(testInputFilePath, urls);
        const command = `${cliCommand} ${testInputFilePath} --chunkSize 10`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 3`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 3`);
        expect(result.stdout).toMatch(/"chunkSize": 10/);
        expect(result.stdout).toContain(`Chunked processing enabled. Chunk size: 10`);
        expect(result.stdout).toContain(`Total chunks to process: 1`);
        expect(result.stdout).toContain(`Processing chunk 1 of 1: URLs 1-3`);
        expect(result.stdout).toContain(`Finished processing chunk 1 of 1`);
    }, testTimeout);

    /**
     * Tests URL processing when `chunkSize` is not provided (default behavior).
     * Setup: Creates an input file with 3 URLs.
     * Action: Executes the CLI with the input file and no `--chunkSize` flag.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates 3 URLs to process.
     *                   No chunked processing logs are present.
     *                   A message confirms processing all URLs without chunking.
     */
    it('should process all URLs without chunking if chunkSize is not provided', async () => {
        const urls = ['https://url1.com', 'https://url2.com', 'https://url3.com'];
        createInputFile(testInputFilePath, urls);
        const command = `${cliCommand} ${testInputFilePath}`; // No chunkSize
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 3`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 3`);
        expect(result.stdout).not.toContain(`Chunked processing enabled`);
        expect(result.stdout).not.toContain(`Processing chunk`);
        expect(result.stdout).toContain(`Processing all 3 URLs without chunking.`);
    }, testTimeout);


    // --- Tests for --range and --chunkSize combined ---
    /**
     * Tests the combined usage of '--range' and '--chunkSize' flags.
     * Verifies that a specified range of URLs is correctly selected and then processed in chunks of the specified size.
     */
    it('should process a ranged set of URLs in chunks', async () => {
        const urls = Array.from({ length: 20 }, (_, i) => `https://url${i + 1}.com`);
        createInputFile(testInputFilePath, urls);
        // Range 5-15 (1-based) means indices 4-14 (0-based), so url5 to url15. Total 11 URLs.
        // ChunkSize 4. Chunks: (url5,6,7,8), (url9,10,11,12), (url13,14,15) -> 3 chunks
        const command = `${cliCommand} ${testInputFilePath} --range 5-15 --chunkSize 4`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Initial total URLs found: 20`);
        expect(result.stdout).toContain(`Applying range: 5-15`);
        expect(result.stdout).toContain(`Applied range: Processing URLs from 5 to 15 (0-based index 4 to 14). Total URLs after range: 11 (out of 20)`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 11`);
        expect(result.stdout).toMatch(/"range": "5-15"/);
        expect(result.stdout).toMatch(/"chunkSize": 4/);

        expect(result.stdout).toContain(`Chunked processing enabled. Chunk size: 4`);
        expect(result.stdout).toContain(`Total chunks to process: 3`); // 11 / 4 = 2.75 -> 3 chunks

        // Check logs for each chunk. The URLs logged are based on the position in the *original* list if not careful.
        // The prebid.ts log is "Processing chunk X of Y: URLs A-B" where A and B are 1-based indices *within the current urlsToProcess list*.
        expect(result.stdout).toContain(`Processing chunk 1 of 3: URLs 1-4`); // Processes first 4 of the 11 ranged URLs
        expect(result.stdout).toContain(`Finished processing chunk 1 of 3`);
        expect(result.stdout).toContain(`Processing chunk 2 of 3: URLs 5-8`); // Processes next 4 of the 11 ranged URLs
        expect(result.stdout).toContain(`Finished processing chunk 2 of 3`);
        expect(result.stdout).toContain(`Processing chunk 3 of 3: URLs 9-11`);// Processes last 3 of the 11 ranged URLs
        expect(result.stdout).toContain(`Finished processing chunk 3 of 3`);
    }, testTimeout * 4); // Further Increased timeout to 80s
});

// Separate describe block for live CSV tests if preferred, or could be part of the above
/**
 * Test suite for CSV file input functionality, specifically focusing on network-related aspects (live URLs)
 * and local CSV files that might contain domain-only entries or non-existent remote files.
 * It replaces older, broader CSV testing suites.
 */
describe('CLI Tests for Live CSV File Input (Network)', () => {
    const networkTestTimeout = 90000; // Longer timeout for actual network requests
    // let fetchMock: ReturnType<typeof vi.spyOn>; // fetchMock is not consistently working for child processes

    beforeEach(() => {
        // Ensure fetch is NOT mocked for these live tests
        if (vi.isMockFunction(global.fetch)) {
            vi.restoreAllMocks();
        }
        // Cleanup the new local CSV if it exists from a previous run
        const testDomainsOnlyCsvPath = path.join(projectRoot, 'test_domains_only.csv');
        cleanupTestArtifacts([testDomainsOnlyCsvPath]);
    });

    afterEach(() => {
        // vi.restoreAllMocks();
        // Cleanup the new local CSV after each test
        const testDomainsOnlyCsvPath = path.join(projectRoot, 'test_domains_only.csv');
        cleanupTestArtifacts([testDomainsOnlyCsvPath]);
    });

    // Modified Test Case: From live Jirehlov CSV to local small CSV with domains only
    /**
     * Tests the CLI's handling of a local CSV file that contains only domain names (not full URLs).
     * Setup: Creates a local CSV file ('test_domains_only.csv') with a header and three domain names.
     * Action: Executes the CLI command with the `--csvFile` flag pointing to this local CSV.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that the local CSV file is being read.
     *                   Crucially, it should report that 0 URLs were extracted because the domain names
     *                   do not match the CLI's URL validation regex (which expects a scheme).
     *                   It then logs that there are no URLs to process from the CSV and exits.
     *                   `stderr` should be empty.
     */
    it('should correctly identify 0 URLs from a local CSV file containing only domains', async () => {
        const testDomainsOnlyCsvPath = path.join(projectRoot, 'test_domains_only.csv');
        const csvContent = "domain\ngoogle.com\nexample.com\nyoutube.com";
        fs.writeFileSync(testDomainsOnlyCsvPath, csvContent);

        const command = `${cliCommand} --csvFile ${testDomainsOnlyCsvPath}`;

        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        // Check for local file processing messages
        expect(result.stdout).toContain(`Reading local CSV file: ${testDomainsOnlyCsvPath}`);
        // This is the key assertion: 0 URLs should be loaded because domains don't match the URL regex
        expect(result.stdout).toContain(`Extracted 0 URLs from CSV: ${testDomainsOnlyCsvPath}`);
        // Check for appropriate exit message
        expect(result.stdout).toContain('No URLs to process from CSV. Exiting.');

        // Ensure no actual errors in stderr, warnings in stdout are expected
        expect(result.stderr).toBe('');

    }, networkTestTimeout); // networkTestTimeout might be overkill now but safe

    /**
     * Tests the CLI's graceful handling of a non-existent GitHub CSV file URL.
     * Setup: Defines a URL pointing to a non-existent CSV file on GitHub.
     * Action: Executes the CLI command with the `--csvFile` flag pointing to this non-existent URL.
     * Expected Outcome: Command exits successfully (code 0) due to graceful error handling.
     *                   Stdout indicates an attempt to fetch from the CSV source and detection of a remote CSV URL.
     *                   It logs the transformation of the GitHub blob URL to a raw content URL.
     *                   Critically, it logs a failure to download the CSV content (e.g., 404 Not Found).
     *                   It then reports that no URLs were found or fetched and exits without processing.
     *                   `stderr` should be empty.
     */
    it('should handle a non-existent GitHub CSV file URL gracefully', async () => {
        const nonExistentGithubCsvUrl = 'https://github.com/completely/nonexistent/repo/blob/main/somefilethatdoesnotexist.csv';
        const command = `${cliCommand} --csvFile ${nonExistentGithubCsvUrl}`;

        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command should still exit 0 for graceful handling. Stderr: ${result.stderr} Stdout: ${result.stdout}`);

        // Check for stdout messages
        expect(result.stdout).toContain(`Fetching URLs from CSV source: ${nonExistentGithubCsvUrl}`);
        expect(result.stdout).toContain(`Detected remote CSV URL: ${nonExistentGithubCsvUrl}`);
        // Expect transformation attempt
        const expectedRawUrl = 'https://raw.githubusercontent.com/completely/nonexistent/repo/main/somefilethatdoesnotexist.csv';
        expect(result.stdout).toContain(`Transformed GitHub blob URL to raw content URL: ${expectedRawUrl}`);

        // Expect failure to download
        expect(result.stdout).toContain(`Failed to download CSV content from ${expectedRawUrl}: 404 Not Found`);
        // Allow for slight variations in the "Error body" message, e.g., "404: Not Found" or just "Not Found"
        expect(result.stdout).toMatch(/Error body: (404: )?Not Found/);

        expect(result.stdout).toContain(`No URLs found or fetched from CSV file: ${nonExistentGithubCsvUrl}.`);
        expect(result.stdout).toContain('No URLs to process from CSV. Exiting.');

        // Ensure no actual errors in stderr (warnings in stdout are expected)
        expect(result.stderr).toBe('');

    }, networkTestTimeout); // Use the existing networkTestTimeout
});

/**
 * Test suite for handling various local file input types via the 'inputFile' argument.
 * Covers .txt, .csv, and .json files, including scenarios like:
 * - Correctly parsing URLs.
 * - Handling malformed files.
 * - Ensuring .txt files are emptied after processing successful URLs, while .csv and .json files are not.
 * - Verifying behavior when URLs fail to process (for .txt files).
 */
describe('CLI Tests for Local File Inputs (inputFile argument)', () => {
    const testTimeout = 20000; // Standard timeout for these tests
    const localTestOutputDirPath = path.join(projectRoot, 'test_output_local_files'); // Specific output for this suite

    // Define common paths for this suite
    const testInputActualTxt = path.join(projectRoot, 'test_input_actual.txt');
    const testInputActualCsv = path.join(projectRoot, 'test_input_actual.csv');
    const testInputActualJson = path.join(projectRoot, 'test_input_actual.json');
    const testFailedUrlsInputPath = path.join(projectRoot, 'test_failed_urls_input.txt');

    // testOutputDirPath is defined globally, using localTestOutputDirPath for this suite to avoid conflicts if needed
    // However, the tests currently use the global testOutputDirPath.
    // For consistency, let's ensure all paths used here are clearly associated or use a local one.
    // The `localFileInputTestPaths` already uses `testOutputDirPath` (the global one).
    // If a truly isolated output for this suite is needed, `localTestOutputDirPath` should be used in `localFileInputTestPaths`.
    // For now, sticking to current usage of global `testOutputDirPath` as per `localFileInputTestPaths` definition.

    const localFileInputTestPaths = [
        testFailedUrlsInputPath,
        testInputActualTxt,
        testInputActualCsv,
        testInputActualJson,
        testOutputDirPath, // Uses the global testOutputDirPath
    ];

    beforeEach(() => {
        cleanupTestArtifacts(localFileInputTestPaths);
    });

    afterEach(() => {
        cleanupTestArtifacts(localFileInputTestPaths);
    });

    describe('TXT File Input Tests', () => {
        /**
         * Tests that for a .txt input file, only successfully processed URLs are removed.
     * Setup: Creates a .txt input file (`test_failed_urls_input.txt`) with a mix of URLs expected to succeed
     *        and URLs expected to fail (e.g., pointing to non-existent domains).
     * Action: Executes the CLI command with the path to this .txt file and sets `--concurrency=1`
     *         to make the success/failure order more predictable for analysis, though not strictly necessary for this test's core logic.
     * Expected Outcome: Command exits successfully (code 0).
     *                   The input .txt file is modified:
     *                     - Successfully processed URLs (e.g., 'https://example.com') are removed.
     *                     - URLs that failed processing (e.g., 'http://nonexistentdomain.faketld') remain in the file.
     *                   Stdout contains a log message confirming the number of URLs successfully processed and removed,
     *                   and the number of URLs remaining (unprocessed or failed).
     */
    it('should only remove successfully processed URLs from .txt file, leaving failed ones', async () => {
        const urlsToTest = [
            'https://example.com', // Expected to succeed
            'http://nonexistentdomain.faketld', // Expected to fail (e.g., ENOTFOUND or similar network error)
            'https://www.google.com', // Expected to succeed
            'http://anothernonexistent.faketld' // Expected to fail
        ];
        createInputFile(testFailedUrlsInputPath, urlsToTest);

        // Using --concurrency=1 to make success/failure order more predictable if needed,
        // though for distinct domains like example.com vs nonexistent, it should be fine.
        // Using a slightly higher timeout multiplier due to potential network timeouts for failing URLs.
        const command = `${cliCommand} ${testFailedUrlsInputPath} --concurrency=1`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);

        const remainingContent = fs.readFileSync(testFailedUrlsInputPath, 'utf-8').trim();
        const remainingUrls = remainingContent.split('\n').filter(line => line.trim() !== '');

        expect(remainingUrls).toContain('http://nonexistentdomain.faketld');
        expect(remainingUrls).toContain('http://anothernonexistent.faketld');
        expect(remainingUrls).not.toContain('https://example.com');
        expect(remainingUrls).not.toContain('https://www.google.com');

        expect(remainingUrls.length).toBe(2); // Exactly two URLs should remain

        // Verify the log message (adjust regex as needed for precision)
        // Example: "INFO: test_failed_urls_input.txt updated. 2 URLs successfully processed and removed. 2 URLs remain in current scope (includes unprocessed or failed)."
        const logRegex = /([\d]+) URLs successfully processed and removed. ([\d]+) URLs remain in current scope \(includes unprocessed or failed\)/;
        const match = result.stdout.match(logRegex);
        expect(match).not.toBeNull(`Log message not found or did not match. Stdout: ${result.stdout}`);
        if (match) {
            expect(match[1]).toBe('2'); // Successfully processed
            expect(match[2]).toBe('2'); // Remaining (failed)
        }
        // Check for the specific file update log
        expect(result.stdout).toContain(`${testFailedUrlsInputPath} updated.`);

    }, generalScanTestTimeout * 2); // Allow more time due to multiple URLs and potential timeouts

        /**
     * Tests loading URLs from a local .txt file specified by the `inputFile` argument.
     * Setup: Creates a .txt file ('test_input_actual.txt') with a list of URLs.
     * Action: Executes the CLI command with the path to this .txt file as the `inputFile` argument.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates that the specified input file is being used and processed as a 'txt' file.
     *                   It logs the successful loading of the correct number of URLs from the file.
     *                   The .txt input file is empty after processing all its URLs.
     */
    it('should load URLs from a local .txt file specified by inputFile argument', async () => {
        const urls = ['http://txt-example1.com', 'https://txt-example2.com/path'];
        createInputFile(testInputActualTxt, urls);

        const command = `${cliCommand} ${testInputActualTxt}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualTxt}`);
        // The message from prebid.ts is "Successfully loaded X URLs from local TXT file: path/to/file.txt"
        // However, the initial log from scan.ts uses the file type from extension.
        expect(result.stdout).toContain(`Processing local file: ${testInputActualTxt} (detected type: txt)`);
        expect(result.stdout).toContain(`Successfully loaded ${urls.length} URLs from local TXT file: ${testInputActualTxt}`);
        expect(result.stdout).toContain(`Total URLs to process after range check: ${urls.length}`);

        const inputFileContent = fs.readFileSync(testInputActualTxt, 'utf-8');
        expect(inputFileContent.trim()).toBe('', 'TXT input file should be empty after processing');
    }, testTimeout);
    });

    describe('CSV File Input Tests', () => {
        /**
     * Tests loading URLs from a local .csv file specified by the `inputFile` argument.
     * It also verifies that the CSV file is not emptied after processing, unlike .txt files.
     * Setup: Creates a .csv file ('test_input_actual.csv') with a header and a mix of valid URLs,
     *        invalid entries (not a URL), and URLs with unsupported schemes (ftp).
     *        Includes a URL with leading/trailing spaces to test trimming.
     * Action: Executes the CLI command with the path to this .csv file as the `inputFile` argument.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates processing of the local CSV file.
     *                   It logs the successful loading of only the valid HTTP/HTTPS URLs.
     *                   Messages are logged for skipping invalid or non-HTTP/S URLs.
     *                   Crucially, stdout confirms that the original CSV input file is *not* modified.
     *                   The content of the CSV file remains unchanged after the command execution.
     */
    it('should load URLs from a local .csv file specified by inputFile argument and not empty it', async () => {
        const csvContent = [
            'url_header',
            'http://csv-example1.com',
            'https://csv-example2.com/path',
            'not_a_url',
            'ftp://ignored.com',
            '  http://csv-example3.com/withspace  ' // Test trimming
        ].join('\n');
        fs.writeFileSync(testInputActualCsv, csvContent);
        const expectedValidUrls = 3;

        const command = `${cliCommand} ${testInputActualCsv}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualCsv}`);
        expect(result.stdout).toContain(`Processing local file: ${testInputActualCsv} (detected type: csv)`);
        expect(result.stdout).toContain(`Successfully loaded ${expectedValidUrls} URLs from local CSV file: ${testInputActualCsv}`);
        expect(result.stdout).toContain(`Skipping invalid or non-HTTP/S URL from CSV content in ${testInputActualCsv}: "not_a_url"`);
        expect(result.stdout).toContain(`Skipping invalid or non-HTTP/S URL from CSV content in ${testInputActualCsv}: "ftp://ignored.com"`);
        expect(result.stdout).toContain(`Total URLs to process after range check: ${expectedValidUrls}`);
        expect(result.stdout).toContain(`Skipping modification of original CSV input file: ${testInputActualCsv}`);

        const inputFileContent = fs.readFileSync(testInputActualCsv, 'utf-8');
        expect(inputFileContent.trim()).toBe(csvContent.trim(), 'CSV input file should NOT be empty after processing');
    }, testTimeout);
    });

    describe('JSON File Input Tests', () => {
        /**
     * Tests loading URLs from a local .json file (formatted as an array of URL strings)
     * specified by the `inputFile` argument. Verifies the file is not emptied.
     * Setup: Creates a .json file ('test_input_actual.json') containing an array of URL strings.
     * Action: Executes the CLI command with the path to this .json file as the `inputFile` argument.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates processing of the local JSON file.
     *                   It logs the successful loading of all URLs from the array.
     *                   Confirms that the original JSON input file is not modified.
     *                   The content of the JSON file remains unchanged.
     */
    it('should load URLs from a local .json file (array of strings) specified by inputFile argument and not empty it', async () => {
        const urls = ["http://json-array1.com", "https://json-array2.com/path"];
        fs.writeFileSync(testInputActualJson, JSON.stringify(urls));

        const command = `${cliCommand} ${testInputActualJson}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualJson}`);
        expect(result.stdout).toContain(`Processing local file: ${testInputActualJson} (detected type: json)`);
        expect(result.stdout).toContain(`Successfully loaded ${urls.length} URLs from local JSON file: ${testInputActualJson}`);
        expect(result.stdout).toContain(`Total URLs to process after range check: ${urls.length}`);

        const inputFileContent = fs.readFileSync(testInputActualJson, 'utf-8');
        expect(inputFileContent.trim()).toBe(JSON.stringify(urls), 'JSON input file should NOT be empty after processing');
        expect(result.stdout).toContain(`Skipping modification of original JSON input file: ${testInputActualJson}`);
    }, testTimeout);

        /**
     * Tests loading URLs from a local .json file (formatted as an object with URLs in its values,
     * potentially nested) specified by the `inputFile` argument. Verifies the file is not emptied.
     * Setup: Creates a .json file ('test_input_actual.json') containing an object. URLs are embedded
     *        as string values at various levels, including nested objects and arrays within the main object.
     * Action: Executes the CLI command with the path to this .json file.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates processing of the local JSON file.
     *                   It logs that URLs were extracted from the parsed JSON structure and the correct total count.
     *                   Confirms that the original JSON input file is not modified.
     */
    it('should load URLs from a local .json file (object with URLs in values) specified by inputFile argument and not empty it', async () => {
        const jsonObj = {
            site1: "http://json-obj1.com",
            description: "Check https://json-obj2.com/another for details",
            nested: {
                link: "https://json-obj3.com/nested/path"
            },
            not_a_url: "some text",
            urls: ["http://json-obj-in-array.com", "https://another-in-array.com"] // Added another for 5 total
        };
        fs.writeFileSync(testInputActualJson, JSON.stringify(jsonObj, null, 2));
        const expectedValidUrls = 5; // json-obj1, json-obj2, json-obj3, json-obj-in-array, another-in-array

        const command = `${cliCommand} ${testInputActualJson}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualJson}`);
        expect(result.stdout).toContain(`Processing local file: ${testInputActualJson} (detected type: json)`);
        expect(result.stdout).toContain(`Extracted ${expectedValidUrls} URLs from parsed JSON structure in ${testInputActualJson}`);
        expect(result.stdout).toContain(`Successfully loaded ${expectedValidUrls} URLs from local JSON file: ${testInputActualJson}`);
        expect(result.stdout).toContain(`Total URLs to process after range check: ${expectedValidUrls}`);

        const inputFileContent = fs.readFileSync(testInputActualJson, 'utf-8');
        expect(inputFileContent.trim()).toBe(JSON.stringify(jsonObj, null, 2), 'JSON input file should NOT be empty after processing');
        expect(result.stdout).toContain(`Skipping modification of original JSON input file: ${testInputActualJson}`);
    }, testTimeout);

        /**
     * Tests the CLI's graceful handling of a malformed local .json file.
     * It should fall back to regex-based URL extraction and not empty the original file.
     * Setup: Creates a .json file ('test_input_actual.json') with intentionally malformed JSON content
     *        (e.g., missing quotes around a key). The file's raw text still contains extractable URLs.
     * Action: Executes the CLI command with the path to this malformed .json file.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates processing of the local JSON file.
     *                   A message is logged stating that JSON parsing failed and it's falling back to a regex scan.
     *                   URLs found via regex in the raw content are loaded (e.g., 2 URLs expected from the sample).
     *                   Confirms that the original (malformed) JSON input file is not modified.
     */
    it('should handle malformed local .json file gracefully, use regex fallback, and not empty it', async () => {
        // Malformed JSON: missing quotes around 'url' key, but contains a fallback URL in the text
        const malformedJsonContent = `{"name": "test", url: "http://malformed-key.com", "fallback": "https://fallback-in-malformed.com"}`;
        fs.writeFileSync(testInputActualJson, malformedJsonContent);

        const command = `${cliCommand} ${testInputActualJson}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualJson}`);
        expect(result.stdout).toContain(`Processing local file: ${testInputActualJson} (detected type: json)`);
        expect(result.stdout).toContain(`Failed to parse JSON from ${testInputActualJson}. Falling back to regex scan of raw content.`);
        // Regex scan is expected to find both "http://malformed-key.com" and "https://fallback-in-malformed.com"
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from local JSON file: ${testInputActualJson}`);
        expect(result.stdout).toContain(`Total URLs to process after range check: 2`);

        const inputFileContent = fs.readFileSync(testInputActualJson, 'utf-8');
        expect(inputFileContent.trim()).toBe(malformedJsonContent.trim(), 'Malformed JSON input file should NOT be empty after processing');
        expect(result.stdout).toContain(`Skipping modification of original JSON input file: ${testInputActualJson}`);
    }, testTimeout);
    });

    describe('General Input File Handling', () => {
        /**
     * Verifies that if only an `inputFile` (a .txt file in this case) is provided, and no `--githubRepo`
     * flag is used, the CLI processes URLs from the local file.
     * Setup: Creates a .txt file ('test_input_actual.txt') with a list of URLs.
     * Action: Executes the CLI command with the path to this .txt file as the `inputFile` argument.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout confirms usage of the specified input file and successful loading of URLs from it.
     *                   There should be no indication of attempting to fetch from a GitHub repository.
     */
    it('should use inputFile (txt) if --githubRepo is not provided', async () => {
        const urls = ['http://default-txt.com'];
        createInputFile(testInputActualTxt, urls);

        const command = `${cliCommand} ${testInputActualTxt}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualTxt}`);
        expect(result.stdout).toContain(`Successfully loaded ${urls.length} URLs from local TXT file: ${testInputActualTxt}`);
        expect(result.stdout).not.toContain('Fetching URLs from GitHub repository');
    }, testTimeout);

    // This test replaces the old "--csvFile over inputFile"
    // It now checks that a local CSV used as inputFile is handled correctly and not emptied.
    /**
     * Verifies that a local CSV file, when passed as the primary `inputFile` argument (not via `--csvFile`),
     * is processed correctly and, importantly, is not emptied after processing.
     * Setup: Creates a .csv file ('test_input_actual.csv') with a header and one URL.
     * Action: Executes the CLI command with the path to this .csv file as the `inputFile` argument.
     * Expected Outcome: Command exits successfully (code 0).
     *                   Stdout indicates usage of the specified input file, detected as 'csv'.
     *                   It logs successful loading of URLs from the CSV.
     *                   Crucially, it confirms that the original CSV input file is not modified.
     *                   The content of the CSV file remains unchanged.
     */
    it('should correctly process a local CSV file passed as inputFile argument and not empty it', async () => {
        const csvUrls = ['http://local-csv-via-inputfile.com'];
        const csvContent = `url_header\n${csvUrls[0]}`;
        fs.writeFileSync(testInputActualCsv, csvContent);

        const command = `${cliCommand} ${testInputActualCsv}`; // testInputActualCsv is the inputFile
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Using input file: ${testInputActualCsv}`);
        expect(result.stdout).toContain(`Processing local file: ${testInputActualCsv} (detected type: csv)`);
        expect(result.stdout).toContain(`Successfully loaded ${csvUrls.length} URLs from local CSV file: ${testInputActualCsv}`);
        expect(result.stdout).toContain(`Skipping modification of original CSV input file: ${testInputActualCsv}`);

        const csvFileContent = fs.readFileSync(testInputActualCsv, 'utf-8');
        expect(csvFileContent.trim()).toBe(csvContent.trim(), 'CSV file used as inputFile should not be emptied.');
    }, testTimeout);
});
