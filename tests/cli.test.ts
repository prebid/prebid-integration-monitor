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

// Helper to create a dummy input file
function createInputFile(filePath: string, urls: string[]): void {
    fs.writeFileSync(filePath, urls.join('\n'));
}

// Helper to remove files/directories
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

// Determine the project root directory, assuming tests are in <root>/tests/
const projectRoot = path.resolve(__dirname, '..');
const cliCommand = `node ${path.join(projectRoot, 'bin', 'run')} scan`; // Path to CLI

describe('CLI Tests for Scan Command', () => {
    const generalScanTestTimeout = 60000; // Standard timeout for tests involving Puppeteer
    const helpTestTimeout = 10000; // Shorter timeout for non-Puppeteer tests like --help

    const defaultInputFilePath = path.join(projectRoot, 'src', 'input.txt');
    const testInputFilePath = path.join(projectRoot, 'test_input_cli.txt');
    const testOutputDirPath = path.join(projectRoot, 'test_output_cli');
    const customInputPath = path.join(projectRoot, 'tests', 'custom_scan_input.txt');
    const dummyGithubInputFile = path.join(projectRoot, 'dummy_github_input.txt');
    const testCsvFilePath = path.join(projectRoot, 'test_input.csv'); // Added for CSV tests

    // Cleanup before and after all tests in this suite
    beforeAll(() => {
        cleanup(defaultInputFilePath);
        cleanup(testInputFilePath);
        cleanup(testOutputDirPath);
        cleanup(customInputPath);
        cleanup(dummyGithubInputFile);
        cleanup(testCsvFilePath); // Added for CSV tests
    });

    afterAll(() => {
        cleanup(defaultInputFilePath);
        cleanup(testInputFilePath);
        cleanup(testOutputDirPath);
        cleanup(customInputPath);
        cleanup(dummyGithubInputFile);
        cleanup(testCsvFilePath); // Added for CSV tests
    });

    // Cleanup before each test
    beforeEach(() => {
        cleanup(defaultInputFilePath);
        cleanup(testInputFilePath);
        cleanup(testOutputDirPath);
        cleanup(customInputPath);
        cleanup(dummyGithubInputFile);
        cleanup(testCsvFilePath); // Added for CSV tests
    });

    // Test Case 1
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

    // Test Case 2
    it('Command runs with puppeteerType=vanilla (using src/input.txt)', async () => {
        createInputFile(defaultInputFilePath, ['https://example.com']); // Will create src/input.txt
        const result = await executeCommand(`${cliCommand} --puppeteerType=vanilla`, projectRoot);

        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr}`);
        expect(result.stdout).toContain('"puppeteerType": "vanilla"');
        // Actual log message uses the relative path 'src/input.txt'
        expect(result.stdout).toContain(`Initial URLs read from src/input.txt count:`);
    }, generalScanTestTimeout);

    // Test Case 3
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

    // New Test Case: Scan with default input file (src/input.txt)
    it('Scan with default input file (src/input.txt)', async () => {
        createInputFile(defaultInputFilePath, ['https://default-test.example.com']); // Creates src/input.txt
        // Ensure no other input.txt in root to avoid confusion
        if (fs.existsSync(path.join(projectRoot, 'input.txt'))) {
            cleanup(path.join(projectRoot, 'input.txt'));
        }

        const result = await executeCommand(`${cliCommand}`, projectRoot); // No input file argument

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr}`);
        // Actual log message uses the relative path 'src/input.txt'
        expect(result.stdout).toContain(`Initial URLs read from src/input.txt count:`);

        const inputFileContent = fs.readFileSync(defaultInputFilePath, 'utf-8'); // Checks src/input.txt
        expect(inputFileContent.trim()).toBe('', 'Default input file (src/input.txt) should be empty after processing');
    }, generalScanTestTimeout);

    // New Test Case: Scan with custom input file overrides default
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

    // Test Case 4 (renumbered to 5)
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

describe('CLI Tests for GitHub Repository Input with Mocked API', () => {
    const testTimeout = 10000; // Shorter timeout as these are now unit-like tests
    const MOCK_REPO_URL = 'https://github.com/mockOwner/mockRepo.git';

    let fetchMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // Spy on global.fetch and save the mock object
        fetchMock = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        // Restore the original fetch function after each test
        vi.restoreAllMocks();
    });

    it('Scan using a valid GitHub repository URL (mocked)', async () => {
        fetchMock
            .mockResolvedValueOnce({ // First call: GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'file1.txt', type: 'file', download_url: 'https://example.com/file1.txt' },
                    { name: 'file2.md', type: 'file', download_url: 'https://example.com/file2.md' },
                    { name: 'image.png', type: 'file', download_url: 'https://example.com/image.png' }, // Should be ignored
                ]),
            } as Response)
            .mockResolvedValueOnce({ // Second call: download_url for file1.txt
                ok: true,
                text: async () => 'http://url1.com\nhttps://url2.com',
            } as Response)
            .mockResolvedValueOnce({ // Third call: download_url for file2.md
                ok: true,
                text: async () => 'Some markdown with http://url3.com',
            } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Successfully loaded 3 URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Total URLs to process: 3`);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/mockOwner/mockRepo/contents');
        expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/file1.txt');
        expect(fetchMock.mock.calls[2][0]).toBe('https://example.com/file2.md');
    }, testTimeout);

    it('Scan using --numUrls with a GitHub repository (mocked)', async () => {
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'file1.txt', type: 'file', download_url: 'https://example.com/file1.txt' },
                    { name: 'file2.md', type: 'file', download_url: 'https://example.com/file2.md' }, // This file won't be fetched due to numUrls
                ]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for file1.txt
                ok: true,
                text: async () => 'http://url1.com\nhttps://url2.com\nhttp://url3.com',
            } as Response);
            // file2.md's content fetch will not happen

        const numUrlsToFetch = 2;
        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL} --numUrls ${numUrlsToFetch}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Successfully loaded ${numUrlsToFetch} URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Total URLs to process: ${numUrlsToFetch}`);
        // Expect 1 call for contents, 1 call for file1.txt's content. file2.txt content fetch should be skipped.
        expect(fetchMock).toHaveBeenCalledTimes(2); 
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/mockOwner/mockRepo/contents');
        expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/file1.txt');
    }, testTimeout);

    it('Scan using a non-existent GitHub repository URL (mocked 404 for contents)', async () => {
        fetchMock.mockResolvedValueOnce({ // GitHub contents API
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: async () => ({ message: 'Not Found' }),
            text: async () => ('{"message":"Not Found"}')
        } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).not.toBe(0, `Command should have failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stderr).toContain(`Failed to fetch repository contents: 404 Not Found`);
        expect(result.stderr).toContain(`An error occurred during the Prebid scan`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/mockOwner/mockRepo/contents');
    }, testTimeout);
    
    it('Scan a GitHub repository that contains no relevant files (mocked)', async () => {
        fetchMock.mockResolvedValueOnce({ // GitHub contents API
            ok: true,
            json: async () => ([
                { name: 'image.png', type: 'file', download_url: 'https://example.com/image.png' },
                { name: 'script.js', type: 'file', download_url: 'https://example.com/script.js' },
            ]),
        } as Response);
        // No calls to download_url should be made

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);
        
        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository: ${MOCK_REPO_URL}`);
        // Note: The message "No URLs found or fetched" comes from prebid.ts, which is what we want to see
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain('No URLs to process. Exiting.');
        expect(fetchMock).toHaveBeenCalledTimes(1); // Only the contents API call
    }, testTimeout);

    it('Scan a GitHub repository with relevant files but no URLs in them (mocked)', async () => {
        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'empty.txt', type: 'file', download_url: 'https://example.com/empty.txt' },
                ]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for empty.txt
                ok: true,
                text: async () => 'This file has no URLs.',
            } as Response);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain('No URLs to process. Exiting.');
        expect(fetchMock).toHaveBeenCalledTimes(2); // Contents API + one file download
    }, testTimeout);


    it('Scan with both --githubRepo (mocked) and --inputFile provided (githubRepo takes precedence)', async () => {
        fetchMock.mockResolvedValueOnce({ // GitHub contents API
            ok: true,
            json: async () => ([
                { name: 'file1.txt', type: 'file', download_url: 'https://example.com/file1.txt' }
            ]),
        } as Response)
        .mockResolvedValueOnce({ // download_url for file1.txt
            ok: true,
            text: async () => 'http://mockedurl.com',
        } as Response);
        
        const dummyInputFilePath = path.join(projectRoot, 'dummy_gh_input.txt');
        createInputFile(dummyInputFilePath, ['http://local-file-url.com']);

        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL} --inputFile ${dummyInputFilePath}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Both --githubRepo and --inputFile (non-default) were provided. --inputFile will be ignored.`);
        expect(result.stdout).toContain(`Fetching URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Successfully loaded 1 URLs from GitHub repository: ${MOCK_REPO_URL}`);
        
        const inputFileContent = fs.readFileSync(dummyInputFilePath, 'utf-8');
        expect(inputFileContent.trim()).toBe('http://local-file-url.com'); // Should not be touched

        cleanup(dummyInputFilePath);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }, testTimeout);

    it('Scan without providing either --githubRepo or --inputFile fails (no mocks needed)', async () => {
        // Need to ensure no default 'src/input.txt' exists for this test
        const defaultInput = path.join(projectRoot, 'src', 'input.txt');
        if (fs.existsSync(defaultInput)) {
            fs.unlinkSync(defaultInput);
        }
        
        const command = `${cliCommand}`; // No input file or repo
        const result = await executeCommand(command, projectRoot);

        expect(result.code).not.toBe(0, `Command should have failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stderr).toContain('Either --githubRepo or --inputFile must be provided.');
    }, testTimeout);

    it('should handle a mix of valid, malformed, and schemeless URLs from mocked GitHub content', async () => {
        const mixedContent = `
            Valid URLs:
            http://valid-example.com
            https://another-valid.example.org/path

            Malformed and Schemeless:
            htp://malformed-scheme.com
            https://url with spaces.com
            ftp://unsupported-scheme.net
            http://
            schemeless.example.com
            another.schemeless.org

            Plain text:
            just some random text
            another line of text with example.com but not a URL.
        `;

        fetchMock
            .mockResolvedValueOnce({ // GitHub contents API
                ok: true,
                json: async () => ([
                    { name: 'mixed_urls.txt', type: 'file', download_url: 'https://example.com/mixed_urls.txt' },
                ]),
            } as Response)
            .mockResolvedValueOnce({ // download_url for mixed_urls.txt
                ok: true,
                text: async () => mixedContent,
            } as Response);

        // Use generous numUrls to ensure all valid ones are attempted if they were more numerous
        const command = `${cliCommand} --githubRepo ${MOCK_REPO_URL} --numUrls 10`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        
        // Verify that only the 2 valid URLs are reported as loaded
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from GitHub repository: ${MOCK_REPO_URL}`);
        expect(result.stdout).toContain(`Total URLs to process: 2`);

        // Check that the specific valid URLs were part of the options passed to prebidExplorer (logged)
        // This requires looking at the JSON.stringify(options, null, 2) output
        // Need to be careful if order is not guaranteed or if other URLs are processed by puppeteer.
        // For now, checking the count is the most robust.
        // A more advanced check might parse the logged options object if necessary.

        // Ensure no errors in stderr related to parsing, beyond the expected successful run.
        // If there were specific warnings for malformed lines, we'd check for them.
        // Currently, the regex simply doesn't match, so they are silently ignored.
        expect(result.stderr).toBe(''); // Or expect it not to contain specific error patterns

        expect(fetchMock).toHaveBeenCalledTimes(2); // 1 for contents, 1 for file download
    }, testTimeout);
});

describe('CLI Tests for CSV File Input', () => {
    const testTimeout = 10000; // Standard timeout for these tests
    let fetchMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchMock = vi.spyOn(global, 'fetch');
        // Cleanup testCsvFilePath before each test in this suite as well
        cleanup(testCsvFilePath);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        // Cleanup testCsvFilePath after each test in this suite
        cleanup(testCsvFilePath);
    });

    // Test Case 2: Mocked Remote CSV (Successful Fetch)
    it('should fetch and parse URLs from a mocked remote CSV file', async () => {
        const mockCsvContent = "url\nhttp://mockurl1.com\nhttps://mockurl2.com/path\nhttp://mockurl3.com";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => mockCsvContent,
        } as Response);

        const command = `${cliCommand} --csvFile https://example.com/remote.csv`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/remote.csv');
        expect(result.stdout).toContain(`Successfully loaded 3 URLs from CSV file: https://example.com/remote.csv`);
        expect(result.stdout).toContain(`Total URLs to process: 3`);
    }, testTimeout);

    // Test Case 3: Mocked Remote CSV (GitHub URL Transformation)
    it('should correctly transform GitHub blob URL and parse from mocked remote CSV', async () => {
        const mockCsvContent = "url\nhttp://ghmock1.com\nhttps://ghmock2.com";
        fetchMock.mockResolvedValueOnce({
            ok: true,
            text: async () => mockCsvContent,
        } as Response);
        
        const githubBlobUrl = 'https://github.com/testowner/testrepo/blob/main/data.csv';
        const expectedRawUrl = 'https://raw.githubusercontent.com/testowner/testrepo/main/data.csv';
        const command = `${cliCommand} --csvFile ${githubBlobUrl}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(fetchMock).toHaveBeenCalledWith(expectedRawUrl);
        expect(result.stdout).toContain(`Transformed GitHub blob URL to raw content URL: ${expectedRawUrl}`);
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from CSV file: ${githubBlobUrl}`);
        expect(result.stdout).toContain(`Total URLs to process: 2`);
    }, testTimeout);

    // Test Case 4: Mocked Remote CSV (Fetch Error)
    it('should handle fetch error for remote CSV gracefully', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: async () => 'File not found content',
        } as Response);

        const remoteCsvUrl = 'https://example.com/nonexistent.csv';
        const command = `${cliCommand} --csvFile ${remoteCsvUrl}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command should still exit 0. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Failed to download CSV content from ${remoteCsvUrl}: 404 Not Found`);
        expect(result.stdout).toContain(`Error body: File not found content`);
        expect(result.stdout).toContain(`No URLs found or fetched from CSV file: ${remoteCsvUrl}`);
        expect(result.stdout).toContain('No URLs to process. Exiting.');
    }, testTimeout);

    // Test Case 5: Local CSV (Successful Read)
    it('should read and parse URLs from a local CSV file', async () => {
        const localCsvContent = "header_url\nhttp://local1.com\nhttps://local2.com";
        fs.writeFileSync(testCsvFilePath, localCsvContent);

        const command = `${cliCommand} --csvFile ${testCsvFilePath}`;
        const result = await executeCommand(command, projectRoot);
        
        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Reading local CSV file: ${testCsvFilePath}`);
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from CSV file: ${testCsvFilePath}`);
        expect(result.stdout).toContain(`Total URLs to process: 2`);
    }, testTimeout);

    // Test Case 6: Local CSV (File Not Found)
    it('should handle file not found error for local CSV gracefully', async () => {
        const nonExistentFilePath = '/path/to/nonexistent/local.csv';
        const command = `${cliCommand} --csvFile ${nonExistentFilePath}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command should still exit 0. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        // Error message from fs.readFileSync will be like "Error processing CSV from /path/to/nonexistent/local.csv: ENOENT: no such file or directory..."
        expect(result.stdout).toContain(`Error processing CSV from ${nonExistentFilePath}: ENOENT: no such file or directory`);
        expect(result.stdout).toContain(`No URLs found or fetched from CSV file: ${nonExistentFilePath}`);
        expect(result.stdout).toContain('No URLs to process. Exiting.');
    }, testTimeout);
    
    // Test Case 7: Local CSV (Malformed CSV content)
    it('should handle malformed local CSV content', async () => {
        const malformedCsvContent = "url,name\nnot_a_url,name1\nhttp://validurl.com,name2\nschemaless.com,name3\n\nhttps://anothervalid.com";
        fs.writeFileSync(testCsvFilePath, malformedCsvContent);

        const command = `${cliCommand} --csvFile ${testCsvFilePath}`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Skipping invalid or non-HTTP/S URL from CSV: "not_a_url"`);
        expect(result.stdout).toContain(`Skipping invalid or non-HTTP/S URL from CSV: "schemaless.com"`);
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from CSV file: ${testCsvFilePath}`);
        expect(result.stdout).toContain(`Total URLs to process: 2`); // http://validurl.com, https://anothervalid.com
    }, testTimeout);

    // Test Case 8: Flag Precedence (--csv-file vs --inputFile)
    it('should prioritize --csv-file over --inputFile', async () => {
        const csvContent = "url\nhttp://csv-url1.com\nhttp://csv-url2.com";
        fs.writeFileSync(testCsvFilePath, csvContent);

        const testInputFilePathForPrecedence = path.join(projectRoot, 'test_input_precedence.txt');
        createInputFile(testInputFilePathForPrecedence, ['http://textfile-url1.com', 'http://textfile-url2.com', 'http://textfile-url3.com']);

        const command = `${cliCommand} --csvFile ${testCsvFilePath} ${testInputFilePathForPrecedence}`;
        const result = await executeCommand(command, projectRoot);
        
        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`--csvFile provided, inputFile argument will be ignored.`);
        expect(result.stdout).toContain(`Successfully loaded 2 URLs from CSV file: ${testCsvFilePath}`);
        expect(result.stdout).toContain(`Total URLs to process: 2`);

        const textFileContent = fs.readFileSync(testInputFilePathForPrecedence, 'utf-8');
        expect(textFileContent.trim()).toBe('http://textfile-url1.com\nhttp://textfile-url2.com\nhttp://textfile-url3.com'); // Should be unchanged

        cleanup(testInputFilePathForPrecedence);
    }, testTimeout);

    // Test Case 9: Flag Precedence (--csv-file vs --githubRepo)
    it('should prioritize --csv-file over --githubRepo', async () => {
        const csvContent = "url\nhttp://csv-for-gh.com";
        fs.writeFileSync(testCsvFilePath, csvContent); // Using a local CSV for simplicity, could also mock remote

        // Mock fetch for the GitHub repo call that should NOT happen if CSV is prioritized
        fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
            if (url.toString().includes('api.github.com')) {
                return { // Mock a successful GitHub API response
                    ok: true, json: async () => ([{ name: 'gh_file.txt', type: 'file', download_url: 'https://example.com/gh_file.txt' }]),
                } as Response;
            }
            if (url.toString().includes('example.com/gh_file.txt')) {
                 return { ok: true, text: async () => 'http://github-url.com' } as Response;
            }
            // Fallback for any other unexpected fetch
            return { ok: false, status: 404, text: async () => 'Unexpected fetch call' } as Response;
        });

        const command = `${cliCommand} --csvFile ${testCsvFilePath} --githubRepo https://example.com/gh-repo`;
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`--csvFile provided, --githubRepo will be ignored.`);
        expect(result.stdout).toContain(`Successfully loaded 1 URLs from CSV file: ${testCsvFilePath}`);
        expect(result.stdout).toContain(`Total URLs to process: 1`);

        // Ensure fetch was NOT called for the GitHub repo
        expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('api.github.com/repos/example/gh-repo'));
        // If testCsvFilePath was remote and mocked, fetchMock would be called for it. Since it's local, fetchMock isn't called at all.
        // If we wanted to test a remote CSV here, we'd mock its fetch and expect that call.
        // For this test, proving githubRepo fetch didn't happen is key.
        if (testCsvFilePath.startsWith('http')) { // If we were testing a remote CSV
            expect(fetchMock).toHaveBeenCalledWith(testCsvFilePath);
        } else { // For local CSV
            expect(fetchMock).toHaveBeenCalledTimes(0); // No remote calls should be made
        }
    }, testTimeout);

    // Test Case 10: Error if no input is provided (re-check existing behavior with csvFile flag)
    it('should error if no input file, csv-file, or githubRepo is provided', async () => {
        const defaultInput = path.join(projectRoot, 'src', 'input.txt');
        if (fs.existsSync(defaultInput)) {
            // To ensure the test is valid, remove or empty the default input file
            // For this test, we want to simulate the user providing no input arguments at all.
            // Oclif's default argument handling for `inputFile` means `src/input.txt` will be assumed
            // if no other input is given. The command's internal logic then checks if this default
            // file exists and is non-empty, or if other flags were set.
            // The error "No input source specified..." comes from scan.ts if all checks fail.
            fs.unlinkSync(defaultInput); 
        }
        
        const command = `${cliCommand}`; // No args
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(1, `Command should have failed. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        // Message from scan.ts based on the new logic
        expect(result.stderr).toContain('No input source specified. Please provide --csvFile, --githubRepo, or an inputFile argument.');
    }, testTimeout);
});

describe('CLI Tests for Live GitHub Repository Input (Network)', () => {
    // IMPORTANT:
    // The tests in this suite interact with actual, live GitHub repositories
    // and require an active internet connection.
    // They are subject to network flakiness, API rate limits (though unlikely for
    // the small number of tests), and changes in the target repositories' content.
    // These tests should be run judiciously, perhaps less frequently than mocked tests,
    // or in specific environments prepared for network-dependent integration tests.

    const networkTestTimeout = 90000; // Longer timeout for actual network requests

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
        expect(result.stdout).toContain(`Extracted 0 URLs from https://raw.githubusercontent.com/zer0h/top-1000000-domains/master/top-10000-domains`);
        expect(result.stdout).toContain(`Total URLs extracted before limiting: 0`);
        expect(result.stdout).toContain(`No URLs found or fetched from GitHub repository: ${githubFileUrl}.`);
        expect(result.stdout).toContain('No URLs to process. Exiting.');

    }, networkTestTimeout);
});

// Separate describe block for live CSV tests if preferred, or could be part of the above
describe('CLI Tests for Live CSV File Input (Network)', () => {
    const networkTestTimeout = 90000; // Longer timeout for actual network requests
    let fetchMock: ReturnType<typeof vi.spyOn>; // To ensure no accidental mocking if other tests didn't clean up

    beforeEach(() => {
        // Ensure fetch is NOT mocked for these live tests
        // This is a safeguard; fetch should ideally be restored by other suites.
        // If vi.restoreAllMocks() is consistently used, this might not be strictly necessary
        // but helps ensure test isolation if restoring was missed.
        if (vi.isMockFunction(global.fetch)) {
            vi.restoreAllMocks(); 
        }
        // Re-spy if needed by other types of tests, but for live, we want original fetch.
        // This setup assumes this suite ONLY runs live tests. If mixed, more care is needed.
    });

    afterEach(() => {
        // If we spied on fetch for some reason within this suite (e.g. conditional mocking), restore.
        // Generally, for a purely live suite, this might not do anything if fetch wasn't re-mocked.
        // vi.restoreAllMocks(); 
    });

    // Test Case 1: Live Network Test for Remote CSV (GitHub URL)
    it('should successfully scan a small number of URLs from a live GitHub CSV file URL', async () => {
        const liveCsvUrl = 'https://github.com/privacy-tech-lab/gpc-web-crawler/blob/main/selenium-optmeowt-crawler/full-crawl-set.csv';
        // numUrls is not directly used by fetchUrlsFromCsv, but prebidExplorer's main loop might eventually use it
        // For now, the CSV loader will fetch all URLs. The main processor then takes over.
        // Let's not use --numUrls for this CSV test to see how many it loads by default from the first few.
        // The test will primarily check if the fetching and initial processing work.
        // We'll limit the actual processing in prebidExplorer implicitly by only checking a few URLs in output.
        const command = `${cliCommand} --csvFile ${liveCsvUrl}`; // Removed --numUrls 3 for now
        
        const result = await executeCommand(command, projectRoot);

        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr} Stdout: ${result.stdout}`);
        expect(result.stdout).toContain(`Fetching URLs from CSV source: ${liveCsvUrl}`);
        expect(result.stdout).toContain(`Detected remote CSV URL: ${liveCsvUrl}`);
        expect(result.stdout).toContain(`Transformed GitHub blob URL to raw content URL: https://raw.githubusercontent.com/privacy-tech-lab/gpc-web-crawler/main/selenium-optmeowt-crawler/full-crawl-set.csv`);
        
        // Check that a positive number of URLs were loaded. The exact number can change.
        // This file has a header, "sites". The first actual URL is on the second line.
        // Example URLs: http://100widgets.com, http://123open.com
        const loadedMatch = result.stdout.match(/Successfully loaded (\d+) URLs from CSV file/);
        expect(loadedMatch).not.toBeNull();
        const numLoaded = parseInt(loadedMatch![1], 10);
        expect(numLoaded).toBeGreaterThan(0);

        const processedMatch = result.stdout.match(/Total URLs to process: (\d+)/);
        expect(processedMatch).not.toBeNull();
        const numProcessed = parseInt(processedMatch![1], 10);
        expect(numProcessed).toEqual(numLoaded); // All loaded URLs should be processed initially

        // Check if some known initial URLs (after header) are logged as being processed (if Puppeteer part runs)
        // This depends on how many URLs are actually processed by Puppeteer in the test.
        // For now, confirming loading is the primary goal.
        // Example: if 'http://100widgets.com' is processed, it would appear in logs.
        // This might be too brittle if the live file changes often at the very top.
        // Let's focus on the loading messages.

        // Ensure no obvious error messages in stderr
        expect(result.stderr).toBe('');

    }, networkTestTimeout);
});
