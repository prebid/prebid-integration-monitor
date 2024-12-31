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
   
  ];

  const { validUrls, invalidUrls } = await processUrls(urls);

  console.log('Valid URLs:');
  validUrls.forEach(url => console.log(url));

  /* console.log('\nInvalid URLs:');
  invalidUrls.forEach(url => {
    console.log(url);
    if(url.statusCode){
        console.log(`Status Code: ${url.statusCode}`);
    }
    if (url.error) {
      console.log(`Error: ${url.error}`);
    }
    console.log("---")
  }); */
}

main();