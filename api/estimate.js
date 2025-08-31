<script type="text/plain" data-filename="api/estimate.js">
export default async function handler(req, res) {
  // ===== Hardened CORS & headers =====
  const originsEnv = process.env.ALLOWED_ORIGINS || 'https://www.kalilovestories.com,https://kalilovestories.com';
  // Note: CORS checks origin only. Both your test page (https://www.kalilovestories.com/test/) and live page (https://www.kalilovestories.com/soft-pricing-estimator/) are covered by the same origin https://www.kalilovestories.com
  const ALLOWED_ORIGINS = new Set(originsEnv.split(',').map(s => s.trim()).filter(Boolean));
  const origin = req.headers.origin || '';
  const isAllowed = ALLOWED_ORIGINS.has(origin);

  const setCors = () => {
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Estimator-Key');
      res.setHeader('Vary', 'Origin');
    }
  };

  if (req.method === 'OPTIONS') { setCors(); return res.status(204).end(); }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed) return res.status(403).json({ error: 'Forbidden' });

  setCors();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    // Basic payload length guard
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (raw.length > 4096) return res.status(413).json({ error: 'Payload too large' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // Optional token check (set ESTIMATOR_PUBLIC_KEY in Vercel env to enable)
    const requiredKey = process.env.ESTIMATOR_PUBLIC_KEY || '';
    if (requiredKey) {
      const provided = req.headers['x-estimator-key'];
      if (provided !== requiredKey) return res.status(401).json({ error: 'Unauthorized' });
    }

    // ---------- PRIVATE PRICING (server-only) ----------
    const baseRates = { 3:1450, 5:2800, 8:3800 };
    const rates = {
      primaryExtraHour: 250,       // post-8h (Traditional)
      microExtraHour: 150,         // post-8h (Micro)
      secondShooterFlat: 500,
      secondShooterExtraHour: 125, // SS post-8h
      album: 350, location: 250, engagement: 495, rehearsal: 750, secondDay: 1250, drone: 300
    };
    const guest = { level1:300, pct1:0.10, level2:500, pct2:0.15 };
    const timelineMult = (t) =>
      t === 'Three months (+15% surcharge)' ? 1.15 :
      t === 'Four weeks (+35% surcharge)'   ? 1.35 : 1.00;

    // ---- sanitize inputs ----
    const clampInt = (v, min, max, def=0) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.max(min, Math.min(max, Math.floor(n)));
    };
    const pick = (v, arr, def) => arr.includes(v) ? v : def;

    const coverageHours = clampInt(body.coverageHours, 0, 24, 0);
    const extraHours    = clampInt(body.extraHours,    0, 24, 0);
    const guestCount    = clampInt(body.guestCount,    0, 2000, 0);
    const secondShooter = !!body.secondShooter;
    const album         = pick(body.album, ['No','Yes'], 'No');
    const locs          = clampInt(body.locs, 0, 10, 0);
    const engagement    = pick(body.engagement, ['No','Yes'], 'No');
    const rehearsal     = pick(body.rehearsal, ['No','Yes'], 'No');
    const secondDay     = pick(body.secondDay, ['No','Yes'], 'No');
    const drone         = pick(body.drone, ['No','Yes'], 'No');
    const timeline      = pick(body.timeline, [
      'One year (no surcharge)',
      'Six months (no surcharge)',
      'Three months (+15% surcharge)',
      'Four weeks (+35% surcharge)'
    ], 'One year (no surcharge)');

    const h = coverageHours;
    const ex = extraHours;
    const totalH = h + ex;
    const g = guestCount;
    const type = Number.isFinite(g) && g <= 50 ? 'Micro' : 'Traditional';

    // Bridge rates so 3h+2=5h and 5h+3=8h
    const bridge35 = (baseRates[5] - baseRates[3]) / (5 - 3);     // 675/h
    const bridge58 = (baseRates[8] - baseRates[5]) / (8 - 5);     // ~333.33/h

    let primary = 0;
    if (totalH <= 3) primary = baseRates[3];
    else if (totalH <= 5) primary = baseRates[3] + (totalH - 3) * bridge35;
    else if (totalH <= 8) primary = baseRates[5] + (totalH - 5) * bridge58;
    else {
      const beyond = totalH - 8;
      const postRate = type === 'Traditional' ? rates.primaryExtraHour : rates.microExtraHour;
      primary = baseRates[8] + beyond * postRate;
    }

    const ssFlat = secondShooter ? rates.secondShooterFlat : 0;
    const ssPost8 = secondShooter && totalH > 8 ? (totalH - 8) * rates.secondShooterExtraHour : 0;

    // Options
    let opt = 0;
    if (album === 'Yes') opt += rates.album;
    opt += locs * rates.location;
    if (engagement === 'Yes') opt += rates.engagement;
    if (rehearsal === 'Yes') opt += rates.rehearsal;
    if (secondDay === 'Yes') opt += rates.secondDay;
    if (drone === 'Yes') opt += rates.drone;

    const pre = primary + ssFlat + ssPost8 + opt;

    let gFactor = 1;
    if (Number.isFinite(g)) {
      if (g > guest.level2) gFactor = 1 + guest.pct2;
      else if (g > guest.level1) gFactor = 1 + guest.pct1;
    }
    const tFactor = timelineMult(timeline);
    const total = pre * gFactor * tFactor;

    const min = Math.round(total * 0.95);
    const max = Math.round(total * 1.15);

    // Return only RANGE + checklist (no itemized $)
    return res.status(200).json({
      min, max,
      checklist: {
        coverage: `${h === 8 ? '8+ hours' : `${h} hours`} + Extra: ${ex}h`,
        totalCoverage: `${totalH} hours`,
        secondShooter: secondShooter ? 'Yes' : 'No',
        guestCount: Number.isFinite(g) ? String(g) : '—',
        type: Number.isFinite(g) ? (g <= 50 ? 'Micro Wedding' : 'Traditional Wedding') : '—',
        timeline,
        album, locs: String(locs), engagement, rehearsal, secondDay, drone
      }
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
}
</script>
