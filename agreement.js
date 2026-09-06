(async function(){
  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
  const dt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-IN');};
  if(!window.sb){location.replace('login.html');return;}
  const root=q('agreementRoot');
  try{
    const {data:{user},error:authErr}=await sb.auth.getUser();
    if(authErr||!user){location.replace('login.html');return;}
    const id=new URLSearchParams(location.search).get('id')||'';
    if(!id)throw new Error('Agreement ID is missing.');
    const {data:a,error}=await sb.from('investment_agreements').select('*').eq('id',id).eq('user_id',user.id).maybeSingle();
    if(error)throw error;
    if(!a)throw new Error('This agreement is unavailable or does not belong to your account.');
    const freq=String(a.earning_frequency||'weekly').toLowerCase();
    const rate=Number(a.return_percent ?? a.earning_value ?? 0);
    const divisor=freq==='daily'?1:freq==='monthly'?30:7;
    const dailyAmount=a.daily_earning_amount!=null?Number(a.daily_earning_amount):(a.earning_mode==='fixed'?rate/divisor:Number(a.investment_amount||0)*rate/divisor/100);
    const lockDays=Number(a.principal_lock_days ?? 30);
    const investmentTermDays=Number(a.investment_term_days ?? a.snapshot?.investment_term_days ?? a.maturity_days ?? 0);
    const returnText=a.return_percent!=null?`${Number(a.return_percent)}% ${esc(freq)}`:a.earning_value!=null?`${money(a.earning_value)} ${esc(freq)}`:'As per approved plan terms';
    const maturity=a.maturity_mode==='immediate'?'Immediate':investmentTermDays?(String(investmentTermDays)+' days'+(a.maturity_at?' · Until '+dt(a.maturity_at):'')):a.maturity_at?dt(a.maturity_at):'As per plan terms';
    const cycleText=freq==='weekly'?`${rate}% weekly return is credited in 7 equal daily credits (weekly rate ÷ 7).`:freq==='monthly'?`${rate}% monthly return is credited in 30 equal daily credits (monthly rate ÷ 30).`:'Daily return is credited each day as per the approved daily rate.';
    const reinvestText=a.auto_reinvest!==false?'YES — At the end of the full investment term, the principal automatically rolls into the next investment cycle on the same approved terms. The 30-day principal lock is separate from the investment term. Daily interest credits continue independently.':'NO — Principal does not automatically roll into a new cycle; after the full investment term it may become eligible for principal withdrawal subject to the applicable withdrawal process.';
    root.className='agreementDoc';
    root.innerHTML=`<div class="agreementHeader"><div><div class="agreementLogo">CHIPSET</div><small>INVESTMENT PLAN AGREEMENT & DISCLOSURE</small></div><div><b>${esc(a.agreement_number)}</b><br><small>Terms version ${esc(a.terms_version||'V1.0')}</small></div></div><div class="agreementActions noPrint"><button class="btn" id="printAgreement" type="button">DOWNLOAD AGREEMENT PDF →</button><a class="smallBtn" href="dashboard.html">BACK TO DASHBOARD</a></div><div class="agreementNotice"><b>Verified investment agreement</b><br>This document was generated from the approved payment record and preserves the plan terms captured at verification. Later changes to the plan catalogue do not rewrite this agreement.</div><h2>1. Customer & Payment</h2><div class="agreementMeta"><div><small>Customer</small><b>${esc(a.customer_name||'—')}</b></div><div><small>Email</small><b>${esc(a.customer_email||'—')}</b></div><div><small>Phone</small><b>${esc(a.customer_phone||'—')}</b></div><div><small>Payment ID</small><b>${esc(a.payment_ref||'—')}</b></div><div><small>UTR / Transaction ID</small><b>${esc(a.utr||'—')}</b></div><div><small>Approved</small><b>${dt(a.approved_at)}</b></div></div><h2>2. Approved Plan Terms</h2><table class="agreementTable"><tr><th>Plan</th><td>${esc(a.plan_name)}</td></tr><tr><th>Investment amount</th><td>${money(a.investment_amount)}</td></tr><tr><th>Approved return</th><td>${returnText}</td></tr><tr><th>Daily interest credit</th><td><b>${money(dailyAmount)} per day</b><br><small>${esc(cycleText)}</small></td></tr><tr><th>Earning periods</th><td>${a.earning_periods?esc(a.earning_periods):'—'}</td></tr><tr><th>Principal lock</th><td><b>${lockDays} days</b>${a.principal_unlock_at?`<br><small>Principal lock ends: ${dt(a.principal_unlock_at)}</small>`:''}<br><small>Principal is locked only for the first 30 days. After the lock period, principal may be eligible for withdrawal under the applicable withdrawal process.</small></td></tr><tr><th>Investment term</th><td><b>${esc(maturity)}</b><br><small>Investment remains active/earning for the full approved term (up to 364 days for a 52-week plan).</small></td></tr><tr><th>Auto-reinvestment</th><td><b>${a.auto_reinvest!==false?'YES':'NO'}</b><br><small>${esc(reinvestText)}</small></td></tr><tr><th>Approved on</th><td>${dt(a.approved_at)}</td></tr></table><div class="agreementCallout"><b>Important: How your investment works</b><ul><li><b>Interest:</b> ${money(dailyAmount)} is scheduled as the daily credit for this approved investment.</li><li><b>Principal:</b> ${lockDays?('₹'+Number(a.investment_amount||0).toLocaleString('en-IN',{maximumFractionDigits:2})+' remains locked for the first '+lockDays+' days.'):'Principal lock is as per the approved plan terms.'}</li><li><b>Investment term:</b> ${investmentTermDays?('The investment remains active for up to '+investmentTermDays+' days, while daily interest credits continue according to the approved plan.'):'The investment term is as per the approved plan terms.'}</li><li><b>At maturity:</b> ${esc(reinvestText)}</li><li><b>Independent investments:</b> Each investment has its own daily credit schedule and lock/maturity timeline.</li></ul></div><h2>3. Returns & Payment Disclosure</h2><p>${esc(a.disclaimer)}</p><p>${esc(a.disclosure)}</p><h2>4. Risk Disclosure</h2><p>${esc(a.risk_notice)}</p><h2>5. Customer Acknowledgement</h2><p>${a.terms_accepted?`Customer acknowledgement recorded: <b>${dt(a.terms_accepted_at)}</b> · Terms version <b>${esc(a.accepted_terms_version||a.terms_version||'V1.0')}</b>. The customer confirmed review of the selected plan details and risk disclosure before submitting payment proof.`:'The agreement records the approved transaction terms. No digital acknowledgement timestamp was available for this historical transaction.'} This acknowledgement does not convert an illustrative figure into a guaranteed return.</p><h2>6. Contact & Jurisdiction</h2><p><b>CHIPSET Contact Email:</b> chipsetindia@gmail.com</p><p>${esc(a.jurisdiction_notice||'Any dispute arising out of or in connection with this agreement shall be subject to the jurisdiction of the competent courts in Delhi, India, including the Delhi High Court to the extent it has jurisdiction.')}</p><div class="agreementFooter">CHIPSET • Agreement ${esc(a.agreement_number)} • Generated from verified transaction ${esc(a.investment_transaction_id)}<br>Official contact: chipsetindia@gmail.com<br>This document is a record of the approved commercial terms and disclosures. It should be reviewed together with any other applicable terms, policies and legally required disclosures.</div>`;
    q('printAgreement').onclick=async()=>{
      const btn=q('printAgreement');
      if(!window.html2canvas || !window.jspdf?.jsPDF){alert('PDF generator is still loading. Please click again in a moment.');return;}
      const docEl=q('agreementRoot');
      const actions=docEl.querySelector('.agreementActions');
      const originalText=btn.textContent;
      btn.disabled=true;btn.textContent='GENERATING PDF…';
      if(actions)actions.style.display='none';
      try{
        const canvas=await html2canvas(docEl,{scale:2,useCORS:true,backgroundColor:'#ffffff',logging:false,windowWidth:docEl.scrollWidth});
        const {jsPDF}=window.jspdf;
        const pdf=new jsPDF({unit:'pt',format:'a4',orientation:'portrait',compress:true});
        const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
        const margin=28, usableW=pageW-margin*2, usableH=pageH-margin*2;
        const pxPerPt=canvas.width/usableW;
        const pageCanvasH=Math.floor(usableH*pxPerPt);
        let offset=0, pageNo=0;
        while(offset<canvas.height){
          const sliceH=Math.min(pageCanvasH,canvas.height-offset);
          const slice=document.createElement('canvas');
          slice.width=canvas.width;slice.height=sliceH;
          const ctx=slice.getContext('2d');
          ctx.fillStyle='#fff';ctx.fillRect(0,0,slice.width,slice.height);
          ctx.drawImage(canvas,0,offset,canvas.width,sliceH,0,0,canvas.width,sliceH);
          const img=slice.toDataURL('image/jpeg',0.92);
          if(pageNo>0)pdf.addPage();
          pdf.addImage(img,'JPEG',margin,margin,usableW,sliceH/pxPerPt,'','FAST');
          offset+=sliceH;pageNo++;
        }
        const agreementNo=String(document.querySelector('.agreementHeader b')?.textContent||'agreement').replace(/[^A-Za-z0-9_-]+/g,'-');
        pdf.save('CHIPSET-INVESTMENT-AGREEMENT-'+agreementNo+'.pdf');
      }catch(err){
        console.error(err);alert('Could not generate the PDF. Please try again.');
      }finally{
        if(actions)actions.style.display='flex';
        btn.disabled=false;btn.textContent=originalText;
      }
    };
    q('logout').onclick=async()=>{try{await sb.auth.signOut({scope:'local'});}catch(e){}location.replace('login.html');};
  }catch(err){root.className='agreementDoc';root.innerHTML=`<h2>Agreement unavailable</h2><p class="muted">${esc(err?.message||'Unable to load the agreement.')}</p><div class="agreementActions"><a class="btn" href="dashboard.html">BACK TO DASHBOARD</a></div>`;}
})();
