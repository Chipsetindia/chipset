// Keep the public home page usable for guests while showing a logged-in experience for customers.
(async function syncHomeForLoggedUser(){
  if(!window.sb) return;
  try{
    const {data:{user}}=await sb.auth.getUser();
    const right=document.querySelector('.siteHeader .nav > div:last-of-type');
    if(!user || !right) return;
    const {data:profile}=await sb.from('profiles').select('role,full_name').eq('id',user.id).maybeSingle();
    if(profile?.role==='admin'){
      right.innerHTML='<a class="outline" href="admin.html" style="padding:9px 12px">ADMIN PANEL</a><button class="btn" id="homeLogout">LOGOUT</button>';
    }else{
      right.innerHTML='<a class="outline" href="dashboard.html" style="padding:9px 12px">MY DASHBOARD</a><button class="btn" id="homeLogout">LOGOUT</button>';
    }
    document.querySelectorAll('.hero .actions a[href="register.html"]').forEach(a=>{a.textContent='OPEN DASHBOARD →';a.href=profile?.role==='admin'?'admin.html':'dashboard.html';});
    const earnBtn=document.getElementById('earnCardButton'); if(earnBtn){earnBtn.textContent='OPEN DASHBOARD →';earnBtn.href=profile?.role==='admin'?'admin.html':'dashboard.html';}
    document.querySelectorAll('footer a[href="login.html"], footer a[href="register.html"]').forEach(a=>{a.style.display='none';});
    document.getElementById('homeLogout')?.addEventListener('click',async()=>{
  try{await Promise.race([sb.auth.signOut({scope:'local'}),new Promise(r=>setTimeout(r,1200))]);}catch(e){}
  try{Object.keys(localStorage).filter(k=>k.toLowerCase().includes('supabase')).forEach(k=>localStorage.removeItem(k));}catch(e){}
  location.replace('index.html');
});
  }catch(e){console.warn('Home auth sync:',e);}
})();
document.getElementById("hamb")?.addEventListener("click",()=>{const nav=document.getElementById('publicNav');nav?.classList.toggle('mobileOpen');});

const contactForm=document.getElementById("contactForm");
const contactMsg=document.getElementById("msg");

// For logged-in customers, prefill identity details from their account and
// keep them read-only. Only the enquiry message remains editable.
(async function lockLoggedInContactDetails(){
  if(!contactForm || !window.sb) return;
  try{
    const {data:{user}}=await sb.auth.getUser();
    if(!user) return;
    let {data:profile}=await sb.from('profiles').select('full_name,phone,email').eq('id',user.id).maybeSingle();
    profile=profile||{};
    const fields={
      name: profile.full_name || user.user_metadata?.full_name || '',
      email: profile.email || user.email || '',
      phone: profile.phone || user.user_metadata?.phone || ''
    };
    ['name','email','phone'].forEach(key=>{
      const el=contactForm.querySelector(`[name="${key}"]`);
      if(!el) return;
      if(fields[key]) el.value=fields[key];
      el.readOnly=true;
      el.setAttribute('aria-readonly','true');
      el.title='Account details cannot be edited here';
    });
  }catch(e){
    console.warn('Logged-in contact form autofill:',e);
  }
})();

contactForm?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!window.sb){
    if(contactMsg) contactMsg.textContent="Supabase is not connected. Please check assets/supabase-config.js.";
    return;
  }

  const button=contactForm.querySelector("button");
  const name=contactForm.querySelector('input[name="name"]')?.value.trim() || contactForm.querySelector('input[type="text"]')?.value.trim() || "";
  const email=contactForm.querySelector('input[name="email"]')?.value.trim().toLowerCase() || contactForm.querySelector('input[type="email"]')?.value.trim().toLowerCase() || "";
  const phone=contactForm.querySelector('input[name="phone"]')?.value.trim() || "";
  const message=contactForm.querySelector('textarea[name="message"]')?.value.trim() || contactForm.querySelector("textarea")?.value.trim() || "";

  if(!name || !email || !phone || !message){
    if(contactMsg) contactMsg.textContent="Please fill in all fields, including your phone number.";
    return;
  }

  if(button){button.disabled=true;button.textContent="SENDING…";}
  if(contactMsg) contactMsg.textContent="";

  try{
    const {data:{user}}=await sb.auth.getUser();
    const enquiry={
      user_id:user?.id || null,
      plan_id:null,
      customer_name:name,
      phone:phone,
      email:email,
      investment_amount:1,
      message:message,
      status:"pending"
    };

    const {error}=await sb.from("investment_enquiries").insert(enquiry);
    if(error) throw error;

    if(contactMsg) contactMsg.textContent="Thank you. Your enquiry has been submitted successfully.";
    contactForm.reset();
  }catch(error){
    console.error("Contact enquiry error:",error);
    if(contactMsg) contactMsg.textContent="Unable to submit your enquiry: " + (error?.message || "Please try again.");
  }finally{
    if(button){button.disabled=false;button.textContent="SEND ENQUIRY →";}
  }
});


// Load active investment plans from Supabase so the public website always
// reflects changes made by an administrator in Plan Management.
(async function loadHomePlans(){
  const tbody=document.getElementById('homePlans');
  const currentReferral=(new URLSearchParams(location.search).get('ref')||sessionStorage.getItem('chipset_referral_code')||'').trim();
  if(currentReferral) try{sessionStorage.setItem('chipset_referral_code',currentReferral)}catch(e){}
  if(!tbody || !window.sb) return;

  const payoutEl=document.getElementById('homePayout');
  const payoutText=document.getElementById('homePayoutText');
  const headerMap={plan:'planHeadPlan',investment:'planHeadInvestment',payout:'planHeadPayout',total:'planHeadTotal',action:'planHeadAction'};

  let siteSettings={};
  try{
    const {data:settings}=await sb.from('site_settings').select('key,value');
    (settings||[]).forEach(x=>siteSettings[x.key]=x.value);
  }catch(e){ console.warn('Site settings unavailable:',e); }
  // Admin-managed public header menu, About Us and payout card text.
  const defaultMenu=[
    {label:'HOME',href:'index.html',active:true},
    {label:'ABOUT US',href:'#about',active:true},
    {label:'INVESTMENT PLAN',href:'#plans',active:true},
    {label:'WHY CHIPSET',href:'#why',active:true},
    {label:'FAQ',href:'#faq',active:true},
    {label:'CONTACT',href:'#contact',active:true}
  ];
  try{
    let menu=defaultMenu; try{const parsed=JSON.parse(siteSettings.site_menu||'');if(Array.isArray(parsed))menu=parsed;}catch(e){}
    const nav=document.getElementById('publicNav');
    if(nav){nav.innerHTML=menu.filter(x=>x && x.active!==false && x.label && x.href).map(x=>`<a href="${escapeAttr(x.href)}">${escapeHtml(x.label)}</a>`).join('');
      const current=location.pathname.split('/').pop()||'index.html'; nav.querySelectorAll('a').forEach(a=>{const href=a.getAttribute('href')||'';if((href.startsWith('#')&&location.hash===href)||(href.split('#')[0]===current&&!location.hash)||((current===''||current==='index.html')&&href==='index.html'))a.classList.add('active');});
    }
    const setText=(id,value)=>{const el=document.getElementById(id);if(el&&value)el.textContent=value;};
    setText('aboutEyebrow',siteSettings.about_eyebrow||'ABOUT CHIPSET');
    setText('aboutTitle',siteSettings.about_title||"Infrastructure for India's next digital chapter.");
    setText('aboutText1',siteSettings.about_text_1||'Chipset is presented as a digital infrastructure platform focused on next-generation data centre opportunities and an investor-first digital experience.');
    setText('aboutText2',siteSettings.about_text_2||'Customers can create an account, review plans, submit an investment enquiry and track their dashboard. Administrators can manage customers, plans, enquiries and platform activity from a dedicated control panel.');
    setText('earnCardTitle',siteSettings.earn_card_title||'MONTHLY PAYOUT*');
    setText('earnCardText',siteSettings.earn_card_text||'');
    setText('earnCardButton',siteSettings.earn_card_button||'START NOW →');
    const customPayout=siteSettings.earn_card_payout||''; if(customPayout)document.getElementById('homePayout').textContent=customPayout;
    const earnLink=document.getElementById('earnCardButton'); if(earnLink&&siteSettings.earn_card_button_link)earnLink.href=siteSettings.earn_card_button_link;
  }catch(e){console.warn('Home CMS settings error:',e)}

  document.getElementById(headerMap.plan).textContent=siteSettings.plan_header_plan||'PLAN';
  document.getElementById(headerMap.investment).textContent=siteSettings.plan_header_investment||'INVESTMENT';
  document.getElementById(headerMap.payout).textContent=siteSettings.plan_header_payout||'MONTHLY PAYOUT';
  document.getElementById(headerMap.total).textContent=siteSettings.plan_header_total||'12 MONTH TOTAL*';
  document.getElementById(headerMap.action).textContent=siteSettings.plan_header_action||'ACTION';
  const waNumber=(siteSettings.whatsapp_number||window.CHIPSET_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  const waUrl=waNumber ? `https://wa.me/${waNumber}` : (window.CHIPSET_WHATSAPP_URL||'https://wa.me/');
  const igUrl=siteSettings.instagram_url||window.CHIPSET_INSTAGRAM_URL||'https://instagram.com/';
  const wa=document.getElementById('whatsappLink'); if(wa) wa.href=waUrl;
  const ig=document.getElementById('instagramLink'); if(ig) ig.href=igUrl;

  try{
    const {data:plans,error}=await sb
      .from('investment_plans')
      .select('id,name,minimum_amount,monthly_payout_percent,active,earning_mode,earning_value,earning_frequency,earning_periods')
      .eq('active',true)
      .order('minimum_amount',{ascending:true});

    if(error) throw error;

    tbody.innerHTML='';
    if(!plans || !plans.length){
      tbody.innerHTML='<tr><td colspan="5">No active investment plans are available right now.</td></tr>';
      if(payoutEl) payoutEl.textContent='—';
      if(payoutText) payoutText.textContent='Please check back soon for active plans.';
      return;
    }

    const money=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
    plans.forEach((plan,index)=>{
      const amount=Number(plan.minimum_amount||0);
      const mode=String(plan.earning_mode||'percentage'),value=Number(plan.earning_value ?? plan.monthly_payout_percent ?? 0),freq=String(plan.earning_frequency||'monthly'),periods=Number(plan.earning_periods||12);
      const perPeriod=mode==='fixed'?value:amount*value/100;
      const total=perPeriod*periods;
      const payoutLabel=`₹${money(perPeriod)}`;
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${escapeHtml(plan.name||'Investment Plan')}</td><td>₹${money(amount)}</td><td>${payoutLabel}</td><td>₹${money(total)}</td><td><div class="planActions"><a class="payBtn" href="payment.html?plan=${encodeURIComponent(plan.id)}&name=${encodeURIComponent(plan.name||'Investment Plan')}&amount=${encodeURIComponent(amount)}${currentReferral?'&ref='+encodeURIComponent(currentReferral):''}">PAY NOW →</a><a class="miniSocial whatsapp" href="${waUrl}" target="_blank" rel="noopener" title="WhatsApp">◉</a><a class="miniSocial instagram" href="${igUrl}" target="_blank" rel="noopener" title="Instagram">◎</a></div></td>`;
      tbody.appendChild(tr);
      if(index===0){
        if(payoutEl && !siteSettings.earn_card_payout) payoutEl.textContent=mode==='fixed'?`₹${money(perPeriod)}`:`${value}%`;
        if(payoutText && !siteSettings.earn_card_text) payoutText.textContent=`Illustrative monthly payout on active plans. Starting from ₹${money(amount)}.`;
      }
    });
  }catch(error){
    console.error('Home plans error:',error);
    tbody.innerHTML='<tr><td colspan="5">Unable to load investment plans. Please refresh the page.</td></tr>';
    if(payoutEl) payoutEl.textContent='—';
    if(payoutText) payoutText.textContent='Please refresh and try again.';
  }

  // Admin-managed festival/offer banner
  const offer=document.getElementById('offerBanner');
  if(offer){
    try{
      if(siteSettings.offer_enabled==='true' && siteSettings.offer_image_url){
        offer.style.display='block';
        const img=document.getElementById('offerImage'); if(img) img.src=siteSettings.offer_image_url;
        const title=document.getElementById('offerTitle'); if(title) title.textContent=siteSettings.offer_title||'Special Offer';
        const text=document.getElementById('offerText'); if(text) text.textContent=siteSettings.offer_text||'';
        const date=document.getElementById('offerDate'); if(date) date.textContent=siteSettings.offer_date||'';
      }
    }catch(e){console.warn('Offer banner error:',e)}
  }

  function escapeAttr(value){
    return String(value).replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;' }[char]));
  }

  function escapeHtml(value){
    return String(value).replace(/[&<>'"]/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
  }
})();
