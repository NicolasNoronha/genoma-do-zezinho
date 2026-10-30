import crypto from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

let sqlClient;
let supabaseAdminClient;

function database() {
  if (sqlClient) return sqlClient;
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('POSTGRES_URL não configurada.');
  const localConnection = /(?:localhost|127\.0\.0\.1)/i.test(connectionString);
  try {
    sqlClient = postgres(connectionString, {
      max: 1,
      prepare: false,
      ssl: localConnection ? false : 'require',
      idle_timeout: 20,
      connect_timeout: 10,
    });
    return sqlClient;
  } catch {
    throw new Error('POSTGRES_URL inválida. Copie novamente a URL do Transaction pooler e codifique caracteres especiais da senha.');
  }
}

const json = (res, status, payload) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(payload);
};
const required = (input, fields) => {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === null || String(input[field]).trim() === '');
  if (missing.length) throw new Error(`Preencha os campos obrigatórios: ${missing.join(', ')}.`);
};
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
const validationError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function ageOnDate(birthDate, reference = new Date()) {
  const birth = new Date(`${birthDate}T12:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  const birthday = new Date(Date.UTC(reference.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate(), 12));
  if (reference < birthday) age -= 1;
  return age;
}

async function validatedStudent(sql, input, existingId = null) {
  required(input, ['full_name', 'birth_date', 'guardian_name', 'phone']);
  const fullName = String(input.full_name).trim().replace(/\s+/g, ' ');
  const guardianName = String(input.guardian_name).trim().replace(/\s+/g, ' ');
  const cpf = onlyDigits(input.cpf) || null;
  const guardianCpf = onlyDigits(input.guardian_cpf) || null;
  const phone = onlyDigits(input.phone);
  const email = String(input.email || '').trim().toLowerCase() || null;
  const birthDate = String(input.birth_date || '');
  const classId = input.class_id ? Number(input.class_id) : null;
  if (fullName.length < 3) validationError('Informe o nome completo do aluno.');
  if (guardianName.length < 3) validationError('Informe o nome completo do responsável.');
  if (cpf && !isValidCpf(cpf)) validationError('CPF do aluno inválido.');
  if (guardianCpf && !isValidCpf(guardianCpf)) validationError('CPF do responsável inválido.');
  if (phone.length < 10 || phone.length > 11) validationError('Informe um telefone com DDD válido.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) validationError('Informe um e-mail válido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || ageOnDate(birthDate) === null) validationError('Informe uma data de nascimento válida.');
  const age = ageOnDate(birthDate);
  if (age < 3 || age > 20) validationError('A idade do aluno deve estar entre 3 e 20 anos.');
  if (classId) {
    const [classRow] = await sql`select c.*, count(s.id)::int as student_count from classes c left join students s on s.class_id = c.id and s.id <> ${existingId || 0} and s.status <> 'Inativo' where c.id = ${classId} group by c.id`;
    if (!classRow) validationError('A turma selecionada não existe.');
    if (!classRow.active) validationError('A turma selecionada está inativa.');
    if (age < Number(classRow.min_age) || age > Number(classRow.max_age)) {
      validationError(`O aluno precisa ter entre ${classRow.min_age} e ${classRow.max_age} anos para a turma ${classRow.name}.`);
    }
    if (Number(classRow.student_count) >= Number(classRow.capacity)) validationError('A turma selecionada não possui vagas disponíveis.');
  }
  return {
    classId, fullName, cpf, birthDate,
    medicalNotes: String(input.medical_notes || '').trim(), guardianName, guardianCpf,
    relationship: String(input.relationship || '').trim(), phone, email,
    imageAuthorized: Boolean(input.image_authorized),
    status: ['Ativo', 'Pré-inscrição', 'Inativo'].includes(input.status) ? input.status : 'Ativo',
  };
}

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

function supabaseStorage() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) {
    const error = new Error('Fotos ainda não foram configuradas no servidor.');
    error.status = 503;
    throw error;
  }
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return supabaseAdminClient;
}

async function signedPhotoUrl(path) {
  if (!path) return null;
  try {
    const { data, error } = await supabaseStorage().storage.from('student-photos').createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  } catch { return null; }
}

async function uploadStudentPhoto(studentId, dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error('Formato de foto inválido. Use JPG, PNG ou WebP.');
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 1572864) {
    const error = new Error('A foto deve ter no máximo 1,5 MB.');
    error.status = 413;
    throw error;
  }
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
  const path = `${studentId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseStorage().storage.from('student-photos').upload(path, buffer, { contentType: match[1], upsert: true });
  if (error) throw new Error(error.message || 'Não foi possível salvar a foto.');
  return path;
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
      const sql = database();
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
    const sql = database();

    if (action === 'classes' && method === 'GET') {
      const rows = await sql`select c.*, count(s.id)::int as student_count from classes c left join students s on s.class_id = c.id and s.status <> 'Inativo' group by c.id order by c.created_at desc`;
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
      const data = await Promise.all(rows.map(async (student) => ({
        ...student,
        photo_url: await signedPhotoUrl(student.photo_path),
      })));
      return json(res, 200, { ok: true, data });
    }
    if (action === 'students' && method === 'POST') {
      const input = bodyOf(req);
      const admin = isAdmin(req);
      const data = await validatedStudent(sql, { ...input, class_id: admin ? input.class_id : null, status: admin ? input.status : 'Pré-inscrição' });
      if (!admin) {
        const [publicClass] = await sql`select name, min_age, max_age from classes where active = true order by created_at asc limit 1`;
        const age = ageOnDate(data.birthDate);
        if (publicClass && (age < Number(publicClass.min_age) || age > Number(publicClass.max_age))) {
          validationError(`Nesta pré-inscrição, o aluno precisa ter entre ${publicClass.min_age} e ${publicClass.max_age} anos.`);
        }
      }
      const [row] = await sql`insert into students (class_id, full_name, cpf, birth_date, medical_notes, guardian_name, guardian_cpf, relationship, phone, email, image_authorized, status)
        values (${data.classId}, ${data.fullName}, ${data.cpf}, ${data.birthDate}, ${data.medicalNotes}, ${data.guardianName}, ${data.guardianCpf}, ${data.relationship}, ${data.phone}, ${data.email}, ${data.imageAuthorized}, ${data.status}) returning *`;
      return json(res, 201, { ok: true, data: row });
    }
    if (action === 'students' && method === 'PATCH') {
      requireAdmin(req);
      const input = bodyOf(req); required(input, ['id']);
      const id = Number(input.id);
      const [existing] = await sql`select * from students where id = ${id}`;
      if (!existing) return json(res, 404, { ok: false, error: 'Aluno não encontrado.' });
      const data = await validatedStudent(sql, input, id);
      const [row] = await sql`update students set class_id = ${data.classId}, full_name = ${data.fullName}, cpf = ${data.cpf}, birth_date = ${data.birthDate}, medical_notes = ${data.medicalNotes}, guardian_name = ${data.guardianName}, guardian_cpf = ${data.guardianCpf}, relationship = ${data.relationship}, phone = ${data.phone}, email = ${data.email}, image_authorized = ${data.imageAuthorized}, status = ${data.status}, updated_at = now() where id = ${id} returning *`;
      const [classRow] = row.class_id ? await sql`select name from classes where id = ${row.class_id}` : [];
      return json(res, 200, { ok: true, data: { ...row, class_name: classRow?.name || null, photo_url: await signedPhotoUrl(row.photo_path) } });
    }
    if (action === 'students' && method === 'DELETE') {
      requireAdmin(req);
      const input = bodyOf(req); required(input, ['id']);
      const id = Number(input.id);
      const [student] = await sql`select id, full_name, photo_path from students where id = ${id}`;
      if (!student) return json(res, 404, { ok: false, error: 'Aluno não encontrado.' });
      const [financial] = await sql`select count(*)::int as total from charges where student_id = ${id}`;
      if (Number(financial.total) > 0) return json(res, 409, { ok: false, error: 'Este aluno possui histórico financeiro. Edite o cadastro e altere o status para Inativo.' });
      await sql`delete from students where id = ${id}`;
      if (student.photo_path) {
        try { await supabaseStorage().storage.from('student-photos').remove([student.photo_path]); } catch { /* A exclusão do cadastro não depende da limpeza do arquivo. */ }
      }
      return json(res, 200, { ok: true, data: { id, full_name: student.full_name } });
    }
    if (action === 'student_photo' && method === 'POST') {
      requireAdmin(req);
      const input = bodyOf(req); required(input, ['student_id', 'data_url']);
      const [student] = await sql`select id, photo_path from students where id = ${Number(input.student_id)}`;
      if (!student) return json(res, 404, { ok: false, error: 'Aluno não encontrado.' });
      const path = await uploadStudentPhoto(student.id, input.data_url);
      await sql`update students set photo_path = ${path}, updated_at = now() where id = ${student.id}`;
      return json(res, 200, { ok: true, data: { photo_path: path, photo_url: await signedPhotoUrl(path) } });
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
      const total = mode === 'subscription' ? 1 : 1 + (includeEnrollment ? 1 : 0);
      const [charge] = await sql`insert into charges (student_id, mode, include_enrollment, include_monthly, total_amount, reference, due_date, status)
        values (${student.id}, ${mode}, ${includeEnrollment}, true, ${total}, ${String(input.reference).trim()}, ${input.due_date || null}, 'creating') returning id`;
      const externalReference = `GZ-CHARGE-${charge.id}`;
      let result;
      if (mode === 'subscription') {
        if (!student.email) throw new Error('O aluno precisa ter e-mail do responsável para criar uma assinatura.');
        const backUrl = process.env.MERCADO_PAGO_BACK_URL;
        if (!backUrl) throw new Error('MERCADO_PAGO_BACK_URL não configurada.');
        result = await mercadoPago('/preapproval', 'POST', { reason: 'Mensalidade Genoma do Zezinho', external_reference: externalReference, payer_email: student.email, back_url: backUrl, auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 1, currency_id: 'BRL' }, status: 'pending' });
      } else {
        const items = [];
        if (includeEnrollment) items.push({ id: 'inscricao', title: 'Taxa de inscrição — Genoma do Zezinho', quantity: 1, currency_id: 'BRL', unit_price: 1 });
        items.push({ id: 'mensalidade', title: `Mensalidade — ${String(input.reference).trim()}`, quantity: 1, currency_id: 'BRL', unit_price: 1 });
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
    if (error.code === '23505') return json(res, 409, { ok: false, error: 'Já existe um aluno cadastrado com este CPF.' });
    if (error.code === '23503') return json(res, 400, { ok: false, error: 'A turma selecionada não existe mais.' });
    return json(res, error.status || 500, { ok: false, error: error.message || 'Erro interno.' });
  }
}
