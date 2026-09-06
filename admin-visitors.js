/* CHIPSET V28: separate Visitors tab with compact sorted visitor selector. */
(function(){
  const boot=async()=>{
    try{
      await window.__chipsetAdminReady;
      if(!window.sb)return;
      const totalEl=document.getElementById('visitorTotal');
      const activeEl=document.getElementById('visitorActive');
      const viewsEl=document.getElementById('visitorViews');
      const mobileEl=document.getElementById('visitorMobile');
      const selectEl=document.getElementById('visitorSessionSelect');
      const detailEl=document.getElementById('visitorDetailCard');
      const refresh=document.getElementById('refreshVisitors');
      if(!totalEl||!activeEl||!viewsEl||!mobileEl||!selectEl||!detailEl)return;
      const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
      let sessions=[];
      const sourceOf=v=>v?(()=>{try{return new URL(v).hostname.replace(/^www\./,'')}catch(e){return v}})():'Direct';
      const fmtDate=v=>{try{return new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return '-'}};
      const fmtTime=v=>{try{return new Date(v).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}catch(e){return '-'}};
      const renderDetail=(sid)=>{
        const s=sessions.find(x=>x.id===sid);
        if(!s){detailEl.innerHTML='<p class="muted">Select a visitor from the dropdown to view details.</p>';return;}
        const pages=s.events;
        detailEl.innerHTML=`<div class="visitorDetailHead"><div><h3>Visitor ${esc(s.shortId)}</h3><span class="muted">Last seen ${esc(fmtDate(s.lastSeen))}</span></div><span class="visitorStatus ${s.active?'active':''}">${s.active?'● Active now':'○ Inactive'}</span></div><div class="visitorMetaGrid"><div><small>DEVICE</small><b>${esc(s.device)}</b></div><div><small>FIRST SEEN</small><b>${esc(fmtDate(s.firstSeen))}</b></div><div><small>LAST PAGE</small><b>${esc(s.lastPage)}</b></div><div><small>SOURCE</small><b>${esc(s.source)}</b></div></div><div class="visitorPageHistory"><div class="panelHead"><h3>Page History</h3><span class="muted">${pages.length} page view${pages.length===1?'':'s'}</span></div><div class="tableScroll"><table class="adminTable"><thead><tr><th>Time</th><th>Page</th><th>Device</th><th>Source</th></tr></thead><tbody>${pages.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(r=>`<tr><td>${esc(fmtTime(r.created_at))}</td><td>${esc(r.page_path||'/')}</td><td>${esc(r.device_type||'-')}</td><td>${esc(sourceOf(r.referrer))}</td></tr>`).join('')}</tbody></table></div></div>`;
      };
      const render=rows=>{
        const map=new Map();
        rows.forEach(r=>{
          const id=String(r.session_id||''); if(!id)return;
          if(!map.has(id))map.set(id,[]); map.get(id).push(r);
        });
        const five=Date.now()-5*60*1000;
        sessions=[...map.entries()].map(([id,events])=>{
          events.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
          const last=events[0], first=events[events.length-1];
          return {id,events,firstSeen:first.created_at,lastSeen:last.created_at,lastPage:last.page_path||'/',device:last.device_type||'-',source:sourceOf(last.referrer),active:new Date(last.created_at).getTime()>=five,shortId:id.slice(-6).toUpperCase()};
        }).sort((a,b)=>new Date(b.lastSeen)-new Date(a.lastSeen));
        totalEl.textContent=sessions.length;
        activeEl.textContent=sessions.filter(x=>x.active).length;
        viewsEl.textContent=rows.length;
        const mob=rows.filter(r=>r.device_type==='Mobile').length;
        mobileEl.textContent=rows.length?Math.round(mob*100/rows.length)+'%':'0%';
        const previous=selectEl.value;
        selectEl.innerHTML=sessions.length?'<option value="">Select visitor…</option>'+sessions.map((x,i)=>`<option value="${esc(x.id)}">${esc(x.active?'🟢':'⚪')} ${esc(fmtDate(x.lastSeen))} • ${esc(x.device)} • ${esc(x.lastPage)} • ${esc(x.shortId)}</option>`).join(''):'<option value="">No visitors recorded</option>';
        if(previous&&sessions.some(x=>x.id===previous)){selectEl.value=previous;renderDetail(previous)}
        else if(sessions[0]){selectEl.value=sessions[0].id;renderDetail(sessions[0].id)}
        else renderDetail('');
      };
      const load=async()=>{
        selectEl.disabled=true; selectEl.innerHTML='<option value="">Loading visitors…</option>';
        const since=new Date(Date.now()-30*24*60*60*1000).toISOString();
        const {data,error}=await sb.from('site_visit_events').select('session_id,page_path,device_type,referrer,created_at').gte('created_at',since).order('created_at',{ascending:false}).limit(5000);
        if(error){selectEl.innerHTML='<option value="">Analytics SQL required</option>';detailEl.innerHTML='<p class="muted">Run the V27 visitor analytics SQL in Supabase to enable visitor analytics.</p>';return;}
        render(Array.isArray(data)?data:[]); selectEl.disabled=false;
      };
      selectEl.addEventListener('change',()=>renderDetail(selectEl.value));
      refresh?.addEventListener('click',load);
      load(); setInterval(load,30000);
    }catch(e){console.warn('Visitor analytics:',e);}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
