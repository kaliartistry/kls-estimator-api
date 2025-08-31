export default async function handler(req, res) {
  const originsEnv = process.env.ALLOWED_ORIGINS || 'https://www.kalilovestories.com,https://kalilovestories.com';
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
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowed)               return res.status(403).json({ error: 'Forbidden' });

  setCors();
  // ...rest of the function...
}
