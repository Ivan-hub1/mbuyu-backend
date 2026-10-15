import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * Reverse-geocode a lat/lng into a human-readable place name.
 * Uses Nominatim (OpenStreetMap) — free, no API key.
 * Nominatim asks for a User-Agent and max 1 req/sec.
 * We cache results in memory for 10 minutes to reduce hits.
 */

interface CachedResult {
  name: string;
  details: any;
  cachedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, CachedResult>();

function cacheKey(lat: number, lng: number) {
  // Round to 4 decimal places (~11m precision) to boost hit rate
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

router.use(requireAuth);

// ─── GET /api/geocode/reverse?lat=..&lng=.. ──────────────
router.get('/reverse', async (req: AuthRequest, res: Response) => {
  try {
    const lat = parseFloat(String(req.query.lat));
    const lng = parseFloat(String(req.query.lng));

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng are required numbers' });
      return;
    }

    const key = cacheKey(lat, lng);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
      res.json({ name: hit.name, details: hit.details, cached: true });
      return;
    }

    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'json');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('zoom', '14'); // locality-level, not building-level
    url.searchParams.set('addressdetails', '1');

    const resp = await fetch(url.toString(), {
      headers: {
        // Nominatim policy requires a descriptive User-Agent
        'User-Agent': 'MbuyuCFL/1.0 (contact: operations@mbuyucfl.com)',
        'Accept-Language': 'en',
      },
    });

    if (!resp.ok) {
      console.error('[geocode] upstream error', resp.status, resp.statusText);
      res.json({
        name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        details: null,
        fallback: true,
      });
      return;
    }

    const data: any = await resp.json();

    // Build a nice human-readable name
    const addr = data.address || {};
    const placeName =
      // Priority: city/town/village/suburb → county → state → country
      addr.city ||
      addr.town ||
      addr.village ||
      addr.suburb ||
      addr.hamlet ||
      addr.county ||
      addr.state ||
      addr.country ||
      data.display_name?.split(',')[0] ||
      `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    // Compose "Kampala, Uganda" style name
    const region = addr.state || addr.country || '';
    const displayName =
      region && placeName !== region ? `${placeName}, ${region}` : placeName;

    const result = {
      name: displayName,
      details: {
        city: addr.city || addr.town || addr.village || null,
        county: addr.county || null,
        state: addr.state || null,
        country: addr.country || null,
        fullAddress: data.display_name || null,
      },
      cached: false,
    };

    cache.set(key, { ...result, cachedAt: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[GET /geocode/reverse]', err);
    // Graceful fallback — return coordinates as the name
    const lat = parseFloat(String(req.query.lat));
    const lng = parseFloat(String(req.query.lng));
    res.json({
      name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      details: null,
      fallback: true,
    });
  }
});

export default router;