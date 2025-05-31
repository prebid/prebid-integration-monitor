# Prebid Integration Monitor

This script (`prebid.js`) is designed to crawl a list of URLs and check for the presence and version of Prebid.js, along with other ad-related JavaScript libraries like Amazon's A9 (apstag.js), Google Ad Manager (googletag.js), and ATS.js. It uses `puppeteer-cluster` for efficient parallel processing of URLs.

## Features

-   **URL Processing**: Reads a list of URLs from `input.txt`.
-   **Library Detection**: Identifies presence of:
    -   Prebid.js (and its version and loaded modules)
    -   Googletag.js
    -   Apstag.js (Amazon A9)
    -   ATS.js
-   **Parallel Crawling**: Utilizes `puppeteer-cluster` to process multiple URLs in parallel, significantly speeding up the crawling process.
-   **Optimized Page Loading**: Uses `domcontentloaded` and avoids unnecessary fixed delays for faster page interaction.
-   **Data Output**:
    -   Saves detected library information to a date-stamped JSON file (`output/Month/YYYY-MM-DD.json`). Each line in the JSON file is a separate JSON object representing a processed URL.
    -   Logs URLs where no specified libraries were found to `errors/no_prebid.txt`.
    -   Logs URLs that resulted in processing errors (e.g., network errors, page crashes) to `errors/error_processing.txt`, along with an error code.
-   **Input File Management**: Removes processed URLs from `input.txt` after an attempt, so subsequent runs process remaining URLs.

## Prerequisites

-   Node.js (v16 or later recommended, due to ES module usage)
-   npm (Node Package Manager, comes with Node.js)

## Setup

1.  **Clone the repository (if you haven't already):**
    ```bash
    git clone <repository-url>
    cd prebid-integration-monitor
    ```

2.  **Install Dependencies:**
    Navigate to the project directory and run:
    ```bash
    npm install
    ```
    This will install `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`, and `puppeteer-cluster`. Other direct dependencies like `fs` and `path` are built-in Node.js modules.

3.  **Prepare Input URLs:**
    Create a file named `input.txt` in the root of the project directory. Add one URL per line. For example:
    ```
    https://www.example.com
    https://www.anothersite.org
    https://www.somewebpage.net/article/123
    ```

## Running the Script

To run the Prebid integration monitor, execute the following command from the project's root directory:

```bash
node prebid.js
```

The script will:
-   Read URLs from `input.txt`.
-   Process them in parallel.
-   Create/update output files in the `output/` and `errors/` directories.
-   Update `input.txt` by removing the URLs that were processed.

## Output Files

-   **`output/Month/YYYY-MM-DD.json`**:
    -   Contains detailed information about the libraries found on each successfully processed URL that had at least one detectable library.
    -   Each line is a JSON object. Example:
        ```json
        {"libraries":["googletag","apstag"],"prebidInstances":[{"globalVarName":"pbjs","version":"8.10.0","modules":["moduleA","moduleB"]}],"date":"2024-03-15","url":"https://www.example.com"}
        ```
-   **`errors/no_prebid.txt`**:
    -   A list of URLs where none of the targeted libraries (Prebid.js, googletag, apstag, ats) were detected. One URL per line.
-   **`errors/error_processing.txt`**:
    -   A list of URLs that could not be processed due to errors (e.g., page timeout, network error, evaluation error).
    -   Format: `url,ERROR_CODE_OR_MESSAGE`
    -   Example: `https://www.nonexistenturl123.com,ERR_NAME_NOT_RESOLVED`
-   **`input.txt`**:
    -   After the script runs, this file will be overwritten with only the URLs that were not processed in the current run (e.g., if the script was interrupted or for future runs). If all URLs were processed, this file will be empty.

## Testing

The project includes tests for its core functionalities.

-   **Test Files**:
    -   `prebid.test.mjs`: Contains tests for `prebid.js`.
    -   `cluster.test.mjs`: Contains tests for `cluster.cjs` (a related utility script, if present and used).
-   **Running Tests**:
    If a test script is configured in `package.json` (e.g., under `"scripts": { "test": "vitest" }`), you can run:
    ```bash
    npm test
    ```
    Otherwise, you might need to run the test runner directly (e.g., `npx vitest run`). The tests are written using `vitest` which follows a Jest-like syntax. Ensure `vitest` is installed (e.g., `npm install --save-dev vitest`).

## How it Works (prebid.js)

1.  **Initialization**: Reads URLs from `input.txt`.
2.  **Cluster Setup**: Initializes `puppeteer-cluster` with specified concurrency (e.g., 5 parallel pages).
3.  **Task Definition**: Defines a task for the cluster:
    -   Navigates to a URL.
    -   Sets a realistic User-Agent.
    -   Waits for `domcontentloaded` for initial page readiness.
    -   Uses `page.evaluate()` to inspect `window` object for `pbjs`, `googletag`, `apstag`, and `ats` objects.
    -   Collects Prebid.js version and installed modules if available.
4.  **Queueing**: Adds all URLs to the cluster's queue. Each task execution is handled by the cluster.
5.  **Results Handling**:
    -   A callback function processes the result of each task.
    -   Successful detections are stored in a `results` array.
    -   URLs without detectable libraries are added to a `noPrebidUrls` set.
    -   URLs that cause errors during processing are added to an `errorUrls` set with an error code.
6.  **Completion**: After all tasks are processed (`cluster.idle()`):
    -   The cluster is closed (`cluster.close()`).
    -   Collected data is written to the respective output and error files.
    -   `input.txt` is updated.

This script provides an automated way to monitor Prebid.js and related ad-tech library integrations across a large number of websites.
