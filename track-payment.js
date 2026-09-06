(function(){
 const form=document.getElementById('trackForm'), msg=document.getElementById('trackMsg'), result=document.getElementById('trackResult'), btn=document.getElementById('trackBtn');
 const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
 const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 form?.addEventListener('submit',async e=>{
  e.preventDefault(); msg.textContent=''; result.innerHTML=''; btn.disabled=true; btn.textContent='CHECKING…';
  const ref=document.getElementById('paymentRef').value.trim().toUpperCase(), phone=document.getElementById('phone').value.trim();
  if(!ref && !phone){msg.textContent='Enter either your Payment ID or Phone Number.';btn.disabled=false;btn.textContent='CHECK STATUS →';return;}
  if(ref && !/^CHIP-[A-Z0-9]{10}$/.test(ref)){msg.textContent='Enter a valid Payment ID.';btn.disabled=false;btn.textContent='CHECK STATUS →';return;}
  if(phone && !/^\d{10}$/.test(phone)){msg.textContent='Enter a valid 10-digit phone number.';btn.disabled=false;btn.textContent='CHECK STATUS →';return;}
  try{
   if(!window.sb) throw new Error('Supabase is not connected.');
   const {data,error}=await sb.rpc('track_guest_payment',{p_payment_ref:ref||null,p_phone:phone||null});
   if(error) throw error;
   const rows=Array.isArray(data)?data:[data].filter(Boolean);
   if(!rows.length){msg.textContent='No payment found. Check the Payment ID or phone number.';return;}
   result.innerHTML=rows.map(t=>{
     const status=String(t.status||'pending').toLowerCase();
     const label=status==='approved'?'Approved':status==='rejected'?'Rejected':'Pending Verification';
     return `<div class="enquiry" style="margin-top:18px"><div><b>${esc(label)}</b><br><small>Payment ID: ${esc(t.payment_ref)}</small><br><small>${esc(t.plan_name||'Investment')} · ${money(t.amount)}</small><br><small>Submitted: ${t.created_at?new Date(t.created_at).toLocaleString('en-IN'):'-'}</small>${t.note?`<br><small>${esc(t.note)}</small>`:''}</div><span class="pill">${esc(status.toUpperCase())}</span></div>`;
   }).join('');
  }catch(err){msg.textContent='Unable to check payment: '+(err?.message||err);}finally{btn.disabled=false;btn.textContent='CHECK STATUS →';}
 });
})();
