/**
 * SpaceDebris — Shared Orbital Mechanics & Coordinate Utilities
 * Zero-dependency pure functions shared by DataLoader, OrbitRenderer, Earth, UIManager, and tests.
 *
 * Coordinate convention:
 *   ECI (TEME): X = Vernal Equinox, Z = North Pole, Y = Z × X
 *   Three.js:   X = ECI.x, Y = ECI.z (North), Z = -ECI.y
 */

export const MU_EARTH = 398600.4418;        // km³/s²
export const RE_WGS84 = 6378.137;           // Earth equatorial radius (km)
export const RE_POLAR = 6356.7523142;       // Earth polar radius (km)
export const WGS84_F = 1 / 298.257223563;   // Flattening
export const WGS84_E2 = WGS84_F * (2 - WGS84_F); // First eccentricity squared
export const OMEGA_EARTH = 7.2921159e-5;    // rad/s

/**
 * Computes apogee & perigee altitudes (km above WGS84 equatorial radius)
 * from mean motion (rev/day) and eccentricity.
 */
export function computeApogeePerigee(meanMotionRevDay, eccentricity = 0) {
  const mm = Number(meanMotionRevDay);
  if (!Number.isFinite(mm) || mm <= 0) {
    return { apo: 600, peri: 500 };
  }
  const e = Number.isFinite(Number(eccentricity)) ? Math.max(0, Math.min(0.99, Number(eccentricity))) : 0;
  const n = (mm * 2 * Math.PI) / 86400; // rad/s
  const a = Math.cbrt(MU_EARTH / (n * n)); // semi-major axis (km)
  const apo = Math.round(a * (1 + e) - RE_WGS84);
  const peri = Math.round(a * (1 - e) - RE_WGS84);
  return { apo, peri };
}

/**
 * Formats a floating-point number into standard 8-character TLE implied-decimal
 * scientific notation: [sign][5-digit mantissa][expSign][1-digit exp]
 * where value = ±0.MMMMM × 10^(±E).
 *
 * Example: 0.0001 -> " 10000-3" (0.10000 × 10^-3 = 1e-4)
 */
export function formatTLESci(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || num === 0) return ' 00000-0';

  const sign = num < 0 ? '-' : ' ';
  const abs = Math.abs(num);

  // TLE has implied leading "0.": abs = 0.MMMMM * 10^tleExp -> tleExp = floor(log10(abs)) + 1
  let tleExp = Math.floor(Math.log10(abs)) + 1;
  let mantInt = Math.round((abs / Math.pow(10, tleExp)) * 100000);

  if (mantInt >= 100000) {
    mantInt = Math.round(mantInt / 10);
    tleExp += 1;
  }

  // Values too tiny for 1-digit TLE exponent underflow cleanly to zero
  if (tleExp < -9 || mantInt === 0) return ' 00000-0';
  if (tleExp > 9) {
    mantInt = 99999;
    tleExp = 9;
  }

  const mantStr = String(mantInt).padStart(5, '0');
  const expSign = tleExp >= 0 ? '+' : '-';
  const expStr = String(Math.abs(tleExp));
  return `${sign}${mantStr}${expSign}${expStr}`;
}

/**
 * Converts a CelesTrak OMM JSON record to a valid two-line element (TLE) pair
 * consumable by satellite.twoline2satrec().
 */
export function ommToTLE(omm) {
  try {
    if (!omm || !omm.NORAD_CAT_ID) return null;
    const catNum = Number(omm.NORAD_CAT_ID);
    if (!Number.isFinite(catNum) || catNum <= 0 || catNum > 99999) return null;

    const catId = String(Math.floor(catNum)).padStart(5, '0');
    const cls = (omm.CLASSIFICATION_TYPE || 'U').charAt(0);

    // International Designator from OBJECT_ID (e.g., "1998-067A")
    let intlDes = '        ';
    if (omm.OBJECT_ID) {
      const parts = String(omm.OBJECT_ID).match(/^(\d{4})-(\d{3})(.*)$/);
      if (parts) {
        const yr = parts[1].slice(2);
        const num = parts[2];
        const piece = (parts[3] || '').trim();
        intlDes = (yr + num + piece).substring(0, 8).padEnd(8, ' ');
      }
    }

    // Epoch (ensure UTC parsing even when ISO string lacks trailing 'Z')
    let epochRaw = omm.EPOCH;
    if (typeof epochRaw === 'string' && !epochRaw.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(epochRaw)) {
      epochRaw += 'Z';
    }
    const epochDate = new Date(epochRaw || Date.now());
    if (Number.isNaN(epochDate.getTime())) return null;

    const yr = epochDate.getUTCFullYear();
    const epochYr = String(yr % 100).padStart(2, '0');
    const startOfYear = Date.UTC(yr, 0, 1);
    const epochDay = ((epochDate.getTime() - startOfYear) / 86400000) + 1;
    const epochDayStr = epochDay.toFixed(8).padStart(12, '0');

    // Mean Motion Dot (ndot/2)
    const ndot = Number(omm.MEAN_MOTION_DOT || 0);
    const clampedNdot = Math.max(-0.99999999, Math.min(0.99999999, Number.isFinite(ndot) ? ndot : 0));
    const ndotAbsStr = Math.abs(clampedNdot).toFixed(8).replace(/^0/, '');
    const ndotStr = ((clampedNdot < 0 ? '-' : ' ') + ndotAbsStr).substring(0, 10).padEnd(10, ' ');

    const nddot = formatTLESci(omm.MEAN_MOTION_DDOT);
    const bstar = formatTLESci(omm.BSTAR);
    const elsetNo = String(Math.min(9999, Number(omm.ELEMENT_SET_NO || 999))).padStart(4, ' ');

    const line1 = `1 ${catId}${cls} ${intlDes} ${epochYr}${epochDayStr} ${ndotStr} ${nddot} ${bstar} 0 ${elsetNo}0`;

    const inc = Number(omm.INCLINATION || 0).toFixed(4).padStart(8, ' ');
    const raan = (((Number(omm.RA_OF_ASC_NODE || 0) % 360) + 360) % 360).toFixed(4).padStart(8, ' ');
    const eccNum = Math.max(0, Math.min(0.9999999, Number(omm.ECCENTRICITY || 0)));
    const ecc = eccNum.toFixed(7).substring(2); // 7 digits after "0."
    const argp = (((Number(omm.ARG_OF_PERICENTER || 0) % 360) + 360) % 360).toFixed(4).padStart(8, ' ');
    const ma = (((Number(omm.MEAN_ANOMALY || 0) % 360) + 360) % 360).toFixed(4).padStart(8, ' ');
    const mm = Number(omm.MEAN_MOTION || 0).toFixed(8).padStart(11, ' ');
    const revNum = String(Math.floor(Number(omm.REV_AT_EPOCH || 0)) % 100000).padStart(5, ' ');

    const line2 = `2 ${catId} ${inc} ${raan} ${ecc} ${argp} ${ma} ${mm}${revNum}0`;

    return { line1, line2 };
  } catch {
    return null;
  }
}

/**
 * Computes Greenwich Mean Sidereal Time (GMST) in radians [0, 2π) from a JS Date.
 * Uses the standard IAU-82 / Vallado polynomial (accurate to < 0.1 arcsec).
 */
export function gmstFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const jd = d.getTime() / 86400000 + 2440587.5;
  const tut1 = (jd - 2451545.0) / 36525.0;

  let gmstSec =
    67310.54841 +
    (876600.0 * 3600.0 + 8640184.812866) * tut1 +
    0.093104 * tut1 * tut1 -
    6.2e-6 * tut1 * tut1 * tut1;

  gmstSec = ((gmstSec % 86400) + 86400) % 86400;
  return (gmstSec / 86400) * 2 * Math.PI;
}

/**
 * Converts a Three.js scene position (km, ECI mapped as X=ECI.x, Y=ECI.z, Z=-ECI.y)
 * into geodetic Latitude (deg), Longitude (deg), and WGS84 Altitude (km).
 */
export function threePosToGeodetic(pos, gmstRad) {
  // Three.js -> ECI
  const eciX = pos.x;
  const eciY = -pos.z;
  const eciZ = pos.y;

  // ECI -> ECEF (rotate by -GMST around polar axis)
  const cosG = Math.cos(gmstRad);
  const sinG = Math.sin(gmstRad);
  const ecefX =  eciX * cosG + eciY * sinG;
  const ecefY = -eciX * sinG + eciY * cosG;
  const ecefZ =  eciZ;

  // Longitude in [-180, 180]
  const lonRad = Math.atan2(ecefY, ecefX);

  // Iterative WGS84 geodetic latitude & altitude (converges in 3-4 iterations to sub-meter accuracy)
  const p = Math.sqrt(ecefX * ecefX + ecefY * ecefY);
  let latRad = Math.atan2(ecefZ, p * (1 - WGS84_E2));
  let N = RE_WGS84;

  for (let i = 0; i < 4; i++) {
    const sinLat = Math.sin(latRad);
    N = RE_WGS84 / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    latRad = Math.atan2(ecefZ + WGS84_E2 * N * sinLat, p);
  }

  const cosLat = Math.cos(latRad);
  const alt = Math.abs(cosLat) > 1e-6
    ? (p / cosLat) - N
    : (Math.abs(ecefZ) / Math.abs(Math.sin(latRad))) - N * (1 - WGS84_E2);

  return {
    lat: latRad * (180 / Math.PI),
    lon: lonRad * (180 / Math.PI),
    alt
  };
}
