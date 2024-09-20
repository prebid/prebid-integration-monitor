import * as fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

let payload = []
const OUTPUT_DIRECTORY = 'output';
const urls = ['https://yelp.com','https://www.cbsnews.com','https://www.cnbc.com']
const prebidSearch = async () => {
    const browser = await puppeteer
        .use(StealthPlugin())
        .launch({
            protocolTimeout: 300000,
            defaultViewport: null,
            headless: false
        });

    const page = await browser.newPage();

    try {
        for (let [index, value] of urls.entries()) {
            await page.goto(value);
            const results = await page.evaluate(async () => { 
                 const sleep = ms => new Promise(res => setTimeout(res, ms));
                 await sleep((1000 * 60) * .25); // wait for page to load

                    if (!window._pbjsGlobals) return null; // return null if no PBJS found

                    const result = window._pbjsGlobals.map((pbjs) => {
                        const { version, installedModules } = window[pbjs];
                        return {
                            instance: pbjs, // instance name
                            url: location.href, // url
                            version, // version
                            installedModules // list of installed modules
                        }
                    })
                    return result;
            });
                payload = payload.concat(results);
        }

            if (!fs.existsSync(OUTPUT_DIRECTORY)) fs.mkdirSync(OUTPUT_DIRECTORY);
            const csvWriter = createObjectCsvWriter({
                path: `${OUTPUT_DIRECTORY}/${Date.now()}-output.csv`,
                header: [
                    {id: 'url', title: 'URL'},
                    {id: 'instance', title: 'PBJS Instance'},
                    {id: 'version', title: 'PBJS Version'},
                    {id: 'installedModules', title: 'PBJS Installed Modules'},
                ]
            });
            await csvWriter.writeRecords(payload);
            
        } catch (e) {
            console.log(e)
        } finally {
            await page.close();
            await browser.close();
        }
}

prebidSearch()