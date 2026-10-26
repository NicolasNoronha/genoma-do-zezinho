const $=(s,c=document)=>c.querySelector(s), $$=(s,c=document)=>[...c.querySelectorAll(s)];
const dialog=$('#enrollment-dialog'), adminDialog=$('#admin-dialog'), form=$('#enrollment-form');
const storageKey='genoma-inscricoes-v1';
const getStudents=()=>JSON.parse(localStorage.getItem(storageKey)||'[]');
const saveStudents=(items)=>localStorage.setItem(storageKey,JSON.stringify(items));
const toast=(message)=>{const el=$('.toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)};

const revealObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.12});
$$('.reveal').forEach(el=>revealObserver.observe(el));

$('.menu-toggle').addEventListener('click',e=>{const nav=$('.main-nav');nav.classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',nav.classList.contains('open'))});
$$('.main-nav a').forEach(a=>a.addEventListener('click',()=>$('.main-nav').classList.remove('open')));

function setStep(n){$$('.form-step',form).forEach(s=>s.classList.toggle('active',Number(s.dataset.step)===n));$$('.modal-progress i').forEach((i,index)=>i.classList.toggle('active',index<n));}
function openEnrollment(){form.reset();$('.form-success').classList.remove('active');setStep(1);dialog.showModal()}
$$('.open-enrollment').forEach(b=>b.addEventListener('click',openEnrollment));
$$('.modal-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$$('.next-step').forEach(b=>b.addEventListener('click',()=>{const section=b.closest('.form-step');const fields=$$('input,select,textarea',section);if(fields.every(f=>f.reportValidity()))setStep(Number(section.dataset.step)+1)}));
$$('.prev-step').forEach(b=>b.addEventListener('click',()=>setStep(Number(b.closest('.form-step').dataset.step)-1)));
form.addEventListener('submit',e=>{e.preventDefault();if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));const id=`GZ-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;const items=getStudents();items.unshift({...data,id,createdAt:new Date().toISOString(),status:'Pré-inscrição'});saveStudents(items);$$('.form-step',form).forEach(s=>s.classList.remove('active'));$('.form-success').classList.add('active');$('.protocol').textContent=`Protocolo ${id}`;$$('.modal-progress i').forEach(i=>i.classList.add('active'));renderAdmin()});
$('.finish-enrollment').addEventListener('click',()=>dialog.close());

$('#open-admin').addEventListener('click',()=>{adminDialog.showModal();$('#admin-login').style.display='flex';$('#admin-panel').classList.remove('active')});
$('#admin-login-form').addEventListener('submit',e=>{e.preventDefault();if($('input',e.currentTarget).value==='2015'){$('#admin-login').style.display='none';$('#admin-panel').classList.add('active');renderAdmin()}else toast('PIN incorreto. Use 2015 nesta demonstração.')});
$('#admin-logout').addEventListener('click',()=>{adminDialog.close();toast('Sessão demonstrativa encerrada.')});
$$('[data-admin-view]').forEach(b=>b.addEventListener('click',()=>{$$('[data-admin-view]').forEach(x=>x.classList.toggle('active',x===b));$$('.admin-view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.adminView));$('#admin-title').textContent=b.textContent}));

function renderAdmin(){const items=getStudents(),count=items.length,percent=Math.min(100,Math.round(count/30*100));$('#metric-students').textContent=count;$('#metric-spots').textContent=Math.max(0,30-count);$('#metric-revenue').textContent=(count*268).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});$('#donut-value').textContent=`${percent}%`;$('.donut').style.background=`conic-gradient(var(--red) ${percent*3.6}deg,var(--line) 0)`;const tbody=$('#students-table');tbody.innerHTML=items.length?items.map(s=>`<tr><td><b>${escapeHtml(s.studentName)}</b><br><small>${escapeHtml(s.id)}</small></td><td>${escapeHtml(s.guardianName)}</td><td>${escapeHtml(s.phone)}<br><small>${escapeHtml(s.email)}</small></td><td><span class="status">${escapeHtml(s.status)}</span></td></tr>`).join(''):'<tr><td colspan="4">Nenhum aluno cadastrado neste navegador.</td></tr>';const activity=$('#activity-list');activity.innerHTML=items.length?items.slice(0,4).map(s=>`<p><b>${escapeHtml(s.studentName)}</b> enviou uma pré-inscrição.</p>`).join(''):'<p>Nenhuma inscrição realizada neste navegador.</p>'}
const escapeHtml=v=>String(v||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
$('#export-csv').addEventListener('click',()=>{const items=getStudents();if(!items.length)return toast('Ainda não há alunos para exportar.');const rows=[['Aluno','CPF','Nascimento','Responsável','Telefone','Email','Status'],...items.map(s=>[s.studentName,s.studentCpf,s.birthDate,s.guardianName,s.phone,s.email,s.status])];const csv=rows.map(r=>r.map(v=>`"${String(v||'').replaceAll('"','""')}"`).join(';')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='alunos-genoma-do-zezinho.csv';a.click();URL.revokeObjectURL(a.href)});
renderAdmin();setStep(1);
