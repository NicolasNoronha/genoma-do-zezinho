import handler from '../api/index.js';

async function request(action, { method = 'GET', body, token } = {}) {
  let statusCode = 200;
  let payload;
  const req = { method, query: { action }, body, headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = { status(code) { statusCode = code; return this; }, json(value) { payload = value; return this; } };
  await handler(req, res);
  if (statusCode >= 400) throw new Error(`${action}: HTTP ${statusCode} — ${payload?.error || 'erro'}`);
  return payload;
}

const health = await request('health');
const login = await request('login', { method: 'POST', body: { pin: process.env.ADMIN_PIN } });
const classes = await request('classes');
const students = await request('students', { token: login.data.token });
const charges = await request('charges', { token: login.data.token });

console.log(JSON.stringify({
  api: health.ok,
  database: health.database,
  classes: classes.data.length,
  students: students.data.length,
  charges: charges.data.length,
}, null, 2));
