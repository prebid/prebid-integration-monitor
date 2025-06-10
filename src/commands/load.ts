import { Command, Flags, Args } from '@oclif/core';
import { initializeLogger } from '../utils/logger.js';
import loggerModule from '../utils/logger.js';
import {
  fetchUrlsFromGitHub,
  loadFileContents,
  processFileContent,
} from '../utils/url-loader.js';
import { AppError } from '../common/AppError.js';

/**
 * @class Load
 * @description Oclif command to load URLs from various sources like local files or GitHub repositories.
 * This command is primarily used for fetching a list of URLs that can then be processed or monitored.
 * It supports different file types (TXT, CSV, JSON) and allows specifying a GitHub repository URL
 * to retrieve URLs from files stored there.
 * @example
 * // Load URLs from a local text file
 * app load urls.txt
 * @example
 * // Load URLs from a specific file in a GitHub repository
 * app load --githubRepo https://github.com/owner/repo/blob/main/urls.txt
 */
export default class Load extends Command {
  /**
   * @property {string} description - A brief summary of what the command does.
   * Displayed in the CLI help output.
   */
  static override description =
    'Loads URLs from a file or GitHub repository and processes them.';

  /**
   * @property {string[]} examples - Illustrative examples of how to use the command.
   * Displayed in the CLI help output.
   */
  static override examples = [
    '<%= config.bin %> <%= command.id %> urls.txt',
    '<%= config.bin %> <%= command.id %> --githubRepo https://github.com/owner/repo/blob/main/urls.txt',
  ];

  /**
   * @property {object} flags - Defines the command-line flags accepted by this command.
   * @property {object} flags.githubRepo - Flag to specify a GitHub repository URL from which to fetch URLs.
   * @property {object} flags.logDir - Flag to specify the directory for storing log files.
   * @property {object} flags.numUrls - Flag to limit the number of URLs to load.
   */
  static override flags = {
    githubRepo: Flags.string({
      description: 'GitHub repository URL to fetch URLs from.',
      char: 'g',
      exclusive: ['inputFile'], // Ensure only one input source
    }),
    logDir: Flags.string({
      description: 'Directory to store log files.',
      default: './logs',
    }),
    numUrls: Flags.integer({
      description: 'Limit the number of URLs to load.',
      char: 'n',
    }),
  };

  /**
   * @property {object} args - Defines the command-line arguments accepted by this command.
   * @property {object} args.inputFile - Argument for the path to a local input file (TXT, CSV, JSON).
   *                                     This is optional if `--githubRepo` is used.
   */
  static override args = {
    inputFile: Args.string({
      description: 'Path to a local input file (TXT, CSV, JSON).',
      required: false, // Required only if githubRepo is not provided
    }),
  };

  /**
   * Executes the load command.
   * This method orchestrates the URL loading process by:
   * 1. Parsing command-line arguments and flags.
   * 2. Initializing the logger.
   * 3. Determining the input source (local file or GitHub repository via `flags.githubRepo` or `args.inputFile`).
   * 4. Fetching and processing URLs from the chosen source using utility functions.
   * 5. Applying a limit to the number of URLs if `flags.numUrls` is specified.
   * 6. Logging the loaded URLs or any errors encountered during the process.
   *
   * @async
   * @public
   * @returns {Promise<void>} A promise that resolves when the loading is complete or an error is handled.
   */
  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Load);

    initializeLogger(flags.logDir);
    const logger = loggerModule.instance;

    let urls: string[] = [];

    try {
      if (flags.githubRepo) {
        logger.info(
          `Fetching URLs from GitHub repository: ${flags.githubRepo}`
        );
        urls = await fetchUrlsFromGitHub(
          flags.githubRepo,
          flags.numUrls,
          logger
        );
      } else if (args.inputFile) {
        logger.info(`Loading URLs from input file: ${args.inputFile}`);
        const fileContent = loadFileContents(args.inputFile, logger);
        if (fileContent) {
          urls = await processFileContent(args.inputFile, fileContent, logger);
          if (flags.numUrls && urls.length > flags.numUrls) {
            urls = urls.slice(0, flags.numUrls);
          }
        } else {
          this.error(`Failed to read input file: ${args.inputFile}`, {
            exit: 1,
          });
          return;
        }
      } else {
        this.error(
          'No input source specified. Provide an inputFile argument or use the --githubRepo flag.',
          { exit: 1 }
        );
        return;
      }

      if (urls.length === 0) {
        // If githubRepo was specified and no URLs were found, it's an error.
        if (flags.githubRepo) {
          this.error(
            `No URLs found from the specified GitHub repository: ${flags.githubRepo}`,
            { exit: 1 }
          );
        } else {
          // For file inputs, or if no source led to URLs (though caught earlier for no input)
          logger.warn('No URLs were loaded.');
          this.log('No URLs found from the specified source.');
        }
        return; // Exit if no URLs, whether error or just warning.
      }

      logger.info(`Successfully loaded ${urls.length} URLs.`);
      this.log(`Loaded ${urls.length} URLs:`);
      urls.forEach((url) => this.log(url));

      // Placeholder for further processing of URLs
      logger.info('Further processing of URLs would happen here.');
    } catch (error: unknown) {
      let userMessage = 'An unexpected error occurred during the load command.';
      if (error instanceof AppError) {
        logger.error(`AppError during load: ${error.message}`, {
          details: error.details
            ? JSON.stringify(error.details, null, 2)
            : undefined,
          stack: error.stack,
        });
        userMessage = error.message;
      } else if (error instanceof Error) {
        logger.error(`Error during load: ${error.message}`, {
          stack: error.stack,
        });
        userMessage = error.message;
      } else {
        logger.error('An unknown error occurred during load.', {
          errorDetail: JSON.stringify(error, null, 2),
        });
      }
      this.error(userMessage, { exit: 1 });
    }
  }
}
