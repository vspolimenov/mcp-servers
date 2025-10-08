#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';

import { COLLECTION_NAME, LOCATION_TYPES } from './src/shared/city-constants.js';
import { validateCityData } from './src/shared/city-validation.js';
import { OverpassService } from './src/services/overpass-service.js';
import { WikipediaService } from './src/services/wikipedia-service.js';
import { WikidataService } from './src/services/wikidata-service.js';

// Firebase initialization
const firebaseConfig = {
    projectId: "trip-planner-adb36"
};

let app;
try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('Using GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
        app = initializeApp({
            credential: applicationDefault(),
            projectId: firebaseConfig.projectId
        });
    } else {
        const serviceAccountPath = join(process.cwd(), 'service-account-key.json');
        const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
        console.error('Using service account file:', serviceAccountPath);
        app = initializeApp({
            credential: cert(serviceAccount),
            projectId: firebaseConfig.projectId
        });
    }
} catch (error) {
    console.error('Failed to initialize Firebase:', error.message);
    process.exit(1);
}

const firestore = getFirestore(app);
const overpassService = new OverpassService();
const wikipediaService = new WikipediaService();
const wikidataService = new WikidataService();

/**
 * Search for a city/location with caching and enrichment
 */
async function searchCity(cityName) {
    if (!cityName || typeof cityName !== 'string') {
        throw new Error('City name is required');
    }

    const normalizedName = cityName.trim();

    // Step 1: Check Firebase cache
    console.error(`Searching for "${normalizedName}" in Firebase cache...`);
    const cacheQuery = await firestore.collection(COLLECTION_NAME)
        .where('name', '==', normalizedName)
        .limit(1)
        .get();

    if (!cacheQuery.empty) {
        console.error(`Found "${normalizedName}" in cache`);
        const doc = cacheQuery.docs[0];
        return {
            ...doc.data(),
            id: doc.id,
            source: 'cache'
        };
    }

    // Step 2: Query Over pass
    console.error(`"${normalizedName}" not in cache, querying OSM...`);
    const osmResults = await overpassService.searchByName(normalizedName);

    if (osmResults.length === 0) {
        throw new Error(`No results found for "${normalizedName}"`);
    }

    // Take the first (most relevant) result
    const osmData = osmResults[0];

    // Step 3: Enrich with Wikipedia
    let wikipediaData = null;
    if (osmData.wikipedia) {
        console.error(`Fetching Wikipedia data for ${osmData.wikipedia}...`);
        wikipediaData = await wikipediaService.getInfo(osmData.wikipedia);
    }

    // Step 4: Enrich with Wikidata (with fallback handling)
    let wikidataData = null;
    if (osmData.wikidata) {
        console.error(`Fetching Wikidata info for ${osmData.wikidata}...`);
        try {
            wikidataData = await wikidataService.getInfo(osmData.wikidata);
        } catch (error) {
            console.error(`⚠️  Wikidata unavailable for ${osmData.wikidata}: ${error.message}`);
            console.error(`🔄 Continuing without Wikidata enrichment...`);
            // Continue without Wikidata data - don't fail the entire search
            wikidataData = null;
        }
    }

    // Step 5: Merge all data
    const enrichedData = {
        name: osmData.name,
        type: osmData.type,
        lat: osmData.lat,
        lon: osmData.lon,
        osmId: osmData.osmId,
        osmType: osmData.osmType,
        osmTags: osmData.osmTags,

        // Wikipedia data
        description: wikipediaData?.description || wikidataData?.description,
        wikipediaUrl: wikipediaData?.url,
        wikipediaLang: wikipediaData?.lang,

        // Wikidata structured data
        population: wikidataData?.population,
        elevation: wikidataData?.elevation || (osmData.osmTags.ele ? parseInt(osmData.osmTags.ele) : null),
        area: wikidataData?.area,
        officialWebsite: wikidataData?.officialWebsite,

        // Images
        images: [
            wikipediaData?.image,
            wikipediaData?.thumbnail,
            ...(wikidataData?.images || [])
        ].filter(Boolean),

        // Metadata
        wikidataId: osmData.wikidata,
        wikipediaTag: osmData.wikipedia,
        lastUpdated: new Date().toISOString(),
        source: 'osm'
    };

    // Validate before saving
    const validation = validateCityData(enrichedData);
    if (!validation.valid) {
        console.error('Validation errors:', validation.errors);
        throw new Error(`Invalid city data: ${validation.errors.map(e => e.message).join('; ')}`);
    }

    // Step 6: Save to Firebase cache
    console.error(`Saving "${normalizedName}" to Firebase cache...`);
    const docRef = await firestore.collection(COLLECTION_NAME).add(enrichedData);

    return {
        ...enrichedData,
        id: docRef.id
    };
}

/**
 * Get city by ID from Firebase
 */
async function getCityById(cityId) {
    const doc = await firestore.collection(COLLECTION_NAME).doc(cityId).get();
    if (!doc.exists) {
        throw new Error(`City with ID "${cityId}" not found`);
    }
    return { id: doc.id, ...doc.data() };
}

/**
 * List all cached cities
 */
async function listCities(params = {}) {
    const limit = params.limit || 50;
    let query = firestore.collection(COLLECTION_NAME).orderBy('name').limit(limit);

    if (params.type) {
        query = firestore.collection(COLLECTION_NAME)
            .where('type', '==', params.type)
            .orderBy('name')
            .limit(limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Define MCP tools
const TOOLS = [
    {
        name: 'search_city',
        description: 'Search for a city/location by name. Checks cache first, then queries OSM/Wikipedia/Wikidata if needed.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the city/location to search for (e.g., "София", "Витоша")'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'get_city_by_id',
        description: 'Get a city/location by its Firebase document ID',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'Firebase document ID'
                }
            },
            required: ['id']
        }
    },
    {
        name: 'list_cities',
        description: 'List all cached cities/locations',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum number of results',
                    default: 50
                },
                type: {
                    type: 'string',
                    description: 'Filter by location type',
                    enum: LOCATION_TYPES
                }
            }
        }
    }
];

// Create MCP server
const server = new Server(
    {
        name: 'cities-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'search_city':
                if (!args?.name) {
                    throw new Error('City name is required');
                }
                const city = await searchCity(args.name);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(city, null, 2),
                        },
                    ],
                };

            case 'get_city_by_id':
                if (!args?.id) {
                    throw new Error('City ID is required');
                }
                const cityById = await getCityById(args.id);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(cityById, null, 2),
                        },
                    ],
                };

            case 'list_cities':
                const cities = await listCities(args || {});
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(cities, null, 2),
                        },
                    ],
                };

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ error: error.message }, null, 2),
                },
            ],
            isError: true,
        };
    }
});

// Start server
async function main() {
    try {
        console.error('Testing Firebase connection...');
        await firestore.collection(COLLECTION_NAME).limit(1).get();
        console.error('Firebase connection successful!');

        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('Cities MCP Server running on stdio');
        console.error('Available tools:', TOOLS.map(t => t.name).join(', '));
    } catch (error) {
        console.error('Failed to start MCP server:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);