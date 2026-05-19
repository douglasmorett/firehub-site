const https = require('https');
function f(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(u, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, location: res.headers.location }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
async function main() {
  const B = 'https://firehubfood.com.br';
  // Deploy check
  const h = await f(B + '/login');
  const m = h.body.match(/data-dpl-id="([^"]+)"/);
  console.log('Deploy:', m ? m[1] : 'unknown');
  // CSRF
  const c1 = await f(B + '/api/auth/csrf');
  const csrf = JSON.parse(c1.body);
  const ck1 = (c1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  // Login
  const lr = await f(B + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ck1 },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email: 'Sousa-nik@hormail.com', password: '123456', redirect: 'false', json: 'true' }).toString()
  });
  console.log('Login status:', lr.status, 'body:', lr.body.substring(0, 100));
  const ck2 = (lr.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const allCk = ck1 + '; ' + ck2;
  // Session
  const sess = await f(B + '/api/auth/session', { headers: { Cookie: allCk } });
  console.log('Session:', sess.body.substring(0, 200));
  // /api/me
  const me = await f(B + '/api/me', { headers: { Cookie: allCk } });
  console.log('/api/me:', me.status, me.body);
  // /store
  const store = await f(B + '/store', { headers: { Cookie: allCk } });
  console.log('/store status:', store.status, 'redirect:', store.location || 'none');
  if (store.status === 200 && !store.body.includes('__next_error__')) console.log('✅ /store loaded OK!');
  else if (store.body.includes('__next_error__')) console.log('❌ /store has server error');
}
main().catch(e => console.error(e));
