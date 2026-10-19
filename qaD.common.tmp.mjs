import { chromium } from '@playwright/test';
export const BASE='http://localhost:4174';
export const OUT='/private/tmp/claude-501/e2e/agentD';
export async function launch(){
  return chromium.launch({executablePath: process.env.HOME+'/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
}
export function watch(page, tag){
  page.on('console', m=>{ if(['error','warning'].includes(m.type())) console.log(`[${tag}][console.${m.type()}]`, m.text().slice(0,300)); });
  page.on('pageerror', e=>console.log(`[${tag}][pageerror]`, e.message.slice(0,300)));
  page.on('response', async r=>{ if(r.status()>=400){ let b=''; try{b=(await r.text()).slice(0,250);}catch{} console.log(`[${tag}][HTTP ${r.status()}] ${r.request().method()} ${r.url().replace(BASE,'')} ${b}`);} });
}
export async function login(page,email,pw){
  await page.goto(BASE+'/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(pw);
  await page.getByRole('button',{name:'Sign in'}).click();
}
export async function shot(page,name){ await page.screenshot({path:`${OUT}/${name}.png`, fullPage:false}); }
export async function text(page){ return (await page.locator('main, body').first().innerText()).replace(/\n+/g,' | ').slice(0,1200); }
