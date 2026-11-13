import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'out/checks');
const {chromium}=createRequire(resolve(here,'../../../web/package.json'))('@playwright/test');
const base=process.argv[2]||'http://100.65.53.57:8765/android-home-review.html';
const b=await chromium.launch({channel:'chrome',args:['--disable-gpu','--no-sandbox']});
const errors=[],matrix=[],weather=[];
try{
 for(const [width,height] of [[360,780],[412,915],[448,998]]){
  const p=await b.newPage({viewport:{width,height}});p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'?time=evening');await p.waitForTimeout(1100);
  for(const theme of ['dark','light'])for(const state of ['ready','loading','empty','error','offline','long','one','many']){
   await p.evaluate(({theme,state})=>{homeReview.setSky('evening','clear',theme);return homeReview.setState(state);},{theme,state});await p.waitForTimeout(['ready','one','many'].includes(state)?1000:300);
   const m=await p.locator('#page-home').evaluate(el=>{
    const box=el.getBoundingClientRect();return{height:el.clientHeight,scroll:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth,overlaps:[...el.children].filter(x=>!x.hidden&&getComputedStyle(x).display!=='none').flatMap((x,i,a)=>i&&x.getBoundingClientRect().top<a[i-1].getBoundingClientRect().bottom-1?[[a[i-1].className,x.className]]:[]),bottom:box.bottom,weekBottom:el.querySelector('.home-week').getBoundingClientRect().bottom};
   });
   assert(m.scroll<=m.height+1,`${width}/${theme}/${state} home vertical overflow`);assert(m.scrollWidth<=m.width+1,'home horizontal overflow');assert.deepEqual(m.overlaps,[],`${width}/${state} rows overlap`);
   if(!['loading','empty','error'].includes(state))assert(m.weekBottom<=m.bottom,'week is inside page');
   if(state==='empty')assert.equal(await p.locator('#mini').evaluate(el=>getComputedStyle(el).visibility),'hidden','first library has no stale mini player');
   if(state==='one')assert.equal(await p.locator('#miniTitle').textContent(),'Power','single-track state uses that track');
   await p.screenshot({path:resolve(out,`home-r1-${state}-${theme}-${width}.png`)});matrix.push({width,height,theme,state,...m});
  }
  await p.evaluate(()=>homeReview.setState('error'));await p.locator('#homeRetry').click();assert.equal(await p.locator('#page-home').getAttribute('data-home'),'ready');
  await p.evaluate(()=>homeReview.setSky('evening','clear','dark'));
  // A tap starts the wave in place; a second tap pauses it.
  await p.locator('#orb').click();await p.waitForFunction(()=>document.querySelector('#orb').getAttribute('aria-pressed')==='true');assert.equal(await p.locator('#player').getAttribute('aria-hidden'),'true');
  await p.locator('#orb').click();assert.equal(await p.locator('#orb').getAttribute('aria-pressed'),'false');
  await p.evaluate(()=>homeReview.setFlow('error'));await p.locator('#orb').click();await p.waitForFunction(()=>document.querySelector('#orb').getAttribute('aria-pressed')==='true');
  await p.evaluate(()=>homeReview.setFlow('paused'));
  // No duplicate covers: the visible top cover is the track sent to the mini player.
  const id=await p.locator('[data-home-vibe]').first().getAttribute('data-home-vibe');await p.locator('[data-home-vibe]').first().click();await p.waitForTimeout(700);
  assert.equal(await p.evaluate(()=>phoneReview.current()),id);assert.equal(await p.evaluate(()=>phoneReview.queue().length),3);assert.equal(await p.locator('.home-cover-flight').count(),0);assert.equal(await p.locator('#miniArt').evaluate(el=>getComputedStyle(el).visibility),'visible');
  await p.locator('#homeTune').click();await p.waitForTimeout(600);
  await p.locator('[data-preset=favorites]').click();await p.locator('[data-sound=calm]').click();assert.equal(await p.evaluate(()=>homeReview.wave().familiarity),'favorites');assert.equal(await p.evaluate(()=>homeReview.wave().sound),'calm');
  const clipping=await p.locator('.wave-presets').evaluate(el=>[...el.querySelectorAll('button')].map(b=>({w:b.clientWidth,s:b.scrollWidth})));assert(clipping.every(x=>x.s<=x.w+1),'four preset labels fit');
  await p.waitForTimeout(650);await p.screenshot({path:resolve(out,`home-r1-tune-${width}.png`)});await p.locator('#homeTuneDone').click();await p.waitForTimeout(550);
  await p.locator('#homeSearch').click();await p.locator('#homeSearchInput').fill('Mad');
  assert.equal(await p.locator('#homeSearchResults [data-artist]').count(),1);assert.equal(await p.locator('#homeSearchResults mark').first().textContent(),'Mad');
  await p.locator('#homeSearchInput').fill('<img onerror=alert(1)>');assert.equal(await p.locator('#homeSearchResults img').count(),0);assert(await p.locator('.home-search-empty').isVisible());
  await p.locator('#homeSearchInput').fill('Frozen');await p.screenshot({path:resolve(out,`home-r1-search-${width}.png`)});
  await p.locator('.sheet-search-modes button').nth(1).click();await p.screenshot({path:resolve(out,`home-r1-search-ai-${width}.png`)});
  await p.locator('#homeAsk').click();await p.waitForFunction(()=>document.querySelector('#page-assistant').dataset.answer==='working');assert.equal(await p.locator('.answer-question').textContent(),'Frozen');
  assert.equal(await p.evaluate(()=>homeReview.sky().running),false);const hiddenFrames=await p.evaluate(()=>homeReview.sky().frames);await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>homeReview.sky().frames),hiddenFrames);
  await p.evaluate(()=>phoneReview.showPage('home'));await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>homeReview.sky().running),true);
  await p.locator('#homeWeekBars').focus();await p.keyboard.press('Home');assert.equal(await p.locator('#homeWeekTotal').textContent(),'24 мин');await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#homeWeekTotal').textContent(),'42 мин');await p.keyboard.press('Escape');
  await p.locator('#homeWeekOpen').click();await p.waitForTimeout(550);await p.locator('[data-day="2"]').click();assert.equal(await p.locator('#weekDayReading').textContent(),'9 ноября · 0 мин');await p.screenshot({path:resolve(out,`home-r1-week-${width}.png`)});
  assert.equal(await p.evaluate(()=>homeReview.sky().running),false);await p.evaluate(()=>phoneReview.closeSheet());await p.waitForTimeout(550);
  // Pause scene work under the player and when the entire document is hidden.
  await p.evaluate(()=>phoneReview.setPlayer(true));await p.waitForTimeout(700);assert.equal(await p.evaluate(()=>homeReview.sky().running),false);assert(await p.evaluate(()=>phoneReview.homeMotion().every(s=>s==='paused')));
  await p.evaluate(()=>phoneReview.setPlayer(false));await p.waitForTimeout(700);
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await p.evaluate(()=>homeReview.sky().running),false);
  await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await p.reload();await p.waitForTimeout(500);assert.equal(await p.evaluate(()=>homeReview.wave().familiarity),'favorites');assert.equal(await p.evaluate(()=>homeReview.wave().sound),'calm');
  await p.close();
 }
 const p=await b.newPage({viewport:{width:412,height:915}});p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForTimeout(500);
 for(const time of ['morning','day','evening','night'])for(const kind of ['clear','cloudy','rain','snow']){
  await p.evaluate(({time,kind})=>homeReview.setSky(time,kind,'dark'),{time,kind});await p.waitForTimeout(450);await p.screenshot({path:resolve(out,`home-r1-sky-${time}-${kind}.png`)});weather.push({time,kind,...await p.evaluate(()=>homeReview.sky())});
 }
 await p.evaluate(()=>homeReview.setSky('day','snow','light'));await p.waitForTimeout(9000);const snow=await p.evaluate(()=>homeReview.sky());assert(snow.snowCells>0,'snow accumulates locally on surfaces');await p.screenshot({path:resolve(out,'home-r1-snow-light.png')});await p.close();
 const reduced=await b.newPage({viewport:{width:412,height:915},reducedMotion:'reduce'});reduced.on('pageerror',e=>errors.push(e.message));
 await reduced.goto('file://'+resolve(here,'out/android-home-review.html')+'?weather=snow');await reduced.waitForTimeout(500);assert.equal(await reduced.evaluate(()=>homeReview.sky().running),false);assert.equal(await reduced.evaluate(()=>homeReview.sky().falls),0);assert.deepEqual(await reduced.evaluate(()=>phoneReview.homeMotion()),[]);await reduced.close();
 const baseline=JSON.parse(readFileSync(resolve(here,'baseline/manifest.json')));assert.equal(createHash('sha256').update(readFileSync(resolve(here,'out',baseline.html))).digest('hex'),baseline.sha256);assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'home-r1-results.json'),JSON.stringify({passed:true,matrix,weather,errors},null,2));console.log(`PASS: ${matrix.length} size/theme/state combinations, ${weather.length} skies, flow retry/pause, saved tuner, search/AI handoff, cover flight, week, hidden scene, snow, offline reduced-motion file`);
}finally{await b.close()}
