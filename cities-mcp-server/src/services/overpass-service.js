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

    async searchByName(searchTerm) {
        const escapedTerm = this.escapeSearchTerm(searchTerm);
        console.log(`🔍 Searching for: "${searchTerm}" (escaped: "${escapedTerm}")`);

        const query = `
    [out:json][timeout:${TIMEOUT}];
    (
      node["place"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      way["place"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      relation["place"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);

      node["natural"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      way["natural"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      relation["natural"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);

      node["historic"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      way["historic"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      relation["historic"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);

      node["tourism"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      way["tourism"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      relation["tourism"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);

      node["amenity"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      way["amenity"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
      relation["amenity"]["name"="${searchTerm}"](41.2,22.3,44.2,28.6);
    );
    out center;
  `.trim();

        try {
            // Log the query for debugging
            console.log('🔧 Overpass query being sent:');
            console.log(query);
            console.log('─'.repeat(50));
            
            // Създай AbortController за timeout
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
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const data = await response.json();
            return this.parseOverpassResults(data);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Overpass query timeout after', FETCH_TIMEOUT, 'ms');
                throw new Error('Overpass API timeout');
            }
            console.error('Overpass query error:', error);
            throw error;
        }
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