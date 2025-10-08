import fetch from 'node-fetch';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TIMEOUT = 25; // Increased from 15 to 25 seconds
const FETCH_TIMEOUT = 30000; // Increased from 20s to 30s

export class OverpassService {
    // Escape special characters in search terms for Overpass queries
    escapeSearchTerm(searchTerm) {
        // Escape special regex characters and quotes that could break the query
        return searchTerm
            .replace(/[\\]/g, '\\\\')  // Escape backslashes first
            .replace(/["]/g, '\\"')    // Escape double quotes
            .replace(/[\[\]]/g, '\\$&') // Escape square brackets
            .replace(/[()]/g, '\\$&')   // Escape parentheses
            .replace(/[.*+?^${}|]/g, '\\$&'); // Escape other regex special chars
    }

    // Build a general query searching all location types
    buildGeneralQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      node["place"]["name"="${searchTerm}"](area.bg);
      way["place"]["name"="${searchTerm}"](area.bg);
      relation["place"]["name"="${searchTerm}"](area.bg);

      node["natural"="peak"]["name"="${searchTerm}"](area.bg);
      node["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      node["natural"="cave"]["name"="${searchTerm}"](area.bg);
      node["natural"="cave_entrance"]["name"="${searchTerm}"](area.bg);
      node["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
      way["natural"="peak"]["name"="${searchTerm}"](area.bg);
      way["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      way["natural"="cave"]["name"="${searchTerm}"](area.bg);
      way["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
      relation["natural"="peak"]["name"="${searchTerm}"](area.bg);
      relation["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      relation["natural"="cave"]["name"="${searchTerm}"](area.bg);
      relation["natural"="waterfall"]["name"="${searchTerm}"](area.bg);

      node["historic"="castle"]["name"="${searchTerm}"](area.bg);
      node["historic"="fort"]["name"="${searchTerm}"](area.bg);
      node["historic"="ruins"]["name"="${searchTerm}"](area.bg);
      node["historic"="archaeological_site"]["name"="${searchTerm}"](area.bg);
      node["historic"="monastery"]["name"="${searchTerm}"](area.bg);
      node["historic"="memorial"]["name"="${searchTerm}"](area.bg);
      node["historic"="church"]["name"="${searchTerm}"](area.bg);
      way["historic"="castle"]["name"="${searchTerm}"](area.bg);
      way["historic"="fort"]["name"="${searchTerm}"](area.bg);
      way["historic"="ruins"]["name"="${searchTerm}"](area.bg);
      way["historic"="archaeological_site"]["name"="${searchTerm}"](area.bg);
      way["historic"="monastery"]["name"="${searchTerm}"](area.bg);
      way["historic"="memorial"]["name"="${searchTerm}"](area.bg);
      way["historic"="church"]["name"="${searchTerm}"](area.bg);
      relation["historic"="castle"]["name"="${searchTerm}"](area.bg);
      relation["historic"="fort"]["name"="${searchTerm}"](area.bg);
      relation["historic"="ruins"]["name"="${searchTerm}"](area.bg);
      relation["historic"="archaeological_site"]["name"="${searchTerm}"](area.bg);
      relation["historic"="monastery"]["name"="${searchTerm}"](area.bg);
      relation["historic"="memorial"]["name"="${searchTerm}"](area.bg);
      relation["historic"="church"]["name"="${searchTerm}"](area.bg);

      node["tourism"="alpine_hut"]["name"="${searchTerm}"](area.bg);
      node["tourism"="viewpoint"]["name"="${searchTerm}"](area.bg);
      node["tourism"="museum"]["name"="${searchTerm}"](area.bg);
      node["tourism"="attraction"]["name"="${searchTerm}"](area.bg);
      way["tourism"="alpine_hut"]["name"="${searchTerm}"](area.bg);
      way["tourism"="viewpoint"]["name"="${searchTerm}"](area.bg);
      way["tourism"="museum"]["name"="${searchTerm}"](area.bg);
      way["tourism"="attraction"]["name"="${searchTerm}"](area.bg);
      relation["tourism"="alpine_hut"]["name"="${searchTerm}"](area.bg);
      relation["tourism"="viewpoint"]["name"="${searchTerm}"](area.bg);
      relation["tourism"="museum"]["name"="${searchTerm}"](area.bg);
      relation["tourism"="attraction"]["name"="${searchTerm}"](area.bg);

      node["amenity"="place_of_worship"]["name"="${searchTerm}"](area.bg);
      way["amenity"="place_of_worship"]["name"="${searchTerm}"](area.bg);
      relation["amenity"="place_of_worship"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    // Build a type-specific query based on the location type
    buildTypeSpecificQuery(searchTerm, locationType) {
        // Map location types to OSM tags
        const typeMapping = {
            'city': ['place', 'city'],
            'town': ['place', 'town'],
            'village': ['place', 'village'],
            'peak': ['natural', 'peak'],
            'mountain_range': ['natural', 'mountain_range'],
            'cave': ['natural', 'cave', 'cave_entrance'],
            'waterfall': ['natural', 'waterfall'],
            'castle': ['historic', 'castle'],
            'fort': ['historic', 'fort'],
            'ruins': ['historic', 'ruins'],
            'archaeological_site': ['historic', 'archaeological_site'],
            'monastery': ['historic', 'monastery'],
            'memorial': ['historic', 'memorial'],
            'church': ['historic', 'church'],
            'alpine_hut': ['tourism', 'alpine_hut'],
            'viewpoint': ['tourism', 'viewpoint'],
            'museum': ['tourism', 'museum'],
            'attraction': ['tourism', 'attraction']
        };

        const mapping = typeMapping[locationType];
        if (!mapping) {
            // Fallback to general query if type is not mapped
            return this.buildGeneralQuery(searchTerm);
        }

        const [category, ...values] = mapping;
        const queries = [];

        // Handle special cases like cave which has multiple values
        const tagValues = values.length > 0 ? values : [locationType];

        for (const value of tagValues) {
            queries.push(`node["${category}"="${value}"]["name"="${searchTerm}"](area.bg);`);
            queries.push(`way["${category}"="${value}"]["name"="${searchTerm}"](area.bg);`);
            queries.push(`relation["${category}"="${value}"]["name"="${searchTerm}"](area.bg);`);
        }

        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      ${queries.join('\n      ')}
    );
    out center;
  `.trim();
    }

    async searchByName(searchTerm, locationType = null) {
        const escapedTerm = this.escapeSearchTerm(searchTerm);
        console.log(`🔍 Searching for: "${searchTerm}" (escaped: "${escapedTerm}")${locationType ? ` with type: ${locationType}` : ''}`);

        // If type is specified, use type-specific query
        if (locationType) {
            return await this.executeQuery(searchTerm, this.buildTypeSpecificQuery(searchTerm, locationType));
        }

        // Otherwise, try progressive search: first places, then natural features, then others
        try {
            console.log('🔍 Trying places first (city, town, village)...');
            const placesQuery = this.buildPlacesQuery(searchTerm);
            const placesResults = await this.executeQuery(searchTerm, placesQuery);

            if (placesResults.length > 0) {
                return placesResults;
            }
        } catch (error) {
            console.error('Places query failed:', error.message);
        }

        // Try natural features if no places found
        try {
            console.log('🔍 Trying natural features (peaks, mountains, etc.)...');
            const naturalQuery = this.buildNaturalQuery(searchTerm);
            const naturalResults = await this.executeQuery(searchTerm, naturalQuery);

            if (naturalResults.length > 0) {
                return naturalResults;
            }
        } catch (error) {
            console.error('Natural features query failed:', error.message);
        }

        // Finally try cultural/historic sites
        try {
            console.log('🔍 Trying cultural/historic sites...');
            const culturalQuery = this.buildCulturalQuery(searchTerm);
            return await this.executeQuery(searchTerm, culturalQuery);
        } catch (error) {
            console.error('Cultural query failed:', error.message);
            throw new Error(`No results found for "${searchTerm}"`);
        }
    }

    // Specific search method for cities/towns/villages only
    async searchCities(searchTerm) {
        console.log(`🏙️ Searching for cities/towns/villages: "${searchTerm}"`);
        const query = this.buildPlacesQuery(searchTerm);
        const results = await this.executeQuery(searchTerm, query);

        if (results.length === 0) {
            throw new Error(`No cities, towns, or villages found for "${searchTerm}"`);
        }

        return results;
    }

    // Specific search method for mountains (mountain ranges only)
    async searchMountains(searchTerm) {
        console.log(`🏔️ Searching for mountain ranges: "${searchTerm}"`);
        const query = this.buildMountainsQuery(searchTerm);
        const results = await this.executeQuery(searchTerm, query);

        if (results.length === 0) {
            throw new Error(`No mountain ranges found for "${searchTerm}"\n\nOverpass query used:\n${query}`);
        }

        return results;
    }

    // Specific search method for peaks only
    async searchPeaks(searchTerm) {
        console.log(`⛰️ Searching for peaks: "${searchTerm}"`);
        const query = this.buildPeaksQuery(searchTerm);
        const results = await this.executeQuery(searchTerm, query);

        if (results.length === 0) {
            throw new Error(`No peaks found for "${searchTerm}"`);
        }

        return results;
    }

    // Specific search method for natural sites (caves, waterfalls)
    async searchNaturalSites(searchTerm) {
        console.log(`🏞️ Searching for natural sites: "${searchTerm}"`);
        const query = this.buildNaturalSitesQuery(searchTerm);
        const results = await this.executeQuery(searchTerm, query);

        if (results.length === 0) {
            throw new Error(`No natural sites found for "${searchTerm}"`);
        }

        return results;
    }

    // Specific search method for cultural/historic sites
    async searchCulturalSites(searchTerm) {
        console.log(`🏛️ Searching for cultural/historic sites: "${searchTerm}"`);
        const query = this.buildCulturalQuery(searchTerm);
        const results = await this.executeQuery(searchTerm, query);

        if (results.length === 0) {
            throw new Error(`No cultural or historic sites found for "${searchTerm}"`);
        }

        return results;
    }

    async executeQuery(searchTerm, query) {
        console.error('🔧 OSM Overpass query being sent:');
        console.error('─'.repeat(50));
        console.error(query);
        console.error('─'.repeat(50));

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            const response = await fetch(OVERPASS_URL, {
                method: 'POST',
                body: query,
                headers: { 'Content-Type': 'text/plain' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 504 || response.status === 429) {
                    console.error(`Overpass API ${response.status} - Server overloaded or timeout`);
                    throw new Error(`Overpass API temporarily unavailable (${response.status})`);
                }
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const data = await response.json();
            console.error(`✅ Found ${data.elements?.length || 0} results from Overpass API`);
            return this.parseOverpassResults(data);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('❌ Overpass query timeout after', FETCH_TIMEOUT, 'ms');
                console.error('Query that timed out:', query);
                throw new Error('Overpass API timeout');
            }
            console.error('❌ Overpass query error:', error.message);
            throw error;
        }
    }

    buildPlacesQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      node["place"]["name"="${searchTerm}"](area.bg);
      way["place"]["name"="${searchTerm}"](area.bg);
      relation["place"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    buildNaturalQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      node["natural"="peak"]["name"="${searchTerm}"](area.bg);
      node["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      node["natural"="cave"]["name"="${searchTerm}"](area.bg);
      node["natural"="cave_entrance"]["name"="${searchTerm}"](area.bg);
      node["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
      way["natural"="peak"]["name"="${searchTerm}"](area.bg);
      way["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      way["natural"="cave"]["name"="${searchTerm}"](area.bg);
      way["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
      relation["natural"="peak"]["name"="${searchTerm}"](area.bg);
      relation["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      relation["natural"="cave"]["name"="${searchTerm}"](area.bg);
      relation["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    buildMountainsQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      relation["name"="${searchTerm}"]["boundary"](area.bg);
      relation["name"="${searchTerm}"]["natural"](area.bg);
      relation["name"="${searchTerm}"]["place"](area.bg);
      node["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      way["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
      relation["natural"="mountain_range"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    buildPeaksQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      node["natural"="peak"]["name"="${searchTerm}"](area.bg);
      way["natural"="peak"]["name"="${searchTerm}"](area.bg);
      relation["natural"="peak"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    buildNaturalSitesQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      node["natural"="cave"]["name"="${searchTerm}"](area.bg);
      node["natural"="cave_entrance"]["name"="${searchTerm}"](area.bg);
      node["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
      way["natural"="cave"]["name"="${searchTerm}"](area.bg);
      way["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
      relation["natural"="cave"]["name"="${searchTerm}"](area.bg);
      relation["natural"="waterfall"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    buildCulturalQuery(searchTerm) {
        return `
    [out:json][timeout:${TIMEOUT}];
    area["name"="България"]["admin_level"="2"]->.bg;
    (
      node["historic"]["name"="${searchTerm}"](area.bg);
      way["historic"]["name"="${searchTerm}"](area.bg);
      relation["historic"]["name"="${searchTerm}"](area.bg);

      node["tourism"]["name"="${searchTerm}"](area.bg);
      way["tourism"]["name"="${searchTerm}"](area.bg);
      relation["tourism"]["name"="${searchTerm}"](area.bg);

      node["amenity"="place_of_worship"]["name"="${searchTerm}"](area.bg);
      way["amenity"="place_of_worship"]["name"="${searchTerm}"](area.bg);
      relation["amenity"="place_of_worship"]["name"="${searchTerm}"](area.bg);
    );
    out center;
  `.trim();
    }

    parseOverpassResults(data) {
        if (!data.elements || data.elements.length === 0) {
            return [];
        }

        return data.elements.map(element => {
            const tags = element.tags || {};

            // Determine coordinates (handle ways/relations with center)
            let lat = element.lat;
            let lon = element.lon;

            if (!lat && element.center) {
                lat = element.center.lat;
                lon = element.center.lon;
            }

            return {
                osmId: element.id,
                osmType: element.type,
                name: tags.name,
                type: this.determineType(tags),
                lat,
                lon,
                wikipedia: tags.wikipedia,
                wikidata: tags.wikidata,
                osmTags: tags
            };
        }).filter(item => item.name && item.lat && item.lon);
    }

    determineType(tags) {
        // Place types (cities, towns, villages)
        if (tags.place) {
            return tags.place; // city, town, village
        }

        // Natural features
        if (tags.natural === 'mountain_range') return 'mountain_range';
        if (tags.natural === 'peak') return 'peak';
        if (tags.natural === 'cave_entrance' || tags.natural === 'cave') return 'cave';
        if (tags.natural === 'waterfall') return 'waterfall';

        // Tourism and attractions
        if (tags.tourism === 'alpine_hut') return 'alpine_hut';
        if (tags.tourism === 'viewpoint') return 'viewpoint';
        if (tags.tourism === 'museum') return 'museum';
        if (tags.tourism === 'attraction') return 'attraction';
        if (tags.tourism) return 'attraction';

        // Historic sites
        if (tags.historic === 'castle') return 'castle';
        if (tags.historic === 'fort') return 'fort';
        if (tags.historic === 'ruins') return 'ruins';
        if (tags.historic === 'archaeological_site') return 'archaeological_site';
        if (tags.historic === 'monastery') return 'monastery';
        if (tags.historic === 'memorial') return 'memorial';
        if (tags.historic === 'church') return 'church';
        if (tags.historic) return 'historical_site';

        // Amenities
        if (tags.amenity === 'place_of_worship') {
            if (tags.religion === 'christian') return 'church';
            return 'place_of_worship';
        }

        return 'unknown';
    }
}