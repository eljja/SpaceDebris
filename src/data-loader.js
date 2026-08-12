export class DataLoader {
    constructor() {
        this.objects = [];
        this.metadata = null;
        this.index = new Map();
        this.categoryFilterIndex = new Map();
        this.orbitFilterIndex = new Map();
    }

    async loadAll(onProgress = () => {}) {
        try {
            onProgress(0, 4, 'Starting data load...');
            
            const fetchJSON = async (url) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch ${url}`);
                return await response.json();
            };

            const [gpActive, gpDebris, satcat, metadata] = await Promise.all([
                fetchJSON('./data/gp-active.json').then(res => { onProgress(1, 4, 'Loaded active satellites'); return res; }),
                fetchJSON('./data/gp-debris.json').then(res => { onProgress(2, 4, 'Loaded debris'); return res; }),
                fetchJSON('./data/satcat.json').then(res => { onProgress(3, 4, 'Loaded SATCAT'); return res; }),
                fetchJSON('./data/metadata.json').then(res => { onProgress(4, 4, 'Loaded metadata'); return res; })
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
                        mergedGP.set(item.NORAD_CAT_ID, item);
                    }
                }
            }
        };
        
        processGPArray(gpActive);
        processGPArray(gpDebris);

        this.objects = [];
        this.index.clear();
        this.categoryFilterIndex.clear();
        this.orbitFilterIndex.clear();

        for (const [noradId, gpItem] of mergedGP.entries()) {
            const strId = String(noradId);
            const satcatData = satcat[strId] || {};
            
            const obj = {
                ...gpItem,
                objectType: satcatData.type || 'UNK',
                opsStatus: satcatData.ops || 'UNK',
                owner: satcatData.owner || 'UNK',
                launchDate: satcatData.launchDate || 'UNK',
                rcsSize: satcatData.rcs || 'UNK'
            };

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

            this.objects.push(obj);
            
            this.index.set(strId, obj);
            if (obj.OBJECT_NAME) {
                this.index.set(obj.OBJECT_NAME.toUpperCase(), obj);
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

    search(query) {
        if (!query) return [];
        const upperQuery = query.toUpperCase();
        return this.objects.filter(obj => 
            (obj.OBJECT_NAME && obj.OBJECT_NAME.toUpperCase().includes(upperQuery)) ||
            (String(obj.NORAD_CAT_ID) === upperQuery)
        );
    }

    getObjectsByCategory(category) {
        return this.categoryFilterIndex.get(category) || [];
    }

    getObjectsByOrbitType(type) {
        return this.orbitFilterIndex.get(type) || [];
    }
}
