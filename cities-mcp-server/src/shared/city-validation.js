export function validateCityData(data) {
    const errors = [];

    // Required fields
    if (!data.name || typeof data.name !== 'string') {
        errors.push({ field: 'name', message: 'Name is required and must be a string' });
    }

    if (typeof data.lat !== 'number' || data.lat < -90 || data.lat > 90) {
        errors.push({ field: 'lat', message: 'Valid latitude is required (-90 to 90)' });
    }

    if (typeof data.lon !== 'number' || data.lon < -180 || data.lon > 180) {
        errors.push({ field: 'lon', message: 'Valid longitude is required (-180 to 180)' });
    }

    if (!data.type || typeof data.type !== 'string') {
        errors.push({ field: 'type', message: 'Type is required' });
    }

    return {
        valid: errors.length === 0,
        errors,
        data: errors.length === 0 ? data : null
    };
}