import { Args, Command, Flags } from '@oclif/core';
import fetch from 'node-fetch';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { URL } from 'url';

/**
 * Command to inspect a URL and store the request and response data.
 * This command fetches the content of a given URL, captures details
 * about the HTTP request and response, and saves this information
 * to a file in either JSON or HAR format.
 */
export default class Inspect extends Command {
  static override args = {
    url: Args.string({
      description: 'URL to inspect.',
      required: true,
    }),
  };

  static override description =
    'Inspects a URL and stores the request/response data. Supports JSON and HAR (basic) formats.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> https://example.com',
    '<%= config.bin %> <%= command.id %> https://example.com --output-dir store/custom-inspect --format har --filename my-inspection',
    '<%= config.bin %> <%= command.id %> https://api.example.com/data --filename api-data --format json',
  ];

  static override flags = {
    'output-dir': Flags.string({
      description: 'Directory to store the inspection data.',
      default: 'store/inspect',
    }),
    format: Flags.string({
      description:
        'Format to store the data (json, har). HAR implementation is currently basic.',
      default: 'json',
      options: ['json', 'har'],
    }),
    filename: Flags.string({
      description:
        'Filename for the inspection data (without extension). If not provided, it will be derived from the URL and timestamp.',
      required: false,
    }),
  };

  /**
   * Runs the inspect command.
   * Parses arguments and flags, fetches data from the specified URL,
   * formats it, and saves it to a file.
   * @returns {Promise<void>} A promise that resolves when the command execution is complete.
   */
  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Inspect);

    this.log(`Inspecting URL: ${args.url}`);
    this.log(`Output directory: ${flags['output-dir']}`);
    this.log(`Format: ${flags.format}`);
    if (flags.filename) {
      this.log(`Custom filename specified: ${flags.filename}.${flags.format}`);
    }

    try {
      // Create output directory if it doesn't exist
      this.log(`Ensuring output directory exists: ${flags['output-dir']}`);
      await mkdir(flags['output-dir'], { recursive: true });

      // Make the HTTP request
      this.log(`Fetching data from: ${args.url}`);
      const response = await fetch(args.url);
      const responseBody = await response.text(); // Get response body as text
      this.log(`Received response: ${response.status} ${response.statusText}`);

      // Prepare data to be stored
      const requestData = {
        url: args.url,
        method: 'GET', // Assuming GET, can be enhanced later
        headers: {}, // Placeholder, can capture actual request headers if needed (e.g., from fetch options)
      };

      const responseData = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()), // Convert Headers object to plain object
        body: responseBody, // Caution: Storing large response bodies can consume significant disk space.
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
        // Sanitize hostname to be used in filename
        const hostname = urlObject.hostname
          .replace(/[^a-z0-9_.-]/gi, '_')
          .toLowerCase();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputFilenameBase = `${hostname}-${timestamp}`;
        this.log(`Generated filename base: ${outputFilenameBase}`);
      }
      const outputFilenameWithExt = `${outputFilenameBase}.${flags.format}`;

      const outputPath = path.join(flags['output-dir'], outputFilenameWithExt);

      // Store data
      if (flags.format === 'json') {
        await writeFile(outputPath, JSON.stringify(inspectionData, null, 2));
        this.log(`Inspection data (JSON) saved to: ${outputPath}`);
      } else if (flags.format === 'har') {
        // Basic HAR: Wrap the existing data in a minimal HAR structure.
        const harOutput = {
          log: {
            version: '1.2',
            creator: {
              name: 'prebid-integration-monitor/inspect-command',
              version: this.config.version, // Accessing CLI version
            },
            entries: [
              {
                startedDateTime: (inspectionData as { timestamp: string })
                  .timestamp,
                time: -1, // Placeholder, could calculate actual time if performance monitoring is added
                request: {
                  method: (inspectionData as { request: { method: string } })
                    .request.method,
                  url: (inspectionData as { request: { url: string } }).request
                    .url,
                  httpVersion: 'HTTP/1.1', // Placeholder
                  cookies: [], // Placeholder
                  headers: [], // Placeholder, map from inspectionData.request.headers if captured
                  queryString: [], // Placeholder, parse from URL
                  headersSize: -1,
                  bodySize: -1,
                },
                response: {
                  status: (inspectionData as { response: { status: number } })
                    .response.status,
                  statusText: (
                    inspectionData as { response: { statusText: string } }
                  ).response.statusText,
                  httpVersion: 'HTTP/1.1', // Placeholder
                  cookies: [], // Placeholder
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
                    text: responseBody, // HAR spec allows for text content
                  },
                  redirectURL: response.headers.get('location') || '',
                  headersSize: -1,
                  bodySize: responseBody.length,
                },
                cache: {},
                timings: { send: -1, wait: -1, receive: -1 }, // Placeholder
              },
            ],
          },
        };
        await writeFile(outputPath, JSON.stringify(harOutput, null, 2));
        this.log(`Inspection data (basic HAR) saved to: ${outputPath}`);
      } else {
        this.error(`Unsupported format: ${flags.format}`, { exit: 1 });
        return;
      }
    } catch (error: unknown) {
      this.error(
        `Error during inspection: ${(error as Error).message} (URL: ${args.url})`,
        { exit: 1 },
      );
    }
  }
}
