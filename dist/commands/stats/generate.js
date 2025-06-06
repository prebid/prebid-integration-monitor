import { Command } from '@oclif/core';
import { updateAndCleanStats } from '../../utils/update-stats.js'; // Ensure .js extension for runtime
// Optional: Replicate __dirname functionality if complex pathing were needed, but probably not for this simple command
// const __filename: string = fileURLToPath(import.meta.url);
// const __dirname: string = path.dirname(__filename);
/**
 * Command to generate or update API statistics.
 * This command processes stored website scan data, summarizes it, cleans it,
 * and applies version and module categorization to generate the `api/api.json` file.
 */
export default class StatsGenerate extends Command {
    /**
     * Description of the stats:generate command.
     * This description is displayed when listing commands or showing help for this command.
     */
    static description = 'Generates or updates the API statistics file (api/api.json) by processing stored website scan data. This includes summarizing data, cleaning it, and applying version and module categorization.';
    /**
     * Examples of how to use the stats:generate command.
     * These examples are displayed in the help output for this command.
     */
    static examples = [
        '<%= config.bin %> <%= command.id %>',
        '$ prebid-explorer stats:generate',
    ];
    // No arguments or flags needed for this command as per current requirements
    // static override args = {};
    // static override flags = {};
    /**
     * Executes the stats generation process.
     * This method orchestrates the update and cleaning of statistics by calling `updateAndCleanStats`.
     * It logs the start and successful completion of the process.
     * If an error occurs, it logs a detailed error message and exits with a non-zero status code.
     * @async
     * @returns {Promise<void>} A promise that resolves when the statistics generation is complete or rejects if an error occurs.
     */
    async run() {
        this.log('Starting statistics generation process...');
        try {
            // Assuming updateAndCleanStats handles its own console logging for detailed progress
            await updateAndCleanStats();
            this.log('Statistics generation process completed successfully.');
            this.log('The file api/api.json has been updated.');
        }
        catch (error) {
            // Log the error in a more structured way if possible
            this.error(`An error occurred during statistics generation: ${error.message}`, {
                exit: 1, // oclif recommends exiting with a non-zero code on error
                suggestions: [
                    'Check the console output for more details from the updateAndCleanStats script.',
                    'Ensure that the scan data directory (typically \'store\') contains valid JSON files.',
                    'Verify file permissions for reading scan data and writing to the \'api\' directory.',
                ],
            });
            // For more detailed debugging, you might want to log the full stack trace
            // console.error('Full error stack:', error.stack);
        }
    }
}
