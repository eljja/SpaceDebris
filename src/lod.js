export class LODController {
    constructor(dataLoader, orbitRenderer) {
        this.dataLoader = dataLoader;
        this.orbitRenderer = orbitRenderer;
        
        this.objects = this.dataLoader.getObjects() || [];
        this.currentLevel = -1;
        
        this.activeFilters = {
            category: null, // null means all, otherwise array of allowed values
            orbitType: null
        };
        
        this.visibleIndices = [];
    }
    
    update(cameraDistance) {
        let newLevel = 1;
        if (cameraDistance > 50000) {
            newLevel = 1;
        } else if (cameraDistance > 20000) {
            newLevel = 2;
        } else if (cameraDistance > 5000) {
            newLevel = 3;
        } else {
            newLevel = 4;
        }
        
        // We only recalculate if the level changed (or if filters changed, which should be called separately)
        if (newLevel !== this.currentLevel) {
            this.currentLevel = newLevel;
            this.recalculateVisibleObjects();
        }
    }
    
    setFilter(filterType, values) {
        if (this.activeFilters[filterType] !== undefined) {
            this.activeFilters[filterType] = values;
            this.recalculateVisibleObjects();
        }
    }
    
    recalculateVisibleObjects() {
        this.visibleIndices = [];
        
        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            
            // 1. Check LOD distance rules
            let allowedByLOD = false;
            
            if (this.currentLevel === 1) {
                // Level 1: Only RCS LARGE objects
                allowedByLOD = (obj.RCS_SIZE === 'LARGE');
            } else if (this.currentLevel === 2) {
                // Level 2: RCS LARGE + MEDIUM
                allowedByLOD = (obj.RCS_SIZE === 'LARGE' || obj.RCS_SIZE === 'MEDIUM');
            } else if (this.currentLevel === 3) {
                // Level 3: All objects EXCEPT small debris
                const isSmallDebris = (obj.OBJECT_TYPE === 'DEBRIS' && obj.RCS_SIZE === 'SMALL');
                allowedByLOD = !isSmallDebris;
            } else if (this.currentLevel === 4) {
                // Level 4: ALL objects
                allowedByLOD = true;
            }
            
            if (!allowedByLOD) continue;
            
            // 2. Check Filters
            let allowedByFilter = true;
            
            if (this.activeFilters.category && this.activeFilters.category.length > 0) {
                if (!this.activeFilters.category.includes(obj.OBJECT_TYPE)) {
                    allowedByFilter = false;
                }
            }
            
            // Assuming orbitType mapping could be added here if there was an ORBIT_TYPE field
            if (this.activeFilters.orbitType && this.activeFilters.orbitType.length > 0) {
                const orbType = obj.ORBIT_TYPE || this.deriveOrbitType(obj);
                if (!this.activeFilters.orbitType.includes(orbType)) {
                    allowedByFilter = false;
                }
            }
            
            if (allowedByFilter) {
                this.visibleIndices.push(i);
            }
        }
        
        this.orbitRenderer.setVisibleObjects(this.visibleIndices);
    }
    
    deriveOrbitType(obj) {
        // Fallback method to determine orbit type if not explicitly provided
        // based on mean motion or period.
        const meanMotion = obj.MEAN_MOTION || 0;
        // Period in minutes = 1440 / mean motion
        if (meanMotion > 11.25) return 'LEO'; // < 128 min
        if (meanMotion > 1.5) return 'MEO';
        if (meanMotion > 0.9 && meanMotion < 1.1) return 'GEO';
        return 'HEO'; // Default fallback for highly elliptical
    }
    
    getCurrentLevel() {
        return this.currentLevel;
    }
    
    getVisibleCount() {
        return this.visibleIndices.length;
    }
    
    getVisibleIndices() {
        return this.visibleIndices;
    }
}
