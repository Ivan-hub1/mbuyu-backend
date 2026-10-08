import { Router } from 'express';

const router = Router();

// ─── In-memory cache (1 hour) ─────────────────────────────
let cache: { rates: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Currencies we support
const SUPPORTED = ['UGX', 'USD', 'EUR', 'KES', 'TZS', 'GBP', 'AED'];

// ─── GET /api/forex/rates ─────────────────────────────────
// Returns rates relative to UGX (base = UGX, value = how many UGX per 1 unit)
router.get('/rates', async (_req, res) => {
  try {
    // Return cached if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return res.json({
        base: 'UGX',
        rates: cache.rates,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
        cached: true,
      });
    }

    // Free API — no key required
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!resp.ok) throw new Error(`Forex API returned ${resp.status}`);

    const data = (await resp.json()) as { rates?: Record<string, number> };
    if (!data.rates) throw new Error('No rates in response');

    const usdRates = data.rates;
    const ugxPerUsd = usdRates.UGX;

    if (!ugxPerUsd) throw new Error('UGX rate missing from API');

    // Build rates: how many UGX = 1 unit of X
    const rates: Record<string, number> = {};
    for (const code of SUPPORTED) {
      if (code === 'UGX') {
        rates.UGX = 1;
      } else if (usdRates[code]) {
        rates[code] = ugxPerUsd / usdRates[code];
      }
    }

    cache = { rates, fetchedAt: Date.now() };

    res.json({
      base: 'UGX',
      rates,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
      cached: false,
    });
  } catch (err) {
    console.error('[forex]', err);
    // Fallback rates if API fails (approximate — update occasionally)
    const fallback: Record<string, number> = {
      UGX: 1,
      USD: 3800,
      EUR: 4100,
      KES: 29,
      TZS: 1.45,
      GBP: 4800,
      AED: 1035,
    };
    res.json({
      base: 'UGX',
      rates: fallback,
      fetchedAt: new Date().toISOString(),
      cached: false,
      fallback: true,
    });
  }
});

export default router;