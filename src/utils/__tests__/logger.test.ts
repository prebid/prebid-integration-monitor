import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logform } from 'winston';
// Import initializeLogger, MockTransport, and the actual logger instance
import loggerModule, { initializeLogger, MockTransport } from '../logger';
// Import formatConsoleLogMessage to directly test its output formatting
import { formatConsoleLogMessage } from '../logger'; // This is not exported, need to adapt.

// The formatConsoleLogMessage is not exported. We will test the effect via the MockTransport.
// To do this, the MockTransport needs to apply the same formatting.
// Or, we accept that MockTransport gets raw info, and we can't directly assert
// the final string of formatConsoleLogMessage without exporting it or making it a static method.

// For this test, we'll assume MockTransport gets the raw 'info' object,
// and we'll construct a similar 'info' object to pass to an exported/testable formatConsoleLogMessage.
// However, formatConsoleLogMessage is NOT EXPORTED.

// Re-thinking: The MockTransport in logger.ts will receive the info object *before*
// it hits the specific `printf` of the Console transport.
// So, the MockTransport will have the raw log entry.
// The `formatConsoleLogMessage` is intertwined with `winston.format.printf`.

// To test `formatConsoleLogMessage`'s logic, it would need to be exportable.
// Given it's not, the tests should check the raw `info` object properties on the mock transport,
// rather than the final string output. This means the tests will verify the *data* that
// *would be formatted*, but not the exact string formatting itself.

// OR: We create a new MockConsoleTransport for testing that *does* use the formatConsoleLogMessage.

// Let's try to make formatConsoleLogMessage testable by passing a formatter to MockTransport.
// This is getting complex. Simplest for now: MockTransport stores raw info.
// We then manually call the (now to be exported) formatConsoleLogMessage.

// We need to export formatConsoleLogMessage from logger.ts for direct testing.
// This is a change to the source file for testability.
// If that's not desired, then the tests must be less precise about the final string.

// Assuming we cannot change logger.ts to export formatConsoleLogMessage for now.
// The tests will be limited to checking the content of the message in MockTransport,
// not the exact console string. This is a limitation.

// Let's proceed with the MockTransport as defined (stores raw info objects)
// and adjust assertions. The key is that `isVerbose` IS used by `formatConsoleLogMessage`,
// and `initializeLogger` sets `isVerbose`. The `info.message` and `info.stack` will be
// available on the `info` object in `mockTransport.messages[0]`.
// The `formatConsoleLogMessage` logic for truncation or full message isn't directly tested for its string output.

// The tests as written before the previous diff (with stdoutSpy) were trying to assert the final string.
// With MockTransport, the assertions will change.

// Import the newly exported items for direct testing
import { formatConsoleLogMessage as directFormatConsoleLogMessage, setTestIsVerbose } from '../logger';

// Mock fs to prevent actual directory creation during tests
vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof import('fs')>();
  return {
    ...actualFs,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

describe('Logger Module with Verbose Flag and MockTransport', () => {
  let mockTransport: MockTransport;

  // Helper to simulate the info object structure after winston's formats (errors, splat, etc.)
  // but before the final printf. This is what our MockTransport will store.
  const createRawInfo = (level: string, message: string, splatData?: any, error?: Error): Logform.TransformableInfo => {
    const info: Logform.TransformableInfo = {
      level,
      message,
      timestamp: '2023-01-01 12:00:00', // Will be set by winston.format.timestamp()
      [Symbol.for('level')]: level,
    };
    if (splatData) {
      info[Symbol.for('splat')] = [splatData]; // Simulate splat
      // If error is in splat (like logger.error('msg', errorInstance))
      // winston.format.errors() might hoist it.
    }
    if (error) {
      // winston.format.errors({ stack: true }) adds stack to the info object
      info.stack = error.stack;
      // It might also replace info.message with error.message if error is the primary arg.
      // For logger.error(errorInstance), info.message becomes error.message.
      // For logger.error('custom message', errorInstance), it's more complex.
      // Let's assume for these tests, logger.error('message', { stack: '...' }) is used.
    }
    return info;
  };


  describe('Verbose Mode OFF', () => {
    beforeEach(() => {
      mockTransport = new MockTransport();
      initializeLogger('test-log-dir', false, [mockTransport]); // Verbose OFF
    });

    it('should have error message and stack in log info, for non-verbose (formatting happens later)', () => {
      const logger = loggerModule.instance;
      const errorMessage = 'Error: Failed to fetch URL: http://example.com/api due to timeout at Test.operation (test.js:12:34)';
      const errorStack = 'Error: Failed to fetch URL: http://example.com/api due to timeout\n    at Test.operation (test.js:12:34)\n    at anotherFunc (test.js:56:78)';

      logger.error(errorMessage, { stack: errorStack }); // Pass stack as metadata

      expect(mockTransport.messages).toHaveLength(1);
      const loggedInfo = mockTransport.messages[0];

      expect(loggedInfo.level).toBe('error');
      expect(loggedInfo.message).toBe(errorMessage);
      expect(loggedInfo.stack).toBe(errorStack);
      // We cannot assert the final string output of formatConsoleLogMessage here
      // unless we export it and call it manually with a fully simulated 'info' object.
      // The purpose of this test is to ensure that when verbose is OFF, the *information*
      // needed for specific formatting (message, stack) is still logged to the transport.
      // The actual formatting is visually confirmed or tested if formatConsoleLogMessage is exported.
    });

    it('should log generic errors with message and stack to transport, for non-verbose', () => {
      const logger = loggerModule.instance;
      const errorMessage = 'SyntaxError: Unexpected token < in JSON at position 0';
      const errorStack = 'SyntaxError: Unexpected token < in JSON at position 0\n    at JSON.parse (<anonymous>)\n    at processChunk (parser.js:42:10)';

      logger.error(errorMessage, { stack: errorStack });

      expect(mockTransport.messages).toHaveLength(1);
      const loggedInfo = mockTransport.messages[0];
      expect(loggedInfo.level).toBe('error');
      expect(loggedInfo.message).toBe(errorMessage);
      expect(loggedInfo.stack).toBe(errorStack);
    });
  });

  describe('Verbose Mode ON', () => {
    beforeEach(() => {
      mockTransport = new MockTransport();
      initializeLogger('test-log-dir', true, [mockTransport]); // Verbose ON
    });

    it('should have error message and stack in log info, for verbose (formatting happens later)', () => {
      const logger = loggerModule.instance;
      const errorMessage = 'Error: Failed to fetch URL: http://example.com/api due to timeout at Test.operation (test.js:12:34)';
      const errorStack = 'Error: Failed to fetch URL: http://example.com/api due to timeout\n    at Test.operation (test.js:12:34)\n    at anotherFunc (test.js:56:78)';

      logger.error(errorMessage, { stack: errorStack });

      expect(mockTransport.messages).toHaveLength(1);
      const loggedInfo = mockTransport.messages[0];
      expect(loggedInfo.level).toBe('error');
      expect(loggedInfo.message).toBe(errorMessage);
      expect(loggedInfo.stack).toBe(errorStack);
    });

    it('should log generic errors with message and stack to transport, for verbose', () => {
        const logger = loggerModule.instance;
        const errorMessage = 'SyntaxError: Unexpected token < in JSON at position 0';
        const errorStack = 'SyntaxError: Unexpected token < in JSON at position 0\n    at JSON.parse (<anonymous>)\n    at processChunk (parser.js:42:10)';

        logger.error(errorMessage, { stack: errorStack });

        expect(mockTransport.messages).toHaveLength(1);
        const loggedInfo = mockTransport.messages[0];
        expect(loggedInfo.level).toBe('error');
        expect(loggedInfo.message).toBe(errorMessage);
        expect(loggedInfo.stack).toBe(errorStack);
      });
  });

  describe('Non-Error Logging with MockTransport', () => {
    beforeEach(() => {
      mockTransport = new MockTransport();
      initializeLogger('test-log-dir', true, [mockTransport]);
    });

    it('should log info messages to transport', () => {
      const logger = loggerModule.instance;
      const infoMessage = 'This is an info message.';
      logger.info(infoMessage);

      expect(mockTransport.messages).toHaveLength(1);
      const loggedInfo = mockTransport.messages[0];
      expect(loggedInfo.level).toBe('info');
      expect(loggedInfo.message).toBe(infoMessage);
      expect(loggedInfo.stack).toBeUndefined();
    });
  });
});

// New describe block for direct testing of formatConsoleLogMessage
describe('formatConsoleLogMessage Direct Tests', () => {
  const createMockInfo = (
    level: string,
    message: string,
    timestamp: string,
    stack?: string,
    name?: string // For simulating error.name if different from 'Error'
  ): Logform.TransformableInfo => {
    const info: any = { // Use any to easily add symbols, or cast later
      level,
      message,
      timestamp,
      // Simulate what winston's processing (like colorize, errors()) might add
      // The real 'info' object is more complex. formatConsoleLogMessage primarily uses these:
      // info.level (string, potentially colorized), info.message, info.timestamp, info.stack, info.name, info.constructor.name
    };
    // Add symbols for level and message, though formatConsoleLogMessage doesn't use them directly
    info[Symbol.for('level')] = level;
    info[Symbol.for('message')] = message;

    if (stack) {
      info.stack = stack;
    }
    if (name) {
      info.name = name; // e.g. 'SyntaxError'
    }
    // Simulate constructor name for error prefix removal
    // For an actual error, info.constructor.name would be 'Error' or similar.
    // We need to ensure this field is present if the logic relies on it.
    // If it's an error, info.name is often used by winston.format.errors()
    if (level === 'error' && message.startsWith('Error: ')) {
        info.name = 'Error'; // Default if message starts with "Error: "
        info.constructor = { name : 'Error'};
    } else if (level === 'error' && message.startsWith('SyntaxError: ')) {
        info.name = 'SyntaxError';
        info.constructor = { name : 'SyntaxError'};
    }


    // Important: formatConsoleLogMessage expects info.level to be the *final string* used in output,
    // which means if colorization is part of the pipeline *before* formatConsoleLogMessage,
    // that colorized string should be here. For testing, we'll use plain strings.
    return info as Logform.TransformableInfo;
  };

  it('Non-verbose error output: truncates message at " at " and includes URL part', () => {
    setTestIsVerbose(false);
    const mockInfo = createMockInfo(
      'error',
      'Error: Something went wrong URL: http://example.com/test with details at some/file.js:10:20',
      '2023-10-27 10:00:00',
      'Error: Something went wrong URL: http://example.com/test with details at some/file.js:10:20\n    at another/file.js:5:5'
    );
    const result = directFormatConsoleLogMessage(mockInfo);
    // Expected: timestamp level: URLPart OriginalMessagePart (truncated)
    // OriginalMessagePart: "Something went wrong URL: http://example.com/test with details" (after "Error: " removed)
    // URLPart: "Error processing http://example.com/test : "
    expect(result).toBe('2023-10-27 10:00:00 error: Error processing http://example.com/test : Something went wrong URL: http://example.com/test with details');
  });

  it('Non-verbose error output: full message if " at " is not present', () => {
    setTestIsVerbose(false);
    const mockInfo = createMockInfo(
      'error',
      'Error: Critical failure URL: http://anotherexample.com',
      '2023-10-27 10:00:00',
      'Error: Critical failure URL: http://anotherexample.com\n    at some/otherfile.js:1:1'
    );
    const result = directFormatConsoleLogMessage(mockInfo);
    // Expected: timestamp level: URLPart OriginalMessage (no " at ")
    // OriginalMessage: "Critical failure URL: http://anotherexample.com"
    // URLPart: "Error processing http://anotherexample.com : "
    expect(result).toBe('2023-10-27 10:00:00 error: Error processing http://anotherexample.com : Critical failure URL: http://anotherexample.com');
  });

  it('Non-verbose error output: no URL part if URL not matched', () => {
    setTestIsVerbose(false);
    const mockInfo = createMockInfo(
      'error',
      'Error: Just a failure message at some/file.js:10:20',
      '2023-10-27 10:00:00',
      'Error: Just a failure message at some/file.js:10:20\n    at another/file.js:5:5'
    );
    const result = directFormatConsoleLogMessage(mockInfo);
    // Expected: timestamp level: OriginalMessagePart (truncated, no URL part)
    // OriginalMessagePart: "Just a failure message"
    expect(result).toBe('2023-10-27 10:00:00 error: Just a failure message');
  });


  it('Verbose error output: includes full message and stack', () => {
    setTestIsVerbose(true);
    const fullErrorMessage = 'Error: Something went wrong URL: http://example.com/test with details at some/file.js:10:20';
    const stack = `${fullErrorMessage}\n    at another/file.js:5:5`;
    const mockInfo = createMockInfo(
      'error',
      fullErrorMessage,
      '2023-10-27 10:00:00',
      stack
    );
    const result = directFormatConsoleLogMessage(mockInfo);
    // Expected: timestamp level: FullMessage\nStack
    expect(result).toBe(`2023-10-27 10:00:00 error: ${fullErrorMessage}\n${stack}`);
  });

  it('Non-error message (verbose false): standard output', () => {
    setTestIsVerbose(false);
    const mockInfo = createMockInfo(
      'info',
      'Application started',
      '2023-10-27 10:00:00'
    );
    const result = directFormatConsoleLogMessage(mockInfo);
    expect(result).toBe('2023-10-27 10:00:00 info: Application started');
  });

  it('Non-error message (verbose true): standard output, no stack for info', () => {
    setTestIsVerbose(true);
    const mockInfo = createMockInfo(
      'info',
      'Application started',
      '2023-10-27 10:00:00'
      // No stack for info messages
    );
    const result = directFormatConsoleLogMessage(mockInfo);
    expect(result).toBe('2023-10-27 10:00:00 info: Application started');
  });
});
