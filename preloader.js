import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkUrl(url) {
  try {
    // Use curl to check the HTTP status code. -I for header-only, -s for silent, -o /dev/null to discard output.
    const { stdout, stderr } = await execAsync(`curl --max-time 25 -I -s -o /dev/null -w "%{http_code}" ${url}`);
    const statusCode = parseInt(stdout.trim(), 10);

    if (statusCode >= 200 && statusCode < 400) {
      return { url, valid: true };
    } else {
      return { url, valid: false, statusCode }; // Include status code for invalid URLs
    }
  } catch (error) {
    // Handle errors like network issues or invalid URLs that curl can't process
    console.error(`Error checking ${url}:`, error.message);
    return { url, valid: false, error: error.message }; // Include the error message
  }
}

async function processUrls(urls) {
  const results = await Promise.all(urls.map(checkUrl));

  const validUrls = results.filter(result => result.valid).map(result => result.url);
  const invalidUrls = results.filter(result => !result.valid);

  return { validUrls, invalidUrls };
}

async function main() {
  const urls = [
    'http://www.zwskw.com',
    'http://www.myauto.ge',
    'http://www.igogo.es',
    'http://www.400.cn',
    'http://www.php.su',
    'http://www.ableton.com',
    'http://www.mapbox.com',
    'http://www.creditexpert.co.uk',
    'http://www.gaoloumi.com',
    'http://www.xbabe.com',
    'http://www.floorplanner.com',
    'http://www.content-watch.ru',
    'http://www.fbaba.net',
    'http://www.joomag.com',
    'http://www.bonnych.com',
    'http://www.htcampus.com',
    'http://www.deperu.com',
    'http://www.reforma.com',
    'http://www.unianhanguera.edu.br',
    'http://www.vitonica.com',
    'http://www.kirklands.com',
    'http://www.shabiba.com',
    'http://www.appps.jp',
    'http://www.kaufland.de',
    'http://www.tododiarios.com',
    'http://www.rusprofile.ru',
    'http://www.kudago.com',
    'http://www.doctorjob.com.cn',
    'http://www.inverse.com',
    'http://www.mbank.cz',
    'http://www.uwcu.org',
    'http://www.princetonreview.com',
    'http://www.zoosnet.net',
    'http://www.file.rocks',
    'http://www.girlplays.ru',
    'http://www.esic.nic.in',
    'http://www.selfgrowth.com',
    'http://www.nintendolife.com',
    'http://www.greennews.ng',
    'http://www.excelforum.com',
    'http://www.sgvps.net',
    'http://www.blab.im',
    'http://www.landofnod.com',
    'http://www.trunkroute.com',
    'http://www.arlandatravel.com',
    'http://www.wooribank.com',
    'http://www.future-shop.jp',
    'http://www.cloudgate.jp',
    'http://www.sexix.net',
    'http://www.yawajisb.com',
    'http://www.rozup.ir',
    'http://www.dosya.tc',
    'http://www.marisa.com.br',
    'http://www.moondoge.co.in',
    'http://www.matomesakura.com',
    'http://www.web-ip.ru',
    'http://www.telkomsel.com',
    'http://www.codeinwp.com',
    'http://www.topdocumentaryfilms.com',
    'http://www.cervantes.es',
    'http://www.nopcommerce.com',
    'http://www.hungerrush.com',
    'http://www.yelp.fr',
    'http://www.techsupportforum.com',
    'http://www.manheim.com',
    'http://www.yofrefile.com',
    'http://www.abt.com',
    'http://www.evanscycles.com',
    'http://www.topsante.com',
    'http://www.hackstore.net',
    'http://www.uchile.cl',
    'http://www.cpalead.com',
    'http://www.repec.org',
    'http://www.chinawidth.cn',
    'http://www.mstaml.com',
    'http://www.sportstarlive.com',
    'http://www.egotasticallstars.com',
    'http://www.portalbank.no',
    'http://www.worldtimeserver.com',
    'http://www.inter-edu.com',
    'http://www.buhaoting.com',
    'http://www.hk01.com',
    'http://www.omni-cash.net',
    'http://www.green-red.com',
    'http://www.stitchlabs.com',
    'http://www.lokmat.com',
    'http://www.polito.it',
    'http://www.aip.org',
    'http://www.allo.ua',
    'http://www.teechip.com',
    'http://www.tn8.tv',
    'http://www.differencebetween.net',
    'http://www.2cpu.co.kr',
    'http://www.efsyn.gr',
    'http://www.loudwire.com',
    'http://www.payu.com.tr',
    'http://www.wmzona.com',
    'http://www.belgianrail.be',
    'http://www.techmahindra.com'
  ];

  const { validUrls, invalidUrls } = await processUrls(urls);

  console.log('Valid URLs:');
  validUrls.forEach(url => console.log(url));

  console.log('\nInvalid URLs:');
  invalidUrls.forEach(url => {
    console.log(url);
    if(url.statusCode){
        console.log(`Status Code: ${url.statusCode}`);
    }
    if (url.error) {
      console.log(`Error: ${url.error}`);
    }
    console.log("---")
  });
}

main();