#!/bin/bash

# Comprehensive test script for prebidOnly mode
echo "=========================================="
echo "PREBID-ONLY MODE COMPREHENSIVE TESTING"
echo "=========================================="
echo ""

# Test 1: Basic range test
echo "TEST 1: Basic range processing (1-10)"
echo "--------------------------------------"
echo "Command: node ./bin/run.js scan --prebidOnly --range \"1-10\" --forceReprocess --headless"
echo "Expected: Process exactly 10 URLs from database positions 1-10"
echo ""

# Test 2: Mid-range test
echo "TEST 2: Mid-range processing (100-110)"
echo "---------------------------------------"
echo "Command: node ./bin/run.js scan --prebidOnly --range \"100-110\" --forceReprocess --headless"
echo "Expected: Process exactly 11 URLs from database positions 100-110"
echo ""

# Test 3: Batch mode test
echo "TEST 3: Batch mode processing"
echo "------------------------------"
echo "Command: node ./bin/run.js scan --prebidOnly --batchMode --startUrl=1 --totalUrls=20 --batchSize=10 --forceReprocess --headless"
echo "Expected: Process exactly 20 URLs in 2 batches of 10"
echo ""

# Test 4: With config capture
echo "TEST 4: With config and identity capture"
echo "-----------------------------------------"
echo "Command: node ./bin/run.js scan --prebidOnly --range \"1-5\" --prebidConfigDetail=raw --identityUsageDetail=comprehensive --forceReprocess --headless"
echo "Expected: Process 5 URLs with enhanced data capture"
echo ""

# Test 5: Default behavior (no range)
echo "TEST 5: Default behavior without range"
echo "---------------------------------------"
echo "Command: node ./bin/run.js scan --prebidOnly --forceReprocess --headless"
echo "Expected: Process default 100 URLs from database"
echo ""

# Test 6: Large batch test
echo "TEST 6: Large batch processing"
echo "-------------------------------"
echo "Command: node ./bin/run.js scan --prebidOnly --batchMode --startUrl=1 --totalUrls=200 --batchSize=50 --prebidConfigDetail=raw --identityDetail=basic --forceReprocess --headless"
echo "Expected: Process exactly 200 URLs in 4 batches of 50"
echo ""

echo "=========================================="
echo "Test commands ready. Run individually to verify behavior."
echo "Check the following for each test:"
echo "1. Correct number of URLs processed"
echo "2. URLs come from database (not files)"
echo "3. Statistics match expected counts"
echo "4. No errors about missing source files"
echo "=========================================="