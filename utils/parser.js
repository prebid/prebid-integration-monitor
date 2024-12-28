import * as fs from 'fs';
import * as readline from 'readline';

let loadList = []

const urls = readline.createInterface({
        input: fs.createReadStream('input/preload_urls.txt')
    });

    for await (const url of urls) {
        const trimmedUrl = url.trim();
        loadList.push(trimmedUrl)
    }
console.log(loadList)