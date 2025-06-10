import { Args, Flags } from '@oclif/core';

/**
 * Defines the arguments for the `scan` command.
 * @property {object} inputFile - Argument for the path to a local input file (TXT, CSV, JSON) containing URLs. This is a required argument.
 */
export const scanArgs = {
  inputFile: Args.string({
    description:
      'Path to a local input file (TXT, CSV, JSON) containing URLs to scan.',
    required: true,
    // `default` should be removed when `required: true`, oclif handles this.
    // default: 'src/input.txt',
  }),
};

/**
 * Defines the flags for the `scan` command.
 * These flags allow users to configure aspects of the scan such as Puppeteer behavior,
 * output directories, logging, URL processing limits (range, chunking, total number), etc.
 * The `githubRepo` flag has been removed as the command now only supports local file inputs.
 */
export const scanFlags = {
  numUrls: Flags.integer({
    description: 'Limit the number of URLs to process from the input file.',
    required: false,
  }),
  puppeteerType: Flags.string({
    description: 'Type of Puppeteer to use',
    options: ['vanilla', 'cluster'],
    default: 'cluster',
  }),
  concurrency: Flags.integer({
    description: 'Number of concurrent Puppeteer instances',
    default: 5,
  }),
  headless: Flags.boolean({
    description: 'Run Puppeteer in headless mode',
    default: true,
    allowNo: true,
  }),
  monitor: Flags.boolean({
    description: 'Enable puppeteer-cluster monitoring',
    default: false,
  }),
  outputDir: Flags.string({
    description: 'Directory to save output files',
    default: 'store',
  }),
  logDir: Flags.string({
    description: 'Directory to save log files',
    default: 'logs',
  }),
  range: Flags.string({
    description:
      "Specify a line range (e.g., '10-20' or '5-') to process from the input source. 1-based indexing.",
    required: false,
  }),
  chunkSize: Flags.integer({
    description:
      'Process URLs in chunks of this size. Processes all URLs in the specified range or input, but one chunk at a time.',
    required: false,
  }),
};
