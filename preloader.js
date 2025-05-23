import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

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
  const inputFile = path.join('input', 'preload_urls.txt'); // Define the input file path
  const errorOutputFile = path.join('errors', 'preload_errors.txt'); // Define the error output file path
  const errorDir = path.dirname(errorOutputFile); // Get the directory for the error file

  let urls = [];

  // Read URLs from the input file
  try {
    const fileContent = fs.readFileSync(inputFile, 'utf8');
    urls = fileContent.split('\n').map(url => url.trim()).filter(url => url.length > 0); // Split by newline, trim whitespace, remove empty lines
  } catch (err) {
    console.error(`Error reading URLs from ${inputFile}:`, err.message);
    if (err.code === 'ENOENT') {
      console.error(`Please ensure the file exists and the script has permission to read it.`);
    }
    return; // Exit if the file cannot be read
  }


  if (urls.length === 0) {
    console.log(`No URLs found in ${inputFile}.`);
    return;
  }

  console.log(`Processing ${urls.length} URLs...`);
  const { validUrls, invalidUrls } = await processUrls(urls);

    // Write valid URLs to input.txt, each on a new line
  try {
    fs.appendFileSync('input.txt', validUrls.join('\n'));
    console.log(`Successfully wrote ${validUrls.length} valid URLs to input.txt`);
  } catch (err) {
    console.error('Error writing to input.txt:', err);
  }

  // Write invalid URLs to the error file
  if (invalidUrls.length > 0) {
    const errorLines = invalidUrls.map(item => {
      const statusCode = item.statusCode || 'N/A'; // Handle cases where statusCode might not exist (e.g., curl error)
      const errorMsg = item.error || 'N/A'; // Handle cases where error message might not exist
      return `${item.url} , ${statusCode} , ${errorMsg}`;
    });

    try {
      // Ensure the errors directory exists
      if (!fs.existsSync(errorDir)) {
        fs.mkdirSync(errorDir, { recursive: true }); // Create directory if it doesn't exist
        console.log(`Created directory: ${errorDir}`);
      }
      fs.appendFileSync(errorOutputFile, errorLines.join('\n'));
      console.log(`Successfully wrote ${invalidUrls.length} invalid URL details to ${errorOutputFile}`);
    } catch (err) {
      console.error(`Error writing to ${errorOutputFile}:`, err);
    }
  } else {
    console.log('No invalid URLs found to write to the error file.');
    // Optionally clear the error file if it exists and no errors were found
    try {
        if (fs.existsSync(errorOutputFile)) {
            fs.appendFileSync(errorOutputFile, ''); // Write an empty string to clear it
            console.log(`Cleared existing error file: ${errorOutputFile}`);
        }
    } catch (err) {
        console.error(`Error clearing ${errorOutputFile}:`, err);
    }
  }
}

main();