import { readFileSync } from 'fs';
let env: Record<string,string> = {};
const t=readFileSync('.env.local','utf8');
t.split('\n').forEach(l=>{ const s=l.trim(); if(!s||s.startsWith('#')) return; const i=s.indexOf('='); if(i>-1) env[s.slice(0,i).trim()]=s.slice(i+1).trim() });
for (const [k,v] of Object.entries(env)) process.env[k]=v as string;

import { createClient } from '@supabase/supabase-js';
const supa = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false}});
import { sendDigestEmail } from '@/lib/email';
import { getActiveSubscribers } from '@/lib/db';

async function main(){
  const dates = ['2026-08-25', '2026-08-26'];
  
  for (const today of dates) {
    console.log(`\n=== Processing ${today} ===`);
    
    // Get the composed newsletter from newsletter_issues
    const {data: issue, error: issueError} = await supa.from('newsletter_issues').select('composed, subject').eq('issue_date', today).maybeSingle();
    if(issueError || !issue){
      console.log(`No newsletter_issue for ${today}, skipping`);
      continue;
    }
    console.log(`Found issue: ${issue.subject}`);
    
    // Get subscribers
    const subs = await getActiveSubscribers();
    console.log(`Found ${subs.length} subscribers`);
    
    // Send emails
    try{
      await sendDigestEmail(issue.composed as any, subs.map(s=>s.email));
      console.log(`Emails sent successfully for ${today}`);
    }catch(e){ 
      console.log(`sendDigestEmail threw for ${today}:`, (e as Error).message); 
    }
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });