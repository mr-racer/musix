/* Home, phone round 2. Header with weather, the library stack, search and settings; the hero
 * with the orb of «Поток» and «Моя волна»; one stack for the vibes, the wave tuner and the album
 * of the day. Sky, orb, segments and the cover flight are round 1's (home.js). Snapshot data and
 * labelled scenarios only. */
const homeAnimations=[];
let homeState='ready',homeSearchMode='library',homeTime='auto',homeWeather='clear',homeTheme='dark';
let homeSky=null,homeFlow='idle',homeFlowTimer=0,homeOrbBurst=0,homeOrbHot=false,homeFlight=null;
let homeSearchQuery='';
const HOME_WAVE_KEY='musix-phone-review-wave-v1';
const HOME_PRESETS=[['mix','Микс'],['favorites','Любимое'],['rediscover','Давно не слушал'],['unfamiliar','Незнакомое']];
const HOME_SOUNDS=[['calm','Спокойное'],['energetic','Бодрое']];
const HOME_WEATHER_TEXT={clear:'+4° · ясно',cloudy:'+2° · облачно',rain:'+6° · дождь',snow:'−3° · снег',none:''};
let homeWave={familiarity:'mix',sound:null};
try{const saved=JSON.parse(localStorage.getItem(HOME_WAVE_KEY)||'null');if(saved&&HOME_PRESETS.some(p=>p[0]===saved.familiarity)&&[null,'calm','energetic'].includes(saved.sound))homeWave=saved;}catch{}
const homeTracks=()=>homeState==='one'?tracks.slice(0,1):tracks;
const homeReady=()=>!['loading','empty','error'].includes(homeState);
const homePlural=(n,forms)=>forms[n%10===1&&n%100!==11?0:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?1:2];
function homeOrbFlow(k=1){
  const pace=homeWave.sound==='calm'?.7:homeWave.sound==='energetic'?1.5:1,on=playing&&stream;
  homeAnimations.forEach((a,i)=>a.updatePlaybackRate((i===4?(on?2.6:homeOrbHot?2.5:1):(on?2.2:homeOrbHot?2:1)*pace)*k));
}
function syncHomeMotion(){
  const show=pageName==='home'&&!playerTarget,visible=show&&!sheetName&&!document.hidden&&homeReady();
  phone.dataset.homeContext=homeState;
  phone.classList.toggle('home-light',show&&homeTheme==='light');phone.classList.toggle('home-scene-visible',show);
  const on=playing&&stream,orb=$('orb'),busy=homeFlow==='loading';
  orb.setAttribute('aria-pressed',String(on));orb.setAttribute('aria-busy',String(busy));orb.disabled=busy||homeState==='offline';
  orb.setAttribute('aria-label',homeState==='offline'?'Поток недоступен без сети':busy?'Запускаем Поток':homeFlow==='error'?'Повторить запуск Потока':on?'Поставить Поток на паузу':'Включить Поток');
  orb.classList.toggle('live',on);orb.classList.toggle('busy',busy);orb.querySelector('.o-glyph').innerHTML=icon(on?'Pause':'Play');
  $('homeFlowTitle').textContent=homeState==='offline'?'Поток без сети':homeFlow==='error'?'Попробуем ещё раз':busy?'Запускаем Поток':on?'Поток играет':stream?'Поток на паузе':'Включить Поток';
  $('homeWaveToggle').disabled=homeState==='offline';
  homeOrbFlow();homeAnimations.forEach(a=>visible?a.play():a.pause());
  homeSky?.sync({visible,show,theme:homeTheme,time:homeTime,weather:homeWeather==='none'?'clear':homeWeather});
  if(!visible&&homeFlight){homeFlight.getAnimations().forEach(a=>a.cancel());homeFlight.remove();homeFlight=null;$('miniArt').style.visibility='';}
  if(typeof syncAlbumDayMotion==='function')syncAlbumDayMotion(visible);
  $('reviewFlow').value=busy?'loading':homeFlow==='error'?'error':on?'playing':stream?'paused':'idle';
}
function syncScreenMotion(){syncThinkingMotion();syncHomeMotion();}
function launchHomeOrb(){
  if(REDUCED)return;const orb=$('orb');
  orb.querySelector('.o-liquid').animate([{transform:'scale(1)'},{transform:'scale(.78)',offset:.3},{transform:'scale(1.1)',offset:.65},{transform:'scale(1)'}],{duration:720,easing:'cubic-bezier(.22,.9,.3,1)'});
  orb.querySelector('.o-halo').animate([{transform:'scale(.8)',opacity:.9},{transform:'scale(2.1)',opacity:0}],{duration:820,easing:'cubic-bezier(.2,.7,.2,1)'});
  orb.querySelector('.o-glyph svg').animate([{transform:'scale(1)'},{transform:'scale(1.45) rotate(-8deg)'},{transform:'scale(1)'}],{duration:520,easing:'cubic-bezier(.34,1.56,.64,1)'});
  homeOrbFlow(3.5);clearTimeout(homeOrbBurst);homeOrbBurst=setTimeout(()=>homeOrbFlow(),700);
}
function startHomeFlow(){
  if(homeState==='offline')return;clearTimeout(homeFlowTimer);
  if(stream&&homeFlow!=='error'){homeFlow='ready';setPlaying(!playing);launchHomeOrb();return;}
  homeFlow='loading';syncHomeMotion();launchHomeOrb();
  homeFlowTimer=setTimeout(()=>{homeFlow='ready';stream=true;refreshTrack();setPlaying(true);syncHomeMotion();},650);
}
async function setReviewFlow(value){
  clearTimeout(homeFlowTimer);closeSheet();if(playerTarget)setPlayer(false);await showPage('home');
  homeFlow=['loading','error'].includes(value)?value:'ready';stream=value==='playing'||value==='paused';setPlaying(value==='playing',false);syncHomeMotion();
}
function setReviewSky(time=homeTime,weather=homeWeather,theme=homeTheme){
  homeTime=time;homeWeather=weather;homeTheme=theme;$('reviewTime').value=time;if(weather!=='none')$('reviewWeather').value=weather;$('reviewHomeTheme').value=theme;
  $('homeWeatherText').textContent=HOME_WEATHER_TEXT[weather]??'';syncHomeMotion();
}
/* Same pointer threshold, moving lens, selection-on-release and cancel semantics
 * as vendor/tactile-showcase.js: fluid. Keyboard is the phone host's addition. */
function homeSegments(seg,initial,onSelect,{attribute='aria-selected'}={}){
  const hl=seg.querySelector('.mode-lens'),buttons=[...seg.querySelectorAll('button')];let sel=initial,over=initial,down=false,moved=false,x0=0;
  const place=i=>{hl.style.width=buttons[i].offsetWidth+'px';hl.style.height=buttons[i].offsetHeight+'px';hl.style.transform=`translate(${buttons[i].offsetLeft}px,${buttons[i].offsetTop-3}px)`;};
  const idx=(x,y)=>{const r=seg.getBoundingClientRect();const k=buttons.findIndex(b=>x-r.left<b.offsetLeft+b.offsetWidth&&x-r.left>=b.offsetLeft&&y-r.top<b.offsetTop+b.offsetHeight&&y-r.top>=b.offsetTop);return k<0?over:k;};
  const select=(i,notify=true)=>{sel=i;buttons.forEach((b,k)=>{b.setAttribute(attribute,String(k===i));b.tabIndex=k===i?0:-1;});place(i);if(notify)onSelect(i);};
  seg.onpointerdown=e=>{down=true;moved=false;x0=e.clientX;over=idx(e.clientX,e.clientY);try{seg.setPointerCapture(e.pointerId);}catch{}};
  seg.onpointermove=e=>{if(!down)return;if(!moved&&Math.abs(e.clientX-x0)>6){moved=true;seg.classList.add('dragging');}if(!moved)return;const i=idx(e.clientX,e.clientY);if(i!==over){over=i;place(i);haptic('tick');}};
  const up=e=>{if(!down)return;down=false;seg.classList.remove('dragging');select(e.type==='pointercancel'?sel:idx(e.clientX,e.clientY),e.type!=='pointercancel');};
  seg.onpointerup=up;seg.onpointercancel=up;
  buttons.forEach((b,i)=>b.onclick=e=>{if(e.detail===0)select(i);});
  seg.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,sel+(e.key==='ArrowRight'?1:-1)));select(i);buttons[i].focus();}};
  const ro=new ResizeObserver(()=>{if(!seg.isConnected){ro.disconnect();return;}hl.style.transition='none';place(sel);hl.getBoundingClientRect();hl.style.transition='';});ro.observe(seg);select(initial,false);
  return {select:i=>select(i,false),dispose:()=>ro.disconnect()};
}
let homeSheetSegments=null;
function homeFlightToMini(image){
  if(homeFlight){homeFlight.getAnimations().forEach(a=>a.cancel());homeFlight.remove();homeFlight=null;}$('miniArt').style.visibility='';
  if(REDUCED||!image?.complete||!image.naturalWidth)return;
  const stage=phone.getBoundingClientRect(),from=image.getBoundingClientRect(),to=$('miniArt').getBoundingClientRect(),canvas=document.createElement('canvas');
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
  canvas.className='home-cover-flight';Object.assign(canvas.style,{width:from.width+'px',height:from.height+'px',left:from.left-stage.left+'px',top:from.top-stage.top+'px'});phone.append(canvas);homeFlight=canvas;
  $('miniArt').style.visibility='hidden';
  const dx=to.left-from.left,dy=to.top-from.top,scale=to.width/from.width;
  canvas.animate([{transform:'translate(0,0) scale(1)'},{transform:`translate(${dx*.45}px,${dy*.2-16}px) scale(.92)`,offset:.35},{transform:`translate(${dx}px,${dy}px) scale(${scale})`}],{duration:560,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}).onfinish=()=>{
    if(homeFlight!==canvas)return;canvas.remove();homeFlight=null;$('miniArt').style.visibility='';$('miniArt').animate([{transform:'scale(1.12)'},{transform:'scale(1)'}],{duration:400,easing:'cubic-bezier(.2,.9,.3,1)'});
  };
}
function playHomeTrack(t,image,collection=null){
  if(homeState==='offline'){toast('Для воспроизведения нужна сеть');return false;}
  if(collection){queue.splice(0,queue.length,...collection);current=0;artSpring.set(0);basePos=0;baseTime=performance.now();refreshTrack();}
  stream=false;let i=queue.findIndex(x=>x.id===t.id);if(i<0){queue.push(t);i=queue.length-1;}setTrack(i);setPlaying(true);homeFlightToMini(image);syncHomeMotion();return true;
}
function homeWaveSummary(){
  const fam=HOME_PRESETS.find(p=>p[0]===homeWave.familiarity)[1],sound=HOME_SOUNDS.find(s=>s[0]===homeWave.sound)?.[1];
  $('homeWaveSummary').innerHTML=`Моя волна: <b>${fam}</b>${sound?' · '+sound:''}`;
}
function renderHomeContent(){
  const list=homeTracks(),long=homeState==='long';
  $('homePhrase').innerHTML=homeState==='one'?'Начнём с любимого.<br>Остальное найдём.':long?'От любимых мелодий<br>до новых открытий.':`От <button class="home-name" data-artist="${tracks[1].id}">Madonna</button><br>до <button class="home-name" data-artist="${tracks[2].id}">Foals</button> — по-своему.`;
  $('homeLibStack').innerHTML=[...list,...list,...list].slice(0,3).map(t=>`<img src="${t.cover}" alt="">`).join('');
  const vibes=homeState==='one'?[{name:'Знакомый звук',t:list[0]}]:[{name:long?'Очень длинный вайб про вечерние гитары':'Чуть громче',t:tracks[2]},{name:'Вечерний свет',t:tracks[1]},{name:'Гитарный вечер',t:tracks[3]}];
  vibes.forEach(v=>v.list=[v.t,...list.filter(t=>t!==v.t)].slice(0,3));
  $('vibes').innerHTML=vibes.map(v=>`<button class="vibe vibe-chip" data-home-vibe="${v.t.id}"><span class="vibe-pile">${[...v.list].reverse().map(t=>`<img src="${t.cover}" alt="">`).join('')}</span><span>${esc(v.name)}</span></button>`).join('');
  $('vibes').querySelectorAll('[data-home-vibe]').forEach(b=>b.onclick=()=>{const v=vibes.find(x=>x.t.id===b.dataset.homeVibe);playHomeTrack(v.t,b.querySelector('.vibe-pile img:last-child'),v.list);});
  homeWaveSummary();
  if(typeof renderAlbumDayCard==='function')renderAlbumDayCard();
}
async function setReviewHome(value){
  clearTimeout(homeFlowTimer);homeFlow='ready';closeSheet();if(playerTarget)setPlayer(false);await showPage('home');
  homeState=value;$('page-home').dataset.home=value;$('reviewHome').value=value;$('page-home').setAttribute('aria-busy',String(value==='loading'));
  if(value==='offline'||value==='empty')setPlaying(false,false);
  if(value==='empty')stream=false;
  if(value==='one'){const t=tracks[0];let i=queue.findIndex(x=>x.id===t.id);if(i<0){queue.push(t);i=queue.length-1;}setTrack(i);}
  $('page-home').querySelector('.eyebrow').textContent=value==='offline'?'Без сети · сохранённая фонотека':'Твой вайб';
  const status=$('homeStatus');status.hidden=!['loading','empty','error'].includes(value);
  if(value==='loading')status.innerHTML='<div class="home-skeleton" aria-hidden="true"><i></i><i></i><i></i></div><h2>Собираем вашу музыку</h2><p>Обновляем библиотеку и подборки.</p>';
  if(value==='empty')status.innerHTML=`<span class="empty-note">${icon('Library')}</span><h2>С чего начнётся<br>ваша фонотека?</h2><p>Добавьте любимый альбом.<br>Поток начнёт узнавать ваш вкус.</p><button class="pill" data-sheet="add">Добавить музыку</button>`;
  if(value==='error'){status.innerHTML='<span class="empty-note">'+icon('Library')+'</span><h2>Не удалось<br>загрузить главную</h2><p>Попробуйте ещё раз.<br>Ваша библиотека на месте.</p><button class="pill" id="homeRetry">Повторить</button><button class="text-action" data-page="library">Открыть фонотеку</button>';$('homeRetry').onclick=()=>setReviewHome('ready');}
  if(value==='offline')homeFold.close(true);
  renderHomeContent();syncHomeMotion();
}
function saveHomeWave(){try{localStorage.setItem(HOME_WAVE_KEY,JSON.stringify(homeWave));}catch{}homeOrbFlow();homeWaveSummary();}
function decorateHomeSheet(){}
function homeHighlight(value,q){
  const n=value.toLocaleLowerCase('ru').indexOf(q.toLocaleLowerCase('ru'));return n<0||!q?esc(value):esc(value.slice(0,n))+'<mark>'+esc(value.slice(n,n+q.length))+'</mark>'+esc(value.slice(n+q.length));
}
function askFromHome(question){
  const q=question.trim();closeSheet();if(typeof closeHomeSearch==='function')closeHomeSearch(true);showPage('assistant').then(()=>{if(q)simulateAnswer($('assistantAnswer'),q);else $('assistantForm').querySelector('input').focus({preventScroll:true});});
}
function homeSearchResults(){
  const input=$('homeSearchInput'),host=$('homeSearchResults');if(!input||!host)return;homeSearchQuery=input.value;const q=input.value.trim(),needle=q.toLocaleLowerCase('ru');
  if(homeSearchMode==='ai'){
    host.innerHTML=`<p class="home-sheet-note">Музыка, которая подходит сейчас.</p><div class="home-examples">${['Что-нибудь в духе Frozen','Гитарный вечер без суеты','Расскажи о текущей песне'].map(s=>`<button class="home-question" data-morph-item data-example="${esc(s)}">${esc(s)} ${icon('ChevronRight')}</button>`).join('')}</div><button class="pill home-ask" id="homeAsk" data-morph-item>${q?'Спросить':'Начать разговор'} ${icon('Sparkles',18)}</button>`;
    host.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>askFromHome(b.dataset.example));$('homeAsk').onclick=()=>askFromHome(q);return;
  }
  const list=homeTracks();
  const artists=list.filter(t=>t.a.toLocaleLowerCase('ru').includes(needle)),albums=list.filter(t=>t.album.toLocaleLowerCase('ru').includes(needle)),songs=list.filter(t=>t.t.toLocaleLowerCase('ru').includes(needle));
  const group=(name,items,kind)=>items.length?`<section class="home-results-group" data-morph-item><h3>${name}</h3>${items.slice(0,q?4:2).map(t=>`<button class="list-row" ${kind==='artist'?`data-artist="${t.id}"`:kind==='album'?`data-album="${t.id}"`:`data-home-song="${t.id}"`}><img src="${t.cover}" alt="" class="${kind==='artist'?'round':''}"><span><b>${homeHighlight(kind==='artist'?t.a:kind==='album'?t.album:t.t,q)}</b><small>${esc(kind==='artist'?'Артист':kind==='album'?t.a:`${t.a} · ${t.album}`)}</small></span>${icon(kind==='song'?'Play':'ChevronRight',18)}</button>`).join('')}</section>`:'';
  host.innerHTML=(group('Артисты',artists,'artist')+group('Альбомы',albums,'album')+group('Песни',songs,'song')||'<p class="home-search-empty">В фонотеке пока нет совпадений.</p>')+`<button class="home-search-ai text-action" id="homeSearchAI">${icon('Sparkles',18)} Спросить ассистента ${icon('ChevronRight',16)}</button>`;
  host.querySelectorAll('[data-home-song]').forEach(b=>b.onclick=()=>{const image=b.querySelector('img');playHomeTrack(tracks.find(t=>t.id===b.dataset.homeSong),image);if(typeof closeHomeSearch==='function')closeHomeSearch();});
  $('homeSearchAI').onclick=()=>askFromHome(q);
}
function homeRenderSheet(){return false;}
// WEB lib/color.ts: the same dusty hue/saturation band used by the orb.
function homeDusty(hex){
  const m=/^#?([0-9a-f]{6})$/i.exec(String(hex).trim());if(!m)return hex;
  const n=parseInt(m[1],16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;
  if(d)h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  h=Math.round(h*60+360)%360;const l=(max+min)/2,s=d===0?0:d/(1-Math.abs(2*l-1));
  return `hsl(${h} ${Math.round(Math.min(.6,Math.max(.36,s))*100)}% 58%)`;
}
/* «Моя волна» opens in place of the vibes and folds the album card into its 56 dp strip. One
 * spring f in [0,1] drives every piece through transforms, clips and opacity, so nothing is laid
 * out mid-motion and the stack's total height never changes. A tap mid-way retargets the same
 * spring and its speed carries over. With no card the wave simply opens under the vibes. */
const HOME_GAP=10;
let homeFoldGeo=null,homeFoldF=0,homeFoldTarget=0,homeFoldSpring=null;
function renderHomeWave(){
  const panel=$('homeWavePanel');
  panel.innerHTML=`<div class="r2-wave-body"><p class="r2-wave-label" id="homeWavePresetsLabel">Что играть</p><div class="wave-presets home-segment" role="radiogroup" aria-labelledby="homeWavePresetsLabel"><span class="mode-lens" aria-hidden="true"></span>${HOME_PRESETS.map(([id,label])=>`<button role="radio" data-preset="${id}" aria-checked="${homeWave.familiarity===id}">${label}</button>`).join('')}</div><p class="r2-wave-label" id="homeWaveSoundLabel">Настроение</p><div class="wave-sound" role="group" aria-labelledby="homeWaveSoundLabel">${HOME_SOUNDS.map(([id,label])=>`<button class="wave-sound-choice" data-sound="${id}" aria-pressed="${homeWave.sound===id}">${label}<span class="sound-check">${icon('Check',16)}</span></button>`).join('')}</div></div>`;
  homeSheetSegments?.dispose();
  homeSheetSegments=homeSegments(panel.querySelector('.wave-presets'),HOME_PRESETS.findIndex(p=>p[0]===homeWave.familiarity),i=>{homeWave.familiarity=HOME_PRESETS[i][0];saveHomeWave();},{attribute:'aria-checked'});
  panel.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>{
    homeWave.sound=homeWave.sound===b.dataset.sound?null:b.dataset.sound;
    panel.querySelectorAll('[data-sound]').forEach(x=>x.setAttribute('aria-pressed',String(homeWave.sound===x.dataset.sound)));
    haptic(homeWave.sound?'toggleOn':'toggleOff');saveHomeWave();
  });
}
function homeFoldMeasure(){
  const panel=$('homeWavePanel'),card=$('homeAlbumDay'),seg=panel.querySelector('.wave-presets');
  if(seg){seg.classList.remove('grid');if([...seg.querySelectorAll('button')].some(b=>b.scrollWidth>b.clientWidth+1))seg.classList.add('grid');}
  homeFoldGeo={hasCard:getComputedStyle(card).display!=='none'&&!!card.querySelector('.ad-card'),vh:$('vibes').offsetHeight,wh:panel.offsetHeight,ch:card.offsetHeight};
}
function homeFoldApply(f){
  if(!homeFoldGeo)homeFoldMeasure();
  const {hasCard,vh,wh,ch}=homeFoldGeo,k=clamp01(f),vibes=$('vibes'),panel=$('homeWavePanel'),card=$('homeAlbumDay');
  vibes.style.opacity=hasCard?String(clamp01(1-2*k)):'';vibes.style.transform=hasCard?`translateY(${(-8*k).toFixed(2)}px)`:'';
  panel.style.transform=`translateY(${hasCard?0:vh+HOME_GAP}px)`;
  panel.style.visibility=k<=0?'':'visible';
  panel.style.clipPath=k>=1?'none':`inset(0 0 ${((1-k)*100).toFixed(2)}% 0 round 22px)`;
  panel.style.setProperty('--wave-in',String(clamp01((k-.35)/.65)));
  card.style.transform=`translateY(${lerp(vh+HOME_GAP,wh+HOME_GAP,hasCard?k:0).toFixed(2)}px)`;
  if(hasCard&&typeof albumDayFold==='function')albumDayFold(k,ch);
}
function homeFoldInert(){
  const open=homeFoldTarget===1,folds=open&&homeFoldGeo?.hasCard;
  $('homeWaveToggle').setAttribute('aria-expanded',String(open));
  $('homeWavePanel').inert=!open;$('vibes').inert=!!folds;
  if(typeof albumDayFoldInert==='function')albumDayFoldInert(!!folds);
}
function homeFoldTo(open,instant=false){
  if(open&&$('homeWaveToggle').disabled)return;
  homeFoldMeasure();homeFoldTarget=open?1:0;homeFoldInert();
  if(typeof syncAlbumDayMotion==='function')syncAlbumDayMotion(pageName==='home'&&!playerTarget&&!sheetName&&!document.hidden);
  homeFoldSpring??=createSpring({value:homeFoldF,stiffness:260,damping:32,name:'home-fold',onUpdate:v=>{homeFoldF=v;homeFoldApply(v);}});
  if(instant)homeFoldSpring.set(homeFoldTarget);
  else{if(REDUCED&&$('homeStack').animate)$('homeStack').animate([{opacity:.4},{opacity:1}],{duration:120});homeFoldSpring.to(homeFoldTarget);}
}
/* Re-measure after a resize, a theme switch or a fresh card, and put every piece back where f says. */
function homeFoldRefresh(){if(!$('homeWavePanel').firstChild)return;homeFoldMeasure();homeFoldApply(homeFoldF);homeFoldInert();}
const homeFold={
  open:()=>homeFoldTo(true),close:(instant=false)=>homeFoldTo(false,instant),
  toggle:()=>{const open=homeFoldTarget!==1;haptic(open?'toggleOn':'toggleOff');homeFoldTo(open);},
  value:()=>homeFoldF,isOpen:()=>homeFoldTarget===1,
};
/* Search: the round search button grows into the panel (MorphMenu). The panel spans the screen
 * less 16 px a side, from the header down to 70 % of the height or the keyboard's top − 8. In the
 * review the keyboard is a 280 px plate; on a phone it is what visualViewport takes away. */
const HOME_KBD=280;
let homeSearchMorph=null,homeSearchSegs=null,homeKbd=false;
function homeSearchLayout(){
  const panel=$('homeSearchPanel');if(!panel)return;
  const stage=phone.getBoundingClientRect(),head=$('page-home').querySelector('.r2-head').getBoundingClientRect();
  const ime=homeKbd?HOME_KBD:window.visualViewport&&matchMedia('(max-width:500px)').matches?Math.max(0,innerHeight-visualViewport.height):0;
  const top=Math.max(8,head.top-stage.top-2),bottom=Math.min(stage.height*.7,stage.height-ime-8);
  phone.style.setProperty('--ime',ime+'px');
  Object.assign(panel.style,{top:top+'px',height:Math.max(160,bottom-top)+'px'});
  homeSearchMorph?.relayout();
}
function setHomeSearchMode(mode){
  homeSearchMode=mode;const input=$('homeSearchInput'),ai=mode==='ai';
  input.placeholder=ai?'Что хочется послушать?':'Артист, альбом или песня';input.setAttribute('aria-label',ai?'Вопрос о музыке':'Поиск по фонотеке');
  $('homeSearchPanel').dataset.mode=mode;homeSearchResults();
}
function initHomeSearch(){
  const panel=document.createElement('div');panel.id='homeSearchPanel';panel.className='morph-panel home-search-morph';
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Поиск');
  panel.innerHTML=`<div class="morph-body"><form id="homeSearchForm" class="home-search-form" data-morph-item>${icon('Search',18)}<input id="homeSearchInput" autofocus autocomplete="off" aria-label="Поиск по фонотеке" placeholder="Артист, альбом или песня"><button type="button" class="icon" id="homeSearchClear" aria-label="Очистить поиск">${icon('Close',18)}</button></form><div class="search-modes home-segment" role="tablist" aria-label="Где искать" data-morph-item><span class="mode-lens" aria-hidden="true"></span><button role="tab" aria-selected="true">Библиотека</button><button role="tab" aria-selected="false">ИИ</button></div><div id="homeSearchResults" class="morph-scroll"></div></div>`;
  phone.append(panel);
  const kbd=document.createElement('div');kbd.id='reviewKeyboard';kbd.className='review-keyboard';kbd.setAttribute('aria-hidden','true');
  kbd.innerHTML=['йцукенгшщзх','фывапролджэ','ячсмитьбю'].map(r=>`<span>${[...r].map(c=>`<i>${c}</i>`).join('')}</span>`).join('')+'<span><i class="wide">пробел</i></span><small>клавиатура · макет</small>';phone.append(kbd);
  homeSearchLayout();
  homeSearchMorph=createMorphMenu({anchor:$('homeSearchBtn'),panel,stage:phone,onOpen:()=>{haptic('lift');homeSearchResults();}});
  homeSearchSegs=homeSegments(panel.querySelector('.search-modes'),0,i=>setHomeSearchMode(i?'ai':'library'));
  $('homeSearchInput').oninput=homeSearchResults;
  $('homeSearchClear').onclick=()=>{$('homeSearchInput').value='';homeSearchResults();$('homeSearchInput').focus();};
  $('homeSearchForm').onsubmit=e=>{e.preventDefault();if(homeSearchMode==='ai')askFromHome($('homeSearchInput').value);else $('homeSearchResults').querySelector('.list-row')?.click();};
  panel.addEventListener('click',e=>{if(e.target.closest('[data-artist],[data-album]'))closeHomeSearch();});
  new ResizeObserver(homeSearchLayout).observe(phone);window.visualViewport?.addEventListener('resize',homeSearchLayout);
}
function openHomeSearch(){if(!homeSearchMorph||pageName!=='home'||playerTarget)return;homeSearchLayout();homeSearchMorph.open();}
function closeHomeSearch(instant=false){homeSearchMorph?.close({instant});}
function setReviewKeyboard(on){homeKbd=!!on;phone.classList.toggle('kbd',homeKbd);homeSearchLayout();}
function homeMetrics(){
  const el=$('page-home'),kids=[...el.children].filter(x=>!x.hidden&&getComputedStyle(x).display!=='none');
  const overlaps=kids.flatMap((x,i)=>i&&x.getBoundingClientRect().top<kids[i-1].getBoundingClientRect().bottom-1?[[kids[i-1].id||kids[i-1].className,x.id||x.className]]:[]);
  const shown=x=>x.checkVisibility({opacityProperty:true,visibilityProperty:true})&&!x.closest('[inert]');
  const smallTargets=[...el.querySelectorAll('button,a,[role=button]')].filter(x=>shown(x)&&!x.classList.contains('home-name')).filter(x=>{const r=x.getBoundingClientRect();return r.width<47.5||r.height<47.5;}).map(x=>x.id||x.className||x.textContent.trim().slice(0,24));
  const mini=$('mini'),limit=getComputedStyle(mini).visibility==='hidden'?$('nav').getBoundingClientRect().top:mini.getBoundingClientRect().top;
  return {scroll:el.scrollHeight,height:el.clientHeight,overlaps,smallTargets,stackBottom:Math.max(...kids.map(x=>x.getBoundingClientRect().bottom)),miniTop:limit};
}
/* Review panel of round 2: only what this screen needs, plus the album-of-the-day scenarios. */
function initHomeReview(query){
  if(document.body.dataset.reviewFocus!=='home-r2')return;
  const aside=document.querySelector('.review-controls');
  aside.querySelector('h1').innerHTML='Главная.<br>Без прокрутки.';
  aside.querySelector('p').textContent='Поток и «Моя волна», вайбы и «Альбом дня» с налитой кнопкой. Волна раскрывается аккордеоном, поиск выплывает из кнопки. Предложение второго раунда, ещё не принятый экран.';
  document.querySelector('.device-caption').textContent='Главная · раунд 2';
  aside.querySelectorAll(':scope>label').forEach(label=>{if(!label.querySelector('#reviewSize,#reviewHome'))label.classList.add('home-unrelated');});
  aside.querySelector('.review-actions').classList.add('home-unrelated');
  aside.querySelectorAll('.review-caption:not(#reviewLive)').forEach(p=>p.classList.add('home-unrelated'));
  $('reviewHome').querySelector('option[value=many]')?.remove();
  if(!$('reviewWeather').querySelector('option[value=none]'))$('reviewWeather').insertAdjacentHTML('beforeend','<option value="none">Нет данных</option>');
  aside.querySelector('.home-review-settings').insertAdjacentHTML('afterend',`<div class="home-review-settings"><label>Альбом дня<select id="reviewPick"><option value="one">Одна песня на репите</option><option value="never">Не слушал, любимый артист</option><option value="long">Давно не слушал</option><option value="none">Нет кандидатов</option></select></label><label>Прогресс<select id="reviewProgress"><option value="zero">Не начат</option><option value="mid">Середина</option><option value="last">Осталась одна</option><option value="done">Обыгран</option></select></label></div>
    <div class="review-actions"><button id="reviewHear">Сыграть песню</button><button id="reviewAlbumPlay" aria-pressed="false">Альбом играет</button></div>
    <label class="check"><input type="checkbox" id="reviewKbd"> Клавиатура</label>
    <p class="review-caption">Сценарии макета: прослушивания, место артиста, тип дня, погода. Песни, обложки и списки альбомов — из сохранённой библиотеки; звук не включается.</p>`);
  const extra=window.homeReviewExtra||{};
  $('reviewPick').onchange=e=>extra.setPick?.(e.target.value);
  $('reviewProgress').onchange=e=>extra.setProgress?.(e.target.value);
  $('reviewHear').onclick=()=>extra.hearOne?.();
  $('reviewAlbumPlay').onclick=e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',String(on));extra.albumPlaying?.(on);};
  $('reviewKbd').onchange=e=>setReviewKeyboard(e.target.checked);
  const links=document.createElement('p');links.className='home-review-links';links.innerHTML='<a href="android-home-review.html">Главная · раунд 1 ↗</a><a href="android-dream-v1.html">Исходный Dream v1 ↗</a>';aside.append(links);
  aside.querySelector('a[download]').href='android-home-r2.html';
  const pick=query.get('pick'),prog=query.get('progress');
  if(['one','never','long','none'].includes(pick)){$('reviewPick').value=pick;extra.setPick?.(pick);}
  if(['zero','mid','last','done'].includes(prog)){$('reviewProgress').value=prog;extra.setProgress?.(prog);}
  if(query.get('weather')==='none')setReviewSky(homeTime,'none');
}
function initHome(){
  renderHomeContent();homeSky=createPhoneSky();
  $('orb').onclick=startHomeFlow;
  $('homeSearchBtn').onclick=()=>typeof openHomeSearch==='function'?openHomeSearch():null;
  renderHomeWave();homeFoldRefresh();$('homeWaveToggle').onclick=homeFold.toggle;
  initHomeSearch();
  new ResizeObserver(homeFoldRefresh).observe($('homeStack'));new ResizeObserver(homeFoldRefresh).observe($('homeWavePanel'));
  if(!REDUCED){
    const drift=[['translate(-25%,-15%) scale(1)','translate(35%,20%) scale(1.35)','translate(5%,-30%) scale(.85)','translate(-25%,-15%) scale(1)'],['translate(30%,25%) scale(1.1)','translate(-20%,-10%) scale(.9)','translate(25%,30%) scale(1.3)','translate(30%,25%) scale(1.1)'],['translate(10%,30%) scale(.9)','translate(-30%,-20%) scale(1.25)','translate(10%,30%) scale(.9)'],['translate(-30%,20%) scale(1.2)','translate(30%,-25%) scale(.95)','translate(-30%,20%) scale(1.2)']];
    $('orb').querySelectorAll('.o-liquid i').forEach((el,i)=>homeAnimations.push(el.animate(drift[i].map(transform=>({transform})),{duration:[7000,9000,11000,8000][i],iterations:Infinity,easing:'ease-in-out'})));
    homeAnimations.push($('orb').querySelector('.o-ring').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:6000,iterations:Infinity}));
  }
  tracks.forEach((t,i)=>{if(i<4)$('orb').style.setProperty('--c'+i,homeDusty(t.palette?.vibrant||['#e0703a','#c9c287','#5664b3','#b85a8a'][i]));});
  $('orb').onpointerenter=()=>{homeOrbHot=true;homeOrbFlow();};$('orb').onpointerleave=()=>{homeOrbHot=false;homeOrbFlow();$('orb').style.setProperty('--px',0);$('orb').style.setProperty('--py',0);};
  let orbRaf=0,px=0,py=0;$('orb').onpointermove=e=>{if(REDUCED)return;const r=$('orb').getBoundingClientRect();px=(e.clientX-r.left)/r.width-.5;py=(e.clientY-r.top)/r.height-.5;if(!orbRaf)orbRaf=requestAnimationFrame(()=>{orbRaf=0;$('orb').style.setProperty('--px',px);$('orb').style.setProperty('--py',py);});};
  $('reviewHome').onchange=e=>setReviewHome(e.target.value);$('reviewFlow').onchange=e=>setReviewFlow(e.target.value);$('reviewTime').onchange=e=>setReviewSky(e.target.value);$('reviewWeather').onchange=e=>setReviewSky(homeTime,e.target.value);$('reviewHomeTheme').onchange=e=>setReviewSky(homeTime,homeWeather,e.target.value);
  document.addEventListener('visibilitychange',syncHomeMotion);
  document.addEventListener('keydown',e=>{if(e.key==='/'&&pageName==='home'&&!playerTarget&&!sheetName&&!e.target.matches('input,textarea')&&typeof openHomeSearch==='function'){e.preventDefault();openHomeSearch();}});
  document.addEventListener('click',e=>{if(homeState==='offline'&&pageName==='home'&&e.target.closest('#miniPlay,#miniNext,#albumPlay,[data-track],[data-home-vibe]')){e.stopImmediatePropagation();e.preventDefault();toast('Для воспроизведения нужна сеть');}},true);
  const query=new URLSearchParams(location.search);if(['auto','morning','day','evening','night'].includes(query.get('time')))homeTime=query.get('time');if(['clear','cloudy','rain','snow'].includes(query.get('weather')))homeWeather=query.get('weather');if(['dark','light'].includes(query.get('theme')))homeTheme=query.get('theme');setReviewSky();
  if(typeof initHomeReview==='function')initHomeReview(query);
  window.homeReview={setState:setReviewHome,setFlow:setReviewFlow,setSky:setReviewSky,sky:()=>homeSky.stats(),wave:()=>({...homeWave}),search:()=>({mode:homeSearchMode,query:homeSearchQuery}),metrics:homeMetrics,
    fold:open=>open?homeFold.open():homeFold.close(),foldOpen:homeFold.isOpen,foldSet:f=>{homeFoldSpring?.set(f);},
    searchOpen:v=>v===undefined?homeSearchMorph.isOpen():v?openHomeSearch():closeHomeSearch(),searchSet:v=>homeSearchMorph.set(v),keyboard:setReviewKeyboard,...(window.homeReviewExtra||{})};
  syncHomeMotion();
}
