import { Args, Flags } from '@oclif/core';

export const scanArgs = {
  inputFile: Args.string({
    name: 'inputFile',
    description:
      'Input file path (accepts .txt, .csv, .json). If not provided, the command will attempt to read URLs from stdin.',
    required: false,
    default: undefined,
  }),
};

export const scanFlags = {
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
