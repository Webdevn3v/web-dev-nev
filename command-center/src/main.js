import Database from '@tauri-apps/plugin-sql';

const NAV = [
  ['today','TODAY'],['door','DOOR WORKFLOW'],['clients','CLIENTS'],['inventory','INVENTORY'],['runway','RUNWAY'],['watch','WATCHTOWER'],['money','MONEY'],['ai','AI DESK']
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
  inventory:[],
  events:[{id:'event-2026-09-05',name:'September 5 Event',date:'2026-09-05',clientId:'stone-stardust',status:'prep'}],
  customOrders:[],
  photoIntake:[],
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

function photoProposalCard(p){
  return `<div class="card" style="margin-top:10px"><div class="kicker">PHOTO BATCH · ${esc(p.collection||'UNASSIGNED')}</div><div class="big">${esc(p.label||'Collection photo')}</div><p class="muted">${p.count||0} proposed pieces · REVIEW REQUIRED</p><div class="actions"><button class="btn primary" data-approve-photo="${esc(p.id)}">APPROVE TO INVENTORY</button><button class="btn" data-remove-photo="${esc(p.id)}">DISCARD</button></div></div>`;
}

function renderInventory(){
  setHeader('STONE & STARDUST','Inventory + Event Prep');
  const items=state.inventory.filter(i=>i.clientId==='stone-stardust');
  const event=state.events.find(e=>e.clientId==='stone-stardust'&&e.status==='prep');
  const going=items.filter(i=>i.eventId===event?.id);
  const sold=going.filter(i=>i.status==='sold');
  const returned=going.filter(i=>i.status==='returned');
  const available=items.filter(i=>i.status==='available'||i.status==='returned');
  const projected=going.reduce((sum,i)=>sum+(Number(i.price)||0)*(Number(i.qty)||1),0);
  const actual=sold.reduce((sum,i)=>sum+(Number(i.salePrice??i.price)||0)*(Number(i.qty)||1),0);
  const rows=(list,mode)=>list.length?list.map(i=>`<div class="inventory-row"><div><strong>${esc(i.id)} · ${esc(i.collection)} · ${esc(i.type)}</strong><div class="muted">${esc(i.size||'')} · $${Number(i.price||0).toFixed(0)} · qty ${i.qty}</div></div><div class="actions">${mode==='event'&&i.status!=='sold'?`<button class="btn primary" data-sold="${esc(i.id)}">SOLD</button><button class="btn" data-returned="${esc(i.id)}">RETURNED</button>`:''}${mode==='online'?`<span class="status ready">ONLINE QUEUE</span>`:''}</div></div>`).join(''):'<p class="muted">Nothing here yet.</p>';
  const photoBatches=state.photoIntake.filter(p=>p.clientId==='stone-stardust'&&p.status==='review');
    view.innerHTML=`<div class="grid three"><div class="card glow"><div class="kicker">EVENT</div><div class="big">${esc(event?.name||'NO EVENT')}</div><div class="muted">${esc(event?.date||'')}</div></div><div class="card"><div class="kicker">PROJECTED VALUE</div><div class="metric">$${projected.toFixed(0)}</div></div><div class="card"><div class="kicker">SALES LOGGED</div><div class="metric">$${actual.toFixed(0)}</div><div class="muted">${sold.length} item records sold</div></div></div>
  <div class="card" style="margin-top:14px"><div class="kicker">PHOTO-ASSISTED INTAKE</div><div class="big">PHOTO → PROPOSAL → CONFIRM → INVENTORY</div><p class="muted">Jarvie never silently decides what a handmade piece is. Add the AI/photo analysis as a proposal batch, review it, then approve it into real inventory.</p><div class="grid two"><div class="field"><label>COLLECTION</label><input id="photoCollection" placeholder="Water Colors"></div><div class="field"><label>BATCH LABEL</label><input id="photoLabel" placeholder="Blue window strands · photo 1"></div><div class="field"><label>PROPOSED PIECES</label><textarea id="photoPieces" placeholder="One per line: Window Strand | 48 in | 40&#10;Spiral | short | 25"></textarea></div></div><div class="actions"><button class="btn primary" id="stagePhoto">STAGE PHOTO PROPOSAL</button></div>${photoBatches.map(photoProposalCard).join('')}</div><div class="card" style="margin-top:14px"><div class="kicker">QUICK ADD · CONFIRM AFTER PHOTO REVIEW</div><div class="grid two"><div class="field"><label>COLLECTION</label><input id="invCollection" placeholder="Water Colors"></div><div class="field"><label>TYPE</label><input id="invType" placeholder="Window Strand"></div><div class="field"><label>SIZE / LENGTH</label><input id="invSize" placeholder='48"'></div><div class="field"><label>PRICE</label><input id="invPrice" type="number" min="0" step="1" placeholder="40"></div><div class="field"><label>QUANTITY</label><input id="invQty" type="number" min="1" value="1"></div></div><div class="actions"><button class="btn primary" id="addInventory">ADD TO TOMORROW'S EVENT</button></div></div>
  <div class="grid two" style="margin-top:14px"><div class="card"><div class="kicker">EVENT INVENTORY · SOLD / RETURNED</div>${rows(going,'event')}</div><div class="card"><div class="kicker">AFTER EVENT · ONLINE QUEUE</div><p class="muted">Returned and available pieces stay sellable between events.</p>${rows(available,'online')}</div></div>
  <div class="card" style="margin-top:14px"><div class="kicker">CUSTOM ORDERS</div><div class="grid two"><div class="field"><label>CUSTOMER</label><input id="customCustomer" placeholder="Name or contact"></div><div class="field"><label>REQUEST</label><input id="customRequest" placeholder="Colors, length, style, deadline…"></div></div><div class="actions"><button class="btn primary" id="addCustom">ADD CUSTOM ORDER</button></div>${state.customOrders.length?state.customOrders.map(o=>`<div class="status-row"><span>${esc(o.customer)} · ${esc(o.request)}</span><span class="status">${esc(o.status.toUpperCase())}</span></div>`).join(''):'<p class="muted">No custom orders yet.</p>'}</div>`;
  view.querySelector('#stagePhoto').onclick=async()=>{const collection=photoCollection.value.trim(),label=photoLabel.value.trim(),lines=photoPieces.value.split('\n').map(x=>x.trim()).filter(Boolean);if(!collection||!lines.length)return;const pieces=lines.map(line=>{const [type='',size='',price='']=line.split('|').map(x=>x.trim());return {type,size,price:Number(price)||0,qty:1};});state.photoIntake.push({id:`PB-${String(state.photoIntake.length+1).padStart(3,'0')}`,clientId:'stone-stardust',collection,label:label||'Collection photo',count:pieces.length,pieces,status:'review',createdAt:new Date().toISOString()});await persist('photoIntake');renderInventory();};
  view.querySelectorAll('[data-approve-photo]').forEach(b=>b.onclick=async()=>{const p=state.photoIntake.find(x=>x.id===b.dataset.approvePhoto);if(!p)return;for(const piece of p.pieces){const id=`S&S-${String(state.inventory.filter(x=>x.clientId==='stone-stardust').length+1).padStart(3,'0')}`;state.inventory.push({id,clientId:'stone-stardust',collection:p.collection,type:piece.type||'Unclassified piece',size:piece.size||'',price:Number(piece.price)||0,qty:Number(piece.qty)||1,status:'available',eventId:event?.id||'',sourcePhotoBatch:p.id});}p.status='approved';p.approvedAt=new Date().toISOString();await persist('inventory');await persist('photoIntake');renderInventory();});
  view.querySelectorAll('[data-remove-photo]').forEach(b=>b.onclick=async()=>{const p=state.photoIntake.find(x=>x.id===b.dataset.removePhoto);if(!p)return;p.status='discarded';await persist('photoIntake');renderInventory();});
  view.querySelector('#addInventory').onclick=async()=>{const collection=invCollection.value.trim(),type=invType.value.trim();if(!collection||!type)return;const id=`S&S-${String(items.length+1).padStart(3,'0')}`;state.inventory.push({id,clientId:'stone-stardust',collection,type,size:invSize.value.trim(),price:Number(invPrice.value)||0,qty:Number(invQty.value)||1,status:'available',eventId:event?.id||''});await persist('inventory');renderInventory();};
  view.querySelectorAll('[data-sold]').forEach(b=>b.onclick=async()=>{const i=state.inventory.find(x=>x.id===b.dataset.sold);if(!i)return;const entered=prompt('Sale price',String(i.price||0));if(entered===null)return;i.salePrice=Number(entered)||0;i.status='sold';i.soldAt=new Date().toISOString();await persist('inventory');renderInventory();});
  view.querySelectorAll('[data-returned]').forEach(b=>b.onclick=async()=>{const i=state.inventory.find(x=>x.id===b.dataset.returned);if(!i)return;i.status='returned';i.returnedAt=new Date().toISOString();await persist('inventory');renderInventory();});
  view.querySelector('#addCustom').onclick=async()=>{const customer=customCustomer.value.trim(),request=customRequest.value.trim();if(!request)return;state.customOrders.push({id:`CO-${String(state.customOrders.length+1).padStart(3,'0')}`,clientId:'stone-stardust',customer:customer||'Walk-up customer',request,status:'requested',createdAt:new Date().toISOString()});await persist('customOrders');renderInventory();};
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

function render(){renderNav();renderSystems();({today:renderToday,door:renderDoor,clients:renderClients,inventory:renderInventory,runway:renderRunway,watch:renderWatch,money:renderMoney,ai:renderAI}[active]||renderToday)();}

function tick(){clock.textContent=new Date().toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});offlineState.classList.toggle('off',!navigator.onLine);}

async function boot(){
  try{await initDb();}catch(err){console.error(err);offlineState?.classList.add('off');}
  render();tick();setInterval(tick,30000);
  shell.hidden=false;setTimeout(()=>{document.querySelector('#boot').classList.add('is-done');setTimeout(()=>document.querySelector('#boot').remove(),600)},750);
}
boot();
