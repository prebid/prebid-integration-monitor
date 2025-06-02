import { Command } from '@oclif/core';
import { updateAndCleanStats } from '../../utils/update_stats.js'; // Ensure .js extension for runtime
// Optional: Replicate __dirname functionality if complex pathing were needed, but probably not for this simple command
// const __filename: string = fileURLToPath(import.meta.url);
// const __dirname: string = path.dirname(__filename);
class StatsGenerate extends Command {
    // No arguments or flags needed for this command as per current requirements
    // static override args = {};
    // static override flags = {};
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
StatsGenerate.description = 'Generates or updates the API statistics file (api/api.json) by processing stored website scan data. This includes summarizing data, cleaning it, and applying version and module categorization.';
StatsGenerate.examples = [
    '<%= config.bin %> <%= command.id %>',
    '$ prebid-explorer stats:generate',
];
export default StatsGenerate;
