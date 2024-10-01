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

    let results = []

    const page = await browser.newPage();
    page.setDefaultTimeout(75000);
  
    const urls = readline.createInterface({
      input: fs.createReadStream('input.txt')
    });


    try {
      for await (const url of urls) {
        console.log(`Line from file: ${url}`);
        
        await page.goto(url , { timeout: 70000, waitUntil: 'networkidle2' });
        await page.evaluate(async () => {
          const sleep = ms => new Promise(res => setTimeout(res, ms));
          await sleep((1000 * 60) * .12);
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
                  modules : pbjs.installedModules
              }

          } else {
              return null
          }
        });

        if (prebidObj != null) {
          results.push(prebidObj)
        }
        
        //console.log(prebidObj)
        //console.log(hasPrebid)
          
      }
    } catch (error) {
        throw new Error(error);
    } finally {
      console.log(results)
        try {
          fs.appendFileSync('output/10k.json', JSON.stringify(results))
        } catch (err) {
          console.error(err)
        }
        if (browser) {
            await browser.close();
      }
    }
  }
  
  prebidExplorer();