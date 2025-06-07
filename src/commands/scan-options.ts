import { Args, Flags } from '@oclif/core';

export const scanArgs = {
  inputFile: Args.string({
    description: 'Input file path (accepts .txt, .csv, .json)',
    required: false,
    default: 'src/input.txt',
  }),
};

export const scanFlags = {
  githubRepo: Flags.string({
    description: 'GitHub repository URL to fetch URLs from',
    required: false,
  }),
  numUrls: Flags.integer({
    description:
      'Number of URLs to load from the GitHub repository (used only with --githubRepo)',
    default: 100,
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
