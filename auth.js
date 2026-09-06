function showError(message){const el=document.getElementById('error');if(el){el.textContent=message;el.className='authError';el.hidden=!message;}}
function configured(){if(!window.sb){showError('Supabase is not connected yet. Please contact support.');return false}return true}

function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length<=254}
function validName(name){return name.length>=2 && name.length<=80 && /[A-Za-z\u00C0-\uFFFF]/.test(name) && !/[<>]/.test(name)}
function passwordChecks(password){return {length:password.length>=8,upper:/[A-Z]/.test(password),lower:/[a-z]/.test(password),number:/\d/.test(password),special:/[^A-Za-z0-9\s]/.test(password),space:!/[\s]/.test(password)}}
function passwordMessage(password){const c=passwordChecks(password);if(!c.length)return 'Password must be at least 8 characters.';if(!c.upper)return 'Password must include at least 1 uppercase letter (A-Z).';if(!c.lower)return 'Password must include at least 1 lowercase letter (a-z).';if(!c.number)return 'Password must include at least 1 number (0-9).';if(!c.special)return 'Password must include at least 1 special character, for example @, # or !.';if(!c.space)return 'Password cannot contain spaces.';return ''}
function friendlyAuthError(raw,context='login'){const m=String(raw||'').toLowerCase();if(/invalid login credentials|invalid credentials/.test(m))return 'Email or password is incorrect. Please check your details and try again.';if(/email not confirmed/.test(m))return 'Your email is not confirmed yet. Please check your inbox and confirm your email.';if(/too many requests|rate limit/.test(m))return 'Too many attempts. Please wait a few minutes and try again.';if(/network|fetch|failed to fetch|timeout|connection/.test(m))return 'Network problem. Please check your internet connection and try again.';if(/password.*(8|characters)|weak password|password.*requirements/.test(m))return 'Password does not meet the security requirements. Use 8+ characters with uppercase, lowercase, number and special character.';if(/invalid.*email|email.*invalid/.test(m))return 'Please enter a valid email address, for example name@example.com.';if(/user.*not found/.test(m))return 'No account was found with this email address. Please create an account first.';if(context==='reset' && /session|expired|token/.test(m))return 'This password reset link is invalid or expired. Please request a new reset link.';return raw||'Something went wrong. Please try again.'}

async function checkRegistrationContact(email,phone){
  try{
    const {data,error}=await sb.rpc('check_registration_contact',{p_email:email||null,p_phone:phone||null});
    if(error){console.warn('Registration contact check:',error);return null}
    return data?.[0]||data||null;
  }catch(err){console.warn('Registration contact check:',err);return null}
}

const reg=document.getElementById('registerForm');
const phoneInput=document.getElementById('phone');
if(phoneInput){
  const cleanPhone=()=>{
    phoneInput.value=phoneInput.value.replace(/\D/g,'').slice(0,10);
  };
  phoneInput.addEventListener('input',cleanPhone);
  phoneInput.addEventListener('paste',()=>setTimeout(cleanPhone,0));
  phoneInput.addEventListener('blur',cleanPhone);
}
const registrationReferralCode=(new URLSearchParams(location.search).get('ref')||sessionStorage.getItem('chipset_referral_code')||localStorage.getItem('chipset_referral_code')||'').trim();
if(registrationReferralCode){try{localStorage.setItem('chipset_referral_code',registrationReferralCode)}catch(e){}}
if(registrationReferralCode){try{sessionStorage.setItem('chipset_referral_code',registrationReferralCode)}catch(e){}}
if(reg) reg.addEventListener('submit', async e=>{
  e.preventDefault(); showError(''); if(!configured()) return;
  const name=document.getElementById('name').value.trim();
  const email=document.getElementById('email').value.trim().toLowerCase();
  const phone=document.getElementById('phone').value.trim();
  const password=document.getElementById('password').value;
  const btn=reg.querySelector('button[type="submit"]');
  if(!validName(name)){showError('Please enter your full name (2–80 characters).');document.getElementById('name')?.focus();return;}
  if(!validEmail(email)){showError('Please enter a valid email address, for example name@example.com.');document.getElementById('email')?.focus();return;}
  const pwMsg=passwordMessage(password);
  if(pwMsg){showError(pwMsg);document.getElementById('password')?.focus();return;}
  if(!/^[6-9]\d{9}$/.test(phone)){
    showError('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.');
    document.getElementById('phone')?.focus();
    return;
  }
  if(btn){btn.disabled=true;btn.textContent='CHECKING…';}
  let existing=await checkRegistrationContact(email,phone);
  // Retry once if the RPC was temporarily unavailable.
  if(existing===null) existing=await checkRegistrationContact(email,phone);
  if(existing?.email_exists || existing?.phone_exists){
    const parts=[];
    if(existing.email_exists) parts.push('Email ID already registered');
    if(existing.phone_exists) parts.push('Phone number already registered');
    showError(parts.join(' and ') + '. Please login or use different details.');
    if(btn){btn.disabled=false;btn.textContent='CREATE ACCOUNT →';}
    return;
  }
  if(btn){btn.textContent='CREATING ACCOUNT…';}
  const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:name,phone,referral_code:registrationReferralCode||null}}});
  if(error){
    const raw=String(error.message||'');
    let msg='';
    if(/phone number already registered/i.test(raw)){
      msg='Phone number already registered. Please use a different phone number.';
    }else if(/database error saving new user/i.test(raw)){
      // Supabase masks BEFORE INSERT trigger errors with this generic message.
      // The account was blocked by the unique-phone protection.
      msg='Phone number already registered. Please use a different phone number.';
    }else if(/already registered|user already exists|already been registered/i.test(raw)){
      msg='Email ID already registered. Please login or use a different email.';
    }else{
      msg=friendlyAuthError(raw,'signup');
    }
    showError(msg);
    if(btn){btn.disabled=false;btn.textContent='CREATE ACCOUNT →';}
    return;
  }
  if(data.session){
    try{
      const up=await sb.from('profiles').upsert({id:data.user.id,full_name:name,phone:phone||null,role:'customer'},{onConflict:'id'});
      if(up.error){
        const raw=String(up.error.message||'');
        if(/phone number already registered/i.test(raw)||/duplicate key/i.test(raw)){
          showError('Phone number already registered. Please use a different phone number.');
          try{await sb.auth.signOut();}catch(_){}
          if(btn){btn.disabled=false;btn.textContent='CREATE ACCOUNT →';}
          return;
        }
        throw up.error;
      }
      await sb.rpc('get_or_create_referral_code');
      if(registrationReferralCode){ try{ await sb.rpc('set_referred_by_referral_code',{p_referral_code:registrationReferralCode}); }catch(e){ console.warn('Referral attribution:',e); } }
    }catch(err){ console.warn('Registration referral bootstrap:',err); }
    location.href='dashboard.html';
  } else {
    showError('Account created successfully. Please check your email to confirm your account before logging in.');
    if(btn){btn.disabled=false;btn.textContent='CREATE ACCOUNT →';}
  }
});

const login=document.getElementById('loginForm');
if(login) login.addEventListener('submit', async e=>{
  e.preventDefault(); showError(''); if(!configured()) return;
  const email=document.getElementById('email').value.trim().toLowerCase();
  const password=document.getElementById('password').value;
  if(!validEmail(email)){showError('Please enter a valid email address, for example name@example.com.');document.getElementById('email')?.focus();return;}
  if(!password){showError('Please enter your password.');document.getElementById('password')?.focus();return;}
  const btn=login.querySelector('button[type=\"submit\"]');if(btn){btn.disabled=true;btn.textContent='SIGNING IN…';}
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error){showError(friendlyAuthError(error.message,'login'));if(btn){btn.disabled=false;btn.textContent='LOGIN →';}return}
  let {data:profile}=await sb.from('profiles').select('role,phone,full_name').eq('id',data.user.id).maybeSingle();
  if(!profile){
    try{
      const up=await sb.from('profiles').upsert({id:data.user.id,full_name:data.user.user_metadata?.full_name||'Investor',phone:data.user.user_metadata?.phone||null,role:'customer'},{onConflict:'id'}).select('role,phone,full_name').maybeSingle();
      if(!up.error) profile=up.data;
    }catch(err){console.warn('Profile bootstrap:',err);}
  }
  if(profile?.role!=='admin'){
    try{ await sb.rpc('get_or_create_referral_code');
      if(registrationReferralCode){ try{ await sb.rpc('set_referred_by_referral_code',{p_referral_code:registrationReferralCode}); }catch(e){ console.warn('Referral attribution:',e); } } }catch(err){console.warn('Referral bootstrap:',err);}
  }
  // Link older guest payment proofs to this registered account by matching email OR phone.
  if(profile?.role!=='admin'){
    try{ await sb.rpc('link_guest_transactions_to_user',{p_email:data.user.email||email,p_phone:profile?.phone||data.user.user_metadata?.phone||null}); }catch(e){ console.warn('Guest transaction linking:',e); }
  }
  location.href=profile?.role==='admin'?'admin.html':'dashboard.html';
});

const forgot=document.getElementById('forgotPasswordForm');
if(forgot) forgot.addEventListener('submit', async e=>{
  e.preventDefault(); showError(''); if(!configured()) return;
  const email=document.getElementById('resetEmail').value.trim().toLowerCase();
  if(!validEmail(email)){showError('Please enter a valid email address, for example name@example.com.');document.getElementById('resetEmail')?.focus();return;}
  const redirectTo=new URL('reset-password.html',window.location.href).href;
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
  if(error){showError(friendlyAuthError(error.message,'reset'));return}
  showError('If this email is registered, a password reset link has been sent. Please check your inbox.');
  forgot.reset();
});

const resetForm=document.getElementById('resetPasswordForm');
if(resetForm){
  sb?.auth?.onAuthStateChange?.((event)=>{
    if(event==='PASSWORD_RECOVERY') showError('You can now set your new password.');
  });
  resetForm.addEventListener('submit', async e=>{
    e.preventDefault(); showError(''); if(!configured()) return;
    const password=document.getElementById('newPassword').value;
    const confirm=document.getElementById('confirmPassword').value;
    const pwMsg=passwordMessage(password);
    if(pwMsg){showError(pwMsg);document.getElementById('newPassword')?.focus();return}
    if(password!==confirm){showError('Passwords do not match. Please enter the same password in both fields.');document.getElementById('confirmPassword')?.focus();return}
    const {error}=await sb.auth.updateUser({password});
    if(error){showError(friendlyAuthError(error.message,'reset'));return}
    showError('Password updated successfully. Redirecting to login…');
    await sb.auth.signOut();
    setTimeout(()=>location.href='login.html',900);
  });
}
