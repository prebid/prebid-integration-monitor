import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
// import { expect } from 'chai'; // Remove Chai import
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

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
    const defaultInputFilePath = path.join(projectRoot, 'src', 'input.txt'); // Changed path
    const testInputFilePath = path.join(projectRoot, 'test_input_cli.txt');
    const testOutputDirPath = path.join(projectRoot, 'test_output_cli');
    const customInputPath = path.join(projectRoot, 'tests', 'custom_scan_input.txt'); // For new test

    // Helper to create a dummy input file, ensuring directory exists
    function createInputFile(filePath: string, urls: string[]): void {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, urls.join('\n'));
    }

    // Cleanup before and after all tests in this suite
    beforeAll(() => {
        cleanup(defaultInputFilePath);
        cleanup(testInputFilePath);
        cleanup(testOutputDirPath);
        cleanup(customInputPath); // Added customInputPath
    });

    afterAll(() => {
        cleanup(defaultInputFilePath);
        cleanup(testInputFilePath);
        cleanup(testOutputDirPath);
        cleanup(customInputPath); // Added customInputPath
    });

    // Cleanup before each test
    beforeEach(() => {
        cleanup(defaultInputFilePath); // Ensure clean state for default input file
        cleanup(testInputFilePath);
        cleanup(testOutputDirPath);
        cleanup(customInputPath); // Added customInputPath
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
    }, 60000); // 60s timeout

    // Test Case 2
    it('Command runs with puppeteerType=vanilla (using src/input.txt)', async () => {
        createInputFile(defaultInputFilePath, ['https://example.com']); // Will create src/input.txt
        const result = await executeCommand(`${cliCommand} --puppeteerType=vanilla`, projectRoot);

        expect(result.code).toBe(0, `Command failed with code ${result.code}. Stderr: ${result.stderr}`);
        expect(result.stdout).toContain('"puppeteerType": "vanilla"');
        // Actual log message uses the relative path 'src/input.txt'
        expect(result.stdout).toContain(`Initial URLs read from src/input.txt count:`);
    }, 60000); // 60s timeout

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
    }, 60000); // 60s timeout

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
    }, 60000);

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

    }, 60000);

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
    }, 60000); // 60s timeout
});
