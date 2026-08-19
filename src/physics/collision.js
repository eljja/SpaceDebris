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
   * Finds pairs of objects whose minimum distance during the frame is less than thresholdKm.
   * Uses CPA (Closest Point of Approach) linear swept-sphere test to prevent tunneling
   * at relative velocities up to 15 km/s.
   *
   * @param {Array<Object>} positions - Current {x, y, z} positions (km)
   * @param {number} thresholdKm - Distance threshold for collision
   * @param {Array<Object>} [velocities] - Optional {vx, vy, vz} velocities (km/s) for CPA
   * @param {number} [dtSec] - Frame dt in seconds for swept test
   * @returns {Array<Array<number>>} Array of index pairs [idxA, idxB]
   */
  findCollisions(positions, thresholdKm = 30.0, velocities = null, dtSec = 0) {
    const collisions = [];
    const thresholdSq = thresholdKm * thresholdKm;
    const checkedPairs = new Set();
    const useCPA = velocities && dtSec > 0;

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

                // Discrete distance check first (fast path)
                const dx = posA.x - posB.x;
                const dy = posA.y - posB.y;
                const dz = posA.z - posB.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq <= thresholdSq) {
                  collisions.push([idxA, idxB]);
                  continue;
                }

                // CPA swept-sphere test: check if minimum distance during [0, dt] < threshold
                // Prevents tunneling at high relative velocities (up to 15 km/s)
                if (useCPA) {
                  const velA = velocities[idxA];
                  const velB = velocities[idxB];
                  if (!velA || !velB) continue;

                  // Relative velocity: dv = vA - vB
                  const dvx = velA.vx - velB.vx;
                  const dvy = velA.vy - velB.vy;
                  const dvz = velA.vz - velB.vz;

                  const dvDotDr = dvx * dx + dvy * dy + dvz * dz;
                  const dvDotDv = dvx * dvx + dvy * dvy + dvz * dvz;

                  if (dvDotDv < 1e-10) continue; // Negligible relative velocity

                  // Time of closest approach: t_cpa = -dot(dr, dv) / dot(dv, dv)
                  let tCPA = -dvDotDr / dvDotDv;
                  tCPA = Math.max(0, Math.min(tCPA, dtSec)); // Clamp to [0, dt]

                  // Distance at CPA
                  const cpx = dx + dvx * tCPA;
                  const cpy = dy + dvy * tCPA;
                  const cpz = dz + dvz * tCPA;
                  const cpDistSq = cpx * cpx + cpy * cpy + cpz * cpz;

                  if (cpDistSq <= thresholdSq) {
                    collisions.push([idxA, idxB]);
                  }
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
