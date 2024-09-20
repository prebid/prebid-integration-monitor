const { addExtra } = require('puppeteer-extra')
const puppeteerVanilla = require('puppeteer')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { Cluster } = require('puppeteer-cluster')

const puppeteer = addExtra(puppeteerVanilla)
puppeteer.use(StealthPlugin)

const clusterSearch = async () => {
    const cluster = await Cluster.launch({
        puppeteer,
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 1,
        puppeteerOptions: {
            headless: true
        }
    })

    await cluster.task(async ({ page, data: url }) => {
        await page.goto(url, { waitUntil: 'networkidle2' });
        const version = await page.evaluate(() => { pbjs.version });
        console.log(url, version);
    });
    
      cluster.queue('https://www.techcrunch.com/');    
      cluster.queue('https://www.google.com/');
      cluster.queue('https://www.wikipedia.org/');
      cluster.queue('https://www.abcnews.go.com/');
      cluster.queue('https://www.foxnews.com/');
    
      await cluster.idle();
      await cluster.close();
    }

clusterSearch()