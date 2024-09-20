import * as fs from 'fs';
import { createObjectCsvWriter } from 'csv-writer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'


const urls = ['https://techcrunch.com','https://www.cbsnews.com','https://www.cnbc.com' , 'https://www.foxnews.com']

const arraySearch = async () => {
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

            if (index < urls.length) {
                await page.goto(value);
                await page.evaluate(async () => {
                    const sleep = ms => new Promise(res => setTimeout(res, ms));
                    await sleep((1000 * 60) * .25);

                    if (!window._pbjsGlobals) {

                    }
                })
            } else {
                await page.close();
                await browser.close();
            }
        }
    } catch (e) {
        console.log(e)

    } finally {
        await page.close();
        await browser.close();
    }
    
}

arraySearch()