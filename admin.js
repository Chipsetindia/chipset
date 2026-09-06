// Admin data loaders wait for the authenticated admin session before querying protected tables.
window.__chipsetAdminReady = window.__chipsetAdminReady || new Promise(resolve=>{window.__chipsetAdminReadyResolve=resolve});

// Initialize admin tabs immediately so navigation never waits for Supabase/network calls.
(function initAdminTabsEarly(){
  const tabs=[...document.querySelectorAll('.adminTab')];
  const panels=[...document.querySelectorAll('.adminTabPanel')];
  if(!tabs.length)return;
  const activate=name=>{
    const valid=tabs.some(t=>t.dataset.tab===name);
    if(!valid) name=tabs[0].dataset.tab;
    tabs.forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
    panels.forEach(p=>p.hidden=p.dataset.panel!==name);
    try{sessionStorage.setItem('chipset_admin_tab',name)}catch(e){}
  };
  tabs.forEach(t=>t.addEventListener('click',()=>activate(t.dataset.tab)));
  let initial=tabs[0].dataset.tab;
  try{initial=new URLSearchParams(location.search).get('tab')||sessionStorage.getItem('chipset_admin_tab')||initial}catch(e){}
  activate(initial);
})();
(async function(){
  if(!window.sb){location.href='login.html';return}
  const {data:{user}}=await sb.auth.getUser();
  if(!user){location.href='login.html';return}
  const {data:profile}=await sb.from('profiles').select('role,full_name').eq('id',user.id).single();
  if(profile?.role!=='admin'){location.href='dashboard.html';return}
  try{window.__chipsetAdminReadyResolve?.();}catch(e){}

  const [
    {count:customerCount},
    {count:enquiryCount},
    {count:planCount}
  ]=await Promise.all([
    sb.from('profiles').select('id',{count:'exact',head:true}).eq('role','customer'),
    sb.from('investment_enquiries').select('id',{count:'exact',head:true}),
    sb.from('investment_plans').select('id',{count:'exact',head:true}).eq('active',true)
  ]);
  document.getElementById('users').textContent=customerCount||0;
  document.getElementById('enquiriesCount').textContent=enquiryCount||0;
  document.querySelector('.statGrid div:nth-child(3) strong').textContent=planCount||0;

  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  let {data:users,error:usersError}=await Promise.race([
    sb.rpc('admin_customer_directory'),
    new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{message:'Customer directory query timed out.'}}),7000))
  ]);
  users=Array.isArray(users)?users:[];
  // Always merge the direct profiles list as well. This avoids a stale/limited
  // directory RPC leaving the Admin customer selector with only one customer.
  const profileQuery=sb.from('profiles').select('id,full_name,phone,role,created_at,referral_code').eq('role','customer');
  const {data:profileCustomers}=await Promise.race([
    profileQuery,
    new Promise(resolve=>setTimeout(()=>resolve({data:[],error:{message:'Customer profile query timed out.'}}),7000))
  ]);
  const merged=new Map();
  [...users,...(Array.isArray(profileCustomers)?profileCustomers:[])].forEach(u=>{if(u?.id) merged.set(String(u.id),{...merged.get(String(u.id)),...u});});
  users=[...merged.values()];
  if(!users.length && usersError){ /* keep the original error for the UI only when no fallback data exists */ }
  const tb=document.getElementById('userTable');tb.innerHTML='';
  // Keep the already-loaded Overview customer directory as the single source for the Customers tab too.
  window.__adminCustomers = Array.isArray(users) ? users : [];
  window.dispatchEvent(new CustomEvent('chipset:admin-customers-ready',{detail:window.__adminCustomers}));
  if(usersError && !users.length){tb.innerHTML=`<tr><td colspan=5>${esc(usersError.message)}</td></tr>`;}
  else users.forEach(u=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(u.full_name)||'-'}</td><td>${esc(u.email)||'-'}</td><td>${esc(u.phone)||'-'}</td><td>${u.created_at?new Date(u.created_at).toLocaleDateString('en-IN'):'-'}</td><td><button class="smallBtn viewCustomer" data-id="${esc(u.id)}">View</button></td>`;tb.appendChild(tr)});
  tb.querySelectorAll('.viewCustomer').forEach(btn=>btn.onclick=()=>openCustomerPopup(btn.dataset.id));

  const {data:ens=[],error:enquiryError}=await sb.from('investment_enquiries').select('*, investment_plans(name)').order('created_at',{ascending:false});
  const eb=document.getElementById('adminEnquiries');eb.innerHTML='';
  if(enquiryError){eb.innerHTML=`<p class="muted">Unable to load enquiries: ${esc(enquiryError.message)}</p>`;}
  else if(!ens.length){eb.innerHTML='<p class="muted">No investment enquiries yet.</p>';}
  else {
    const statuses=['pending','contacted','approved','rejected','completed'];
    ens.forEach(x=>{
      const d=document.createElement('div');d.className='enquiry adminEnquiry';
      const current=x.status||'Pending';
      d.innerHTML=`<div><b>${esc(x.customer_name)||'Customer'}</b><br><small>${esc(x.email)||''} · ${esc(x.phone)||'No phone'} · ${new Date(x.created_at).toLocaleDateString('en-IN')}</small><br><small>${esc(x.investment_plans?.name)||'General Enquiry'}${x.investment_amount?` · ₹${Number(x.investment_amount).toLocaleString('en-IN')}`:''}</small><br><div class="enquiryMessage"><b>Message:</b> ${esc(x.message||'No message')}</div></div><div class="enquiryAction"><select class="statusSelect" aria-label="Enquiry status">${statuses.map(st=>`<option value="${st}" ${String(current).toLowerCase()===st?'selected':''}>${st.charAt(0).toUpperCase()+st.slice(1)}</option>`).join('')}</select><button class="smallBtn saveStatus" data-id="${esc(x.id)}">Save</button></div>`;
      eb.appendChild(d);
    });
    eb.querySelectorAll('.saveStatus').forEach(btn=>btn.onclick=async()=>{
      const select=btn.parentElement.querySelector('.statusSelect');
      const allowedStatuses=['pending','contacted','approved','rejected','completed'];
      const nextStatus=String(select.value||'').trim().toLowerCase();
      if(!allowedStatuses.includes(nextStatus)){alert('Invalid status: '+nextStatus);return;}
      btn.disabled=true;btn.textContent='Saving…';
      const {data:updated,error}=await sb.from('investment_enquiries').update({status:nextStatus}).eq('id',btn.dataset.id).select('id,status').single();
      if(error){alert('Could not update status: '+error.message+'\n\nSent status: '+nextStatus);btn.disabled=false;btn.textContent='Save';return;}
      if(updated?.status!==nextStatus){alert('Status update returned an unexpected value: '+(updated?.status||'empty'));btn.disabled=false;btn.textContent='Save';return;}
      btn.textContent='Saved';setTimeout(()=>{btn.disabled=false;btn.textContent='Save'},900);
    });
  }

  async function loadPlans(){
    const {data:plans=[],error}=await sb.from('investment_plans').select('*').order('minimum_amount');
    const pl=document.getElementById('planList');pl.innerHTML='';
    if(error){pl.innerHTML=`<p class="muted">Unable to load plans: ${esc(error.message)}</p>`;return;}
    if(!plans.length){pl.innerHTML='<p class="muted">No investment plans found.</p>';return;}
    plans.forEach(p=>{
      const d=document.createElement('div');d.className='adminPlan adminPlanManage';
      d.innerHTML=`
        <div class="planEditFields">
          <label>Plan Name<input class="planName" value="${esc(p.name)}" /></label>
          <label>Minimum Amount<input class="planAmount" type="number" min="1" step="1" value="${Number(p.minimum_amount)||0}" /></label>
          <label>Earning Type<select class="planEarnMode"><option value="percentage" ${String(p.earning_mode||'percentage')==='percentage'?'selected':''}>Percentage (%)</option><option value="fixed" ${String(p.earning_mode||'percentage')==='fixed'?'selected':''}>Fixed Amount (₹)</option></select></label>
          <label>Earning Value<input class="planEarnValue" type="number" min="0" step="0.01" value="${Number(p.earning_value ?? p.monthly_payout_percent)||0}" /></label>
          <label>Earning Frequency<select class="planEarnFreq"><option value="weekly" ${String(p.earning_frequency||'weekly')==='weekly'?'selected':''}>Weekly</option><option value="monthly" ${String(p.earning_frequency||'weekly')==='monthly'?'selected':''}>Monthly</option></select></label>
          <label>Earning Periods<input class="planEarnPeriods" type="number" min="1" step="1" value="${Number(p.earning_periods || (String(p.earning_frequency||'weekly')==='weekly'?52:12))}" /></label>
        </div>
        <div class="planManageActions">
          <span class="planState ${p.active?'isActive':'isInactive'}">${p.active?'ACTIVE':'INACTIVE'}</span>
          <button class="smallBtn togglePlan" data-id="${esc(p.id)}" data-active="${p.active?'true':'false'}">${p.active?'Set Inactive':'Set Active'}</button>
          <button class="smallBtn savePlan" data-id="${esc(p.id)}">Save Changes</button>
          <button class="smallBtn danger deletePlan" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Delete</button>
        </div>`;
      pl.appendChild(d);
    });

    pl.querySelectorAll('.togglePlan').forEach(btn=>btn.onclick=async()=>{
      const next=btn.dataset.active!=='true';
      btn.disabled=true;btn.textContent='Saving…';
      const {error}=await sb.from('investment_plans').update({active:next}).eq('id',btn.dataset.id);
      if(error){alert('Could not change plan status: '+error.message);btn.disabled=false;btn.textContent=next?'Set Active':'Set Inactive';return;}
      await loadPlans();
      const {count}=await sb.from('investment_plans').select('id',{count:'exact',head:true}).eq('active',true);
      document.querySelector('.statGrid div:nth-child(3) strong').textContent=count||0;
    });

    pl.querySelectorAll('.deletePlan').forEach(btn=>btn.onclick=async()=>{
      const id=btn.dataset.id, name=btn.dataset.name||'this plan';
      if(!confirm(`Delete ${name}? This cannot be undone.`)) return;
      btn.disabled=true; btn.textContent='Deleting…';
      const {error}=await sb.from('investment_plans').delete().eq('id',id);
      if(error){alert('Could not delete plan: '+error.message);btn.disabled=false;btn.textContent='Delete';return;}
      await loadPlans();
      const {count}=await sb.from('investment_plans').select('id',{count:'exact',head:true}).eq('active',true);
      document.querySelector('.statGrid div:nth-child(3) strong').textContent=count||0;
    });

    pl.querySelectorAll('.savePlan').forEach(btn=>btn.onclick=async()=>{
      const row=btn.closest('.adminPlan');
      const name=row.querySelector('.planName').value.trim();
      const amount=Number(row.querySelector('.planAmount').value);
      const earnMode=String(row.querySelector('.planEarnMode')?.value||'percentage');
      const earnValue=Number(row.querySelector('.planEarnValue')?.value);
      const earnFrequency=String(row.querySelector('.planEarnFreq')?.value||'weekly');
      const earnPeriods=Number(row.querySelector('.planEarnPeriods')?.value);
      if(!name){alert('Plan name is required.');return;}
      if(!Number.isFinite(amount)||amount<=0){alert('Minimum amount must be greater than 0.');return;}
      if(!Number.isFinite(earnValue)||earnValue<0){alert('Earning value must be 0 or greater.');return;}
      if(!Number.isFinite(earnPeriods)||earnPeriods<1){alert('Earning periods must be at least 1.');return;}
      btn.disabled=true;btn.textContent='Saving…';
      const {error}=await sb.from('investment_plans').update({name,minimum_amount:amount,monthly_payout_percent:earnMode==='percentage'?earnValue:0,earning_mode:earnMode,earning_value:earnValue,earning_frequency:earnFrequency,earning_periods:Math.floor(earnPeriods)}).eq('id',btn.dataset.id);
      if(error){alert('Could not save plan: '+error.message);btn.disabled=false;btn.textContent='Save Changes';return;}
      btn.textContent='Saved';setTimeout(()=>{btn.disabled=false;btn.textContent='Save Changes'},900);
    });
  }

  await loadPlans();
  document.getElementById('addPlan').onclick=()=>{
    const f=document.getElementById('addPlanForm');
    f.hidden=!f.hidden;
    if(!f.hidden) document.getElementById('newPlanName').focus();
  };
  document.getElementById('cancelNewPlan').onclick=()=>{
    document.getElementById('addPlanForm').hidden=true;
  };
  document.getElementById('saveNewPlan').onclick=async()=>{
    const btn=document.getElementById('saveNewPlan');
    const name=document.getElementById('newPlanName').value.trim();
    const amount=Number(document.getElementById('newPlanAmount').value);
    const payout=Number(document.getElementById('newPlanPayout').value);
    const active=document.getElementById('newPlanActive').checked;
    if(!name){alert('Plan name is required.');return;}
    if(!Number.isFinite(amount)||amount<=0){alert('Minimum amount must be greater than 0.');return;}
    if(!Number.isFinite(payout)||payout<0){alert('Monthly payout must be 0 or greater.');return;}
    btn.disabled=true;btn.textContent='Creating…';
    const {error}=await sb.from('investment_plans').insert({name,minimum_amount:amount,monthly_payout_percent:payout,active});
    if(error){alert('Could not create plan: '+error.message);btn.disabled=false;btn.textContent='Create Plan';return;}
    document.getElementById('newPlanName').value='';
    document.getElementById('newPlanAmount').value='';
    document.getElementById('newPlanPayout').value='';
    document.getElementById('newPlanActive').checked=true;
    document.getElementById('addPlanForm').hidden=true;
    btn.disabled=false;btn.textContent='Create Plan';
    await loadPlans();
    const {count}=await sb.from('investment_plans').select('id',{count:'exact',head:true}).eq('active',true);
    document.querySelector('.statGrid div:nth-child(3) strong').textContent=count||0;
  };

  async function loadPlanHeaders(){
    const ids={plan:'headPlan',investment:'headInvestment',payout:'headPayout',total:'headTotal',action:'headAction'};
    const {data,error}=await sb.from('site_settings').select('key,value').in('key',['plan_header_plan','plan_header_investment','plan_header_payout','plan_header_total','plan_header_action']);
    if(error) return;
    const vals={};(data||[]).forEach(x=>vals[x.key]=x.value);
    document.getElementById(ids.plan).value=vals.plan_header_plan||'PLAN';
    document.getElementById(ids.investment).value=vals.plan_header_investment||'INVESTMENT';
    document.getElementById(ids.payout).value=vals.plan_header_payout||'MONTHLY PAYOUT';
    document.getElementById(ids.total).value=vals.plan_header_total||'12 MONTH TOTAL*';
    document.getElementById(ids.action).value=vals.plan_header_action||'ACTION';
  }
  await loadPlanHeaders();
  document.getElementById('savePlanHeaders').onclick=async()=>{
    const btn=document.getElementById('savePlanHeaders'),msg=document.getElementById('planHeadersMsg');
    const rows=[
      {key:'plan_header_plan',value:document.getElementById('headPlan').value.trim()||'PLAN'},
      {key:'plan_header_investment',value:document.getElementById('headInvestment').value.trim()||'INVESTMENT'},
      {key:'plan_header_payout',value:document.getElementById('headPayout').value.trim()||'MONTHLY PAYOUT'},
      {key:'plan_header_total',value:document.getElementById('headTotal').value.trim()||'12 MONTH TOTAL*'},
      {key:'plan_header_action',value:document.getElementById('headAction').value.trim()||'ACTION'}
    ];
    btn.disabled=true;btn.textContent='Saving…';
    const {error}=await sb.from('site_settings').upsert(rows,{onConflict:'key'});
    msg.textContent=error?'Could not save headers: '+error.message:'Investment table headers saved successfully.';
    btn.disabled=false;btn.textContent='Save Table Headers';
  };

  async function loadSiteSettings(){
    const {data,error}=await sb.from('site_settings').select('key,value');
    const msg=document.getElementById('siteSettingsMsg');
    if(error){ if(msg) msg.textContent='Unable to load website settings: '+error.message; return; }
    const settings={}; (data||[]).forEach(x=>settings[x.key]=x.value);
    document.getElementById('siteWhatsapp').value=settings.whatsapp_number||'';
    document.getElementById('siteInstagram').value=settings.instagram_url||'';
    document.getElementById('siteUpi').value=settings.business_upi_id||'';
    document.getElementById('sitePaymentName').value=settings.payment_name||'Chipset';
    document.getElementById('withdrawWaitDays').value=settings.investment_withdrawal_wait_days||'30';
  }
  await loadSiteSettings();
  document.getElementById('saveSiteSettings').onclick=async()=>{
    const btn=document.getElementById('saveSiteSettings'), msg=document.getElementById('siteSettingsMsg');
    const whatsapp=document.getElementById('siteWhatsapp').value.trim().replace(/\D/g,'');
    const instagram=document.getElementById('siteInstagram').value.trim();
    const upi=document.getElementById('siteUpi').value.trim();
    const paymentName=document.getElementById('sitePaymentName').value.trim()||'Chipset';
    const withdrawWaitDays=Math.max(0,Math.floor(Number(document.getElementById('withdrawWaitDays').value||30)));
    if(whatsapp && whatsapp.length<10){msg.textContent='Please enter a valid WhatsApp number.';return;}
    if(instagram && !/^https?:\/\//i.test(instagram)){msg.textContent='Instagram URL must start with https://';return;}
    btn.disabled=true;btn.textContent='Saving…';
    const rows=[{key:'whatsapp_number',value:whatsapp},{key:'instagram_url',value:instagram},{key:'business_upi_id',value:upi},{key:'payment_name',value:paymentName},{key:'investment_withdrawal_wait_days',value:String(withdrawWaitDays)}];
    const {error}=await sb.from('site_settings').upsert(rows,{onConflict:'key'});
    if(error){msg.textContent='Could not save settings: '+error.message;btn.disabled=false;btn.textContent='Save Website Settings';return;}
    msg.textContent='Website settings saved successfully.';btn.disabled=false;btn.textContent='Save Website Settings';
  };
  document.getElementById('adminReset').onclick=()=>{location.href='forgot-password.html'};
  document.getElementById('logout').onclick=async()=>{const b=document.getElementById('logout');if(b){b.disabled=true;b.textContent='LOGGING OUT…';}try{await Promise.race([sb.auth.signOut({scope:'local'}),new Promise(r=>setTimeout(r,1200))]);}catch(e){}try{Object.keys(localStorage).filter(k=>k.toLowerCase().includes('supabase')).forEach(k=>localStorage.removeItem(k));Object.keys(sessionStorage).forEach(k=>sessionStorage.removeItem(k));}catch(e){}location.replace('login.html')};
})();


// Transaction verification, referral settings, offers, credits and customer details.
async function loadAdminTransactions(){
  const box=document.getElementById('adminTransactions'); if(!box)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const {data:txs,error}=await sb.from('investment_transactions').select('*').order('created_at',{ascending:false});
  if(error){box.innerHTML='<p class="muted">Unable to load transactions: '+esc(error.message)+'</p>';return;}
  const auditBox=document.getElementById('adminInvestmentAudit');
  if(auditBox){
    const ar=await sb.from('investment_eligibility_audit').select('*').order('created_at',{ascending:false}).limit(200);
    if(ar.error){auditBox.innerHTML='<p class="muted">Eligibility history unavailable: '+esc(ar.error.message)+'</p>';}
    else if(!ar.data?.length){auditBox.innerHTML='<p class="muted">No investment eligibility/principal history yet.</p>';}
    else{
      const ids=[...new Set(ar.data.map(x=>x.user_id).filter(Boolean))];
      const pr=ids.length?await sb.from('profiles').select('id,full_name,phone').in('id',ids):{data:[]};
      const pm=new Map((pr.data||[]).map(x=>[String(x.id),x]));
      const money2=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
      const labels={override_set:'Made eligible',override_cleared:'Eligibility cleared',principal_withdrawn:'Principal withdrawn'};
      auditBox.innerHTML=ar.data.map(x=>{const c=pm.get(String(x.user_id))||{};return `<div class="enquiry adminEnquiry"><div><b>${esc(c.full_name||'Customer')}</b><br><small>${esc(c.phone||'')} · ${new Date(x.created_at).toLocaleString('en-IN')}</small><br><small>${esc(labels[x.action]||x.action)}${x.amount!=null?' · '+money2(x.amount):''}</small>${x.reason?`<br><small><b>Reason:</b> ${esc(x.reason)}</small>`:''}</div><div><small>${x.actor_id?'Admin action':''}</small></div></div>`}).join('');
    }
  }
  if(!txs?.length){box.innerHTML='<p class="muted">No transactions yet.</p>';return;}
  box.innerHTML=txs.map(t=>`<div class="enquiry adminEnquiry" data-tx-row="${esc(t.id)}"><div><b>${esc(t.customer_name)||'Customer'}</b><br><small>${esc(t.email||'')} · ${esc(t.phone||'')} · ${new Date(t.created_at).toLocaleString('en-IN')}</small><br><small>${esc(t.plan_name||'Transaction')} · ${t.type==='credit'?'+':'-'}₹${Number(t.amount||0).toLocaleString('en-IN')} · ${esc(t.payment_method||'')}</small><br><small>Payment ID: <b>${esc(t.payment_ref||'—')}</b> · UTR: ${esc(t.utr||'—')}</small>${t.type==='debit'?`<br><button class="smallBtn viewSlip" data-id="${esc(t.id)}" data-path="${esc(t.slip_path||'')}">View Slip</button>`:''}</div><div class="enquiryAction"><span class="planState ${t.status==='approved'?'isActive':t.status==='rejected'?'isInactive':''}">${esc(t.status)}</span>${t.type==='debit'&&t.status==='pending'?`<button class="smallBtn verifyTx" data-id="${esc(t.id)}" data-status="approved">Approve</button><button class="smallBtn rejectTx" data-id="${esc(t.id)}" data-status="rejected">Reject</button>`:''}</div></div>`).join('');

  box.querySelectorAll('.verifyTx,.rejectTx').forEach(btn=>btn.onclick=async()=>{
    const row=btn.closest('[data-tx-row]');
    const action=btn.dataset.status==='approved'?'Approve':'Reject';
    btn.disabled=true; btn.textContent=action+'…';
    const other=row?.querySelector(btn.classList.contains('verifyTx')?'.rejectTx':'.verifyTx'); if(other)other.disabled=true;
    const {error}=await sb.rpc('admin_set_transaction_status',{p_transaction_id:btn.dataset.id,p_status:btn.dataset.status});
    if(error){alert('Could not '+action.toLowerCase()+' payment: '+error.message);btn.disabled=false;btn.textContent=action; if(other)other.disabled=false;return;}
    // Refresh only the transaction area — no page refresh needed.
    await loadAdminTransactions();
    window.dispatchEvent(new CustomEvent('admin:data-changed',{detail:{type:'transaction',id:btn.dataset.id,status:btn.dataset.status}}));
  });

  box.querySelectorAll('.viewSlip').forEach(btn=>btn.onclick=async()=>{
    btn.disabled=true;btn.textContent='OPENING…';
    let path=btn.dataset.path||'';
    if(!path){
      const folders=['guest'];
      const row=btn.closest('[data-tx-row]');
      // Registered-user slips are stored in <user-id>/..., so use the transaction user_id when available.
      const tx=txs.find(x=>String(x.id)===String(btn.dataset.id));
      if(tx?.user_id)folders.unshift(tx.user_id);
      for(const folder of folders){
        const {data:list}=await sb.storage.from('payment-slips').list(folder,{limit:1000});
        const match=(list||[]).find(f=>f.name && f.name.toLowerCase().startsWith(String(btn.dataset.id).toLowerCase()+'.'));
        if(match){path=`${folder}/${match.name}`;break;}
      }
    }
    if(!path){alert('Payment slip file was not found in storage.');btn.disabled=false;btn.textContent='View Slip';return;}
    const {data,error}=await sb.storage.from('payment-slips').createSignedUrl(path,300);
    if(error)alert(error.message);else window.open(data.signedUrl,'_blank','noopener');
    btn.disabled=false;btn.textContent='View Slip';
  });
}

async function loadManagedSettings(){
  const {data,error}=await sb.from('site_settings').select('key,value');
  if(error){console.warn('Settings load:',error.message);return;}
  const m={};(data||[]).forEach(x=>m[x.key]=x.value);
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v??''};
  set('refBonus',m.referral_bonus_percent ?? '10');
  set('refMinDeposit',m.referral_min_deposit||'10000');
  set('refMessage',m.referral_message||'Join using my referral link. Deposit the minimum amount and I will receive a referral bonus.');
  set('offerTitleInput',m.offer_title||''); set('offerTextInput',m.offer_text||''); set('offerDateInput',m.offer_date||'');
  const en=document.getElementById('offerEnabled');if(en)en.checked=m.offer_enabled==='true';
  updateReferralPreview();
}
async function saveSetting(key,value){const {error}=await sb.from('site_settings').upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'});if(error)throw error;}
function updateReferralPreview(){
  const bonus=Number(document.getElementById('refBonus')?.value||0),min=Number(document.getElementById('refMinDeposit')?.value||0),msg=document.getElementById('referralLivePreview');
  if(msg)msg.textContent=`User message: ${document.getElementById('refMessage')?.value.trim()||'—'} Minimum deposit ₹${min.toLocaleString('en-IN')} → bonus ${bonus}% of first approved transaction after admin approval.`;
}

(async function initManagedAdmin(){
  await loadManagedSettings();
  ['refBonus','refMinDeposit','refMessage'].forEach(id=>document.getElementById(id)?.addEventListener('input',updateReferralPreview));
  document.getElementById('saveReferralSettings')?.addEventListener('click',async()=>{
    const msg=document.getElementById('referralSettingsMsg'),btn=document.getElementById('saveReferralSettings');
    try{
      const bonus=Number(document.getElementById('refBonus').value),min=Number(document.getElementById('refMinDeposit').value),message=document.getElementById('refMessage').value.trim();
      if(!Number.isFinite(bonus)||bonus<0||bonus>100||!Number.isFinite(min)||min<0)throw new Error('Amounts cannot be negative.');
      if(!message)throw new Error('Referral WhatsApp message is required.');
      btn.disabled=true;btn.textContent='Saving…';
      await saveSetting('referral_bonus_percent',String(bonus));
      await saveSetting('referral_min_deposit',String(min));
      await saveSetting('referral_message',message);
      msg.textContent='Referral percentage, minimum deposit and WhatsApp message saved successfully.';
      updateReferralPreview();
    }catch(e){msg.textContent='Could not save referral settings: '+e.message;}
    finally{btn.disabled=false;btn.textContent='Save Referral Settings';}
  });

  document.getElementById('saveOfferSettings')?.addEventListener('click',async()=>{
    const msg=document.getElementById('offerSettingsMsg'),btn=document.getElementById('saveOfferSettings');
    try{
      btn.disabled=true;btn.textContent='Saving…';
      let imageUrl='';const file=document.getElementById('offerImageInput')?.files?.[0];
      if(file){
        if(file.size>8*1024*1024)throw new Error('Image must be 8 MB or smaller.');
        const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
        const path=`offer-${Date.now()}.${ext}`;
        const up=await sb.storage.from('site-offers').upload(path,file,{upsert:true,contentType:file.type||'image/jpeg'});if(up.error)throw up.error;
        imageUrl=sb.storage.from('site-offers').getPublicUrl(path).data.publicUrl;await saveSetting('offer_image_url',imageUrl);
      }
      await saveSetting('offer_title',document.getElementById('offerTitleInput').value.trim());
      await saveSetting('offer_text',document.getElementById('offerTextInput').value.trim());
      await saveSetting('offer_date',document.getElementById('offerDateInput').value.trim());
      await saveSetting('offer_enabled',document.getElementById('offerEnabled').checked?'true':'false');
      msg.textContent=imageUrl?'Offer saved with new image.':'Offer settings saved.';
    }catch(e){msg.textContent='Could not save offer: '+e.message}
    finally{btn.disabled=false;btn.textContent='Save Offer';}
  });
})();

loadAdminTransactions();
document.getElementById('addCredit')?.addEventListener('click',async()=>{
  const msg=document.getElementById('creditMsg'),btn=document.getElementById('addCredit');
  const userId=document.getElementById('creditUserId').value.trim(),amount=Number(document.getElementById('creditAmount').value),note=document.getElementById('creditNote').value.trim();
  if(!userId||!amount||amount<=0){msg.textContent='Customer User ID and a positive amount are required.';return;}
  btn.disabled=true;btn.textContent='Adding…';
  const {error}=await sb.rpc('admin_add_wallet_credit',{p_user_id:userId,p_amount:amount,p_note:note||null});
  msg.textContent=error?'Could not add wallet credit: '+error.message:'Wallet credit added successfully.';btn.disabled=false;btn.textContent='Add Credit';if(!error)loadAdminTransactions();
});

// Admin wallet debit: separate, reason-required ledger entry for each customer.
document.getElementById('debitWallet')?.addEventListener('click',async()=>{
  const msg=document.getElementById('debitMsg'),btn=document.getElementById('debitWallet');
  const userId=document.getElementById('debitUserId').value.trim(),amount=Number(document.getElementById('debitAmount').value),reason=document.getElementById('debitReason').value.trim();
  if(!userId||!amount||amount<=0){msg.textContent='Customer User ID and a positive amount are required.';return;}
  if(!reason){msg.textContent='Reason is required.';return;}
  if(!confirm(`Debit ₹${amount.toLocaleString('en-IN')} from this customer wallet?\n\nReason: ${reason}`))return;
  btn.disabled=true;btn.textContent='Debiting…';
  const {error}=await sb.rpc('admin_debit_wallet',{p_user_id:userId,p_amount:amount,p_reason:reason});
  msg.textContent=error?'Could not debit wallet: '+error.message:'Wallet debit completed successfully.';
  btn.disabled=false;btn.textContent='Debit Wallet';
  if(!error){document.getElementById('debitAmount').value='';document.getElementById('debitReason').value='';loadAdminTransactions();const id=document.getElementById('customerDetailSelect')?.value;if(id)renderCustomer(id);}
});

async function loadAdminWithdrawals(){
  const box=document.getElementById('adminWithdrawals');if(!box)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  box.innerHTML='<p class="muted">Loading withdrawal requests…</p>';

  // Do not depend on a Supabase relationship between withdrawal_requests and bank_accounts.
  // Fetch each table separately so the admin tab keeps working even if FK metadata differs.
  const withdrawalQuery=sb.from('withdrawal_requests').select('*');
  const {data:rows,error}=await Promise.race([withdrawalQuery,new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{message:'Withdrawal requests query timed out. Please check Supabase RLS/policies.'}}),7000))]);
  if(Array.isArray(rows)) rows.sort((a,b)=>new Date(b.requested_at||b.created_at||0)-new Date(a.requested_at||a.created_at||0));
  if(error){box.innerHTML='<p class="muted">Unable to load withdrawals: '+esc(error.message)+'</p>';return;}
  if(!rows?.length){box.innerHTML='<p class="muted">No withdrawal requests yet.</p>';return;}

  const ids=[...new Set(rows.map(r=>r.user_id).filter(Boolean))];
  const bankIds=[...new Set(rows.map(r=>r.bank_account_id).filter(Boolean))];
  const [{data:profiles},{data:banks}]=await Promise.all([
    ids.length?sb.from('profiles').select('id,full_name,phone,referral_code').in('id',ids):Promise.resolve({data:[]}),
    bankIds.length?sb.from('bank_accounts').select('id,user_id,account_holder_name,bank_name,account_number,ifsc_code,branch_name').in('id',bankIds):Promise.resolve({data:[]})
  ]);
  const profileMap=new Map((profiles||[]).map(x=>[String(x.id),x]));
  const bankMap=new Map((banks||[]).map(x=>[String(x.id),x]));
  // Fallback for schemas where withdrawal_requests has user_id but no bank_account_id.
  const userBanks=new Map((banks||[]).map(x=>[String(x.user_id),x]));

  const status=String(document.getElementById('withdrawStatusFilter')?.value||'all');
  const filtered=status==='all'?rows:rows.filter(r=>String(r.status||'').toLowerCase()===status);
  const pending=rows.filter(r=>String(r.status).toLowerCase()==='pending').length;
  const approved=rows.filter(r=>String(r.status).toLowerCase()==='approved').length;
  const rejected=rows.filter(r=>String(r.status).toLowerCase()==='rejected').length;
  const summary=document.getElementById('withdrawalSummary');
  if(summary)summary.innerHTML=`<span class="withdrawSummaryPill pending">Pending <b>${pending}</b></span><span class="withdrawSummaryPill approved">Approved <b>${approved}</b></span><span class="withdrawSummaryPill rejected">Rejected <b>${rejected}</b></span>`;
  if(!filtered.length){box.innerHTML='<p class="muted">No withdrawals match this filter.</p>';return;}

  box.innerHTML=filtered.map(w=>{
    const c=profileMap.get(String(w.user_id))||{};
    const b=bankMap.get(String(w.bank_account_id))||userBanks.get(String(w.user_id))||{};
    const st=String(w.status||'pending').toLowerCase();
    return `<div class="withdrawAdminRow" data-wid="${esc(w.id)}">
      <div class="withdrawAdminMain">
        <div class="withdrawAmount"><b>${money(w.amount)}</b><span class="withdrawStatus ${esc(st)}">${esc(st.toUpperCase())}</span></div>
        <b>${esc(c.full_name||b.account_holder_name||'Customer')}</b>
        <small>${esc(c.phone||'No phone')} ${c.referral_code?`· Referral: ${esc(c.referral_code)}`:''}</small>
        <small>Bank: ${esc(b.bank_name||'—')} · A/C: ${esc(b.account_number||'—')} · IFSC: ${esc(b.ifsc_code||'—')}</small>
        <small>Holder: ${esc(b.account_holder_name||c.full_name||'—')} · Branch: ${esc(b.branch_name||'—')}</small>
        <small>Requested: ${w.requested_at?new Date(w.requested_at).toLocaleString('en-IN'):'—'}</small>
        ${w.customer_note?`<small>Customer note: ${esc(w.customer_note)}</small>`:''}
        ${w.review_reason?`<small class="reviewReason"><b>Admin reason:</b> ${esc(w.review_reason)}</small>`:''}
        ${w.transaction_id?`<small>Transaction ID: ${esc(w.transaction_id)}</small>`:''}
      </div>
      <div class="withdrawAdminActions">${st==='pending'?`<input class="withdrawReason" placeholder="Approval / rejection reason"><div><button class="smallBtn approveWithdrawal" data-status="approved">Approve</button><button class="smallBtn danger rejectWithdrawal" data-status="rejected">Reject</button></div>`:`<span class="planState ${st==='approved'?'isActive':'isInactive'}">${esc(st)}</span>`}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.approveWithdrawal,.rejectWithdrawal').forEach(btn=>btn.onclick=async()=>{
    const row=btn.closest('[data-wid]'),id=row?.dataset.wid,reason=row.querySelector('.withdrawReason')?.value.trim()||'';
    const item=rows.find(x=>String(x.id)===String(id));
    if(!item)return;
    if(btn.dataset.status==='rejected'&&!reason){alert('Rejection reason is required.');row.querySelector('.withdrawReason')?.focus();return;}
    const action=btn.dataset.status==='approved'?'Approve':'Reject';
    if(!confirm(`${action} withdrawal of ${money(item.amount)} for ${profileMap.get(String(item.user_id))?.full_name||'this customer'}?`))return;
    const buttons=row.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);btn.textContent=action==='Approve'?'Approving…':'Rejecting…';
    let result=await sb.rpc('admin_review_withdrawal',{p_withdrawal_id:id,p_status:btn.dataset.status,p_reason:reason||null});
    if(result.error && /failed to fetch|network|fetch/i.test(String(result.error.message||''))){await new Promise(r=>setTimeout(r,700)); result=await sb.rpc('admin_review_withdrawal',{p_withdrawal_id:id,p_status:btn.dataset.status,p_reason:reason||null});}
    if(result.error){alert('Could not update withdrawal: '+result.error.message);buttons.forEach(b=>b.disabled=false);btn.textContent=action;return;}
    const reasonInput=row.querySelector('.withdrawReason'); if(reasonInput) reasonInput.value='';
    await loadAdminWithdrawals(); await loadAdminBankAccounts();
  });
}
window.__chipsetAdminReady.then(()=>{
  loadAdminWithdrawals().catch(e=>{const box=document.getElementById('adminWithdrawals');if(box)box.innerHTML='<p class=\"muted\">Unable to load withdrawal requests: '+String(e?.message||e)+'</p>';});
  loadAdminBankAccounts().catch(e=>{const box=document.getElementById('adminBankAccounts');if(box)box.innerHTML='<p class=\"muted\">Unable to load bank accounts: '+String(e?.message||e)+'</p>';});
});
document.getElementById('withdrawStatusFilter')?.addEventListener('change',()=>loadAdminWithdrawals().catch(console.error));
document.getElementById('refreshWithdrawals')?.addEventListener('click',()=>loadAdminWithdrawals().catch(console.error));
document.querySelectorAll('.adminTab').forEach(t=>t.addEventListener('click',()=>{
  if(t.dataset.tab==='withdrawals'){
    loadAdminWithdrawals().catch(e=>console.error('Withdrawals:',e));
    loadAdminBankAccounts().catch(e=>console.error('Banks:',e));
  }
  if(t.dataset.tab==='customers' && window.__adminRenderCustomer && document.getElementById('customerDetailSelect')?.value){
    window.__adminRenderCustomer(document.getElementById('customerDetailSelect').value);
  }
}));

async function loadAdminBankAccounts(){
  const box=document.getElementById('adminBankAccounts'); if(!box) return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const bankQuery=sb.from('bank_accounts').select('*');
  const {data:rows,error}=await Promise.race([bankQuery,new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{message:'Bank accounts query timed out. Please check Supabase RLS/policies.'}}),7000))]);
  if(Array.isArray(rows)) rows.sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
  if(error){box.innerHTML='<p class="muted">Unable to load bank accounts: '+esc(error.message)+'</p>';return;}
  if(!rows?.length){box.innerHTML='<p class="muted">No customer bank accounts submitted yet.</p>';return;}
  box.innerHTML=rows.map(b=>`<div class="bankAdminRow"><div><b>${esc(b.account_holder_name||'—')}</b><br><small>Bank: ${esc(b.bank_name||'—')} · A/C: ${esc(b.account_number||'—')} · IFSC: ${esc(b.ifsc_code||'—')}</small><br><small>Branch: ${esc(b.branch_name||'—')} · User ID: ${esc(b.user_id)}</small><br><small>Updated: ${b.updated_at?new Date(b.updated_at).toLocaleString('en-IN'):'—'}</small></div><span class="planState isActive">SAVED</span></div>`).join('');
}

(async function initCustomerDetails(){
  window.__adminCustomerDetailsReady = window.__adminCustomerDetailsReady || new Promise(resolve=>{window.__adminCustomerDetailsReadyResolve=resolve});
  const select=document.getElementById('customerDetailSelect'),box=document.getElementById('customerDetailBox');if(!select||!box)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  let customers=Array.isArray(window.__adminCustomers)?window.__adminCustomers:[];
  let dirErr=null;
  const rpc=await Promise.race([
    sb.rpc('admin_customer_directory'),
    new Promise(resolve=>setTimeout(()=>resolve({data:null,error:{message:'Customer directory query timed out.'}}),7000))
  ]);
  if(rpc.error) dirErr=rpc.error;
  const fallback=await sb.from('profiles').select('id,full_name,phone,role,created_at,referral_code').eq('role','customer').order('created_at',{ascending:false});
  const all=[...(Array.isArray(rpc.data)?rpc.data:[]),...(Array.isArray(fallback.data)?fallback.data:[]),...customers];
  const merged=new Map(); all.forEach(c=>{if(c?.id)merged.set(String(c.id),{...merged.get(String(c.id)),...c});});
  customers=[...merged.values()]; window.__adminCustomers=customers;
  const fill=()=>{const cur=select.value;select.innerHTML='<option value="">Select customer</option>'; (window.__adminCustomers||[]).forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=(c.full_name||'Customer')+' — '+(c.email||c.phone||c.id);select.appendChild(o);}); if(cur)select.value=cur;};
  fill();
  window.addEventListener('chipset:admin-customers-ready',e=>{if(Array.isArray(e.detail)){window.__adminCustomers=e.detail;fill();}});
  if(dirErr && !customers.length){box.innerHTML='<p class="muted">Unable to load customers: '+esc(dirErr.message)+'</p>';return;}

  async function fetchCustomer(id){
    if(!id)return null;
    let c=(window.__adminCustomers||[]).find(x=>String(x.id)===String(id));
    // Never depend on the dropdown cache being complete. Fetch the selected
    // profile directly so a valid option always opens its details.
    if(!c || !c.full_name){
      const prof=await sb.from('profiles').select('id,full_name,phone,role,created_at,referral_code').eq('id',id).maybeSingle();
      if(prof.error) throw prof.error;
      c={...(c||{}),...(prof.data||{})};
    }
    if(!c)return null;
    const results=await Promise.allSettled([
      sb.from('investment_transactions').select('*').eq('user_id',id).order('created_at',{ascending:false}),
      sb.from('bank_accounts').select('*').eq('user_id',id).maybeSingle(),
      sb.from('wallet_transactions').select('*').eq('user_id',id).order('created_at',{ascending:false}),
      sb.from('withdrawal_requests').select('*').eq('user_id',id).order('created_at',{ascending:false}),
      sb.from('investment_withdrawal_overrides').select('*').eq('user_id',id).maybeSingle(),
      sb.from('plan_earnings').select('*').eq('user_id',id).order('scheduled_for',{ascending:false}),
      sb.from('investment_plans').select('id,name,earning_mode,earning_value,earning_frequency,earning_periods,monthly_payout_percent').order('minimum_amount'),
      sb.from('customer_withdrawal_settings').select('*').eq('user_id',id).maybeSingle(),
      sb.from('investment_principal_restrictions').select('*').eq('user_id',id).maybeSingle()
    ]);
    const value=(i,fallback)=>results[i]?.status==='fulfilled' ? (results[i].value||{}) : fallback;
    const tx=value(0,{data:[]}), bank=value(1,{data:null}), wallet=value(2,{data:[]}), withdraw=value(3,{data:[]}), override=value(4,{data:null}), earn=value(5,{data:[]}), planCatalog=value(6,{data:[]}), withdrawalSettingRes=value(7,{data:null}), restriction=value(8,{data:null});
    const txs=tx.data||[], walletRows=wallet.data||[], withdrawals=withdraw.data||[], earnings=earn.data||[];
    const withdrawalSetting=withdrawalSettingRes?.data||{withdrawal_frequency:'weekly',next_eligible_at:null};
    const catalog=planCatalog.data||[];
    const plans=[...new Map(txs.filter(t=>t.plan_name||t.plan_id).map(t=>{const p=catalog.find(x=>String(x.id)===String(t.plan_id)); return [String(t.plan_id||t.plan_name),{...t,earning_mode:t.earning_mode||p?.earning_mode,earning_value:t.earning_value??p?.earning_value,earning_frequency:t.earning_frequency||p?.earning_frequency,earning_periods:t.earning_periods??p?.earning_periods,monthly_payout_percent:t.monthly_payout_percent??p?.monthly_payout_percent}]})).values()];
    return {c,txs,bank:bank.data||null,walletRows,withdrawals,override:override.data||null,restriction:restriction.data||null,plans,earnings,withdrawalSetting};
  }

  function customerHtml(d,mode='full'){
    const withdrawalSetting=d.withdrawalSetting||{withdrawal_frequency:'weekly',next_eligible_at:null};
    const c=d.c;
    const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
    const approvedDebit=d.txs.filter(t=>t.type==='debit'&&t.status==='approved'&&t.plan_id).reduce((a,t)=>a+Number(t.principal_remaining ?? t.amount ?? 0),0);
    const remainingPrincipal=d.txs.filter(t=>t.type==='debit'&&t.status==='approved'&&t.plan_id).reduce((a,t)=>a+Number(t.principal_remaining ?? t.amount ?? 0),0);
    const approvedCredit=d.txs.filter(t=>t.type==='credit'&&t.status==='approved').reduce((a,t)=>a+Number(t.amount||0),0);
    const pendingPrincipal=d.withdrawals.filter(w=>w.status==='pending'&&(w.investment_transaction_id||String(w.customer_note||'').startsWith('[PRINCIPAL_WITHDRAWAL]'))).reduce((a,w)=>a+Number(w.amount||0),0);
    const nonEligiblePrincipal=Math.max(0,Number(d.restriction?.noneligible_amount||0));
    const maturedPrincipal=d.txs.filter(t=>t.type==='debit'&&t.status==='approved'&&t.plan_id).reduce((a,t)=>{const rem=Number(t.principal_remaining ?? t.amount ?? 0);const mature=t.maturity_mode==='immediate'||!t.maturity_at||new Date(t.maturity_at)<=new Date();return a+(mature?rem:0);},0);
    const overrideEligible=Number(d.override?.eligible_amount||0);
    const currentEligible=Math.max(0,(overrideEligible>0?overrideEligible:maturedPrincipal)-pendingPrincipal-nonEligiblePrincipal);
    const walletBalance=d.walletRows.reduce((a,t)=>{const src=String(t.source_type||'').toLowerCase(); const desc=String(t.description||'').toLowerCase(); const isDebit=src.includes('debit')||src.includes('withdraw')||desc.includes('debit')||desc.includes('withdraw'); return a+(isDebit?-1:1)*Number(t.amount||0);},0);
    const earnByTx=new Map((d.earnings||[]).map(e=>[String(e.investment_transaction_id),e]));
    const txLabel=t=>t.type==='debit'?'BUY':'CREDIT';
    const txClass=t=>t.type==='debit'||t.type==='credit'?'creditText':'debitText';
    const txSign=t=>t.type==='debit'||t.type==='credit'?'+':'-';
    const toLocalDateTimeInput=v=>{if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};
    const planReturnValue=t=>Number(t.return_percent ?? t.monthly_payout_percent ?? 0);
    const planMaturityMode=t=>String(t.maturity_mode||'days');
    const planMaturityDays=t=>Number(t.maturity_days ?? 30);
    return `<div class="customerDetailCard"><div class="customerDetailTop"><div><h3>${esc(c.full_name||'Customer')}</h3><p class="muted">${esc(c.email||'No email')} · ${esc(c.phone||'No phone')} · Joined ${c.created_at?new Date(c.created_at).toLocaleDateString('en-IN'):'-'}</p></div><div class="customerActionRow"><button class="smallBtn editCustomer" data-id="${esc(c.id)}">Edit Details</button><button class="smallBtn danger deleteCustomer" data-id="${esc(c.id)}">Delete Customer</button></div></div><div class="detailStats"><div><small>INVESTED / BUY</small><b>${money(approvedDebit)}</b></div><div><small>APPROVED CREDIT</small><b>${money(approvedCredit)}</b></div><div><small>WALLET BALANCE</small><b>${money(walletBalance)}</b></div></div><div class="planEditFields" style="margin:12px 0"><label>Wallet Debit (₹)<input id="customerDebitAmount" type="number" min="0.01" step="0.01" placeholder="Amount"></label><label>Debit Reason<input id="customerDebitReason" type="text" placeholder="Reason is required"></label><button type="button" class="smallBtn danger customerDebitWallet" data-user-id="${esc(c.id)}">Debit Wallet</button><span id="customerDebitMsg" class="muted"></span></div><div class="customerInfoGrid"><div><small>EMAIL</small><b>${esc(c.email||'-')}</b></div><div><small>PHONE</small><b>${esc(c.phone||'-')}</b></div><div><small>REFERRAL CODE</small><b>${esc(c.referral_code||'Not generated')}</b></div></div><div class="planEditFields" style="margin:12px 0"><label>Wallet Withdrawal Eligibility<select id="customerWithdrawalFrequency"><option value="daily" ${String(withdrawalSetting.withdrawal_frequency||'weekly')==='daily'?'selected':''}>Daily</option><option value="weekly" ${String(withdrawalSetting.withdrawal_frequency||'weekly')==='weekly'?'selected':''}>Weekly (Default)</option><option value="monthly" ${String(withdrawalSetting.withdrawal_frequency||'weekly')==='monthly'?'selected':''}>Monthly</option></select></label><button type="button" class="smallBtn saveCustomerWithdrawalFrequency">Save Withdrawal Schedule</button><span id="customerWithdrawalMsg" class="muted"></span></div><h3>Investment Plans</h3><div class="detailPlanList">${d.plans.length?d.plans.map(t=>{const e=earnByTx.get(String(t.id));const mode=String(t.earning_mode||'');const value=Number(t.earning_value ?? t.monthly_payout_percent ?? 0);const freq=String(t.earning_frequency||'weekly');const earning=mode==='fixed'?`${money(value)} ${freq}`:(value?`${value}% ${freq}`:'Earning not configured');const earned=e?Number(e.earning_amount||0):0;const ret=planReturnValue(t);const mm=planMaturityMode(t);const md=Number(t.term_days ?? t.maturity_days ?? 0);
    const freqDiv=String(t.earning_frequency||'weekly')==='daily'?1:String(t.earning_frequency||'weekly')==='monthly'?30:7;
    const calculatedTerm=Math.max(1,Number(t.earning_periods||52)*freqDiv);return `<div class="detailPlan"><div><b>${esc(t.plan_name||'Investment Plan')}</b><small>${new Date(t.created_at).toLocaleDateString('en-IN')} · ${esc(t.status)} · Earning: ${esc(earning)}${e?` · Earned: ${money(earned)}`:''}</small></div><strong>${money(t.principal_remaining ?? t.amount)}</strong><div class="planAdminControls"><label>Interest / Return (%)<input class="investmentReturn" data-tx-id="${esc(t.id)}" type="number" min="0" step="0.01" value="${ret}"></label><label>Rate Period<select class="investmentEarnFreq" data-tx-id="${esc(t.id)}"><option value="daily" ${String(t.earning_frequency||'weekly')==='daily'?'selected':''}>Daily</option><option value="weekly" ${String(t.earning_frequency||'weekly')==='weekly'?'selected':''}>Weekly</option><option value="monthly" ${String(t.earning_frequency||'weekly')==='monthly'?'selected':''}>Monthly</option></select></label><label>Next Credit Date<input class="investmentNextCredit" data-tx-id="${esc(t.id)}" type="datetime-local" value="${toLocalDateTimeInput(t.earning_next_at)}"></label><label>Maturity<select class="investmentMaturityMode" data-tx-id="${esc(t.id)}"><option value="immediate" ${mm==='immediate'?'selected':''}>Immediate</option><option value="days" ${mm!=='immediate'?'selected':''}>Choice Days</option></select></label><label class="maturityDaysWrap">Choice Days<input class="investmentMaturityDays" data-tx-id="${esc(t.id)}" type="number" min="1" step="1" value="${calculatedTerm}"></label><button type="button" class="smallBtn saveInvestmentTerms" data-tx-id="${esc(t.id)}">Save Terms</button><span class="investmentTermsMsg" data-tx-msg="${esc(t.id)}"></span></div></div>`}).join(''):'<p class="muted">No investment plan found.</p>'}</div><h3>Investment Withdrawal Eligibility</h3><div class="withdrawalEligibilityAdmin"><div class="customerInfoGrid"><div><small>CURRENT ELIGIBLE AMOUNT</small><b>${currentEligible>0?money(currentEligible):'None'}</b></div><div><small>ELIGIBLE UNTIL</small><b>${(()=>{const ov=Number(d.override?.eligible_amount||0);const pending=d.withdrawals.some(w=>w.status==='pending'&&(w.investment_transaction_id||String(w.customer_note||'').startsWith('[PRINCIPAL_WITHDRAWAL]')));return ov>0&&!pending&&d.override?.expires_at?new Date(d.override.expires_at).toLocaleString('en-IN'):'No expiry';})()}</b></div><div><small>REASON</small><b>${(()=>{const ov=Number(d.override?.eligible_amount||0);const pending=d.withdrawals.some(w=>w.status==='pending'&&(w.investment_transaction_id||String(w.customer_note||'').startsWith('[PRINCIPAL_WITHDRAWAL]')));return ov>0&&!pending?esc(d.override?.reason||'-'):'-';})()}</b></div></div><div class="planEditFields" style="margin-top:12px"><label>Add Invested Amount Eligibility (₹)<input id="overrideEligibleAmount" type="number" min="0.01" step="0.01" value="" placeholder="Enter amount to add"></label><label>Eligible Until (required)<input id="overrideExpiresAt" type="datetime-local" required value=""></label><label>Reason<input id="overrideReason" type="text" placeholder="Reason is mandatory" required value=""></label></div><div class="popupActions"><button type="button" class="smallBtn" id="saveInvestmentOverride">Save Eligibility</button><button type="button" class="smallBtn danger" id="clearInvestmentOverride">Clear Override</button></div><p id="investmentOverrideMsg" class="muted"></p><div class="principalRestrictionAdmin" style="margin-top:18px;padding:14px;border:1px solid #dbe7f3;border-radius:12px;background:#f8fbff"><h4 style="margin:0 0 8px">Principal Eligibility Control</h4><p class="muted" style="margin:0 0 12px">Make part of the invested principal temporarily <b>non-eligible for withdrawal</b>. This does not remove money, change the investment amount, or stop daily earnings.</p><div class="customerInfoGrid"><div><small>CURRENT ELIGIBLE TO RESTRICT</small><b>${money(currentEligible)}</b></div><div><small>CURRENT NON-ELIGIBLE</small><b>${money(Number(d.restriction?.noneligible_amount||0))}</b></div><div><small>ADMIN REASON</small><b>${esc(d.restriction?.reason||'-')}</b></div></div><div class="planEditFields" style="margin-top:12px"><label>Amount to Make Non-Eligible (₹)<input id="principalNonEligibleAmount" type="number" min="0.01" step="0.01" placeholder="Enter amount"></label><label>Reason<input id="principalNonEligibleReason" type="text" placeholder="Reason is required"></label></div><div class="popupActions"><button type="button" class="smallBtn danger" id="makePrincipalNonEligible">Make Non-Eligible</button><button type="button" class="smallBtn" id="restorePrincipalEligible">Restore Eligibility</button></div><p id="principalRestrictionMsg" class="muted"></p></div></div></div><h3>Bank Details</h3><div class="customerInfoGrid bankGrid">${d.bank?`<div><small>ACCOUNT HOLDER</small><b>${esc(d.bank.account_holder_name||'-')}</b></div><div><small>BANK</small><b>${esc(d.bank.bank_name||'-')}</b></div><div><small>ACCOUNT NUMBER</small><b>${esc(d.bank.account_number||'-')}</b></div><div><small>IFSC</small><b>${esc(d.bank.ifsc_code||'-')}</b></div>`:'<p class="muted">No bank account submitted.</p>'}</div><h3>Withdrawal Requests</h3><div class="detailTxList">${d.withdrawals.length?d.withdrawals.map(w=>`<div class="detailTx"><div><b>${money(w.amount)}</b><small>${w.requested_at?new Date(w.requested_at).toLocaleString('en-IN'):'-'} · ${esc(w.status)}</small></div><span>${esc(w.review_reason||w.customer_note||'')}</span></div>`).join(''):'<p class="muted">No withdrawal requests.</p>'}</div><h3>Transaction History</h3><div class="detailTxList">${d.txs.length?d.txs.map(t=>`<div class="detailTx"><div><b>${esc(txLabel(t))}${t.plan_name?` · ${esc(t.plan_name)}`:''}</b><small>${new Date(t.created_at).toLocaleString('en-IN')} · ${esc(t.status)}${t.payment_ref?` · ${esc(t.payment_ref)}`:''}</small></div><strong class="${txClass(t)}">${txSign(t)}${money(t.amount)}</strong></div>`).join(''):'<p class="muted">No transactions.</p>'}</div></div>`;
  }

  function syncMaturityControls(root){
    root.querySelectorAll('.investmentMaturityMode').forEach(sel=>{
      const wrap=sel.closest('.planAdminControls');
      if(!wrap)return;
      const immediate=sel.value==='immediate';
      const days=wrap.querySelector('.maturityDaysWrap');
      const date=wrap.querySelector('.maturityDateWrap');
      if(days) days.style.display=immediate?'none':'';
      if(date) date.style.display=immediate?'none':'';
    });
  }
  async function saveInvestmentTerms(root,txId){
    const wrap=root.querySelector(`.saveInvestmentTerms[data-tx-id="${txId}"]`)?.closest('.planAdminControls');
    if(!wrap)return;
    const msg=wrap.querySelector('.investmentTermsMsg');
    const btn=wrap.querySelector('.saveInvestmentTerms');
    try{
      btn.disabled=true; btn.textContent='Saving…';
      const ret=Number(wrap.querySelector('.investmentReturn')?.value||0);
      const mode=String(wrap.querySelector('.investmentMaturityMode')?.value||'days');
      const days=Number(wrap.querySelector('.investmentMaturityDays')?.value||30);
      const freq=String(wrap.querySelector('.investmentEarnFreq')?.value||'weekly');
      const nextRaw=String(wrap.querySelector('.investmentNextCredit')?.value||'').trim();
      if(!Number.isFinite(ret)||ret<0) throw new Error('Interest / Return must be 0 or more.');
      if(mode==='days' && (!Number.isInteger(days)||days<1)) throw new Error('Choice Days must be at least 1.');
      if(!nextRaw) throw new Error('Next Credit Date is required.');
      const nextCreditAt=new Date(nextRaw);
      if(Number.isNaN(nextCreditAt.getTime())) throw new Error('Invalid Next Credit Date.');
      const customerData=window.__adminCurrentCustomerData;
      const baseTx=customerData?.txs?.find(x=>String(x.id)===String(txId));
      if(!baseTx) throw new Error('Investment transaction not found.');
      const maturityAt=mode==='days'?new Date(new Date(baseTx.created_at).getTime()+days*86400000).toISOString():null;
      const r=await sb.rpc('admin_update_investment_terms',{p_transaction_id:txId,p_return_percent:ret,p_earning_frequency:freq,p_next_credit_at:nextCreditAt.toISOString(),p_maturity_mode:mode,p_maturity_days:mode==='immediate'?0:days,p_maturity_at:maturityAt});
      if(r.error) throw r.error;
      if(msg)msg.textContent='Saved.';
      await renderCustomer(customerData.c.id);
    }catch(e){if(msg)msg.textContent='Unable to save: '+String(e?.message||e);}
    finally{btn.disabled=false;btn.textContent='Save Terms';}
  }
  async function renderCustomer(id){
    if(!id){box.innerHTML='<p class="muted">Select a customer to view complete details.</p>';return;}
    box.innerHTML='<p class="muted">Loading customer details…</p>';
    try{
      const d=await fetchCustomer(id);
      if(!d){box.innerHTML='<p class="muted">Customer not found.</p>';return;}
      box.innerHTML=customerHtml(d);
      await bindCustomerActions(box,d);
    }catch(e){
      const msg=String(e?.message||e||'Unknown error');
      console.error('Customer details failed:',e);
      box.innerHTML='<div class="customerDetailCard"><h3>Unable to load customer details</h3><p class="muted">'+esc(msg)+'</p><button type="button" class="smallBtn" id="retryCustomerDetails">Retry</button></div>';
      box.querySelector('#retryCustomerDetails')?.addEventListener('click',()=>renderCustomer(id));
    }
  }
  async function bindCustomerActions(root,d){
    window.__adminCurrentCustomerData=d;
    root.querySelector('.customerDebitWallet')?.addEventListener('click',async()=>{const btn=root.querySelector('.customerDebitWallet'),amount=Number(root.querySelector('#customerDebitAmount')?.value),reason=root.querySelector('#customerDebitReason')?.value.trim()||'',msg=root.querySelector('#customerDebitMsg');if(!amount||amount<=0){msg.textContent='Enter a positive amount.';return;}if(!reason){msg.textContent='Reason is required.';return;}if(!confirm(`Debit ₹${amount.toLocaleString('en-IN')} from ${d.c.full_name||'this customer'}?\n\nReason: ${reason}`))return;btn.disabled=true;btn.textContent='Debiting…';const r=await sb.rpc('admin_debit_wallet',{p_user_id:d.c.id,p_amount:amount,p_reason:reason});if(r.error){msg.textContent='Unable to debit wallet: '+r.error.message;btn.disabled=false;btn.textContent='Debit Wallet';return;}msg.textContent='Wallet debited successfully.';setTimeout(()=>renderCustomer(d.c.id),400);});
    root.querySelector('.saveCustomerWithdrawalFrequency')?.addEventListener('click',async()=>{const btn=root.querySelector('.saveCustomerWithdrawalFrequency'),sel=root.querySelector('#customerWithdrawalFrequency'),msg=root.querySelector('#customerWithdrawalMsg');if(!sel)return;btn.disabled=true;btn.textContent='Saving…';try{const r=await sb.rpc('admin_set_customer_withdrawal_frequency',{p_user_id:d.c.id,p_frequency:sel.value});if(r.error)throw r.error;if(msg)msg.textContent='Withdrawal schedule saved.';setTimeout(()=>renderCustomer(d.c.id),400);}catch(e){if(msg)msg.textContent='Unable to save: '+String(e?.message||e);}finally{btn.disabled=false;btn.textContent='Save Withdrawal Schedule';}});
    // A submitted principal-investment withdrawal consumes the admin-granted
    // eligibility immediately. Detect both the new RPC marker and older rows
    // that already contain investment_transaction_id, then clear the override
    // through the admin RPC so the dashboard stays correct even if the SQL
    // migration was not run yet.
    const pendingPrincipalWithdrawal=d.withdrawals.some(w=>w.status==='pending'&&(w.investment_transaction_id||String(w.customer_note||'').startsWith('[PRINCIPAL_WITHDRAWAL]')));
    if(pendingPrincipalWithdrawal && Number(d.override?.eligible_amount||0)>0){
      try{
        const clearResult=await sb.rpc('admin_set_investment_withdrawal_override',{p_user_id:d.c.id,p_eligible_amount:0,p_reason:null,p_expires_at:null,p_credited_amount:0});
        if(!clearResult.error){
          const fresh=await fetchCustomer(d.c.id);
          if(fresh){ d.override=fresh.override; }
        }
      }catch(_e){ /* UI below still hides consumed eligibility */ }
    }
    const remainingPrincipal=d.txs.filter(t=>t.type==='debit'&&t.status==='approved'&&t.plan_id).reduce((a,t)=>a+Number(t.principal_remaining ?? t.amount ?? 0),0);
    syncMaturityControls(root);
    root.querySelectorAll('.investmentMaturityMode').forEach(sel=>sel.addEventListener('change',()=>syncMaturityControls(root)));
    root.querySelectorAll('.saveInvestmentTerms').forEach(btn=>btn.addEventListener('click',()=>saveInvestmentTerms(root,btn.dataset.txId)));
    root.querySelector('.editCustomer')?.addEventListener('click',()=>openEditCustomer(d));
    root.querySelector('.deleteCustomer')?.addEventListener('click',()=>deleteCustomer(d.c.id,d.c.full_name));
    const save=root.querySelector('#saveInvestmentOverride'), clear=root.querySelector('#clearInvestmentOverride'), msg=root.querySelector('#investmentOverrideMsg');
    async function saveOverride(clearIt=false){
      if(save) {save.disabled=true; save.textContent=clearIt?'Clearing…':'Saving…';}
      if(clear) clear.disabled=true;
      try{
        const amount=clearIt?0:Number(root.querySelector('#overrideEligibleAmount')?.value||0);
        const reason=clearIt?'':String(root.querySelector('#overrideReason')?.value||'').trim();
        const raw=root.querySelector('#overrideExpiresAt')?.value||'';
        const expiresAt=clearIt||!raw?null:new Date(raw).toISOString();
        if(!clearIt && amount<0) throw new Error('Eligible amount cannot be negative.');
        if(!clearIt && !reason) throw new Error('Reason is mandatory. Please enter a reason.');
        if(!clearIt && !raw) throw new Error('Eligible Until is mandatory. Please select a date and time.');
        if(!clearIt && expiresAt && new Date(expiresAt).getTime()<=Date.now()) throw new Error('Eligible Until must be in the future.');
        const currentOverride=Number(d.override?.eligible_amount||0);
        if(!clearIt && amount>Math.max(0,remainingPrincipal-currentOverride)) throw new Error('Added eligible amount cannot exceed the customer’s remaining invested principal.');
        const r=await sb.rpc('admin_set_investment_withdrawal_override',{p_user_id:d.c.id,p_eligible_amount:amount,p_reason:reason||null,p_expires_at:expiresAt,p_credited_amount:0});
        if(r.error) throw r.error;
        msg.className='investmentOverrideMsg success'; msg.textContent=clearIt?'Investment withdrawal override cleared.':'Investment withdrawal eligibility saved.';
        root.querySelector('#overrideEligibleAmount')?.setAttribute('value','');
        const amountInput=root.querySelector('#overrideEligibleAmount'); if(amountInput) amountInput.value='';
        const expiresInput=root.querySelector('#overrideExpiresAt'); if(expiresInput) expiresInput.value='';
        const reasonInput=root.querySelector('#overrideReason'); if(reasonInput) reasonInput.value='';
        const fresh=await fetchCustomer(d.c.id);
        if(fresh){d.override=fresh.override;root.innerHTML=customerHtml(fresh);bindCustomerActions(root,fresh);}
      }catch(e){if(msg){msg.className='investmentOverrideMsg error';msg.textContent='ERROR: Unable to save eligibility: '+String(e?.message||e);}}
      finally{if(save){save.disabled=false;save.textContent='Save Eligibility';}if(clear)clear.disabled=false;}
    }
    save?.addEventListener('click',()=>{if(confirm('Make this invested amount eligible for withdrawal?\n\nPress OK for Yes or Cancel for No.'))saveOverride(false);});
    clear?.addEventListener('click',()=>{if(confirm('Clear this customer’s special investment withdrawal eligibility?\n\nPress OK for Yes or Cancel for No.'))saveOverride(true);});

    const restrictionMsg=root.querySelector('#principalRestrictionMsg');
    async function changePrincipalRestriction(direction){
      const amount=Number(root.querySelector('#principalNonEligibleAmount')?.value||0);
      const reason=String(root.querySelector('#principalNonEligibleReason')?.value||'').trim();
      const current=Number(d.restriction?.noneligible_amount||0);
      const remainingPrincipal=d.txs.filter(t=>t.type==='debit'&&t.status==='approved'&&t.plan_id).reduce((a,t)=>a+Number(t.principal_remaining ?? t.amount ?? 0),0);
      if(!amount||amount<=0){if(restrictionMsg)restrictionMsg.textContent='Enter a positive amount.';return;}
      if(!reason){if(restrictionMsg)restrictionMsg.textContent='Reason is required.';return;}
      if(direction==='remove' && amount>current){if(restrictionMsg)restrictionMsg.textContent='Restore amount cannot exceed current non-eligible amount.';return;}
      if(direction==='add' && amount>Math.max(0,remainingPrincipal-current-pendingPrincipal)){if(restrictionMsg)restrictionMsg.textContent='Amount cannot exceed the customer’s currently eligible principal: '+money(Math.max(0,remainingPrincipal-current-pendingPrincipal));return;}
      const next=direction==='remove'?Math.max(0,current-amount):current+amount;
      if(next>remainingPrincipal){if(restrictionMsg)restrictionMsg.textContent='Non-eligible amount cannot exceed remaining invested principal.';return;}
      if(!confirm(direction==='remove'?`Restore ₹${amount.toLocaleString('en-IN')} to withdrawal eligibility?`:`Make ₹${amount.toLocaleString('en-IN')} of principal non-eligible?`))return;
      const btn=direction==='remove'?root.querySelector('#restorePrincipalEligible'):root.querySelector('#makePrincipalNonEligible');
      if(btn){btn.disabled=true;btn.textContent=direction==='remove'?'Restoring…':'Saving…';}
      try{
        const r=await sb.rpc('admin_set_principal_noneligible',{p_user_id:d.c.id,p_noneligible_amount:next,p_reason:reason});
        if(r.error)throw r.error;
        if(restrictionMsg){restrictionMsg.className='principalRestrictionMsg success';restrictionMsg.textContent=direction==='remove'?'Principal eligibility restored.':'Principal amount marked non-eligible.';}
        const fresh=await fetchCustomer(d.c.id);
        if(fresh){root.innerHTML=customerHtml(fresh);bindCustomerActions(root,fresh);}
      }catch(e){if(restrictionMsg){restrictionMsg.className='principalRestrictionMsg error';restrictionMsg.textContent='ERROR: '+String(e?.message||e);}}
      finally{if(btn){btn.disabled=false;btn.textContent=direction==='remove'?'Restore Eligibility':'Make Non-Eligible';}}
    }
    root.querySelector('#makePrincipalNonEligible')?.addEventListener('click',()=>changePrincipalRestriction('add'));
    root.querySelector('#restorePrincipalEligible')?.addEventListener('click',()=>changePrincipalRestriction('remove'));
  }
  select.addEventListener('change',()=>{void renderCustomer(select.value);});
  const lookupInput=document.getElementById('customerContactLookup'), lookupBtn=document.getElementById('findCustomerByContact'), lookupMsg=document.getElementById('customerLookupMsg');
  async function lookupCustomerByContact(){
    const contact=(lookupInput?.value||'').trim();
    if(!contact){if(lookupMsg)lookupMsg.textContent='Enter email or phone.';return;}
    if(lookupBtn){lookupBtn.disabled=true;lookupBtn.textContent='Finding…';}
    if(lookupMsg)lookupMsg.textContent='Searching…';
    try{
      const r=await sb.rpc('admin_find_customer_by_contact',{p_contact:contact});
      if(r.error) throw r.error;
      const found=Array.isArray(r.data)?r.data[0]:r.data;
      if(!found?.id){if(lookupMsg)lookupMsg.textContent='No customer found with this email/phone.';return;}
      const existing=(window.__adminCustomers||[]).find(x=>String(x.id)===String(found.id));
      if(existing) Object.assign(existing,found); else (window.__adminCustomers||[]).push(found);
      fill();
      select.value=String(found.id);
      await renderCustomer(found.id);
      if(lookupMsg)lookupMsg.textContent='Customer found.';
    }catch(e){if(lookupMsg)lookupMsg.textContent='Lookup failed: '+String(e?.message||e);}
    finally{if(lookupBtn){lookupBtn.disabled=false;lookupBtn.textContent='Find Customer';}}
  }
  lookupBtn?.addEventListener('click',lookupCustomerByContact);
  lookupInput?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lookupCustomerByContact();}});
  window.__adminFetchCustomer=fetchCustomer; window.__adminRenderCustomer=renderCustomer;
  if(window.__adminCustomerDetailsReadyResolve){window.__adminCustomerDetailsReadyResolve(true);window.__adminCustomerDetailsReadyResolve=null;}
})();

function ensureCustomerModal(){
  if(document.getElementById('customerPopup'))return document.getElementById('customerPopup');
  const m=document.createElement('div');m.id='customerPopup';m.className='customerPopup';m.innerHTML='<div class="customerPopupBackdrop"></div><div class="customerPopupDialog" role="dialog" aria-modal="true"><div class="customerPopupHead"><div><h2 id="customerPopupTitle">Customer Details</h2><span id="customerPopupSub" class="muted"></span></div><button type="button" class="customerPopupClose" aria-label="Close">×</button></div><div id="customerPopupBody"></div></div>';
  document.body.appendChild(m);m.querySelector('.customerPopupBackdrop').onclick=()=>m.classList.remove('open');m.querySelector('.customerPopupClose').onclick=()=>m.classList.remove('open');return m;
}
async function openCustomerPopup(id){
  const m=ensureCustomerModal(),body=m.querySelector('#customerPopupBody');m.classList.add('open');body.innerHTML='<p class="muted">Loading customer details…</p>';
  let fetcher=window.__adminFetchCustomer;
  if(!fetcher && window.__adminCustomerDetailsReady){
    try{await Promise.race([window.__adminCustomerDetailsReady,new Promise(r=>setTimeout(r,5000))]);}catch(e){}
    fetcher=window.__adminFetchCustomer;
  }
  // Do not depend on the Customers-tab initializer for the Overview popup.
  // The popup must work even while that background loader is still running.
  if(!fetcher){
    fetcher=async function directFetchCustomer(customerId){
      let c=(window.__adminCustomers||[]).find(x=>String(x.id)===String(customerId));
      if(!c){
        const prof=await sb.from('profiles').select('id,full_name,phone,role,created_at,referral_code').eq('id',customerId).maybeSingle();
        if(prof.error) throw prof.error;
        c=prof.data;
      }
      if(!c)return null;
      const [tx,bank,wallet,withdraw,override,earn,planCatalog,withdrawalSettingRes]=await Promise.all([
        sb.from('investment_transactions').select('*').eq('user_id',customerId).order('created_at',{ascending:false}),
        sb.from('bank_accounts').select('*').eq('user_id',customerId).maybeSingle(),
        sb.from('wallet_transactions').select('*').eq('user_id',customerId).order('created_at',{ascending:false}),
        sb.from('withdrawal_requests').select('*').eq('user_id',customerId).order('created_at',{ascending:false}),
        sb.from('investment_withdrawal_overrides').select('*').eq('user_id',customerId).maybeSingle(),
        sb.from('plan_earnings').select('*').eq('user_id',customerId).order('scheduled_for',{ascending:false}),
        sb.from('investment_plans').select('id,name,earning_mode,earning_value,earning_frequency,earning_periods,monthly_payout_percent').order('minimum_amount'),
        sb.from('customer_withdrawal_settings').select('*').eq('user_id',customerId).maybeSingle()
      ]);
      const firstErr=[tx,bank,wallet,withdraw,override,earn,planCatalog,withdrawalSettingRes].find(x=>x.error);
      if(firstErr?.error) throw firstErr.error;
      const txs=tx.data||[], walletRows=wallet.data||[], withdrawals=withdraw.data||[], earnings=earn.data||[];
    const catalog=planCatalog.data||[];
      const plans=[...new Map(txs.filter(t=>t.plan_name||t.plan_id).map(t=>{const p=catalog.find(x=>String(x.id)===String(t.plan_id)); return [String(t.plan_id||t.plan_name),{...t,earning_mode:t.earning_mode||p?.earning_mode,earning_value:t.earning_value??p?.earning_value,earning_frequency:t.earning_frequency||p?.earning_frequency,earning_periods:t.earning_periods??p?.earning_periods,monthly_payout_percent:t.monthly_payout_percent??p?.monthly_payout_percent}]})).values()];
      return {c,txs,bank:bank.data||null,walletRows,withdrawals,override:override.data||null,plans,earnings};
    };
  }
  let d;
  try{d=await fetcher(id);}catch(e){body.innerHTML='<p class="muted">Unable to load customer details: '+String(e?.message||e)+'</p>';return;}if(!d){body.innerHTML='<p class="muted">Customer not found.</p>';return;}
  body.innerHTML=customerHtmlPopup(d);bindPopupActions(m,d);
}
function customerHtmlPopup(d){
  const c=d.c,esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  const deb=d.txs.filter(t=>t.type==='debit'&&t.status==='approved'&&t.plan_id).reduce((a,t)=>a+Number(t.principal_remaining ?? t.amount ?? 0),0),cred=d.txs.filter(t=>t.type==='credit'&&t.status==='approved').reduce((a,t)=>a+Number(t.amount||0),0);
  const earnByTx=new Map((d.earnings||[]).map(e=>[String(e.investment_transaction_id),e]));
  const txLabel=t=>t.type==='debit'?'BUY':'CREDIT';
  return `<div class="customerPopupSummary"><div><small>INVESTED / BUY</small><b>${money(deb)}</b></div><div><small>CREDIT</small><b>${money(cred)}</b></div><div><small>PLANS</small><b>${d.plans.length}</b></div></div><div class="customerInfoGrid"><div><small>NAME</small><b>${esc(c.full_name||'-')}</b></div><div><small>EMAIL</small><b>${esc(c.email||'-')}</b></div><div><small>PHONE</small><b>${esc(c.phone||'-')}</b></div><div><small>REFERRAL CODE</small><b>${esc(c.referral_code||'Not generated')}</b></div><div><small>JOINED</small><b>${c.created_at?new Date(c.created_at).toLocaleString('en-IN'):'-'}</b></div></div><h3>Investment Plans</h3><div class="detailPlanList">${d.plans.length?d.plans.map(t=>{const e=earnByTx.get(String(t.id));const mode=String(t.earning_mode||'');const value=Number(t.earning_value ?? t.monthly_payout_percent ?? 0);const freq=String(t.earning_frequency||'weekly');const earning=mode==='fixed'?`${money(value)} ${freq}`:(value?`${value}% ${freq}`:'Earning not configured');const earned=e?Number(e.earning_amount||0):0;return `<div class="detailPlan"><div><b>${esc(t.plan_name||'Investment Plan')}</b><small>${new Date(t.created_at).toLocaleDateString('en-IN')} · ${esc(t.status)} · Earning: ${esc(earning)}${e?` · Earned: ${money(earned)}`:''}</small></div><strong>${money(t.amount)}</strong></div>`}).join(''):'<p class="muted">No investment plan found.</p>'}</div><h3>Bank Details</h3><div class="customerInfoGrid bankGrid">${d.bank?`<div><small>ACCOUNT HOLDER</small><b>${esc(d.bank.account_holder_name||'-')}</b></div><div><small>BANK</small><b>${esc(d.bank.bank_name||'-')}</b></div><div><small>ACCOUNT NUMBER</small><b>${esc(d.bank.account_number||'-')}</b></div><div><small>IFSC</small><b>${esc(d.bank.ifsc_code||'-')}</b></div>`:'<p class="muted">No bank account submitted.</p>'}</div><h3>Recent Transactions</h3><div class="detailTxList">${d.txs.slice(0,12).map(t=>`<div class="detailTx"><div><b>${esc(txLabel(t))}${t.plan_name?` · ${esc(t.plan_name)}`:''}</b><small>${new Date(t.created_at).toLocaleString('en-IN')} · ${esc(t.status)}</small></div><strong class="${t.type==='debit'||t.type==='credit'?'creditText':'debitText'}">${t.type==='debit'||t.type==='credit'?'+':'-'}${money(t.amount)}</strong></div>`).join('')||'<p class="muted">No transactions.</p>'}</div><div class="popupActions"><button class="smallBtn editCustomer">Edit / Modify</button><button class="smallBtn danger deleteCustomer">Delete Customer</button></div>`;
}
function bindPopupActions(m,d){m.querySelector('.editCustomer').onclick=()=>openEditCustomer(d);m.querySelector('.deleteCustomer').onclick=()=>deleteCustomer(d.c.id,d.c.full_name);}
function openEditCustomer(d){
  const m=ensureCustomerModal(),body=m.querySelector('#customerPopupBody'),c=d.c,esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  body.innerHTML=`<div class="editCustomerForm"><p class="muted">Changes save hone se pehle confirmation li jayegi. Email account identity hai, isliye yahan read-only hai.</p><label>Full Name<input id="editCustName" value="${esc(c.full_name||'')}"></label><label>Phone<input id="editCustPhone" value="${esc(c.phone||'')}"></label><label>Email<input value="${esc(c.email||'')}" disabled></label><div class="popupActions"><button class="smallBtn" id="cancelCustomerEdit">Cancel</button><button class="smallBtn" id="saveCustomerEdit">Save Changes</button></div><p id="editCustomerMsg" class="muted"></p></div>`;
  body.querySelector('#cancelCustomerEdit').onclick=()=>openCustomerPopup(c.id);
  body.querySelector('#saveCustomerEdit').onclick=async()=>{
    const name=body.querySelector('#editCustName').value.trim(),phone=body.querySelector('#editCustPhone').value.trim();if(!name){alert('Full name is required.');return;}
    if(!confirm(`Save changes for ${c.full_name||'this customer'}?\n\nName: ${name}\nPhone: ${phone||'-'}\n\nPress OK for Yes or Cancel for No.`))return;
    const btn=body.querySelector('#saveCustomerEdit'),msg=body.querySelector('#editCustomerMsg');btn.disabled=true;btn.textContent='Saving…';
    let {error}=await sb.from('profiles').update({full_name:name,phone}).eq('id',c.id);
    if(error){const rpc=await sb.rpc('admin_update_customer_profile',{p_user_id:c.id,p_full_name:name,p_phone:phone||null});error=rpc.error;}
    if(error){msg.textContent='Unable to save: '+error.message;btn.disabled=false;btn.textContent='Save Changes';return;}
    const cached=(window.__adminCustomers||[]).find(x=>String(x.id)===String(c.id));if(cached){cached.full_name=name;cached.phone=phone;}
    msg.textContent='Saved successfully.';setTimeout(()=>openCustomerPopup(c.id),300);
  };
}
async function deleteCustomer(id,name){
  if(!confirm(`Delete ${name||'this customer'} and ALL their account data?\n\nThis cannot be undone.\n\nPress OK for Yes or Cancel for No.`))return;
  const m=ensureCustomerModal(),body=m.querySelector('#customerPopupBody');body.innerHTML='<p class="muted">Deleting customer…</p>';
  const {error}=await sb.rpc('admin_delete_customer',{p_user_id:id});if(error){body.innerHTML='<p class="muted">Unable to delete customer: '+String(error.message||error)+'</p>';return;}
  m.classList.remove('open');window.__adminCustomers=(window.__adminCustomers||[]).filter(c=>String(c.id)!==String(id));
  const sel=document.getElementById('customerDetailSelect');if(sel){[...sel.options].find(o=>String(o.value)===String(id))?.remove();sel.value='';}
  if(window.__adminRenderCustomer)window.__adminRenderCustomer('');document.querySelector(`.viewCustomer[data-id="${CSS.escape(String(id))}"]`)?.closest('tr')?.remove();alert('Customer deleted successfully.');
}

// Public Home Page CMS: header menu, About Us and screenshot payout card text.
(function initHomePageCms(){
  if(!window.sb) return;
  const defaults=[
    {label:'HOME',href:'index.html'},
    {label:'ABOUT US',href:'#about'},
    {label:'INVESTMENT PLAN',href:'#plans'},
    {label:'WHY CHIPSET',href:'#why'},
    {label:'FAQ',href:'#faq'},
    {label:'CONTACT',href:'#contact'}
  ];
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const save=async(key,value)=>{const {error}=await sb.from('site_settings').upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'});if(error)throw error;};
  const menuBox=document.getElementById('menuEditor');
  const renderMenuEditor=(items)=>{
    if(!menuBox)return;
    menuBox.innerHTML=items.map((m,i)=>`<div class="menuEditorRow" data-index="${i}"><div class="menuOrder"><button type="button" class="menuMove menuUp" ${i===0?'disabled':''}>↑</button><button type="button" class="menuMove menuDown" ${i===items.length-1?'disabled':''}>↓</button></div><label>Menu Label<input class="menuLabel" value="${esc(m.label)}"></label><label>Link / URL<input class="menuHref" value="${esc(m.href)}" placeholder="#about or page.html"></label><label class="menuEnabled"><input class="menuActive" type="checkbox" ${m.active!==false?'checked':''}> Show</label><button type="button" class="smallBtn danger menuDelete">Delete</button></div>`).join('')||'<p class="muted">No menu items. Click + Add Menu Item.</p>';
    menuBox.querySelectorAll('.menuMove').forEach(btn=>btn.onclick=()=>{
      const row=btn.closest('.menuEditorRow'), i=Number(row.dataset.index), j=btn.classList.contains('menuUp')?i-1:i+1;
      if(j<0||j>=items.length)return; [items[i],items[j]]=[items[j],items[i]]; renderMenuEditor(items);
    });
    menuBox.querySelectorAll('.menuDelete').forEach(btn=>btn.onclick=()=>{const i=Number(btn.closest('.menuEditorRow').dataset.index);items.splice(i,1);renderMenuEditor(items);});
  };
  const readMenu=()=>[...document.querySelectorAll('.menuEditorRow')].map(r=>({label:r.querySelector('.menuLabel').value.trim(),href:r.querySelector('.menuHref').value.trim(),active:r.querySelector('.menuActive').checked})).filter(x=>x.label&&x.href);

  async function load(){
    const {data,error}=await sb.from('site_settings').select('key,value'); if(error)return;
    const s={};(data||[]).forEach(x=>s[x.key]=x.value);
    let items=defaults;
    try{const parsed=JSON.parse(s.site_menu||'');if(Array.isArray(parsed))items=parsed;}catch(e){}
    renderMenuEditor(items.map(x=>({label:x.label||x.text||'',href:x.href||'#',active:x.active!==false})));
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
    set('aboutEyebrowInput',s.about_eyebrow||'ABOUT CHIPSET');
    set('aboutTitleInput',s.about_title||"Infrastructure for India's next digital chapter.");
    set('aboutText1Input',s.about_text_1||''); set('aboutText2Input',s.about_text_2||'');
    set('earnCardTitleInput',s.earn_card_title||'MONTHLY PAYOUT*');
    set('earnCardPayoutInput',s.earn_card_payout||'');
    set('earnCardTextInput',s.earn_card_text||'');
    set('earnCardButtonInput',s.earn_card_button||'START NOW →');
    set('earnCardButtonLinkInput',s.earn_card_button_link||'register.html');
  }
  load();
  document.getElementById('addMenuItem')?.addEventListener('click',()=>{
    const items=readMenu(); items.push({label:'NEW MENU',href:'#',active:true}); renderMenuEditor(items);
  });
  document.getElementById('saveMenuItems')?.addEventListener('click',async()=>{
    const btn=document.getElementById('saveMenuItems'),msg=document.getElementById('menuSettingsMsg');
    const items=readMenu(); if(!items.length){msg.textContent='At least one menu item is required.';return;}
    btn.disabled=true;btn.textContent='Saving…'; try{await save('site_menu',JSON.stringify(items));msg.textContent='Header menu saved successfully.';}catch(e){msg.textContent='Could not save menu: '+e.message;}finally{btn.disabled=false;btn.textContent='Save Header Menu';}
  });
  document.getElementById('saveAboutSettings')?.addEventListener('click',async()=>{
    const btn=document.getElementById('saveAboutSettings'),msg=document.getElementById('aboutSettingsMsg');btn.disabled=true;btn.textContent='Saving…';
    try{await save('about_eyebrow',document.getElementById('aboutEyebrowInput').value.trim());await save('about_title',document.getElementById('aboutTitleInput').value.trim());await save('about_text_1',document.getElementById('aboutText1Input').value.trim());await save('about_text_2',document.getElementById('aboutText2Input').value.trim());msg.textContent='About Us content saved.';}catch(e){msg.textContent='Could not save About Us: '+e.message;}finally{btn.disabled=false;btn.textContent='Save About Us';}
  });
  document.getElementById('saveEarnCardSettings')?.addEventListener('click',async()=>{
    const btn=document.getElementById('saveEarnCardSettings'),msg=document.getElementById('earnCardSettingsMsg');btn.disabled=true;btn.textContent='Saving…';
    try{await save('earn_card_title',document.getElementById('earnCardTitleInput').value.trim());await save('earn_card_payout',document.getElementById('earnCardPayoutInput').value.trim());await save('earn_card_text',document.getElementById('earnCardTextInput').value.trim());await save('earn_card_button',document.getElementById('earnCardButtonInput').value.trim());await save('earn_card_button_link',document.getElementById('earnCardButtonLinkInput').value.trim());msg.textContent='Monthly payout card text saved.';}catch(e){msg.textContent='Could not save payout card: '+e.message;}finally{btn.disabled=false;btn.textContent='Save Payout Card';}
  });
})();


/* =========================
   V21 ADMIN REALTIME ALERTS
   ========================= */
(function initAdminRealtimeAlerts(){
  const btn=document.getElementById('adminNotifyBtn');
  const panel=document.getElementById('adminNotificationPanel');
  const list=document.getElementById('adminNotificationList');
  const countEl=document.getElementById('adminNotifyCount');
  const markAll=document.getElementById('adminMarkAllRead');
  const toast=document.getElementById('adminNotificationToast');
  if(!btn||!panel||!list)return;

  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let notifications=[];
  let channel=null;

  const typeLabel=t=>({
    signup:'🆕 New customer signup',
    payment:'💰 New payment request',
    withdrawal:'💸 New withdrawal request',
    enquiry:'📩 New customer query'
  }[t]||'🔔 Admin alert');

  const render=()=>{
    const unread=notifications.filter(x=>!x.read_at).length;
    countEl.textContent=unread;
    countEl.hidden=unread===0;
    if(!notifications.length){list.innerHTML='<p class="muted" style="padding:16px">No notifications.</p>';return;}
    list.innerHTML=notifications.slice(0,40).map(n=>{
      const d=n.created_at?new Date(n.created_at).toLocaleString('en-IN'):'';
      return `<div class="adminNotificationItem ${n.read_at?'':'unread'}" data-notification-id="${esc(n.id)}">
        <b>${typeLabel(n.event_type)}</b>
        <div>${esc(n.title||'')}</div>
        <small>${esc(n.message||'')} · ${esc(d)}</small>
      </div>`;
    }).join('');
    list.querySelectorAll('.adminNotificationItem').forEach(el=>el.addEventListener('click',()=>{
      const id=el.dataset.notificationId;
      const n=notifications.find(x=>String(x.id)===String(id));
      if(!n)return;

      // Navigate immediately. Do NOT wait for the Supabase read update, because
      // a slow/blocked RLS request must never make the notification appear dead.
      panel.hidden=true;
      const tabName = ({signup:'customers',payment:'payments',withdrawal:'withdrawals',enquiry:'overview'})[String(n.event_type||'').toLowerCase()] || 'overview';
      const tab=[...document.querySelectorAll('.adminTab')].find(t=>t.dataset.tab===tabName);
      if(tab){ tab.click(); }

      // For signup alerts, select the customer after the Customers panel has opened.
      if(String(n.event_type||'').toLowerCase()==='signup' && n.source_id){
        const pick=()=>{
          const select=document.getElementById('customerDetailSelect');
          if(!select)return;
          const opt=[...select.options].find(o=>String(o.value)===String(n.source_id));
          if(opt){
            select.value=String(n.source_id);
            select.dispatchEvent(new Event('change',{bubbles:true}));
          }
        };
        pick(); setTimeout(pick,250); setTimeout(pick,800); setTimeout(pick,1500);
      }

      const dest = tabName==='customers' ? document.getElementById('customerDetailsPanel') :
                   tabName==='payments' ? document.getElementById('paymentsPanel') :
                   tabName==='withdrawals' ? document.getElementById('withdrawalsPanel') :
                   document.getElementById('enquiriesPanel');
      dest?.scrollIntoView({behavior:'smooth',block:'start'});

      // Mark read in the background; navigation is independent of this request.
      markRead(id).catch(()=>{});
    }));
  };

  const showToast=n=>{
    toast.innerHTML=`<b>${typeLabel(n.event_type)}</b><br>${esc(n.title||'')}<br><small>${esc(n.message||'')}</small>`;
    toast.hidden=false;
    clearTimeout(showToast.timer);
    showToast.timer=setTimeout(()=>toast.hidden=true,7000);
    try{
      if(document.hidden && 'Notification' in window && Notification.permission==='granted'){
        new Notification(typeLabel(n.event_type),{body:(n.title||n.message||'').slice(0,120)});
      }
    }catch(e){}
  };

  const markRead=async id=>{
    const n=notifications.find(x=>String(x.id)===String(id));
    if(!n||n.read_at)return;
    const {error}=await sb.from('admin_notifications').update({read_at:new Date().toISOString()}).eq('id',id);
    if(!error){n.read_at=new Date().toISOString();render();}
  };

  const load=async()=>{
    try{
      await window.__chipsetAdminReady;
      const {data,error}=await sb.from('admin_notifications').select('*').order('created_at',{ascending:false}).limit(50);
      if(error){list.innerHTML='<p class="muted" style="padding:16px">Run the V21 notification SQL in Supabase to enable admin alerts.</p>';return;}
      notifications=data||[]; render();
    }catch(e){
      list.innerHTML=`<p class="muted" style="padding:16px">Alerts unavailable: ${esc(e.message)}</p>`;
    }
  };

  const subscribe=async()=>{
    try{
      await window.__chipsetAdminReady;
      channel=sb.channel('chipset-admin-alerts')
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'admin_notifications'},payload=>{
          const n=payload.new;
          if(!n)return;
          if(notifications.some(x=>String(x.id)===String(n.id)))return;
          notifications.unshift(n); notifications=notifications.slice(0,50); render(); showToast(n);
        })
        .subscribe();
    }catch(e){}
  };

  btn.addEventListener('click',()=>{
    panel.hidden=!panel.hidden;
    if(!panel.hidden)load();
  });
  toast.addEventListener('click',()=>{toast.hidden=true;panel.hidden=false;load();});
  markAll?.addEventListener('click',async()=>{
    try{
      const unread=notifications.filter(x=>!x.read_at);
      if(!unread.length)return;
      const ids=unread.map(x=>x.id);
      const now=new Date().toISOString();
      const {error}=await sb.from('admin_notifications').update({read_at:now}).in('id',ids);
      if(!error){notifications.forEach(x=>{if(ids.includes(x.id))x.read_at=now});render();}
    }catch(e){}
  });

  load();
  subscribe();

  // Ask for browser notification permission only after an admin explicitly clicks the bell.
  btn.addEventListener('click',()=>{
    try{
      if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
    }catch(e){}
  });
})();

