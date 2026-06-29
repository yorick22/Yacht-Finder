const DemoData = (() => {
    const DESTINATIONS = [
        'MONACO', 'IBIZA', 'SANTORINI', 'DUBROVNIK', 'PORTOFINO',
        'ST TROPEZ', 'MYKONOS', 'PALMA', 'NICE', 'SARDINIA',
        'CORFU', 'AMALFI', 'CANNES', 'SPLIT', 'VALLETTA',
        'RHODES', 'CAPRI', 'MARSEILLE', 'BARCELONA', 'NAPLES',
        'ANTIGUA', 'ST BARTS', 'NASSAU', 'KEY WEST', 'BERMUDA',
        'MIAMI', 'FORT LAUDERDALE', 'GEORGE TOWN', 'COZUMEL',
        'AMSTERDAM', 'ROTTERDAM', 'MAKKUM', 'PALMA DE MALLORCA'
    ];

    const NAV_STATUSES = [
        'Under way using engine', 'At anchor', 'Under way sailing',
        'Moored', 'Not under command'
    ];

    const REGIONS = {
        mediterranean: { latMin: 35, latMax: 44, lngMin: -2, lngMax: 28 },
        caribbean: { latMin: 15, latMax: 26, lngMin: -85, lngMax: -60 },
        northsea: { latMin: 49, latMax: 58, lngMin: -5, lngMax: 9 },
        useast: { latMin: 25, latMax: 42, lngMin: -82, lngMax: -70 },
        scandinavia: { latMin: 54, latMax: 66, lngMin: 8, lngMax: 30 },
        global: { latMin: -50, latMax: 60, lngMin: -180, lngMax: 180 }
    };

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function generateVessels(count, region) {
        const bounds = REGIONS[region] || REGIONS.mediterranean;
        const vessels = [];
        const fleet = typeof FLEET !== 'undefined' ? FLEET : [];
        const useCount = Math.min(count, fleet.length);

        // Shuffle fleet to get a random subset
        const shuffled = fleet.slice().sort(() => Math.random() - 0.5);

        for (let i = 0; i < useCount; i++) {
            const f = shuffled[i];
            const lat = rand(bounds.latMin, bounds.latMax);
            const lng = rand(bounds.lngMin, bounds.lngMax);
            const cog = rand(0, 360);
            const sog = rand(0, 14);
            const isAnchored = Math.random() < 0.2;

            vessels.push({
                mmsi: f.m || ('SIM' + String(i).padStart(6, '0')),
                name: f.n,
                imo: f.i || null,
                shipType: f.t,
                yearBuilt: f.y || null,
                constructionNr: f.c || null,
                lat,
                lng,
                cog: isAnchored ? 0 : cog,
                sog: isAnchored ? 0 : sog,
                heading: isAnchored ? 0 : (cog + rand(-10, 10) + 360) % 360,
                navStatus: isAnchored ? 'At anchor' : pick(NAV_STATUSES),
                destination: pick(DESTINATIONS),
                eta: generateETA(),
                dimA: Math.floor(rand(10, 50)),
                dimB: Math.floor(rand(5, 20)),
                dimC: Math.floor(rand(3, 10)),
                dimD: Math.floor(rand(3, 10)),
                draught: +(rand(2.0, 7.0)).toFixed(1),
                lastUpdate: new Date(),
                trail: []
            });
        }

        return vessels;
    }

    function generateETA() {
        const now = new Date();
        const future = new Date(now.getTime() + rand(3600000, 7 * 86400000));
        const m = String(future.getMonth() + 1).padStart(2, '0');
        const d = String(future.getDate()).padStart(2, '0');
        const h = String(future.getHours()).padStart(2, '0');
        const min = String(future.getMinutes()).padStart(2, '0');
        return `${m}-${d} ${h}:${min}`;
    }

    function updateVessel(vessel) {
        if (vessel.navStatus === 'At anchor' || vessel.navStatus === 'Moored') {
            vessel.lat += rand(-0.0001, 0.0001);
            vessel.lng += rand(-0.0001, 0.0001);
            vessel.sog = rand(0, 0.3);
            return;
        }

        vessel.cog += rand(-5, 5);
        vessel.cog = ((vessel.cog % 360) + 360) % 360;
        vessel.heading = ((vessel.cog + rand(-5, 5)) % 360 + 360) % 360;
        vessel.sog = Math.max(0.5, Math.min(16, vessel.sog + rand(-0.5, 0.5)));

        const speedKmH = vessel.sog * 1.852;
        const distKm = speedKmH * (3 / 3600);
        const cogRad = (vessel.cog * Math.PI) / 180;
        const dLat = (distKm / 111.32) * Math.cos(cogRad);
        const dLng = (distKm / (111.32 * Math.cos(vessel.lat * Math.PI / 180))) * Math.sin(cogRad);

        vessel.trail.push({ lat: vessel.lat, lng: vessel.lng, time: Date.now() });

        vessel.lat += dLat;
        vessel.lng += dLng;
        vessel.lastUpdate = new Date();
    }

    return { generateVessels, updateVessel, REGIONS };
})();
