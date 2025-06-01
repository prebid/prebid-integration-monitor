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
    
      await cluster.idle();
      await cluster.close();
    }

clusterSearch()