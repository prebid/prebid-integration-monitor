import * as fs from 'fs';
import * as readline from 'readline';
import loggerModule from './logger.js'; // Assuming logger.js is in the same directory
const logger = loggerModule.instance;

async function parsePreloadUrls(): Promise<void> {
  let loadList: string[] = [];

  const urlsRl = readline.createInterface({
    input: fs.createReadStream('src/input.txt'),
    crlfDelay: Infinity,
  });

  for await (const url of urlsRl) {
    const trimmedUrl: string = url.trim();
    if (trimmedUrl) {
      loadList.push(trimmedUrl);
    }
  }
  logger.info('Loaded URLs:', { urls: loadList });
}

parsePreloadUrls().catch(error => logger.error('Error in parsePreloadUrls:', { error }));
