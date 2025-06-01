import {Args, Command, Flags} from '@oclif/core';
// Step 1: Import prebidExplorer and PrebidExplorerOptions
import { prebidExplorer, PrebidExplorerOptions } from '../prebid.js'; // Assuming .js for NodeNext resolution

export default class Scan extends Command {
  static override args = {
    inputFile: Args.string({description: 'Input file path', default: 'input.txt'}),
  }
  static override description = 'Scans websites for Prebid.js integrations.'
  static override examples = [
    '<%= config.bin %> <%= command.id %> websites.txt --puppeteerType=cluster --concurrency=10',
  ]
  static override flags = {
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
    // TODO: Consider adding a flag for additional Puppeteer arguments, e.g., --puppeteerArgs="--disable-gpu,--ignore-certificate-errors"
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Scan)

    // Step 3: Construct PrebidExplorerOptions object
    const options: PrebidExplorerOptions = {
      inputFile: args.inputFile!, // inputFile is required by args definition, so ! is safe
      // Ensure puppeteerType is one of the allowed literal types
      puppeteerType: flags.puppeteerType as 'vanilla' | 'cluster',
      concurrency: flags.concurrency,
      headless: flags.headless, // Set the top-level headless property
      monitor: flags.monitor,
      outputDir: flags.outputDir,
      logDir: flags.logDir,
      puppeteerLaunchOptions: {
        headless: flags.headless, // Also set within puppeteerLaunchOptions for clarity/consistency
        args: [
          '--no-sandbox', // Default argument
          '--disable-setuid-sandbox',
          // Add other default args as needed
        ],
        // Potentially merge with user-provided args if a flag for that is added
      },
    };

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
