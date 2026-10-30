const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const API_URL = '/api';
const WHATSAPP_NUMBER = '';
const ENROLLMENT_FEE = 1;
const MONTHLY_FEE = 1;

const state = { students: [], classes: [], charges: [], generatedCharge: null };
let adminToken = sessionStorage.getItem('gz_admin_token') || '';
const enrollmentDialog = $('#enrollment-dialog');
const adminDialog = $('#admin-dialog');
const enrollmentForm = $('#enrollment-form');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
};
const normalizeText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const studentAge = (value) => {
  if (!value) return '—';
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return `${age} anos`;
};
const studentInitials = (name) => String(name || 'A').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

async function api(action, options = {}) {
  const { admin = false, ...requestOptions } = options;
  const response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(admin && adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(requestOptions.headers || {}),
    },
    ...requestOptions,
  });
  let payload;
  try { payload = await response.json(); } catch { payload = { ok: false, error: 'Resposta inválida da API.' }; }
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Erro HTTP ${response.status}`);
  return payload.data ?? payload;
}

function toast(message) {
  const element = $('.toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3200);
}

function openWhatsApp(message, phone = '') {
  const recipient = String(phone || WHATSAPP_NUMBER).replace(/\D/g, '');
  const base = recipient ? `https://wa.me/${recipient}` : 'https://wa.me/';
  window.open(`${base}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

const revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
  if (entry.isIntersecting) entry.target.classList.add('visible');
}), { threshold: .12 });
$$('.reveal').forEach((element) => revealObserver.observe(element));

$('.menu-toggle').addEventListener('click', (event) => {
  const navigation = $('.main-nav');
  navigation.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', navigation.classList.contains('open'));
});
$$('.main-nav a').forEach((anchor) => anchor.addEventListener('click', () => $('.main-nav').classList.remove('open')));
$$('.whatsapp-contact').forEach((button) => button.addEventListener('click', () => {
  openWhatsApp('Olá! Gostaria de receber mais informações sobre a escolinha Genoma do Zezinho e a turma Sub-13.');
}));

function setStep(number) {
  $$('.form-step', enrollmentForm).forEach((step) => step.classList.toggle('active', Number(step.dataset.step) === number));
  $$('.modal-progress i').forEach((indicator, index) => indicator.classList.toggle('active', index < number));
}
function openEnrollment() {
  enrollmentForm.reset();
  $('.form-success').classList.remove('active');
  setStep(1);
  enrollmentDialog.showModal();
}
$$('.open-enrollment').forEach((button) => button.addEventListener('click', openEnrollment));
$$('.modal-close').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$$('.next-step').forEach((button) => button.addEventListener('click', () => {
  const section = button.closest('.form-step');
  if ($$('input,select,textarea', section).every((field) => field.reportValidity())) setStep(Number(section.dataset.step) + 1);
}));
$$('.prev-step').forEach((button) => button.addEventListener('click', () => setStep(Number(button.closest('.form-step').dataset.step) - 1)));

enrollmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!enrollmentForm.reportValidity()) return;
  const form = Object.fromEntries(new FormData(enrollmentForm));
  const submitButton = $('button[type="submit"]', enrollmentForm);
  submitButton.disabled = true;
  try {
    const student = await api('students', { method: 'POST', body: JSON.stringify({
      full_name: form.studentName, cpf: form.studentCpf, birth_date: form.birthDate,
      medical_notes: form.medical, guardian_name: form.guardianName, guardian_cpf: form.guardianCpf,
      relationship: form.relationship, phone: form.phone, email: form.email,
      image_authorized: Boolean(form.imageAuth), status: 'Pré-inscrição',
    }) });
    $$('.form-step', enrollmentForm).forEach((step) => step.classList.remove('active'));
    $('.form-success').classList.add('active');
    $('.protocol').textContent = `Cadastro GZ-${student.id}`;
    $$('.modal-progress i').forEach((indicator) => indicator.classList.add('active'));
  } catch (error) {
    toast(error.message);
  } finally {
    submitButton.disabled = false;
  }
});
$('.finish-enrollment').addEventListener('click', () => enrollmentDialog.close());

$$('.open-admin').forEach((button) => button.addEventListener('click', () => {
  $('.main-nav').classList.remove('open');
  adminDialog.showModal();
  $('#admin-login').style.display = 'flex';
  $('#admin-panel').classList.remove('active');
}));
$('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button', event.currentTarget);
  button.disabled = true;
  try {
    const result = await api('login', { method: 'POST', body: JSON.stringify({ pin: $('input', event.currentTarget).value }) });
    adminToken = result.token;
    sessionStorage.setItem('gz_admin_token', adminToken);
    $('#admin-login').style.display = 'none';
    $('#admin-panel').classList.add('active');
    await loadAdminData();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#admin-logout').addEventListener('click', () => { adminToken = ''; sessionStorage.removeItem('gz_admin_token'); adminDialog.close(); });
$$('[data-admin-view]').forEach((button) => button.addEventListener('click', () => {
  $$('[data-admin-view]').forEach((item) => item.classList.toggle('active', item === button));
  $$('.admin-view').forEach((view) => view.classList.toggle('active', view.id === button.dataset.adminView));
  $('#admin-title').textContent = button.textContent;
}));

async function loadAdminData() {
  const results = await Promise.allSettled([
    api('students', { admin: true }),
    api('classes'),
    api('charges', { admin: true }),
  ]);
  if (results[0].status === 'fulfilled') state.students = results[0].value;
  if (results[1].status === 'fulfilled') state.classes = results[1].value;
  if (results[2].status === 'fulfilled') state.charges = results[2].value;
  renderAdmin();
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) toast(failure.reason?.message || 'Parte dos dados não pôde ser atualizada.');
}

function renderAdmin() {
  const totalCapacity = state.classes.reduce((sum, item) => sum + Number(item.capacity || 0), 0);
  const occupied = state.students.filter((student) => student.class_id).length;
  const percent = totalCapacity ? Math.min(100, Math.round(occupied / totalCapacity * 100)) : 0;
  $('#metric-students').textContent = state.students.length;
  $('#metric-classes').textContent = state.classes.filter((item) => item.active !== false && item.active !== 'f').length;
  $('#metric-spots').textContent = Math.max(0, totalCapacity - occupied);
  $('#metric-charges').textContent = state.charges.length;
  $('#donut-value').textContent = `${percent}%`;
  $('.donut').style.background = `conic-gradient(var(--red) ${percent * 3.6}deg,var(--line) 0)`;
  $('#capacity-label').textContent = totalCapacity ? `${occupied} de ${totalCapacity} vagas ocupadas` : 'Cadastre uma turma';
  $('#activity-list').innerHTML = state.students.length ? state.students.slice(0, 4).map((student) => `<p><b>${escapeHtml(student.full_name)}</b> está com status ${escapeHtml(student.status)}.</p>`).join('') : '<p>Nenhum registro encontrado.</p>';
  renderStudents(); renderClasses(); renderCharges(); populateSelects();
}

function populateSelects() {
  const classOptions = state.classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} — ${escapeHtml(item.category)}</option>`).join('');
  $('#student-class').innerHTML = '<option value="">Sem turma</option>' + classOptions;
  const selectedClassFilter = $('#student-filter-class').value;
  $('#student-filter-class').innerHTML = '<option value="">Todas as turmas</option><option value="none">Sem turma</option>' + classOptions;
  if ([...$('#student-filter-class').options].some((option) => option.value === selectedClassFilter)) $('#student-filter-class').value = selectedClassFilter;
  const selectedStudent = $('#charge-student').value;
  $('#charge-student').innerHTML = '<option value="">Selecione um aluno</option>' + state.students.map((student) => `<option value="${student.id}">${escapeHtml(student.full_name)} — ${escapeHtml(student.guardian_name)}</option>`).join('');
  if (state.students.some((student) => String(student.id) === selectedStudent)) $('#charge-student').value = selectedStudent;
}

function renderStudents() {
  const students = filteredStudents();
  $('#students-filter-count').textContent = `${students.length} ${students.length === 1 ? 'resultado' : 'resultados'}`;
  $('#students-table').innerHTML = students.length ? students.map((student) => `
    <tr><td><span class="student-avatar">${student.photo_url ? `<img src="${escapeHtml(student.photo_url)}" alt="Foto de ${escapeHtml(student.full_name)}" />` : escapeHtml(studentInitials(student.full_name))}</span></td>
    <td><b>${escapeHtml(student.full_name)}</b><br><small>${escapeHtml(student.cpf || `GZ-${student.id}`)}</small></td>
    <td>${escapeHtml(student.class_name || 'Sem turma')}</td><td>${escapeHtml(student.guardian_name)}<br><small>${escapeHtml(student.relationship || '')}</small></td>
    <td>${escapeHtml(student.phone)}<br><small>${escapeHtml(student.email || 'Sem e-mail')}</small></td><td>${studentAge(student.birth_date)}</td><td><span class="status">${escapeHtml(student.status)}</span></td></tr>`).join('') : '<tr><td colspan="7" class="empty-table">Nenhum aluno encontrado com estes filtros.</td></tr>';
}

function filteredStudents() {
  const search = normalizeText($('#student-filter-search')?.value);
  const classId = $('#student-filter-class')?.value || '';
  const status = $('#student-filter-status')?.value || '';
  return state.students.filter((student) => {
    const matchesSearch = !search || normalizeText(`${student.full_name} ${student.cpf || ''}`).includes(search);
    const matchesClass = !classId || (classId === 'none' ? !student.class_id : String(student.class_id) === classId);
    const matchesStatus = !status || student.status === status;
    return matchesSearch && matchesClass && matchesStatus;
  });
}
function renderClasses() {
  $('#classes-total').textContent = `${state.classes.length} ${state.classes.length === 1 ? 'turma' : 'turmas'}`;
  $('#classes-table').innerHTML = state.classes.length ? state.classes.map((item) => `
    <tr><td><b>${escapeHtml(item.name)}</b><br><small>${escapeHtml(item.location || 'Em definição')}</small></td>
    <td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.modality)}</td><td>${item.min_age}–${item.max_age} anos</td>
    <td>${Number(item.student_count || 0)} / ${Number(item.capacity)}</td><td>${escapeHtml(item.coach_name || 'Não definido')}</td></tr>`).join('') : '<tr><td colspan="6">Nenhuma turma cadastrada.</td></tr>';
}
function renderCharges() {
  $('#charges-total').textContent = `${state.charges.length} ${state.charges.length === 1 ? 'cobrança' : 'cobranças'}`;
  $('#charges-table').innerHTML = state.charges.length ? state.charges.map((charge) => `
    <tr><td><b>${escapeHtml(charge.student_name)}</b><br><small>${escapeHtml(charge.guardian_name)}</small></td>
    <td>${charge.mode === 'subscription' ? 'Assinatura mensal' : 'Cobrança avulsa'}<br><small>${escapeHtml(charge.reference)}</small></td>
    <td>${formatMoney(charge.total_amount)}</td><td>${formatDate(charge.due_date)}</td><td><span class="status">${escapeHtml(charge.status)}</span></td>
    <td><div class="charge-actions"><button class="charge-copy" data-copy-link="${escapeHtml(charge.payment_link)}">Copiar</button><button class="charge-send" data-charge-id="${charge.id}">WhatsApp ↗</button></div></td></tr>`).join('') : '<tr><td colspan="6">Nenhuma cobrança criada.</td></tr>';
  $$('[data-copy-link]').forEach((button) => button.addEventListener('click', () => copyLink(button.dataset.copyLink)));
  $$('[data-charge-id]').forEach((button) => button.addEventListener('click', () => sendStoredCharge(button.dataset.chargeId)));
}

$('#student-admin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('button[type="submit"]', event.currentTarget);
  const photoFile = $('#student-photo').files[0];
  submit.disabled = true;
  submit.textContent = 'Salvando...';
  try {
    const created = await api('students', { admin: true, method: 'POST', body: JSON.stringify({
      full_name: $('#student-name').value, cpf: $('#student-cpf').value, birth_date: $('#student-birth').value,
      class_id: $('#student-class').value || null, guardian_name: $('#student-guardian').value,
      relationship: $('#student-relationship').value, phone: $('#student-phone').value,
      email: $('#student-email').value, medical_notes: $('#student-medical').value, status: 'Ativo',
    }) });
    created.class_name = state.classes.find((item) => String(item.id) === String(created.class_id))?.name || null;
    state.students = [created, ...state.students.filter((student) => String(student.id) !== String(created.id))];
    renderAdmin();
    let photoWarning = '';
    if (photoFile) {
      try {
        const photo = await api('student_photo', { admin: true, method: 'POST', body: JSON.stringify({ student_id: created.id, data_url: await resizeStudentPhoto(photoFile) }) });
        Object.assign(created, photo);
        renderStudents();
      } catch (error) { photoWarning = `Aluno salvo, mas a foto não foi enviada: ${error.message}`; }
    }
    event.currentTarget.reset();
    resetStudentPhotoPreview();
    toast(photoWarning || 'Aluno cadastrado e lista atualizada.');
    await loadAdminData();
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; submit.textContent = 'Salvar aluno'; }
});

async function resizeStudentPhoto(file) {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error('Use uma imagem JPG, PNG ou WebP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem original deve ter no máximo 8 MB.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - size) / 2;
    const sourceY = (image.naturalHeight - size) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    canvas.getContext('2d').drawImage(image, sourceX, sourceY, size, size, 0, 0, 512, 512);
    return canvas.toDataURL('image/jpeg', .82);
  } finally { URL.revokeObjectURL(objectUrl); }
}

function resetStudentPhotoPreview() {
  const preview = $('#student-photo-preview');
  preview.style.backgroundImage = '';
  preview.textContent = '+';
}

$('#student-photo').addEventListener('change', (event) => {
  const file = event.currentTarget.files[0];
  if (!file) return resetStudentPhotoPreview();
  const preview = $('#student-photo-preview');
  const objectUrl = URL.createObjectURL(file);
  preview.style.backgroundImage = `url("${objectUrl}")`;
  preview.textContent = '';
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
});

['#student-filter-search', '#student-filter-class', '#student-filter-status'].forEach((selector) => {
  $(selector).addEventListener(selector.includes('search') ? 'input' : 'change', renderStudents);
});
$('#clear-student-filters').addEventListener('click', () => {
  $('#student-filter-search').value = '';
  $('#student-filter-class').value = '';
  $('#student-filter-status').value = '';
  renderStudents();
});

$('#class-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('classes', { admin: true, method: 'POST', body: JSON.stringify({
      name: $('#class-name').value, category: $('#class-category').value, modality: $('#class-modality').value,
      min_age: $('#class-min-age').value, max_age: $('#class-max-age').value, capacity: $('#class-capacity').value,
      location: $('#class-location').value, schedule: $('#class-schedule').value, coach_name: $('#class-coach').value,
    }) });
    event.currentTarget.reset(); toast('Turma criada com sucesso.'); await loadAdminData();
  } catch (error) { toast(error.message); }
});

function updateChargeOptions() {
  const subscription = $('#charge-mode').value === 'subscription';
  const enrollment = $('#include-enrollment');
  const monthly = $('#include-monthly');
  monthly.checked = true; monthly.disabled = true;
  if (subscription) { enrollment.checked = false; enrollment.disabled = true; }
  else enrollment.disabled = false;
  $('#charge-total-value').textContent = formatMoney(subscription ? MONTHLY_FEE : MONTHLY_FEE + (enrollment.checked ? ENROLLMENT_FEE : 0));
}
$('#charge-mode').addEventListener('change', updateChargeOptions);
$('#include-enrollment').addEventListener('change', updateChargeOptions);

$('#charge-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const student = state.students.find((item) => String(item.id) === $('#charge-student').value);
  if (!student) return toast('Selecione um aluno.');
  const submit = $('button[type="submit"]', event.currentTarget);
  submit.disabled = true; submit.textContent = 'Gerando...';
  try {
    const result = await api('charges', { admin: true, method: 'POST', body: JSON.stringify({
      student_id: student.id, mode: $('#charge-mode').value,
      include_enrollment: $('#include-enrollment').checked, include_monthly: true,
      reference: $('#charge-reference').value, due_date: $('#charge-due').value,
    }) });
    state.generatedCharge = { ...result, student };
    $('#charge-result').hidden = false;
    $('#generated-link').href = result.payment_link;
    $('#generated-link').textContent = result.payment_link;
    toast('Link gerado e cobrança salva.');
    await loadAdminData();
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; submit.textContent = 'Gerar link no Mercado Pago'; }
});

async function copyLink(link) {
  if (!link) return toast('Esta cobrança ainda não possui link.');
  try { await navigator.clipboard.writeText(link); toast('Link copiado.'); }
  catch { toast('Não foi possível copiar automaticamente.'); }
}
$('#copy-payment-link').addEventListener('click', () => copyLink(state.generatedCharge?.payment_link));
$('#send-payment-whatsapp').addEventListener('click', () => {
  if (state.generatedCharge) sendChargeMessage(state.generatedCharge, state.generatedCharge.student);
});
function sendStoredCharge(id) {
  const charge = state.charges.find((item) => String(item.id) === String(id));
  if (charge) sendChargeMessage(charge, { guardian_name: charge.guardian_name, phone: charge.phone });
}
function sendChargeMessage(charge, student) {
  if (!charge.payment_link) return toast('Esta cobrança ainda não possui link.');
  const label = charge.mode === 'subscription' ? 'assinatura mensal' : 'cobrança';
  const message = `Olá, ${student.guardian_name}! Segue o link da ${label} da Genoma do Zezinho.\n\nReferência: ${charge.reference || $('#charge-reference').value}\nValor: ${formatMoney(charge.total_amount)}\nVencimento: ${formatDate(charge.due_date || $('#charge-due').value)}\n\n${charge.payment_link}\n\nEm caso de dúvida, estamos à disposição.`;
  openWhatsApp(message, student.phone);
}

$('#export-csv').addEventListener('click', () => {
  const students = filteredStudents();
  if (!students.length) return toast('Nenhum aluno encontrado para exportar.');
  const rows = [['Aluno', 'CPF', 'Nascimento', 'Turma', 'Responsável', 'Telefone', 'Email', 'Status'],
    ...students.map((student) => [student.full_name, student.cpf, student.birth_date, student.class_name, student.guardian_name, student.phone, student.email, student.status])];
  const csv = rows.map((row) => row.map((value) => `"${String(value || '').replaceAll('"', '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv' });
  const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'alunos-genoma-do-zezinho.csv'; anchor.click(); URL.revokeObjectURL(anchor.href);
});

updateChargeOptions();
renderAdmin();
setStep(1);
