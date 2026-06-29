class AISClient {
    constructor(onMessage, onStatus) {
        this.connections = [];
        this.apiKey = null;
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.fleetMMSIs = new Set();
        this.totalMessages = 0;
        this.fleetMessages = 0;
        this.lastStatsTime = Date.now();
    }

    static BATCH_SIZE = 50;
    static STAGGER_MS = 1500;
    static MAX_RECONNECT = 10;

    connect(apiKey, boundingBoxes, fleetOnly) {
        this.disconnect();
        this.apiKey = apiKey;
        this.boundingBoxes = boundingBoxes;
        this.totalMessages = 0;
        this.fleetMessages = 0;
        this.lastStatsTime = Date.now();

        this.fleetMMSIs.clear();
        if (fleetOnly && typeof FLEET !== 'undefined') {
            FLEET.forEach(f => { if (f.m) this.fleetMMSIs.add(f.m); });
        }

        if (this.fleetMMSIs.size > 0) {
            const mmsiArray = Array.from(this.fleetMMSIs);
            const batches = [];
            for (let i = 0; i < mmsiArray.length; i += AISClient.BATCH_SIZE) {
                batches.push(mmsiArray.slice(i, i + AISClient.BATCH_SIZE));
            }
            this.onStatus('info', 'Opening ' + batches.length + ' streams for ' + mmsiArray.length + ' vessels (max ' + AISClient.BATCH_SIZE + '/stream)');
            batches.forEach((batch, idx) => {
                const delay = idx * AISClient.STAGGER_MS;
                setTimeout(() => {
                    if (this.apiKey) {
                        this._createConnection(batch, idx, batches.length);
                    }
                }, delay);
            });
        } else {
            this._createConnection(null, 0, 1);
        }
    }

    _createConnection(mmsiBatch, index, total) {
        const conn = {
            ws: null,
            reconnectTimer: null,
            reconnectAttempts: 0,
            index: index,
            mmsiBatch: mmsiBatch,
            active: true
        };
        this.connections.push(conn);
        this._connectOne(conn);
    }

    _connectOne(conn) {
        if (!conn.active) return;
        if (conn.ws) {
            conn.ws.onclose = null;
            conn.ws.close();
        }

        try {
            conn.ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
        } catch (e) {
            this.onStatus('error', 'Failed to create WebSocket #' + (conn.index + 1));
            return;
        }

        conn.ws.onopen = () => {
            const subscription = {
                Apikey: this.apiKey,
                BoundingBoxes: this.boundingBoxes,
                FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport']
            };
            if (conn.mmsiBatch) {
                subscription.FiltersShipMMSI = conn.mmsiBatch;
            }
            conn.ws.send(JSON.stringify(subscription));
            conn.reconnectAttempts = 0;

            const openCount = this.connections.filter(c => c.ws && c.ws.readyState === WebSocket.OPEN).length;
            this.onStatus('connected', openCount + '/' + this.connections.length + ' streams');
            if (conn.index === 0) {
                this.onStatus('info', 'Stream #1 connected — waiting for AIS data...');
            }
        };

        conn.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.ERROR || data.error) {
                    const errMsg = data.ERROR || data.error || 'Unknown API error';
                    this.onStatus('error', 'Stream #' + (conn.index + 1) + ': ' + errMsg);
                    return;
                }
                if (!data.MessageType && !data.MetaData) return;

                this.totalMessages++;
                this.fleetMessages++;

                if (this.totalMessages === 1) {
                    this.onStatus('info', 'First AIS message received — data is flowing!');
                }

                if (this.totalMessages % 50 === 0) {
                    const elapsed = Math.round((Date.now() - this.lastStatsTime) / 1000);
                    this.onStatus('info', 'AIS: ' + this.totalMessages + ' messages, ' + this.fleetMessages + ' fleet vessels (' + elapsed + 's)');
                }

                this.onMessage(data);
            } catch (e) {
                // ignore malformed
            }
        };

        conn.ws.onerror = () => {
            // onclose will follow with details
        };

        conn.ws.onclose = (event) => {
            if (!conn.active) return;
            const reason = event.reason || '';
            const codeInfo = 'code ' + event.code + (reason ? ': ' + reason : '');

            if (event.code !== 1000 && conn.reconnectAttempts < AISClient.MAX_RECONNECT) {
                const delay = Math.min(2000 * Math.pow(2, conn.reconnectAttempts), 30000);
                conn.reconnectAttempts++;
                if (conn.reconnectAttempts <= 2) {
                    this.onStatus('warn', 'Stream #' + (conn.index + 1) + ' dropped (' + codeInfo + '), retry ' + conn.reconnectAttempts + ' in ' + (delay/1000) + 's');
                }
                conn.reconnectTimer = setTimeout(() => this._connectOne(conn), delay);
            } else if (event.code !== 1000) {
                this.onStatus('error', 'Stream #' + (conn.index + 1) + ' gave up after ' + AISClient.MAX_RECONNECT + ' retries');
            }

            const activeCount = this.connections.filter(c => c.ws && c.ws.readyState === WebSocket.OPEN).length;
            if (activeCount === 0 && this.connections.every(c => c.reconnectAttempts >= AISClient.MAX_RECONNECT || !c.active)) {
                this.onStatus('disconnected', 'All streams disconnected');
            } else {
                this.onStatus('connected', activeCount + '/' + this.connections.length + ' streams');
            }
        };
    }

    disconnect() {
        this.connections.forEach(conn => {
            conn.active = false;
            clearTimeout(conn.reconnectTimer);
            if (conn.ws) {
                conn.ws.onclose = null;
                conn.ws.close();
                conn.ws = null;
            }
        });
        this.connections = [];
        this.apiKey = null;
        this.onStatus('disconnected');
    }

    static parseAISMessage(data) {
        const meta = data.MetaData || {};
        const msg = data.Message || {};
        const msgType = data.MessageType || '';

        const vessel = {
            mmsi: String(meta.MMSI || ''),
            name: (meta.ShipName || '').trim(),
            lastUpdate: meta.time_utc ? new Date(meta.time_utc) : new Date()
        };

        if (typeof FLEET !== 'undefined') {
            const fleetEntry = FLEET.find(f => f.m === vessel.mmsi);
            if (fleetEntry) {
                if (!vessel.name || vessel.name === '') vessel.name = fleetEntry.n;
                vessel.imo = vessel.imo || fleetEntry.i;
                vessel.shipType = vessel.shipType || fleetEntry.t;
                vessel.yearBuilt = fleetEntry.y;
                vessel.constructionNr = fleetEntry.c;
            }
        }

        if (msgType === 'PositionReport' || msgType === 'StandardClassBPositionReport') {
            const pos = msg.PositionReport || msg.StandardClassBPositionReport || {};
            vessel.lat = pos.Latitude;
            vessel.lng = pos.Longitude;
            vessel.sog = pos.Sog;
            vessel.cog = pos.Cog;
            vessel.heading = pos.TrueHeading !== 511 ? pos.TrueHeading : pos.Cog;
            vessel.navStatus = AISClient.navStatusText(pos.NavigationalStatus);
        }

        if (msgType === 'ShipStaticData') {
            const sd = msg.ShipStaticData || {};
            vessel.name = (sd.Name || vessel.name).trim();
            vessel.callSign = (sd.CallSign || '').trim();
            vessel.imo = sd.ImoNumber;
            vessel.shipType = sd.Type;
            vessel.destination = (sd.Destination || '').trim();
            vessel.draught = sd.MaximumStaticDraught;
            if (sd.Dimension) {
                vessel.dimA = sd.Dimension.A;
                vessel.dimB = sd.Dimension.B;
                vessel.dimC = sd.Dimension.C;
                vessel.dimD = sd.Dimension.D;
            }
            if (sd.Eta) {
                const e = sd.Eta;
                vessel.eta = `${String(e.Month).padStart(2,'0')}-${String(e.Day).padStart(2,'0')} ${String(e.Hour).padStart(2,'0')}:${String(e.Minute).padStart(2,'0')}`;
            }
        }

        return vessel;
    }

    static navStatusText(code) {
        const statuses = {
            0: 'Under way using engine',
            1: 'At anchor',
            2: 'Not under command',
            3: 'Restricted manoeuvrability',
            4: 'Constrained by draught',
            5: 'Moored',
            6: 'Aground',
            7: 'Engaged in fishing',
            8: 'Under way sailing',
            14: 'AIS-SART',
            15: 'Not defined'
        };
        return statuses[code] || 'Unknown';
    }

    static getBoundingBox(region) {
        const regions = {
            global: [[-90, -180], [90, 180]],
            mediterranean: [[30, -6], [46, 37]],
            caribbean: [[10, -90], [28, -58]],
            northsea: [[48, -6], [62, 12]],
            useast: [[24, -83], [45, -65]],
            scandinavia: [[53, 5], [72, 32]],
            'southeast-asia': [[-10, 95], [22, 130]]
        };
        return [regions[region] || regions.mediterranean];
    }
}
