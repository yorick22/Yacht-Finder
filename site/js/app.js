(() => {
    'use strict';

    const TRAIL_MAX = 200;
    const UPDATE_INTERVAL = 3000;

    const vessels = new Map();
    let map, markersLayer, trailsLayer, labelsLayer;
    let selectedMMSI = null;
    let followMMSI = null;
    let aisClient = null;
    let demoInterval = null;
    let positionsSaveInterval = null;
    let settings = loadSettings();
    const LOG_MAX = 500;
    const POSITIONS_KEY = 'yachtfinder_positions';
    const POSITIONS_SAVE_INTERVAL = 20000;

    function log(msg, level) {
        level = level || 'info';
        const el = document.getElementById('log-entries');
        if (!el) return;
        const now = new Date();
        const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => String(n).padStart(2, '0')).join(':');
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + level;
        entry.innerHTML = '<span class="log-time">' + ts + '</span><span class="log-msg">' + msg + '</span>';
        el.appendChild(entry);
        while (el.children.length > LOG_MAX) el.removeChild(el.firstChild);
        el.scrollTop = el.scrollHeight;
    }

    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('yachtfinder_settings') || '{}');
            return {
                apiKey: s.apiKey || '',
                dataSource: s.dataSource || 'demo',
                region: s.region || 'mediterranean',
                trailLength: s.trailLength || 50,
                showLabels: s.showLabels !== false
            };
        } catch { return { apiKey: '', dataSource: 'demo', region: 'mediterranean', trailLength: 50, showLabels: true }; }
    }

    function saveSettings() {
        localStorage.setItem('yachtfinder_settings', JSON.stringify(settings));
    }

    function savePositions() {
        try {
            const data = {};
            vessels.forEach(v => {
                if (v.lat == null || v.lng == null) return;
                data[v.mmsi] = {
                    lat: v.lat, lng: v.lng, sog: v.sog, cog: v.cog, heading: v.heading,
                    navStatus: v.navStatus, name: v.name, callSign: v.callSign, imo: v.imo,
                    shipType: v.shipType, destination: v.destination, draught: v.draught,
                    dimA: v.dimA, dimB: v.dimB, dimC: v.dimC, dimD: v.dimD, eta: v.eta,
                    lastUpdate: v.lastUpdate ? new Date(v.lastUpdate).toISOString() : null
                };
            });
            localStorage.setItem(POSITIONS_KEY, JSON.stringify(data));
        } catch (e) { /* localStorage unavailable or quota exceeded */ }
    }

    function loadCachedPositions() {
        let count = 0;
        try {
            const data = JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}');
            Object.keys(data).forEach(mmsi => {
                const vessel = vessels.get(mmsi);
                if (!vessel) return;
                const cached = data[mmsi];
                Object.assign(vessel, cached, {
                    lastUpdate: cached.lastUpdate ? new Date(cached.lastUpdate) : null,
                    _cached: true
                });
                count++;
            });
        } catch (e) { /* ignore malformed cache */ }
        return count;
    }

    function shipTypeLabel(type) {
        if (type === 36) return 'Sailing vessel';
        if (type === 37) return 'Pleasure craft';
        if (type >= 40 && type <= 49) return 'High-speed craft';
        if (type >= 60 && type <= 69) return 'Passenger';
        if (type >= 70 && type <= 79) return 'Cargo';
        if (type >= 80 && type <= 89) return 'Tanker';
        if (type === 30) return 'Fishing';
        if (type === 31 || type === 32) return 'Towing';
        if (type === 50) return 'Pilot';
        if (type === 52) return 'Tug';
        return 'Vessel';
    }

    function isYacht(type) {
        return type === 36 || type === 37;
    }

    function vesselColor(vessel) {
        if (vessel.mmsi === selectedMMSI) return '#F44336';
        if (vessel.shipType === 36) return '#2196F3';
        if (vessel.shipType === 37) return '#00BCD4';
        if (isYacht(vessel.shipType)) return '#9C27B0';
        return '#607D8B';
    }

    function formatCoord(lat, lng) {
        const ns = lat >= 0 ? 'N' : 'S';
        const ew = lng >= 0 ? 'E' : 'W';
        return `${Math.abs(lat).toFixed(4)}${ns}, ${Math.abs(lng).toFixed(4)}${ew}`;
    }

    function cardinalDir(deg) {
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(deg / 22.5) % 16];
    }

    function timeAgo(date) {
        const s = Math.floor((Date.now() - date.getTime()) / 1000);
        if (s < 10) return 'Just now';
        if (s < 60) return `${s}s ago`;
        if (s < 3600) return `${Math.floor(s/60)}m ago`;
        return `${Math.floor(s/3600)}h ago`;
    }

    function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    function vesselSVG(heading, color, size) {
        const r = heading || 0;
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(${r}, 12, 12)">
                <path d="M12 2 L18 20 L12 16 L6 20 Z" fill="${color}" stroke="#fff" stroke-width="1" stroke-linejoin="round" opacity="0.95"/>
            </g>
        </svg>`;
    }

    function createMarkerIcon(vessel) {
        const color = vesselColor(vessel);
        const size = vessel.mmsi === selectedMMSI ? 30 : 22;
        const html = vesselSVG(vessel.heading || vessel.cog || 0, color, size);
        return L.divIcon({
            html,
            className: 'vessel-marker',
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });
    }

    function initMap() {
        map = L.map('map', {
            center: [42, 15],
            zoom: 5,
            zoomControl: true,
            attributionControl: true
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);

        markersLayer = L.layerGroup().addTo(map);
        trailsLayer = L.layerGroup().addTo(map);
        labelsLayer = L.layerGroup().addTo(map);

        map.on('click', () => {
            if (!selectedMMSI) return;
            deselectVessel();
        });
    }

    function updateMarker(vessel) {
        if (vessel.lat == null || vessel.lng == null) return;

        const filterYachts = document.getElementById('filter-yachts').checked;
        if (filterYachts && !isYacht(vessel.shipType)) {
            if (vessel._marker) {
                markersLayer.removeLayer(vessel._marker);
                vessel._marker = null;
            }
            if (vessel._label) {
                labelsLayer.removeLayer(vessel._label);
                vessel._label = null;
            }
            return;
        }

        const latlng = [vessel.lat, vessel.lng];

        if (!vessel._marker) {
            vessel._marker = L.marker(latlng, { icon: createMarkerIcon(vessel) });
            vessel._marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectVessel(vessel.mmsi);
            });
            markersLayer.addLayer(vessel._marker);
        } else {
            vessel._marker.setLatLng(latlng);
            vessel._marker.setIcon(createMarkerIcon(vessel));
        }

        vessel._marker.bindTooltip(
            `<strong>${vessel.name || 'Unknown'}</strong><br>${vessel.sog != null ? vessel.sog.toFixed(1) + ' kn' : ''}`,
            { direction: 'top', offset: [0, -12], className: 'vessel-tooltip' }
        );

        const showLabels = document.getElementById('show-labels').checked;
        if (showLabels && vessel.name && map.getZoom() >= 7) {
            if (!vessel._label) {
                vessel._label = L.marker(latlng, {
                    icon: L.divIcon({
                        html: `<span class="vessel-label">${vessel.name}</span>`,
                        className: '',
                        iconSize: [0, 0],
                        iconAnchor: [-14, 6]
                    }),
                    interactive: false
                });
                labelsLayer.addLayer(vessel._label);
            } else {
                vessel._label.setLatLng(latlng);
            }
        } else if (vessel._label) {
            labelsLayer.removeLayer(vessel._label);
            vessel._label = null;
        }
    }

    function updateAllMarkers() {
        vessels.forEach(v => updateMarker(v));
        document.getElementById('vessel-count').textContent = `${vessels.size} yachts`;
    }

    function drawTrail(mmsi) {
        trailsLayer.clearLayers();
        const vessel = vessels.get(mmsi);
        if (!vessel || vessel.trail.length < 2) return;

        const points = vessel.trail.slice(-settings.trailLength);
        if (vessel.lat != null && vessel.lng != null) {
            points.push({ lat: vessel.lat, lng: vessel.lng });
        }

        const latlngs = points.map(p => [p.lat, p.lng]);
        const color = vesselColor(vessel);

        L.polyline(latlngs, {
            color,
            weight: 2,
            opacity: 0.6,
            dashArray: '6 4'
        }).addTo(trailsLayer);

        points.forEach((p, i) => {
            const opacity = 0.2 + 0.8 * (i / points.length);
            L.circleMarker([p.lat, p.lng], {
                radius: 2,
                color,
                fillColor: color,
                fillOpacity: opacity,
                weight: 0
            }).addTo(trailsLayer);
        });
    }

    function drawAllTrails() {
        trailsLayer.clearLayers();
        vessels.forEach(v => {
            if (v.trail.length >= 2) {
                const pts = v.trail.slice(-settings.trailLength);
                if (v.lat != null) pts.push({ lat: v.lat, lng: v.lng });
                const ll = pts.map(p => [p.lat, p.lng]);
                L.polyline(ll, {
                    color: vesselColor(v),
                    weight: 1.5,
                    opacity: 0.4,
                    dashArray: '4 4'
                }).addTo(trailsLayer);
            }
        });
    }

    function selectVessel(mmsi) {
        selectedMMSI = mmsi;
        const vessel = vessels.get(mmsi);
        if (!vessel) return;

        updateDetailPanel(vessel);
        document.getElementById('sidebar').classList.remove('hidden');

        vessels.forEach(v => updateMarker(v));
        drawTrail(mmsi);

        map.panTo([vessel.lat, vessel.lng], { animate: true });
    }

    function deselectVessel() {
        selectedMMSI = null;
        followMMSI = null;
        document.getElementById('sidebar').classList.add('hidden');
        document.getElementById('btn-follow').classList.remove('active');
        document.getElementById('btn-follow').textContent = 'Follow';
        trailsLayer.clearLayers();
        vessels.forEach(v => updateMarker(v));
    }

    function updateDetailPanel(vessel) {
        document.getElementById('detail-name').textContent = vessel.name || 'Unknown Vessel';
        document.getElementById('detail-type').textContent = shipTypeLabel(vessel.shipType);
        document.getElementById('detail-mmsi').textContent = vessel.mmsi;
        document.getElementById('detail-callsign').textContent = vessel.callSign || '—';
        document.getElementById('detail-flag').textContent = vessel.flagName || mmsiToFlag(vessel.mmsi);
        document.getElementById('detail-imo').textContent = vessel.imo || '—';
        document.getElementById('detail-speed').textContent = vessel.sog != null ? `${vessel.sog.toFixed(1)} kn` : '—';
        document.getElementById('detail-course').textContent = vessel.cog != null ? `${vessel.cog.toFixed(1)}° ${cardinalDir(vessel.cog)}` : '—';
        document.getElementById('detail-heading').textContent = vessel.heading != null ? `${Math.round(vessel.heading)}°` : '—';
        document.getElementById('detail-navstatus').textContent = vessel.navStatus || '—';
        document.getElementById('detail-destination').textContent = vessel.destination || '—';
        document.getElementById('detail-eta').textContent = vessel.eta || '—';
        document.getElementById('detail-position').textContent = (vessel.lat != null && vessel.lng != null)
            ? formatCoord(vessel.lat, vessel.lng) : '—';
        document.getElementById('detail-updated').textContent = vessel.lastUpdate ? timeAgo(vessel.lastUpdate) : '—';

        const lenA = vessel.dimA || 0, lenB = vessel.dimB || 0;
        const widC = vessel.dimC || 0, widD = vessel.dimD || 0;
        const length = lenA + lenB;
        const width = widC + widD;
        document.getElementById('detail-dimensions').textContent =
            (length > 0 && width > 0) ? `${length}m × ${width}m` : '—';
        document.getElementById('detail-draught').textContent =
            vessel.draught ? `${vessel.draught}m` : '—';
        document.getElementById('detail-year').textContent = vessel.yearBuilt || '—';
        document.getElementById('detail-construction').textContent = vessel.constructionNr || '—';
    }

    function mmsiToFlag(mmsi) {
        if (!mmsi || mmsi.length < 3) return '—';
        const mid = parseInt(mmsi.substring(0, 3));
        const midMap = {
            201: 'Albania', 211: 'Germany', 212: 'Cyprus', 215: 'Malta',
            219: 'Denmark', 220: 'Denmark', 224: 'Spain', 225: 'Spain',
            226: 'France', 227: 'France', 228: 'France', 229: 'Malta',
            230: 'Finland', 231: 'Faroe Islands', 232: 'United Kingdom',
            233: 'United Kingdom', 234: 'United Kingdom', 235: 'United Kingdom',
            236: 'Gibraltar', 237: 'Greece', 238: 'Croatia', 239: 'Greece',
            240: 'Greece', 241: 'Greece', 242: 'Morocco', 243: 'Hungary',
            244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands',
            247: 'Italy', 248: 'Malta', 249: 'Malta', 250: 'Ireland',
            255: 'Portugal', 256: 'Malta', 257: 'Norway', 258: 'Norway',
            259: 'Norway', 261: 'Poland', 263: 'Portugal', 265: 'Sweden',
            266: 'Sweden', 269: 'Switzerland', 271: 'Turkey',
            272: 'Ukraine', 273: 'Russia', 303: 'Alaska',
            304: 'Antigua', 305: 'Antigua', 306: 'Curacao',
            307: 'Aruba', 308: 'Bahamas', 309: 'Bahamas',
            310: 'Bermuda', 311: 'Bahamas', 312: 'Belize',
            316: 'Canada', 319: 'Cayman Islands',
            325: 'Jamaica', 338: 'United States', 339: 'United States',
            341: 'Mexico', 345: 'Mexico',
            351: 'Jamaica', 352: 'Jamaica', 353: 'Jamaica',
            354: 'Jamaica', 355: 'Jamaica', 356: 'Jamaica',
            366: 'United States', 367: 'United States', 368: 'United States',
            369: 'United States', 370: 'Panama', 371: 'Panama',
            372: 'Panama', 373: 'Panama', 374: 'Panama', 375: 'Panama',
            376: 'Panama', 377: 'Panama',
            403: 'Saudi Arabia', 412: 'China', 413: 'China',
            416: 'Taiwan', 419: 'India',
            431: 'Japan', 432: 'Japan',
            440: 'South Korea', 441: 'South Korea',
            477: 'Hong Kong',
            503: 'Australia', 512: 'New Zealand',
            533: 'Malaysia', 548: 'Philippines',
            563: 'Singapore', 564: 'Singapore',
            565: 'Singapore', 566: 'Singapore'
        };
        return midMap[mid] || '—';
    }

    function initSearch() {
        const input = document.getElementById('search-input');
        const results = document.getElementById('search-results');

        const doSearch = debounce((query) => {
            if (!query || query.length < 2) {
                results.classList.add('hidden');
                return;
            }
            const q = query.toLowerCase();
            const matches = [];
            vessels.forEach(v => {
                if (matches.length >= 10) return;
                const nameMatch = v.name && v.name.toLowerCase().includes(q);
                const mmsiMatch = v.mmsi && v.mmsi.startsWith(q);
                const destMatch = v.destination && v.destination.toLowerCase().includes(q);
                if (nameMatch || mmsiMatch || destMatch) matches.push(v);
            });

            if (matches.length === 0) {
                results.innerHTML = '<div class="search-result-item"><span class="search-result-name">No results found</span></div>';
            } else {
                results.innerHTML = matches.map(v => {
                    const hasPos = v.lat != null;
                    const info = hasPos
                        ? `${v.mmsi} · ${v.sog != null ? v.sog.toFixed(1) + ' kn' : ''}`
                        : `${v.mmsi} · waiting for AIS`;
                    return `
                    <div class="search-result-item${hasPos ? '' : ' no-position'}" data-mmsi="${v.mmsi}">
                        <span class="search-result-name">${v.name || 'Unknown'}</span>
                        <span class="search-result-mmsi">${info}</span>
                    </div>`;
                }).join('');
            }
            results.classList.remove('hidden');
        }, 200);

        input.addEventListener('input', () => doSearch(input.value.trim()));

        results.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item) return;
            const mmsi = item.dataset.mmsi;
            if (mmsi && vessels.has(mmsi)) {
                const v = vessels.get(mmsi);
                if (v.lat != null) {
                    selectVessel(mmsi);
                } else {
                    selectedMMSI = mmsi;
                    updateDetailPanel(v);
                    document.getElementById('sidebar').classList.remove('hidden');
                }
                input.value = '';
                results.classList.add('hidden');
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                results.classList.add('hidden');
            }
        });
    }

    function handleVesselUpdate(data) {
        const mmsi = data.mmsi;
        if (!mmsi) return;

        let vessel = vessels.get(mmsi);
        if (!vessel) {
            vessel = { mmsi, trail: [] };
            vessels.set(mmsi, vessel);
        }

        if (data.lat != null && data.lng != null && vessel.lat != null) {
            vessel.trail.push({ lat: vessel.lat, lng: vessel.lng, time: Date.now() });
            if (vessel.trail.length > TRAIL_MAX) {
                vessel.trail = vessel.trail.slice(-TRAIL_MAX);
            }
        }

        Object.keys(data).forEach(k => {
            if (data[k] != null && k !== 'trail') {
                vessel[k] = data[k];
            }
        });

        updateMarker(vessel);

        if (vessel.mmsi === selectedMMSI) {
            updateDetailPanel(vessel);
            const showTrail = document.getElementById('btn-track').classList.contains('active');
            if (showTrail) drawTrail(mmsi);
        }

        if (vessel.mmsi === followMMSI && vessel.lat != null) {
            map.panTo([vessel.lat, vessel.lng], { animate: true, duration: 1 });
        }
    }

    function startDemo() {
        stopDemo();
        const region = settings.region || 'mediterranean';
        const fleetCount = typeof FLEET !== 'undefined' ? FLEET.length : 40;
        const demoVessels = DemoData.generateVessels(fleetCount, region);

        demoVessels.forEach(v => {
            vessels.set(v.mmsi, v);
            updateMarker(v);
        });

        updateAllMarkers();
        setStatus('demo', 'Demo mode');
        log('Demo mode started with ' + demoVessels.length + ' simulated fleet yachts', 'info');

        const bounds = DemoData.REGIONS[region];
        if (bounds) {
            map.fitBounds([
                [bounds.latMin, bounds.lngMin],
                [bounds.latMax, bounds.lngMax]
            ], { padding: [40, 40] });
        }

        demoInterval = setInterval(() => {
            vessels.forEach(v => {
                DemoData.updateVessel(v);
                handleVesselUpdate(v);
            });
            document.getElementById('vessel-count').textContent = `${vessels.size} yachts`;

            if (document.getElementById('show-trails').checked) {
                drawAllTrails();
            }
        }, UPDATE_INTERVAL);
    }

    function stopDemo() {
        if (demoInterval) {
            clearInterval(demoInterval);
            demoInterval = null;
        }
    }

    let locatedCount = 0;

    function preloadFleet() {
        if (typeof FLEET === 'undefined') return;
        FLEET.forEach(f => {
            const mmsi = f.m || ('FLEET' + String(Math.random()).slice(2, 8));
            if (vessels.has(mmsi)) return;
            vessels.set(mmsi, {
                mmsi,
                name: f.n,
                imo: f.i || null,
                shipType: f.t,
                yearBuilt: f.y || null,
                constructionNr: f.c || null,
                lat: null,
                lng: null,
                trail: [],
                lastUpdate: null
            });
        });
    }

    function updateLiveCount() {
        let located = 0;
        vessels.forEach(v => { if (v.lat != null) located++; });
        locatedCount = located;
        document.getElementById('vessel-count').textContent = `${located}/${vessels.size} yachts located`;
    }

    function startLive() {
        if (!settings.apiKey) {
            alert('Please enter your AISStream.io API key in Settings.');
            openSettings();
            return;
        }

        stopDemo();
        clearVessels();
        preloadFleet();

        const cachedCount = loadCachedPositions();
        if (cachedCount > 0) {
            vessels.forEach(v => { if (v.lat != null) updateMarker(v); });
            log('Loaded ' + cachedCount + ' cached positions from previous session', 'info');
        }
        updateLiveCount();

        log('Starting live AIS mode — fleet has ' + vessels.size + ' vessels', 'info');

        const fleetMMSIs = [];
        vessels.forEach(v => { if (/^\d+$/.test(v.mmsi)) fleetMMSIs.push(v.mmsi); });

        let fleetHits = 0;

        aisClient = new AISClient(
            (data) => {
                const parsed = AISClient.parseAISMessage(data);
                const vessel = vessels.get(parsed.mmsi);
                const isNew = vessel && vessel.lat == null && parsed.lat != null;
                handleVesselUpdate(parsed);
                if (isNew) {
                    fleetHits++;
                    log('Position: <b>' + (parsed.name || parsed.mmsi) + '</b> — ' +
                        (parsed.lat != null ? parsed.lat.toFixed(4) + ', ' + parsed.lng.toFixed(4) : ''), 'success');
                }
                updateLiveCount();
            },
            (status, detail) => {
                if (status === 'connected') {
                    setStatus('connected', 'Live AIS');
                    log('Connected to AISStream.io', 'success');
                } else if (status === 'disconnected') {
                    setStatus('disconnected', 'Disconnected');
                    log('Disconnected: ' + (detail || ''), 'warn');
                } else if (status === 'error') {
                    setStatus('disconnected', detail || 'Error');
                    log('ERROR: ' + (detail || 'unknown error'), 'error');
                } else if (status === 'warn') {
                    log(detail || '', 'warn');
                } else if (status === 'info') {
                    log(detail || '', 'info');
                } else if (status === 'connecting') {
                    setStatus('disconnected', 'Connecting...');
                    log('Connecting to AISStream.io...', 'info');
                }
            }
        );

        aisClient.connect(settings.apiKey, fleetMMSIs);

        clearInterval(positionsSaveInterval);
        positionsSaveInterval = setInterval(savePositions, POSITIONS_SAVE_INTERVAL);
    }

    function stopLive() {
        clearInterval(positionsSaveInterval);
        positionsSaveInterval = null;
        if (aisClient) {
            aisClient.disconnect();
            aisClient = null;
            savePositions();
        }
    }

    function clearVessels() {
        vessels.forEach(v => {
            if (v._marker) markersLayer.removeLayer(v._marker);
            if (v._label) labelsLayer.removeLayer(v._label);
        });
        vessels.clear();
        trailsLayer.clearLayers();
        selectedMMSI = null;
        followMMSI = null;
        document.getElementById('sidebar').classList.add('hidden');
        document.getElementById('vessel-count').textContent = '0 yachts';
    }

    function setStatus(state, text) {
        const el = document.getElementById('connection-status');
        el.className = `status ${state}`;
        el.querySelector('.status-text').textContent = text;
    }

    function openSettings() {
        document.getElementById('api-key').value = settings.apiKey;
        document.getElementById('trail-length').value = settings.trailLength;
        document.getElementById('trail-length-value').textContent = settings.trailLength;
        document.getElementById('region-select').value = settings.region;
        document.querySelector(`input[name="data-source"][value="${settings.dataSource}"]`).checked = true;
        document.getElementById('settings-modal').classList.remove('hidden');
    }

    function closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    }

    function applySettings() {
        settings.apiKey = document.getElementById('api-key').value.trim();
        settings.trailLength = parseInt(document.getElementById('trail-length').value);
        settings.region = document.getElementById('region-select').value;
        settings.dataSource = document.querySelector('input[name="data-source"]:checked').value;
        saveSettings();
        closeSettings();

        stopDemo();
        stopLive();
        clearVessels();

        if (settings.dataSource === 'live') {
            startLive();
        } else {
            startDemo();
        }
    }

    function initUI() {
        window.addEventListener('beforeunload', () => {
            if (aisClient) savePositions();
        });

        document.getElementById('settings-btn').addEventListener('click', openSettings);
        document.getElementById('modal-close').addEventListener('click', closeSettings);
        document.getElementById('save-settings').addEventListener('click', applySettings);
        document.getElementById('sidebar-close').addEventListener('click', deselectVessel);

        document.getElementById('log-toggle').addEventListener('click', () => {
            document.getElementById('log-panel').classList.add('hidden');
            document.getElementById('log-open-btn').classList.remove('hidden');
        });
        document.getElementById('log-open-btn').addEventListener('click', () => {
            document.getElementById('log-panel').classList.remove('hidden');
            document.getElementById('log-open-btn').classList.add('hidden');
        });
        document.getElementById('log-clear').addEventListener('click', () => {
            document.getElementById('log-entries').innerHTML = '';
            log('Log cleared', 'info');
        });

        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') closeSettings();
        });

        document.getElementById('trail-length').addEventListener('input', (e) => {
            document.getElementById('trail-length-value').textContent = e.target.value;
        });

        document.getElementById('btn-track').addEventListener('click', () => {
            const btn = document.getElementById('btn-track');
            btn.classList.toggle('active');
            if (btn.classList.contains('active')) {
                btn.textContent = 'Hide Trail';
                if (selectedMMSI) drawTrail(selectedMMSI);
            } else {
                btn.textContent = 'Show Trail';
                trailsLayer.clearLayers();
            }
        });

        document.getElementById('btn-follow').addEventListener('click', () => {
            const btn = document.getElementById('btn-follow');
            if (followMMSI === selectedMMSI) {
                followMMSI = null;
                btn.classList.remove('active');
                btn.textContent = 'Follow';
            } else {
                followMMSI = selectedMMSI;
                btn.classList.add('active');
                btn.textContent = 'Unfollow';
                const v = vessels.get(selectedMMSI);
                if (v && v.lat != null) map.panTo([v.lat, v.lng]);
            }
        });

        document.getElementById('btn-center').addEventListener('click', () => {
            if (!selectedMMSI) return;
            const v = vessels.get(selectedMMSI);
            if (v && v.lat != null) map.setView([v.lat, v.lng], Math.max(map.getZoom(), 10));
        });

        document.getElementById('filter-yachts').addEventListener('change', () => {
            updateAllMarkers();
        });

        document.getElementById('show-trails').addEventListener('change', (e) => {
            if (e.target.checked) {
                drawAllTrails();
            } else {
                trailsLayer.clearLayers();
                if (selectedMMSI && document.getElementById('btn-track').classList.contains('active')) {
                    drawTrail(selectedMMSI);
                }
            }
        });

        document.getElementById('show-labels').addEventListener('change', () => {
            labelsLayer.clearLayers();
            vessels.forEach(v => { v._label = null; });
            updateAllMarkers();
        });

        map.on('zoomend', () => {
            labelsLayer.clearLayers();
            vessels.forEach(v => { v._label = null; });
            updateAllMarkers();
        });

        setInterval(() => {
            if (selectedMMSI) {
                const v = vessels.get(selectedMMSI);
                if (v) {
                    document.getElementById('detail-updated').textContent = v.lastUpdate ? timeAgo(v.lastUpdate) : '—';
                }
            }
        }, 5000);
    }

    function init() {
        initMap();
        initSearch();
        initUI();

        if (settings.dataSource === 'live' && settings.apiKey) {
            startLive();
        } else {
            startDemo();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
