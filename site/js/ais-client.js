class AISClient {
    constructor(onMessage, onStatus) {
        this.ws = null;
        this.apiKey = null;
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.fleetMMSIs = new Set();
    }

    connect(apiKey, boundingBoxes, fleetOnly) {
        this.apiKey = apiKey;
        this.boundingBoxes = boundingBoxes;
        this.reconnectAttempts = 0;

        this.fleetMMSIs.clear();
        if (fleetOnly && typeof FLEET !== 'undefined') {
            FLEET.forEach(f => { if (f.m) this.fleetMMSIs.add(f.m); });
        }

        this.useServerFilter = fleetOnly && this.fleetMMSIs.size > 0;
        this._connect();
    }

    _connect() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }

        this.onStatus('connecting');

        try {
            this.ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
        } catch (e) {
            this.onStatus('error', 'Failed to create WebSocket');
            return;
        }

        this.ws.onopen = () => {
            const subscription = {
                Apikey: this.apiKey,
                BoundingBoxes: this.boundingBoxes,
                FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport']
            };
            if (this.useServerFilter) {
                subscription.FiltersShipMMSI = Array.from(this.fleetMMSIs);
                this.onStatus('info', 'Subscribing with ' + this.fleetMMSIs.size + ' MMSI filters (server-side)');
            }
            this.ws.send(JSON.stringify(subscription));
            this.onStatus('connected');
            this.reconnectAttempts = 0;
        };

        this.totalMessages = 0;
        this.fleetMessages = 0;
        this.lastStatsTime = Date.now();

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.ERROR || data.error) {
                    const errMsg = data.ERROR || data.error || 'Unknown API error';
                    this.onStatus('error', 'API: ' + errMsg);
                    return;
                }
                if (!data.MessageType && !data.MetaData) {
                    this.onStatus('warn', 'Unexpected message: ' + event.data.substring(0, 200));
                    return;
                }

                this.totalMessages++;

                if (this.totalMessages === 1) {
                    this.onStatus('info', 'First AIS message received — data is flowing');
                }

                if (this.totalMessages % 500 === 0) {
                    const elapsed = Math.round((Date.now() - this.lastStatsTime) / 1000);
                    this.onStatus('info', 'AIS stream: ' + this.totalMessages + ' total messages, ' + this.fleetMessages + ' fleet matches (' + elapsed + 's elapsed)');
                }

                if (this.fleetMMSIs.size > 0) {
                    const mmsi = String((data.MetaData || {}).MMSI || '');
                    if (!this.fleetMMSIs.has(mmsi)) return;
                    this.fleetMessages++;
                }
                this.onMessage(data);
            } catch (e) {
                this.onStatus('warn', 'Malformed message: ' + event.data.substring(0, 100));
            }
        };

        this.ws.onerror = (event) => {
            this.onStatus('error', 'WebSocket error (connection lost or refused)');
        };

        this.ws.onclose = (event) => {
            const reason = event.reason || '';
            const codeInfo = 'code ' + event.code + (reason ? ': ' + reason : '');
            if (event.code === 1000) {
                this.onStatus('disconnected', 'Connection closed normally');
            } else if (event.code === 1006) {
                this.onStatus('error', 'Connection dropped unexpectedly (' + codeInfo + ')');
            } else {
                this.onStatus('disconnected', 'Closed (' + codeInfo + ')');
            }
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
                this.reconnectAttempts++;
                this.onStatus('reconnecting', 'Attempt ' + this.reconnectAttempts + '/' + this.maxReconnectAttempts + ' in ' + (delay/1000) + 's...');
                this.reconnectTimer = setTimeout(() => this._connect(), delay);
            }
        };
    }

    disconnect() {
        clearTimeout(this.reconnectTimer);
        this.reconnectAttempts = this.maxReconnectAttempts;
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
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

        // Enrich with fleet data if available
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
