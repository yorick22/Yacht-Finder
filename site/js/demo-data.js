const DemoData = (() => {
    const YACHT_NAMES = [
        'LADY SARAH', 'BLUE HORIZON', 'SEA BREEZE', 'WIND DANCER', 'OCEAN PEARL',
        'SILVER WAVE', 'NORTHERN STAR', 'SUNDANCER', 'AQUARIUS', 'MOONLIGHT',
        'CALYPSO', "NEPTUNE'S PRIDE", 'AURORA BOREALIS', 'SAPPHIRE', 'DESTINY',
        'WHITE PEARL', 'FREEDOM', 'SERENITY', 'ECLIPSE', 'POSEIDON',
        'VELVET SKY', 'SOLEADO', 'WINDWARD', 'STELLA MARIS', 'ZEPHYR',
        'ATLANTICA', 'CORAL REEF', 'MISTRAL', 'PEGASUS', 'ELYSIUM',
        'ALBATROSS', 'DOLPHIN', 'HERMIONE', 'AVALON', 'SIREN',
        'ORION', 'VALHALLA', 'TEMPEST', 'GOLDEN EAGLE', 'ARTEMIS',
        'APHRODITE', 'TRITON', 'PHOENIX', 'BRAVEHEART', 'ENDEAVOUR'
    ];

    const DESTINATIONS = [
        'MONACO', 'IBIZA', 'SANTORINI', 'DUBROVNIK', 'PORTOFINO',
        'ST TROPEZ', 'MYKONOS', 'PALMA', 'NICE', 'SARDINIA',
        'CORFU', 'AMALFI', 'CANNES', 'SPLIT', 'VALLETTA',
        'RHODES', 'CAPRI', 'MARSEILLE', 'BARCELONA', 'NAPLES',
        'ANTIGUA', 'ST BARTS', 'NASSAU', 'KEY WEST', 'BERMUDA',
        'MIAMI', 'FORT LAUDERDALE', 'GEORGE TOWN', 'COZUMEL'
    ];

    const CALLSIGNS = [
        'WDE4291', 'PJFM', '3FWH9', 'SVAK', '9HA5082',
        'ZCBV7', 'MMSI001', 'VRG7', 'ELOP4', '2CYM9',
        'GBTT', 'FNRP', 'DFHQ', 'IBCM', 'CQAF'
    ];

    const NAV_STATUSES = [
        'Under way using engine', 'At anchor', 'Under way sailing',
        'Moored', 'Not under command'
    ];

    const FLAG_CODES = {
        'NL': 'Netherlands', 'GB': 'United Kingdom', 'US': 'United States',
        'FR': 'France', 'IT': 'Italy', 'GR': 'Greece', 'ES': 'Spain',
        'MT': 'Malta', 'KY': 'Cayman Islands', 'BM': 'Bermuda',
        'MC': 'Monaco', 'HR': 'Croatia', 'PT': 'Portugal',
        'DE': 'Germany', 'NO': 'Norway', 'DK': 'Denmark', 'SE': 'Sweden',
        'AG': 'Antigua & Barbuda', 'MH': 'Marshall Islands', 'PA': 'Panama'
    };

    const REGIONS = {
        mediterranean: { latMin: 35, latMax: 44, lngMin: -2, lngMax: 28 },
        caribbean: { latMin: 15, latMax: 26, lngMin: -85, lngMax: -60 },
        northsea: { latMin: 49, latMax: 58, lngMin: -5, lngMax: 9 },
        useast: { latMin: 25, latMax: 42, lngMin: -82, lngMax: -70 },
        scandinavia: { latMin: 54, latMax: 66, lngMin: 8, lngMax: 30 },
        global: { latMin: -50, latMax: 60, lngMin: -180, lngMax: 180 }
    };

    const YACHT_TYPES = [36, 37];

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function generateMMSI() {
        const mid = Math.floor(rand(200, 800));
        const id = Math.floor(rand(100000, 999999));
        return `${mid}${id}`;
    }

    function generateVessels(count, region) {
        const bounds = REGIONS[region] || REGIONS.mediterranean;
        const vessels = [];
        const usedNames = new Set();
        const usedMMSI = new Set();

        for (let i = 0; i < count; i++) {
            let name;
            do { name = pick(YACHT_NAMES); } while (usedNames.has(name) && usedNames.size < YACHT_NAMES.length);
            usedNames.add(name);
            if (usedNames.size >= YACHT_NAMES.length) usedNames.clear();

            let mmsi;
            do { mmsi = generateMMSI(); } while (usedMMSI.has(mmsi));
            usedMMSI.add(mmsi);

            const lat = rand(bounds.latMin, bounds.latMax);
            const lng = rand(bounds.lngMin, bounds.lngMax);
            const cog = rand(0, 360);
            const sog = rand(0, 14);
            const isAnchored = Math.random() < 0.2;
            const shipType = Math.random() < 0.7 ? pick(YACHT_TYPES) : Math.floor(rand(60, 90));
            const flagKeys = Object.keys(FLAG_CODES);
            const flag = pick(flagKeys);

            vessels.push({
                mmsi,
                name,
                callSign: pick(CALLSIGNS) + Math.floor(rand(0, 9)),
                imo: Math.floor(rand(1000000, 9999999)),
                shipType,
                lat,
                lng,
                cog: isAnchored ? 0 : cog,
                sog: isAnchored ? 0 : sog,
                heading: isAnchored ? 0 : (cog + rand(-10, 10) + 360) % 360,
                navStatus: isAnchored ? 'At anchor' : pick(NAV_STATUSES),
                destination: pick(DESTINATIONS),
                eta: generateETA(),
                dimA: Math.floor(rand(5, 30)),
                dimB: Math.floor(rand(3, 15)),
                dimC: Math.floor(rand(2, 8)),
                dimD: Math.floor(rand(2, 8)),
                draught: +(rand(1.5, 6.0)).toFixed(1),
                flag,
                flagName: FLAG_CODES[flag],
                lastUpdate: new Date(),
                trail: [],
                _velLat: 0,
                _velLng: 0
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

    return { generateVessels, updateVessel, REGIONS, YACHT_TYPES };
})();
