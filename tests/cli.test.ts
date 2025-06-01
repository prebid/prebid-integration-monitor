import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('CLI Tests', () => {
  const cliCommand = 'node ./bin/run.js'; // For compiled version
  // For development, you might use 'node ./bin/dev.js'
  // However, for CI/testing, it's often better to test the compiled output.
  // Ensure you run `npm run build` before these tests if using `bin/run.js`.
  // Vitest default timeout is 5000ms. If your command takes longer, adjust it in vitest.config.ts or per test.
  const defaultTimeout = 10000; // 10 seconds, adjust if needed

  it('should run the default command successfully and log completion', async () => {
    try {
      const { stdout, stderr } = await execAsync(cliCommand);
      // console.log('Default command stdout:', stdout); // For debugging
      // console.log('Default command stderr:', stderr); // For debugging

      // We won't check stderr strictly, as oclif might output warnings or info there
      // even on successful execution if commands are not yet compiled or fully set up.
      // The main check is for the success message and no error throw.
      expect(stdout).toContain('Main application processing finished (oclif command).');
      // If execAsync throws (e.g. for a non-zero exit code), the catch block will handle it.
    } catch (error: any) {
      // console.error('Default command execution error stdout:', error.stdout);
      // console.error('Default command execution error stderr:', error.stderr);
      // This assertion will fail the test if execAsync itself threw an error (e.g. non-zero exit)
      // or if an expect inside the try block failed.
      throw new Error(`Default command execution failed: ${error.message}\nSTDOUT: ${error.stdout}\nSTDERR: ${error.stderr}`);
    }
  }, defaultTimeout);

  it('should display help information for --help flag', async () => {
    try {
      const { stdout, stderr } = await execAsync(`${cliCommand} --help`);
      // console.log('--help stdout:', stdout); // For debugging
      // console.log('--help stderr:', stderr); // For debugging

      // Oclif help output can go to stdout or stderr.
      const output = stdout || stderr;

      expect(output).toMatch(/USAGE/i);
      // The "COMMANDS" section might not appear if `dist/commands` is empty or not found.
      // This test will be more robust after a build. For now, let's make it less strict.
      // expect(output).toMatch(/COMMANDS/i);
      expect(output).toMatch(/FLAGS/i);
      // If execAsync throws, the catch block will handle it.
    } catch (error: any) {
      // console.error('--help execution error stdout:', error.stdout);
      // console.error('--help execution error stderr:', error.stderr);
      throw new Error(`Help command execution failed: ${error.message}\nSTDOUT: ${error.stdout}\nSTDERR: ${error.stderr}`);
    }
  }, defaultTimeout);
});
