import { defineConfig } from 'vitest/config';
import path from 'path'; // Make sure to import path

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: [
      // Specific alias for the problematic import, using the new path style.
      {
        find: './../common/AppError.js', // Adjusted path
        replacement: path.resolve(__dirname, 'src/common/AppError.ts'),
      },
      // Also add one for the test file which imports AppError from a different relative path
      // src/utils/__tests__/file-system-utils.test.ts imports '../../common/AppError.js'
      {
        find: '../../common/AppError.js',
        replacement: path.resolve(__dirname, 'src/common/AppError.ts'),
      },
    ],
  },
});
