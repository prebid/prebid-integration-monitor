import { Args, Flags } from '@oclif/core';

export const loadArgs = {
  inputFile: Args.string({
    name: 'inputFile',
    required: false,
    description:
      'Input file path (accepts .txt, .csv, .json) or specify a GitHub URL using --githubRepo.',
  }),
};

export const loadFlags = {
  githubRepo: Flags.string({
    char: 'r',
    description:
      'GitHub repository URL to fetch URLs from. If used, inputFile argument is ignored.',
    required: false,
  }),
  numUrls: Flags.integer({
    char: 'n',
    description:
      'Number of URLs to load from the GitHub repository (used only with --githubRepo)',
    default: 100,
    required: false,
  }),
  outputFile: Flags.string({
    char: 'o',
    description:
      'Optional output file path to save loaded URLs. If not provided, URLs will be printed to stdout.',
    required: false,
  }),
  logDir: Flags.string({
    description: 'Directory to save log files',
    default: 'logs',
    required: false,
  }),
};
