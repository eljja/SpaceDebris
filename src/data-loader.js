import { computeApogeePerigee, RE_WGS84 } from './physics/orbital-utils.js';

export class DataLoader {
    constructor() {
        this.objects = [];
        this.metadata = null;
        this.index = new Map();
        this.noradToIndex = new Map();
        this.categoryFilterIndex = new Map();
        this.orbitFilterIndex = new Map();
    }

    async loadAll(onProgress = () => {}) {
        try {
            onProgress(0, 4, 'Starting orbital database load...');

            const fetchJSON = async (url) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch ${url}`);
                return await response.json();
            };

            // Prefer compact in-orbit SATCAT (~65% smaller) with seamless fallback to full satcat.json
            const fetchSatcat = async () => {
                try {
                    const res = await fetch('./data/satcat-orbit.json');
                    if (res.ok) return await res.json();
                } catch {
                    // Fallback below
                }
                return await fetchJSON('./data/satcat.json');
            };

            let completed = 0;
            const track = (promise, msg) => promise.then(res => {
                completed++;
                onProgress(completed, 4, msg);
                return res;
            });

            const [gpActive, gpDebris, satcat, metadata] = await Promise.all([
                track(fetchJSON('./data/gp-active.json'), 'Loaded active satellites'),
                track(fetchJSON('./data/gp-debris.json'), 'Loaded tracked debris'),
                track(fetchSatcat(), 'Loaded SATCAT catalog'),
                track(fetchJSON('./data/metadata.json'), 'Loaded metadata')
            ]);

            this.metadata = metadata;
            this.processData(gpActive, gpDebris, satcat);
        } catch (error) {
            console.error('Error loading space data:', error);
            throw error;
        }
    }

    processData(gpActive, gpDebris, satcat) {
        const mergedGP = new Map();

        const processGPArray = (arr) => {
            if (Array.isArray(arr)) {
                for (const item of arr) {
                    if (item && item.NORAD_CAT_ID) {
                        mergedGP.set(String(item.NORAD_CAT_ID), item);
                    }
                }
            }
        };

        processGPArray(gpActive);
        processGPArray(gpDebris);

        this.objects = [];
        this.index.clear();
        this.noradToIndex.clear();
        this.categoryFilterIndex.clear();
        this.orbitFilterIndex.clear();

        // Determine fallback epoch dynamically from metadata rather than hardcoded stale date
        const fallbackEpoch = (this.metadata && this.metadata.lastUpdated)
            ? String(this.metadata.lastUpdated).replace(/\+00:00$/, 'Z')
            : new Date().toISOString();

        // 1. Collect all in-orbit NORAD IDs from SATCAT + GP
        const inOrbitIds = new Set();

        if (satcat && typeof satcat === 'object') {
            for (const [noradId, satcatData] of Object.entries(satcat)) {
                if (satcatData && !satcatData.decayDate) {
                    inOrbitIds.add(noradId);
                }
            }
        }

        for (const strId of mergedGP.keys()) {
            inOrbitIds.add(strId);
        }

        // 2. Process each in-orbit object
        for (const strId of inOrbitIds) {
            const satcatData = (satcat && satcat[strId]) || {};
            let gpItem = mergedGP.get(strId);
            const hasRealGP = Boolean(gpItem);

            // Parse numeric apogee/perigee from SATCAT when present
            const satApo = parseFloat(satcatData.apo);
            const satPeri = parseFloat(satcatData.peri);

            // If object lacks explicit SGP4 GP record, synthesize OMM elements from SATCAT metadata
            if (!gpItem) {
                const intId = parseInt(strId, 10) || 1;
                const period = parseFloat(satcatData.period) || 95.0;
                const mm = (period > 0) ? (1440.0 / period) : 15.0;
                const incl = parseFloat(satcatData.incl) || 51.6;
                const apo = Number.isFinite(satApo) ? satApo : 500;
                const peri = Number.isFinite(satPeri) ? satPeri : 500;
                const a = RE_WGS84 + (apo + peri) / 2;
                const ecc = (apo > peri) ? Math.min(0.85, (apo - peri) / (2 * a)) : 0.001;

                gpItem = {
                    OBJECT_NAME: satcatData.name || `OBJECT ${strId}`,
                    OBJECT_ID: satcatData.id || `SAT-${strId}`,
                    NORAD_CAT_ID: intId,
                    EPOCH: fallbackEpoch,
                    MEAN_MOTION: mm,
                    ECCENTRICITY: ecc,
                    INCLINATION: incl,
                    RA_OF_ASC_NODE: (intId * 137.5) % 360,
                    ARG_OF_PERICENTER: (intId * 73.1) % 360,
                    MEAN_ANOMALY: (intId * 41.3) % 360,
                    BSTAR: 0.0001,
                    MEAN_MOTION_DOT: 0,
                    MEAN_MOTION_DDOT: 0
                };
            }

            // Always populate numeric apo/peri for real GP satellites too (crucial for altitude filtering!)
            let apo, peri;
            if (Number.isFinite(satApo) && Number.isFinite(satPeri) && satApo > 0) {
                apo = satApo;
                peri = satPeri;
            } else {
                const derived = computeApogeePerigee(gpItem.MEAN_MOTION, gpItem.ECCENTRICITY);
                apo = derived.apo;
                peri = derived.peri;
            }

            const obj = {
                ...gpItem,
                apo,
                peri,
                hasRealGP,
                objectType: satcatData.type || 'UNK',
                opsStatus: satcatData.ops || 'UNK',
                owner: satcatData.owner || 'UNK',
                launchDate: satcatData.launchDate || 'UNK',
                rcsSize: satcatData.rcs || 'UNK'
            };

            // Categorization per SATCAT type and operational status
            let category = 'unknown';
            if (obj.objectType === 'PAY') {
                if (['+', 'P', 'B', 'S', 'X'].includes(obj.opsStatus)) {
                    category = 'active';
                } else {
                    category = 'dead';
                }
            } else if (obj.objectType === 'R/B') {
                category = 'rocket';
            } else if (obj.objectType === 'DEB') {
                category = 'debris';
            }
            obj.category = category;

            let orbitType = 'HEO';
            const mm = obj.MEAN_MOTION;
            if (mm !== undefined) {
                if (mm > 11.25) orbitType = 'LEO';
                else if (mm >= 2 && mm <= 11.25) orbitType = 'MEO';
                else if (mm >= 0.9 && mm <= 1.1) orbitType = 'GEO';
            }
            obj.orbitType = orbitType;

            // Precomputed uppercase search keys for fast ranked autocomplete
            obj._searchName = (obj.OBJECT_NAME || '').toUpperCase();
            obj._searchId = String(obj.NORAD_CAT_ID);

            const idx = this.objects.length;
            this.objects.push(obj);

            this.noradToIndex.set(strId, idx);
            this.index.set(strId, obj);
            if (obj._searchName) {
                this.index.set(obj._searchName, obj);
            }

            if (!this.categoryFilterIndex.has(category)) {
                this.categoryFilterIndex.set(category, []);
            }
            this.categoryFilterIndex.get(category).push(obj);

            if (!this.orbitFilterIndex.has(orbitType)) {
                this.orbitFilterIndex.set(orbitType, []);
            }
            this.orbitFilterIndex.get(orbitType).push(obj);
        }
    }

    getObjects() {
        return this.objects;
    }

    getMetadata() {
        return this.metadata;
    }

    getByNoradId(id) {
        return this.index.get(String(id));
    }

    getIndexByNoradId(id) {
        const idx = this.noradToIndex.get(String(id));
        return idx !== undefined ? idx : -1;
    }

    /**
     * Fast ranked search by NORAD ID (exact or prefix) and Object Name (exact, prefix, substring).
     */
    search(query, limit = 50) {
        if (!query) return [];
        const q = String(query).trim().toUpperCase();
        if (!q) return [];

        const exactMatches = [];
        const prefixMatches = [];
        const partialMatches = [];

        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            const id = obj._searchId;
            const name = obj._searchName;

            if (id === q || name === q) {
                exactMatches.push(obj);
            } else if (name.startsWith(q) || id.startsWith(q)) {
                prefixMatches.push(obj);
            } else if (name.includes(q)) {
                partialMatches.push(obj);
            }
        }

        return exactMatches.concat(prefixMatches, partialMatches).slice(0, limit);
    }

    getObjectsByCategory(category) {
        return this.categoryFilterIndex.get(category) || [];
    }

    getObjectsByOrbitType(type) {
        return this.orbitFilterIndex.get(type) || [];
    }
}
