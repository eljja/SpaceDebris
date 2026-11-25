/**
 * SpaceDebris — Spatial Hash Grid 3D Collision Detection
 * Reduces collision detection from O(N^2) to O(N) by partitioning 3D space
 * into cubic buckets and supporting swept-segment insertion + backward CPA
 * to prevent tunneling at high time-warp speeds.
 */

export class SpatialHashGrid {
  constructor(cellSize = 60.0) {
    this.cellSize = cellSize; // km cell size
    this.grid = new Map();
  }

  clear() {
    this.grid.clear();
  }

  _insertCell(ix, iy, iz, index) {
    const key = `${ix},${iy},${iz}`;
    let cell = this.grid.get(key);
    if (!cell) {
      cell = { cx: ix, cy: iy, cz: iz, items: [] };
      this.grid.set(key, cell);
    }
    cell.items.push(index);
  }

  insert(index, position) {
    if (!position || typeof position.x !== 'number') return;
    const inv = 1.0 / this.cellSize;
    const ix = Math.floor(position.x * inv);
    const iy = Math.floor(position.y * inv);
    const iz = Math.floor(position.z * inv);
    this._insertCell(ix, iy, iz, index);
  }

  /**
   * Inserts an object into all grid cells overlapping its traversed segment
   * during the substep: [pos - vel * dtSec, pos].
   * Prevents spatial tunneling when displacement exceeds cellSize under high time warp.
   */
  insertSwept(index, position, velocity, dtSec) {
    if (!position || typeof position.x !== 'number') return;
    if (!velocity || !dtSec || dtSec <= 0) {
      this.insert(index, position);
      return;
    }

    const inv = 1.0 / this.cellSize;
    const prevX = position.x - velocity.vx * dtSec;
    const prevY = position.y - velocity.vy * dtSec;
    const prevZ = position.z - velocity.vz * dtSec;

    const ix0 = Math.floor(prevX * inv);
    const iy0 = Math.floor(prevY * inv);
    const iz0 = Math.floor(prevZ * inv);
    const ix1 = Math.floor(position.x * inv);
    const iy1 = Math.floor(position.y * inv);
    const iz1 = Math.floor(position.z * inv);

    // Fast path: stayed in the same cell
    if (ix0 === ix1 && iy0 === iy1 && iz0 === iz1) {
      this._insertCell(ix1, iy1, iz1, index);
      return;
    }

    // Sample along the 3D segment (DDA-like stepping) instead of filling full 3D bounding volume
    const maxAxisSpan = Math.max(Math.abs(ix1 - ix0), Math.abs(iy1 - iy0), Math.abs(iz1 - iz0));
    const steps = Math.min(12, Math.max(1, maxAxisSpan));

    let lastKey = '';
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const sx = prevX + (position.x - prevX) * t;
      const sy = prevY + (position.y - prevY) * t;
      const sz = prevZ + (position.z - prevZ) * t;
      const ix = Math.floor(sx * inv);
      const iy = Math.floor(sy * inv);
      const iz = Math.floor(sz * inv);
      const key = `${ix},${iy},${iz}`;
      if (key !== lastKey) {
        this._insertCell(ix, iy, iz, index);
        lastKey = key;
      }
    }
  }

  /**
   * Finds pairs of objects whose minimum distance during the traversed step [-dtSec, 0]
   * is less than thresholdKm.
   * Uses backward CPA (Closest Point of Approach) linear swept-sphere test.
   *
   * @param {Array<Object>} positions - End-of-step {x, y, z} positions (km)
   * @param {number} thresholdKm - Distance threshold for collision
   * @param {Array<Object>} [velocities] - Optional {vx, vy, vz} velocities (km/s) for CPA
   * @param {number} [dtSec] - Substep dt in seconds for swept test
   * @returns {Array<Array<number>>} Array of index pairs [idxA, idxB]
   */
  findCollisions(positions, thresholdKm = 30.0, velocities = null, dtSec = 0) {
    const collisions = [];
    const thresholdSq = thresholdKm * thresholdKm;
    const checkedPairs = new Set();
    const useCPA = Boolean(velocities && dtSec > 0);

    for (const cell of this.grid.values()) {
      const { cx, cy, cz, items } = cell;

      for (let ox = 0; ox <= 1; ox++) {
        for (let oy = (ox === 0 ? 0 : -1); oy <= 1; oy++) {
          for (let oz = (ox === 0 && oy === 0 ? 0 : -1); oz <= 1; oz++) {
            const neighborCell = (ox === 0 && oy === 0 && oz === 0)
              ? cell
              : this.grid.get(`${cx + ox},${cy + oy},${cz + oz}`);
            if (!neighborCell) continue;

            const isSameCell = (neighborCell === cell);
            const neighborItems = neighborCell.items;

            for (let i = 0; i < items.length; i++) {
              const idxA = items[i];
              const posA = positions[idxA];
              if (!posA) continue;

              const startJ = isSameCell ? i + 1 : 0;
              for (let j = startJ; j < neighborItems.length; j++) {
                const idxB = neighborItems[j];
                if (idxA === idxB) continue;

                // Numeric pair key (safe up to 65535 particles without string allocation)
                const lo = idxA < idxB ? idxA : idxB;
                const hi = idxA < idxB ? idxB : idxA;
                const pairKey = (lo << 16) | hi;
                if (checkedPairs.has(pairKey)) continue;
                checkedPairs.add(pairKey);

                const posB = positions[idxB];
                if (!posB) continue;

                // Discrete end-of-step distance check (fast path)
                const dx = posA.x - posB.x;
                const dy = posA.y - posB.y;
                const dz = posA.z - posB.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq <= thresholdSq) {
                  collisions.push([idxA, idxB]);
                  continue;
                }

                // Backward CPA swept-sphere test over the traversed interval [-dtSec, 0]
                if (useCPA) {
                  const velA = velocities[idxA];
                  const velB = velocities[idxB];
                  if (!velA || !velB) continue;

                  const dvx = velA.vx - velB.vx;
                  const dvy = velA.vy - velB.vy;
                  const dvz = velA.vz - velB.vz;

                  const dvDotDr = dvx * dx + dvy * dy + dvz * dz;
                  const dvDotDv = dvx * dvx + dvy * dvy + dvz * dvz;

                  if (dvDotDv < 1e-10) continue;

                  // Relative position at time tau in [-dtSec, 0] is dr + dv * tau
                  let tCPA = -dvDotDr / dvDotDv;
                  if (tCPA < -dtSec) tCPA = -dtSec;
                  else if (tCPA > 0) tCPA = 0;

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
   * Queries indexed objects within thresholdKm of a given 3D position.
   * Supports either array of {x,y,z} objects or flat Float32Array (stride 3).
   */
  queryNearby(position, positions, thresholdKm = 35.0) {
    if (!position) return [];
    const thresholdSq = thresholdKm * thresholdKm;
    const inv = 1.0 / this.cellSize;
    const cx = Math.floor(position.x * inv);
    const cy = Math.floor(position.y * inv);
    const cz = Math.floor(position.z * inv);

    const isFlat = positions instanceof Float32Array || positions instanceof Float64Array;
    const results = [];
    const searchRadiusCells = Math.max(1, Math.ceil(thresholdKm * inv));

    for (let ox = -searchRadiusCells; ox <= searchRadiusCells; ox++) {
      for (let oy = -searchRadiusCells; oy <= searchRadiusCells; oy++) {
        for (let oz = -searchRadiusCells; oz <= searchRadiusCells; oz++) {
          const cell = this.grid.get(`${cx + ox},${cy + oy},${cz + oz}`);
          if (!cell) continue;

          const items = cell.items;
          for (let i = 0; i < items.length; i++) {
            const idx = items[i];
            let dx, dy, dz;
            if (isFlat) {
              const base = idx * 3;
              dx = position.x - positions[base];
              dy = position.y - positions[base + 1];
              dz = position.z - positions[base + 2];
            } else {
              const pos = positions[idx];
              if (!pos) continue;
              dx = position.x - pos.x;
              dy = position.y - pos.y;
              dz = position.z - pos.z;
            }
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
