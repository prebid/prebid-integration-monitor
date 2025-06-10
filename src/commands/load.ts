import { Command } from '@oclif/core';
import { loadArgs, loadFlags } from './load-options.js';
import * as fs from 'fs';
import { initializeLogger } from '../utils/logger.js'; // Assuming logger is in utils
import {
  loadFileContents,
  processFileContent,
  fetchUrlsFromGitHub,
} from '../utils/url-loader.js';
// import type { Logger as WinstonLogger } from 'winston'; // WinstonLogger not used directly in this file after moving utils

export default class Load extends Command {
  static override args = loadArgs;
  static override flags = loadFlags;
  static description = 'Loads URLs from a file or GitHub repository.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> path/to/urls.txt',
    '<%= config.bin %> <%= command.id %> path/to/urls.txt --outputFile output.txt',
    '<%= config.bin %> <%= command.id %> --githubRepo https://github.com/user/repo/blob/main/urls.txt',
    '<%= config.bin %> <%= command.id %> --githubRepo https://github.com/user/repo --numUrls 50',
  ];

  private _determineInputSource(
    args: { inputFile?: string },
    flags: { githubRepo?: string; numUrls?: number }
  ):
    | { type: 'file'; path: string }
    | { type: 'github'; repoUrl: string; numUrls?: number } {
    if (flags.githubRepo) {
      this.log(`Input source: GitHub repository (${flags.githubRepo})`);
      return {
        type: 'github',
        repoUrl: flags.githubRepo,
        numUrls: flags.numUrls,
      };
    }

    if (args.inputFile) {
      this.log(`Input source: Local file (${args.inputFile})`);
      return { type: 'file', path: args.inputFile };
    }

    this.error(
      'No input source specified. Provide either an input file path or a GitHub repository URL.',
      { exit: 1 }
    );
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Load);
    const logger = initializeLogger(flags.logDir);
    let urls: string[] = [];

    try {
      const inputSource = this._determineInputSource(args, flags);

      if (inputSource.type === 'file') {
        const fileContent = loadFileContents(inputSource.path, logger);
        if (fileContent) {
          urls = await processFileContent(
            inputSource.path,
            fileContent,
            logger
          );
        } else {
          this.error(`Failed to load content from file: ${inputSource.path}`, {
            exit: 1,
          });
        }
      } else if (inputSource.type === 'github') {
        urls = await fetchUrlsFromGitHub(
          inputSource.repoUrl,
          inputSource.numUrls,
          logger
        );
      }
    } catch (error: unknown) {
      this.error(`Failed to load URLs: ${(error as Error).message}`, {
        exit: 1,
      });
    }

    if (flags.outputFile) {
      try {
        fs.writeFileSync(flags.outputFile, urls.join('\n'));
        this.log(`Loaded ${urls.length} URLs to ${flags.outputFile}`);
      } catch (error: unknown) {
        this.error(
          `Failed to write URLs to ${flags.outputFile}: ${(error as Error).message}`,
          { exit: 1 }
        );
      }
    } else {
      if (urls.length > 0) {
        this.log('Loaded URLs:');
        urls.forEach((url) => this.log(url));
      } else {
        this.log('No URLs found or loaded.');
      }
    }
  }
}
