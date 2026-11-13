/* Interactive review only. Accepted spring/haptic primitives are loaded from vendor/tactile-lib.js.
 * Playback and server mutations are local simulations. No request leaves this file. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => `${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s)%60)).padStart(2,'0')}`;
const alias = {Flame:'Fire',Droplet:'Water',Queue:'QueueNext',Gamepad:'Quiz',ArrowUp:'Upload'};
function icon(name, size=22) {
  if (name==='More') return '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
  const i = ICONS[alias[name]||name] || ICONS.Sparkles;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${i.w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${i.d.map((d,k)=>`<path d="${d}"${i.fill.includes(k)?' fill="currentColor" stroke="none"':''}/>`).join('')}</svg>`;
}
function paintIcons(root=document){ root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon)); }
paintIcons();
const phone=$('phone'), player=$('player'), tracks=PHONE_DATA.tracks;
const queue=[...tracks], reactions=new Map();
let queueEntry=0;
let current=1, playing=false, basePos=37, baseTime=0, clock=0, pageName='home', state='ready', stream=false;
const currentTrack=()=>queue[current];
const position=()=>playing ? Math.min(currentTrack().d,basePos+(performance.now()-baseTime)/1000) : basePos;
const sections=()=>state==='noSound'?[{start:0,end:currentTrack().d,label:'',kind:'track'}]:currentTrack().sound.sections;
function announce(text){$('reviewLive').textContent=text;}

/* Accepted stack: three visible toasts, swipe dismissal, timer paused under the finger. */
const toastItems=[];
function layoutToasts(){toastItems.forEach((t,i)=>{t.el.style.zIndex=String(10-i);t.el.style.transform=`translate(-50%,${-i*9}px) scale(${1-i*.05})`;t.el.style.opacity=String(i===0?1:.7-i*.15);});}
function toast(text,action,onAction){
  const el=document.createElement('div');el.className='toast';el.innerHTML=`<span>${esc(text)}</span>${action?`<button type="button">${esc(action)}</button>`:''}`;$('toasts').append(el);
  const item={el,timer:0};const close=()=>{clearTimeout(item.timer);const i=toastItems.indexOf(item);if(i<0)return;toastItems.splice(i,1);layoutToasts();el.style.pointerEvents='none';if(REDUCED){el.remove();return;}el.animate([{opacity:1},{opacity:0,transform:el.style.transform+' translateY(14px)'}],{duration:190,easing:'ease-in'}).onfinish=()=>el.remove();};item.close=close;
  if(action)el.querySelector('button').onclick=()=>{onAction?.();close();};
  let sy=null;el.onpointerdown=e=>{clearTimeout(item.timer);if(e.target.closest('button'))return;sy=e.clientY;el.setPointerCapture(e.pointerId);};
  el.onpointermove=e=>{if(sy!==null)el.style.translate=`0 ${Math.max(0,e.clientY-sy)}px`;};
  el.onpointerup=e=>{if(sy===null){clearTimeout(item.timer);item.timer=setTimeout(close,3500);return;}const dy=e.clientY-sy;sy=null;el.style.translate='';dy>30?close():item.timer=setTimeout(close,3500);};
  el.onpointercancel=()=>{sy=null;el.style.translate='';item.timer=setTimeout(close,3500);};
  toastItems.unshift(item);while(toastItems.length>3)toastItems.at(-1).close();el.style.opacity='0';el.style.transform='translate(-50%,24px) scale(.96)';el.getBoundingClientRect();layoutToasts();item.timer=setTimeout(close,3500);
}

/* Cancel is never a completed gesture. Each handler gets the current displacement and velocity. */
function gesture(el,handlers){
  let drag=null;const velocity=tracker();
  el.addEventListener('pointerdown',e=>{if(e.button!==0||handlers.canStart?.(e)===false)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,dy:0,axis:null,target:e.target};velocity.reset();velocity.add(0);handlers.down?.(drag,e);});
  el.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;drag.dx=e.clientX-drag.x;drag.dy=e.clientY-drag.y;if(!drag.axis){if(Math.hypot(drag.dx,drag.dy)<7)return;drag.axis=Math.abs(drag.dx)>Math.abs(drag.dy)?'x':'y';handlers.start?.(drag);if(drag.axis==='none')return;el.setPointerCapture(e.pointerId);}velocity.add(drag.axis==='x'?drag.dx:drag.dy);handlers.move?.(drag,e);});
  el.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;if(d.axis){velocity.add(d.axis==='x'?d.dx:d.dy);handlers.end?.(d,velocity.vel());}else handlers.tap?.(d,e);});
  el.addEventListener('pointercancel',e=>{if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;handlers.cancel?.(d);});
}

/* Shape interpolation is the accepted play/pause morph, with the same physical spring. */
const PLAY_Q=[[[7,4],[13.5,7.75],[13.5,16.25],[7,20]],[[13.5,7.75],[20,12],[20,12],[13.5,16.25]]];
const PAUSE_Q=[[[6,5],[10.5,5],[10.5,19],[6,19]],[[13.5,5],[18,5],[18,19],[13.5,19]]];
function drawMorph(v){
  const t=Math.max(-.08,Math.min(1.08,v));document.querySelectorAll('.morph-play svg').forEach(svg=>svg.querySelectorAll('path').forEach((p,k)=>p.setAttribute('d','M'+PLAY_Q[k].map((xy,i)=>`${lerp(xy[0],PAUSE_Q[k][i][0],t).toFixed(2)} ${lerp(xy[1],PAUSE_Q[k][i][1],t).toFixed(2)}`).join(' L')+' Z')));
}
const morph=createSpring({value:0,stiffness:520,damping:26,precision:.001,name:'playMorph',onUpdate:drawMorph});
const COVER_HINT_KEY='musix.phone.cover-tap.v1';
let coverHintSeen=false;
try{coverHintSeen=localStorage.getItem(COVER_HINT_KEY)==='seen';}catch{}
function renderCoverHint(){
  $('coverHint').hidden=coverHintSeen;
  $('coverHint').textContent=playing?'Коснитесь обложки, чтобы поставить на паузу':'Коснитесь обложки, чтобы слушать';
  if(coverHintSeen)$('coverSlot').removeAttribute('aria-describedby');
}
function tapCover(){
  coverHintSeen=true;try{localStorage.setItem(COVER_HINT_KEY,'seen');}catch{}
  renderCoverHint();setPlaying(!playing);
}
function setPlaying(value,byUser=true){
  if(value===playing)return;basePos=position();baseTime=performance.now();playing=value;
  player.classList.toggle('playing',value);player.classList.toggle('paused',!value);morph.to(value?1:0);coverScale.to(value?1:1.03);
  ['miniPlay','coverSlot'].forEach(id=>$(id).setAttribute('aria-label',value?'Пауза':'Воспроизвести'));
  if(byUser)haptic(value?'toggleOn':'toggleOff');runClock();renderPosition();renderCoverHint();syncHomeMotion();
}
function runClock(){clearInterval(clock);clock=0;if(playing&&!document.hidden)clock=setInterval(()=>{if(position()>=currentTrack().d){if(current<queue.length-1)setTrack(current+1);else setPlaying(false,false);}renderPosition();},250);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){basePos=position();baseTime=performance.now();}runClock();player.classList.toggle('hidden-document',document.hidden);});
function setPosition(p){basePos=Math.max(0,Math.min(currentTrack().d,p));baseTime=performance.now();renderPosition();}
function waveUri(color){return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='48' height='24'><path d='M-48 12 Q-36 5.6 -24 12 T0 12 T24 12 T48 12 T72 12' stroke='${color}' stroke-width='3.5' fill='none'/></svg>`)}")`;}
function renderSeek(){
  const color=currentTrack().palette.accent?.dark||'#d0badf';
  $('segments').innerHTML=sections().map(s=>`<div class="segment ${s.kind==='chorus'?'chorus':''}" style="left:${s.start/currentTrack().d*100}%;width:${(s.end-s.start)/currentTrack().d*100}%"><i class="segment-base"></i></div>`).join('');
  $('seekWave').style.backgroundImage=waveUri(color);
  const moments=state==='noSound'?[]:currentTrack().sound.moments.filter(m=>!['bass_in','bass_back','beat_back'].includes(m.kind)&&!m.label.includes('новая партия'));
  $('moments').innerHTML=moments.slice(0,5).map(m=>`<button class="moment" style="--at:${m.t/currentTrack().d*100}%" aria-label="${esc(m.label)}" title="${esc(m.label)}" data-moment="${m.t}"></button>`).join('');
  $('moments').querySelectorAll('button').forEach(b=>b.onclick=e=>{e.stopPropagation();setPosition(Math.max(0,Number(b.dataset.moment)-2));toast(b.title);});renderPosition();
}
let shownSection=null,sectionKey='';
function positionSectionName(){
  if(!shownSection)return;
  const label=$('sectionName'),width=$('seek').clientWidth,start=clamp01(shownSection.start/currentTrack().d)*width;
  const x=Math.max(0,Math.min(start,width-label.offsetWidth));
  label.style.transform=`translateX(${x}px)`;label.style.setProperty('--section-tick',`${start-x}px`);
}
function renderSectionName(section){
  const raw=section?.label||'',label=raw?raw[0].toLocaleUpperCase('ru')+raw.slice(1):'';
  const key=`${currentTrack().id}:${section?.start}:${label}`;
  if(key===sectionKey)return;sectionKey=key;shownSection=section;
  $('sectionName').textContent=label;positionSectionName();
  if(label&&!REDUCED)$('sectionName').animate([{opacity:.3,filter:'blur(2px)'},{opacity:1,filter:'none'}],{duration:320,easing:'ease-out'});
}
new ResizeObserver(positionSectionName).observe($('seek'));
document.fonts.ready.then(positionSectionName);
function renderPosition(){
  const p=position(),duration=currentTrack().d,f=clamp01(p/duration),parts=sections();
  $('elapsed').textContent=fmt(p);$('duration').textContent=fmt(duration);$('seek').setAttribute('aria-valuenow',String(Math.round(f*100)));$('seek').setAttribute('aria-valuetext',`${fmt(p)} из ${fmt(duration)}`);$('seekThumb').style.left=`${f*100}%`;$('miniProgress').style.transform=`scaleX(${f})`;
  $('seekPlayed').style.width=`${f*100}%`;
  renderSectionName(parts.find(s=>p>=s.start&&p<s.end)||parts.at(-1));
  $('prev').disabled=current===0&&p<3;
}
function refreshTrack(){
  const t=currentTrack(),accent=t.palette.accent?.dark||'#c6b5e7';phone.style.setProperty('--acc',accent);
  syncCoverCards();$('miniArt').src=t.cover;
  backdropCards.forEach((el,id)=>el.classList.toggle('active',id===(t.sourceId||t.id)));
  $('trackTitle').textContent=state==='long'?'Очень длинное название песни, которое занимает две строки':t.t;$('trackArtist').textContent=t.a;$('trackAlbum').textContent=[t.album,t.year].filter(Boolean).join(' · ');$('trackVibe').textContent=t.vibe||'';
  $('miniTitle').textContent=t.t;$('miniArtist').textContent=t.a;$('lyricsTitle').textContent=t.t;
  $('streamReason').hidden=!stream;$('shuffle').disabled=stream;
  const next=queue[current+1]||queue[0];$('nextArt').src=next.cover;$('nextTitle').textContent=next===t?'Очередь закончилась':`${next.t} · ${next.a}`;
  $('prev').disabled=current===0&&position()<3;$('next').disabled=current===queue.length-1;$('miniNext').disabled=current===queue.length-1;
  ['fire','water'].forEach(id=>$(id).setAttribute('aria-pressed',String(reactions.get(t.id)===id)));
  renderSeek();if(sheetName==='queue')renderQueue();
}
function selectTrack(index){
  current=Math.max(0,Math.min(queue.length-1,index));basePos=0;baseTime=performance.now();
  $('coverFlip')?.classList.remove('flipped');$('lyrics').setAttribute('aria-pressed','false');refreshTrack();
  if(!REDUCED)$('trackTitle').animate([{opacity:.3,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:320,easing:'cubic-bezier(.2,.9,.3,1)'});
}
function setTrack(index){artSpring.set(Math.max(0,Math.min(queue.length-1,index)));selectTrack(index);}

/* A persistent deck in track coordinates: the arriving card IS the active card.
 * Never swap an image or rebuild metadata at spring rest. No layout reads per frame. */
const coverCards=new Map(),backdropCards=new Map();
let deckPosition=current,artScale=1.03,coverStep=300;
for(const track of tracks){
  const bg=new Image();bg.src=track.bg;bg.alt='';bg.decoding='async';$('backdrop').append(bg);backdropCards.set(track.id,bg);
  for(const src of [track.cover,track.blur]){const image=new Image();image.src=src;image.decode().catch(()=>{});}
}
function syncCoverCards(){
  const needed=new Set();
  for(const center of [current,Math.round(deckPosition)])for(let i=center-1;i<=center+1;i++)if(queue[i])needed.add(queue[i].id);
  for(const [id,card] of coverCards){if(!needed.has(id)){card.el.remove();coverCards.delete(id);}else{card.el.removeAttribute('id');card.el.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));}}
  queue.forEach((track,index)=>{
    if(!needed.has(track.id))return;
    let card=coverCards.get(track.id);
    if(!card){
      const el=$('coverTemplate').content.firstElementChild.cloneNode(true);el.dataset.trackId=track.id;
      el.querySelector('[data-part=coverArt]').src=track.cover;el.querySelector('[data-part=coverArt]').alt=`${track.album||track.t} — ${track.a}`;
      el.querySelector('[data-part=coverBlur]').src=track.blur;el.querySelector('[data-part=lyricsTitle]').textContent=track.t;
      $('coverSlot').prepend(el);card={el,index};coverCards.set(track.id,card);
    }
    card.index=index;const active=index===current;card.el.inert=!active;card.el.setAttribute('aria-hidden',String(!active));
    if(active){card.el.id='cover';card.el.querySelectorAll('[data-part]').forEach(el=>el.id=el.dataset.part);}
  });
  drawMorph(morph.value);drawCover();
}
function drawCover(){
  for(const {el,index} of coverCards.values()){
    const distance=index-deckPosition,phase=Math.sin(Math.PI*Math.min(1,Math.abs(distance))),tilt=REDUCED?0:Math.max(-1,Math.min(1,distance));
    el.style.transform=`translate3d(${distance*coverStep}px,${REDUCED?0:-phase*5}px,0) rotate(${tilt*.9}deg) scale(${artScale-(REDUCED?0:phase*.022)})`;
    el.style.zIndex=String(4-Math.min(3,Math.round(Math.abs(distance))));
    el.style.opacity=String(1-clamp01((Math.abs(distance)-.78)/.22));
    el.style.visibility=Math.abs(distance)<1.45?'visible':'hidden';
  }
}
const artSpring=createSpring({value:current,stiffness:240,damping:25,mass:1.15,precision:.00035,name:'coverSwipe',onUpdate:v=>{deckPosition=v;drawCover();}});
const coverScale=createSpring({value:1.03,stiffness:240,damping:22,mass:1.1,precision:.0005,name:'coverPause',onUpdate:v=>{artScale=v;drawCover();}});
new ResizeObserver(([entry])=>{coverStep=entry.contentRect.width+24;drawCover();}).observe($('coverSlot'));
function changeTrack(dir,velocity){
  const target=current+dir,options=velocity===undefined?{}:{velocity:-velocity/coverStep};
  if(target<0||target>=queue.length){artSpring.to(current,options);return;}
  selectTrack(target);artSpring.to(current,options);
}
let crossed=0,coverStart=0;
gesture($('coverSlot'),{
  canStart:e=>!e.target.closest('button')&&!$('coverFlip').classList.contains('flipped'),
  down:()=>{coverStart=artSpring.value;artSpring.set(coverStart);crossed=0;coverScale.to(.985);},
  start:d=>{if(d.axis!=='x')d.axis='none';},
  move:d=>{if(d.axis!=='x')return;const w=coverStep-24;let x=(current-coverStart)*coverStep+d.dx;const boundary=(current===0&&x>0)||(current===queue.length-1&&x<0);if(boundary)x=x/(1+Math.abs(x)/70)*.4;else if(Math.abs(x)>w)x=Math.sign(x)*(w+(Math.abs(x)-w)*.2);artSpring.set(current-x/coverStep);const c=boundary?0:x<-w*.28?1:x>w*.28?-1:0;if(c!==crossed){haptic(c?'threshold':'thresholdOff');crossed=c;}},
  end:(d,v)=>{coverScale.to(playing?1:1.03);if(d.axis!=='x'){artSpring.to(current);return;}const x=(current-deckPosition)*coverStep,dir=Math.abs(v)>650?-Math.sign(v):Math.abs(x)>(coverStep-24)*.28?-Math.sign(x):0;if(dir)changeTrack(dir,v);else artSpring.to(current,{velocity:-v/coverStep});},
  cancel:()=>{coverScale.to(playing?1:1.03);artSpring.to(current);},tap:()=>{artSpring.to(current);tapCover();}
});
$('coverSlot').onkeydown=e=>{if(e.target!==$('coverSlot'))return;if(e.key==='Enter'||e.key===' '){e.preventDefault();tapCover();}};
$('prev').onclick=()=>position()>3?setPosition(0):changeTrack(-1);$('next').onclick=()=>changeTrack(1);$('miniNext').onclick=e=>{e.stopPropagation();if(current<queue.length-1)setTrack(current+1);};
$('miniPlay').onclick=e=>{e.stopPropagation();setPlaying(!playing);};

/* One phase and one clip for the entire played wave, over persistent section markers. */
let seeking=false,lastTen=-1;
const seekAt=x=>{const r=$('seek').getBoundingClientRect();const f=clamp01((x-r.left)/r.width);setPosition(f*currentTrack().d);const ten=Math.floor(f*10);if(ten!==lastTen){if(lastTen>=0)haptic('tick');lastTen=ten;}};
$('seek').onpointerdown=e=>{if(e.target.closest('button'))return;seeking=true;lastTen=-1;$('seek').setPointerCapture(e.pointerId);seekAt(e.clientX);};$('seek').onpointermove=e=>{if(seeking)seekAt(e.clientX);};$('seek').onpointerup=$('seek').onpointercancel=()=>{seeking=false;};
$('seek').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const p=position();setPosition(e.key==='Home'?0:e.key==='End'?currentTrack().d:p+(e.key==='ArrowRight'?5:-5));if(Math.floor(p/currentTrack().d*10)!==Math.floor(position()/currentTrack().d*10))haptic('tick');}};
$('lyrics').onclick=()=>{const on=$('coverFlip').classList.toggle('flipped');$('lyrics').setAttribute('aria-pressed',String(on));};
$('shuffle').onclick=()=>{$('shuffle').setAttribute('aria-pressed',String($('shuffle').getAttribute('aria-pressed')!=='true'));};

/* The accepted one-shot reaction burst sleeps as soon as its particles expire. */
let burstFrame=0,particles=[];
function burst(button,water=false){
  if(REDUCED)return;const canvas=$('burst'),rect=phone.getBoundingClientRect(),b=button.getBoundingClientRect();canvas.width=phone.clientWidth;canvas.height=phone.clientHeight;const x=b.left-rect.left+b.width/2,y=b.top-rect.top+b.height/2;
  for(let i=0;i<16;i++){const a=Math.random()*Math.PI*2,s=2.5+Math.random()*4.5;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1.5,r:2.5+Math.random()*3,life:1,c:(water?['#85d9fa','#d8f8ff','#83a5ff']:['#ff8a3c','#ffd36e','#fff','#ff5e3a'])[i%(water?3:4)]});}
  const ctx=canvas.getContext('2d');function frame(){ctx.clearRect(0,0,canvas.width,canvas.height);particles.forEach(p=>{p.vx*=.9;p.vy=p.vy*.9+.1;p.x+=p.vx;p.y+=p.vy;p.life-=.03;});particles=particles.filter(p=>p.life>0);particles.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.c;ctx.beginPath();ctx.arc(p.x,p.y,p.r*p.life+.6,0,7);ctx.fill();});ctx.globalAlpha=1;if(particles.length)burstFrame=requestAnimationFrame(frame);else{burstFrame=0;live('burst',false);}}if(!burstFrame){live('burst',true);burstFrame=requestAnimationFrame(frame);}
}
['fire','water'].forEach(id=>$(id).onclick=()=>{const on=reactions.get(currentTrack().id)!==id;reactions.set(currentTrack().id,on?id:null);['fire','water'].forEach(k=>$(k).setAttribute('aria-pressed',String(on&&id===k)));haptic(on?'toggleOn':'toggleOff');if(on)burst($(id),id==='water');if(!REDUCED)$(id).querySelector('svg').animate([{transform:'none'},{transform:'scale(1.45) rotate(8deg)',offset:.35},{transform:'none'}],{duration:520,easing:cssVar('--spring')||'ease-out'});});

/* Shared elements fly while the page loses focus. The background never slides as a rectangle. */
let expansion=0,flight=null,playerTarget=0;
function measureFlight(){
  $('coverSlot').style.transform='';const r=phone.getBoundingClientRect(),mini=$('miniArt').getBoundingClientRect(),cover=$('coverSlot').getBoundingClientRect();flight={dx:mini.left-cover.left,dy:mini.top-cover.top,scale:mini.width/cover.width};
}
function drawExpansion(p){
  expansion=p;const t=clamp01(p);player.classList.toggle('visually-closed',t<.001);player.style.visibility=t<.001?'hidden':'visible';$('backdrop').style.opacity=String(t);player.querySelector('.player-shade').style.opacity=String(t);$('pages').style.opacity=String(1-t*.75);$('pages').style.filter=REDUCED?'':`blur(${t*14}px)`;
  $('mini').style.opacity=String(1-clamp01(t*3));$('nav').style.opacity=String(1-clamp01(t*2));
  $('mini').style.pointerEvents=t>.01?'none':'';$('nav').style.pointerEvents=t>.01?'none':'';
  if(flight){$('coverSlot').style.transformOrigin='top left';$('coverSlot').style.transform=`translate(${flight.dx*(1-t)}px,${flight.dy*(1-t)}px) scale(${lerp(flight.scale,1,t)})`;}
  $('playerLayout').querySelectorAll(':scope > :not(.cover-area)').forEach(el=>el.style.opacity=String(clamp01((t-.35)/.6)));
  if(t===0||t===1)$('coverSlot').style.willChange='auto';else $('coverSlot').style.willChange='transform';
}
const expandSpring=createSpring({value:0,stiffness:400,damping:38,precision:.001,name:'miniToPlayer',onUpdate:drawExpansion});
function setPlayer(open,velocity=0){
  player.classList.toggle('expanded',open);
  playerTarget=open?1:0;if(!flight)measureFlight();player.inert=!open;player.setAttribute('aria-hidden',String(!open));$('pages').inert=open;$('nav').inert=open;$('mini').inert=open;
  syncScreenMotion();
  expandSpring.to(open?1:0,{velocity,onRest:()=>{if(!open){flight=null;$('mini').focus({preventScroll:true});}else $('collapse').focus({preventScroll:true});}});
}
$('collapse').onclick=()=>setPlayer(false);
let expansionBase=0,passed=false;
const expansionGesture=(el,fromMini)=>gesture(el,{
  canStart:e=>!e.target.closest('button'),down:()=>{measureFlight();expansionBase=expansion;passed=false;expandSpring.onRest=null;},start:d=>{if(d.axis!=='y')d.axis='none';player.style.visibility='visible';},
  move:d=>{if(d.axis!=='y')return;const p=Math.max(0,Math.min(1.03,expansionBase-d.dy/(phone.clientHeight*.8)));expandSpring.set(p);const threshold=fromMini?p>.2:p<.78;if(threshold!==passed){passed=threshold;haptic(threshold?'threshold':'thresholdOff');}},
  end:(d,v)=>{if(d.axis!=='y')return;const open=fromMini?(expansion>.2||v< -500):!(expansion<.78||v>700);setPlayer(open,-v/(phone.clientHeight*.8));},cancel:()=>setPlayer(!!playerTarget),tap:()=>{if(fromMini)setPlayer(true);}
});
expansionGesture($('mini'),true);expansionGesture($('playerHandle'),false);
$('mini').onkeydown=e=>{if(e.target===$('mini')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setPlayer(true);}};
new ResizeObserver(()=>{if(expansion===1){flight=null;$('coverSlot').style.transform='';}drawCover();}).observe(phone);

/* One solid sheet, focus contained while open, and back/escape returns to its trigger. */
let sheetName='',sheetTrigger=null,detailTrack=null;
const sheetSpring=createSpring({value:1.05,stiffness:420,damping:40,precision:.002,name:'bottomSheet',onUpdate:v=>{$('sheet').style.transform=`translateY(${v*100}%)`;$('sheet').style.visibility=v>=1.04&&!sheetName?'hidden':'visible';}});
function openSheet(name,track=null){
  if(!sheetName)sheetTrigger=document.activeElement;detailTrack=track;sheetName=name;renderSheet(name);$('scrim').hidden=false;requestAnimationFrame(()=>$('scrim').style.opacity='1');$('sheet').inert=false;$('sheet').setAttribute('aria-hidden','false');sheetSpring.to(0,{onRest:()=>{const target=$('sheetBody').querySelector('input')||$('sheetClose');target.focus({preventScroll:true});}});player.inert=true;$('pages').inert=true;$('mini').inert=true;$('nav').inert=true;syncScreenMotion();
}
function closeSheet(velocity=0){
  if(!sheetName)return;sheetName='';$('sheet').inert=true;$('sheet').setAttribute('aria-hidden','true');$('scrim').style.opacity='0';sheetSpring.to(1.05,{velocity,onRest:()=>{$('scrim').hidden=true;}});player.inert=!playerTarget;$('pages').inert=!!playerTarget;$('mini').inert=!!playerTarget;$('nav').inert=!!playerTarget;sheetTrigger?.focus?.({preventScroll:true});syncScreenMotion();
}
$('sheetClose').onclick=$('scrim').onclick=()=>closeSheet();
for(const el of [$('sheetHeader'),$('sheetGrab')])gesture(el,{canStart:e=>!e.target.closest('button'),start:d=>{if(d.axis!=='y')d.axis='none';},move:d=>{if(d.axis==='y')sheetSpring.set(Math.max(-.025,d.dy/$('sheet').offsetHeight));},end:(d,v)=>{if(d.axis==='y'){if(d.dy>$('sheet').offsetHeight*.28||v>650)closeSheet(v/$('sheet').offsetHeight);else sheetSpring.to(0,{velocity:v/$('sheet').offsetHeight});}},cancel:()=>sheetSpring.to(0)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(sheetName)closeSheet();else if(playerTarget)setPlayer(false);}if(e.key==='Tab'&&sheetName){const all=[...$('sheet').querySelectorAll('button,input,[tabindex="0"]')].filter(el=>!el.disabled&&el.offsetWidth);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-sheet]');if(b)openSheet(b.dataset.sheet);});

const row=t=>`<button class="list-row" data-track="${esc(t.id)}"><img src="${t.cover}" alt=""><span><b>${esc(t.t)}</b><small>${esc(t.a)}</small></span><small>${fmt(t.d)}</small>${icon('Play')}</button>`;
const titles={queue:'Далее',about:'О песне',playlist:'В плейлист',more:'Сейчас играет',devices:'Слушать на…',album:'Разворот',artist:'Артист',chat:'Спросить о песне',settings:'Настройки',search:'Найти в библиотеке',tune:'Настроить волну',groups:'Группы',stats:'Статистика',add:'Добавить музыку'};
const addedToLists=new Map();
function renderSheet(name){
  const body=$('sheetBody'),t=detailTrack||currentTrack();$('sheetTitle').textContent=titles[name]||name;body.innerHTML='';body.scrollTop=0;
  if(homeRenderSheet(name))return;
  if(name==='queue'){body.innerHTML='<p class="muted">Тяните за ручку. Смахните песню, чтобы убрать.</p><div id="queueRows"></div>';renderQueue();return;}
  if(name==='about'){
    body.innerHTML=`<div class="segment-control"><button aria-pressed="true" data-about-tab="song">Песня</button><button aria-pressed="false" data-about-tab="sound">Звук</button></div><div id="aboutContent"></div>`;
    const aboutTab=tab=>{body.querySelectorAll('[data-about-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.aboutTab===tab)));$('aboutContent').innerHTML=tab==='song'?`<div class="facts-plate"><small>О песне</small>${esc(t.vibe||'История этой песни пока недоступна.')}</div><dl class="credits"><div><dt>Артист</dt><dd><button class="link" data-sheet="artist">${esc(t.a)}</button></dd></div><div><dt>Альбом</dt><dd>${esc(t.album||'Не указан')}</dd></div><div><dt>Год</dt><dd>${t.year||'—'}</dd></div>${t.producer?`<div><dt>Продюсер</dt><dd>${esc(t.producer)}</dd></div>`:''}</dl><button class="text-action" data-sheet="chat">Спросить ассистента ›</button>`:soundContent(t);};
    body.querySelectorAll('[data-about-tab]').forEach(b=>b.onclick=()=>aboutTab(b.dataset.aboutTab));aboutTab('song');
  }else if(name==='playlist'){
    body.innerHTML=`<p class="muted">${esc(t.t)} · ${esc(t.a)}</p><div id="playlistRows"></div><form id="newPlaylist" class="composer"><input required maxlength="60" aria-label="Название плейлиста" placeholder="Новый плейлист"><button class="icon" aria-label="Создать плейлист">${icon('Plus')}</button></form>`;
    const draw=()=>{$('playlistRows').innerHTML=['На повторе','Для вечера',...extraLists].map((name,i)=>`<button class="list-row" data-list="${i}"><img src="${tracks[i%tracks.length].cover}" alt=""><span><b>${esc(name)}</b><small>${addedToLists.get(name)?.has(t.id)?'Добавлено ✓':'Добавить песню'}</small></span>${icon(addedToLists.get(name)?.has(t.id)?'Check':'Plus')}</button>`).join('');$('playlistRows').querySelectorAll('button').forEach(b=>b.onclick=()=>{const name=['На повторе','Для вечера',...extraLists][Number(b.dataset.list)];const set=addedToLists.get(name)||new Set();set.add(t.id);addedToLists.set(name,set);haptic('confirm');draw();toast(`Добавлено в «${name}»`);});};
    $('newPlaylist').onsubmit=e=>{e.preventDefault();const name=e.target.querySelector('input').value.trim();if(!name)return;extraLists.push(name);e.target.reset();draw();};draw();
  }else if(name==='more'){
    body.innerHTML=`<button class="list-row" data-sheet="devices">${icon('Devices')}<span><b>Слушать на…</b><small>Этот телефон и другие устройства</small></span>${icon('ChevronRight')}</button><button class="list-row" data-sheet="playlist">${icon('Plus')}<span><b>В плейлист</b></span>${icon('ChevronRight')}</button><button class="list-row" data-sheet="album">${icon('Library')}<span><b>Открыть альбом</b></span>${icon('ChevronRight')}</button>`;
  }else if(name==='devices'){
    body.innerHTML=`<button class="device-row" id="deviceHere">${icon('Phone')}<div><b>Этот телефон</b><small>Pixel 9 Pro</small></div>${icon(state==='elsewhere'?'Play':'Check')}</button><button class="device-row" id="deviceThere">${icon('Monitor')}<div><b>MusiX Web</b><small>Доступно для воспроизведения</small></div>${icon(state==='elsewhere'?'Check':'Play')}</button>`;
    $('deviceHere').onclick=()=>{setState('ready');closeSheet();toast('Играет на этом телефоне');};$('deviceThere').onclick=()=>{setState('elsewhere');closeSheet();};
  }else if(name==='album'){
    body.innerHTML=`<img class="sheet-art" src="${t.cover}" alt="${esc(t.album)}"><h3>${esc(t.album||t.t)}</h3><p class="muted">${esc(t.a)} · ${t.year||''}</p><div class="sheet-actions"><button class="pill" id="albumPlay">${icon('Play')} Слушать</button><button class="morph-button" id="enqueue">В очередь ${icon('Plus')}</button></div>${row(t)}<p class="source-note">Откройте песню или добавьте её в очередь.</p>`;
    $('albumPlay').onclick=()=>{let i=queue.indexOf(t);if(i<0){queue.push(t);i=queue.length-1;}setTrack(i);setPlaying(true,false);closeSheet();setPlayer(true);};wireMorph($('enqueue'),t);
  }else if(name==='artist'){
    body.innerHTML=`<img class="sheet-art" src="${t.cover}" alt=""><h3>${esc(t.a)}</h3><p>Песни в вашей библиотеке</p>${tracks.filter(a=>a.a===t.a).map(row).join('')}<button class="text-action" data-sheet="about">Вернуться к песне ›</button>`;
  }else if(name==='chat'){
    body.innerHTML=`<p class="muted">${esc(t.t)} · ${esc(t.a)}</p><div class="ask-presets"><button data-chat="Что означает название песни?">О названии</button><button data-chat="Как устроено звучание?">О звучании</button></div><div id="chatAnswer"></div><form class="composer lg" id="chatForm"><input required aria-label="Вопрос о песне" placeholder="О чём эта песня?"><button class="icon" aria-label="Отправить">${icon('ArrowUp')}</button></form>`;
    body.querySelectorAll('[data-chat]').forEach(b=>b.onclick=()=>simulateAnswer($('chatAnswer'),b.dataset.chat));$('chatForm').onsubmit=e=>{e.preventDefault();const input=e.target.querySelector('input');simulateAnswer($('chatAnswer'),input.value);input.value='';};
  }else if(name==='settings'){
    body.innerHTML=`<div class="setting-row"><span>Тактильный отклик</span><button class="switch" role="switch" aria-label="Тактильный отклик" aria-checked="${hapticState.on}" id="hapticSwitch"></button></div><div class="setting-row"><span>Показывать тип вибрации</span><button class="switch" role="switch" aria-label="Показывать тип вибрации" aria-checked="${hapticState.show}" id="hapticShow"></button></div><button class="list-row" data-sheet="devices"><span><b>Устройства</b></span>${icon('ChevronRight')}</button><p class="source-note">Тактильный отклик помогает почувствовать действие. Его можно отключить здесь.</p>`;
    $('hapticSwitch').onclick=e=>{hapticState.on=!hapticState.on;e.currentTarget.setAttribute('aria-checked',String(hapticState.on));$('reviewHaptic').checked=hapticState.on;};$('hapticShow').onclick=e=>{hapticState.show=!hapticState.show;e.currentTarget.setAttribute('aria-checked',String(hapticState.show));};
  }else if(name==='search'){
    body.innerHTML='<input class="search-input lg" id="searchInput" type="search" aria-label="Поиск в библиотеке" placeholder="Песня, альбом или артист"><div class="search-results" id="searchResults"></div>';
    const search=()=>{const q=$('searchInput').value.toLocaleLowerCase('ru');const found=tracks.filter(t=>`${t.t} ${t.a} ${t.album}`.toLocaleLowerCase('ru').includes(q));$('searchResults').innerHTML=found.length?found.map(row).join(''):'<p class="source-note">В этом снимке ничего не найдено</p>';};$('searchInput').oninput=search;search();
  }else if(name==='tune'){
    body.innerHTML='<p>Что поставить в Поток?</p><div class="segment-control" id="tuneSegments"><button aria-pressed="true">Всё</button><button aria-pressed="false">Знакомое</button><button aria-pressed="false">Новое</button></div><button class="pill" id="tuneStart">Включить Поток</button>';
    body.querySelectorAll('#tuneSegments button').forEach(b=>b.onclick=()=>body.querySelectorAll('#tuneSegments button').forEach(x=>x.setAttribute('aria-pressed',String(x===b))));$('tuneStart').onclick=()=>{stream=true;refreshTrack();closeSheet();setPlaying(true,false);setPlayer(true);};
  }else if(name==='groups'){
    body.innerHTML=['Заслушаны до дыр','Часто на повторе','Ещё не распечатаны'].map((s,i)=>`<button class="list-row" data-group="${i}"><span><b>${s}</b></span>${icon('ChevronRight')}</button>`).join('');body.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{closeSheet();toast(b.textContent.trim());});
  }else if(name==='stats'){
    body.innerHTML='<p>Эта неделя: 3 часа 16 минут с музыкой. Самый долгий день — 52 минуты.</p>';
  }else if(name==='add'){
    body.innerHTML='<p>Загрузите свои файлы или перенесите плейлисты из Яндекс Музыки.</p><button class="text-action" data-sheet="queue">Пока послушать очередь ›</button>';
  }
  decorateHomeSheet(name,t,body);paintIcons(body);
}
const extraLists=[];
function soundContent(t){
  const r=t.sound.ratings||{};const scales=[['Техничность',r.technical??r.tech??0,'#e4bf72'],['Простор',r.space??0,'#82b9df'],['Необычность',r.unusual??r.odd??0,'#c599de']];
  return `<div class="sound-bars">${scales.map(([name,value,color])=>`<label>${name}<i style="--value:${Math.max(0,Math.min(100,Number(value)))}%;--tone:${color}"></i><span>${Math.round(value)}</span></label>`).join('')}</div><p class="source-note">Техничность, простор и необычность звучания.</p><div class="credits">${t.sound.instruments.map(i=>`<span>${esc(i.label)}</span>`).join(' · ')}</div>`;
}
function wireMorph(button,t){let entry=null;const original=128;button.style.width=original+'px';button.onclick=()=>{const on=!entry;if(on){entry={...t,sourceId:t.sourceId||t.id,id:`${t.id}:queued-${++queueEntry}`};queue.push(entry);}else{const i=queue.indexOf(entry);if(i===current){haptic('reject');toast('Сейчас играет — не убрать');return;}const active=currentTrack();queue.splice(i,1);current=queue.indexOf(active);artSpring.set(current);entry=null;}haptic(on?'toggleOn':'toggleOff');button.classList.toggle('on',on);button.style.width=(on?156:original)+'px';button.innerHTML=on?`В очереди ${icon('Check')}`:`В очередь ${icon('Plus')}`;refreshTrack();toast(on?'Песня добавлена в очередь':'Добавление отменено');};}

/* Same reorder/swipe interaction as the accepted showcase, with keyboard alternatives. */
function renderQueue(){
  const host=$('queueRows');if(!host)return;host.innerHTML=queue.map((t,i)=>`<div class="qrow ${i===current?'now':''}" data-id="${t.id}"><div class="del">Убрать</div><div class="in"><img src="${t.cover}" alt=""><button class="qmeta" data-play-row="${i}" style="text-align:left;padding:0"><b>${esc(t.t)}</b><small>${i===current?'Сейчас играет':esc(t.a)}</small></button><button class="qremove" aria-label="Убрать ${esc(t.t)}" data-remove-row="${i}">×</button><button class="handle" aria-label="Переставить ${esc(t.t)}" title="Тянуть или нажать ↑ / ↓">⠿</button></div></div>`).join('');
  [...host.children].forEach((r,i)=>{
    const inn=r.querySelector('.in'),handle=r.querySelector('.handle');
    r.querySelector('[data-play-row]').onclick=()=>{setTrack(i);setPlaying(true,false);};r.querySelector('[data-remove-row]').onclick=()=>removeFromQueue(i);
    handle.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const target=Math.max(0,Math.min(queue.length-1,i+(e.key==='ArrowUp'?-1:1)));if(target!==i){moveQueue(i,target);haptic('tick');$('queueRows').children[target].querySelector('.handle').focus();}}};
    let target=i,initialRows=[];gesture(handle,{down:()=>{target=i;initialRows=[...host.children];},start:d=>{d.axis='y';r.classList.add('lift');haptic('lift');},move:d=>{inn.style.transform=`translateY(${d.dy}px) scale(1.03)`;const next=Math.max(0,Math.min(queue.length-1,Math.round(i+d.dy/62)));if(target!==next){target=next;haptic('tick');initialRows.forEach((row,k)=>{if(k===i)return;row.style.transition='transform 280ms var(--spring)';row.style.transform=`translateY(${k>i&&k<=next?-62:k<i&&k>=next?62:0}px)`;});}},end:()=>{haptic('drop');moveQueue(i,target);},cancel:()=>renderQueue()});
    let over=false;gesture(inn,{canStart:e=>!e.target.closest('.handle,.qremove'),start:d=>{over=false;if(d.axis!=='x')d.axis='none';},move:d=>{if(d.axis!=='x')return;const dx=Math.min(0,d.dx);inn.style.transform=`translateX(${dx}px)`;r.querySelector('.del').style.opacity=String(clamp01(-dx/70));const yes=-dx>r.offsetWidth*.38;if(yes!==over){over=yes;haptic(yes?'threshold':'thresholdOff');}},end:d=>{if(d.axis==='x'){if(over)removeFromQueue(i);else renderQueue();}},cancel:()=>renderQueue()});
  });
}
function moveQueue(from,to){const track=currentTrack();const [item]=queue.splice(from,1);queue.splice(to,0,item);current=queue.indexOf(track);artSpring.set(current);renderQueue();refreshTrack();}
function removeFromQueue(index){
  if(index===current){haptic('reject');toast('Сейчас играет — не убрать');renderQueue();return;}
  const track=currentTrack(),[item]=queue.splice(index,1);current=queue.indexOf(track);artSpring.set(current);refreshTrack();renderQueue();toast(`Убрали «${item.t}»`,'Вернуть',()=>{const playingTrack=currentTrack();queue.splice(Math.min(index,queue.length),0,item);current=queue.indexOf(playingTrack);artSpring.set(current);refreshTrack();renderQueue();});
}

/* Shell pages are context for the navigation review; full compositions have later stages. */
function tile(t){return `<button class="album-tile" data-album="${t.id}"><img src="${t.cover}" alt="${esc(t.album||t.t)}"><b>${esc(t.album||t.t)}</b><small>${esc(t.a)}</small></button>`;}
$('homeAlbums').innerHTML=tracks.slice(0,3).map(tile).join('');$('vibes').innerHTML=tracks.slice(0,2).map((t,i)=>`<button class="vibe" data-track="${t.id}"><span class="vibe-pile">${[2,1,0].map(k=>`<img src="${tracks[(i+k)%tracks.length].cover}" alt="">`).join('')}</span><span>${i?'Вечерний свет':'Чуть громче'}</span></button>`).join('');
function libraryTab(index){
  const host=$('libraryContent');$('libraryTabs').querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-selected',String(index===i)));const b=$('libraryTabs').querySelectorAll('button')[index];$('libraryTabs').lastElementChild.style.width=b.offsetWidth+'px';$('libraryTabs').lastElementChild.style.transform=`translateX(${b.offsetLeft}px)`;
  if(index===0)host.innerHTML=`<h3>Заслушаны до дыр</h3><div class="wall">${tracks.map(tile).join('')}</div>`;
  if(index===1)host.innerHTML=tracks.map(t=>`<button class="list-row" data-artist="${t.id}"><img src="${t.cover}" alt="" style="border-radius:50%"><span><b>${esc(t.a)}</b><small>${esc(t.album)}</small></span>${icon('ChevronRight')}</button>`).join('');
  if(index===2)host.innerHTML=['На повторе','Для вечера'].map((s,i)=>`<button class="list-row" data-sheet="playlist"><img src="${tracks[i].cover}" alt=""><span><b>${s}</b><small>Личная подборка</small></span>${icon('ChevronRight')}</button>`).join('');
  if(index===3)host.innerHTML='<h3>Ваша музыка в цифрах</h3><p class="source-note">История прослушиваний пока не загружена.</p><button class="pill" data-sheet="stats">Открыть</button>';
}
let pageChange=0;
async function showPage(name){
  if(name===pageName)return;const token=++pageChange,old=$('page-'+pageName),next=$('page-'+name);pageName=name;syncScreenMotion();
  $('nav').querySelectorAll('button').forEach((b,i)=>{if(b.dataset.page===name){b.setAttribute('aria-current','page');$('navLens').style.transform=`translateX(${i*100}%)`;}else b.removeAttribute('aria-current');});
  if(!REDUCED)await old.animate([{opacity:1,filter:'blur(0px)',transform:'none'},{opacity:0,filter:'blur(8px)',transform:'translateY(-12px)'}],{duration:180,easing:'ease-in'}).finished.catch(()=>{});
  if(token!==pageChange)return;document.querySelectorAll('.page').forEach(p=>p.hidden=p!==next);old.classList.remove('active');next.classList.add('active');if(name==='library')libraryTab(0);syncScreenMotion();
  if(!REDUCED)next.animate([{opacity:0,filter:'blur(8px)',transform:'translateY(16px)'},{opacity:1,filter:'blur(0px)',transform:'none'}],{duration:480,easing:'cubic-bezier(.2,.9,.3,1)'});
}
document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav)showPage(nav.dataset.page);const t=e.target.closest('[data-track]');if(t){const track=tracks.find(x=>x.id===t.dataset.track);let i=queue.indexOf(track);if(i<0){queue.push(track);i=queue.length-1;}setTrack(i);setPlaying(true,false);closeSheet();setPlayer(true);}const album=e.target.closest('[data-album]');if(album)openSheet('album',tracks.find(t=>t.id===album.dataset.album));const artist=e.target.closest('[data-artist]');if(artist)openSheet('artist',tracks.find(t=>t.id===artist.dataset.artist));});
$('libraryTabs').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>libraryTab(i));
$('orb').onclick=()=>{if(stream&&playing){setPlaying(false);return;}stream=true;refreshTrack();setPlaying(true,false);setPlayer(true);};
initAssistant();initHome();

function setState(value){
  state=value;phone.dataset.state=value;$('reviewState').value=value;
  const text={loading:'Буферизация…',offline:'Нет сети · показана сохранённая библиотека',error:'Не удалось воспроизвести песню',elsewhere:'Играет на MusiX Web'};
  $('stateMessage').innerHTML=text[value]?`${text[value]}${value==='error'?'<button id="retry">Повторить</button>':value==='elsewhere'?'<button data-sheet="devices">Слушать здесь</button>':''}`:'';
  if(value==='loading'||value==='error'||value==='elsewhere')setPlaying(false,false);$('emptyPlayer').hidden=value!=='empty';
  if(value==='empty')setPlaying(false,false);if($('retry'))$('retry').onclick=()=>{setState('ready');setPlaying(true,false);};
  refreshTrack();flight=null;if(playerTarget){$('coverSlot').style.transform='';drawExpansion(1);}announce('Состояние: '+$('reviewState').selectedOptions[0].textContent);
}
$('reviewSize').onchange=e=>{const [w,h]=e.target.value.split(',');document.documentElement.style.setProperty('--device-w',w+'px');document.documentElement.style.setProperty('--device-h',h+'px');flight=null;};
$('reviewNav').onchange=e=>{phone.dataset.nav=e.target.value;flight=null;};
$('reviewSpring').onchange=e=>{const p={balanced:[380,34,1],soft:[240,25,1.15],tight:[520,34,1]}[e.target.value];artSpring.stiffness=p[0];artSpring.damping=p[1];artSpring.mass=p[2];announce('Пружина: '+e.target.selectedOptions[0].textContent);};
function setReviewQueue(count){
  const active=currentTrack().sourceId||currentTrack().id;setPlaying(false,false);
  queue.splice(0,queue.length,...Array.from({length:count},(_,i)=>{const t=tracks[i%tracks.length];return count===4?t:{...t,sourceId:t.id,id:`${t.id}:fixture-${i}`};}));
  current=Math.max(0,queue.findIndex(t=>(t.sourceId||t.id)===active));artSpring.set(current);basePos=0;refreshTrack();
  $('reviewCount').value=String(count);setPlayer(true);openSheet('queue');announce(count===1000?'1000 строк: четыре песни повторены для проверки длинной очереди.':'Очередь: '+count);
}
$('reviewCount').onchange=e=>setReviewQueue(Number(e.target.value));
$('reviewState').onchange=e=>{setState(e.target.value);setPlayer(true);};$('reviewOpen').onclick=()=>setPlayer(true);$('reviewQueue').onclick=()=>{setPlayer(true);openSheet('queue');};$('reviewToast').onclick=()=>toast('Добавлено в очередь','Отменить',()=>toast('Добавление отменено'));$('reviewHaptic').onchange=e=>{hapticState.on=e.target.checked;hapticState.show=e.target.checked;};
$('emptyPlay').onclick=()=>{setState('ready');stream=true;refreshTrack();setPlaying(true,false);};$('emptyClose').onclick=()=>setPlayer(false);
player.classList.add('paused');refreshTrack();renderPosition();renderCoverHint();syncHomeMotion();libraryTab(0);
const params=new URLSearchParams(location.search);if(params.get('size')){$('reviewSize').value=params.get('size');$('reviewSize').dispatchEvent(new Event('change'));}if(params.get('nav')){$('reviewNav').value=params.get('nav');$('reviewNav').dispatchEvent(new Event('change'));}if(params.get('state'))setState(params.get('state'));if(params.get('page'))showPage(params.get('page'));if(params.get('player')==='1')requestAnimationFrame(()=>setPlayer(true));if(params.get('answer'))setReviewAssistant(params.get('answer'));if(params.get('home'))setReviewHome(params.get('home'));
window.phoneReview={setReviewHome,homeMotion:()=>homeAnimations.map(a=>a.playState),setReviewAssistant,assistantState:()=>$('page-assistant').dataset.answer,setPlayer,setState,setPlaying,setReviewQueue,openSheet,closeSheet,showPage,live:()=>[...LIVE],queue:()=>queue.map(t=>t.id),current:()=>currentTrack().id,position,expansion:()=>expansion};
