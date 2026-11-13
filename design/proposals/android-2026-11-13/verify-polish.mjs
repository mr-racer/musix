// Regressions for the owner's polish review: persistent art, a single waveform,
// interruption/cancel, and the first-use cover hint. CPU Chromium, no GPU claims.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url));
const {chromium}=createRequire(resolve(here,'../../../web/package.json'))('@playwright/test');
const browser=await chromium.launch({channel:'chrome',args:['--disable-gpu','--no-sandbox']});
const base=process.argv[2]||'http://100.65.53.57:8765/android-review.html';
const out=resolve(here,'out/checks'), errors=[], reports=[];
try {
  for(const [width,height] of [[360,780],[412,915],[448,998]]) {
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'?player=1');await page.waitForTimeout(1200);
    assert(await page.locator('#coverHint').isVisible());
    assert.equal(await page.locator('#reviewSpring').inputValue(),'soft');
    const ids=await page.evaluate(()=>phoneReview.queue());
    // Keep the incoming DOM node, then watch it through the entire transition.
    await page.evaluate(id=>{
      window.arriving=document.querySelector(`[data-track-id="${id}"]`);
      window.srcChanges=[];window.coverFrames=[];
      window.watch=new MutationObserver(ms=>srcChanges.push(...ms.map(m=>m.attributeName)));
      watch.observe(arriving,{subtree:true,attributes:true,attributeFilter:['src']});
      window.sampleCover=function sample(){
        const a=arriving.getBoundingClientRect(),slot=document.getElementById('coverSlot').getBoundingClientRect();
        coverFrames.push({t:performance.now(),x:a.x+a.width/2-slot.x-slot.width/2,attached:arriving.isConnected});
        window.sampleId=requestAnimationFrame(sample);
      };
      sampleCover();
    },ids[2]);
    await page.locator('#next').click();
    await page.waitForFunction(()=>!phoneReview.live().includes('coverSwipe'));
    const transition=await page.evaluate(()=>{
      cancelAnimationFrame(sampleId);watch.disconnect();
      return {same:arriving===document.getElementById('cover'),srcChanges,frames:coverFrames};
    });
    assert(transition.same,'the arriving cover remains the active DOM card');
    assert.deepEqual(transition.srcChanges,[],'no image replacement at transition completion');
    assert(transition.frames.every(f=>f.attached),'incoming art stays attached');
    assert(Math.abs(transition.frames.at(-1).x)<.6,'spring settles exactly at centre');
    const end=transition.frames.at(-1).t,tail=transition.frames.filter(f=>f.t>end-100);
    assert(Math.max(...tail.map(f=>Math.abs(f.x)))<1,'no visible jump in the final 100 ms');
    reports.push({width,height,transitionFrames:transition.frames.length,settleMs:Math.round(end-transition.frames[0].t),tailOffset:Math.max(...tail.map(f=>Math.abs(f.x)))});
    // Reverse during movement; stale completion must not advance another song.
    await page.evaluate(()=>{
      document.getElementById('prev').click();
      setTimeout(()=>document.getElementById('next').click(),80);
      setTimeout(()=>document.getElementById('next').click(),140);
      setTimeout(()=>document.getElementById('prev').click(),200);
    });
    await page.waitForTimeout(1300);assert.equal(await page.evaluate(()=>phoneReview.current()),ids[2]);
    // A cancelled horizontal gesture changes neither track nor playback.
    const cover=await page.locator('#coverSlot').boundingBox(),x=cover.x+cover.width/2,y=cover.y+cover.height/2;
    await page.locator('#coverSlot').evaluate(el=>el.addEventListener('pointerdown',e=>window.cancelPointer=e.pointerId,{once:true}));
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-100,y,{steps:8});
    await page.locator('#coverSlot').evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:cancelPointer,bubbles:true})));
    await page.mouse.up();
    await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>phoneReview.current()),ids[2]);
    assert.equal(await page.locator('#coverSlot').getAttribute('aria-label'),'Воспроизвести');
    await page.locator('#coverSlot').click();assert(await page.locator('#coverHint').isHidden());
    const seek=await page.locator('#seek').boundingBox();await page.mouse.click(seek.x+seek.width*.76,seek.y+seek.height/2);
    await page.waitForTimeout(350);
    const wave=await page.evaluate(()=>{
      const line=document.getElementById('seek').getBoundingClientRect(),played=document.getElementById('seekPlayed').getBoundingClientRect();
      return {count:document.querySelectorAll('.seek-wave').length,fraction:played.width/line.width,
        boundaries:[...document.querySelectorAll('.segment')].map(el=>el.getBoundingClientRect().left).filter(x=>x>line.left&&x<played.right),
        running:getComputedStyle(document.getElementById('seekWave')).animationPlayState};
    });
    assert.equal(wave.count,1);assert(wave.boundaries.length>1,'wave spans multiple sections');
    assert(Math.abs(wave.fraction-.76)<.01);assert.equal(wave.running,'running');
    await page.screenshot({path:resolve(out,`polish-playing-${width}.png`)});
    await page.evaluate(()=>phoneReview.setPlaying(false));await page.waitForTimeout(1200);
    assert.deepEqual(await page.evaluate(()=>phoneReview.live()),[]);
    assert.equal(await page.locator('#seekWave').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.reload();await page.waitForTimeout(1200);assert(await page.locator('#coverHint').isHidden(),'first-use hint stays dismissed on return');
    await page.screenshot({path:resolve(out,`polish-paused-${width}.png`)});
    await page.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(out,'polish-results.json'),JSON.stringify({passed:true,reports,errors},null,2));
  console.log('PASS: persistent incoming cards, smooth spring rest, rapid reversal, cancel, continuous wave, first-use hint, idle sleep at three sizes');
} finally { await browser.close(); }
