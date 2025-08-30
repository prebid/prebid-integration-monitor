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
  verbose: Flags.boolean({
    description:
      'Enable verbose output, including full error messages and stack traces.',
    default: false,
  }),
  skipProcessed: Flags.boolean({
    description:
      'Skip URLs that have been previously processed successfully. Uses SQLite database to track processed URLs.',
    default: false,
  }),
  resetTracking: Flags.boolean({
    description:
      'Reset the URL tracking database before starting. Clears all previously tracked URLs.',
    default: false,
  }),
  prefilterProcessed: Flags.boolean({
    description:
      'Check database BEFORE loading URLs to skip entirely processed ranges. More efficient than --skipProcessed for large lists.',
    default: false,
  }),
  forceReprocess: Flags.boolean({
    description:
      'Force reprocessing of URLs even if they were previously processed. Explicit alternative to --resetTracking.',
    default: false,
  }),
  prebidOnly: Flags.boolean({
    description:
      'Process only URLs where Prebid was previously detected. Loads URLs from stored results. Use with --range to process specific subsets.',
    default: false,
  }),
  batchMode: Flags.boolean({
    description:
      'Enable batch processing mode. Processes URLs in multiple batches automatically.',
    default: false,
  }),
  batchSize: Flags.integer({
    description:
      'Size of each batch when using --batchMode. Number of URLs to process in each batch.',
    default: 250,
  }),
  totalUrls: Flags.integer({
    description:
      'Total number of URLs to process when using --batchMode. Must be used with --startUrl.',
    required: false,
  }),
  startUrl: Flags.integer({
    description:
      'Starting URL number (1-based) when using --batchMode. Must be used with --totalUrls.',
    required: false,
  }),
  resumeBatch: Flags.integer({
    description:
      'Resume batch processing from a specific batch number. Use with --batchMode.',
    required: false,
  }),
  discoveryMode: Flags.boolean({
    description:
      'Enable discovery mode to detect unknown ad tech libraries and identity solutions. Captures unrecognized global variables that match ad tech patterns.',
    default: false,
  }),
  extractMetadata: Flags.boolean({
    description:
      'Extract comprehensive page metadata including Schema.org, OpenGraph, Twitter Cards, and site categorization signals. Adds significant data to output.',
    default: false,
  }),
  preflightCheck: Flags.boolean({
    description:
      'Enable pre-flight checks (DNS, SSL) to skip dead/invalid sites before browser launch. Reduces errors but adds initial overhead.',
    default: false,
  }),
  skipDNSFailed: Flags.boolean({
    description:
      'Skip URLs that fail DNS resolution during pre-flight check. Requires --preflightCheck.',
    default: true,
  }),
  skipSSLFailed: Flags.boolean({
    description:
      'Skip URLs that fail SSL validation during pre-flight check. Requires --preflightCheck.',
    default: false,
  }),
  adUnitDetail: Flags.string({
    description:
      'Level of detail for ad unit extraction: "basic" (media types only), "standard" (includes sizes), "full" (all details including mimes, protocols, etc.)',
    options: ['basic', 'standard', 'full'],
    default: 'basic',
  }),
  moduleDetail: Flags.string({
    description:
      'Level of module categorization: "simple" (all modules in single array), "categorized" (separate arrays for userIds, analytics, consent, etc.)',
    options: ['simple', 'categorized'],
    default: 'simple',
  }),
  identityDetail: Flags.string({
    description:
      'Level of identity provider detection: "basic" (simple array of provider names), "enhanced" (comprehensive classification with party type, ID type, consent requirements, etc.)',
    options: ['basic', 'enhanced'],
    default: 'basic',
  }),
  prebidConfigDetail: Flags.string({
    description:
      'Level of Prebid configuration capture: "none" (disabled), "raw" (capture raw config from pbjs.getConfig())',
    options: ['none', 'raw'],
    default: 'none',
  }),
  identityUsageDetail: Flags.string({
    description:
      'Level of identity usage and storage capture: "none" (disabled), "comprehensive" (full storage correlation, identity usage analysis, and unidentified pattern detection)',
    options: ['none', 'comprehensive'],
    default: 'none',
  }),
};
