import { Command, Interfaces } from '@oclif/core';
import { prebidExplorer, PrebidExplorerOptions } from '../prebid.js';
import { scanArgs, scanFlags } from './scan-options.js';
import loggerModule, { initializeLogger } from '../utils/logger.js'; // Import initializeLogger
import { AppError } from '../common/AppError.js';

/**
 * @class Scan
 * @description Oclif command for scanning websites for Prebid.js integrations and other ad technologies.
 * This command allows users to specify a source of URLs (either a local file or a GitHub repository),
 * configure Puppeteer's behavior (e.g., headless mode, concurrency for cluster operations),
 * define output directories for results and logs, and control aspects of the scan like URL ranges or chunking.
 * It utilizes the `prebidExplorer` function to perform the core scanning logic.
 */
export default class Scan extends Command {
  /**
   * @property {object} args - Defines the command-line arguments accepted by this command.
   * @property {object} args.inputFile - Path to a local input file containing URLs.
   *                                     Supports `.txt`, `.csv`, or `.json` files.
   *                                     This is optional if `--githubRepo` is used.
   */
  static override args = scanArgs;
  /**
   * @property {string} description - A brief summary of what the command does.
   * Displayed in the CLI help output.
   */
  static override description =
    'Scans websites for Prebid.js integrations and other ad technologies. \nInput can be a local file (TXT, CSV, JSON) or a GitHub repository.';
  /**
   * @property {string[]} examples - Illustrative examples of how to use the command.
   * Displayed in the CLI help output.
   */
  static override examples = [
    '<%= config.bin %> <%= command.id %> urls.txt --puppeteerType=cluster --concurrency=10',
    '<%= config.bin %> <%= command.id %> --githubRepo https://github.com/owner/repo/blob/main/urls.txt --numUrls 50',
    '<%= config.bin %> <%= command.id %> urls.csv --range="1-100" --chunkSize=20 --outputDir=./scan_results --logDir=./scan_logs',
    '<%= config.bin %> <%= command.id %> --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-100000-domains --skipProcessed',
    '<%= config.bin %> <%= command.id %> urls.txt --skipProcessed --resetTracking',
    '<%= config.bin %> <%= command.id %> urls.txt --batchMode --startUrl=10001 --totalUrls=5000 --batchSize=250 --skipProcessed',
    '<%= config.bin %> <%= command.id %> urls.txt --batchMode --startUrl=1 --totalUrls=1000 --batchSize=100 --resumeBatch=5',
  ];
  /**
   * @property {object} flags - Defines the command-line flags accepted by this command.
   * Refer to `scan-options.ts` for detailed descriptions of each flag.
   */
  static override flags = scanFlags;

  /**
   * Creates the {@link PrebidExplorerOptions} object based on the parsed command-line flags.
   * This private helper method maps CLI flags to the options expected by the `prebidExplorer` function.
   *
   * @private
   * @param {Interfaces.InferredFlags<typeof Scan.flags>} flags - The parsed flags object from oclif.
   * @returns {PrebidExplorerOptions} An options object for `prebidExplorer`.
   */
  private _getPrebidExplorerOptions(
    flags: Interfaces.InferredFlags<typeof Scan.flags>
  ): PrebidExplorerOptions {
    return {
      puppeteerType: flags.puppeteerType as 'vanilla' | 'cluster', // Cast ensured by flag options
      concurrency: flags.concurrency,
      headless: flags.headless,
      monitor: flags.monitor,
      outputDir: flags.outputDir,
      logDir: flags.logDir,
      numUrls: flags.numUrls,
      range: flags.range,
      chunkSize: flags.chunkSize,
      skipProcessed: flags.skipProcessed,
      resetTracking: flags.resetTracking,
      prefilterProcessed: flags.prefilterProcessed,
      forceReprocess: flags.forceReprocess,
      puppeteerLaunchOptions: {
        headless: flags.headless, // Ensure headless state is consistent
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Default args for broader compatibility
        // Other user-provided puppeteerLaunchOptions might be merged here if a flag for them is added
      },
      // inputFile and githubRepo are determined and added by _getInputSourceOptions
    };
  }

  /**
   * Determines the input source (file or GitHub repository) based on provided arguments and flags.
   * It updates the `options` object with `inputFile` or `githubRepo` accordingly.
   * This method prioritizes `githubRepo` if both are somehow provided (though CLI flags should prevent this).
   * It logs the chosen source and warns if `inputFile` is ignored.
   *
   * @private
   * @param {Interfaces.InferredArgs<typeof Scan.args>} args - The parsed arguments object.
   * @param {Interfaces.InferredFlags<typeof Scan.flags>} flags - The parsed flags object.
   * @param {PrebidExplorerOptions} options - The options object to be updated.
   * @throws {Error} If no input source (neither `inputFile` argument nor `githubRepo` flag) is specified.
   */
  private _getInputSourceOptions(
    args: Interfaces.InferredArgs<typeof Scan.args>,
    flags: Interfaces.InferredFlags<typeof Scan.flags>,
    options: PrebidExplorerOptions
  ): void {
    if (flags.githubRepo) {
      this.log(`Fetching URLs from GitHub repository: ${flags.githubRepo}`);
      options.githubRepo = flags.githubRepo;
      // Warn if inputFile arg is provided but will be ignored (excluding default value for inputFile if that's how it's handled)
      if (args.inputFile && args.inputFile !== scanArgs.inputFile.default) {
        this.warn(
          `--githubRepo provided, inputFile argument ('${args.inputFile}') will be ignored.`
        );
      }
    } else if (args.inputFile) {
      this.log(`Using input file: ${args.inputFile}`);
      options.inputFile = args.inputFile;
    } else {
      // This should ideally be caught by oclif's argument/flag requirement system if configured appropriately.
      // However, as a safeguard:
      this.error(
        'No input source specified. Please provide the inputFile argument or use the --githubRepo flag.',
        { exit: 1 }
      );
    }
  }

  /**
   * Validates batch mode parameters
   * @private
   * @param flags - The parsed flags object
   */
  private _validateBatchMode(flags: Interfaces.InferredFlags<typeof Scan.flags>): void {
    if (flags.batchMode) {
      if (!flags.startUrl || !flags.totalUrls) {
        this.error('Batch mode requires both --startUrl and --totalUrls flags.', { exit: 1 });
      }
      if (flags.startUrl < 1) {
        this.error('--startUrl must be 1 or greater.', { exit: 1 });
      }
      if (flags.totalUrls < 1) {
        this.error('--totalUrls must be 1 or greater.', { exit: 1 });
      }
      if (flags.batchSize < 1) {
        this.error('--batchSize must be 1 or greater.', { exit: 1 });
      }
      if (flags.resumeBatch && flags.resumeBatch < 1) {
        this.error('--resumeBatch must be 1 or greater.', { exit: 1 });
      }
    }
  }

  /**
   * Runs batch processing mode
   * @private
   * @param flags - The parsed flags object
   * @param args - The parsed arguments object
   * @param baseOptions - Base options for prebidExplorer
   */
  private async _runBatchMode(
    flags: Interfaces.InferredFlags<typeof Scan.flags>,
    args: Interfaces.InferredArgs<typeof Scan.args>,
    baseOptions: PrebidExplorerOptions
  ): Promise<void> {
    const logger = loggerModule.instance;
    const startUrl = flags.startUrl!;
    const totalUrls = flags.totalUrls!;
    const batchSize = flags.batchSize;
    const endUrl = startUrl + totalUrls - 1;
    const totalBatches = Math.ceil(totalUrls / batchSize);
    const resumeFromBatch = flags.resumeBatch || 1;

    // Batch progress tracking
    const progressFile = `batch-progress-${startUrl}-${endUrl}.json`;
    let batchProgress: any = { completedBatches: [], failedBatches: [], startTime: new Date().toISOString() };
    
    // Load existing progress if resuming
    try {
      const fs = await import('fs');
      if (fs.existsSync(progressFile)) {
        batchProgress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      }
    } catch (e) {
      // Start fresh if can't load progress
    }

    logger.info('========================================');
    logger.info('BATCH PROCESSING MODE');
    logger.info('========================================');
    logger.info(`📊 Total URLs to process: ${totalUrls.toLocaleString()}`);
    logger.info(`📍 Starting from URL: ${startUrl.toLocaleString()}`);
    logger.info(`📍 Ending at URL: ${endUrl.toLocaleString()}`);
    logger.info(`📦 Batch size: ${batchSize.toLocaleString()}`);
    logger.info(`🔢 Total batches: ${totalBatches}`);
    if (resumeFromBatch > 1) {
      logger.info(`▶️  Resuming from batch: ${resumeFromBatch}`);
    }
    logger.info('========================================');

    let successfulBatches = 0;
    let failedBatches = 0;

    for (let batchNum = resumeFromBatch; batchNum <= totalBatches; batchNum++) {
      const batchStartUrl = startUrl + (batchNum - 1) * batchSize;
      const batchEndUrl = Math.min(batchStartUrl + batchSize - 1, endUrl);
      const range = `${batchStartUrl}-${batchEndUrl}`;
      
      logger.info(`\n🔄 Processing batch ${batchNum}/${totalBatches}: URLs ${range}`);
      logger.info(`⏰ Started at: ${new Date().toLocaleTimeString()}`);
      logger.info(`📊 Batch progress: ${((batchNum - 1) / totalBatches * 100).toFixed(1)}% complete`);
      logger.info(`📁 Log directory: ${`${flags.logDir}-batch-${batchNum.toString().padStart(3, '0')}`}`);
      
      // Show estimated completion based on average batch time
      if (batchProgress.completedBatches.length > 0) {
        const avgDuration = batchProgress.completedBatches.reduce((sum: number, b: any) => sum + b.duration, 0) / batchProgress.completedBatches.length;
        const remainingBatches = totalBatches - batchNum + 1;
        const estimatedMinutes = Math.ceil((avgDuration * remainingBatches) / 60);
        logger.info(`⏳ Estimated time remaining: ~${estimatedMinutes} minutes`);
      }

      // Create batch-specific options
      const batchOptions: PrebidExplorerOptions = {
        ...baseOptions,
        range: range,
        logDir: `${flags.logDir}-batch-${batchNum.toString().padStart(3, '0')}`,
      };

      const batchStartTime = Date.now();
      
      try {
        await prebidExplorer(batchOptions);
        const batchDuration = (Date.now() - batchStartTime) / 1000;
        
        logger.info(`✅ Batch ${batchNum} completed successfully in ${batchDuration.toFixed(1)}s`);
        logger.info(`📊 Overall progress: ${batchNum}/${totalBatches} batches (${(batchNum / totalBatches * 100).toFixed(1)}%)`);
        successfulBatches++;
        
        // Update progress with comprehensive statistics
        batchProgress.completedBatches.push({
          batchNumber: batchNum,
          range: range,
          completedAt: new Date().toISOString(),
          duration: batchDuration,
          statistics: {
            note: 'Detailed statistics available in individual batch logs'
          }
        });
        
      } catch (error) {
        const batchDuration = (Date.now() - batchStartTime) / 1000;
        
        logger.error(`❌ Batch ${batchNum} failed after ${batchDuration.toFixed(1)}s:`, error);
        failedBatches++;
        
        // Update progress
        batchProgress.failedBatches.push({
          batchNumber: batchNum,
          range: range,
          failedAt: new Date().toISOString(),
          duration: batchDuration,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // Continue with next batch instead of stopping
        logger.warn(`⏭️  Continuing with next batch...`);
      }

      // Save progress after each batch
      try {
        const fs = await import('fs');
        fs.writeFileSync(progressFile, JSON.stringify(batchProgress, null, 2));
      } catch (e) {
        logger.warn('Could not save batch progress:', e);
      }

      // Brief pause between batches to avoid overwhelming the system
      if (batchNum < totalBatches) {
        logger.info('⏸️  Pausing 5 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Collect comprehensive statistics from all batches
    let totalUrlsInRange = totalUrls;
    let totalUrlsProcessed = 0;
    let totalUrlsSkipped = 0;
    let totalSuccessfulExtractions = 0;
    let totalErrors = 0;
    let totalNoAdTech = 0;
    
    // Parse log files to gather detailed statistics
    for (let batchNum = 1; batchNum <= successfulBatches; batchNum++) {
      const logDir = `${flags.logDir}-batch-${batchNum.toString().padStart(3, '0')}`;
      const logFile = `${logDir}/app.log`;
      
      try {
        const fs = await import('fs');
        if (fs.existsSync(logFile)) {
          const logContent = fs.readFileSync(logFile, 'utf8');
          
          // Extract statistics from log content
          const processedMatch = logContent.match(/🔄 URLs actually processed: (\d+)/);
          const skippedMatch = logContent.match(/⏭️  URLs skipped \(already processed\): (\d+)/);
          const successMatch = logContent.match(/🎯 Successful data extractions: (\d+)/);
          const errorMatch = logContent.match(/⚠️  Errors encountered: (\d+)/);
          const noAdTechMatch = logContent.match(/🚫 No ad tech found: (\d+)/);
          
          if (processedMatch) totalUrlsProcessed += parseInt(processedMatch[1]);
          if (skippedMatch) totalUrlsSkipped += parseInt(skippedMatch[1]);
          if (successMatch) totalSuccessfulExtractions += parseInt(successMatch[1]);
          if (errorMatch) totalErrors += parseInt(errorMatch[1]);
          if (noAdTechMatch) totalNoAdTech += parseInt(noAdTechMatch[1]);
        }
      } catch (e) {
        logger.warn(`Could not parse statistics from batch ${batchNum} logs`);
      }
    }

    // Final batch summary
    const totalTime = new Date().getTime() - new Date(batchProgress.startTime).getTime();
    const totalMinutes = Math.floor(totalTime / (1000 * 60));
    const totalSeconds = Math.floor((totalTime % (1000 * 60)) / 1000);

    logger.info('\n========================================');
    logger.info('BATCH PROCESSING COMPLETE');
    logger.info('========================================');
    logger.info(`📦 Total batches processed: ${totalBatches}`);
    logger.info(`✅ Successful batches: ${successfulBatches}`);
    logger.info(`❌ Failed batches: ${failedBatches}`);
    logger.info(`⏱️  Total time: ${totalMinutes}m ${totalSeconds}s`);
    logger.info(`📊 Success rate: ${((successfulBatches / totalBatches) * 100).toFixed(1)}%`);
    logger.info(`🎯 URL range processed: ${startUrl.toLocaleString()}-${endUrl.toLocaleString()} (${totalUrls.toLocaleString()} URLs)`);
    
    // Comprehensive statistics summary
    logger.info('');
    logger.info('📊 COMPREHENSIVE STATISTICS:');
    logger.info(`   📋 Total URLs in range: ${totalUrlsInRange.toLocaleString()}`);
    logger.info(`   🔄 URLs actually processed: ${totalUrlsProcessed.toLocaleString()}`);
    if (totalUrlsSkipped > 0) {
      logger.info(`   ⏭️  URLs skipped (previously processed): ${totalUrlsSkipped.toLocaleString()}`);
    }
    logger.info(`   🎯 Successful data extractions: ${totalSuccessfulExtractions.toLocaleString()}`);
    logger.info(`   ⚠️  Errors encountered: ${totalErrors.toLocaleString()}`);
    logger.info(`   🚫 No ad tech found: ${totalNoAdTech.toLocaleString()}`);
    
    // Calculate success rates
    if (totalUrlsProcessed > 0) {
      const extractionRate = ((totalSuccessfulExtractions / totalUrlsProcessed) * 100).toFixed(1);
      const errorRate = ((totalErrors / totalUrlsProcessed) * 100).toFixed(1);
      const noAdTechRate = ((totalNoAdTech / totalUrlsProcessed) * 100).toFixed(1);
      
      logger.info('');
      logger.info('📈 SUCCESS RATES:');
      logger.info(`   🎯 Data extraction rate: ${extractionRate}%`);
      logger.info(`   ⚠️  Error rate: ${errorRate}%`);
      logger.info(`   🚫 No ad tech rate: ${noAdTechRate}%`);
    }
    
    // Add information about data storage and next steps
    logger.info('');
    logger.info('📁 DATA STORAGE:');
    logger.info('   • Successful extractions: store/Jun-2025/ directory');
    logger.info('   • Error categorization: errors/ directory');
    logger.info('   • Processing history: data/url-tracker.db');
    logger.info('   • Batch progress: batch-progress-*.json files');
    
    // Next steps and recommendations
    logger.info('');
    if (successfulBatches === totalBatches && failedBatches === 0) {
      logger.info('🎉 ALL BATCHES COMPLETED SUCCESSFULLY!');
      logger.info('');
      logger.info('💡 NEXT SUGGESTED ACTIONS:');
      const nextStart = endUrl + 1;
      const nextEnd = endUrl + totalUrls;
      logger.info(`   • Process next range: --startUrl=${nextStart} --totalUrls=${totalUrls} --batchSize=${batchSize}`);
      if (totalSuccessfulExtractions > 0) {
        logger.info(`   • Review extracted data: ls -la store/Jun-2025/`);
      }
      if (totalErrors > 0) {
        logger.info(`   • Investigate errors: cat errors/error_processing.txt`);
      }
    } else if (failedBatches > 0) {
      logger.info('⚠️  SOME BATCHES FAILED');
      logger.info('');
      logger.info('🔧 TO RETRY FAILED BATCHES:');
      batchProgress.failedBatches.forEach((failed: any) => {
        logger.info(`   node ./bin/run.js scan ${args.inputFile || ''} --range "${failed.range}" --skipProcessed --chunkSize ${flags.chunkSize} --headless --logDir logs-retry-${failed.batchNumber}`);
      });
    }
    
    // Data verification suggestions
    if (totalSuccessfulExtractions === 0 && totalUrlsProcessed === 0 && totalUrlsSkipped === totalUrls) {
      logger.info('');
      logger.info('📝 ALL URLS WERE PREVIOUSLY PROCESSED:');
      logger.info('   • This range has been fully processed before');
      logger.info('   • Use different range to process new URLs');
      logger.info('   • Or use --resetTracking to reprocess this range');
    } else if (totalSuccessfulExtractions === 0) {
      logger.info('');
      logger.info('📝 NO DATA EXTRACTED:');
      logger.info('   • Check error logs for issues');
      logger.info('   • Most URLs may not have ad technology');
      logger.info('   • Verify URL format and accessibility');
    }
    
    logger.info('');
    logger.info(`📁 Progress saved to: ${progressFile}`);
    logger.info('========================================');
  }

  /**
   * Executes the scan command.
   * This method orchestrates the scanning process by:
   * 1. Parsing command-line arguments and flags.
   * 2. Initializing the logger using the `logDir` flag.
   * 3. Preparing options for the `prebidExplorer` function.
   * 4. Invoking `prebidExplorer` to perform the scan (or batch processing).
   * 5. Handling successful completion or errors, logging appropriately, and exiting.
   *
   * @async
   * @public
   * @returns {Promise<void>} A promise that resolves when the scan is complete or an error is handled.
   */
  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Scan);

    // Validate batch mode parameters if enabled
    this._validateBatchMode(flags);

    // Initialize logger here so it's available for all subsequent operations, including option processing.
    // Note: loggerModule.instance will be set by initializeLogger.
    initializeLogger(flags.logDir, flags.verbose); // Pass the verbose flag
    const logger = loggerModule.instance;

    const options = this._getPrebidExplorerOptions(flags);
    this._getInputSourceOptions(args, flags, options); // This method might call this.error and exit

    // Handle batch mode vs single scan mode
    if (flags.batchMode) {
      logger.info(`Starting Prebid batch scan with options:`);
      const loggableOptions = { ...options };
      if (loggableOptions.puppeteerLaunchOptions) {
        loggableOptions.puppeteerLaunchOptions = {
          args: loggableOptions.puppeteerLaunchOptions.args,
          headless: loggableOptions.puppeteerLaunchOptions.headless,
        };
      }
      logger.info(JSON.stringify(loggableOptions, null, 2));

      try {
        await this._runBatchMode(flags, args, options);
        this.log('Batch processing completed successfully.');
      } catch (error: unknown) {
        this.error(`Batch processing failed: ${error instanceof Error ? error.message : String(error)}`, { exit: 1 });
      }
    } else {
      // Original single scan mode
      logger.info(`Starting Prebid scan with options:`);
      // Log the options (excluding potentially sensitive puppeteerLaunchOptions if necessary in future)
      const loggableOptions = { ...options };
      if (loggableOptions.puppeteerLaunchOptions) {
        // For brevity or security, you might choose to summarize or exclude puppeteerLaunchOptions
        loggableOptions.puppeteerLaunchOptions = {
          args: loggableOptions.puppeteerLaunchOptions.args,
          headless: loggableOptions.puppeteerLaunchOptions.headless,
        };
      }
      logger.info(JSON.stringify(loggableOptions, null, 2));

      try {
        await prebidExplorer(options);
        this.log('Prebid scan completed successfully.');
      } catch (error: unknown) {
      // Logger should already be initialized here.
      let userMessage = 'An unexpected error occurred during the Prebid scan.';
      let suggestions = ['Check logs for more details.'];

      if (error instanceof AppError) {
        // Ensure stack is logged if verbose or if it's an unexpected AppError
        // The logger itself will handle the actual printing of the stack based on its level and formatters
        logger.error(`AppError during Prebid scan: ${error.message}`, {
          details: error.details
            ? JSON.stringify(error.details, null, 2)
            : undefined,
          stack: error.stack, // stack is already included
        });
        userMessage = error.details?.errorCode
          ? `Scan failed with code: ${error.details.errorCode}. Message: ${error.message}`
          : error.message;
        if (error.details?.errorCode === 'PUPPETEER_LAUNCH_FAILED') {
          suggestions.push(
            'Ensure Chrome/Chromium is installed correctly and puppeteer has permissions.'
          );
        } else if (error.details?.errorCode?.includes('_FAILED')) {
          suggestions.push(
            'This might indicate a problem with Puppeteer setup or resource accessibility.'
          );
        }
      } else if (error instanceof Error) {
        // Stack is already included for logger.error
        logger.error(`Error during Prebid scan: ${error.message}`, {
          stack: error.stack,
        });
        userMessage = error.message;
      } else {
        logger.error('An unknown error occurred during Prebid scan.', {
          errorDetail: JSON.stringify(error, null, 2), // Already stringified
        });
      }

      // this.error will show stack trace if OCLIF_DEBUG is set.
      // Our verbose flag primarily controls our application logger's verbosity.
      // For oclif's error reporting, the user can use OCLIF_DEBUG for oclif's own verbose output.
      this.error(userMessage, {
        exit: 1,
        suggestions,
      });
      }
    }
  }
}
