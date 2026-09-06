(async function(){
  const params=new URLSearchParams(location.search), planId=params.get('plan')||'', referralCode=(params.get('ref')||sessionStorage.getItem('chipset_referral_code')||'').trim();
  if(referralCode) try{sessionStorage.setItem('chipset_referral_code',referralCode)}catch(e){}
  const q=id=>document.getElementById(id);
  let plan={id:planId,name:params.get('name')||'Investment Plan',minimum_amount:Number(params.get('amount')||0)};
  q('planName').textContent=plan.name;
  q('amount').textContent='₹'+plan.minimum_amount.toLocaleString('en-IN',{maximumFractionDigits:2});
  let settings={};
  let dbPlan=null;
  try{
    if(window.sb){
      const [settingsRes,planRes]=await Promise.all([
        sb.from('site_settings').select('key,value'),
        planId?sb.from('investment_plans').select('id,name,minimum_amount,earning_mode,earning_value,earning_frequency,earning_periods,monthly_payout_percent,active').eq('id',planId).maybeSingle():Promise.resolve({data:null,error:null})
      ]);
      (settingsRes.data||[]).forEach(x=>settings[x.key]=x.value);
      dbPlan=planRes.data||null;
      if(dbPlan){ plan={id:dbPlan.id,name:dbPlan.name||'Investment Plan',minimum_amount:Number(dbPlan.minimum_amount||0)}; }
      const terms=q('planTermsText');
      if(terms){
        if(dbPlan){
          const mode=String(dbPlan.earning_mode||'percentage').toLowerCase();
          const value=Number(dbPlan.earning_value ?? dbPlan.monthly_payout_percent ?? 0);
          const freq=String(dbPlan.earning_frequency||'weekly').toLowerCase();
          const periods=Number(dbPlan.earning_periods||0);
          terms.textContent=mode==='fixed'?`Earning: ₹${value.toLocaleString('en-IN',{maximumFractionDigits:2})} ${freq}${periods?` • ${periods} period(s)`:''} • Final terms are recorded when payment is approved.`:`Return: ${value}% ${freq}${periods?` • ${periods} period(s)`:''} • Final terms are recorded when payment is approved. Returns are not guaranteed.`;
        }else terms.textContent='Selected plan details could not be loaded. Please return to the plans page and select an active plan.';
      }
    }
  }catch(e){console.warn(e)}
  const upiId=settings.business_upi_id||window.CHIPSET_UPI_ID||'9101416423@okbizaxis';
  const paymentName=settings.payment_name||window.CHIPSET_PAYMENT_NAME||'Chipset';
  const waNumber=(settings.whatsapp_number||window.CHIPSET_WHATSAPP_NUMBER||'7739325562').replace(/\D/g,'');
  const upiUrl=`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(paymentName)}&am=${encodeURIComponent(plan.minimum_amount.toFixed(2))}&cu=INR&tn=${encodeURIComponent('Investment - '+plan.name)}`;
  q('upiIdText').textContent=upiId;
  const ref='CHIP-'+Math.random().toString(36).slice(2,8).toUpperCase()+Date.now().toString().slice(-4);
  const refEl=document.getElementById('paymentRef'); if(refEl) refEl.textContent=ref;
  q('upiQr').src='https://api.qrserver.com/v1/create-qr-code/?size=360x360&data='+encodeURIComponent(upiUrl);
  q('upiPay').onclick=()=>{location.href=upiUrl;};
  const upiAppBtn=q('upiAppPay'); if(upiAppBtn){upiAppBtn.onclick=()=>{ window.location.href=upiUrl; }; upiAppBtn.setAttribute('data-upi-url',upiUrl);}
  q('copyUpi').onclick=async()=>{try{await navigator.clipboard.writeText(upiId);q('copyUpi').textContent='COPIED';setTimeout(()=>q('copyUpi').textContent='COPY',1200)}catch(e){alert('UPI ID: '+upiId)}};
  q('payWhatsapp').href=`https://wa.me/${waNumber}?text=`+encodeURIComponent(`Hello ${paymentName}, I want to invest ${q('amount').textContent} in ${plan.name}.`);
  // Logged-in buyers get their account details pre-filled; guests stay blank.
  try {
    const {data:{user}}=window.sb?await sb.auth.getUser():{data:{user:null}};
    if(user){
      const {data:profile}=await sb.from('profiles').select('full_name,phone').eq('id',user.id).maybeSingle();
      q('customerName').value=profile?.full_name||user.user_metadata?.full_name||'';
      q('customerPhone').value=profile?.phone||user.user_metadata?.phone||'';
      q('customerEmail').value=user.email||'';
      const notice=q('loggedInNotice');
      if(notice){notice.style.display='block';notice.innerHTML='Logged in as <b>'+String(user.email||'customer').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))+'</b>. Your account details have been filled automatically.';}
    }
  } catch(e) { console.warn('Profile autofill skipped:',e); }
  q('paymentProofForm').onsubmit=async e=>{
    e.preventDefault(); const msg=q('proofMsg'),btn=q('submitProof');btn.disabled=true;btn.textContent='SUBMITTING…';msg.textContent='';
    const name=q('customerName').value.trim(),phone=q('customerPhone').value.trim(),email=q('customerEmail').value.trim(),file=q('slip').files[0],utr=q('utr').value.trim(),note=q('paymentNote').value.trim(),termsAccepted=!!q('termsAccepted')?.checked;
    if(!termsAccepted){msg.textContent='Please confirm that you have reviewed the plan details and risk disclosure.';btn.disabled=false;btn.textContent='SUBMIT PAYMENT PROOF →';return;}if(!name){msg.textContent='Enter customer name.';btn.disabled=false;btn.textContent='SUBMIT PAYMENT PROOF →';return;}
    if(!/^[6-9][0-9]{9}$/.test(phone)){msg.textContent='Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';btn.disabled=false;btn.textContent='SUBMIT PAYMENT PROOF →';return;}
    if(!file){msg.textContent='Please upload your payment screenshot.';btn.disabled=false;btn.textContent='SUBMIT PAYMENT PROOF →';return;}
    if(file.size>8*1024*1024){msg.textContent='Screenshot must be 8 MB or smaller.';btn.disabled=false;btn.textContent='SUBMIT PAYMENT PROOF →';return;}
    try{
      if(!planId || !dbPlan || dbPlan.active === false){throw new Error('Selected investment plan is unavailable. Please return to the plans page and choose an active plan.');}
      const {data:{user}}=window.sb?await sb.auth.getUser():{data:{user:null}};
      const txId=crypto.randomUUID();
      const acceptedAt=new Date().toISOString();
      const dbMode=String(dbPlan.earning_mode||'percentage').toLowerCase();
      const dbValue=Number(dbPlan.earning_value ?? dbPlan.monthly_payout_percent ?? 0);
      const dbFreq=String(dbPlan.earning_frequency||'weekly').toLowerCase();
      const dbPeriods=Number(dbPlan.earning_periods||0);
      const payload={id:txId,payment_ref:ref,user_id:user?.id||null,customer_name:name,phone,email:email||null,plan_id:plan.id||null,plan_name:plan.name,amount:plan.minimum_amount,type:'debit',status:'pending',payment_method:'upi_manual',utr:utr||null,note:note||null,referral_code:referralCode||null,earning_mode:dbMode,earning_value:dbValue,earning_frequency:dbFreq,earning_periods:dbPeriods,earning_rate_period:dbFreq,terms_accepted:true,terms_accepted_at:acceptedAt,terms_version:'V1.0'};
      const {error}=await sb.from('investment_transactions').insert(payload);if(error)throw error;
      const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
      const folder=user?.id||'guest',path=`${folder}/${txId}.${ext}`;
      const {error:upErr}=await sb.storage.from('payment-slips').upload(path,file,{upsert:false,contentType:file.type||'image/jpeg'});if(upErr){await sb.from('investment_transactions').delete().eq('id',txId);throw upErr;}
      const {error:up2}=await sb.from('investment_transactions').update({slip_path:path}).eq('id',txId);if(up2)throw up2;
      msg.innerHTML='Payment proof submitted. <b>Save your Payment ID: '+ref+'</b>. Your payment is pending admin verification. <a href="track-payment.html">Track Payment</a>';q('paymentProofForm').reset();
    }catch(err){msg.textContent='Unable to submit payment proof: '+(err?.message||err);}
    btn.disabled=false;btn.textContent='SUBMIT PAYMENT PROOF →';
  };
})();
