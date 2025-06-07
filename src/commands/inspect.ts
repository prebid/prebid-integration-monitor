import { Args, Command, Flags } from '@oclif/core';
import fetch from 'node-fetch';
import { mkdir, writeFile } from 'fs/promises';
import loggerModule, { initializeLogger } from '../utils/logger.js'; // Import logger & initializeLogger
import { AppError } from '../common/AppError.js';
import * as path from 'path';
import { URL } from 'url';

/**
 * @class Inspect
 * @description Oclif command to inspect a given URL and store its request and response data.
 * This command fetches the content of a specified URL, captures details
 * about the HTTP request (currently method and URL) and response (status, headers, body),
 * and saves this information to a local file. The output can be in JSON format or a basic
 * HAR (HTTP Archive) format. It includes error handling and user feedback through logging.
 */
export default class Inspect extends Command {
  /**
   * @property {object} args - Defines the command-line arguments accepted by this command.
   * @property {object} args.url - The URL to be inspected. This is a required argument.
   */
  static override args = {
    url: Args.string({
      description: 'URL to inspect.',
      required: true,
    }),
  };

  /**
   * @property {string} description - A brief summary of what the command does.
   * Displayed in the CLI help output.
   */
  static override description =
    'Inspects a URL, fetches its content, and stores detailed request and response data. Supports output in JSON or basic HAR format.';

  /**
   * @property {string[]} examples - Illustrative examples of how to use the command.
   * Displayed in the CLI help output.
   */
  static override examples = [
    '<%= config.bin %> <%= command.id %> https://example.com',
    '<%= config.bin %> <%= command.id %> https://example.com --output-dir store/custom-inspect --format har --filename my-inspection',
    '<%= config.bin %> <%= command.id %> https://api.example.com/data --filename api-data --format json',
  ];

  /**
   * @property {object} flags - Defines the command-line flags accepted by this command.
   */
  static override flags = {
    'output-dir': Flags.string({
      description: 'Directory to store the inspection data.',
      default: 'store/inspect', // Default output directory
    }),
    format: Flags.string({
      description:
        'Format to store the data (json, har). Note: HAR implementation is currently basic.',
      default: 'json', // Default format
      options: ['json', 'har'], // Supported formats
    }),
    filename: Flags.string({
      description:
        'Base filename for the inspection data (without extension). If not provided, a filename will be automatically generated based on the URL\'s hostname and a timestamp (e.g., "example_com-YYYY-MM-DDTHH-mm-ss-SSSZ").',
      required: false,
    }),
    logDir: Flags.string({
      // Added logDir flag
      description: 'Directory to save log files (e.g., app.log, error.log).',
      default: 'logs',
    }),
  };

  /**
   * Executes the inspect command.
   * This method handles parsing of arguments and flags, initialization of the logger,
   * fetching data from the specified URL, formatting the captured data,
   * and saving it to a file in the specified format and location.
   * It includes structured error handling for issues during the process.
   *
   * @async
   * @public
   * @returns {Promise<void>} A promise that resolves when the command execution is complete.
   *                          If an error occurs, it's logged, and the CLI exits with a non-zero code.
   */
  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Inspect);

    // Initialize logger using the logDir flag. Default is 'logs'.
    // loggerModule.instance is used to access the Winston logger singleton.
    const logger = initializeLogger(flags.logDir);

    logger.info(`Inspecting URL: ${args.url}`);
    logger.info(`Output directory: ${flags['output-dir']}`);
    logger.info(`Format: ${flags.format}`);
    if (flags.filename) {
      logger.info(
        `Custom filename specified: ${flags.filename}.${flags.format}`,
      );
    }

    try {
      // Create output directory if it doesn't exist
      logger.info(`Ensuring output directory exists: ${flags['output-dir']}`);
      await mkdir(flags['output-dir'], { recursive: true });

      // Make the HTTP request
      logger.info(`Fetching data from: ${args.url}`);
      const response = await fetch(args.url);
      const responseBody = await response.text();
      logger.info(
        `Received response: ${response.status} ${response.statusText}`,
      );

      // Prepare data to be stored
      const requestData = {
        url: args.url,
        method: 'GET',
        headers: {},
      };

      const responseData = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };

      const inspectionData: unknown = {
        request: requestData,
        response: responseData,
        timestamp: new Date().toISOString(),
      };

      // Determine filename
      let outputFilenameBase = flags.filename;
      if (!outputFilenameBase) {
        const urlObject = new URL(args.url);
        const hostname = urlObject.hostname
          .replace(/[^a-z0-9_.-]/gi, '_')
          .toLowerCase();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputFilenameBase = `${hostname}-${timestamp}`;
        logger.info(`Generated filename base: ${outputFilenameBase}`);
      }
      const outputFilenameWithExt = `${outputFilenameBase}.${flags.format}`;

      const outputPath = path.join(flags['output-dir'], outputFilenameWithExt);

      // Store data
      if (flags.format === 'json') {
        await writeFile(outputPath, JSON.stringify(inspectionData, null, 2));
        logger.info(`Inspection data (JSON) saved to: ${outputPath}`);
      } else if (flags.format === 'har') {
        const harOutput = {
          log: {
            version: '1.2',
            creator: {
              name: 'prebid-integration-monitor/inspect-command',
              version: this.config.version,
            },
            entries: [
              {
                startedDateTime: (inspectionData as { timestamp: string })
                  .timestamp,
                time: -1,
                request: {
                  method: (inspectionData as { request: { method: string } })
                    .request.method,
                  url: (inspectionData as { request: { url: string } }).request
                    .url,
                  httpVersion: 'HTTP/1.1',
                  cookies: [],
                  headers: [],
                  queryString: [],
                  headersSize: -1,
                  bodySize: -1,
                },
                response: {
                  status: (inspectionData as { response: { status: number } })
                    .response.status,
                  statusText: (
                    inspectionData as { response: { statusText: string } }
                  ).response.statusText,
                  httpVersion: 'HTTP/1.1',
                  cookies: [],
                  headers: Object.entries(
                    (
                      inspectionData as {
                        response: { headers: Record<string, string> };
                      }
                    ).response.headers,
                  ).map(([name, value]) => ({ name, value })),
                  content: {
                    size: responseBody.length,
                    mimeType:
                      (
                        inspectionData as {
                          response: { headers: Record<string, string> };
                        }
                      ).response.headers['content-type'] ||
                      'application/octet-stream',
                    text: responseBody,
                  },
                  redirectURL: response.headers.get('location') || '',
                  headersSize: -1,
                  bodySize: responseBody.length,
                },
                cache: {},
                timings: { send: -1, wait: -1, receive: -1 },
              },
            ],
          },
        };
        await writeFile(outputPath, JSON.stringify(harOutput, null, 2));
        logger.info(`Inspection data (basic HAR) saved to: ${outputPath}`);
      } else {
        // This case should ideally not be reached due to 'options' validation in flags.
        this.error(`Unsupported format: ${flags.format}`, { exit: 1 });
        return;
      }
    } catch (error: unknown) {
      // Ensure logger is available, initialize if it was not (though it should be by this point)
      const currentLogger = logger || initializeLogger(flags.logDir);
      let userMessage = `Error during inspection of ${args.url}.`;
      const suggestions = [
        'Check the URL and network connectivity.',
        'Verify file system permissions for the output directory.',
      ];

      if (error instanceof AppError) {
        currentLogger.error(
          `AppError during inspection of ${args.url}: ${error.message}`,
          {
            details: JSON.stringify(error.details, null, 2),
            stack: error.stack,
          },
        );
        userMessage = error.details?.errorCode
          ? `Inspection failed for ${args.url} with code: ${error.details.errorCode}. Message: ${error.message}`
          : `Inspection failed for ${args.url}: ${error.message}`;
        if (error.details?.errorCode?.startsWith('FS_')) {
          suggestions.push('This might be a file system issue.');
        }
      } else if (error instanceof Error) {
        currentLogger.error(
          `Error during inspection of ${args.url}: ${error.message}`,
          {
            stack: error.stack,
          },
        );
        userMessage = `Error during inspection of ${args.url}: ${error.message}`;
      } else {
        currentLogger.error(
          `An unknown error occurred during inspection of ${args.url}.`,
          { errorDetail: JSON.stringify(error, null, 2) },
        );
      }

      this.error(userMessage, {
        exit: 1,
        suggestions,
      });
    }
  }
}
