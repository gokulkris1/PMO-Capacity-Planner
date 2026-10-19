import {launch,watch,login,shot,text,BASE} from './qaD.common.tmp.mjs';
const b=await launch();
// 1 register
{const ctx=await b.newContext(); const p=await ctx.newPage(); watch(p,'reg');
await p.goto(BASE+'/login'); await shot(p,'01-login');
await p.getByRole('link',{name:'Create account'}).click(); await p.waitForTimeout(800);
console.log('URL',p.url());
await p.getByLabel('Full name').fill('QA-D Newbie');
await p.getByLabel('Work email').fill('qa-d.newbie+'+Date.now()+'@example.com');
await p.getByLabel('Password',{exact:true}).fill('QA-D-Password-123');
const t0=Date.now();
await p.getByRole('button',{name:/Create account/}).click();
await p.waitForTimeout(3000); console.log('reg after',Date.now()-t0,'ms URL',p.url()); console.log('REG:',await text(p)); await shot(p,'02-register-result');
// forgot password
await p.goto(BASE+'/login'); await p.getByLabel('Email',{exact:true}).fill('tom.hayes@acme.example');
await p.getByRole('link',{name:'Forgot password?'}).click(); await p.waitForTimeout(800); console.log('URL',p.url()); await shot(p,'03-reset');
await p.getByRole('button').filter({hasText:/code|send|reset/i}).first().click(); await p.waitForTimeout(2500);
console.log('RESET:',await text(p)); await shot(p,'04-reset-result');
// verify page with email
await p.goto(BASE+'/verify-email?email=loner%40nowhere.example'); await p.waitForTimeout(1000); console.log('VERIFY URL',p.url(),await text(p));
await p.waitForTimeout(31000);
await p.getByRole('button',{name:'Resend code'}).click(); await p.waitForTimeout(2500); console.log('VERIFY RESEND:',await text(p)); await shot(p,'05-verify-resend');
await p.goto(BASE+'/verify'); await p.waitForTimeout(1000); console.log('/verify URL',p.url(),await text(p)); await shot(p,'05b-verify-route');
await ctx.close();}
// 3 ada
{const ctx=await b.newContext(); const p=await ctx.newPage(); watch(p,'ada');
await login(p,'ada.admin@acme.example','Ada-Lovelace-1815');
for (const ms of [1000,4000,10000]){ await p.waitForTimeout(ms); console.log('ADA t+',ms,p.url(),await text(p)); }
await shot(p,'06-ada-2fa');
await ctx.close();}
await b.close();
