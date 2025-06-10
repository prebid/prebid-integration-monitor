// SPDX-License-Identifier: Apache-2.0
// Copyright 2024 Tiny Tapeout LTD
// Author: Uri Shaked

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mocked,
} from 'vitest';
import * as fs from 'fs';
import path from 'path';
import type { Logger as WinstonLogger } from 'winston';
import {
  processAndLogTaskResults,
  writeResultsToFile,
} from '../results-handler';
import type { TaskResult, PageData, ErrorDetails } from '../../common/types';
import * as fileSystemUtils from '../file-system-utils';

// Mock fs module
vi.mock('fs', async () => {
  const actualFs = await vi.importActual<typeof fs>('fs');
  return {
    ...actualFs,
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false), // Default to file not existing for writeResultsToFile
  };
});

// Mock file-system-utils
vi.mock('../file-system-utils', async () => ({
  ensureDirectoryExists: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
}));

const mockedFs = fs as Mocked<typeof fs>;
const mockedFileSystemUtils = fileSystemUtils as Mocked<typeof fileSystemUtils>;

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(), // Add other methods if used by the module
} as unknown as WinstonLogger; // Cast to WinstonLogger to satisfy type requirements

describe('processAndLogTaskResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleSuccessData: PageData = {
    url: 'https://success.com',
    date: '2024-01-01',
    libraries: [],
    prebidInstances: [{ version: '1.0.0', modules: {} }],
  };

  const successResult: TaskResult = {
    type: 'success',
    data: sampleSuccessData,
  };
  const noDataResult: TaskResult = {
    type: 'no_data',
    url: 'https://nodata.com',
  };
  const nameNotResolvedError: ErrorDetails = {
    code: 'ENOTFOUND',
    message: 'Name not resolved example.com',
  };
  const nameNotResolvedResult: TaskResult = {
    type: 'error',
    url: 'https://namenotresolved.com',
    error: nameNotResolvedError,
  };
  const genericError: ErrorDetails = {
    code: 'SOME_ERROR',
    message: 'Just a generic error',
  };
  const genericErrorResult: TaskResult = {
    type: 'error',
    url: 'https://genericerror.com',
    error: genericError,
  };
  const dnsProbeError: ErrorDetails = {
    message: 'DNS PROBE FINISHED NXDOMAIN',
  }; // code might be missing
  const dnsProbeResult: TaskResult = {
    type: 'error',
    url: 'https://dnsprobe.com',
    error: dnsProbeError,
  };

  it('should handle "success" case correctly', () => {
    const results = processAndLogTaskResults([successResult], mockLogger);
    expect(results).toEqual([sampleSuccessData]);
    expect(mockLogger.info).toHaveBeenCalledWith(
      `SUCCESS: Data extracted for ${sampleSuccessData.url}`,
      expect.any(Object)
    );
    expect(mockedFs.appendFileSync).not.toHaveBeenCalled();
  });

  it('should handle "no_data" case and call appendToErrorFile for no_prebid.txt', () => {
    processAndLogTaskResults([noDataResult], mockLogger);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      `NO_DATA: No relevant ad tech data found for ${noDataResult.url}`,
      { url: noDataResult.url }
    );
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(path.join('errors'), {
      recursive: true,
    });
    expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
      path.join('errors', 'no_prebid.txt'),
      noDataResult.url + '\n',
      'utf8'
    );
  });

  it('should handle "name not resolved" error (ENOTFOUND) and call appendToErrorFile for navigation_errors.txt', () => {
    processAndLogTaskResults([nameNotResolvedResult], mockLogger);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(nameNotResolvedResult.url),
      expect.any(Object)
    );
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(path.join('errors'), {
      recursive: true,
    });
    expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
      path.join('errors', 'navigation_errors.txt'),
      nameNotResolvedResult.url + '\n',
      'utf8'
    );
  });

  it('should handle "name not resolved" error (ERR_NAME_NOT_RESOLVED) and call appendToErrorFile for navigation_errors.txt', () => {
    const errNameNotResolved: TaskResult = {
      type: 'error',
      url: 'https://errnameresolved.com',
      error: { code: 'ERR_NAME_NOT_RESOLVED', message: 'Another DNS issue' },
    };
    processAndLogTaskResults([errNameNotResolved], mockLogger);
    expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
      path.join('errors', 'navigation_errors.txt'),
      errNameNotResolved.url + '\n',
      'utf8'
    );
  });

  it('should handle "DNS PROBE FINISHED NXDOMAIN" error message and call appendToErrorFile for navigation_errors.txt', () => {
    processAndLogTaskResults([dnsProbeResult], mockLogger);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(dnsProbeResult.url),
      expect.any(Object)
    );
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(path.join('errors'), {
      recursive: true,
    });
    expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
      path.join('errors', 'navigation_errors.txt'),
      dnsProbeResult.url + '\n',
      'utf8'
    );
  });

  it('should handle generic "error" case and call appendToErrorFile for error_processing.txt', () => {
    processAndLogTaskResults([genericErrorResult], mockLogger);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(genericErrorResult.url),
      expect.any(Object)
    );
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(path.join('errors'), {
      recursive: true,
    });
    expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
      path.join('errors', 'error_processing.txt'),
      genericErrorResult.url + '\n',
      'utf8'
    );
  });

  it('should return empty array if taskResults is empty or undefined', () => {
    expect(processAndLogTaskResults([], mockLogger)).toEqual([]);
    expect(processAndLogTaskResults(undefined as any, mockLogger)).toEqual([]);
    expect(mockLogger.info).toHaveBeenCalledWith('No task results to process.');
  });
});

describe('writeResultsToFile', () => {
  const samplePageData: PageData[] = [
    {
      url: 'https://test1.com',
      date: '2025-04-10',
      libraries: [],
      prebidInstances: [],
    },
    {
      url: 'https://test2.com',
      date: '2025-04-10',
      libraries: [],
      prebidInstances: [],
    },
  ];
  const testDate = new Date(2025, 3, 10, 12, 0, 0); // April 10, 2025
  const expectedDir = path.join('store', 'Apr-2025');
  const expectedFilename = '2025-04-10.json';
  const expectedFilePath = path.join(expectedDir, expectedFilename);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(testDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a new file if none exists', async () => {
    mockedFs.existsSync.mockReturnValue(false); // Simulate file not existing for this test

    await writeResultsToFile(samplePageData, 'ignored_output_dir', mockLogger);

    expect(mockedFileSystemUtils.ensureDirectoryExists).toHaveBeenCalledWith(
      expectedDir
    );
    expect(mockedFileSystemUtils.readJsonFile).not.toHaveBeenCalled();
    expect(mockedFileSystemUtils.writeJsonFile).toHaveBeenCalledWith(
      expectedFilePath,
      samplePageData
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      `File ${expectedFilePath} does not exist. Creating new file.`
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Successfully wrote ${samplePageData.length} results to ${expectedFilePath}`
    );
  });

  it('should append to an existing valid JSON file', async () => {
    const existingData: PageData[] = [
      {
        url: 'https://existing.com',
        date: '2025-04-10',
        libraries: [],
        prebidInstances: [],
      },
    ];
    mockedFs.existsSync.mockReturnValue(true); // Simulate file existing
    mockedFileSystemUtils.readJsonFile.mockResolvedValue(existingData);

    await writeResultsToFile(samplePageData, 'ignored_output_dir', mockLogger);

    expect(mockedFileSystemUtils.ensureDirectoryExists).toHaveBeenCalledWith(
      expectedDir
    );
    expect(mockedFileSystemUtils.readJsonFile).toHaveBeenCalledWith(
      expectedFilePath
    );
    const combinedData = existingData.concat(samplePageData);
    expect(mockedFileSystemUtils.writeJsonFile).toHaveBeenCalledWith(
      expectedFilePath,
      combinedData
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      `File ${expectedFilePath} exists. Attempting to read and append.`
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Successfully read and appended ${samplePageData.length} new results to ${expectedFilePath}. Total results: ${combinedData.length}`
    );
  });

  it('should overwrite if existing file content is not a valid JSON array', async () => {
    mockedFs.existsSync.mockReturnValue(true); // Simulate file existing
    mockedFileSystemUtils.readJsonFile.mockResolvedValue({
      not: 'an array',
    } as any); // Simulate invalid content

    await writeResultsToFile(samplePageData, 'ignored_output_dir', mockLogger);

    expect(mockedFileSystemUtils.ensureDirectoryExists).toHaveBeenCalledWith(
      expectedDir
    );
    expect(mockedFileSystemUtils.readJsonFile).toHaveBeenCalledWith(
      expectedFilePath
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      `Existing file ${expectedFilePath} is not a valid JSON array. Overwriting with new results.`
    );
    expect(mockedFileSystemUtils.writeJsonFile).toHaveBeenCalledWith(
      expectedFilePath,
      samplePageData
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Successfully wrote ${samplePageData.length} results to ${expectedFilePath}`
    );
  });

  it('should overwrite if readJsonFile throws an error (e.g. JSON parsing error)', async () => {
    mockedFs.existsSync.mockReturnValue(true); // Simulate file existing
    const readError = new Error('Invalid JSON');
    (readError as any).details = {
      errorCode: 'JSON_PARSE_FAILED',
      originalError: new SyntaxError('Test syntax error'),
    };
    mockedFileSystemUtils.readJsonFile.mockRejectedValue(readError);

    await writeResultsToFile(samplePageData, 'ignored_output_dir', mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Could not read or parse existing file ${expectedFilePath}`
      ),
      expect.any(Object)
    );
    expect(mockedFileSystemUtils.writeJsonFile).toHaveBeenCalledWith(
      expectedFilePath,
      samplePageData
    );
  });

  it('should do nothing and log if resultsToSave is empty', async () => {
    await writeResultsToFile([], 'ignored_output_dir', mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith('No results to save to file.');
    expect(mockedFileSystemUtils.ensureDirectoryExists).not.toHaveBeenCalled();
    expect(mockedFileSystemUtils.readJsonFile).not.toHaveBeenCalled();
    expect(mockedFileSystemUtils.writeJsonFile).not.toHaveBeenCalled();
  });
});
