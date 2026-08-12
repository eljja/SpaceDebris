/**
 * SpaceDebris — Spatial Hash Grid 3D Collision Detection
 * Reduces collision detection from O(N^2) to O(N) by partitioning 3D space
 * into 50km x 50km x 50km cubic buckets.
 */

export class SpatialHashGrid {
  constructor(cellSize = 50.0) {
    this.cellSize = cellSize; // 50 km cell size
    this.grid = new Map();
  }

  clear() {
    this.grid.clear();
  }

  _getKey(x, y, z) {
    const ix = Math.floor(x / this.cellSize);
    const iy = Math.floor(y / this.cellSize);
    const iz = Math.floor(z / this.cellSize);
    return `${ix},${iy},${iz}`;
  }

  insert(index, position) {
    const key = this._getKey(position.x, position.y, position.z);
    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    cell.push(index);
  }

  /**
   * Finds pairs of objects whose distance is less than collisionThresholdKm
   * @param {Array<Object>} positions - Array of {x, y, z} positions
   * @param {number} thresholdKm - Distance threshold for collision (default 5 km)
   * @returns {Array<Array<number>>} Array of index pairs [idxA, idxB]
   */
  findCollisions(positions, thresholdKm = 5.0) {
    const collisions = [];
    const thresholdSq = thresholdKm * thresholdKm;
    const checkedPairs = new Set();

    for (const [key, cell] of this.grid.entries()) {
      if (cell.length < 2) continue;

      // Check pairs within the same cell
      const count = cell.length;
      for (let i = 0; i < count; i++) {
        const idxA = cell[i];
        const posA = positions[idxA];
        if (!posA) continue;

        for (let j = i + 1; j < count; j++) {
          const idxB = cell[j];
          const posB = positions[idxB];
          if (!posB) continue;

          const pairKey = idxA < idxB ? `${idxA}_${idxB}` : `${idxB}_${idxA}`;
          if (checkedPairs.has(pairKey)) continue;
          checkedPairs.add(pairKey);

          // Distance squared check (avoids Math.sqrt)
          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const dz = posA.z - posB.z;
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq <= thresholdSq) {
            collisions.push([idxA, idxB]);
          }
        }
      }
    }

    return collisions;
  }
}
