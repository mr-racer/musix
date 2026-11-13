/* Home, phone round 1. WEB composition and materials; local snapshot fixtures only.
 * FluidHighlight follows the accepted showcase. Its vendor source is not modified. */
const homeAnimations=[];
let homeState='ready',homeSearchMode='library',homeTime='auto',homeWeather='clear',homeTheme='dark';
let homeSky=null,homeFlow='idle',homeFlowTimer=0,homeOrbBurst=0,homeOrbHot=false,homeFlight=null;
let homeSearchQuery='',homeSelectedDay=null,homeCountRaf=0;
const HOME_WEEK=[24,42,0,52,31,18,29],HOME_WEEK_LABELS=['7 ноября','8 ноября','9 ноября','10 ноября','11 ноября','Вчера','Сегодня'];
const HOME_REASONS=['Чуть громче','Вечерний свет','Гитарный вечер'];
const HOME_WAVE_KEY='musix-phone-review-wave-v1';
const HOME_PRESETS=[['mix','Микс'],['favorites','Любимое'],['rediscover','Давно не слушал'],['unfamiliar','Незнакомое']];
let homeWave={familiarity:'mix',sound:null};
try{const saved=JSON.parse(localStorage.getItem(HOME_WAVE_KEY)||'null');if(saved&&HOME_PRESETS.some(p=>p[0]===saved.familiarity)&&[null,'calm','energetic'].includes(saved.sound))homeWave=saved;}catch{}
const homeTracks=()=>homeState==='one'?tracks.slice(0,1):tracks;
const homeReady=()=>!['loading','empty','error'].includes(homeState);
const homeMinutes=n=>n>=60?`${Math.floor(n/60)} ч ${n%60} м`:`${n} мин`;
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
  $('homeTune').disabled=homeState==='offline';
  homeOrbFlow();homeAnimations.forEach(a=>visible?a.play():a.pause());
  homeSky?.sync({visible,show,theme:homeTheme,time:homeTime,weather:homeWeather});
  if(!visible&&homeFlight){homeFlight.getAnimations().forEach(a=>a.cancel());homeFlight.remove();homeFlight=null;$('miniArt').style.visibility='';}
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
  homeTime=time;homeWeather=weather;homeTheme=theme;$('reviewTime').value=time;$('reviewWeather').value=weather;$('reviewHomeTheme').value=theme;syncHomeMotion();
}
/* Same pointer threshold, moving lens, selection-on-release and cancel semantics
 * as vendor/tactile-showcase.js: fluid. Keyboard is the phone host's addition. */
function homeSegments(seg,initial,onSelect,{attribute='aria-selected'}={}){
  const hl=seg.querySelector('.mode-lens'),buttons=[...seg.querySelectorAll('button')];let sel=initial,over=initial,down=false,moved=false,x0=0;
  const place=i=>{hl.style.width=buttons[i].offsetWidth+'px';hl.style.transform=`translateX(${buttons[i].offsetLeft}px)`;};
  const idx=x=>{const r=seg.getBoundingClientRect();return Math.max(0,Math.min(buttons.length-1,buttons.findIndex(b=>x-r.left<b.offsetLeft+b.offsetWidth)===-1?buttons.length-1:buttons.findIndex(b=>x-r.left<b.offsetLeft+b.offsetWidth)));};
  const select=(i,notify=true)=>{sel=i;buttons.forEach((b,k)=>{b.setAttribute(attribute,String(k===i));b.tabIndex=k===i?0:-1;});place(i);if(notify)onSelect(i);};
  seg.onpointerdown=e=>{down=true;moved=false;x0=e.clientX;over=idx(e.clientX);try{seg.setPointerCapture(e.pointerId);}catch{}};
  seg.onpointermove=e=>{if(!down)return;if(!moved&&Math.abs(e.clientX-x0)>6){moved=true;seg.classList.add('dragging');}if(!moved)return;const i=idx(e.clientX);if(i!==over){over=i;place(i);haptic('tick');}};
  const up=e=>{if(!down)return;down=false;seg.classList.remove('dragging');select(e.type==='pointercancel'?sel:idx(e.clientX),e.type!=='pointercancel');};
  seg.onpointerup=up;seg.onpointercancel=up;
  buttons.forEach((b,i)=>b.onclick=e=>{if(e.detail===0)select(i);});
  seg.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,sel+(e.key==='ArrowRight'?1:-1)));select(i);buttons[i].focus();}};
  const ro=new ResizeObserver(()=>{if(!seg.isConnected){ro.disconnect();return;}hl.style.transition='none';place(sel);hl.getBoundingClientRect();hl.style.transition='';});ro.observe(seg);select(initial,false);
  return {select:i=>select(i,false),dispose:()=>ro.disconnect()};
}
let homeModes=null,homeSheetSegments=null;
function selectHomeSearch(mode){
  homeSearchMode=mode;homeModes?.select(mode==='ai'?1:0);
  $('homeSearch').innerHTML=`${mode==='ai'?'Спросить о музыке':'Найти музыку'}<span>${icon(mode==='ai'?'Sparkles':'Search')}</span>`;
  $('homeSearch').setAttribute('aria-label',mode==='ai'?'Спросить ассистента':'Поиск в библиотеке');
  document.querySelector('.home-search').dataset.mode=mode;
}
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
  if(homeState==='offline'){toast('Для воспроизведения нужна сеть');return;}
  if(collection){queue.splice(0,queue.length,...collection);current=0;artSpring.set(0);basePos=0;baseTime=performance.now();refreshTrack();}
  stream=false;let i=queue.findIndex(x=>x.id===t.id);if(i<0){queue.push(t);i=queue.length-1;}setTrack(i);setPlaying(true);homeFlightToMini(image);syncHomeMotion();
}
function renderHomeContent(){
  const list=homeTracks(),long=homeState==='long';
  $('homePhrase').innerHTML=homeState==='one'?'Начнём с любимого.<br>Остальное найдём.':long?'От любимых мелодий<br>до новых открытий.':`От <button class="home-name" data-artist="${tracks[1].id}">Madonna</button><br>до <button class="home-name" data-artist="${tracks[2].id}">Foals</button> — по-своему.`;
  $('homeFan').innerHTML=list.slice(0,3).map(t=>`<img src="${t.cover}" alt="">`).join('');
  const n=homeState==='many'?1000:list.length,albums=list.length;
  const counts=k=>`${Math.round(albums*k)} ${homePlural(Math.round(albums*k),['альбом','альбома','альбомов'])} · ${Math.round(n*k).toLocaleString('ru')} ${homePlural(Math.round(n*k),['песня','песни','песен'])}`;
  cancelAnimationFrame(homeCountRaf);$('homeCounts').textContent=counts(1);
  if(!REDUCED&&pageName==='home'&&homeReady()){const start=performance.now();const tick=now=>{const p=Math.min(1,(now-start)/900);$('homeCounts').textContent=counts(1-(1-p)**4);homeCountRaf=p<1?requestAnimationFrame(tick):0;};homeCountRaf=requestAnimationFrame(tick);}
  const vibes=homeState==='one'?[{name:'Знакомый звук',t:list[0]}]:[{name:'Чуть громче',t:tracks[2]},{name:'Вечерний свет',t:tracks[1]}];
  vibes.forEach(v=>v.list=[v.t,...list.filter(t=>t!==v.t)].slice(0,3));
  $('vibes').innerHTML=vibes.map(v=>`<button class="vibe" data-home-vibe="${v.t.id}"><span class="vibe-pile">[COVERS]</span><span><b>${v.name}</b><small>${v.list.length} ${homePlural(v.list.length,['песня','песни','песен'])} ${icon('Play',10)}</small></span></button>`.replace('[COVERS]',[...v.list].reverse().map(t=>`<img src="${t.cover}" alt="">`).join(''))).join('');
  $('vibes').querySelectorAll('[data-home-vibe]').forEach(b=>b.onclick=()=>{const v=vibes.find(x=>x.t.id===b.dataset.homeVibe);playHomeTrack(v.t,b.querySelector('.vibe-pile img:last-child'),v.list);});
  const reasons=HOME_REASONS;
  $('homeAlbums').innerHTML=list.slice(0,3).map((t,i)=>`<button class="home-pick album-tile" data-album="${t.id}" aria-label="${esc(t.album)}, ${esc(t.a)}"><span class="home-sleeve" style="--disc-label:${esc(t.palette?.vibrant||'#b9a2cc')}"><span class="home-record" aria-hidden="true"></span><img src="${t.cover}" alt=""></span><b>${esc(long?['Очень длинное название альбома с продолжением','Ray Of Light — The Complete Collection','Everything Not Saved Will Be Lost, Part 1'][i]:t.album)}</b><small>${esc(t.a)}</small><em>≈ ${reasons[i]}</em></button>`).join('');
  $('homeWeekBars').innerHTML=HOME_WEEK.map((n,i)=>`<span class="week-day ${i===6?'today':''}" aria-hidden="true"><i style="--bar:${Math.max(.05,n/52)}"></i><small>${['сб','вс','пн','вт','ср','чт','пт'][i]}</small></span>`).join('');selectHomeDay(null);
}
function selectHomeDay(index){
  homeSelectedDay=index;$('homeWeekTotal').textContent=homeMinutes(index===null?196:HOME_WEEK[index]);
  $('homeWeekCaption').innerHTML=(index===null?'За 7 дней':HOME_WEEK_LABELS[index])+icon('ChevronRight',14);
  $('homeWeekBars').setAttribute('aria-valuenow',String(index??6));$('homeWeekBars').setAttribute('aria-valuetext',`${index===null?'За неделю':HOME_WEEK_LABELS[index]}: ${homeMinutes(index===null?196:HOME_WEEK[index])}`);
  $('homeWeekBars').querySelectorAll('.week-day').forEach((el,i)=>el.classList.toggle('selected',i===index));
}
async function setReviewHome(value){
  clearTimeout(homeFlowTimer);homeFlow='ready';closeSheet();if(playerTarget)setPlayer(false);await showPage('home');
  homeState=value;$('page-home').dataset.home=value;$('reviewHome').value=value;$('page-home').setAttribute('aria-busy',String(value==='loading'));
  if(value==='offline'||value==='empty')setPlaying(false,false);
  if(value==='empty')stream=false;
  if(value==='one'){
    const t=tracks[0];let i=queue.findIndex(x=>x.id===t.id);if(i<0){queue.push(t);i=queue.length-1;}setTrack(i);
  }
  $('page-home').querySelector('.eyebrow').textContent=value==='offline'?'Без сети · сохранённая фонотека':'Твой вайб';
  const status=$('homeStatus');status.hidden=!['loading','empty','error'].includes(value);
  if(value==='loading')status.innerHTML='<div class="home-skeleton" aria-hidden="true"><i></i><i></i><i></i></div><h2>Собираем вашу музыку</h2><p>Обновляем библиотеку и подборки.</p>';
  if(value==='empty')status.innerHTML=`<span class="empty-note">${icon('Library')}</span><h2>С чего начнётся<br>ваша фонотека?</h2><p>Добавьте любимый альбом.<br>Поток начнёт узнавать ваш вкус.</p><button class="pill" data-sheet="add">Добавить музыку</button>`;
  if(value==='error'){status.innerHTML='<span class="empty-note">'+icon('Library')+'</span><h2>Не удалось<br>загрузить главную</h2><p>Попробуйте ещё раз.<br>Ваша библиотека на месте.</p><button class="pill" id="homeRetry">Повторить</button><button class="text-action" data-page="library">Открыть фонотеку</button>';$('homeRetry').onclick=()=>setReviewHome('ready');}
  renderHomeContent();syncHomeMotion();selectHomeSearch(homeSearchMode);
}
function saveHomeWave(){try{localStorage.setItem(HOME_WAVE_KEY,JSON.stringify(homeWave));}catch{}homeOrbFlow();}
function decorateHomeSheet(name,track,body){
  if(name!=='album'||pageName!=='home')return;
  const reason=HOME_REASONS[tracks.findIndex(t=>t.id===(track.sourceId||track.id))];if(!reason)return;
  const line=document.createElement('p');line.className='home-album-reason';line.textContent=homeState==='one'?'Из вашей фонотеки':`≈ ${reason}`;
  body.querySelector('.muted')?.after(line);
}
function homeHighlight(value,q){
  const n=value.toLocaleLowerCase('ru').indexOf(q.toLocaleLowerCase('ru'));return n<0||!q?esc(value):esc(value.slice(0,n))+'<mark>'+esc(value.slice(n,n+q.length))+'</mark>'+esc(value.slice(n+q.length));
}
function askFromHome(question){
  const q=question.trim();closeSheet();showPage('assistant').then(()=>{if(q)simulateAnswer($('assistantAnswer'),q);else $('assistantForm').querySelector('input').focus({preventScroll:true});});
}
function homeSearchResults(){
  const input=$('homeSearchInput'),host=$('homeSearchResults');if(!input||!host)return;homeSearchQuery=input.value;const q=input.value.trim(),needle=q.toLocaleLowerCase('ru');
  if(homeSearchMode==='ai'){
    host.innerHTML=`<p class="home-sheet-note">Музыка, которая подходит сейчас.</p><div class="home-examples">${['Что-нибудь в духе Frozen','Гитарный вечер без суеты','Расскажи о текущей песне'].map(s=>`<button class="home-question" data-example="${esc(s)}">${esc(s)} ${icon('ChevronRight')}</button>`).join('')}</div><button class="pill home-ask" id="homeAsk">${q?'Спросить':'Начать разговор'} ${icon('Sparkles',18)}</button>`;
    host.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>askFromHome(b.dataset.example));$('homeAsk').onclick=()=>askFromHome(q);return;
  }
  const list=homeTracks();
  const artists=list.filter(t=>t.a.toLocaleLowerCase('ru').includes(needle)),albums=list.filter(t=>t.album.toLocaleLowerCase('ru').includes(needle)),songs=list.filter(t=>t.t.toLocaleLowerCase('ru').includes(needle));
  const group=(name,items,kind)=>items.length?`<section class="home-results-group"><h3>${name}</h3>${items.slice(0,q?4:2).map(t=>`<button class="list-row" ${kind==='artist'?`data-artist="${t.id}"`:kind==='album'?`data-album="${t.id}"`:`data-home-song="${t.id}"`}><img src="${t.cover}" alt="" class="${kind==='artist'?'round':''}"><span><b>${homeHighlight(kind==='artist'?t.a:kind==='album'?t.album:t.t,q)}</b><small>${esc(kind==='artist'?'Артист':kind==='album'?t.a:`${t.a} · ${t.album}`)}</small></span>${icon(kind==='song'?'Play':'ChevronRight',18)}</button>`).join('')}</section>`:'';
  host.innerHTML=(group('Артисты',artists,'artist')+group('Альбомы',albums,'album')+group('Песни',songs,'song')||'<p class="home-search-empty">В фонотеке пока нет совпадений.</p>')+`<button class="home-search-ai text-action" id="homeSearchAI">${icon('Sparkles',18)} Спросить ассистента ${icon('ChevronRight',16)}</button>`;
  host.querySelectorAll('[data-home-song]').forEach(b=>b.onclick=()=>{const image=b.querySelector('img');playHomeTrack(tracks.find(t=>t.id===b.dataset.homeSong),image);closeSheet();});
  $('homeSearchAI').onclick=()=>askFromHome(q);
}
function homeRenderSheet(name){
  homeSheetSegments?.dispose();homeSheetSegments=null;
  if(name==='tune'){
    $('sheetTitle').textContent='Настроить волну';$('sheetBody').innerHTML=`<p class="home-sheet-note">Начните со знакомого или найдите новое.</p><h3 class="home-sheet-label">Что играть</h3><div class="wave-presets home-segment" role="radiogroup" aria-label="Что играть"><span class="mode-lens" aria-hidden="true"></span>${HOME_PRESETS.map(([id,label])=>`<button role="radio" data-preset="${id}" aria-checked="${homeWave.familiarity===id}">${label}</button>`).join('')}</div><h3 class="home-sheet-label">Настроение</h3><div class="wave-sound">${[['calm','Спокойное'],['energetic','Бодрое']].map(([id,label])=>`<button class="wave-sound-choice" data-sound="${id}" aria-pressed="${homeWave.sound===id}">${label}<span class="sound-check">${icon('Check',16)}</span></button>`).join('')}</div><p class="source-note">Без выбора — любое настроение.</p><button class="pill home-tune-done" id="homeTuneDone">Готово</button>`;
    homeSheetSegments=homeSegments(document.querySelector('.wave-presets'),HOME_PRESETS.findIndex(p=>p[0]===homeWave.familiarity),i=>{homeWave.familiarity=HOME_PRESETS[i][0];saveHomeWave();},{attribute:'aria-checked'});
    document.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>{homeWave.sound=homeWave.sound===b.dataset.sound?null:b.dataset.sound;document.querySelectorAll('[data-sound]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.sound===homeWave.sound)));haptic(homeWave.sound?'toggleOn':'toggleOff');saveHomeWave();});$('homeTuneDone').onclick=()=>closeSheet();return true;
  }
  if(name==='home-search'){
    $('sheetTitle').textContent=homeSearchMode==='ai'?'Спросить о музыке':'Найти в фонотеке';
    $('sheetBody').innerHTML=`<form id="homeSearchForm" class="home-search-form lg"><input id="homeSearchInput" aria-label="${homeSearchMode==='ai'?'Вопрос о музыке':'Поиск по фонотеке'}" placeholder="${homeSearchMode==='ai'?'Что хочется послушать?':'Артист, альбом или песня'}" value="${esc(homeSearchQuery)}" autocomplete="off"><button type="button" class="icon" id="homeSearchClear" aria-label="Очистить поиск">${icon('Close',18)}</button></form><div class="search-modes sheet-search-modes home-segment" role="tablist" aria-label="Где искать"><span class="mode-lens" aria-hidden="true"></span><button role="tab" aria-selected="${homeSearchMode==='library'}">Библиотека</button><button role="tab" aria-selected="${homeSearchMode==='ai'}">ИИ</button></div><div id="homeSearchResults"></div>`;
    homeSheetSegments=homeSegments(document.querySelector('.sheet-search-modes'),homeSearchMode==='ai'?1:0,i=>{selectHomeSearch(i?'ai':'library');$('sheetTitle').textContent=i?'Спросить о музыке':'Найти в фонотеке';$('homeSearchInput').placeholder=i?'Что хочется послушать?':'Артист, альбом или песня';$('homeSearchInput').setAttribute('aria-label',i?'Вопрос о музыке':'Поиск по фонотеке');homeSearchResults();});
    $('homeSearchInput').oninput=homeSearchResults;$('homeSearchClear').onclick=()=>{$('homeSearchInput').value='';homeSearchResults();$('homeSearchInput').focus();};$('homeSearchForm').onsubmit=e=>{e.preventDefault();if(homeSearchMode==='ai')askFromHome($('homeSearchInput').value);else $('homeSearchResults button')?.click();};homeSearchResults();return true;
  }
  if(name==='home-week'){
    $('sheetTitle').textContent='Ваша неделя';$('sheetBody').innerHTML=`<p class="week-sheet-total"><b>3 ч 16 м</b><span>с музыкой за последние 7 дней</span></p><div class="week-detail-bars">${HOME_WEEK.map((n,i)=>`<button aria-label="${HOME_WEEK_LABELS[i]}: ${homeMinutes(n)}" data-day="${i}"><b>${n}</b><i style="--bar:${Math.max(.02,n/52)}"></i><small>${['сб','вс','пн','вт','ср','чт','пт'][i]}</small></button>`).join('')}</div><p class="week-day-reading" id="weekDayReading">${HOME_WEEK_LABELS[6]} · ${homeMinutes(HOME_WEEK[6])}</p><dl class="week-readings"><div><dt>Дней подряд</dt><dd>4</dd></div><div><dt>Впервые</dt><dd>8 песен</dd></div><div><dt>Чаще всего</dt><dd>Инди-рок</dd></div></dl><button class="text-action" id="weekAllStats">Вся статистика ${icon('ChevronRight',16)}</button>`;
    document.querySelectorAll('[data-day]').forEach(b=>{const pick=()=>{$('weekDayReading').textContent=`${HOME_WEEK_LABELS[+b.dataset.day]} · ${homeMinutes(HOME_WEEK[+b.dataset.day])}`;document.querySelectorAll('[data-day]').forEach(x=>x.classList.toggle('selected',x===b));};b.onpointerenter=b.onfocus=b.onclick=pick;});$('weekAllStats').onclick=()=>{closeSheet();showPage('library').then(()=>libraryTab(3));};return true;
  }
  return false;
}
// WEB lib/color.ts: the same dusty hue/saturation band used by the orb.
function homeDusty(hex){
  const m=/^#?([0-9a-f]{6})$/i.exec(hex.trim());if(!m)return hex;
  const n=parseInt(m[1],16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;
  if(d)h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  h=Math.round(h*60+360)%360;const l=(max+min)/2,s=d===0?0:d/(1-Math.abs(2*l-1));
  return `hsl(${h} ${Math.round(Math.min(.6,Math.max(.36,s))*100)}% 58%)`;
}
function initHome(){
  renderHomeContent();homeSky=createPhoneSky();
  homeModes=homeSegments(document.querySelector('.home-search .search-modes'),0,i=>selectHomeSearch(i?'ai':'library'));
  $('homeSearch').onclick=()=>openSheet('home-search');$('orb').onclick=startHomeFlow;
  if(!REDUCED){
    const drift=[['translate(-25%,-15%) scale(1)','translate(35%,20%) scale(1.35)','translate(5%,-30%) scale(.85)','translate(-25%,-15%) scale(1)'],['translate(30%,25%) scale(1.1)','translate(-20%,-10%) scale(.9)','translate(25%,30%) scale(1.3)','translate(30%,25%) scale(1.1)'],['translate(10%,30%) scale(.9)','translate(-30%,-20%) scale(1.25)','translate(10%,30%) scale(.9)'],['translate(-30%,20%) scale(1.2)','translate(30%,-25%) scale(.95)','translate(-30%,20%) scale(1.2)']];
    $('orb').querySelectorAll('.o-liquid i').forEach((el,i)=>homeAnimations.push(el.animate(drift[i].map(transform=>({transform})),{duration:[7000,9000,11000,8000][i],iterations:Infinity,easing:'ease-in-out'})));
    homeAnimations.push($('orb').querySelector('.o-ring').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:6000,iterations:Infinity}));
  }
  tracks.forEach((t,i)=>{if(i<4)$('orb').style.setProperty('--c'+i,homeDusty(t.palette?.vibrant||['#e0703a','#c9c287','#5664b3','#b85a8a'][i]));});
  $('orb').onpointerenter=()=>{homeOrbHot=true;homeOrbFlow();};$('orb').onpointerleave=()=>{homeOrbHot=false;homeOrbFlow();$('orb').style.setProperty('--px',0);$('orb').style.setProperty('--py',0);};
  let orbRaf=0,px=0,py=0;$('orb').onpointermove=e=>{if(REDUCED)return;const r=$('orb').getBoundingClientRect();px=(e.clientX-r.left)/r.width-.5;py=(e.clientY-r.top)/r.height-.5;if(!orbRaf)orbRaf=requestAnimationFrame(()=>{orbRaf=0;$('orb').style.setProperty('--px',px);$('orb').style.setProperty('--py',py);});};
  const bars=$('homeWeekBars'),dayAt=e=>{const r=bars.getBoundingClientRect();return Math.max(0,Math.min(6,Math.floor((e.clientX-r.left)/r.width*7)));};
  bars.onpointerdown=e=>{bars.setPointerCapture(e.pointerId);selectHomeDay(dayAt(e));};bars.onpointermove=e=>{if(e.pointerType==='mouse'||bars.hasPointerCapture(e.pointerId))selectHomeDay(dayAt(e));};bars.onpointerleave=e=>{if(e.pointerType==='mouse')selectHomeDay(null);};bars.onpointercancel=()=>selectHomeDay(null);bars.onblur=()=>selectHomeDay(null);bars.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End','Escape'].includes(e.key)){e.preventDefault();selectHomeDay(e.key==='Escape'?null:e.key==='Home'?0:e.key==='End'?6:Math.max(0,Math.min(6,(homeSelectedDay??6)+(e.key==='ArrowRight'?1:-1))));}};
  $('reviewHome').onchange=e=>setReviewHome(e.target.value);$('reviewFlow').onchange=e=>setReviewFlow(e.target.value);$('reviewTime').onchange=e=>setReviewSky(e.target.value);$('reviewWeather').onchange=e=>setReviewSky(homeTime,e.target.value);$('reviewHomeTheme').onchange=e=>setReviewSky(homeTime,homeWeather,e.target.value);
  document.addEventListener('visibilitychange',syncHomeMotion);document.addEventListener('keydown',e=>{if(e.key==='/'&&pageName==='home'&&!playerTarget&&!sheetName&&!e.target.matches('input,textarea')){e.preventDefault();openSheet('home-search');}});
  document.addEventListener('click',e=>{if(homeState==='offline'&&pageName==='home'&&e.target.closest('#miniPlay,#miniNext,#albumPlay,[data-track],[data-home-vibe]')){e.stopImmediatePropagation();e.preventDefault();toast('Для воспроизведения нужна сеть');}},true);
  const query=new URLSearchParams(location.search);if(['auto','morning','day','evening','night'].includes(query.get('time')))homeTime=query.get('time');if(['clear','cloudy','rain','snow'].includes(query.get('weather')))homeWeather=query.get('weather');if(['dark','light'].includes(query.get('theme')))homeTheme=query.get('theme');setReviewSky();
  if(document.body.dataset.reviewFocus==='home'){
    document.querySelector('.review-controls h1').innerHTML='Главная.<br>Своя музыка рядом.';
    document.querySelector('.review-controls>p').textContent='Один экран: небо и Поток, вайбы, поиск, фонотека, альбомы и неделя. Настройки и подробности — в шитах. Предложение первого раунда, ещё не принятый экран.';
    document.querySelector('.device-caption').textContent='Главная · раунд 1';
    document.querySelectorAll('.review-controls>label').forEach(label=>{if(!label.querySelector('#reviewSize,#reviewNav,#reviewHome'))label.classList.add('home-unrelated');});
    document.querySelector('.review-actions').classList.add('home-unrelated');
    const links=document.createElement('p');links.className='home-review-links';links.innerHTML='<a href="android-home-r0.html">Предыдущий эскиз главной ↗</a><a href="android-dream-v1.html">Исходный Dream v1 ↗</a>';document.querySelector('.review-controls').append(links);
    const download=document.querySelector('a[download]');download.href='android-home-review.html';
  }
  window.homeReview={setState:setReviewHome,setFlow:setReviewFlow,setSky:setReviewSky,sky:()=>homeSky.stats(),wave:()=>({...homeWave}),search:()=>({mode:homeSearchMode,query:homeSearchQuery}),day:()=>homeSelectedDay};syncHomeMotion();
}
