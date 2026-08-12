/**
 * SpaceDebris — Level-of-Detail Controller
 * Manages camera-distance-based LOD filtering and user category/orbit-type filters.
 * Uses field names set by DataLoader: obj.category, obj.orbitType, obj.rcsSize
 */

export class LODController {
  constructor(dataLoader, orbitRenderer) {
    this.dataLoader = dataLoader;
    this.orbitRenderer = orbitRenderer;

    this.objects = this.dataLoader.getObjects() || [];
    this.currentLevel = -1;

    // Filters: null = show all; array = show only listed values
    this.activeFilters = {
      category: null,
      orbitType: null
    };

    this.visibleIndices = [];
  }

  update(cameraDistance) {
    let newLevel;
    if (cameraDistance > 50000) {
      newLevel = 1;
    } else if (cameraDistance > 20000) {
      newLevel = 2;
    } else if (cameraDistance > 5000) {
      newLevel = 3;
    } else {
      newLevel = 4;
    }

    if (newLevel !== this.currentLevel) {
      this.currentLevel = newLevel;
      this._recalculate();
    }
  }

  setFilter(filterType, values) {
    if (filterType in this.activeFilters) {
      this.activeFilters[filterType] = values && values.length > 0 ? values : null;
      this._recalculate();
    }
  }

  _recalculate() {
    this.visibleIndices = [];

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];

      // 1. LOD distance check using rcsSize (set by DataLoader)
      let lodOk = false;
      const rcs = obj.rcsSize; // 'LARGE', 'MEDIUM', 'SMALL', or 'UNK'

      switch (this.currentLevel) {
        case 1: // Only LARGE
          lodOk = (rcs === 'LARGE');
          break;
        case 2: // LARGE + MEDIUM
          lodOk = (rcs === 'LARGE' || rcs === 'MEDIUM');
          break;
        case 3: // All except small debris
          lodOk = !(obj.category === 'debris' && rcs === 'SMALL');
          break;
        case 4: // ALL
        default:
          lodOk = true;
          break;
      }

      if (!lodOk) continue;

      // 2. Category filter (uses obj.category: 'active', 'dead', 'rocket', 'debris', 'unknown')
      if (this.activeFilters.category) {
        if (!this.activeFilters.category.includes(obj.category)) continue;
      }

      // 3. Orbit type filter (uses obj.orbitType: 'LEO', 'MEO', 'GEO', 'HEO')
      if (this.activeFilters.orbitType) {
        if (!this.activeFilters.orbitType.includes(obj.orbitType)) continue;
      }

      this.visibleIndices.push(i);
    }

    this.orbitRenderer.setVisibleObjects(this.visibleIndices);
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
