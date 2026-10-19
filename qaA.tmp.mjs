import { chromium } from '@playwright/test';
const BASE='http://localhost:4174';
const WS='/o/acme-bank/w/a1000000-0000-4000-8000-0000000000a1/';
const SHOT='/private/tmp/claude-501/e2e/agentA/';
const log=(...a)=>console.log(...a);
async function launch(){ return chromium.launch({executablePath:process.env.PW_CHROMIUM_PATH}); }
function watch(page, tag=''){
  page.on('console', m=>{ if(['error','warning'].includes(m.type())) log(`[console.${m.type()}]${tag}`, m.text().slice(0,300)); });
  page.on('pageerror', e=>log(`[pageerror]${tag}`, e.message.slice(0,300)));
  page.on('response', async r=>{ if(r.status()>=400){ let b=''; try{b=(await r.text()).slice(0,200);}catch{} log(`[HTTP ${r.status()}]${tag} ${r.request().method()} ${r.url().replace(BASE,'')} ${b}`);} });
}
async function newCtx(browser){ const ctx=await browser.newContext({viewport:{width:1440,height:900}}); await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:BASE}); return ctx; }
async function login(page, email='tom.hayes@acme.example', pw='Pmo-Planner-2024'){
  await page.goto(BASE+'/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(pw);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'),{timeout:15000});
  await page.waitForTimeout(1500);
}
async function shot(page,name){ await page.screenshot({path:SHOT+name+'.png',fullPage:false}); }
async function toasts(page){ const t=await page.locator('[role=status],[role=alert],.pcp-toast').allInnerTexts().catch(()=>[]); return t.filter(Boolean).join(' | '); }
async function buttons(page, scope='main'){ return (await page.locator(scope).getByRole('button').allInnerTexts().catch(()=>[])).map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean); }
const b=await launch(); const ctx=await newCtx(b); const page=await ctx.newPage(); watch(page);
await login(page);
const S=BASE+WS+'settings/structure';
await page.goto(S); await page.waitForTimeout(1500);
const dlg=()=>page.getByRole('dialog');
// add tribe
await page.getByRole('button',{name:'Add tribe'}).click();
await dlg().getByLabel('Name').fill('QA Tribe A');
await dlg().getByLabel(/Tribe lead/).fill('Alice Lead');
await shot(page,'st-add-tribe-dialog');
await dlg().getByRole('button',{name:'Add tribe'}).click();
await page.waitForTimeout(1500); log('toast after add tribe:', await toasts(page));
log('row present:', await page.getByRole('row',{name:/QA Tribe A/}).count());
// rename via menu
await page.getByRole('button',{name:'Actions for QA Tribe A'}).click();
await page.getByRole('menuitem',{name:'Rename'}).click();
await dlg().getByLabel('Name').fill('QA Tribe Renamed');
await dlg().getByLabel(/Tribe lead/).fill('Bob Lead');
await dlg().getByRole('button',{name:'Save'}).click();
await page.waitForTimeout(1500); log('toast after rename:', await toasts(page));
await page.reload(); await page.waitForTimeout(2000);
log('after reload renamed row:', (await page.getByRole('row',{name:/QA Tribe Renamed/}).allInnerTexts()).join('|'));
// duplicate name
await page.getByRole('button',{name:'Add tribe'}).click();
await dlg().getByLabel('Name').fill('payments');
await dlg().getByRole('button',{name:'Add tribe'}).click(); await page.waitForTimeout(800);
log('dup tribe dialog text:', (await dlg().innerText()).replace(/\s+/g,' '));
await dlg().getByRole('button',{name:'Cancel'}).click();
// archive
await page.getByRole('button',{name:'Actions for QA Tribe Renamed'}).click();
const items=await page.getByRole('menuitem').allInnerTexts(); log('menu items:', items.join(','));
await page.getByRole('menuitem',{name:'Archive'}).click();
await page.waitForTimeout(500); log('confirm dialog:', (await dlg().innerText().catch(()=>'')).replace(/\s+/g,' '));
await dlg().getByRole('button',{name:'Archive'}).click(); await page.waitForTimeout(1500);
log('toast after archive:', await toasts(page));
log('archived row:', (await page.getByRole('row',{name:/QA Tribe Renamed/}).allInnerTexts()).join('|'));
// check org tribes page doesn't show archived
await page.goto(BASE+WS+'org/tribes'); await page.waitForTimeout(1500);
log('org tribes shows archived?', await page.getByText('QA Tribe Renamed').count());
// chapters
await page.goto(S+'?tab=chapters'); await page.waitForTimeout(1500);
log('chapters url', page.url());
await page.getByRole('tab',{name:/Chapters/}).click(); await page.waitForTimeout(800);
await shot(page,'st-chapters-empty');
log('chapter buttons:', (await buttons(page)).join(' | '));
const cfc=page.getByRole('button',{name:'Create chapters from crafts'});
if(await cfc.count()){ await cfc.click(); await page.waitForTimeout(600);
  log('cfc confirm:', (await dlg().innerText()).replace(/\s+/g,' ').slice(0,600));
  await shot(page,'st-cfc-confirm');
  await dlg().getByRole('button',{name:'Create chapters'}).click(); await page.waitForTimeout(4000);
  log('toast after cfc:', await toasts(page));
  log('chapter rows:', (await page.locator('main tbody tr').allInnerTexts()).map(s=>s.replace(/\s+/g,' ')).join(' || '));
}
await page.getByRole('button',{name:'Add chapter'}).first().click();
await dlg().getByLabel('Name').fill('QA Chapter');
log('chapter dialog:', (await dlg().innerText()).replace(/\s+/g,' '));
const cb=dlg().getByRole('combobox'); await cb.click(); await cb.fill('a'); await page.waitForTimeout(500);
const opts=page.getByRole('option'); log('lead options count', await opts.count());
if(await opts.count()) await opts.first().click();
await shot(page,'st-add-chapter');
await dlg().getByRole('button',{name:'Add chapter'}).click(); await page.waitForTimeout(1500);
log('toast after add chapter:', await toasts(page));
log('QA Chapter row:', (await page.getByRole('row',{name:/QA Chapter/}).allInnerTexts()).join('|'));
await page.getByRole('button',{name:'Actions for QA Chapter'}).click();
await page.getByRole('menuitem',{name:'Rename'}).click();
await dlg().getByLabel('Name').fill('QA Chapter 2');
await dlg().getByRole('button',{name:'Save'}).click(); await page.waitForTimeout(1500);
log('toast after chapter rename:', await toasts(page));
await page.getByRole('button',{name:'Actions for QA Chapter 2'}).click();
await page.getByRole('menuitem',{name:'Archive'}).click(); await dlg().getByRole('button',{name:'Archive'}).click(); await page.waitForTimeout(1500);
log('toast after chapter archive:', await toasts(page));
// teams
await page.getByRole('tab',{name:/Teams/}).click(); await page.waitForTimeout(800);
await page.getByRole('button',{name:'Add team'}).first().click();
log('team dialog:', (await dlg().innerText()).replace(/\s+/g,' '));
await dlg().getByLabel('Name').fill('QA Team');
await dlg().getByRole('button',{name:'Add team'}).click(); await page.waitForTimeout(1500);
log('toast add team:', await toasts(page));
await page.getByRole('button',{name:'Actions for QA Team'}).click();
await page.getByRole('menuitem',{name:'Rename'}).click();
await dlg().getByLabel('Name').fill('QA Team 2'); await dlg().getByRole('button',{name:'Save'}).click(); await page.waitForTimeout(1500);
log('toast rename team:', await toasts(page));
await page.getByRole('button',{name:'Actions for QA Team 2'}).click();
await page.getByRole('menuitem',{name:'Archive'}).click(); await dlg().getByRole('button',{name:'Archive'}).click(); await page.waitForTimeout(1500);
log('toast archive team:', await toasts(page));
await page.reload(); await page.waitForTimeout(2000);
await page.getByRole('tab',{name:/Teams/}).click(); await page.waitForTimeout(800);
log('teams after reload:', (await page.locator('main tbody tr').allInnerTexts()).map(s=>s.replace(/\s+/g,' ')).join(' || '));
await page.getByRole('tab',{name:/Chapters/}).click(); await page.waitForTimeout(800);
log('chapters after reload:', (await page.locator('main tbody tr').allInnerTexts()).map(s=>s.replace(/\s+/g,' ')).join(' || '));
await shot(page,'st-chapters-final');
await b.close();
