import { expect, test, vi, describe, beforeEach, afterEach } from 'vitest';
import Inspect from '../src/commands/inspect'; // Adjust path as needed
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';

// Mock node-fetch
vi.mock('node-fetch', async () => {
  const actualFetch = await vi.importActual('node-fetch');
  return {
    ...actualFetch,
    default: vi.fn(),
  };
});

// Mock oclif's config for version access
const mockConfig = {
  version: '1.2.3',
  runHook: vi.fn(),
  findCommand: vi.fn(),
  findMatches: vi.fn(),
  scopedEnvVar: vi.fn(),
  scopedEnvVarKey: vi.fn(),
  scopedEnvVarTrue: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
  log: vi.fn(),
  logToStderr: vi.fn(),
  // Add other properties/methods if Inspect command uses them and causes errors
};

const MOCKED_URL = 'http://example.com/test-page';
const MOCKED_RESPONSE_BODY = '<html><body><h1>Test Page</h1></body></html>';
const MOCKED_OUTPUT_DIR = 'test-inspect-output';

describe('Inspect Command', () => {
  beforeEach(async () => {
    // Create a temporary output directory for tests
    await mkdir(MOCKED_OUTPUT_DIR, { recursive: true });
    // Reset mocks before each test
    vi.resetAllMocks();

    // Setup mock for fetch
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/html']]),
      text: async () => MOCKED_RESPONSE_BODY,
      json: async () => JSON.parse(MOCKED_RESPONSE_BODY), // if response is JSON
    });
  });

  afterEach(async () => {
    // Clean up the temporary output directory
    await rm(MOCKED_OUTPUT_DIR, { recursive: true, force: true });
  });

  test('should fetch data and save as JSON by default', async () => {
    const argv = [MOCKED_URL, '--output-dir', MOCKED_OUTPUT_DIR];
    const inspectCommand = new Inspect(argv, mockConfig as any);
    await inspectCommand.run();

    // Verify fetch was called
    expect(fetch).toHaveBeenCalledWith(MOCKED_URL);

    // Verify file was created (name will be auto-generated)
    const files = await require('fs').promises.readdir(MOCKED_OUTPUT_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/example.com.*.json$/);

    // Verify content of the file
    const filePath = path.join(MOCKED_OUTPUT_DIR, files[0]);
    const content = JSON.parse(await readFile(filePath, 'utf-8'));

    expect(content.request.url).toBe(MOCKED_URL);
    expect(content.response.status).toBe(200);
    expect(content.response.body).toBe(MOCKED_RESPONSE_BODY);
    expect(content.response.headers['content-type']).toBe('text/html');
  });

  test('should use custom filename when provided', async () => {
    const customFilename = 'my-custom-inspection';
    const argv = [
      MOCKED_URL,
      '--output-dir',
      MOCKED_OUTPUT_DIR,
      '--filename',
      customFilename,
    ];
    const inspectCommand = new Inspect(argv, mockConfig as any);
    await inspectCommand.run();

    const expectedFilePath = path.join(
      MOCKED_OUTPUT_DIR,
      `${customFilename}.json`,
    );
    const content = JSON.parse(await readFile(expectedFilePath, 'utf-8'));
    expect(content.request.url).toBe(MOCKED_URL);
  });

  test('should save as basic HAR format when specified', async () => {
    const argv = [
      MOCKED_URL,
      '--output-dir',
      MOCKED_OUTPUT_DIR,
      '--format',
      'har',
    ];
    const inspectCommand = new Inspect(argv, mockConfig as any);
    await inspectCommand.run();

    const files = await require('fs').promises.readdir(MOCKED_OUTPUT_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/example.com.*.har$/);

    const filePath = path.join(MOCKED_OUTPUT_DIR, files[0]);
    const content = JSON.parse(await readFile(filePath, 'utf-8'));

    expect(content.log.creator.name).toBe(
      'prebid-integration-monitor/inspect-command',
    );
    expect(content.log.entries.length).toBe(1);
    expect(content.log.entries[0].request.url).toBe(MOCKED_URL);
    expect(content.log.entries[0].response.status).toBe(200);
    expect(content.log.entries[0].response.content.text).toBe(
      MOCKED_RESPONSE_BODY,
    );
  });

  test('should handle fetch error gracefully', async () => {
    (fetch as any).mockRejectedValueOnce(new Error('Network Error'));

    const argv = [MOCKED_URL, '--output-dir', MOCKED_OUTPUT_DIR];
    const inspectCommand = new Inspect(argv, mockConfig as any);

    // Oclif's this.error() throws an error, so we catch it
    await expect(inspectCommand.run()).rejects.toThrow(/Network Error/);

    // Ensure no file was created
    const files = await require('fs').promises.readdir(MOCKED_OUTPUT_DIR);
    expect(files.length).toBe(0);
  });

  test('should use custom output directory', async () => {
    const customOutputDir = 'custom-test-output';
    await mkdir(customOutputDir, { recursive: true });

    const argv = [MOCKED_URL, '--output-dir', customOutputDir];
    const inspectCommand = new Inspect(argv, mockConfig as any);
    await inspectCommand.run();

    const files = await require('fs').promises.readdir(customOutputDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/example.com.*.json$/);

    await rm(customOutputDir, { recursive: true, force: true });
  });
});
