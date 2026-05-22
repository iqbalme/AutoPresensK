// Fungsi yang akan diekspor
function generateRandomCoordinates(lat, lon, radiusInMeters) {
    const earthRadius = 6371000; // Radius bumi dalam meter

    const distance = Math.random() * radiusInMeters;
    const angle = Math.random() * 2 * Math.PI;

    const deltaLat = distance * Math.cos(angle) / earthRadius;
    const deltaLon = distance * Math.sin(angle) / (earthRadius * Math.cos((lat * Math.PI) / 180));

    const newLat = lat + (deltaLat * 180) / Math.PI;
    const newLon = lon + (deltaLon * 180) / Math.PI;

    return { latitude: newLat, longitude: newLon };
}

// Mengekspor fungsi
module.exports = { generateRandomCoordinates };