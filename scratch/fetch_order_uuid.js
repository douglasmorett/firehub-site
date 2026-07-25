const fs = require('fs');
const path = require('path');

const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envConfig = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

async function run() {
  const clientId = '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const clientSecret = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

  const authRes = await fetch('https://api.jotaja.com/openDelivery/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.access_token || authData.accessToken;

  const uuid = '96fb4470-93cc-4a43-90a1-64d754f71938';
  const res = await fetch(`https://api.jotaja.com/openDelivery/v1/orders/${uuid}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });

  console.log('Fetch status:', res.status);
  const data = await res.json();
  console.log('ORDER JSON:', JSON.stringify(data, null, 2));
}

run().catch(console.error);
