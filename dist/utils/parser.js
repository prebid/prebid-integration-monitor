import * as fs from 'fs';
import * as readline from 'readline';
async function parsePreloadUrls() {
    let loadList = [];
    const urlsRl = readline.createInterface({
        input: fs.createReadStream('src/input.txt'), // Adjusted path
        crlfDelay: Infinity // Ensure correct line splitting
    });
    for await (const url of urlsRl) {
        const trimmedUrl = url.trim();
        if (trimmedUrl) { // Ensure not to push empty strings if file has blank lines
            loadList.push(trimmedUrl);
        }
    }
    console.log(loadList);
    // TODO: Decide what to do with loadList. Currently, it's just logged.
    // For example, write it to a file or return it.
}
parsePreloadUrls().catch(console.error);
