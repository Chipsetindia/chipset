window.TransactionUI = {
  esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))},
  money(v){return '₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2})},
  async createPayment({user,plan,customerName,phone,email,utr,file,note}){
    if(!window.sb) throw new Error('Supabase is not connected.');
    if(!user?.id) throw new Error('Please login before submitting payment proof.');
    const {data:tx,error}=await sb.from('investment_transactions').insert({
      user_id:user.id, customer_name:customerName, phone, email:email||null,
      plan_id:plan?.id||null, plan_name:plan?.name||'Investment Plan', amount:Number(plan?.minimum_amount||0),
      type:'debit', status:'pending', payment_method:'upi_manual', utr:utr||null, note:note||null
    }).select().single();
    if(error) throw error;
    if(file){
      const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
      const path=`${user.id}/${tx.id}.${ext}`;
      const up=await sb.storage.from('payment-slips').upload(path,file,{upsert:false,contentType:file.type||'image/jpeg'});
      if(up.error){await sb.from('investment_transactions').delete().eq('id',tx.id);throw up.error;}
      const {error:updateError}=await sb.from('investment_transactions').update({slip_path:path}).eq('id',tx.id);
      if(updateError) throw updateError;
    }
    return tx;
  }
};
