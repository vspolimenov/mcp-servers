import fetch from 'node-fetch';

const FETCH_TIMEOUT = 30000; // 30 seconds fetch timeout (increased from 15s)
const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

export class WikidataService {
    async getInfo(wikidataId) {
        if (!wikidataId || !wikidataId.startsWith('Q')) {
            return null;
        }

        // Retry logic with exponential backoff
        for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            try {
                const url = `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`;
                
                console.log(`🌐 Fetching Wikidata info for: "${wikidataId}" (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
                
                // Create AbortController for timeout handling
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

                const response = await fetch(url, {
                    headers: { 
                        'User-Agent': 'CityMCPServer/1.0',
                        'Accept': 'application/json',
                        'Connection': 'keep-alive'
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.error(`Wikidata API error for ${wikidataId}: ${response.status} ${response.statusText}`);
                    
                    // If it's a server error (5xx) or too many requests (429), retry
                    if (response.status >= 500 || response.status === 429) {
                        if (attempt < MAX_RETRY_ATTEMPTS) {
                            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                            console.log(`⏳ Retrying in ${delay}ms due to server error ${response.status}...`);
                            await this.sleep(delay);
                            continue;
                        }
                    }
                    return null;
                }

                const data = await response.json();
                const entity = data.entities[wikidataId];

                if (!entity) return null;

                console.log(`✅ Successfully fetched Wikidata info for ${wikidataId} on attempt ${attempt}`);

                return {
                    label: this.getLabel(entity, 'bg') || this.getLabel(entity, 'en'),
                    description: this.getDescription(entity, 'bg') || this.getDescription(entity, 'en'),
                    population: this.getClaim(entity, 'P1082'),
                    elevation: this.getClaim(entity, 'P2044'),
                    area: this.getClaim(entity, 'P2046'),
                    images: this.getImages(entity),
                    coordinates: this.getCoordinates(entity),
                    officialWebsite: this.getClaim(entity, 'P856')
                };
            } catch (error) {
                const isLastAttempt = attempt === MAX_RETRY_ATTEMPTS;
                
                if (error.name === 'AbortError') {
                    console.error(`Wikidata query timeout after ${FETCH_TIMEOUT}ms for ${wikidataId} (attempt ${attempt})`);
                    
                    if (!isLastAttempt) {
                        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                        console.log(`⏳ Retrying in ${delay}ms due to timeout...`);
                        await this.sleep(delay);
                        continue;
                    }
                    
                    throw new Error(`Wikidata API timeout after ${MAX_RETRY_ATTEMPTS} attempts`);
                }
                
                // Handle network errors (ETIMEDOUT, ECONNRESET, etc.)
                if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
                    console.error(`Network error for ${wikidataId} (attempt ${attempt}):`, {
                        code: error.code,
                        errno: error.errno,
                        message: error.message
                    });
                    
                    if (!isLastAttempt) {
                        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
                        console.log(`⏳ Retrying in ${delay}ms due to network error ${error.code}...`);
                        await this.sleep(delay);
                        continue;
                    }
                    
                    // Enhanced error message for network connectivity issues
                    const networkErrorMsg = this.getNetworkErrorMessage(error.code);
                    console.error(`❌ ${networkErrorMsg}`);
                    throw new Error(`${networkErrorMsg} (after ${MAX_RETRY_ATTEMPTS} attempts)`);
                }
                
                console.error('Wikidata fetch error:', error);
                
                // For other errors, don't retry
                if (isLastAttempt) {
                    throw error;
                }
            }
        }
    }

    // Helper method for delays
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Enhanced network error messages
    getNetworkErrorMessage(errorCode) {
        switch (errorCode) {
            case 'ETIMEDOUT':
                return 'Wikidata server connection timeout. This may be due to network connectivity issues, firewall restrictions, or VPN blocking. Please check your network connection and try again later.';
            case 'ECONNRESET':
                return 'Wikidata server connection was reset. This may indicate network instability or server-side issues. Please try again later.';
            case 'ENOTFOUND':
                return 'Wikidata server could not be reached (DNS resolution failed). Please check your internet connection and DNS settings.';
            default:
                return `Network error (${errorCode}): Unable to connect to Wikidata servers. Please check your network connection.`;
        }
    }

    getLabel(entity, lang) {
        return entity.labels?.[lang]?.value;
    }

    getDescription(entity, lang) {
        return entity.descriptions?.[lang]?.value;
    }

    getClaim(entity, propertyId) {
        const claims = entity.claims?.[propertyId];
        if (!claims || claims.length === 0) return null;

        const mainsnak = claims[0].mainsnak;
        if (mainsnak.snaktype !== 'value') return null;

        const datavalue = mainsnak.datavalue;
        if (!datavalue) return null;

        // Handle different data types
        if (datavalue.type === 'quantity') {
            return parseFloat(datavalue.value.amount);
        }
        if (datavalue.type === 'string') {
            return datavalue.value;
        }

        return datavalue.value;
    }

    getImages(entity) {
        const imageClaims = entity.claims?.P18;
        if (!imageClaims) return [];

        return imageClaims.map(claim => {
            const filename = claim.mainsnak?.datavalue?.value;
            if (!filename) return null;
            return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;
        }).filter(Boolean);
    }

    getCoordinates(entity) {
        const coordClaims = entity.claims?.P625;
        if (!coordClaims || coordClaims.length === 0) return null;

        const coords = coordClaims[0].mainsnak?.datavalue?.value;
        if (!coords) return null;

        return {
            lat: coords.latitude,
            lon: coords.longitude
        };
    }
}