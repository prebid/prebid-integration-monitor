import { expect, test, vi, describe, beforeEach, afterEach } from 'vitest';
import Inspect from '../src/commands/inspect'; // Adjust path as needed
import { mkdir, readFile, rm, readdir } from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';
import { Config } from '@oclif/core';
import { PJSON, Plugin } from '@oclif/core/interfaces';

// Mock node-fetch (global, as it was before)
vi.mock('node-fetch', async () => {
  const actualFetch = await vi.importActual('node-fetch');
  return {
    ...actualFetch,
    default: vi.fn(),
  };
});

const MOCKED_URL = 'http://example.com/test-page';
const MOCKED_RESPONSE_BODY = '<html><body><h1>Test Page</h1></body></html>';
const MOCKED_OUTPUT_DIR = 'test-inspect-output';

describe('Inspect Command', () => {
  let testConfigInstance: Config;

  beforeEach(async () => {
    // Create a temporary output directory for tests
    // Note: If tests run in parallel, this shared directory might cause issues.
    // For now, assuming serial execution or tests that don't conflict in this dir.
    await mkdir(MOCKED_OUTPUT_DIR, { recursive: true });

    // Reset all mocks (including global ones like fetch if needed, and instance methods)
    vi.resetAllMocks();

    // Setup mock for fetch (re-apply after resetAllMocks)
    (fetch as vi.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/html']]),
      text: async () => MOCKED_RESPONSE_BODY,
      json: async () => JSON.parse(MOCKED_RESPONSE_BODY),
    });

    // Create and configure the test Config instance
    // Using process.cwd() for root, adjust if a different mock path is more appropriate
    testConfigInstance = new Config({ root: process.cwd() });

    testConfigInstance.version = '1.2.3';
    testConfigInstance.bin = 'mytestcli';
    // Mock functions on the config instance
    testConfigInstance.warn = vi.fn();
    testConfigInstance.error = vi.fn();
    testConfigInstance.exit = vi.fn();
    testConfigInstance.log = vi.fn();
    testConfigInstance.logToStderr = vi.fn();
    testConfigInstance.findCommand = vi.fn();
    testConfigInstance.findMatches = vi.fn();
    testConfigInstance.scopedEnvVar = vi.fn();
    testConfigInstance.scopedEnvVarKey = vi.fn();
    testConfigInstance.scopedEnvVarTrue = vi.fn();

    // Mock runHook on this instance
    testConfigInstance.runHook = vi
      .fn()
      .mockImplementation(async (event, opts) => {
        // console.log(`runHook called on instance: event ${event}, opts:`, opts); // For debugging
        return {
          successes: [
            {
              plugin: { root: 'mockRoot', name: 'mockPlugin' },
              result: opts?.argv ?? [],
            },
          ],
          failures: [],
        };
      });

    // Mock pjson
    testConfigInstance.pjson = {
      name: 'test-cli-pjson', // Added name
      version: '1.2.3',
      oclif: {
        hooks: {},
      },
    } as PJSON;

    // Add other minimal essential properties if oclif's Config constructor doesn't set them
    if (!testConfigInstance.plugins) {
      testConfigInstance.plugins = new Map<string, Plugin>();
    }
    if (!testConfigInstance.commandIDs) {
      testConfigInstance.commandIDs = [];
    }
  });

  afterEach(async () => {
    // Clean up the temporary output directory
    await rm(MOCKED_OUTPUT_DIR, { recursive: true, force: true });
  });

  test('should fetch data and save as JSON by default', async () => {
    const argv = [MOCKED_URL, '--output-dir', MOCKED_OUTPUT_DIR];
    const inspectCommand = new Inspect(argv, testConfigInstance as Config);
    await inspectCommand.run();

    expect(fetch).toHaveBeenCalledWith(MOCKED_URL);
    const files = await readdir(MOCKED_OUTPUT_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/example.com.*.json$/);
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
    const inspectCommand = new Inspect(argv, testConfigInstance as Config);
    await inspectCommand.run();

    const expectedFilePath = path.join(
      MOCKED_OUTPUT_DIR,
      `${customFilename}.json`
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
    const inspectCommand = new Inspect(argv, testConfigInstance as Config);
    await inspectCommand.run();

    const files = await readdir(MOCKED_OUTPUT_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/example.com.*.har$/);
    const filePath = path.join(MOCKED_OUTPUT_DIR, files[0]);
    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content.log.creator.name).toBe(
      'prebid-integration-monitor/inspect-command'
    );
    // Version will be from the testConfigInstance.version
    expect(content.log.creator.version).toBe(testConfigInstance.version);
    expect(content.log.entries.length).toBe(1);
    expect(content.log.entries[0].request.url).toBe(MOCKED_URL);
    // ... (rest of HAR assertions)
  });

  test('should handle fetch error gracefully', async () => {
    (fetch as vi.Mock).mockRejectedValueOnce(new Error('Network Error'));
    const argv = [MOCKED_URL, '--output-dir', MOCKED_OUTPUT_DIR];
    const inspectCommand = new Inspect(argv, testConfigInstance as Config);
    await expect(inspectCommand.run()).rejects.toThrow(/Network Error/);
    const files = await readdir(MOCKED_OUTPUT_DIR);
    expect(files.length).toBe(0);
  });

  test('should use custom output directory', async () => {
    const customOutputDir = 'custom-test-output';
    await mkdir(customOutputDir, { recursive: true });
    const argv = [MOCKED_URL, '--output-dir', customOutputDir];
    const inspectCommand = new Inspect(argv, testConfigInstance as Config);
    await inspectCommand.run();
    const files = await readdir(customOutputDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/example.com.*.json$/);
    await rm(customOutputDir, { recursive: true, force: true });
  });
});
