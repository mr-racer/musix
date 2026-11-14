// Home, phone round 2: layout, album of the day, fold, morph search, finale.
// Usage: node verify-home-r2.mjs [base-url] [--only=layout,album,fold,search,finale,panel]
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'out/checks');
const {chromium}=createRequire(resolve(here,'../../../web/package.json'))('@playwright/test');
const args=process.argv.slice(2),onlyArg=args.find(a=>a.startsWith('--only='));
const base=args.find(a=>!a.startsWith('--'))||'file://'+resolve(here,'out/android-home-r2.html');
const only=onlyArg?onlyArg.slice(7).split(','):null,run=name=>!only||only.includes(name);
const SIZES=[[360,780],[412,915],[448,998]];
const b=await chromium.launch({channel:'chrome',args:['--disable-gpu','--no-sandbox']});
const errors=[],results={};
const open=async(width,height,query='',opts={})=>{const p=await b.newPage({viewport:{width,height},...opts});p.on('pageerror',e=>errors.push(`${width}: ${e.message}`));await p.goto(base+(query?'?'+query:''));await p.waitForTimeout(700);return p;};
const settle=p=>p.waitForTimeout(700);
const shot=(p,name)=>p.screenshot({path:resolve(out,`home-r2-${name}.png`)});
try{
 if(run('layout')){
  const matrix=[];
  for(const [w,h] of SIZES){
   const p=await open(w,h,'time=evening');
   for(const theme of ['dark','light'])for(const state of ['ready','loading','empty','error','offline','long','one','nopick']){
    await p.evaluate(({theme,state})=>{homeReview.setSky('evening','clear',theme);return homeReview.setState(state);},{theme,state});await settle(p);
    const m=await p.evaluate(()=>homeReview.metrics());
    assert(m.scroll<=m.height+1,`${w}/${theme}/${state}: home scrolls (${m.scroll}>${m.height})`);
    assert.deepEqual(m.overlaps,[],`${w}/${theme}/${state}: rows overlap`);
    assert.deepEqual(m.smallTargets,[],`${w}/${theme}/${state}: targets under 48 px`);
    assert(m.stackBottom<=m.miniTop+1,`${w}/${theme}/${state}: content runs under the mini player`);
    matrix.push({w,theme,state,...m});
    if(theme==='dark'||state==='ready')await shot(p,`${state}-${theme}-${w}`);
   }
   await p.evaluate(()=>homeReview.setSky('day','snow','dark'));assert.equal(await p.locator('#homeWeatherText').textContent(),'−3° · снег');
   await p.evaluate(()=>homeReview.setSky('day','none','dark'));assert.equal((await p.locator('#homeWeatherText').textContent()).trim(),'');
   assert.equal(await p.locator('#homeLibStack img').count(),3,'library stack shows three covers');
   await p.locator('#homeLibStack').click();await settle(p);assert.equal(await p.locator('#page-library').isVisible(),true,'stack opens the library');
   await p.close();
  }
  results.layout=matrix.length;
 }
 if(run('album')){
  let checked=0;
  for(const [w,h] of SIZES.slice(0,2)){
   const p=await open(w,h,'time=evening');
   for(const state of ['ready','long'])for(const kind of ['one','never','long']){
    await p.evaluate(({state,kind})=>{homeReview.setState(state);homeReview.setPick(kind);homeReview.setProgress('mid');},{state,kind});await settle(p);
    const lines=await p.evaluate(()=>homeReview.phraseLines());
    assert(lines.length>=2,`${w}/${state}/${kind}: at least two usable phrases`);
    assert(lines.every(n=>n<=2),`${w}/${state}/${kind}: phrase lines ${JSON.stringify(lines)}`);checked+=lines.length;
   }
   await p.evaluate(()=>{homeReview.setState('ready');homeReview.setPick('long');homeReview.setProgress('mid');});await settle(p);
   assert.equal((await p.locator('#homeAlbumDay .ad-btn .ad-label').first().textContent()).trim(),'Дослушать · 7 из 11');
   const fill=await p.evaluate(()=>{const b=document.querySelector('#homeAlbumDay .ad-btn'),n=b.querySelector('.ad-notch').getBoundingClientRect(),r=b.getBoundingClientRect();return{p:+getComputedStyle(b).getPropertyValue('--p'),notch:(n.left+n.width/2-r.left)/r.width};});
   assert(Math.abs(fill.p-7/11)<0.01,`fill ${fill.p}`);assert(Math.abs(fill.notch-.75)<0.01,`notch ${fill.notch}`);
   for(const prog of ['zero','last','done']){await p.evaluate(x=>homeReview.setProgress(x),prog);await settle(p);const n=await p.evaluate(()=>{const b=document.querySelector('#homeAlbumDay .ad-btn'),n=b.querySelector('.ad-notch').getBoundingClientRect(),r=b.getBoundingClientRect();return (n.left+n.width/2-r.left)/r.width;});assert(Math.abs(n-.75)<0.01,`notch at ${prog}`);}
   await shot(p,`album-long-done-${w}`);
   await p.evaluate(()=>homeReview.setProgress('mid'));await settle(p);
   assert.equal(await p.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest?.('#homeAlbumDay')&&a.playState==='running').length),0,'album card is still at rest');
   await p.locator('#homeAlbumDay .ad-btn').click();await settle(p);
   const first=await p.evaluate(()=>homeReview.albumDay().firstUnheard);
   assert.equal(await p.evaluate(()=>phoneReview.current()),first.id,'plays the first unheard song');assert.equal(await p.locator('#miniTitle').textContent(),first.t);
   assert.equal(await p.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest?.('#homeAlbumDay')&&a.playState==='running').length),1,'one wave edge while the album plays');
   await p.locator('#homeAlbumDay .ad-btn').click();await settle(p);
   assert.equal(await p.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest?.('#homeAlbumDay')&&a.playState==='running').length),0,'edge stops on pause');
   await p.locator('#homeAlbumDay .ad-cover').click();await settle(p);assert.equal(await p.locator('#sheet').getAttribute('aria-hidden'),'false','cover opens the gatefold');await p.evaluate(()=>phoneReview.closeSheet());await settle(p);
   await p.evaluate(()=>homeReview.setState('offline'));await settle(p);await p.locator('#homeAlbumDay .ad-btn').click();await p.waitForTimeout(300);
   assert.match(await p.locator('#toasts').textContent(),/Для воспроизведения нужна сеть/);
   for(const kind of ['one','never','long'])for(const prog of ['zero','mid','done']){await p.evaluate(({kind,prog})=>{homeReview.setState('ready');homeReview.setPick(kind);homeReview.setProgress(prog);},{kind,prog});await settle(p);if(w===412)await shot(p,`album-${kind}-${prog}-${w}`);const m=await p.evaluate(()=>homeReview.metrics());assert.deepEqual(m.smallTargets,[],`${kind}/${prog} targets`);assert(m.scroll<=m.height+1,`${kind}/${prog} scroll`);}
   await p.close();
  }
  results.album=checked;
 }
 if(run('fold')){
  let checked=0;
  const geo=p=>p.evaluate(()=>{const r=x=>{const b=document.querySelector(x).getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,height:b.height};};
   return {stack:r('#homeStack'),panel:r('#homeWavePanel'),card:r('#homeAlbumDay'),plate:r('#homeAlbumDay .ad-plate'),open:homeReview.foldOpen(),m:homeReview.metrics()};});
  const checkOpen=(g,tag)=>{
   assert.equal(g.open,true,`${tag}: open`);
   assert.deepEqual(g.m.smallTargets,[],`${tag}: targets`);assert(g.m.scroll<=g.m.height+1,`${tag}: scroll`);
   assert(g.panel.top>=g.stack.top-1&&g.panel.bottom<=g.stack.bottom+1,`${tag}: wave panel inside the stack ${JSON.stringify([g.panel,g.stack])}`);
   assert(Math.abs(g.plate.height-56)<=1,`${tag}: strip height ${g.plate.height}`);
   assert(g.plate.top>=g.panel.bottom-1,`${tag}: strip under the panel`);
   for(const x of [g.plate,g.panel])assert(x.left>=g.stack.left+19&&x.right<=g.stack.right-19,`${tag}: 20 px side margins ${JSON.stringify(x)}`);
   assert(g.plate.bottom<=g.stack.bottom+1&&g.stack.bottom<=g.m.miniTop+1,`${tag}: strip above the mini player`);
  };
  for(const [w,h] of SIZES){
   const p=await open(w,h,'time=evening');await p.evaluate(()=>localStorage.clear());
   const closed=await geo(p);
   assert(closed.plate.bottom<=closed.stack.bottom+1&&closed.plate.right<=closed.stack.right-19,`${w}: closed card inside the stack`);
   await p.evaluate(()=>homeReview.fold(true));await settle(p);
   const g=await geo(p);checkOpen(g,`${w}`);checked++;
   assert.equal(await p.locator('#homeWaveToggle').getAttribute('aria-expanded'),'true');
   const segs=await p.evaluate(()=>{const s=document.querySelector('#homeWavePanel .wave-presets');return {grid:s.classList.contains('grid'),clipped:[...s.querySelectorAll('button')].some(b=>b.scrollWidth>b.clientWidth+1)};});
   assert(!segs.clipped,`${w}: segment labels are cut ${JSON.stringify(segs)}`);
   await shot(p,`fold-${w}`);
   if(w===412){
    await p.evaluate(()=>homeReview.foldSet(.5));await p.waitForTimeout(100);await shot(p,'fold-mid-412');
    await p.evaluate(()=>homeReview.fold(true));await settle(p);
   }
   await p.locator('#homeAlbumDay .ad-strip').click();await settle(p);
   assert.equal(await p.evaluate(()=>homeReview.foldOpen()),false,`${w}: strip closes the wave`);
   const back=await geo(p);assert(Math.abs(back.plate.height-closed.plate.height)<=1&&Math.abs(back.card.top-closed.card.top)<=1,`${w}: card comes back whole`);
   await p.evaluate(()=>{window.__srcMut=0;new MutationObserver(l=>window.__srcMut+=l.length).observe(document.querySelector('#homeAlbumDay'),{childList:true,subtree:true,attributeFilter:['src']});});
   for(let i=0;i<20;i++){await p.locator('#homeWaveToggle').click();await p.waitForTimeout(60);}
   await settle(p);await p.waitForTimeout(400);
   const after=await geo(p);
   assert.equal(after.open,false,`${w}: 20 toggles end closed`);
   for(const k of ['top','bottom','left','right'])assert(Math.abs(after.plate[k]-closed.plate[k])<=1,`${w}: card ${k} after 20 toggles ${after.plate[k]} vs ${closed.plate[k]}`);
   assert.equal(await p.evaluate(()=>window.__srcMut),0,`${w}: cover is never rebuilt`);
   await p.close();
  }
  // choices persist under round 1's key
  const p=await open(412,915,'time=evening');await p.evaluate(()=>localStorage.clear());await p.reload();await settle(p);
  await p.evaluate(()=>homeReview.fold(true));await settle(p);
  await p.locator('#homeWavePanel [data-preset=favorites]').click();await p.locator('#homeWavePanel [data-sound=energetic]').click();
  assert.match(await p.locator('#homeWaveSummary').textContent(),/Любимое · Бодрое/);
  await p.reload();await settle(p);
  assert.deepEqual(await p.evaluate(()=>homeReview.wave()),{familiarity:'favorites',sound:'energetic'});
  assert.match(await p.evaluate(()=>localStorage.getItem('musix-phone-review-wave-v1')),/favorites/);
  await p.evaluate(()=>homeReview.fold(true));await settle(p);
  await p.locator('#homeWavePanel [data-sound=energetic]').click();assert.deepEqual(await p.evaluate(()=>homeReview.wave()),{familiarity:'favorites',sound:null},'second tap clears the mood');
  // Review Focus 4: the screen changes size while the wave is open
  await p.setViewportSize({width:360,height:780});await settle(p);checkOpen(await geo(p),'412→360');
  await p.setViewportSize({width:448,height:998});await settle(p);checkOpen(await geo(p),'360→448');
  // the wave edge of a hidden button does not run while the card is folded
  const cardAnims=()=>p.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest?.('#homeAlbumDay')&&a.playState==='running').length);
  await p.evaluate(()=>{homeReview.fold(false);homeReview.setProgress('mid');homeReview.albumPlaying(true);});await settle(p);
  assert.equal(await cardAnims(),1,'edge runs while the album plays');
  await p.evaluate(()=>homeReview.fold(true));await settle(p);
  assert.equal(await cardAnims(),0,'edge stops while folded');
  await p.evaluate(()=>homeReview.fold(false));await settle(p);
  assert.equal(await cardAnims(),1,'edge resumes when unfolded');
  await p.evaluate(()=>homeReview.albumPlaying(false));await settle(p);
  // no card: the wave opens into free space, nothing folds
  await p.evaluate(()=>{homeReview.fold(false);homeReview.setPick('none');});await settle(p);
  await p.evaluate(()=>homeReview.fold(true));await settle(p);
  const n=await p.evaluate(()=>{const v=document.querySelector('#vibes').getBoundingClientRect(),w=document.querySelector('#homeWavePanel').getBoundingClientRect();return {vibes:+getComputedStyle(document.querySelector('#vibes')).opacity,gap:w.top-v.bottom,m:homeReview.metrics()};});
  assert.equal(n.vibes,1,'no card: vibes stay');assert(n.gap>=0,'no card: panel under the vibes');assert(n.m.scroll<=n.m.height+1,'no card: scroll');
  await p.evaluate(()=>localStorage.clear());await p.close();
  results.fold=checked;
 }
 if(run('search')){
  const p=await open(412,915,'time=evening');let checked=0;
  const running=()=>p.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.closest?.('#homeSearchPanel')&&a.playState==='running').length);
  await p.locator('#homeSearchBtn').click();await settle(p);
  assert.equal(await p.evaluate(()=>homeReview.searchOpen()),true,'search opens');
  assert.equal(await p.evaluate(()=>document.activeElement?.id),'homeSearchInput','focus goes to the field');
  assert.match(await p.evaluate(()=>getComputedStyle(document.querySelector('#homeSearchPanel')).clipPath),/^inset\(0px.*round 20px\)$/,'panel fully grown');
  await shot(p,'search-open-412');
  await p.locator('#homeSearchInput').fill('Mad');await p.waitForTimeout(100);
  assert.equal(await p.locator('#homeSearchResults [data-artist]').count(),1,'one artist for Mad');
  assert.match(await p.locator('#homeSearchResults [data-artist] b').innerHTML(),/<mark>Mad<\/mark>/);
  await p.locator('#homeSearchInput').fill('<img onerror=alert(1)>');await p.waitForTimeout(100);
  assert.equal(await p.locator('#homeSearchResults img').count(),0,'no markup from the query');
  assert.match(await p.locator('#homeSearchResults').textContent(),/В фонотеке пока нет совпадений/);
  await p.keyboard.press('Escape');await settle(p);
  assert.equal(await p.evaluate(()=>homeReview.searchOpen()),false,'Escape closes');
  assert.equal(await p.evaluate(()=>document.activeElement?.id),'homeSearchBtn','focus back on the button');
  assert.equal(await running(),0,'search panel at rest after closing');checked++;
  // reopen mid-close
  await p.evaluate(()=>homeReview.searchOpen(true));await p.waitForTimeout(40);await p.evaluate(()=>homeReview.searchOpen(false));await p.waitForTimeout(80);await p.evaluate(()=>homeReview.searchOpen(true));await settle(p);await p.waitForTimeout(300);
  assert.equal(await p.evaluate(()=>homeReview.searchOpen()),true,'reopened mid-close stays open');
  assert.match(await p.evaluate(()=>getComputedStyle(document.querySelector('#homeSearchPanel')).clipPath),/^inset\(0px.*round 20px\)$/);
  await p.evaluate(()=>homeReview.searchSet(.5));await p.waitForTimeout(80);await shot(p,'search-mid-412');
  await p.evaluate(()=>homeReview.searchOpen(true));await settle(p);
  // keyboard plate
  await p.evaluate(()=>homeReview.keyboard(true));await settle(p);
  const kb=await p.evaluate(()=>({panel:document.querySelector('#homeSearchPanel').getBoundingClientRect().bottom,kbd:document.querySelector('#reviewKeyboard').getBoundingClientRect().top}));
  assert(kb.panel<=kb.kbd-8+0.5,`panel clears the keyboard ${JSON.stringify(kb)}`);await shot(p,'search-keyboard-412');
  await p.evaluate(()=>homeReview.keyboard(false));await settle(p);
  // AI mode hands the text to the assistant
  await p.locator('#homeSearchPanel .search-modes button',{hasText:'ИИ'}).click();await settle(p);
  await p.locator('#homeSearchInput').fill('Гитарный вечер');await p.waitForTimeout(100);await shot(p,'search-ai-412');
  await p.locator('#homeAsk').click();await settle(p);await p.waitForTimeout(400);
  assert.equal(await p.locator('#page-assistant').isVisible(),true,'assistant page shown');
  assert.match(await p.locator('#assistantAnswer').textContent(),/Гитарный вечер/,'question reaches the assistant');
  assert.equal(await p.evaluate(()=>homeReview.searchOpen()),false);checked++;
  await p.evaluate(()=>phoneReview.showPage('home'));await settle(p);
  // Review Focus 3: Back closes search, not the wave
  await p.evaluate(()=>homeReview.fold(true));await settle(p);
  await p.locator('#homeSearchBtn').click();await settle(p);
  await p.goBack();await settle(p);
  assert.equal(await p.evaluate(()=>homeReview.searchOpen()),false,'Back closes search');
  assert.equal(await p.evaluate(()=>homeReview.foldOpen()),true,'Back leaves the wave open');
  assert(p.url().includes('android-home-r2.html'),'Back stays on the page');checked++;
  await p.evaluate(()=>homeReview.fold(false));await settle(p);
  // Review Focus 5: offline search still finds the library
  await p.evaluate(()=>homeReview.setState('offline'));await settle(p);
  await p.evaluate(()=>homeReview.searchOpen(true));await settle(p);
  await p.locator('#homeSearchPanel .search-modes button',{hasText:'Библиотека'}).click();
  await p.locator('#homeSearchInput').fill('Frozen');await p.waitForTimeout(100);
  assert.match(await p.locator('#homeSearchResults').textContent(),/Frozen/,'offline search finds Frozen');
  await p.locator('.morph-scrim').click({position:{x:200,y:880}});await settle(p);
  assert.equal(await p.evaluate(()=>homeReview.searchOpen()),false,'scrim closes');checked++;
  await p.close();results.search=checked;
 }
 if(run('finale')){
  const p=await open(412,915,'time=evening');
  await p.evaluate(()=>{homeReview.setPick('long');homeReview.setProgress('last');});await settle(p);
  const h0=await p.evaluate(()=>hapticState.count);
  await p.evaluate(()=>homeReview.hearOne());await p.waitForTimeout(450);
  assert.match(await p.locator('#homeAlbumDay .ad-btn').textContent(),/Обыграна/,'button turns into «Обыграна»');
  await shot(p,'finale-button-412');
  await p.waitForTimeout(500);
  const jp=await p.evaluate(()=>{const j=document.querySelector('#homeAlbumDay .joipro'),h=document.querySelector('#homeAlbumDay');if(!j)return null;const a=j.getBoundingClientRect(),b=h.getBoundingClientRect();return {inside:a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1,title:j.querySelector('.jp-title').textContent,shown:j.checkVisibility(),m:homeReview.metrics()};});
  assert(jp&&jp.shown,'JoiPro shows');assert(jp.inside,'JoiPro stays inside the card');assert.equal(jp.title,'My Beautiful Dark Twisted Fantasy');
  assert.deepEqual(jp.m.smallTargets,[],'finale targets');
  await shot(p,'finale-joipro-412');
  await p.waitForTimeout(5600);
  assert.equal(await p.evaluate(()=>!!document.querySelector('#homeAlbumDay .joipro')?.checkVisibility()),false,'JoiPro leaves after 6 s');
  assert.equal(await p.evaluate(()=>[...LIVE].filter(n=>n.startsWith('joipro')).length),0,'JoiPro loops stopped');
  assert.equal(await p.evaluate(()=>hapticState.count),h0,'no vibration for the finale');
  assert.match(await p.locator('#homeAlbumDay .ad-btn').textContent(),/Обыграна/,'button stays «Обыграна»');
  const fill=await p.evaluate(()=>+getComputedStyle(document.querySelector('#homeAlbumDay')).getPropertyValue('--p'));
  assert(Math.abs(fill-9/11)<.01,`fill stays at the fraction ${fill}`);
  await p.evaluate(()=>homeReview.hearOne());await p.waitForTimeout(800);
  assert.equal(await p.locator('#homeAlbumDay .joipro').count(),0,'the finale plays once');
  // tap outside closes it early
  await p.evaluate(()=>{homeReview.setProgress('last');homeReview.hearOne();});await p.waitForTimeout(1100);
  assert.equal(await p.locator('#homeAlbumDay .joipro').count(),1);
  await p.mouse.click(30,120);await p.waitForTimeout(400);
  assert.equal(await p.locator('#homeAlbumDay .joipro').count(),0,'tap outside closes it');
  await p.close();
  // reduced motion: final state at once, no particles
  const r=await open(412,915,'time=evening',{reducedMotion:'reduce'});
  await r.evaluate(()=>{homeReview.setPick('long');homeReview.setProgress('last');homeReview.hearOne();});await r.waitForTimeout(50);
  const red=await r.evaluate(()=>({joi:!!document.querySelector('#homeAlbumDay .joipro'),live:[...LIVE].filter(n=>n.startsWith('joipro')).length,label:document.querySelector('#homeAlbumDay .ad-btn').textContent}));
  assert(red.joi&&red.live===0&&/Обыграна/.test(red.label),`reduced finale ${JSON.stringify(red)}`);
  await r.close();results.finale=1;
 }
 if(run('panel')){
  const p=await open(1280,1000,'time=evening');let n=0;
  for(const id of ['reviewHome','reviewFlow','reviewTime','reviewWeather','reviewHomeTheme','reviewPick','reviewProgress']){
   const values=await p.locator('#'+id+' option').evaluateAll(o=>o.map(x=>x.value));assert(values.length>=2,`${id} has options`);
   for(const v of values){await p.selectOption('#'+id,v);await p.waitForTimeout(150);n++;}
  }
  await p.selectOption('#reviewHome','ready');await p.selectOption('#reviewPick','long');await p.selectOption('#reviewProgress','last');await settle(p);
  await p.locator('#reviewHear').click();await p.waitForTimeout(400);
  assert.match(await p.locator('#homeAlbumDay .ad-btn').textContent(),/Обыграна/,'«Сыграть песню» reaches the finale');
  await p.locator('#reviewAlbumPlay').click();await settle(p);assert.equal(await p.locator('#reviewAlbumPlay').getAttribute('aria-pressed'),'true');
  await p.locator('#reviewAlbumPlay').click();await settle(p);
  await p.locator('#reviewKbd').check();await settle(p);assert.equal(await p.locator('#reviewKeyboard').isVisible(),true,'keyboard plate');
  await p.locator('#reviewKbd').uncheck();
  assert.equal(await p.locator('#reviewSpring').isVisible(),false,'player controls hidden');
  assert.equal(await p.locator('a[download]').getAttribute('href'),'android-home-r2.html');
  await p.close();
  const q=await open(412,915,'pick=long&progress=mid&weather=none&theme=light');
  assert.equal((await q.locator('#homeAlbumDay .ad-btn .ad-label').first().textContent()).trim(),'Дослушать · 7 из 11','URL scenario');
  assert.equal((await q.locator('#homeWeatherText').textContent()).trim(),'','URL weather none');
  await q.close();
  const r=await open(412,915,'pick=never',{reducedMotion:'reduce'});
  assert.equal(await r.locator('#homeAlbumDay .ad-title').textContent(),'Everything Not Saved Will Be Lost, Part 1');await r.close();
  results.panel=n;
 }
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'home-r2-results.json'),JSON.stringify({passed:true,results,errors},null,2));
 console.log('PASS:',JSON.stringify(results));
}finally{await b.close();}
