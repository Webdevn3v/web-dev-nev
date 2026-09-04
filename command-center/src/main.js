import Database from '@tauri-apps/plugin-sql';

const NAV = [
  ['today','TODAY'],['door','DOOR WORKFLOW'],['clients','CLIENTS'],['runway','RUNWAY'],['watch','WATCHTOWER'],['money','MONEY'],['ai','AI DESK']
];

const seed = {
  missions:[
    {id:'legit',name:'MAKE TDS LEGIT',tag:'BUSINESS',progress:40,status:'active',note:'LLC → EIN → bank → developer infrastructure'},
    {id:'product',name:'LOCK THE DIGITAL DOOR SYSTEM',tag:'PRODUCT',progress:72,status:'active',note:'Door + Key + Customer Paths + purposeful handoff'},
    {id:'sales',name:'TURN DEMOS INTO CLIENTS',tag:'SALES',progress:18,status:'warn',note:'Portfolio → outreach → consult → deposit'}
  ],
  runway:[
    ['NOW / LEGIT',40],['SELLING',18],['PRODUCT',72],['PROTECTED',8],['DISCOVERABLE',12],['SCALING',0]
  ],
  systems:[
    ['LOCAL DB','ready'],['GITHUB','planned'],['CLAUDE','planned'],['CHATGPT','planned'],['WATCHTOWER','planned']
  ],
  clients:[
    {id:'tds',name:'The Digital Side',role:'STUDIO / CLIENT 0',status:'active',priority:'CORE',deadline:'Ongoing',repo:'Webdevn3v/web-dev-nev',note:'Run the studio through the same client system Jarvie will use for every project.'},
    {id:'stone-stardust',name:'Stone & Stardust',role:'CLIENT 1',status:'urgent',priority:'TONIGHT',deadline:'Event tomorrow',repo:'',note:'First real-world Jarvie client test: update Nina’s page for tomorrow’s event.'}
  ],
  doorDraft:{
    client:'',business:'',primaryGoal:'',customer:'',urgentNeed:'',customerIntent:'',tone:'',paths:'',destinations:'',handoff:'',deliverables:'Digital Key\nDigital Door\nCustomer Paths',notes:'',step:0
  }
};

let db;
let state = structuredClone(seed);
let active='today';

async function initDb(){
  db = await Database.load('sqlite:tds-command-center.db');
  await db.execute('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  for(const key of Object.keys(seed)){
    const rows = await db.select('SELECT value FROM app_state WHERE key = $1',[key]);
    if(rows.length){
      try{ state[key]=JSON.parse(rows[0].value); }catch{}
    } else {
      await persist(key);
    }
  }
}

async function persist(key){
  if(!db) return;
  await db.execute(
    'INSERT INTO app_state (key,value,updated_at) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    [key,JSON.stringify(state[key]),new Date().toISOString()]
  );
}

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setHeader(eyebrow,title){document.querySelector('#sectionEyebrow').textContent=eyebrow;document.querySelector('#sectionTitle').textContent=title;}

function renderNav(){
  nav.innerHTML=NAV.map(([id,label])=>`<button class="navbtn ${active===id?'active':''}" data-nav="${id}"><span>${label}</span><span>›</span></button>`).join('');
  nav.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{active=b.dataset.nav;render();});
}

function renderSystems(){
  systemStrip.innerHTML=state.systems.map(([name,status])=>`<span class="chip ${status==='ready'?'on':''}">${name} · ${status.toUpperCase()}</span>`).join('');
}

function renderToday(){
  setHeader('DAILY BRIEFING','Today');
  const avg=Math.round(state.missions.reduce((a,m)=>a+m.progress,0)/state.missions.length);
  view.innerHTML=`
    <div class="grid three">
      <div class="card glow"><div class="kicker">MISSION PROGRESS</div><div class="metric">${avg}%</div><div class="muted">Across active launch missions.</div></div>
      <div class="card"><div class="kicker">SYSTEM STATUS</div><div class="big">LOCAL CORE ONLINE</div><div class="muted">Cloud tools remain intentionally unconnected in Phase 1.</div></div>
      <div class="card"><div class="kicker">PICK ME UP</div><div class="big">MAKE TDS LEGIT</div><div class="muted">Current highest-leverage business mission.</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kicker">ACTIVE MISSIONS</div>
      ${state.missions.map(m=>`<div class="mission ${m.status}"><div class="mission__top"><div><div class="mission__name">${esc(m.name)}</div><div class="muted">${esc(m.note)}</div></div><div class="mission__tag">${m.tag}</div></div><div class="progress"><span style="width:${m.progress}%"></span></div></div>`).join('')}
      <div class="actions"><button class="btn primary" data-go-door>START A DOOR MISSION</button><button class="btn" data-go-runway>VIEW RUNWAY</button></div>
    </div>`;
  view.querySelector('[data-go-door]').onclick=()=>{active='door';render();};
  view.querySelector('[data-go-runway]').onclick=()=>{active='runway';render();};
}

const DOOR_STEPS=[
  ['1. OUTCOME','What does this business actually need to accomplish?'],
  ['2. CUSTOMER','Who is arriving and what are they trying to do?'],
  ['3. PATHS','Turn those needs into the shortest useful routes.'],
  ['4. DESTINATIONS','Where should each path end? No dead ends.'],
  ['5. BUILD','Choose the pieces required to make the route real.'],
  ['6. HANDOFF','Define the purposeful next step into the client’s ecosystem.']
];

function doorField(label,key,placeholder,kind='textarea'){
  const val=state.doorDraft[key]||'';
  return `<div class="field"><label>${label}</label>${kind==='input'?`<input data-field="${key}" value="${esc(val)}" placeholder="${esc(placeholder)}">`:`<textarea data-field="${key}" placeholder="${esc(placeholder)}">${esc(val)}</textarea>`}</div>`;
}

function stepBody(step){
  const d=state.doorDraft;
  if(step===0)return `${doorField('CLIENT / PROJECT','client','Frederick Legacy Law','input')}${doorField('PRIMARY BUSINESS GOAL','primaryGoal','Example: make it effortless for a mobile visitor to choose the right next action.')}${doorField('WHAT WOULD MAKE THIS PROJECT A WIN?','urgentNeed','What must be better after this is built?')}`;
  if(step===1)return `${doorField('WHO IS ARRIVING?','customer','Describe the actual people, not a marketing persona.')}${doorField('WHAT ARE THEY TRYING TO DO?','customerIntent','Book, call, understand services, get directions, submit info, etc.')}${doorField('BRAND VOICE / FEEL','tone','How should the client sound and feel?')}`;
  if(step===2)return `${doorField('CUSTOMER PATHS','paths','One per line. Example:\nI know what I need\nI need help choosing\nI’m already a client')}`;
  if(step===3)return `${doorField('PATH DESTINATIONS','destinations','Map each path to a useful destination/action. Every route must resolve somewhere useful.')}`;
  if(step===4)return `${doorField('BUILD PIECES','deliverables','Digital Key\nDigital Door\nCustomer Paths\nMobile Rescue\nFull-site handoff')}${doorField('BUILD NOTES','notes','Special interactions, assets, constraints, deadlines.')}`;
  return `${doorField('FULL-SITE / NEXT-STEP HANDOFF','handoff','Write the purposeful handoff in the CLIENT’S brand voice. Never generic “View Full Site.”')}${doorField('FINAL NOTES','notes','Anything another AI or builder needs to know.')}`;
}

function renderDoor(){
  setHeader('GUIDED PRODUCT WORKFLOW','Digital Door Mission');
  const s=Math.max(0,Math.min(5,state.doorDraft.step||0));
  view.innerHTML=`<div class="workflow"><div class="steps">${DOOR_STEPS.map((x,i)=>`<button class="step ${i===s?'active':''} ${i<s?'done':''}" data-step="${i}">${x[0]}</button>`).join('')}</div><div class="card glow"><div class="kicker">STEP ${s+1} OF 6</div><div class="big">${DOOR_STEPS[s][0].replace(/^\d\. /,'')}</div><div class="muted">${DOOR_STEPS[s][1]}</div>${stepBody(s)}<div class="actions"><button class="btn" data-prev ${s===0?'disabled':''}>BACK</button><button class="btn primary" data-next>${s===5?'SAVE MISSION':'SAVE + NEXT'}</button><button class="btn" data-summary>MISSION SUMMARY</button></div></div></div>`;
  view.querySelectorAll('[data-step]').forEach(b=>b.onclick=async()=>{await captureDoor();state.doorDraft.step=Number(b.dataset.step);await persist('doorDraft');renderDoor();});
  view.querySelector('[data-prev]').onclick=async()=>{await captureDoor();state.doorDraft.step=Math.max(0,s-1);await persist('doorDraft');renderDoor();};
  view.querySelector('[data-next]').onclick=async()=>{await captureDoor();state.doorDraft.step=Math.min(5,s+1);await persist('doorDraft');renderDoor();};
  view.querySelector('[data-summary]').onclick=async()=>{await captureDoor();renderDoorSummary();};
}

async function captureDoor(){
  view.querySelectorAll('[data-field]').forEach(el=>state.doorDraft[el.dataset.field]=el.value.trim());
  await persist('doorDraft');
}

function renderDoorSummary(){
  setHeader('MISSION OUTPUT','Digital Door Brief'); const d=state.doorDraft;
  view.innerHTML=`<div class="card glow"><div class="kicker">${esc(d.client||'UNTITLED PROJECT')}</div><div class="big">DOOR MISSION BRIEF</div><div class="grid two" style="margin-top:16px"><div><div class="kicker">OUTCOME</div><p class="muted">${esc(d.primaryGoal||'Not defined')}</p><div class="kicker">CUSTOMER</div><p class="muted">${esc(d.customer||'Not defined')}</p><div class="kicker">CUSTOMER INTENT</div><p class="muted">${esc(d.customerIntent||'Not defined')}</p><div class="kicker">URGENT / HIGH-VALUE NEED</div><p class="muted">${esc(d.urgentNeed||'Not defined')}</p><div class="kicker">VOICE</div><p class="muted">${esc(d.tone||'Not defined')}</p></div><div><div class="kicker">PATHS</div><p class="muted">${esc(d.paths||'Not defined').replace(/\n/g,'<br>')}</p><div class="kicker">DESTINATIONS</div><p class="muted">${esc(d.destinations||'Not defined').replace(/\n/g,'<br>')}</p><div class="kicker">BUILD PIECES</div><p class="muted">${esc(d.deliverables||'Not defined').replace(/\n/g,'<br>')}</p><div class="kicker">HANDOFF</div><p class="muted">${esc(d.handoff||'Not defined')}</p><div class="kicker">NOTES</div><p class="muted">${esc(d.notes||'Not defined').replace(/\n/g,'<br>')}</p></div></div><div class="actions"><button class="btn primary" data-edit>EDIT WORKFLOW</button></div></div>`;
  view.querySelector('[data-edit]').onclick=()=>{renderDoor();};
}

function renderRunway(){
  setHeader('BUSINESS LEVEL MAP','Goal Runway');
  view.innerHTML=`<div class="grid two">${state.runway.map(([name,pct],i)=>`<div class="card ${i===0?'glow':''}"><div class="kicker">LEVEL ${String(i+1).padStart(2,'0')}</div><div class="big">${name}</div><div class="progress"><span style="width:${pct}%"></span></div><div class="muted" style="margin-top:8px">${pct}% complete</div></div>`).join('')}</div>`;
}
function renderWatch(){setHeader('MONITORING','Watchtower');view.innerHTML=`<div class="card"><div class="big">WATCH REGISTRY READY</div><p class="muted">Phase 1 keeps monitoring offline. Later monitors plug into this system without pretending to be connected.</p>${['Website health','Deployments','Domains / SSL / DNS','Forms','Client inactivity','Payments','Deadlines','Backups'].map(x=>`<div class="status-row"><span>${x}</span><span class="status">PLANNED</span></div>`).join('')}</div>`;}
function renderMoney(){setHeader('TDS LAUNCH FUND','Money');view.innerHTML=`<div class="grid two"><div class="card glow"><div class="kicker">NEXT INFRASTRUCTURE GOAL</div><div class="big">BUSINESS FORMATION + BANKING</div><p class="muted">Budget engine migration comes after the desktop foundation is stable.</p></div><div class="card"><div class="kicker">RULE</div><div class="big">MONEY GETS A JOB FIRST.</div><p class="muted">Every future expense will carry priority, dependency, target, saved, remaining and funding source.</p></div></div>`;}
function renderClients(){
  setHeader('CLIENT WORKSPACES','Clients');
  view.innerHTML=`<div class="grid two">${state.clients.map(c=>`<div class="card ${c.status==='urgent'?'glow':''}"><div class="kicker">${esc(c.role)} · ${esc(c.priority)}</div><div class="big">${esc(c.name)}</div><p class="muted">${esc(c.note)}</p><div class="status-row"><span>DEADLINE</span><span class="status ${c.status==='urgent'?'ready':''}">${esc(c.deadline)}</span></div><div class="status-row"><span>REPO</span><span class="status">${esc(c.repo||'LINK WHEN READY')}</span></div><div class="actions"><button class="btn primary" data-client-door="${esc(c.id)}">START WORK</button></div></div>`).join('')}</div>`;
  view.querySelectorAll('[data-client-door]').forEach(b=>b.onclick=async()=>{const client=state.clients.find(c=>c.id===b.dataset.clientDoor);state.doorDraft={...structuredClone(seed.doorDraft),client:client?.name||'',step:0,notes:client?.id==='stone-stardust'?'EVENT DEADLINE: tomorrow. Prioritize the page update needed tonight.':''};await persist('doorDraft');active='door';render();});
}
function renderAI(){setHeader('ROUTER FOUNDATION','AI Desk');view.innerHTML=`<div class="card glow"><div class="big">ONE DESK. MULTIPLE BRAINS.</div><p class="muted">No external AI credentials are stored or called in this phase. The next layer will route approved jobs to Claude, OpenAI/ChatGPT, GitHub and local tools through the native backend.</p>${state.systems.map(([n,s])=>`<div class="status-row"><span>${n}</span><span class="status ${s==='ready'?'ready':''}">${s.toUpperCase()}</span></div>`).join('')}</div>`;}

function render(){renderNav();renderSystems();({today:renderToday,door:renderDoor,clients:renderClients,runway:renderRunway,watch:renderWatch,money:renderMoney,ai:renderAI}[active]||renderToday)();}

function tick(){clock.textContent=new Date().toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});offlineState.classList.toggle('off',!navigator.onLine);}

async function boot(){
  try{await initDb();}catch(err){console.error(err);offlineState?.classList.add('off');}
  render();tick();setInterval(tick,30000);
  shell.hidden=false;setTimeout(()=>{document.querySelector('#boot').classList.add('is-done');setTimeout(()=>document.querySelector('#boot').remove(),600)},750);
}
boot();
