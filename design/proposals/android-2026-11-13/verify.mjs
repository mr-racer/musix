// Functional/layout checks on CPU Chromium. Device performance is measured on the Pixel.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url));
const {chromium}=createRequire(resolve(here,'../../../web/package.json'))('@playwright/test');
const base=process.argv[2]||'http://100.65.53.57:8765/android-review.html';
const out=resolve(here,'out/checks');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',args:['--disable-gpu','--no-sandbox']});
const errors=[],external=[],results=[];
try{
  for(const [width,height] of [[360,780],[412,915],[448,998]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base.split('/android-review')[0])&&!r.url().startsWith('data:'))external.push(r.url());});
    await page.goto(base+'?player=1');await page.waitForTimeout(1300);
    for(const state of ['ready','long','loading','empty','error','offline','noSound','elsewhere']){
      await page.evaluate(s=>phoneReview.setState(s),state);await page.waitForTimeout(100);
      const metrics=await page.evaluate(()=>{const root=document.getElementById('phone').getBoundingClientRect(),cover=document.getElementById('coverSlot').getBoundingClientRect(),peeks=document.querySelector('.peeks').getBoundingClientRect();return {width:root.width,height:root.height,cover:cover.width,peeksBottom:peeks.bottom-root.top,scroll:document.getElementById('playerLayout').scrollHeight,client:document.getElementById('playerLayout').clientHeight};});
      if(state!=='empty'){assert(metrics.cover>100,`${width}/${state}: cover visible`);assert(metrics.peeksBottom<=height,`${width}/${state}: peeks inside screen`);assert(metrics.scroll<=metrics.client+1,`${width}/${state}: player must not scroll ${JSON.stringify(metrics)}`);}
      assert.equal(await page.locator('#phone img').evaluateAll(imgs=>imgs.filter(i=>i.getAttribute('src')&&!i.complete).length),0);
      results.push({width,height,state,...metrics});
    }
    await page.evaluate(()=>phoneReview.setState('ready'));await page.screenshot({path:resolve(out,`player-${width}.png`)});
    await page.locator('#play').click();assert.equal(await page.locator('#play').getAttribute('aria-label'),'Пауза');
    await page.locator('#seek').focus();await page.keyboard.press('End');assert.equal(await page.locator('#seek').getAttribute('aria-valuenow'),'100');
    await page.keyboard.press('Home');assert.equal(await page.locator('#seek').getAttribute('aria-valuenow'),'0');
    await page.evaluate(()=>phoneReview.setPlaying(false));await page.waitForTimeout(1500);assert.deepEqual(await page.evaluate(()=>phoneReview.live()),[],'paused springs must sleep');
    await page.locator('#queuePeek').click();await page.waitForTimeout(900);const sheet=await page.locator('#sheet').boundingBox();assert(sheet.height<=height*.74+1);
    const before=await page.evaluate(()=>phoneReview.queue());const current=await page.evaluate(()=>phoneReview.current());
    await page.locator('.qrow.now .qremove').click();assert.deepEqual(await page.evaluate(()=>phoneReview.queue()),before,'current track cannot be removed');
    await page.locator('.qrow:not(.now) .qremove').first().click();assert.equal((await page.evaluate(()=>phoneReview.queue())).length,before.length-1);
    await page.getByRole('button',{name:'Вернуть',exact:true}).click();assert.deepEqual(await page.evaluate(()=>phoneReview.queue()),before,'undo restores queue order');
    const handle=page.locator('.qrow').last().locator('.handle');await handle.focus();await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>phoneReview.current()),current,'reordering preserves current track');
    await page.screenshot({path:resolve(out,`queue-${width}.png`)});await page.keyboard.press('Escape');await page.waitForTimeout(900);
    const cover=await page.locator('#coverSlot').boundingBox();const x=cover.x+cover.width/2,y=cover.y+cover.height/2;
    const old=await page.evaluate(()=>phoneReview.current());
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-35,y,{steps:8});await page.waitForTimeout(150);await page.mouse.move(x-32,y,{steps:4});await page.mouse.up();await page.waitForTimeout(900);
    assert.equal(await page.evaluate(()=>phoneReview.current()),old,'below-threshold drag returns');
    await page.locator('#lyrics').click();assert(await page.locator('#coverFlip').evaluate(el=>el.classList.contains('flipped')));await page.locator('#lyrics').click();
    await page.locator('#collapse').click();await page.waitForTimeout(1100);assert.equal(await page.locator('#player').getAttribute('aria-hidden'),'true');
    await page.screenshot({path:resolve(out,`shell-${width}.png`)});
    for(const name of ['library','assistant','game','home']){await page.locator(`#nav [data-page="${name}"]`).click();await page.waitForTimeout(600);assert(await page.locator('#page-'+name).isVisible());}
    await page.close();
  }
  const reduced=await browser.newPage({viewport:{width:412,height:915},reducedMotion:'reduce'});await reduced.goto(base+'?player=1');await reduced.waitForTimeout(200);await reduced.evaluate(()=>phoneReview.setPlaying(true));assert.deepEqual(await reduced.evaluate(()=>phoneReview.live()),[]);await reduced.close();
  const longQueue=await browser.newPage({viewport:{width:360,height:780}});longQueue.on('pageerror',e=>errors.push(e.message));await longQueue.goto(base+'?player=1');await longQueue.waitForTimeout(1200);
  for(const count of [1,1000]){
    await longQueue.evaluate(n=>phoneReview.setReviewQueue(n),count);await longQueue.waitForTimeout(1000);
    assert.equal(await longQueue.locator('.qrow').count(),count);assert((await longQueue.locator('#sheet').boundingBox()).height<=780*.74+1);
    await longQueue.locator('.qrow').last().scrollIntoViewIfNeeded();assert(await longQueue.locator('.qrow').last().isVisible());
    await longQueue.screenshot({path:resolve(out,`queue-${count}-items.png`)});
  }
  await longQueue.evaluate(()=>{phoneReview.closeSheet();phoneReview.setPlaying(true);phoneReview.setPlayer(false);});await longQueue.waitForTimeout(1000);
  assert(await longQueue.locator('.segment-wave').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationPlayState==='paused')),'hidden player wave must stop');await longQueue.close();
  const offline=await browser.newPage();await offline.route('http**://**/*',r=>r.abort());await offline.goto('file://'+resolve(here,'out/android-review.html'));await offline.waitForTimeout(200);assert.equal(await offline.locator('#miniTitle').innerText(),'Frozen');await offline.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(resolve(out,'results.json'),JSON.stringify({passed:true,states:results,errors,external},null,2));console.log(`PASS: ${results.length} layout states, queue undo/reorder, player controls, navigation, reduced motion, offline file; screenshots: ${out}`);
}finally{await browser.close();}
