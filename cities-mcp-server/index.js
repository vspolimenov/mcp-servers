#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    COLLECTION_NAME,
    LOCATION_TYPES,
    COLLECTIONS,
    getCollectionForType
} from './src/shared/location-constants.js';
import { validateLocationData } from './src/shared/location-validation.js';
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
 * Search for a location with caching and enrichment
 * Uses the appropriate collection based on location type
 */
async function searchLocation(locationName, locationType = null, category = null) {
    if (!locationName || typeof locationName !== 'string') {
        throw new Error('Location name is required');
    }

    const normalizedName = locationName.trim();

    // Determine which collection to use
    let collectionName = COLLECTION_NAME; // default fallback
    if (locationType) {
        collectionName = getCollectionForType(locationType);
    } else if (category) {
        collectionName = category;
    }

    // Step 1: Check Firebase cache in the appropriate collection
    console.error(`Searching for "${normalizedName}"${locationType ? ` (type: ${locationType})` : ''} in ${collectionName} collection...`);
    let cacheQuery = firestore.collection(collectionName)
        .where('name', '==', normalizedName);

    if (locationType) {
        cacheQuery = cacheQuery.where('type', '==', locationType);
    }

    const cacheSnapshot = await cacheQuery.limit(1).get();

    if (!cacheSnapshot.empty) {
        console.error(`Found "${normalizedName}" in cache`);
        const doc = cacheSnapshot.docs[0];
        return {
            ...doc.data(),
            id: doc.id,
            source: 'cache',
            collection: collectionName
        };
    }

    // Step 2: Query Overpass based on category
    console.error(`"${normalizedName}" not in cache, querying OSM...`);
    let osmResults;

    if (locationType) {
        osmResults = await overpassService.searchByName(normalizedName, locationType);
    } else if (category === COLLECTIONS.CITIES) {
        osmResults = await overpassService.searchCities(normalizedName);
    } else if (category === COLLECTIONS.MOUNTAINS) {
        osmResults = await overpassService.searchMountains(normalizedName);
    } else if (category === COLLECTIONS.PEAKS) {
        osmResults = await overpassService.searchPeaks(normalizedName);
    } else if (category === COLLECTIONS.NATURAL_SITES) {
        osmResults = await overpassService.searchNaturalSites(normalizedName);
    } else if (category === COLLECTIONS.CULTURAL_SITES) {
        osmResults = await overpassService.searchCulturalSites(normalizedName);
    } else {
        osmResults = await overpassService.searchByName(normalizedName, locationType);
    }

    if (osmResults.length === 0) {
        throw new Error(`No results found for "${normalizedName}"`);
    }

    // Take the first (most relevant) result
    const osmData = osmResults[0];

    // Update collection based on actual type found
    const actualCollection = getCollectionForType(osmData.type);

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
        ...(wikipediaData?.description || wikidataData?.description ? { description: wikipediaData?.description || wikidataData?.description } : {}),
        ...(wikipediaData?.url ? { wikipediaUrl: wikipediaData.url } : {}),
        ...(wikipediaData?.lang ? { wikipediaLang: wikipediaData.lang } : {}),

        // Wikidata structured data
        ...(wikidataData?.population ? { population: wikidataData.population } : {}),
        ...(wikidataData?.elevation || osmData.osmTags.ele ? { elevation: wikidataData?.elevation || parseInt(osmData.osmTags.ele) } : {}),
        ...(wikidataData?.area ? { area: wikidataData.area } : {}),
        ...(wikidataData?.officialWebsite ? { officialWebsite: wikidataData.officialWebsite } : {}),

        // Images
        images: [
            wikipediaData?.image,
            wikipediaData?.thumbnail,
            ...(wikidataData?.images || [])
        ].filter(Boolean),

        // Metadata
        ...(osmData.wikidata ? { wikidataId: osmData.wikidata } : {}),
        ...(osmData.wikipedia ? { wikipediaTag: osmData.wikipedia } : {}),
        lastUpdated: new Date().toISOString(),
        source: 'osm'
    };

    // Validate before saving
    const validation = validateLocationData(enrichedData);
    if (!validation.valid) {
        console.error('Validation errors:', validation.errors);
        throw new Error(`Invalid location data: ${validation.errors.map(e => e.message).join('; ')}`);
    }

    // Step 6: Save to Firebase cache in the appropriate collection
    console.error(`Saving "${normalizedName}" to ${actualCollection} collection...`);
    const docRef = await firestore.collection(actualCollection).add(enrichedData);

    return {
        ...enrichedData,
        id: docRef.id,
        collection: actualCollection
    };
}

/**
 * Get location by ID from Firebase (searches across all collections)
 */
async function getLocationById(locationId, collectionName = null) {
    // If collection is specified, search only that collection
    if (collectionName) {
        const doc = await firestore.collection(collectionName).doc(locationId).get();
        if (!doc.exists) {
            throw new Error(`Location with ID "${locationId}" not found in ${collectionName}`);
        }
        return { id: doc.id, collection: collectionName, ...doc.data() };
    }

    // Otherwise search across all collections
    const collections = [COLLECTIONS.CITIES, COLLECTIONS.MOUNTAINS, COLLECTIONS.NATURAL_SITES, COLLECTIONS.CULTURAL_SITES];

    for (const collection of collections) {
        const doc = await firestore.collection(collection).doc(locationId).get();
        if (doc.exists) {
            return { id: doc.id, collection, ...doc.data() };
        }
    }

    throw new Error(`Location with ID "${locationId}" not found`);
}

/**
 * List all cached locations from a specific collection
 */
async function listLocations(params = {}) {
    const limit = params.limit || 50;
    const collectionName = params.collection || COLLECTIONS.CITIES;

    let query = firestore.collection(collectionName).orderBy('name').limit(limit);

    if (params.type) {
        query = firestore.collection(collectionName)
            .where('type', '==', params.type)
            .orderBy('name')
            .limit(limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, collection: collectionName, ...doc.data() }));
}

// Define MCP tools
const TOOLS = [
    {
        name: 'search_cities',
        description: 'Search specifically for cities, towns, or villages. Only returns populated places (cities/towns/villages). Uses the "cities" Firebase collection. Required types: city, town, village.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the city, town, or village to search for (e.g., "София", "Пловдив")'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'search_mountains',
        description: 'Search specifically for mountain ranges. Only returns mountain range features. Uses the "mountains" Firebase collection. Required types: mountain_range.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the mountain range to search for (e.g., "Рила", "Пирин")'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'search_peaks',
        description: 'Search specifically for peaks. Only returns peak features. Uses the "peaks" Firebase collection. Required types: peak.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the peak to search for (e.g., "Мусала", "Вихрен")'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'search_natural_sites',
        description: 'Search specifically for natural sites like caves and waterfalls. Uses the "natural_sites" Firebase collection. Required types: cave, waterfall.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the natural site to search for (e.g., "Деветашка пещера", "Крушунски водопади")'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'search_cultural_sites',
        description: 'Search specifically for cultural and historic sites (monasteries, castles, museums, monuments, etc.). Uses the "cultural_sites" Firebase collection. Required types: castle, fort, ruins, archaeological_site, monastery, memorial, church, museum, attraction, viewpoint, alpine_hut.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the cultural/historic site to search for (e.g., "Рилски манастир", "Царевец")'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'search_location',
        description: 'General location search (legacy). Tries cities first, then natural features, then cultural sites. Use specific search tools (search_cities, search_mountains, etc.) for better performance.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the location to search for'
                },
                type: {
                    type: 'string',
                    description: 'Optional: Specific type of location to search for',
                    enum: LOCATION_TYPES
                }
            },
            required: ['name']
        }
    },
    {
        name: 'get_location_by_id',
        description: 'Get a location by its Firebase document ID',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description: 'Firebase document ID'
                },
                collection: {
                    type: 'string',
                    description: 'Optional: Specific collection to search in (cities, mountains, peaks, natural_sites, cultural_sites)',
                    enum: ['cities', 'mountains', 'peaks', 'natural_sites', 'cultural_sites']
                }
            },
            required: ['id']
        }
    },
    {
        name: 'list_locations',
        description: 'List all cached locations from a specific collection',
        inputSchema: {
            type: 'object',
            properties: {
                collection: {
                    type: 'string',
                    description: 'Collection to list from',
                    enum: ['cities', 'mountains', 'peaks', 'natural_sites', 'cultural_sites'],
                    default: 'cities'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results',
                    default: 50
                },
                type: {
                    type: 'string',
                    description: 'Filter by specific location type',
                    enum: LOCATION_TYPES
                }
            }
        }
    }
];

// Create MCP server
const server = new Server(
    {
        name: 'locations-mcp-server',
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
            case 'search_cities':
                if (!args?.name) {
                    throw new Error('Location name is required');
                }
                const city = await searchLocation(args.name, null, COLLECTIONS.CITIES);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(city, null, 2),
                        },
                    ],
                };

            case 'search_mountains':
                if (!args?.name) {
                    throw new Error('Location name is required');
                }
                const mountain = await searchLocation(args.name, null, COLLECTIONS.MOUNTAINS);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(mountain, null, 2),
                        },
                    ],
                };

            case 'search_peaks':
                if (!args?.name) {
                    throw new Error('Location name is required');
                }
                const peak = await searchLocation(args.name, null, COLLECTIONS.PEAKS);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(peak, null, 2),
                        },
                    ],
                };

            case 'search_natural_sites':
                if (!args?.name) {
                    throw new Error('Location name is required');
                }
                const naturalSite = await searchLocation(args.name, null, COLLECTIONS.NATURAL_SITES);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(naturalSite, null, 2),
                        },
                    ],
                };

            case 'search_cultural_sites':
                if (!args?.name) {
                    throw new Error('Location name is required');
                }
                const culturalSite = await searchLocation(args.name, null, COLLECTIONS.CULTURAL_SITES);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(culturalSite, null, 2),
                        },
                    ],
                };

            case 'search_location':
                if (!args?.name) {
                    throw new Error('Location name is required');
                }
                const location = await searchLocation(args.name, args.type || null);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(location, null, 2),
                        },
                    ],
                };

            case 'get_location_by_id':
                if (!args?.id) {
                    throw new Error('Location ID is required');
                }
                const locationById = await getLocationById(args.id, args.collection || null);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(locationById, null, 2),
                        },
                    ],
                };

            case 'list_locations':
                const locations = await listLocations(args || {});
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(locations, null, 2),
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
        // Test all collections
        await Promise.all([
            firestore.collection(COLLECTIONS.CITIES).limit(1).get(),
            firestore.collection(COLLECTIONS.MOUNTAINS).limit(1).get(),
            firestore.collection(COLLECTIONS.NATURAL_SITES).limit(1).get(),
            firestore.collection(COLLECTIONS.CULTURAL_SITES).limit(1).get()
        ]);
        console.error('Firebase connection successful!');
        console.error('Collections: cities, mountains, natural_sites, cultural_sites');

        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('Locations MCP Server running on stdio');
        console.error('Available tools:', TOOLS.map(t => t.name).join(', '));
    } catch (error) {
        console.error('Failed to start MCP server:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);