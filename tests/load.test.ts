import { expect, test, describe, beforeEach, vi } from 'vitest'; // Removed afterEach
import * as path from 'path';
import * as fs from 'fs-extra';
import { format as utilFormat } from 'util'; // Import format from util
import Load from '../src/commands/load'; // Import the command class
import { Config } from '@oclif/core';
import { PJSON, Plugin } from '@oclif/core/interfaces';
import fetch from 'node-fetch'; // Used by the command, ensure it's mockable

const { Response } =
  await vi.importActual<typeof import('node-fetch')>('node-fetch');

// Mock node-fetch
vi.mock('node-fetch', async () => {
  const actualFetch = await vi.importActual('node-fetch');
  return {
    ...actualFetch,
    default: vi.fn(), // This will be the default export mock
    Response: actualFetch.Response, // Ensure Response constructor is available
  };
});

const fixturesDir = path.join(__dirname, 'fixtures');
const testTxtFile = path.join(fixturesDir, 'test-urls.txt');
const testCsvFile = path.join(fixturesDir, 'test-urls.csv');
const testJsonFile = path.join(fixturesDir, 'test-urls.json');

describe('load command', () => {
  let testConfigInstance: Config;
  let capturedStdout: string[] = [];
  let capturedStderr: string[] = [];

  beforeEach(async () => {
    fs.ensureDirSync(fixturesDir);
    fs.writeFileSync(
      testTxtFile,
      'http://example.com/page1\nhttps://example.org/page2\nexample.net/page3'
    );
    fs.writeFileSync(
      testCsvFile,
      'url,description\nhttp://example.com/csv1,Page 1 from CSV\nhttps://example.org/csv2,Page 2 from CSV'
    );
    fs.writeFileSync(
      testJsonFile,
      '{"site1": "http://example.com/json1", "details": {"url": "https://example.org/json2"}, "links": ["http://example.net/json3"]}'
    );

    vi.resetAllMocks();

    (fetch as vi.Mock).mockResolvedValue(
      new Response('Default mock response', { status: 200 })
    );

    testConfigInstance = new Config({ root: process.cwd() });
    testConfigInstance.version = '1.2.3';
    testConfigInstance.bin = 'mytestcli';

    capturedStdout = [];
    capturedStderr = [];

    // Mock config.stdout and config.stderr directly
    testConfigInstance.stdout = {
      write: vi.fn((chunk: any) => {
        capturedStdout.push(chunk.toString());
        return true;
      }),
    } as any;
    testConfigInstance.stderr = {
      write: vi.fn((chunk: any) => {
        capturedStderr.push(chunk.toString());
        return true;
      }),
    } as any;

    testConfigInstance.error = vi.fn(
      (
        input: string | Error,
        options?: { code?: string; exit?: number | false }
      ) => {
        const message = typeof input === 'string' ? input : input.message;
        // Ensure error messages also go to our captured stderr
        testConfigInstance.stderr.write(message + '\n');
        if (options?.exit !== false) {
          const err = new Error(message) as any;
          err.oclif = { exit: options?.exit ?? 1 };
          throw err;
        }
      }
    );
    // this.log calls config.stdout.write, this.warn and this.error call config.stderr.write (via config.warn/error)
    // No need to mock config.log/warn as they should use the mocked stdout/stderr if called by command.
    // However, oclif's Command.warn/error also use util.format and might have prefixes.
    // For simplicity, we'll rely on this.error being caught and this.log writing to config.stdout.
    testConfigInstance.log = vi.fn(
      (message?: string | undefined, ...args: any[]) => {
        const formattedMessage = message ? utilFormat(message, ...args) : '';
        testConfigInstance.stdout.write(formattedMessage + '\n');
      }
    );
    testConfigInstance.warn = vi.fn((input: string | Error) => {
      const message = typeof input === 'string' ? input : input.message;
      testConfigInstance.stderr.write(`WARNING: ${message}\n`);
    });

    testConfigInstance.exit = vi.fn((code?: number) => {
      const err = new Error(`Process exited with code ${code}`) as any;
      err.oclif = { exit: code ?? 0 };
      throw err;
    });

    testConfigInstance.runHook = vi
      .fn()
      .mockImplementation(async (event, opts) => {
        return {
          successes: [
            {
              plugin: { root: 'mockRoot', name: 'mockPlugin' } as Plugin,
              result: opts?.argv ?? [],
            },
          ],
          failures: [],
        };
      });
    testConfigInstance.pjson = {
      name: 'test-cli-pjson',
      version: '1.2.3',
      oclif: { hooks: {} },
    } as PJSON;
    if (!testConfigInstance.plugins)
      testConfigInstance.plugins = new Map<string, Plugin>();
    if (!testConfigInstance.commandIDs) testConfigInstance.commandIDs = [];
  });

  test('loads URLs from a TXT file', async () => {
    const argv = [testTxtFile];
    const command = new Load(argv, testConfigInstance);
    await command.run();

    const output = capturedStdout.join('');
    expect(output).toContain('Loaded 3 URLs:');
    expect(output).toContain('http://example.com/page1');
    expect(output).toContain('https://example.org/page2');
    expect(output).toContain('https://example.net/page3');
  });

  test('loads URLs from a CSV file', async () => {
    const argv = [testCsvFile];
    const command = new Load(argv, testConfigInstance);
    await command.run();

    const output = capturedStdout.join('');
    expect(output).toContain('Loaded 2 URLs:');
    expect(output).toContain('http://example.com/csv1');
    expect(output).toContain('https://example.org/csv2');
  });

  test('loads URLs from a JSON file', async () => {
    const argv = [testJsonFile];
    const command = new Load(argv, testConfigInstance);
    await command.run();

    const output = capturedStdout.join('');
    expect(output).toContain('Loaded 3 URLs:');
    expect(output).toContain('http://example.com/json1');
    expect(output).toContain('https://example.org/json2');
    expect(output).toContain('http://example.net/json3');
  });

  test('loads a limited number of URLs from a TXT file using --numUrls', async () => {
    const argv = [testTxtFile, '--numUrls', '1'];
    const command = new Load(argv, testConfigInstance);
    await command.run();

    const output = capturedStdout.join('');
    expect(output).toContain('Loaded 1 URLs:');
    expect(output).toContain('http://example.com/page1');
    expect(output).not.toContain('https://example.org/page2');
  });

  test('errors when no input file or GitHub repo is specified', async () => {
    const argv: string[] = [];
    const command = new Load(argv, testConfigInstance);
    await expect(command.run()).rejects.toThrow(/No input source specified/);
    const errorOutput = capturedStderr.join('');
    expect(errorOutput).toContain('No input source specified.');
    expect(testConfigInstance.error).toHaveBeenCalled();
  });

  test('errors when a non-existent input file is specified', async () => {
    const argv = ['nonexistentfile.txt'];
    const command = new Load(argv, testConfigInstance);
    await expect(command.run()).rejects.toThrow(
      /Failed to read input file: nonexistentfile.txt/
    );
    const errorOutput = capturedStderr.join('');
    expect(errorOutput).toContain(
      'Failed to read input file: nonexistentfile.txt'
    );
    expect(testConfigInstance.error).toHaveBeenCalled();
  });

  const mockGithubFileUrl =
    'https://github.com/testowner/testrepo/blob/main/urls.txt';
  const mockRawGithubUrl =
    'https://raw.githubusercontent.com/testowner/testrepo/main/urls.txt';
  const mockGithubContent =
    'http://git.example.com/page1\nhttps://git.example.org/page2';

  test('loads URLs from a GitHub file URL', async () => {
    (fetch as vi.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      if (url.toString() === mockRawGithubUrl) {
        return new Response(mockGithubContent, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const argv = ['--githubRepo', mockGithubFileUrl];
    const command = new Load(argv, testConfigInstance);
    await command.run();

    const output = capturedStdout.join('');
    expect(output).toContain('Loaded 2 URLs:');
    expect(output).toContain('http://git.example.com/page1');
    expect(output).toContain('https://git.example.org/page2');
  });

  test('loads limited URLs from a GitHub file URL with --numUrls', async () => {
    (fetch as vi.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      if (url.toString() === mockRawGithubUrl) {
        return new Response(mockGithubContent, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const argv = ['--githubRepo', mockGithubFileUrl, '--numUrls', '1'];
    const command = new Load(argv, testConfigInstance);
    await command.run();

    const output = capturedStdout.join('');
    expect(output).toContain('Loaded 1 URLs:');
    expect(output).toContain('http://git.example.com/page1');
    expect(output).not.toContain('https://git.example.org/page2');
  });

  test('errors when GitHub URL is invalid or file not found', async () => {
    (fetch as vi.Mock).mockResolvedValue(
      new Response('Not Found', { status: 404 })
    );

    const argv = [
      '--githubRepo',
      'https://github.com/invalidowner/invalidrepo/blob/main/urls.txt',
    ];
    const command = new Load(argv, testConfigInstance);

    await expect(command.run()).rejects.toThrow(
      /No URLs found from the specified GitHub repository/
    );
    const errorOutput = capturedStderr.join('');
    expect(errorOutput).toContain(
      'No URLs found from the specified GitHub repository'
    );
    expect(testConfigInstance.error).toHaveBeenCalled();
  });
});
