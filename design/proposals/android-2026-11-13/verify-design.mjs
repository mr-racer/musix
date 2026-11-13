import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url));
const {chromium}=createRequire(resolve(here,'../../../web/package.json'))('@playwright/test');
const base=process.argv[2]||'http://100.65.53.57:8765/android-review.html',out=resolve(here,'out/checks');
const browser=await chromium.launch({channel:'chrome',args:['--disable-gpu','--no-sandbox']});
const errors=[],results=[];
try {
  for(const [width,height] of [[360,780],[412,915],[448,998]]) {
    const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForTimeout(700);
    assert.equal(await page.locator('#cover').evaluate(el=>getComputedStyle(el).visibility),'hidden','collapsed player cannot paint its art over other pages');
    for(const state of ['ready','loading','empty','error','offline','long']) {
      await page.evaluate(s=>phoneReview.setReviewHome(s),state);await page.waitForTimeout(450);
      const metrics=await page.locator('#page-home').evaluate(el=>{
        const bounds=el.getBoundingClientRect(),box=s=>el.querySelector(s).getBoundingClientRect();
        return {scroll:el.scrollHeight,client:el.clientHeight,weekBottom:box('.home-week').bottom,bottom:bounds.bottom,
          libraryGap:box('.section-head').top-box('#homeCounts').bottom,albumGap:box('.home-week').top-box('.home-albums').bottom};
      });
      assert(metrics.scroll<=metrics.client+1,`${width}/${state}: no home scroll`);
      if(['ready','offline','long'].includes(state)){
        assert(metrics.weekBottom<=metrics.bottom+.5,'week stays above the mini player');
        assert(metrics.libraryGap>=5,`${width}: library captions and album title must not touch: ${JSON.stringify(metrics)}`);
        assert(metrics.albumGap>=3,`${width}: album labels and week must not overlap: ${JSON.stringify(metrics)}`);
      }
      await page.screenshot({path:resolve(out,`design-home-${state}-${width}.png`)});results.push({screen:'home',width,height,state,...metrics});
    }
    await page.evaluate(()=>phoneReview.setReviewHome('error'));await page.locator('#homeRetry').click();
    assert.equal(await page.locator('#page-home').getAttribute('data-home'),'ready');
    await page.locator('[data-search-mode=ai]').click();await page.locator('#homeSearch').click();
    await page.waitForFunction(()=>document.querySelector('#assistantForm input')===document.activeElement);
    for(const state of ['idle','working','ready','error']){
      await page.evaluate(s=>phoneReview.setReviewAssistant(s),state);await page.waitForTimeout(650);
      const compose=await page.locator('#assistantForm').boundingBox(),mini=await page.locator('#mini').boundingBox();
      assert(compose.y+compose.height<mini.y,'composer stays above mini player');
      if(state!=='idle'){
        assert(await page.locator('#assistantAnswer .rbs svg .ol').count()>=2,'original Richbox paths are present');
        const font=await page.locator('#assistantAnswer .step-word').first().evaluate(el=>({family:getComputedStyle(el).fontFamily,size:parseFloat(getComputedStyle(el).fontSize)}));
        assert(font.family.includes('Noto Sans'));assert.equal(font.size,15);
      }
      await page.screenshot({path:resolve(out,`design-assistant-${state}-${width}.png`)});results.push({screen:'assistant',width,height,state});
    }
    // A real question runs all three accepted steps, then renders the response.
    await page.evaluate(()=>phoneReview.setReviewAssistant('idle'));
    await page.locator('[data-ask="Расскажи о текущей песне"]').click();
    await page.waitForFunction(()=>document.querySelector('#assistantAnswer .step.cur .rbs svg'));
    await page.waitForTimeout(800);await page.locator('#assistantAnswer .thinking-actions button').click();
    await page.waitForTimeout(4500);
    assert.equal(await page.evaluate(()=>phoneReview.assistantState()),'cancelled');
    assert.equal(await page.locator('#assistantAnswer .assistant-response').count(),0,'cancelled answer never arrives late');
    await page.locator('#assistantAnswer .thinking-actions button').click();
    await page.waitForFunction(()=>phoneReview.assistantState()==='ready');
    assert.equal(await page.locator('#assistantAnswer .step.done').count(),3);
    assert.equal(await page.locator('#assistantAnswer .assistant-response').count(),1);
    await page.evaluate(()=>phoneReview.setReviewAssistant('working'));await page.waitForTimeout(400);
    await page.evaluate(()=>phoneReview.showPage('home'));await page.waitForTimeout(1200);
    for(let i=0;i<5;i++){
      assert.deepEqual(await page.evaluate(()=>phoneReview.live().filter(name=>name.startsWith('rb'))),[],'hidden assistant Richboxes must sleep');
      await page.waitForTimeout(150);
    }
    assert.equal(await page.locator('#assistantAnswer .step.cur .step-word').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    // Player's small section label follows the real section start, including the right edge.
    await page.evaluate(()=>phoneReview.setPlayer(true));await page.waitForTimeout(1000);
    assert(await page.evaluate(()=>phoneReview.homeMotion().every(x=>x==='paused')),'covered home orb must pause');
    for(const fraction of [.25,.93]){
      const seek=await page.locator('#seek').boundingBox();await page.mouse.click(seek.x+seek.width*fraction,seek.y+17);await page.waitForTimeout(650);
      const label=await page.locator('#sectionName').boundingBox();assert(label.x>=seek.x-.5&&label.x+label.width<=seek.x+seek.width+.5,'section label stays within seek bounds');
      assert.equal(await page.locator('#sectionName').evaluate(el=>getComputedStyle(el).fontSize),'13px');
      await page.screenshot({path:resolve(out,`design-player-section-${fraction}-${width}.png`)});
    }
    await page.evaluate(()=>phoneReview.openSheet('chat'));
    await page.locator('[data-chat]').first().click();await page.waitForTimeout(500);
    assert.equal(await page.locator('#chatAnswer .rbs svg').count(),1,'same component works in the player sheet');
    await page.evaluate(()=>phoneReview.closeSheet());await page.waitForTimeout(4500);
    assert.deepEqual(await page.evaluate(()=>phoneReview.live().filter(name=>name.startsWith('rb'))),[]);
    await page.close();
  }
  const reduced=await browser.newPage({viewport:{width:412,height:915},reducedMotion:'reduce'});
  reduced.on('pageerror',e=>errors.push(e.message));await reduced.goto(base+'?answer=working');await reduced.waitForTimeout(300);
  assert.deepEqual(await reduced.evaluate(()=>phoneReview.live()),[]);assert.deepEqual(await reduced.evaluate(()=>phoneReview.homeMotion()),[]);
  await reduced.close();
  const baseline=JSON.parse(readFileSync(resolve(here,'baseline/manifest.json'),'utf8'));
  assert.equal(createHash('sha256').update(readFileSync(resolve(here,'out',baseline.html))).digest('hex'),baseline.sha256,'Dream v1 stays byte-identical');
  assert.deepEqual(errors,[]);writeFileSync(resolve(out,'design-results.json'),JSON.stringify({passed:true,states:results,errors,baselineSha256:baseline.sha256},null,2));
  console.log(`PASS: ${results.length} home/assistant states, original Richbox, retry/cancel, hidden motion, typography, section-label placement, frozen Dream v1`);
}finally{await browser.close();}
