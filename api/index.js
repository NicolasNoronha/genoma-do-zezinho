import crypto from 'node:crypto';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const localConnection = /(?:localhost|127\.0\.0\.1)/i.test(connectionString || '');
const sql = connectionString
  ? postgres(connectionString, { max: 1, prepare: false, ssl: localConnection ? false : 'require', idle_timeout: 20 })
  : null;

const json = (res, status, payload) => res.status(status).json(payload);
const required = (input, fields) => {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === null || String(input[field]).trim() === '');
  if (missing.length) throw new Error(`Preencha os campos obrigatórios: ${missing.join(', ')}.`);
};
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET precisa ter pelo menos 32 caracteres.');
  return value;
}
function createToken() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function isAdmin(req) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'admin' && Number(data.exp) > Date.now();
  } catch { return false; }
}
function requireAdmin(req) {
  if (!isAdmin(req)) {
    const error = new Error('Acesso administrativo não autorizado.');
    error.status = 401;
    throw error;
  }
}

async function mercadoPago(path, method = 'POST', payload) {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Mercado Pago ainda não foi configurado.');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error || 'Falha na comunicação com o Mercado Pago.');
  return result;
}

function webhookIsValid(req) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!secret) return true;
  const parts = Object.fromEntries(String(req.headers['x-signature'] || '').split(',').map((item) => item.trim().split('=')));
  const dataId = String(req.query?.['data.id'] || req.query?.data_id || bodyOf(req)?.data?.id || '').toLowerCase();
  const requestId = String(req.headers['x-request-id'] || '');
  if (!parts.ts || !parts.v1 || !dataId || !requestId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}

export default async function handler(req, res) {
  const action = String(req.query?.action || 'health');
  const method = req.method || 'GET';
  try {
    if (action === 'health') {
      if (!sql) throw new Error('POSTGRES_URL não configurada.');
      await sql`select 1`;
      return json(res, 200, { ok: true, database: 'connected', mercado_pago: process.env.MERCADO_PAGO_ACCESS_TOKEN ? 'configured' : 'missing' });
    }
    if (action === 'login' && method === 'POST') {
      const input = bodyOf(req);
      const configured = process.env.ADMIN_PIN;
      if (!configured) throw new Error('ADMIN_PIN não configurado.');
      const supplied = String(input.pin || '');
      const valid = supplied.length === configured.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
      if (!valid) return json(res, 401, { ok: false, error: 'PIN incorreto.' });
      return json(res, 200, { ok: true, data: { token: createToken() } });
    }
    if (!sql) throw new Error('POSTGRES_URL não configurada.');

    if (action === 'classes' && method === 'GET') {
      const rows = await sql`select c.*, count(s.id)::int as student_count from classes c left join students s on s.class_id = c.id group by c.id order by c.created_at desc`;
      return json(res, 200, { ok: true, data: rows });
    }
    if (action === 'classes' && method === 'POST') {
      requireAdmin(req);
      const input = bodyOf(req); required(input, ['name', 'category', 'modality', 'min_age', 'max_age', 'capacity']);
      const [row] = await sql`insert into classes (name, category, modality, min_age, max_age, capacity, location, schedule, coach_name)
        values (${String(input.name).trim()}, ${String(input.category).trim()}, ${String(input.modality).trim()}, ${Number(input.min_age)}, ${Number(input.max_age)}, ${Number(input.capacity)}, ${String(input.location || '').trim()}, ${String(input.schedule || '').trim()}, ${String(input.coach_name || '').trim()}) returning *`;
      return json(res, 201, { ok: true, data: row });
    }
    if (action === 'students' && method === 'GET') {
      requireAdmin(req);
      const rows = await sql`select s.*, c.name as class_name from students s left join classes c on c.id = s.class_id order by s.created_at desc`;
      return json(res, 200, { ok: true, data: rows });
    }
    if (action === 'students' && method === 'POST') {
      const input = bodyOf(req); required(input, ['full_name', 'birth_date', 'guardian_name', 'phone']);
      const admin = isAdmin(req);
      const classId = admin && input.class_id ? Number(input.class_id) : null;
      const status = admin ? String(input.status || 'Ativo').trim() : 'Pré-inscrição';
      const [row] = await sql`insert into students (class_id, full_name, cpf, birth_date, medical_notes, guardian_name, guardian_cpf, relationship, phone, email, image_authorized, status)
        values (${classId}, ${String(input.full_name).trim()}, ${String(input.cpf || '').trim() || null}, ${input.birth_date}, ${String(input.medical_notes || '').trim()}, ${String(input.guardian_name).trim()}, ${String(input.guardian_cpf || '').trim() || null}, ${String(input.relationship || '').trim()}, ${String(input.phone).trim()}, ${String(input.email || '').trim() || null}, ${Boolean(input.image_authorized)}, ${status}) returning *`;
      return json(res, 201, { ok: true, data: row });
    }
    if (action === 'charges' && method === 'GET') {
      requireAdmin(req);
      const rows = await sql`select ch.*, s.full_name as student_name, s.guardian_name, s.phone from charges ch join students s on s.id = ch.student_id order by ch.created_at desc`;
      return json(res, 200, { ok: true, data: rows });
    }
    if (action === 'charges' && method === 'POST') {
      requireAdmin(req);
      const input = bodyOf(req); required(input, ['student_id', 'mode', 'reference']);
      const [student] = await sql`select * from students where id = ${Number(input.student_id)}`;
      if (!student) return json(res, 404, { ok: false, error: 'Aluno não encontrado.' });
      const mode = input.mode === 'subscription' ? 'subscription' : 'one_time';
      const includeEnrollment = mode === 'one_time' && Boolean(input.include_enrollment);
      const total = mode === 'subscription' ? 90 : 90 + (includeEnrollment ? 70 : 0);
      const [charge] = await sql`insert into charges (student_id, mode, include_enrollment, include_monthly, total_amount, reference, due_date, status)
        values (${student.id}, ${mode}, ${includeEnrollment}, true, ${total}, ${String(input.reference).trim()}, ${input.due_date || null}, 'creating') returning id`;
      const externalReference = `GZ-CHARGE-${charge.id}`;
      let result;
      if (mode === 'subscription') {
        if (!student.email) throw new Error('O aluno precisa ter e-mail do responsável para criar uma assinatura.');
        const backUrl = process.env.MERCADO_PAGO_BACK_URL;
        if (!backUrl) throw new Error('MERCADO_PAGO_BACK_URL não configurada.');
        result = await mercadoPago('/preapproval', 'POST', { reason: 'Mensalidade Genoma do Zezinho', external_reference: externalReference, payer_email: student.email, back_url: backUrl, auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 90, currency_id: 'BRL' }, status: 'pending' });
      } else {
        const items = [];
        if (includeEnrollment) items.push({ id: 'inscricao', title: 'Taxa de inscrição — Genoma do Zezinho', quantity: 1, currency_id: 'BRL', unit_price: 70 });
        items.push({ id: 'mensalidade', title: `Mensalidade — ${String(input.reference).trim()}`, quantity: 1, currency_id: 'BRL', unit_price: 90 });
        const payload = { items, external_reference: externalReference, payer: { name: student.guardian_name, email: student.email || undefined }, payment_methods: { installments: 1 } };
        if (process.env.MERCADO_PAGO_WEBHOOK_URL) payload.notification_url = process.env.MERCADO_PAGO_WEBHOOK_URL;
        result = await mercadoPago('/checkout/preferences', 'POST', payload);
      }
      const link = result.init_point || result.sandbox_init_point;
      if (!link) throw new Error('O Mercado Pago não retornou o link de pagamento.');
      await sql`update charges set provider_reference = ${result.id || null}, payment_link = ${link}, status = 'pending', updated_at = now() where id = ${charge.id}`;
      return json(res, 201, { ok: true, data: { id: charge.id, payment_link: link, total_amount: total, mode } });
    }
    if (action === 'webhook' && method === 'POST') {
      if (!webhookIsValid(req)) return json(res, 401, { ok: false, error: 'Assinatura do webhook inválida.' });
      const input = bodyOf(req);
      const paymentId = String(input?.data?.id || req.query?.['data.id'] || req.query?.data_id || '');
      if (!paymentId) return json(res, 200, { ok: true });
      const payment = await mercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, 'GET');
      const match = String(payment.external_reference || '').match(/^GZ-CHARGE-(\d+)$/);
      if (match) await sql`update charges set status = ${payment.status || 'unknown'}, updated_at = now() where id = ${Number(match[1])}`;
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: 'Rota não encontrada.' });
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { ok: false, error: error.message || 'Erro interno.' });
  }
}
