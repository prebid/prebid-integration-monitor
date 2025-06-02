import * as fs from 'fs';
import * as readline from 'readline';

async function parsePreloadUrls(): Promise<void> {
    let loadList: string[] = [];

    const urlsRl = readline.createInterface({
        input: fs.createReadStream('src/input.txt'),
        crlfDelay: Infinity
    });

    for await (const url of urlsRl) {
        const trimmedUrl: string = url.trim();
        if (trimmedUrl) {
            loadList.push(trimmedUrl);
        }
    }
    console.log(loadList);
}

parsePreloadUrls().catch(console.error);