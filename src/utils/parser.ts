import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

export const INPUT_FILE_PATH = path.join(__dirname, 'input.txt');

async function parsePreloadUrls(): Promise<void> {
    let loadList: string[] = [];

    const urlsRl = readline.createInterface({ // Renamed to avoid conflict
        input: fs.createReadStream(INPUT_FILE_PATH), // Adjusted path
        crlfDelay: Infinity // Ensure correct line splitting
    });

    for await (const url of urlsRl) {
        const trimmedUrl: string = url.trim();
        if (trimmedUrl) { // Ensure not to push empty strings if file has blank lines
            loadList.push(trimmedUrl);
        }
    }
    console.log(loadList);
    // TODO: Decide what to do with loadList. Currently, it's just logged.
    // For example, write it to a file or return it.
}

parsePreloadUrls().catch(console.error);