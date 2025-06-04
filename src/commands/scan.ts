import {Args, Command, Flags} from '@oclif/core';
// Step 1: Import prebidExplorer and PrebidExplorerOptions
import { prebidExplorer, PrebidExplorerOptions } from '../prebid.js'; // Assuming .js for NodeNext resolution

export default class Scan extends Command {
  static override args = {
    inputFile: Args.string({description: 'Input file path (accepts .txt, .csv, .json)', required: false, default: 'src/input.txt'}),
  }
  static override description = 'Scans websites for Prebid.js integrations. InputFile can be .txt, .csv, or .json.'
  static override examples = [
    '<%= config.bin %> <%= command.id %> websites.txt --puppeteerType=cluster --concurrency=10',
    '<%= config.bin %> <%= command.id %> --githubRepo https://github.com/user/repo --numUrls 50',
  ]
  static override flags = {
    githubRepo: Flags.string({
      description: 'GitHub repository URL to fetch URLs from',
      required: false,
    }),
    numUrls: Flags.integer({
      description: 'Number of URLs to load from the GitHub repository (used only with --githubRepo)',
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
    range: Flags.string({ description: "Specify a line range (e.g., '10-20' or '5-') to process from the input source. 1-based indexing.", required: false }),
    chunkSize: Flags.integer({ description: "Process URLs in chunks of this size. Processes all URLs in the specified range or input, but one chunk at a time.", required: false }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Scan)

    const {args, flags} = await this.parse(Scan)

    const options: PrebidExplorerOptions = {
      puppeteerType: flags.puppeteerType as 'vanilla' | 'cluster',
      concurrency: flags.concurrency,
      headless: flags.headless,
      monitor: flags.monitor,
      outputDir: flags.outputDir,
      logDir: flags.logDir,
      numUrls: flags.numUrls, // Relevant for GitHub source
      range: flags.range,
      chunkSize: flags.chunkSize,
      puppeteerLaunchOptions: {
        headless: flags.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
      // githubRepo and inputFile are set below based on prioritization
    };

    // Input source prioritization
    if (flags.githubRepo) {
      this.log(`Fetching URLs from GitHub repository: ${flags.githubRepo}`);
      options.githubRepo = flags.githubRepo;
      // User explicitly provided args.inputFile, warn it's ignored.
      if (args.inputFile && args.inputFile !== 'src/input.txt') {
        this.warn(`--githubRepo provided, inputFile argument ('${args.inputFile}') will be ignored.`);
      }
    } else if (args.inputFile) {
      // This covers both explicitly provided inputFile and the default 'src/input.txt'.
      // prebidExplorer will handle a non-existent/empty default file.
      this.log(`Using input file: ${args.inputFile}`);
      options.inputFile = args.inputFile;
    } else {
      // This state should ideally not be reached if args.inputFile has a default.
      // As a safeguard if args.inputFile default is removed or logic changes:
      this.error('No input source specified. Please provide --githubRepo or an inputFile argument.', { exit: 1 });
    }

    this.log(`Starting Prebid scan with options:`);
    this.log(JSON.stringify(options, null, 2));

    // Step 4 & 5: Call prebidExplorer with error handling
    try {
      await prebidExplorer(options);
      this.log('Prebid scan completed successfully.');
    } catch (error: any) {
      this.log(`Full error during Prebid scan: ${error.stack || error}`); // Log full error
      this.error(`An error occurred during the Prebid scan: ${error.message}`, {
        exit: 1,
        suggestions: ['Check logs for more details.'], // Suggestions are fine
      });
    }
  }
}
