class AISClient {
    static BATCH_SIZE = 50;
    static DWELL_MS = 70000;
    static GAP_MS = 2500;
    static WATCHDOG_MS = 20000;

    constructor(onMessage, onStatus) {
        this.ws = null;
        this.apiKey = null;
        this.onMessage = onMessage;
        this.onStatus = onStatus;
        this.batchTimer = null;
        this.watchdogTimer = null;
        this.batches = [];
        this.batchIndex = 0;
        this.cycleCount = 0;
        this.running = false;
        this.rawEventCount = 0;
        this.totalMessages = 0;
    }

    static chunk(arr, size) {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
    }

    connect(apiKey, fleetMMSIs) {
        this.apiKey = apiKey;
        this.batches = AISClient.chunk(fleetMMSIs, AISClient.BATCH_SIZE);
        this.batchIndex = 0;
        this.cycleCount = 0;
        this.totalMessages = 0;
        this.running = true;

        if (this.batches.length === 0) {
            this.onStatus('error', 'No fleet MMSIs to track');
            return;
        }

        this.onStatus('info', 'Rotation mode: ' + fleetMMSIs.length + ' yachts in ' + this.batches.length + ' batches of up to ' + AISClient.BATCH_SIZE);
        this._connectBatch();
    }

    _connectBatch() {
        if (!this.running) return;

        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        clearTimeout(this.batchTimer);
        clearTimeout(this.watchdogTimer);

        const batch = this.batches[this.batchIndex];
        const batchNum = this.batchIndex + 1;
        this.rawEventCount = 0;

        this.onStatus('connecting');
        this.onStatus('info', 'Batch ' + batchNum + '/' + this.batches.length + ': connecting (' + batch.length + ' yachts)...');

        try {
            this.ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
        } catch (e) {
            this.onStatus('error', 'Failed to create WebSocket');
            this.batchTimer = setTimeout(() => this._advanceBatch(), AISClient.GAP_MS);
            return;
        }

        this.ws.onopen = () => {
            const subscription = {
                Apikey: this.apiKey,
                BoundingBoxes: [[[-90, -180], [90, 180]]],
                FiltersShipMMSI: batch,
                FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport']
            };
            this.ws.send(JSON.stringify(subscription));
            this.onStatus('connected');
            this.onStatus('info', 'Batch ' + batchNum + '/' + this.batches.length + ' subscribed — listening for ' + (AISClient.DWELL_MS / 1000) + 's');

            this.watchdogTimer = setTimeout(() => {
                if (this.rawEventCount === 0) {
                    this.onStatus('warn', 'Batch ' + batchNum + '/' + this.batches.length + ': no data received');
                }
            }, AISClient.WATCHDOG_MS);

            this.batchTimer = setTimeout(() => this._advanceBatch(), AISClient.DWELL_MS);
        };

        this.ws.onmessage = (event) => {
            this.rawEventCount++;
            try {
                const data = JSON.parse(event.data);
                if (data.ERROR || data.error) {
                    this.onStatus('error', 'API: ' + (data.ERROR || data.error));
                    return;
                }
                if (!data.MessageType && !data.MetaData) return;

                this.totalMessages++;
                if (this.totalMessages === 1) {
                    this.onStatus('info', 'First AIS message received — data is flowing');
                }

                this.onMessage(data);
            } catch (e) {
                this.onStatus('warn', 'Failed to parse message: ' + event.data.substring(0, 150));
            }
        };

        this.ws.onerror = () => {
            this.onStatus('error', 'Batch ' + batchNum + '/' + this.batches.length + ': WebSocket error');
        };

        this.ws.onclose = (event) => {
            clearTimeout(this.watchdogTimer);
            if (!this.running) return;
            clearTimeout(this.batchTimer);
            const reason = event.reason || '';
            const codeInfo = 'code ' + event.code + (reason ? ': ' + reason : '');
            this.onStatus('warn', 'Batch ' + batchNum + '/' + this.batches.length + ' connection closed early (' + codeInfo + ')');
            this.batchTimer = setTimeout(() => this._advanceBatch(), AISClient.GAP_MS);
        };
    }

    _advanceBatch() {
        if (!this.running) return;

        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }

        this.batchIndex++;
        if (this.batchIndex >= this.batches.length) {
            this.batchIndex = 0;
            this.cycleCount++;
            this.onStatus('info', 'Completed full rotation cycle #' + this.cycleCount + ' (' + this.totalMessages + ' messages total)');
        }

        this.batchTimer = setTimeout(() => this._connectBatch(), AISClient.GAP_MS);
    }

    disconnect() {
        this.running = false;
        clearTimeout(this.batchTimer);
        clearTimeout(this.watchdogTimer);
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
}
