export const LOCATION_TYPES = [
    'city', 'town', 'village', 'mountain_range', 'peak',
    'alpine_hut', 'attraction', 'monastery', 'historical_site',
    'castle', 'museum', 'archaeological_site', 'memorial',
    'ruins', 'fort', 'church', 'cave', 'waterfall', 'viewpoint'
];

// Map location types to their collection category
export const LOCATION_TYPE_TO_CATEGORY = {
    'city': 'cities',
    'town': 'cities',
    'village': 'cities',
    'mountain_range': 'mountains',
    'peak': 'peaks',
    'cave': 'natural_sites',
    'waterfall': 'natural_sites',
    'alpine_hut': 'cultural_sites',
    'viewpoint': 'cultural_sites',
    'museum': 'cultural_sites',
    'attraction': 'cultural_sites',
    'castle': 'cultural_sites',
    'fort': 'cultural_sites',
    'ruins': 'cultural_sites',
    'archaeological_site': 'cultural_sites',
    'monastery': 'cultural_sites',
    'memorial': 'cultural_sites',
    'church': 'cultural_sites',
    'historical_site': 'cultural_sites'
};

// Collection names
export const COLLECTIONS = {
    CITIES: 'cities',
    MOUNTAINS: 'mountains',
    PEAKS: 'peaks',
    NATURAL_SITES: 'natural_sites',
    CULTURAL_SITES: 'cultural_sites'
};

// Category definitions with required location types
export const LOCATION_CATEGORIES = {
    cities: {
        types: ['city', 'town', 'village'],
        requiredTypes: ['city', 'town', 'village']
    },
    mountains: {
        types: ['mountain_range'],
        requiredTypes: ['mountain_range']
    },
    peaks: {
        types: ['peak'],
        requiredTypes: ['peak']
    },
    natural_sites: {
        types: ['cave', 'waterfall'],
        requiredTypes: ['cave', 'waterfall']
    },
    cultural_sites: {
        types: ['alpine_hut', 'viewpoint', 'museum', 'attraction', 'castle', 'fort',
                'ruins', 'archaeological_site', 'monastery', 'memorial', 'church', 'historical_site'],
        requiredTypes: ['castle', 'fort', 'ruins', 'archaeological_site', 'monastery',
                       'memorial', 'church', 'museum', 'attraction', 'viewpoint', 'alpine_hut']
    }
};

// Determine collection name from location type
export function getCollectionForType(locationType) {
    return LOCATION_TYPE_TO_CATEGORY[locationType] || COLLECTIONS.CULTURAL_SITES;
}

export const COLLECTION_NAME = 'locations'; // Deprecated, kept for backward compatibility

export const BULGARIA_BBOX = {
    minLat: 41.2,
    minLon: 22.3,
    maxLat: 44.2,
    maxLon: 28.6
};