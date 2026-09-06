(function(){
  const ready = window.SUPABASE_URL && window.SUPABASE_ANON_KEY && !window.SUPABASE_URL.includes('PASTE_') && !window.SUPABASE_ANON_KEY.includes('PASTE_');
  if(!ready){ console.warn('Supabase is not configured. Add URL and publishable/anon key to assets/supabase-config.js'); return; }
  window.sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
})();
