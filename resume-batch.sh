#!/bin/bash

# Script to resume batch processing from the last failed or incomplete batch

# Check if batch progress file exists
PROGRESS_FILE=$(ls batch-progress-*.json 2>/dev/null | head -1)

if [ -z "$PROGRESS_FILE" ]; then
    echo "❌ No batch progress file found. Please start a new batch process."
    exit 1
fi

echo "📁 Found progress file: $PROGRESS_FILE"

# Extract range info from filename (e.g., batch-progress-100000-104999.json)
RANGE=$(echo $PROGRESS_FILE | sed 's/batch-progress-\(.*\)\.json/\1/')
START_URL=$(echo $RANGE | cut -d'-' -f1)
END_URL=$(echo $RANGE | cut -d'-' -f2)

# Read the JSON file to find the last completed batch and check for failures
BATCH_INFO=$(node -e "
const fs = require('fs');
const progress = JSON.parse(fs.readFileSync('$PROGRESS_FILE', 'utf8'));
const lastCompleted = progress.completedBatches.length > 0 
    ? progress.completedBatches[progress.completedBatches.length - 1].batchNumber 
    : 0;
const failedBatches = progress.failedBatches || [];
const hasFailures = failedBatches.length > 0;
const firstFailed = hasFailures ? failedBatches[0].batchNumber : 0;
console.log(lastCompleted + ',' + hasFailures + ',' + firstFailed);
")

IFS=',' read -r LAST_COMPLETED HAS_FAILURES FIRST_FAILED <<< "$BATCH_INFO"

# Determine which batch to resume from
if [ "$HAS_FAILURES" = "true" ] && [ "$FIRST_FAILED" -gt 0 ]; then
    NEXT_BATCH=$FIRST_FAILED
    echo "⚠️  Found failed batch #$FIRST_FAILED - will retry it"
else
    NEXT_BATCH=$((LAST_COMPLETED + 1))
fi

# Calculate URLs remaining
TOTAL_URLS=$((END_URL - START_URL + 1))
BATCH_SIZE=500

# Calculate range for the next batch
BATCH_START_URL=$((START_URL + (NEXT_BATCH - 1) * BATCH_SIZE))
BATCH_END_URL=$((BATCH_START_URL + BATCH_SIZE - 1))

if [ $BATCH_START_URL -gt $END_URL ]; then
    echo "✅ All batches have been completed!"
    exit 0
fi

# Adjust end URL if it exceeds the total range
if [ $BATCH_END_URL -gt $END_URL ]; then
    BATCH_END_URL=$END_URL
fi

URLS_REMAINING=$((END_URL - BATCH_START_URL + 1))

echo "📊 Batch Progress Summary:"
echo "   - Original range: $START_URL-$END_URL"
echo "   - Last completed batch: $LAST_COMPLETED"
echo "   - Next batch to process: $NEXT_BATCH"
echo "   - URLs remaining: $URLS_REMAINING"
echo ""
echo "🚀 Resuming from batch $NEXT_BATCH (URLs $BATCH_START_URL-$BATCH_END_URL)"
echo ""
echo "Run this command to resume:"
echo ""
echo "node ./bin/run.js scan --githubRepo https://github.com/zer0h/top-1000000-domains/blob/master/top-1000000-domains --range \"$BATCH_START_URL-$END_URL\" --batchSize=$BATCH_SIZE --skipProcessed"