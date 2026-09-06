(async function(){
  const q=id=>document.getElementById(id);
  const showError=m=>{const el=q('dashboardError');if(el){el.textContent=m;el.style.display='block';}};
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  const dt=v=>new Date(v).toLocaleString('en-IN');
  if(!window.sb){location.href='login.html';return;}
  // Bind logout before any awaited database/network work.
  const logoutBtn=q('logout');
  if(logoutBtn){logoutBtn.onclick=async()=>{
    logoutBtn.disabled=true; logoutBtn.textContent='LOGGING OUT…';
    try{await Promise.race([sb.auth.signOut({scope:'local'}),new Promise(r=>setTimeout(r,1200))]);}catch(e){console.warn('Logout:',e);}
    try{Object.keys(localStorage).filter(k=>k.toLowerCase().includes('supabase')).forEach(k=>localStorage.removeItem(k)); Object.keys(sessionStorage).forEach(k=>sessionStorage.removeItem(k));}catch(e){}
    location.replace('login.html');
  };}
  try{
    const {data:{user},error:authError}=await sb.auth.getUser();
    if(authError||!user){location.href='login.html';return;}
    const {data:profile}=await sb.from('profiles').select('id,full_name,phone,role').eq('id',user.id).maybeSingle();
    let activeProfile=profile;
    if(activeProfile?.role==='admin'){location.href='admin.html';return;}
    // Ensure every newly registered customer has a profile before referral generation.
    // This is intentionally best-effort so an RLS/profile issue never blocks the dashboard.
    if(!activeProfile){
      const meta=user.user_metadata||{};
      const seedProfile={id:user.id,full_name:meta.full_name||'Investor',phone:meta.phone||null,role:'customer'};
      try{
        const up=await sb.from('profiles').upsert(seedProfile,{onConflict:'id'}).select('id,full_name,phone,role').maybeSingle();
        if(!up.error && up.data) activeProfile=up.data;
      }catch(e){console.warn('Profile bootstrap skipped:',e);}
    }
    const name=activeProfile?.full_name||user.user_metadata?.full_name||'Investor';
    [['userName',name],['welcomeName',name.split(' ')[0]],['profileName',name],['profileEmail',user.email||''],['profilePhone',activeProfile?.phone||user.user_metadata?.phone||''],['avatar',(name[0]||'I').toUpperCase()]].forEach(([id,val])=>{const el=q(id);if(el)el.textContent=val;});

    try{await sb.rpc('link_guest_transactions_to_user',{p_email:user.email||null,p_phone:activeProfile?.phone||user.user_metadata?.phone||null});}catch(e){console.warn('Guest linking skipped',e)}

    let eligibility={eligible_amount:0,wallet_balance:0,matured_invested_available:0,wait_days:30,next_unlock_at:null};
    let investmentSummary={eligible_amount:0,matured_principal:0,remaining_principal:0,pending_principal:0,override_amount:0,override_expires_at:null,override_reason:null,investments:[]};
    try{
      const sr=await sb.rpc('get_investment_withdrawal_summary',{p_user_id:user.id});
      if(!sr.error && sr.data){
        investmentSummary=Array.isArray(sr.data)?(sr.data[0]||investmentSummary):sr.data;
      } else {
        console.warn('Investment withdrawal summary:',sr.error?.message||sr.error);
        // Fallback for older databases where the summary RPC is not yet available.
        const [ov,pt]=await Promise.all([
          sb.from('investment_withdrawal_overrides').select('eligible_amount,expires_at,reason').eq('user_id',user.id).maybeSingle(),
          sb.from('withdrawal_requests').select('amount,customer_note,status').eq('user_id',user.id).eq('status','pending')
        ]);
        const ovd=ov.data||{};
        const overrideExpired=ovd.expires_at && new Date(ovd.expires_at)<=new Date();
        const overrideAmount=overrideExpired?0:Number(ovd.eligible_amount||0);
        const pendingPrincipal=(pt.data||[]).filter(x=>String(x.customer_note||'').startsWith('[PRINCIPAL_WITHDRAWAL]')).reduce((a,x)=>a+Number(x.amount||0),0);
        investmentSummary={...investmentSummary,override_amount:overrideAmount,override_expires_at:ovd.expires_at||null,override_reason:ovd.reason||null,eligible_amount:Math.max(0,overrideAmount-pendingPrincipal),pending_principal:pendingPrincipal};
      }
    }catch(e){console.warn('Investment withdrawal summary:',e);}
    try{
      const rr=await sb.from('investment_principal_restrictions').select('noneligible_amount,reason').eq('user_id',user.id).maybeSingle();
      const restricted=Number(rr.data?.noneligible_amount||0);
      investmentSummary.restriction_amount=restricted;
      investmentSummary.restriction_reason=rr.data?.reason||null;
      investmentSummary.eligible_amount=Math.max(0,Number(investmentSummary.eligible_amount||0)-restricted);
    }catch(e){console.warn('Principal restriction:',e);}
    try{
      const er=await sb.rpc('get_withdrawal_eligibility',{p_user_id:user.id});
      if(!er.error && er.data) eligibility=er.data;
    }catch(e){console.warn('Legacy withdrawal eligibility:',e);}
    const [enqRes,planRes,settingsRes,txRes,walletRes,bankRes,wdRes,refCodeRes,earningRes,withdrawalScheduleRes,referralRewardsRes,agreementsRes]=await Promise.all([
      sb.from('investment_enquiries').select('*, investment_plans(name,minimum_amount)').eq('user_id',user.id).order('created_at',{ascending:false}),
      sb.from('investment_plans').select('*').eq('active',true).order('minimum_amount',{ascending:true}),
      sb.from('site_settings').select('key,value'),
      sb.from('investment_transactions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      sb.from('wallet_transactions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      sb.from('bank_accounts').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
      sb.from('withdrawal_requests').select('*, bank_accounts(account_holder_name,bank_name,account_number,ifsc_code,branch_name)').eq('user_id',user.id).order('requested_at',{ascending:false}),
      sb.rpc('get_or_create_referral_code'),
      sb.from('plan_earnings').select('*').eq('user_id',user.id).order('scheduled_for',{ascending:false}),
      sb.rpc('get_customer_withdrawal_schedule',{p_user_id:user.id}),
      sb.from('referral_rewards').select('*').eq('referrer_id',user.id).eq('status','credited').order('created_at',{ascending:false}),
      sb.from('investment_agreements').select('*').eq('user_id',user.id).order('approved_at',{ascending:false})
    ]);
    // Referral bootstrap: create a persistent code for new users instead of only showing a UI fallback.
    let referralCodeResult=refCodeRes;
    if(refCodeRes?.error || !String(refCodeRes?.data||'').trim()){
      try{
        const seed=(name.replace(/[^A-Za-z0-9]/g,'').slice(0,4)||'USER').toUpperCase();
        const localCode=seed+user.id.replace(/-/g,'').slice(0,6).toUpperCase();
        const up=await sb.from('profiles').update({referral_code:localCode}).eq('id',user.id).select('referral_code').maybeSingle();
        if(!up.error && up.data?.referral_code) referralCodeResult={data:up.data.referral_code,error:null};
      }catch(e){console.warn('Referral profile bootstrap:',e);}
      if(!String(referralCodeResult?.data||'').trim()){
        try{ referralCodeResult=await sb.rpc('get_or_create_referral_code'); }catch(e){ console.warn('Referral RPC:',e); }
      }
    }
    const settings={};(settingsRes.data||[]).forEach(x=>settings[x.key]=x.value);
    const txs=txRes.data||[], walletTxs=walletRes.data||[], withdrawals=wdRes.data||[], plans=planRes.data||[], enquiries=enqRes.data||[], earnings=earningRes.data||[], referralRewards=referralRewardsRes?.data||[], agreements=agreementsRes?.data||[];
    const withdrawalSchedule=withdrawalScheduleRes?.data||{withdrawal_frequency:'weekly',next_eligible_at:null,eligible:true};
    if(q('investmentAgreements')){
      if(agreementsRes?.error){q('investmentAgreements').innerHTML='<p class="muted">Agreements are not enabled yet. Please ask the administrator to run the agreement setup SQL.</p>';}
      else if(!agreements.length){q('investmentAgreements').innerHTML='<p class="muted">Your verified investment agreement will appear here after payment approval.</p>';}
      else{q('investmentAgreements').innerHTML=agreements.map(a=>`<div class="agreementRow"><div><b>${esc(a.plan_name)}</b><small>${esc(a.agreement_number)} · Approved ${dt(a.approved_at)}</small><small>Investment ${money(a.investment_amount)} · ${esc(a.return_percent!=null?String(a.return_percent)+'% '+(a.earning_frequency||''):a.earning_value!=null?money(a.earning_value)+' '+(a.earning_frequency||''):'Terms on file')}</small></div><a class="smallBtn" href="agreement.html?id=${encodeURIComponent(a.id)}">VIEW / DOWNLOAD</a></div>`).join('');}
    }
    if(walletRes.error) throw new Error('Wallet setup is not active. Please run supabase-wallet-withdrawal.sql once.');
    if(bankRes.error||wdRes.error) throw new Error('Wallet/withdrawal setup is incomplete. Please run supabase-wallet-withdrawal.sql once.');

    // Wallet balance is the wallet ledger (interest, referral bonuses, admin credits/debits).
    // Older databases may have referral_rewards without a matching wallet ledger row, so
    // include only those bonuses that are not already represented in wallet_transactions.
    const walletLedger=walletTxs.reduce((a,x)=>a+Number(x.amount||0),0);
    const representedBonusIds=new Set(walletTxs.filter(x=>String(x.source_type||'').toLowerCase()==='referral_bonus').map(x=>String(x.source_id||'')));
    const unpostedReferralBonus=referralRewards.filter(r=>!representedBonusIds.has(String(r.id))).reduce((a,r)=>a+Number(r.bonus_amount||0),0);
    const walletOnly=Math.max(0,walletLedger+unpostedReferralBonus);
    // Earning is the sum of actual wallet credits from interest + referral bonus.
    // Wallet ledger is the source of truth for credited amounts; plan_earnings is used
    // as a fallback for interest history on older databases.
    const ledgerInterestTotal=walletTxs.filter(x=>String(x.source_type||'').toLowerCase()==='plan_earning').reduce((a,x)=>a+Number(x.amount||0),0);
    const interestTotal=ledgerInterestTotal>0?ledgerInterestTotal:earnings.reduce((a,e)=>a+Number(e.earning_amount||0),0);
    const bonusTotal=referralRewards.reduce((a,r)=>a+Number(r.bonus_amount||0),0);
    const principalEligible=Number(investmentSummary.eligible_amount||0);
    const balance=Math.max(0,walletOnly+principalEligible);
    if(q('walletBalance'))q('walletBalance').textContent=money(walletOnly);
    if(q('walletBalanceSub'))q('walletBalanceSub').textContent=`Withdrawable total: ${money(balance)} • Principal eligible: ${money(principalEligible)}`;
    const withdrawalFreqLabel=String(withdrawalSchedule.withdrawal_frequency||'weekly').toLowerCase();
    const withdrawalNext=withdrawalSchedule.next_eligible_at?new Date(withdrawalSchedule.next_eligible_at):null;
    const withdrawalAvailable=!withdrawalNext || Number.isNaN(withdrawalNext.getTime()) || withdrawalNext.getTime()<=Date.now();
    const withdrawalLabel=withdrawalFreqLabel==='daily'?'Daily':withdrawalFreqLabel==='monthly'?'Monthly':'Weekly';
    const eligibleLabel=q('withdrawEligibleLabel'); if(eligibleLabel) eligibleLabel.textContent='Eligible: '+money(balance);
    const note=q('withdrawEligibilityNote');
    if(note){
      // Dashboard withdrawal status intentionally shows ONLY the withdrawal schedule.
      // Do not mix wallet earnings/principal/maturity figures into this line.
      if(withdrawalFreqLabel==='daily') {
        note.textContent='Withdrawal: Daily • Now';
      } else if(withdrawalAvailable) {
        // Weekly/monthly should not show the extra "Available now" text.
        note.textContent=`Withdrawal: ${withdrawalLabel}`;
      } else {
        note.textContent=`Withdrawal: ${withdrawalLabel} • Next available: ${withdrawalNext.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}`;
      }
    }
    const principalEligibleLabel=q('principalEligibleLabel');
    if(principalEligibleLabel) principalEligibleLabel.textContent=money(principalEligible);
    const principalEligibleReason=q('principalEligibleReason');
    if(principalEligibleReason) principalEligibleReason.textContent=investmentSummary.override_reason?`Admin: ${investmentSummary.override_reason}`:'Matured investments are available for principal withdrawal.';
    const pending=withdrawals.filter(x=>x.status==='pending').reduce((a,x)=>a+Number(x.amount||0),0);if(q('pendingWithdrawal'))q('pendingWithdrawal').textContent=money(pending);
    const withdrawInput=q('withdrawAmount'); if(withdrawInput){withdrawInput.max=String(Math.max(0,balance)); withdrawInput.placeholder=balance>0?`Up to ${money(balance).replace('₹','₹')}`:'No amount currently eligible';}

    const approvedPlans=txs.filter(t=>t.status==='approved'&&t.type==='debit'&&t.plan_id&&!t.withdrawal_id);
    const investedTotal=approvedPlans.reduce((a,t)=>a+Number(t.principal_remaining ?? t.amount ?? 0),0);
    const earnedTotal=interestTotal+bonusTotal;
    if(q('investedAmount'))q('investedAmount').textContent=money(investedTotal); if(q('earnedAmount'))q('earnedAmount').textContent=money(earnedTotal);
    if(q('activePlanCount'))q('activePlanCount').textContent=approvedPlans.length;if(q('activePlanLabel'))q('activePlanLabel').textContent=approvedPlans.length?`${approvedPlans.length} approved plan purchase${approvedPlans.length>1?'s':''}`:'No approved plans yet';
    const earnForTx=id=>earnings.filter(e=>String(e.investment_transaction_id)===String(id)).reduce((a,e)=>a+Number(e.earning_amount||0),0);
    const nextEarningForTx=t=>{
      const p=plans.find(x=>String(x.id)===String(t.plan_id));
      const ratePeriod=String(t.earning_rate_period||t.earning_frequency||p?.earning_frequency||'weekly').toLowerCase();
      const mode=String(t.earning_mode||p?.earning_mode||'percentage').toLowerCase();
      const value=Number(t.return_percent ?? t.earning_value ?? p?.earning_value ?? t.monthly_payout_percent ?? 0);
      const rem=Number(t.principal_remaining ?? t.amount ?? 0);
      const due=t.earning_next_at?new Date(t.earning_next_at):new Date(Date.now()+86400000);
      const divisor=ratePeriod==='daily'?1:(ratePeriod==='monthly'?30:7);
      const amount=mode==='fixed'?Math.round((value/divisor)*100)/100:Math.round((rem*(value/divisor)/100)*100)/100;
      return {due,amount,ratePeriod,value,remaining:rem};
    };
    const countdown=q('earningCountdown'), countdownMeta=q('earningCountdownMeta');
    let countdownTimer=null;
    const activeForEarning=approvedPlans.filter(t=>Number(t.principal_remaining ?? t.amount ?? 0)>0);
    const computedCandidates=activeForEarning.map(nextEarningForTx).filter(x=>x.amount>0&&x.due);
    const nextEarn=computedCandidates.sort((a,b)=>a.due-b.due)[0];
    const paintCountdown=()=>{
      if(!countdown||!countdownMeta)return;
      if(!nextEarn){countdown.textContent='No upcoming earning';countdownMeta.innerHTML='<strong>Expected: ₹0</strong>';return;}
      const ms=Math.max(0,nextEarn.due.getTime()-Date.now());
      const total=Math.floor(ms/1000),days=Math.floor(total/86400),hours=Math.floor((total%86400)/3600),mins=Math.floor((total%3600)/60),secs=total%60;
      countdown.textContent=`${days}d ${String(hours).padStart(2,'0')}h ${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;
      countdownMeta.innerHTML=`<strong>Expected daily credit: ${money(nextEarn.amount)}</strong><span style="display:block;font-size:11px;font-weight:500;opacity:.8;margin-top:2px">Next credit: ${nextEarn.due.toLocaleString('en-IN')} • Daily credit</span>`;
      if(ms<=0){
        clearInterval(countdownTimer);
        countdown.textContent='Credit due — processing…';
        countdownMeta.innerHTML=`<strong>Expected daily credit: ${money(nextEarn.amount)}</strong><span style="display:block;font-size:11px;font-weight:500;opacity:.8;margin-top:2px">The daily earning processor will credit this automatically. No page reload required.</span>`;
      }
    };
    paintCountdown();
    if(nextEarn) countdownTimer=setInterval(paintCountdown,1000);

    q('activePlans').innerHTML=approvedPlans.length?approvedPlans.map(t=>{
      const earned=earnForTx(t.id),p=plans.find(x=>String(x.id)===String(t.plan_id));
      const mode=String(t.earning_mode||p?.earning_mode||'percentage'),value=Number(t.earning_value ?? p?.earning_value ?? t.monthly_payout_percent ?? 0),freq=String(t.earning_frequency||p?.earning_frequency||'monthly');
      const term=mode==='fixed'?`${money(value)} ${freq} → daily credit`:`${value}% ${freq} → daily credit`;
      const si=(investmentSummary.investments||[]).find(x=>String(x.id)===String(t.id));
      const rem=Number(si?.principal_remaining ?? t.principal_remaining ?? t.amount);
      const mature=!!si?.is_matured;
      const mat=si?.maturity_at?new Date(si.maturity_at):null;
      const canWithdraw=rem>0 && (mature || Number(investmentSummary.override_amount||0)>0);
      const principalAvailable=Math.max(0,Number(investmentSummary.eligible_amount||0));
      const hasAnyPendingWithdrawal=withdrawals.some(x=>x.status==='pending');
      const principalRequestOpen=canWithdraw && principalAvailable>0 && !hasAnyPendingWithdrawal;
      const principalAlreadyRequested=canWithdraw && (principalAvailable<=0 || hasAnyPendingWithdrawal);
      return `<div class="activePlanCard"><div><span class="planState ${canWithdraw?'isActive':'isActive'}">ACTIVE</span><h3>${esc(t.plan_name||'Investment Plan')}</h3><small>Deposit date: ${dt(t.created_at)} · Payment ID ${esc(t.payment_ref||'—')}</small><div class="planEarnMeta"><span>Invested remaining <b>${money(rem)}</b></span><span>Earned <b>${money(earned)}</b></span><span>Return <b>${esc(term)}</b></span></div>${mat&&!mature?`<small>Investment maturity: ${mat.toLocaleString('en-IN')}</small>`:mature?`<small>Matured: principal can be withdrawn</small>`:''}${principalRequestOpen?`<div style="margin-top:10px"><label style="display:block;max-width:260px">Principal withdrawal (₹)<input class="principalWithdrawAmount" data-tx-id="${esc(t.id)}" type="number" min="1" max="${Math.min(rem,principalAvailable)}" step="0.01" value="" placeholder="Enter amount"></label><button type="button" class="smallBtn principalWithdrawBtn" data-tx-id="${esc(t.id)}">WITHDRAW INVESTED AMOUNT</button><span class="principalWithdrawMsg" data-tx-msg="${esc(t.id)}" style="margin-left:8px"></span></div>`:principalAlreadyRequested?`<div style="margin-top:10px"><button type="button" class="smallBtn" disabled style="opacity:.6;cursor:not-allowed">WITHDRAWAL REQUEST ALREADY SUBMITTED</button><small style="display:block;margin-top:6px">Your currently eligible principal is already under withdrawal request.</small></div>`:''}</div></div>`;
    }).join(''):'<p class="muted">Your approved plan purchase will appear here after admin approval.</p>';

    let referralCode=String(referralCodeResult?.data||'').trim();
    if(!referralCode){
      const fallback=await sb.from('profiles').select('referral_code').eq('id',user.id).maybeSingle();
      referralCode=String(fallback.data?.referral_code||'').trim();
    }
    if(!referralCode && referralCodeResult?.error){ console.warn('Referral code generation failed:',referralCodeResult.error.message); }
    const referralMin=Number(settings.referral_min_deposit||0),referralBonusPercent=Number(settings.referral_bonus_percent ?? 10),referralMessage=String(settings.referral_message||'Share my referral link.').trim();
    const referralLink=referralCode?new URL('./index.html?ref='+encodeURIComponent(referralCode),location.href).href:'';
    if(q('referralCode'))q('referralCode').value=referralCode||'Referral setup pending';if(q('referralLink'))q('referralLink').value=referralLink||'Referral link unavailable — run the referral setup SQL.';if(q('referralBonusLabel'))q('referralBonusLabel').textContent=Number.isFinite(referralBonusPercent)?`${referralBonusPercent}% BONUS`:'BONUS';
    if(q('referralText'))q('referralText').innerHTML=`<strong>${esc(referralMessage)}</strong><br><small>Minimum qualifying deposit: ${money(referralMin)} • Referral bonus: ${Number.isFinite(referralBonusPercent)?referralBonusPercent:0}% of the first qualifying approved investment after admin approval.</small>`;
    if(q('shareReferral'))q('shareReferral').onclick=()=>{if(!referralLink){alert('Referral link is not ready.');return;}window.open('https://wa.me/?text='+encodeURIComponent(referralMessage+'\n\n'+referralLink),'_blank','noopener');};if(q('referralLink'))q('referralLink').onclick=e=>e.target.select();

    const planList=q('planList');planList.innerHTML='';const waNumber=(settings.whatsapp_number||'').replace(/\D/g,'');
    plans.forEach(p=>{const d=document.createElement('div');d.className='miniPlan';d.innerHTML=`<div><b class="planAmount">${money(p.minimum_amount)}</b><strong class="planTitle" style="display:block;margin-top:3px">${esc(p.name||'Investment Plan')}</strong><span class="planPayout">${esc(p.earning_mode==='fixed'?money(p.earning_value):String(p.earning_value ?? p.monthly_payout_percent ?? 0)+'%')} ${esc(p.earning_frequency||'monthly')} earning</span></div><div class="planActions"><button class="selectPlan">Select</button><a class="payBtn dashBuy" href="payment.html?plan=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name||'Investment Plan')}&amount=${encodeURIComponent(p.minimum_amount)}${referralCode?'&ref='+encodeURIComponent(referralCode):''}">DIRECT BUY →</a>${waNumber?`<a class="miniSocial whatsapp" href="https://wa.me/${waNumber}?text=${encodeURIComponent('Hello, I want to invest '+money(p.minimum_amount)+' in '+(p.name||'Investment Plan')+'.')}" target="_blank">◉</a>`:''}</div>`;planList.appendChild(d);d.querySelector('.selectPlan').onclick=async()=>{const b=d.querySelector('.selectPlan');b.disabled=true;b.textContent='SAVING…';const {error}=await sb.from('investment_enquiries').insert({user_id:user.id,plan_id:p.id,customer_name:name,phone:activeProfile?.phone||'',email:user.email||null,investment_amount:p.minimum_amount,message:'Investment plan enquiry'});if(error)alert(error.message);else alert('Investment enquiry submitted successfully.');b.disabled=false;b.textContent='Select';};});

    let banks=Array.isArray(bankRes.data)?bankRes.data:[];
    let bank=banks[0]||null;
    {
      q('activePlans').querySelectorAll('.principalWithdrawBtn').forEach(btn=>btn.onclick=async()=>{
        const txId=btn.dataset.txId, wrap=btn.closest('.activePlanCard'), input=wrap?.querySelector('.principalWithdrawAmount'), msg=wrap?.querySelector(`[data-tx-msg="${txId}"]`);
        const amount=Number(input?.value||0);
        const selectedBank=banks.find(b=>String(b.id)===String(q('withdrawBankAccount')?.value))||null;if(!selectedBank){if(msg)msg.textContent='Select a bank account first.';return;}
        if(!Number.isFinite(amount)||amount<=0){if(msg)msg.textContent='Enter a valid amount.';return;}
        if(!confirm(`Request withdrawal of ${money(amount)} from invested principal?`))return;
        btn.disabled=true;btn.textContent='SUBMITTING…';
        const r=await sb.rpc('request_matured_investment_withdrawal',{p_investment_transaction_id:txId,p_amount:amount,p_bank_account_id:selectedBank.id,p_customer_note:'Customer requested matured investment principal withdrawal'});
        if(r.error){if(msg){msg.className='principalWithdrawMsg error';msg.textContent=r.error.message||'Unable to request principal withdrawal.';}if(String(r.error.message||'').toLowerCase().includes('already have a pending withdrawal request')){btn.disabled=true;btn.textContent='WITHDRAWAL REQUEST PENDING';return;}}
        else{if(input)input.value='';if(msg)msg.textContent='Principal withdrawal request submitted for admin approval.';setTimeout(()=>location.reload(),700);}
        btn.disabled=false;btn.textContent='WITHDRAW INVESTED AMOUNT';
      });
    }
    const bankModal=q('bankModal'), openBankModal=q('openBankModal'), bankSavedCard=q('bankSavedCard'), bankStatus=q('bankStatus'), bankAccountsList=q('bankAccountsList'), withdrawBankAccount=q('withdrawBankAccount');
    const closeBankModal=()=>{if(bankModal){bankModal.classList.remove('open');bankModal.setAttribute('aria-hidden','true');}};
    const maskedBank=a=>a?('•••• •••• '+String(a).slice(-4)):'—';
    const bankLabel=b=>`${b.bank_name||'Bank'} • ${maskedBank(b.account_number)} • ${b.ifsc_code||''}`;
    const renderBankSelect=()=>{
      if(!withdrawBankAccount)return;
      const current=withdrawBankAccount.value;
      withdrawBankAccount.innerHTML=banks.length?banks.map(b=>`<option value="${esc(b.id)}">${esc(bankLabel(b))}</option>`).join(''):'<option value="">Add a bank account first</option>';
      if(current && banks.some(b=>String(b.id)===String(current))) withdrawBankAccount.value=current;
      else if(bank) withdrawBankAccount.value=String(bank.id);
    };
    const renderSavedBank=()=>{
      if(!banks.length){
        if(bankStatus) bankStatus.textContent='NOT ADDED';
        if(bankSavedCard){bankSavedCard.hidden=true;bankSavedCard.innerHTML='';}
        if(bankAccountsList)bankAccountsList.innerHTML='';
        if(openBankModal){openBankModal.hidden=false;openBankModal.disabled=false;}
        renderBankSelect(); return;
      }
      if(bankStatus){bankStatus.textContent=`${banks.length} ACCOUNT${banks.length>1?'S':''} SAVED`;bankStatus.classList.add('bankSavedPill');}
      if(openBankModal){openBankModal.hidden=false;openBankModal.disabled=false;}
      if(bankAccountsList){
        bankAccountsList.innerHTML=banks.map((b,i)=>`<div class="bankSavedCard"><div class="bankSavedTop"><div><span>ACCOUNT HOLDER</span><b>${esc(b.account_holder_name||'—')}</b></div><strong>✓ VERIFIED</strong></div><div class="bankSavedGrid"><div><small>BANK</small><b>${esc(b.bank_name||'—')}</b></div><div><small>ACCOUNT NUMBER</small><b class="monoText">${esc(maskedBank(b.account_number))}</b></div><div><small>IFSC CODE</small><b class="monoText">${esc(b.ifsc_code||'—')}</b></div><div><small>BRANCH</small><b>${esc(b.branch_name||'—')}</b></div></div><p class="bankLockedNote">🔒 Bank details are locked after saving and cannot be edited.</p></div>`).join('');
      }
      if(bankSavedCard)bankSavedCard.hidden=true;
      renderBankSelect();
    };
    renderSavedBank();
    document.querySelectorAll('[data-close-bank-modal]').forEach(el=>el.addEventListener('click',closeBankModal));
    if(openBankModal)openBankModal.onclick=()=>{bankModal.classList.add('open');bankModal.setAttribute('aria-hidden','false');setTimeout(()=>q('bankHolder')?.focus(),50);};
    const ifscInput=q('bankIfsc'), verifyIfsc=q('verifyIfsc'), ifscStatus=q('ifscStatus'), bankName=q('bankName'), bankBranch=q('bankBranch'), saveBank=q('saveBank');
    let verifiedIfsc='';
    const validIfsc=v=>/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v||'').trim().toUpperCase());
    const setIfscStatus=(text,ok=false)=>{if(ifscStatus){ifscStatus.textContent=text;ifscStatus.className='ifscStatus '+(ok?'ok':'bad');}};
    const setSaveReady=ready=>{if(saveBank)saveBank.disabled=!ready;};
    if(ifscInput)ifscInput.addEventListener('input',()=>{ifscInput.value=ifscInput.value.toUpperCase().replace(/\s/g,'');verifiedIfsc='';setSaveReady(false);setIfscStatus(validIfsc(ifscInput.value)?'Click VERIFY IFSC to check this code online.':'IFSC must be 11 characters, e.g. SBIN0001234.');});
    if(verifyIfsc)verifyIfsc.onclick=async()=>{const code=ifscInput?.value.trim().toUpperCase()||'';if(!validIfsc(code)){setIfscStatus('Enter a valid 11-character IFSC code.',false);return;}verifyIfsc.disabled=true;verifyIfsc.textContent='VERIFYING…';setIfscStatus('Checking IFSC online…');try{const res=await fetch('https://ifsc.razorpay.com/'+encodeURIComponent(code),{headers:{Accept:'application/json'}});if(!res.ok)throw new Error();const data=await res.json();if(!data?.BANK)throw new Error();bankName.value=String(data.BANK||'').trim();bankBranch.value=String(data.BRANCH||'').trim();verifiedIfsc=code;setIfscStatus(`✓ Verified online • ${data.BANK}${data.BRANCH?' • '+data.BRANCH:''}`,true);setSaveReady(true);}catch(err){verifiedIfsc='';setSaveReady(false);setIfscStatus('✕ IFSC could not be verified online. Check the code and try again.',false);bankName.value='';bankBranch.value='';}verifyIfsc.disabled=false;verifyIfsc.textContent='VERIFY IFSC';};
    q('bankForm').onsubmit=async e=>{e.preventDefault();const btn=q('saveBank'),msg=q('bankMsg');const holder=q('bankHolder').value.trim(),acc=q('bankAccount').value.replace(/\s/g,''),confirmAcc=q('bankAccountConfirm').value.replace(/\s/g,''),ifsc=q('bankIfsc').value.trim().toUpperCase(),bn=q('bankName').value.trim(),branch=q('bankBranch').value.trim();if(!/^[A-Za-z][A-Za-z .'-]{2,79}$/.test(holder)){msg.textContent='Enter a valid account holder name.';return;}if(!/^[0-9]{9,20}$/.test(acc)){msg.textContent='Enter a valid account number (9–20 digits).';return;}if(acc!==confirmAcc){msg.textContent='Account numbers do not match.';return;}if(!validIfsc(ifsc)||verifiedIfsc!==ifsc){msg.textContent='Please verify the IFSC code online before saving.';return;}if(!bn){msg.textContent='Verified bank name is required.';return;}if(banks.some(b=>String(b.account_number)===acc)){msg.textContent='This bank account is already saved.';return;}btn.disabled=true;btn.textContent='SAVING…';msg.textContent='';const {data:saved,error}=await sb.from('bank_accounts').insert({user_id:user.id,account_holder_name:holder,bank_name:bn,account_number:acc,ifsc_code:ifsc,branch_name:branch,updated_at:new Date().toISOString()}).select('*').single();if(error){msg.textContent='Could not save bank account: '+error.message;btn.disabled=false;btn.textContent='SAVE BANK ACCOUNT';return;}banks=[saved,...banks];bank=banks[0];msg.textContent='Bank account saved successfully.';renderSavedBank();q('bankForm').reset();verifiedIfsc='';setSaveReady(false);setTimeout(closeBankModal,500);btn.disabled=false;btn.textContent='SAVE BANK ACCOUNT';};
    q('withdrawForm').onsubmit=async e=>{e.preventDefault();const btn=q('requestWithdraw'),msg=q('withdrawMsg');const amount=Number(q('withdrawAmount').value),note=q('withdrawNote').value.trim();const selectedBank=banks.find(b=>String(b.id)===String(q('withdrawBankAccount')?.value))||null;if(!selectedBank){msg.textContent='Please select a bank account first.';return;}if(!Number.isFinite(amount)||amount<=0){msg.textContent='Enter a valid amount.';return;}if(amount>balance){msg.textContent='Amount is higher than your available wallet balance.';return;}btn.disabled=true;btn.textContent='SUBMITTING…';const {error}=await sb.rpc('request_withdrawal',{p_bank_account_id:selectedBank.id,p_amount:amount,p_customer_note:note||null});if(error)msg.textContent=error.message;else{msg.textContent='Withdrawal request submitted. Admin approval is required.';q('withdrawAmount').value='';q('withdrawNote').value='';setTimeout(()=>location.reload(),500);}btn.disabled=false;btn.textContent='REQUEST WITHDRAWAL →';};

    const masked=(a)=>a?('•••• '+String(a).slice(-4)):'—';
    q('withdrawals').innerHTML=withdrawals.length?withdrawals.map(w=>`<div class="withdrawRow"><div><b>${money(w.amount)} · ${esc(w.status)}</b><small>${dt(w.requested_at)} · ${esc(w.bank_accounts?.bank_name||'Bank')} · ${masked(w.bank_accounts?.account_number)}</small>${w.review_reason?`<small class="reviewReason"><b>Admin:</b> ${esc(w.review_reason)}</small>`:''}${w.transaction_id?`<small>Transaction ID: ${esc(w.transaction_id)}</small>`:''}</div><span class="planState ${w.status==='approved'?'isActive':w.status==='rejected'?'isInactive':''}">${esc(w.status)}</span></div>`).join(''):'<p class="muted">No withdrawal requests yet.</p>';

    const walletRows=[...walletTxs.map(t=>({date:t.created_at,amount:Number(t.amount||0),source:String(t.source_type||''),description:t.description||t.source_type||'Wallet transaction',id:t.id})),...referralRewards.filter(r=>!representedBonusIds.has(String(r.id))).map(r=>({date:r.created_at,amount:Number(r.bonus_amount||0),source:'referral_bonus',description:'Referral bonus • '+(r.referred_customer_name||'Referred customer'),id:'reward-'+r.id}))].sort((a,b)=>new Date(b.date)-new Date(a.date));
    const interestRows=earnings.map(e=>({date:e.scheduled_for||e.created_at,amount:Number(e.earning_amount||0),source:'interest_earning',description:'Daily interest earning • '+(e.plan_id?'Investment plan':'Plan'),id:e.id}));
    const bonusRows=referralRewards.map(r=>({date:r.created_at,amount:Number(r.bonus_amount||0),source:'referral_bonus',description:'Referral bonus • '+(r.referred_customer_name||'Referred customer'),id:r.id}));
    const statementRows=[...walletRows.map(r=>{const category=r.source.toLowerCase().includes('referral')?'Referral Bonus':(r.source.toLowerCase().includes('earning')?'Interest Earning':'Wallet');return {...r,category};}),...withdrawals.filter(w=>w.status==='approved').map(w=>({date:w.reviewed_at||w.requested_at,amount:-Number(w.amount||0),source:'withdrawal',description:'Approved withdrawal',id:w.id,category:'Withdrawal'}))].sort((a,b)=>new Date(b.date)-new Date(a.date));
    const renderRows=rows=>rows.length?rows.map(r=>`<div class="enquiry walletStatementRow"><span><b>${esc(r.description)}</b><br><small>${dt(r.date)}${r.category?' · '+esc(r.category):''}</small></span><strong class="${Number(r.amount)>=0?'creditText':'debitText'}">${Number(r.amount)>=0?'+':'-'}${money(Math.abs(Number(r.amount)))}</strong></div>`).join(''):'<p class="muted">No records yet.</p>';
    if(q('walletTransactions'))q('walletTransactions').innerHTML=`<div class="walletBreakdown"><div><small>WALLET BALANCE</small><b>${money(walletOnly)}</b></div><div><small>INTEREST EARNED</small><b>${money(interestTotal)}</b></div><div><small>REFERRAL BONUS</small><b>${money(bonusTotal)}</b></div></div><div class="walletStatementActions"><button type="button" class="smallBtn" id="openWalletStatement">VIEW DETAILED SOA</button><button type="button" class="smallBtn secondaryBtn" id="downloadWalletSoa">DOWNLOAD SOA</button></div><div class="walletHistoryTabs"><button type="button" class="walletTab active" data-wallet-tab="all">All</button><button type="button" class="walletTab" data-wallet-tab="interest">Interest</button><button type="button" class="walletTab" data-wallet-tab="bonus">Referral Bonus</button></div><div id="walletHistoryRows">${renderRows(statementRows)}</div>`;
    const statementData={name,email:user.email||'',generated:new Date(),walletBalance:walletOnly,interestTotal,bonusTotal,principalEligible,rows:statementRows};
    const buildSoaHtml=()=>{const rows=statementData.rows.map(r=>`<tr><td>${esc(dt(r.date))}</td><td>${esc(r.category||'Wallet')}</td><td>${esc(r.description)}</td><td style="text-align:right">${Number(r.amount)>=0?'+':'-'}${money(Math.abs(Number(r.amount)))}</td></tr>`).join('');return `<!doctype html><html><head><meta charset="utf-8"><title>CHIPSET Statement of Account</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#10243a}h1{margin-bottom:4px}.muted{color:#6b7c8d}.cards{display:flex;gap:12px;margin:24px 0}.card{border:1px solid #d9e3ec;border-radius:10px;padding:14px;flex:1}.card b{display:block;font-size:20px;margin-top:6px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #e5ebf0;text-align:left;font-size:12px}@media print{button{display:none}}</style></head><body><h1>CHIPSET — Statement of Account</h1><div class="muted">Customer: ${esc(statementData.name)} · ${esc(statementData.email)}<br>Generated: ${esc(dt(statementData.generated))}</div><div class="cards"><div class="card">Wallet Balance<b>${money(statementData.walletBalance)}</b></div><div class="card">Interest Earned<b>${money(statementData.interestTotal)}</b></div><div class="card">Referral Bonus<b>${money(statementData.bonusTotal)}</b></div><div class="card">Principal Eligible<b>${money(statementData.principalEligible)}</b></div></div><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${rows||'<tr><td colspan="4">No wallet activity</td></tr>'}</tbody></table><p class="muted">This statement is generated from the wallet, daily interest, referral bonus and withdrawal records available in the customer account.</p></body></html>`;};
    const downloadSoa=async()=>{
      const fileName='CHIPSET-SOA-'+name.replace(/[^A-Za-z0-9]+/g,'-')+'.pdf';
      if(!window.jspdf?.jsPDF){
        alert('PDF generator is still loading. Please click DOWNLOAD SOA again in a moment.');
        return;
      }
      const {jsPDF}=window.jspdf;
      const doc=new jsPDF({unit:'pt',format:'a4'});
      const left=40,right=555,width=515;
      let y=42;
      const line=(text,size=10,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.text(String(text),left,y);y+=size+7;};
      doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text('CHIPSET — Statement of Account',left,y);y+=25;
      doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text('Customer: '+String(name||'-'),left,y);y+=15;doc.text('Email: '+String(user.email||'-'),left,y);y+=15;doc.text('Generated: '+dt(statementData.generated),left,y);y+=25;
      const cards=[['Wallet Balance',statementData.walletBalance],['Interest Earned',statementData.interestTotal],['Referral Bonus',statementData.bonusTotal],['Principal Eligible',statementData.principalEligible]];
      const cw=123,ch=48;
      cards.forEach((c,i)=>{const x=left+i*(cw+7);doc.rect(x,y,cw,ch);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(c[0],x+8,y+15);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text(money(c[1]),x+8,y+34);});
      y+=68;
      doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('Date',left,y);doc.text('Category',left+105,y);doc.text('Description',left+195,y);doc.text('Amount',right,y,{align:'right'});y+=8;doc.line(left,y,right,y);y+=16;
      doc.setFont('helvetica','normal');doc.setFontSize(8.5);
      const wrap=(text,max)=>doc.splitTextToSize(String(text||''),max);
      const rows=statementData.rows||[];
      if(!rows.length){doc.text('No wallet activity',left,y);y+=16;}
      rows.forEach(r=>{
        const desc=wrap(r.description||'Wallet transaction',150), cat=wrap(r.category||'Wallet',80);
        const rowH=Math.max(18,Math.max(desc.length,cat.length)*10+4);
        if(y+rowH>805){doc.addPage();y=42;doc.setFont('helvetica','bold');doc.text('CHIPSET — Statement of Account (continued)',left,y);y+=25;doc.setFont('helvetica','normal');}
        doc.text(String(dt(r.date||'')),left,y,{maxWidth:95});doc.text(cat,left+105,y);doc.text(desc,left+195,y);doc.text((Number(r.amount)>=0?'+':'-')+money(Math.abs(Number(r.amount||0))),right,y,{align:'right'});y+=rowH;
        doc.setDrawColor(225,230,235);doc.line(left,y-5,right,y-5);doc.setDrawColor(0,0,0);
      });
      if(y>760){doc.addPage();y=42;}
      doc.setFont('helvetica','italic');doc.setFontSize(8);doc.text('Generated from wallet, daily interest, referral bonus and withdrawal records available in the customer account.',left,y,{maxWidth:width});
      doc.save(fileName);
    };
    q('downloadWalletSoa')?.addEventListener('click',downloadSoa);
    q('openWalletStatement')?.addEventListener('click',()=>{const w=window.open('','_blank','width=1100,height=800');if(w){w.document.write(buildSoaHtml());w.document.close();}});
    document.querySelectorAll('[data-wallet-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-wallet-tab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');const tab=btn.dataset.walletTab;const rows=tab==='interest'?interestRows:tab==='bonus'?bonusRows:statementRows;if(q('walletHistoryRows'))q('walletHistoryRows').innerHTML=renderRows(rows.map(r=>({...r,category:r.source==='interest_earning'?'Interest Earning':r.source==='referral_bonus'?'Referral Bonus':'Wallet'})));}));

    q('transactions').innerHTML=txs.length?txs.map(t=>{const plan=t.plan_id&&!t.withdrawal_id;const label=plan?'Plan Purchase':(t.payment_method==='bank_withdrawal'?'Withdrawal':(t.note||'Payment'));const cls=plan?'neutralText':(t.type==='credit'?'creditText':'debitText');return `<div class="enquiry"><span><b>${esc(label)}</b><br><small>${dt(t.created_at)} · ${esc(t.status)} · ${esc(t.payment_ref||'')}</small>${t.note?`<br><small>${esc(t.note)}</small>`:''}</span><strong class="${cls}">${plan?'₹'+Number(t.amount||0).toLocaleString('en-IN'):(t.type==='credit'?'+':'-')+'₹'+Number(t.amount||0).toLocaleString('en-IN')}</strong></div>`}).join(''):'<p class="muted">No plan/payment history yet.</p>';

    if(q('enquiryCount'))q('enquiryCount').textContent=enquiries.length;if(q('emptyLabel'))q('emptyLabel').textContent=enquiries.length?`${enquiries.length} record(s)`:'No enquiries yet';const eb=q('enquiries');eb.innerHTML=enquiries.length?enquiries.map(x=>`<div class="enquiry"><span><b>${esc(x.investment_plans?.name||'Investment Plan')}</b><br><small>${new Date(x.created_at).toLocaleDateString('en-IN')} · ${esc(x.status||'pending')}</small></span><strong>${money(x.investment_amount)}</strong></div>`).join(''):'<p class="muted">No enquiries yet.</p>';

  }catch(err){console.error(err);showError(err?.message||'Unable to load dashboard.');}
})();
