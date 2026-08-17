/**
 * SpaceDebris — Spatial Hash Grid 3D Collision Detection
 * Reduces collision detection from O(N^2) to O(N) by partitioning 3D space
 * into 60km x 60km x 60km cubic buckets and checking 27 neighboring cells.
 */

export class SpatialHashGrid {
  constructor(cellSize = 60.0) {
    this.cellSize = cellSize; // 60 km cell size
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
    if (!position || typeof position.x !== 'number') return;
    const key = this._getKey(position.x, position.y, position.z);
    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    cell.push(index);
  }

  /**
   * Finds pairs of objects whose distance is less than thresholdKm across 27 neighbor cells
   * @param {Array<Object>} positions - Array of {x, y, z} positions
   * @param {number} thresholdKm - Distance threshold for collision (default 30 km)
   * @returns {Array<Array<number>>} Array of index pairs [idxA, idxB]
   */
  findCollisions(positions, thresholdKm = 30.0) {
    const collisions = [];
    const thresholdSq = thresholdKm * thresholdKm;
    const checkedPairs = new Set();

    for (const [key, cell] of this.grid.entries()) {
      const parts = key.split(',').map(Number);
      const cx = parts[0];
      const cy = parts[1];
      const cz = parts[2];

      for (let ox = 0; ox <= 1; ox++) {
        for (let oy = (ox === 0 ? 0 : -1); oy <= 1; oy++) {
          for (let oz = (ox === 0 && oy === 0 ? 0 : -1); oz <= 1; oz++) {
            const neighborKey = `${cx + ox},${cy + oy},${cz + oz}`;
            const neighborCell = this.grid.get(neighborKey);
            if (!neighborCell) continue;

            const isSameCell = (ox === 0 && oy === 0 && oz === 0);

            for (let i = 0; i < cell.length; i++) {
              const idxA = cell[i];
              const posA = positions[idxA];
              if (!posA) continue;

              const startJ = isSameCell ? i + 1 : 0;
              for (let j = startJ; j < neighborCell.length; j++) {
                const idxB = neighborCell[j];
                if (idxA === idxB) continue;

                const pairKey = idxA < idxB ? `${idxA}_${idxB}` : `${idxB}_${idxA}`;
                if (checkedPairs.has(pairKey)) continue;
                checkedPairs.add(pairKey);

                const posB = positions[idxB];
                if (!posB) continue;

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
        }
      }
    }

    return collisions;
  }

  /**
   * Queries objects within thresholdKm of a given 3D position
   */
  queryNearby(position, positions, thresholdKm = 35.0) {
    if (!position) return [];
    const thresholdSq = thresholdKm * thresholdKm;
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);
    const cz = Math.floor(position.z / this.cellSize);

    const results = [];
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const key = `${cx + ox},${cy + oy},${cz + oz}`;
          const cell = this.grid.get(key);
          if (!cell) continue;

          for (let i = 0; i < cell.length; i++) {
            const idx = cell[i];
            const pos = positions[idx];
            if (!pos) continue;

            const dx = position.x - pos.x;
            const dy = position.y - pos.y;
            const dz = position.z - pos.z;
            if (dx * dx + dy * dy + dz * dz <= thresholdSq) {
              results.push(idx);
            }
          }
        }
      }
    }
    return results;
  }
}
