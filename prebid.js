import * as fs from 'fs';
import * as readline from 'readline'
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'


async function prebidExplorer() {
    const browser = await puppeteer
    .use(StealthPlugin())
    .launch({
        protocolTimeout: 300000,
        defaultViewport: null,
        headless: true
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(150000);
  
    const urls = readline.createInterface({
      input: fs.createReadStream('input.txt')
    });


  
    for await (const url of urls) {
      console.log(`Line from file: ${url}`);
      
      await page.goto(url);
      await page.evaluate(async () => {
        const sleep = ms => new Promise(res => setTimeout(res, ms));
        await sleep((1000 * 60) * .40);
      })

      const hasPrebid = await page.evaluate(() => {
        if (window._pbjsGlobals) {
            return true
        } else  {
            return false
        }
      })

      const prebidObj = await page.evaluate(() => {
        if (window._pbjsGlobals && window._pbjsGlobals.includes('pbjs')) {
            return {
                url : location.href,
                version : pbjs.version,
                modules : pbjs.installedModules,
                eids : pbjs.getUserIdsAsEids()
            }

        } else {
            return null
        }
      });



      console.log(prebidObj)
      console.log(hasPrebid)
        

    }
  }
  
  prebidExplorer();