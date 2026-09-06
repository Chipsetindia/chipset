// CHIPSET protected-page security guard.
// Prevents authenticated pages from remaining accessible after logout via
// browser Back/Backspace, bfcache restore, or direct URL copy/paste.
(function(){
  const path=String(location.pathname||'').toLowerCase();
  const isAdmin=path.endsWith('/admin.html') || path.endsWith('admin.html');
  const isDashboard=path.endsWith('/dashboard.html') || path.endsWith('dashboard.html');
  if(!isAdmin && !isDashboard) return;

  document.documentElement.classList.add('chipset-auth-checking');
  let redirecting=false;

  async function enforce(){
    if(redirecting || !window.sb?.auth) return;
    try{
      let user=null, lastError=null;
      for(let attempt=0; attempt<3; attempt++){
        const result=await sb.auth.getUser();
        user=result?.data?.user||null;
        lastError=result?.error||null;
        if(user || !lastError) break;
        await new Promise(r=>setTimeout(r,350));
      }
      if(!user){
        redirecting=true;
        location.replace('login.html');
        return;
      }
      if(isAdmin){
        const {data:profile}=await sb.from('profiles').select('role').eq('id',user.id).maybeSingle();
        if(profile?.role!=='admin'){
          redirecting=true;
          location.replace('dashboard.html');
          return;
        }
      }
      document.documentElement.classList.remove('chipset-auth-checking');
      document.documentElement.classList.add('chipset-auth-ok');
    }catch(e){
      console.warn('Protected-page auth check:',e);
      // Never grant access on an uncertain auth state.
      redirecting=true;
      location.replace('login.html');
    }
  }

  // Initial direct URL load.
  enforce();

  // Browser Back/Forward and bfcache restore.
  window.addEventListener('pageshow', function(){ enforce(); });
  window.addEventListener('popstate', function(){ enforce(); });

  // Auth state changes (including explicit logout in another tab).
  try{
    sb.auth.onAuthStateChange(function(event,session){
      if(event==='SIGNED_OUT' || !session) enforce();
    });
  }catch(e){}
})();
