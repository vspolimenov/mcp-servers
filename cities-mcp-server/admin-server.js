#!/usr/bin/env node
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { OverpassService } from './src/services/overpass-service.js';
import { WikipediaService } from './src/services/wikipedia-service.js';
import { WikidataService } from './src/services/wikidata-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3005;
const overpassService = new OverpassService();
const wikipediaService = new WikipediaService();
const wikidataService = new WikidataService();

// Simple rate limiting
const requestCounts = new Map();
const RATE_LIMIT = 10; // Max 10 requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function isRateLimited(ip) {
    const now = Date.now();
    const requests = requestCounts.get(ip) || [];
    
    // Remove old requests outside the window
    const recentRequests = requests.filter(time => now - time < RATE_WINDOW);
    
    if (recentRequests.length >= RATE_LIMIT) {
        return true;
    }
    
    // Add current request
    recentRequests.push(now);
    requestCounts.set(ip, recentRequests);
    
    return false;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           '127.0.0.1';
}

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const clientIP = getClientIP(req);
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} from ${clientIP}`);
    
    try {
        if (url.pathname === '/' || url.pathname === '/admin') {
            // Serve admin page
            const html = readFileSync(join(__dirname, 'admin.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            
        } else if (url.pathname === '/api/test-overpass' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Rate limit exceeded. Max 10 requests per minute.'
                }));
                return;
            }

            // Handle Overpass API test
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const { searchTerm, locationType } = JSON.parse(body);

                    if (!searchTerm || typeof searchTerm !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid searchTerm' }));
                        return;
                    }

                    console.log(`🔍 Testing Overpass search for: "${searchTerm}"${locationType ? ` (type: ${locationType})` : ''}`);

                    const startTime = Date.now();
                    const results = await overpassService.searchByName(searchTerm, locationType || null);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    const response = {
                        searchTerm,
                        locationType: locationType || 'general',
                        results,
                        count: results.length,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: 'success'
                    };

                    console.log(`✅ Found ${results.length} results in ${responseTime}ms`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));

                } catch (error) {
                    console.error(`❌ Overpass error:`, error.message);

                    const errorResponse = {
                        searchTerm: JSON.parse(body).searchTerm,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };

                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });

        } else if (url.pathname === '/api/test-cities' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Rate limit exceeded. Max 10 requests per minute.'
                }));
                return;
            }

            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const { searchTerm } = JSON.parse(body);

                    if (!searchTerm || typeof searchTerm !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid searchTerm' }));
                        return;
                    }

                    console.log(`🏙️ Testing cities search for: "${searchTerm}"`);

                    const startTime = Date.now();
                    const results = await overpassService.searchCities(searchTerm);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    const response = {
                        searchTerm,
                        category: 'cities',
                        results,
                        count: results.length,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: 'success'
                    };

                    console.log(`✅ Found ${results.length} cities in ${responseTime}ms`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));

                } catch (error) {
                    console.error(`❌ Cities search error:`, error.message);

                    const errorResponse = {
                        searchTerm: JSON.parse(body).searchTerm,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };

                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });

        } else if (url.pathname === '/api/test-mountains' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Rate limit exceeded. Max 10 requests per minute.'
                }));
                return;
            }

            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const { searchTerm } = JSON.parse(body);

                    if (!searchTerm || typeof searchTerm !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid searchTerm' }));
                        return;
                    }

                    console.log(`⛰️ Testing mountains search for: "${searchTerm}"`);

                    const startTime = Date.now();
                    const results = await overpassService.searchMountains(searchTerm);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    const response = {
                        searchTerm,
                        category: 'mountains',
                        results,
                        count: results.length,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: 'success'
                    };

                    console.log(`✅ Found ${results.length} mountains in ${responseTime}ms`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));

                } catch (error) {
                    console.error(`❌ Mountains search error:`, error.message);

                    const errorResponse = {
                        searchTerm: JSON.parse(body).searchTerm,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };

                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });

        } else if (url.pathname === '/api/test-natural-sites' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Rate limit exceeded. Max 10 requests per minute.'
                }));
                return;
            }

            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const { searchTerm } = JSON.parse(body);

                    if (!searchTerm || typeof searchTerm !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid searchTerm' }));
                        return;
                    }

                    console.log(`🏞️ Testing natural sites search for: "${searchTerm}"`);

                    const startTime = Date.now();
                    const results = await overpassService.searchNaturalSites(searchTerm);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    const response = {
                        searchTerm,
                        category: 'natural_sites',
                        results,
                        count: results.length,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: 'success'
                    };

                    console.log(`✅ Found ${results.length} natural sites in ${responseTime}ms`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));

                } catch (error) {
                    console.error(`❌ Natural sites search error:`, error.message);

                    const errorResponse = {
                        searchTerm: JSON.parse(body).searchTerm,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };

                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });

        } else if (url.pathname === '/api/test-cultural-sites' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Rate limit exceeded. Max 10 requests per minute.'
                }));
                return;
            }

            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const { searchTerm } = JSON.parse(body);

                    if (!searchTerm || typeof searchTerm !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid searchTerm' }));
                        return;
                    }

                    console.log(`🏛️ Testing cultural sites search for: "${searchTerm}"`);

                    const startTime = Date.now();
                    const results = await overpassService.searchCulturalSites(searchTerm);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    const response = {
                        searchTerm,
                        category: 'cultural_sites',
                        results,
                        count: results.length,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: 'success'
                    };

                    console.log(`✅ Found ${results.length} cultural sites in ${responseTime}ms`);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));

                } catch (error) {
                    console.error(`❌ Cultural sites search error:`, error.message);

                    const errorResponse = {
                        searchTerm: JSON.parse(body).searchTerm,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };

                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });

        } else if (url.pathname === '/api/test-wikipedia' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Rate limit exceeded. Max 10 requests per minute.' 
                }));
                return;
            }
            
            // Handle Wikipedia API test
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            
            req.on('end', async () => {
                try {
                    const { wikipediaTag } = JSON.parse(body);
                    
                    if (!wikipediaTag || typeof wikipediaTag !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid wikipediaTag' }));
                        return;
                    }
                    
                    console.log(`📖 Testing Wikipedia lookup for: "${wikipediaTag}"`);
                    
                    const startTime = Date.now();
                    const result = await wikipediaService.getInfo(wikipediaTag);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;
                    
                    const response = {
                        wikipediaTag,
                        result,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: result ? 'success' : 'no_data'
                    };
                    
                    console.log(`✅ Wikipedia lookup completed in ${responseTime}ms`);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));
                    
                } catch (error) {
                    console.error(`❌ Wikipedia error:`, error.message);
                    
                    const errorResponse = {
                        wikipediaTag: JSON.parse(body).wikipediaTag,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };
                    
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });
            
        } else if (url.pathname === '/api/test-wikidata' && req.method === 'POST') {
            // Rate limiting check
            if (isRateLimited(clientIP)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Rate limit exceeded. Max 10 requests per minute.' 
                }));
                return;
            }
            
            // Handle Wikidata API test
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            
            req.on('end', async () => {
                try {
                    const { wikidataId } = JSON.parse(body);
                    
                    if (!wikidataId || typeof wikidataId !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing or invalid wikidataId' }));
                        return;
                    }
                    
                    console.log(`🌐 Testing Wikidata lookup for: "${wikidataId}"`);
                    
                    const startTime = Date.now();
                    const result = await wikidataService.getInfo(wikidataId);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;
                    
                    const response = {
                        wikidataId,
                        result,
                        responseTime,
                        timestamp: new Date().toISOString(),
                        status: result ? 'success' : 'no_data'
                    };
                    
                    console.log(`✅ Wikidata lookup completed in ${responseTime}ms`);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response, null, 2));
                    
                } catch (error) {
                    console.error(`❌ Wikidata error:`, error.message);
                    
                    const errorResponse = {
                        wikidataId: JSON.parse(body).wikidataId,
                        error: error.message,
                        timestamp: new Date().toISOString(),
                        status: 'error'
                    };
                    
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errorResponse, null, 2));
                }
            });
            
        } else if (url.pathname === '/api/stats') {
            // Simple stats endpoint
            const stats = {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString(),
                rateLimits: Array.from(requestCounts.entries()).map(([ip, requests]) => ({
                    ip,
                    requestCount: requests.length
                }))
            };
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats, null, 2));
            
        } else {
            // 404 Not Found
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
        
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
}

// Create and start server
const server = createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`🚀 Locations MCP Admin Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin page: http://localhost:${PORT}/admin`);
    console.log(`\n🔧 API endpoints:`);
    console.log(`   General:`);
    console.log(`   - Overpass: http://localhost:${PORT}/api/test-overpass`);
    console.log(`\n   Category-specific:`);
    console.log(`   - Cities: http://localhost:${PORT}/api/test-cities`);
    console.log(`   - Mountains: http://localhost:${PORT}/api/test-mountains`);
    console.log(`   - Natural Sites: http://localhost:${PORT}/api/test-natural-sites`);
    console.log(`   - Cultural Sites: http://localhost:${PORT}/api/test-cultural-sites`);
    console.log(`\n   External APIs:`);
    console.log(`   - Wikipedia: http://localhost:${PORT}/api/test-wikipedia`);
    console.log(`   - Wikidata: http://localhost:${PORT}/api/test-wikidata`);
    console.log(`\n📈 Stats: http://localhost:${PORT}/api/stats`);
    console.log('\n🔍 Ready to test location searches by category with rate limiting (10 requests/minute)');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down admin server...');
    server.close(() => {
        console.log('✅ Server closed.');
        process.exit(0);
    });
});

export default server;