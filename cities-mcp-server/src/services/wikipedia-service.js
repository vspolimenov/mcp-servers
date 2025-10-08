import fetch from 'node-fetch';

const FETCH_TIMEOUT = 15000; // 15 seconds fetch timeout

export class WikipediaService {
    async getInfo(wikipediaTag) {
        if (!wikipediaTag || !wikipediaTag.includes(':')) {
            return null;
        }

        try {
            const [lang, title] = wikipediaTag.split(':', 2);
            const encodedTitle = encodeURIComponent(title);
            const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;

            console.log(`📖 Fetching Wikipedia info for: "${wikipediaTag}"`);
            
            // Create AbortController for timeout handling
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            const response = await fetch(url, {
                headers: { 'User-Agent': 'CityMCPServer/1.0' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.error(`Wikipedia API error for ${wikipediaTag}: ${response.status}`);
                return null;
            }

            const data = await response.json();

            return {
                title: data.title,
                description: data.extract,
                thumbnail: data.thumbnail?.source,
                image: data.originalimage?.source,
                url: data.content_urls?.desktop?.page,
                lang
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error(`Wikipedia query timeout after ${FETCH_TIMEOUT}ms for ${wikipediaTag}`);
                throw new Error('Wikipedia API timeout');
            }
            console.error('Wikipedia fetch error:', error);
            throw error;
        }
    }
}