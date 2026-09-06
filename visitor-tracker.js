/* CHIPSET lightweight anonymous visitor analytics.
   No IP address, name, email, phone or auth data is collected. */
(function(){
  if(!window.sb) return;
  const KEY='chipset_visitor_session';
  let sid='';
  try{ sid=sessionStorage.getItem(KEY)||''; if(!sid){sid=(crypto?.randomUUID?.()||('v_'+Date.now()+'_'+Math.random().toString(36).slice(2))); sessionStorage.setItem(KEY,sid);} }catch(e){sid='v_'+Date.now()+'_'+Math.random().toString(36).slice(2);}
  const ua=navigator.userAgent||'';
  const device=/Mobi|Android|iPhone|iPad|iPod/i.test(ua)?(/iPad|Tablet/i.test(ua)?'Tablet':'Mobile'):'Desktop';
  const page=(location.pathname||'/').replace(/\/+$/,'')||'/';
  let sent=false;
  async function send(){
    if(sent)return; sent=true;
    try{
      await sb.from('site_visit_events').insert({
        session_id:sid,
        page_path:page.slice(0,500),
        device_type:device,
        referrer:(document.referrer||'').slice(0,500)
      });
    }catch(e){/* analytics must never affect the website */}
  }
  send();
})();
