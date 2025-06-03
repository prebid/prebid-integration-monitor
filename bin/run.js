#!/usr/bin/env node

// Read TEST_MOCK_ prefixed environment variables and set them on process.env
for (const key in process.env) {
  if (key.startsWith('TEST_MOCK_')) {
    const originalKey = key.substring('TEST_MOCK_'.length);
    process.env[originalKey] = process.env[key];
  }
}

import {execute} from '@oclif/core'

await execute({dir: import.meta.url})
