/**
 * GitHub API Communication Module
 * 
 * WHY:
 * - Need a consistent interface to interact with GitHub's GraphQL API
 * - GitHub's API often requires pagination to handle large result sets
 * - Authentication and error handling should be centralized
 * 
 * HOW:
 * - Uses Octokit's GraphQL client to make authenticated API requests
 * - Implements pagination helpers to handle large result sets
 * - Verifies API token availability at startup
 * 
 * WHAT:
 * - Exports an authenticated GraphQL client for API operations
 * - Provides a fetchPaginated helper to handle paginated queries
 * - Handles different response formats and error conditions
 */

import { graphql } from '@octokit/graphql';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// Ensure GitHub token is set in environment variables
const GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN;
if (!GITHUB_API_TOKEN) {
  console.error('Error: GITHUB_API_TOKEN environment variable is not set.');
  process.exit(1);
}

// Configure graphql client with authentication
const originalGraphQLWithAuth = graphql.defaults({
  headers: {
    authorization: `bearer ${GITHUB_API_TOKEN}`
  }
});

// Default cache settings
const DEFAULT_CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
const CACHE_DIR = path.join(os.tmpdir(), 'gs-pro-api-cache');

// Create cache directory if it doesn't exist
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Get global caching configuration from CLI arguments
 * @returns {Object} - Object with useCache and cacheTTL properties
 */
function getGlobalCacheConfig() {
  // Get command line arguments
  const args = process.argv;
  
  // Check for --no-cache flag (commander transforms this to a cache property)
  const noCache = args.includes('--no-cache');
  // Get cache TTL if specified
  const cacheTTLIndex = args.indexOf('--cache-ttl');
  const cacheTTL = cacheTTLIndex !== -1 && cacheTTLIndex < args.length - 1 
    ? parseInt(args[cacheTTLIndex + 1], 10) 
    : DEFAULT_CACHE_TTL;
  
  return {
    useCache: !noCache,
    cacheTTL: isNaN(cacheTTL) ? DEFAULT_CACHE_TTL : cacheTTL
  };
}

/**
 * Generate a unique cache key from the query and variables
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {string} - Unique hash for this request
 */
function generateCacheKey(query, variables) {
  const content = JSON.stringify({ query, variables });
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Get cached response if it exists and is valid
 * @param {string} cacheKey - The key for the cached item
 * @param {number} cacheTTL - Time to live in milliseconds
 * @returns {Object|null} - Cached response or null if not found/expired
 */
function getCachedResponse(cacheKey, cacheTTL) {
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  
  if (!fs.existsSync(cacheFile)) {
    return null;
  }
  
  try {
    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const now = new Date().getTime();
    
    // Check if cache is still valid
    if (now - cacheData.timestamp < cacheTTL) {
      return cacheData.data;
    }
  } catch (err) {
    console.warn(`Cache read error: ${err.message}`);
  }
  
  return null;
}

/**
 * Save response to cache
 * @param {string} cacheKey - The key for the item
 * @param {Object} data - The data to cache
 */
function saveToCache(cacheKey, data) {
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  const cacheData = {
    timestamp: new Date().getTime(),
    data
  };
  
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData));
  } catch (err) {
    console.warn(`Cache write error: ${err.message}`);
  }
}

/**
 * Make a GraphQL request to GitHub API with authentication
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {Object} options - Additional options
 * @param {boolean} options.useCache - Whether to use cache
 * @param {number} options.cacheTTL - Cache TTL in milliseconds
 * @returns {Promise<Object>} - Query result
 */
export async function graphQLWithAuth(query, variables, options = {}) {
  // Get global cache settings and merge with provided options
  const globalConfig = getGlobalCacheConfig();
  const { 
    useCache = globalConfig.useCache, 
    cacheTTL = globalConfig.cacheTTL 
  } = options;
  
  // Check cache first if enabled
  if (useCache) {
    const cacheKey = generateCacheKey(query, variables);
    const cachedResponse = getCachedResponse(cacheKey, cacheTTL);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If not in cache, make the request and cache the result
    const response = await originalGraphQLWithAuth(query, variables);
    saveToCache(cacheKey, response);
    return response;
  }
  
  // If cache is disabled, directly make the request
  return await originalGraphQLWithAuth(query, variables);
}

/**
 * Fetch paginated results with caching support
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {Function} getNextPage - Function to extract next page info
 * @param {Object} options - Cache options
 * @returns {Promise<Array>} - All results
 */
export async function fetchPaginated(query, variables, getNextPage, options = {}) {
  const allItems = [];
  let hasNextPage = true;
  let after = null;
  
  // Get global cache settings and merge with provided options
  const globalConfig = getGlobalCacheConfig();
  const mergedOptions = {
    useCache: options.useCache !== undefined ? options.useCache : globalConfig.useCache,
    cacheTTL: options.cacheTTL !== undefined ? options.cacheTTL : globalConfig.cacheTTL
  };
  
  while (hasNextPage) {
    const queryVars = { ...variables };
    if (after) {
      queryVars.after = after;
    }
    
    // Use the cached graphQLWithAuth function
    const result = await graphQLWithAuth(query, queryVars, mergedOptions);
    const pageInfo = getNextPage(result);
    
    if (pageInfo.nodes && Array.isArray(pageInfo.nodes)) {
      allItems.push(...pageInfo.nodes);
    }
    
    hasNextPage = pageInfo.pageInfo && pageInfo.pageInfo.hasNextPage;
    after = pageInfo.pageInfo && pageInfo.pageInfo.endCursor;
  }
  
  return allItems;
}

/**
 * Clear all cached responses or those older than a specific time
 * @param {number} olderThan - Clear items older than this time in ms (default: clear all)
 */
export function clearCache(olderThan = 0) {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const now = new Date().getTime();
    
    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      
      if (olderThan > 0) {
        try {
          const stats = fs.statSync(filePath);
          const fileAge = now - stats.mtimeMs;
          
          if (fileAge >= olderThan) {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.warn(`Error checking file age: ${err.message}`);
        }
      } else {
        // If olderThan is 0, clear all cache
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error(`Error clearing cache: ${err.message}`);
  }
}
