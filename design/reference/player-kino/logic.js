(function(){
const COVERS=__COVERS__;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const page=$('#page'), stage=$('#stage'), cover=$('#cover'), tilt=$('#tilt'), bar=$('#bar');
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE='cubic-bezier(.22,.9,.3,1)', SPRING='cubic-bezier(.34,1.56,.64,1)';
const fmt=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');

/* Real tracks from the owner's library. Producers and samples are written from memory as a stand-in for the relations graph.
   Stronger and Harder, Better, Faster, Stronger are a real sample pair, both are in the library. */
const T=[
 {k:'sia',title:'Eye of the Needle',artist:'Sia',album:'1000 Forms of Fear',year:2014,dur:249,genre:'Поп',producers:['Greg Kurstin'],
  vibe:'Название отсылает к библейской фразе о верблюде и ушке иглы из Евангелия от Матфея',
  facts:{song:[['создание','Эту маршевую балладу на пианино Sia написала вместе с британским автором Chris Braide, ранее соавтором хитов Britney Spears и David Guetta.'],
               ['образ','На обложке альбома только парик. К его выходу Sia решила не показывать лицо, и светлое каре стало её знаком.']],
         artist:[['карьера','До сольного прорыва Sia писала хиты для других. Diamonds для Rihanna она сочинила за 14 минут.']]}},
 {k:'lorde',title:'Green Light',artist:'Lorde',album:'Melodrama',year:2017,dur:234,genre:'Электропоп',producers:['Lorde','Jack Antonoff','Frank Dukes'],
  vibe:'Эйфория после расставания, зелёный свет как разрешение идти дальше',
  facts:{song:[['оценка','Макс Мартин назвал структуру песни «неправильным сочинительством». Lorde согласилась и оставила всё как есть.'],
               ['создание','Песня написана вместе с Джеком Антоноффом. Большая часть Melodrama записана в его домашней студии в Бруклине.']],
         artist:[['имя','Настоящее имя Lorde: Элла Мария Лани Йелич-О’Коннор. Псевдоним вырос из её увлечения аристократией.']]}},
 {k:'tame',title:'Let It Happen',artist:'Tame Impala',album:'Currents',year:2015,dur:467,genre:'Психоделический поп',producers:['Kevin Parker'],
  vibe:'Почти восемь минут о том, как перестать сопротивляться переменам',
  facts:{song:[['приём','В середине трека звук зацикливается, будто заел компакт-диск. Это задуманный приём, а не дефект записи.'],
               ['создание','Currents Кевин Паркер записал, спродюсировал и свёл сам в домашней студии во Фримантле.']],
         artist:[['состав','В студии Tame Impala это один человек. Кевин Паркер сам пишет, играет и сводит, а группа собирается для концертов.']]}},
 {k:'lana',title:'Honeymoon',artist:'Lana Del Rey',album:'Honeymoon',year:2015,dur:350,genre:'Дрим-поп',producers:['Lana Del Rey','Rick Nowels','Kieron Menzies'],
  vibe:'Медленный кинематографичный пролог к альбому',
  facts:{song:[],artist:[]}},
 {k:'kanye',title:'Stronger',artist:'Kanye West',album:'Graduation',year:2007,dur:312,genre:'Хип-хоп',producers:['Kanye West','Mike Dean'],
  vibe:'Гимн упрямству на вокодерном семпле Daft Punk',
  samples:[{i:5}],
  facts:{song:[['создание','Сведение Канье переделывал десятки раз: ему не нравилось, как звучат ударные. В итоге с барабанами помог Timbaland.'],
               ['релиз','Graduation вышел в один день с альбомом 50 Cent. Дуэль продаж первой недели Канье выиграл.']],
         artist:[]}},
 {k:'daft',title:'Harder, Better, Faster, Stronger',artist:'Daft Punk',album:'Discovery',year:2001,dur:224,genre:'Френч-хаус',producers:['Thomas Bangalter','Guy-Manuel de Homem-Christo'],
  vibe:'Мантра роботов о работе над собой, собранная из фанка семидесятых',
  samples:[{title:'Cola Bottle Baby',artist:'Edwin Birdsong',year:1979}], sampledBy:[{i:4}],
  facts:{song:[['клип','Клипы ко всем трекам Discovery складываются в аниме-фильм Interstella 5555, снятый под руководством Лэйдзи Мацумото.']],
         artist:[['образ','На публике Daft Punk появлялись только в шлемах роботов. О распаде в 2021 году дуэт объявил видео под названием Epilogue.']]}}
];
const EMPTY='Фактов пока нет. Ассистент дособерёт их в фоне, и они появятся здесь.';
const LYR=['Текст живёт на обороте обложки','Строка за строкой идёт за музыкой','Текущая строка подсвечена','Нажатие на строку перематывает трек','Обратно обложка переворачивается той же кнопкой'];
const AI=[
 {chip:'О чём эта песня?',q:'О чём эта песня?',a:()=>T[cur].vibe+'. '+(T[cur].facts.song[0]?T[cur].facts.song[0][1]:''),s:()=>[]},
 {chip:'Похожее из фонотеки',q:'Что ещё послушать в таком настроении?',a:()=>'В вашей фонотеке ближе всего по настроению вот эти два трека. Нажмите, и обложка перелетит в плеер.',s:()=>[1,2,0].filter(i=>i!==cur).slice(0,2)},
 {chip:'Найти по строчке',q:'Хочу найти песню по строчке',a:()=>'Напишите строчку так, как помните. Я ищу по смыслу, поэтому точные слова не нужны.',s:()=>[]}
];

let cur=0, dir='k3', playing=true, pos=14, scope='song', fi=0, bgFlip=false, busy=false, typed=0, lastSec=-1, last=performance.now();
const narrow=()=>stage.clientWidth<=782;

const rowHTML=i=>{const t=T[i];return `<button type="button" class="row" data-i="${i}"><span class="n">${i+1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><img src="${COVERS[t.k].uri}" alt=""><span class="tt"><b>${t.title}</b><small>${t.artist}</small></span><span class="dur">${fmt(t.dur)}</span></button>`;};

function renderFact(anim){
  const list=T[cur].facts[scope], el=$('#fact');
  if(fi>=list.length) fi=0;
  el.classList.remove('open'); el.classList.toggle('empty',!list.length);
  el.textContent=list.length?list[fi][1]:EMPTY;
  $('#ftag').textContent=list.length?list[fi][0]:'';
  $('#fpos').textContent=list.length?(fi+1)+' / '+list.length:'0 / 0';
  $('#fprev').disabled=$('#fnext').disabled=list.length<2;
  if(anim&&!reduce) el.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:320,easing:EASE});
}

/* credits: producers are links (a shared producer often means a similar sound), samples go both ways */
function sampleHTML(s){
  if(s.i!=null){const t=T[s.i]; return '<button type="button" class="smp-chip" data-i="'+s.i+'" aria-label="Слушать: '+t.title+', '+t.artist+'"><span class="smp-art"><img src="'+COVERS[t.k].uri+'" alt=""><span class="ms" aria-hidden="true">play_arrow</span></span><span class="tt"><b>'+t.title+'</b><small>'+t.artist+', '+t.year+'</small></span></button>';}
  return '<span class="smp-chip off" title="Этого трека нет в фонотеке"><span class="smp-art"><span class="ms" aria-hidden="true">music_off</span></span><span class="tt"><b>'+s.title+'</b><small>'+s.artist+', '+s.year+', нет в фонотеке</small></span></span>';
}
function creditsHTML(t){
  let h='<div><dt>'+(t.producers.length>1?'Продюсеры':'Продюсер')+'</dt><dd>'+t.producers.map(p=>'<button type="button" class="lnk" data-go="producer" data-name="'+p+'" title="Страница продюсера"><span class="lt">'+p+'</span></button>').join(', ')+'</dd></div>';
  h+='<div><dt>Жанр</dt><dd>'+t.genre+'</dd></div>';
  if(t.samples) h+='<div class="smp"><dt>Семплирует</dt><dd>'+t.samples.map(sampleHTML).join('')+'</dd></div>';
  if(t.sampledBy) h+='<div class="smp"><dt>Её семплировали</dt><dd>'+t.sampledBy.map(sampleHTML).join('')+'</dd></div>';
  return h;
}
let toastT=0;
function toast(msg){const el=$('#toast'); el.textContent=msg; el.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),2800);}
function go(el){
  const t=T[cur], k=el.dataset.go;
  toast(k==='artist'?'В приложении откроется страница артиста: '+t.artist:k==='album'?'В приложении откроется альбом: '+t.album:'В приложении откроется страница продюсера '+el.dataset.name+' со всеми его треками в фонотеке');
}

/* the blurred background is a tiny pre-blurred image; a track change only cross-fades two static layers */
function paintBg(){
  const c=COVERS[T[cur].k], a=$('#bgA'), b=$('#bgB'), show=bgFlip?a:b, hide=bgFlip?b:a; bgFlip=!bgFlip;
  show.style.backgroundImage='url('+(dir==='e'?c.bg:c.bgc)+')'; show.classList.remove('out'); hide.classList.add('out');
}

/* mode: 'vinyl' (old cover swings away like a door, new one lands with a bounce), 'fly' (shared element), 'none' */
function setTrack(i,sign,mode){
  const img=$('#coverImg'), prevSrc=img.getAttribute('src');
  cur=(i+T.length)%T.length; const t=T[cur], c=COVERS[t.k], nx=T[(cur+1)%T.length];
  pos=0; fi=0; lastSec=-1;
  stage.dataset.flip='false'; $('#flip').setAttribute('aria-pressed','false');
  stage.style.setProperty('--acc',c.acc); stage.style.setProperty('--acc2',c.acc2);
  paintBg();
  if(!reduce&&mode==='vinyl'&&prevSrc){
    const g=new Image(); g.src=prevSrc; g.alt=''; g.className='ghost'; g.style.transformOrigin=sign>0?'left center':'right center';
    cover.appendChild(g);
    g.animate([{transform:'rotateY(0deg)',opacity:1},{transform:'rotateY('+(-68*sign)+'deg) translateX('+(-30*sign)+'%) scale(.9)',opacity:0}],{duration:420,easing:'cubic-bezier(.5,0,.75,.3)',fill:'forwards'}).onfinish=()=>g.remove();
    tilt.animate([{transform:'translateX('+(46*sign)+'%) rotate('+(5*sign)+'deg) scale(.86)',opacity:0},{transform:'none',opacity:1}],{duration:600,delay:90,easing:SPRING,fill:'backwards'});
  }
  if(!reduce&&mode!=='none') $('#meta').animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:480,delay:120,easing:EASE,fill:'backwards'});
  img.src=c.uri; img.alt='Обложка альбома '+t.album;
  const title=$('#title'); title.textContent=t.title; title.classList.toggle('long',t.title.length>15);
  $('#artist').textContent=t.artist; $('#album').textContent=t.album+', '+t.year; $('#vibe').textContent=t.vibe;
  $('#tdur').textContent=fmt(t.dur);
  $('#credits').innerHTML=creditsHTML(t);
  $('#nxImg').src=$('#pkImg').src=COVERS[nx.k].uri; $('#nxTitle').textContent=nx.title; $('#nxArtist').textContent=nx.artist;
  $('#pkNext').textContent=nx.title+', '+nx.artist; $('#pkFact').textContent=t.facts.song[0]?t.facts.song[0][1]:'Фактов пока нет';
  $$('#rows .row').forEach((r,j)=>r.setAttribute('aria-current',j===cur));
  renderFact(mode!=='none'); paintProgress();
}

/* shared element: the thumbnail itself grows into the cover. The clone sits at the cover's final size
   and starts scaled down onto the thumbnail, so the corner radius reads 10px at the start and the cover's own at the end. */
function fly(thumb,i){
  if(busy) return;
  if(reduce) return setTrack(i,1,'none');
  busy=true;
  const a=thumb.getBoundingClientRect(), b=cover.getBoundingClientRect(), s=stage.getBoundingClientRect();
  const k=a.width/b.width, r=parseFloat(getComputedStyle(cover).borderTopLeftRadius)||18;
  const g=new Image(); g.src=COVERS[T[i].k].uri; g.alt=''; g.className='fly';
  Object.assign(g.style,{left:(b.left-s.left-stage.clientLeft)+'px',top:(b.top-s.top-stage.clientTop)+'px',width:b.width+'px',height:b.height+'px',borderRadius:r+'px'});
  stage.appendChild(g); thumb.style.visibility='hidden';
  const dim=tilt.animate([{opacity:1,transform:'scale(1)'},{opacity:.3,transform:'scale(.94)'}],{duration:300,easing:EASE,fill:'forwards'});
  g.animate([{transform:'translate('+(a.left-b.left)+'px,'+(a.top-b.top)+'px) scale('+k+')',borderRadius:(10/k)+'px'},{transform:'none',borderRadius:r+'px'}],{duration:560,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'})
   .onfinish=()=>{dim.cancel(); setTrack(i,1,'fly'); g.remove(); thumb.style.visibility=''; busy=false; if(narrow()) openSheet('');};
}

function setPlaying(v){
  playing=v; stage.dataset.playing=String(v); last=performance.now();
  $('#hint').textContent=v?'Нажми на обложку, чтобы поставить на паузу':'Нажми на обложку, чтобы продолжить';
  tick();
}

function seg(id,key,fn){
  $(id).addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return;
    $$(id+' button').forEach(x=>x.setAttribute('aria-pressed',x===b)); fn(b.dataset[key]);});
}

/* every variant shares the same components; switching a variant only re-skins the stage */
function setDir(d){
  dir=d; openSheet(''); stage.dataset.dir=d; paintBg();
}

/* windows and sheets: assistant, queue, «О песне». One at a time; pressing the same button again closes it. */
function resetTalk(){clearInterval(typed); $('#q').textContent=''; $('#a').textContent=''; $('#a').classList.remove('typing'); $('#sugg').innerHTML=''; $('#aiHint').hidden=false;}
function openSheet(name){
  const was=stage.dataset.sheet||'';
  if(name&&name===was) name='';
  stage.dataset.sheet=name||'';
  $('#aiBtn').setAttribute('aria-pressed',name==='ai'); $('#qBtn').setAttribute('aria-pressed',name==='queue');
  if(was==='ai'&&name!=='ai') resetTalk();
}

/* assistant: canned replies streamed like the real LLM output */
function stream(text,sugg){
  clearInterval(typed); const el=$('#a'); $('#sugg').innerHTML=''; $('#aiHint').hidden=true;
  const done=()=>{el.classList.remove('typing'); $('#sugg').innerHTML=sugg.map(rowHTML).join('');};
  if(reduce){el.textContent=text; return done();}
  let n=0; el.textContent=''; el.classList.add('typing');
  typed=setInterval(()=>{n+=2; el.textContent=text.slice(0,n); if(n>=text.length){clearInterval(typed); done();}},24);
}
function say(k){$('#q').textContent=AI[k].q; stream(AI[k].a(),AI[k].s());}

/* «Эфир» equalizer ribbon: one periodic band, drawn once. CSS slides it; the script only sets its height 4 times a second. */
function smooth(p){
  let d='M'+p[0][0].toFixed(1)+' '+p[0][1].toFixed(1);
  for(let i=1;i<p.length-1;i++) d+='Q'+p[i][0].toFixed(1)+' '+p[i][1].toFixed(1)+' '+((p[i][0]+p[i+1][0])/2).toFixed(1)+' '+((p[i][1]+p[i+1][1])/2).toFixed(1);
  return d+'Z';
}
function wavePath(){
  const N=180, top=[], bot=[];
  for(let i=0;i<=N;i++){
    const x=i/N*300, u=x/100*Math.PI*2;                       /* period 100 of 300: sliding by a third loops seamlessly */
    const a=.5+.5*Math.sin(u*3+.4), b=.5+.5*Math.sin(u*5+2.1), c=.5+.5*Math.sin(u*2+4.2);
    top.push([x,50-(7+36*(a*.5+b*.3+c*.2))]); bot.push([x,50+(7+36*(c*.5+a*.25+b*.25))]);
  }
  return smooth(top.concat(bot.reverse()));
}
const WAVE=wavePath(); let wid=0;
const waveSVG=()=>{const id='wg'+(wid++);return '<svg viewBox="0 0 300 100" preserveAspectRatio="none"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset=".3" stop-color="currentColor" stop-opacity=".85"/><stop offset=".7" stop-color="currentColor" stop-opacity=".85"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="'+WAVE+'" fill="url(#'+id+')"/></svg>';};
$$('.wave').forEach(w=>{w.innerHTML='<div class="amp">'+waveSVG()+waveSVG()+'</div>';});
const amps=$$('.wave .amp');

/* spectrum above the seek line. The mock has no audio, so the bands are simulated: a tilt toward the lows,
   slow moving body, a kick in the lowest bands, a snare in the mids, hats in the highs. In the app the same
   curve is fed by the real analyser. Fast attack, slow decay; the loop stops when the music stops. */
const spec=$('#spec'), sctx=spec.getContext('2d'), NB=44, lv=new Float32Array(NB);
const BPM={sia:76,lorde:129,tame:125,lana:70,kanye:104,daft:123};
let specOn=false, specLast=0, sw=0, sh=0;
function specSize(){const r=spec.getBoundingClientRect(), d=Math.min(window.devicePixelRatio||1,2); sw=Math.round(r.width*d); sh=Math.round(r.height*d); if(spec.width!==sw||spec.height!==sh){spec.width=sw; spec.height=sh;}}
function specPath(close){
  let px=0, py=sh-lv[0]*sh*.94; sctx.beginPath();
  if(close){sctx.moveTo(0,sh); sctx.lineTo(px,py);} else sctx.moveTo(px,py);
  for(let i=1;i<NB;i++){const x=i/(NB-1)*sw, y=sh-lv[i]*sh*.94; sctx.quadraticCurveTo(px,py,(px+x)/2,(py+y)/2); px=x; py=y;}
  sctx.lineTo(sw,py); if(close){sctx.lineTo(sw,sh); sctx.closePath();}
}
function specDraw(){
  if(!sw||!sh) return;
  sctx.clearRect(0,0,sw,sh);
  const acc=COVERS[T[cur].k].acc, g=sctx.createLinearGradient(0,0,0,sh); g.addColorStop(0,acc+'b8'); g.addColorStop(1,acc+'12');
  specPath(true); sctx.fillStyle=g; sctx.fill();
  specPath(false); sctx.strokeStyle=acc+'e6'; sctx.lineWidth=Math.max(1,sh/40); sctx.stroke();
}
function specStep(t){
  const ph=t*(BPM[T[cur].k]||110)/60, kick=Math.exp(-(ph%1)*7), snare=Math.exp(-((ph+.5)%1)*9), hat=Math.exp(-((ph*2)%1)*12);
  let mx=0;
  for(let i=0;i<NB;i++){
    const u=i/(NB-1); let v=0;
    if(playing){
      /* resonances that drift along the frequency axis give the curve its peaks and dips */
      const body=.5+.3*Math.sin(t*1.1+u*9)+.24*Math.sin(t*2.7-u*23)+.16*Math.sin(t*4.3+u*41);
      v=(.9-.38*u)*(.2+.5*body)+kick*Math.exp(-u*9)*.6+snare*Math.exp(-Math.pow((u-.42)/.14,2))*.36+hat*Math.exp(-Math.pow((u-.86)/.1,2))*.3;
    }
    v=Math.max(.02,Math.min(1,v)); lv[i]+=(v-lv[i])*(v>lv[i]?.5:.13); if(lv[i]>mx) mx=lv[i];
  }
  return mx;
}
function specFrame(now){
  if(!specOn) return;
  if(now-specLast>=33){specLast=now; const mx=specStep(now/1000); specDraw(); if(!playing&&mx<.035){specOn=false; return;}}
  requestAnimationFrame(specFrame);
}
function specSync(){
  const vis=!document.hidden&&!stage.classList.contains('off')&&spec.clientWidth>0;
  if(!vis){specOn=false; return;}
  specSize();
  if(reduce){for(let i=0;i<NB;i++) lv[i]=playing?(.95-.55*i/(NB-1))*.5:.02; return specDraw();}
  if(playing&&!specOn){specOn=true; requestAnimationFrame(specFrame);}
}

function paintProgress(){bar.style.setProperty('--p',(pos/T[cur].dur).toFixed(4));}

/* the only timer: 4 Hz. Stand-in for the precomputed energy curve of the track: a slow swell, no per-beat flashing. */
function tick(){
  if(document.hidden) return;
  const now=performance.now(), dt=Math.min(1,(now-last)/1000); last=now;
  if(playing){pos+=dt; if(pos>=T[cur].dur) return setTrack(cur+1,1,'vinyl');}
  specSync();
  if(dir==='e'){
    const t=now/1000, env=playing?(reduce?.6:.55+.3*Math.sin(t*.5+Math.sin(t*.13)*2)+.15*Math.sin(t*1.7)):0;
    const amp='scaleY('+(.14+.86*Math.max(0,Math.min(1,env))).toFixed(3)+')';
    amps.forEach(a=>{a.style.transform=amp;});
  }
  paintProgress();
  const sec=Math.floor(pos);
  if(sec!==lastSec){
    lastSec=sec; $('#tcur').textContent=fmt(pos); bar.setAttribute('aria-valuenow',Math.round(pos/T[cur].dur*100));
    const li=Math.floor(pos/3.5)%LYR.length; $$('#lyrics p').forEach((p,j)=>p.classList.toggle('on',j===li));
  }
}

/* wiring */
$('#rows').innerHTML=T.map((_,i)=>rowHTML(i)).join('');
$('#lyrics').innerHTML=LYR.map(l=>'<p>'+l+'</p>').join('');
$('#chips').innerHTML=AI.map((x,i)=>'<button type="button" class="chip" data-k="'+i+'">'+x.chip+'</button>').join('');
$('#fact').addEventListener('click',()=>$('#fact').classList.toggle('open'));
$$('.q-count').forEach(e=>{e.textContent='Очередь, '+T.length+' треков';});
seg('#devices','device',d=>{openSheet(''); page.dataset.device=d;});
seg('#scope','scope',s=>{scope=s; fi=0; renderFact(true);});
$('#fprev').addEventListener('click',()=>{const n=T[cur].facts[scope].length; fi=(fi-1+n)%n; renderFact(true);});
$('#fnext').addEventListener('click',()=>{const n=T[cur].facts[scope].length; fi=(fi+1)%n; renderFact(true);});
stage.addEventListener('click',ev=>{
  if(ev.target.closest('.js-prev')) return setTrack(cur-1,-1,'vinyl');
  if(ev.target.closest('.js-next')) return setTrack(cur+1,1,'vinyl');
  const o=ev.target.closest('[data-open]'); if(o) return openSheet(o.dataset.open);
  const g=ev.target.closest('.lnk[data-go]'); if(g) return go(g);
  const r=ev.target.closest('.row,.smp-chip[data-i]'); if(r){const i=+r.dataset.i; if(i!==cur) fly(r.querySelector('img'),i);}
});

cover.addEventListener('click',()=>setPlaying(!playing));
cover.addEventListener('keydown',ev=>{if(ev.key===' '||ev.key==='Enter'){ev.preventDefault(); setPlaying(!playing);}});
cover.addEventListener('pointerdown',()=>tilt.style.setProperty('--press','.96'));
['pointerup','pointerleave','pointercancel'].forEach(n=>cover.addEventListener(n,()=>tilt.style.setProperty('--press','1')));
if(matchMedia('(hover:hover)').matches&&!reduce){
  /* tilt follows the cursor, at most one style write per frame and only while the pointer is over the cover */
  let rect=null, raf=0, px=.5, py=.5;
  cover.addEventListener('pointerenter',()=>{rect=cover.getBoundingClientRect();});
  cover.addEventListener('pointermove',ev=>{
    if(!rect) rect=cover.getBoundingClientRect();
    px=(ev.clientX-rect.left)/rect.width; py=(ev.clientY-rect.top)/rect.height;
    if(!raf) raf=requestAnimationFrame(()=>{raf=0;
      tilt.style.setProperty('--ry',((px-.5)*8).toFixed(2)+'deg'); tilt.style.setProperty('--rx',((.5-py)*8).toFixed(2)+'deg');
      cover.style.setProperty('--gx',(px*100).toFixed(0)+'%'); cover.style.setProperty('--gy',(py*100).toFixed(0)+'%'); cover.style.setProperty('--go','1');});
  });
  cover.addEventListener('pointerleave',()=>{rect=null; tilt.style.setProperty('--rx','0deg'); tilt.style.setProperty('--ry','0deg'); cover.style.setProperty('--go','0');});
}

$('#flip').addEventListener('click',()=>{const v=stage.dataset.flip!=='true'; stage.dataset.flip=String(v); $('#flip').setAttribute('aria-pressed',v);});
[['#fire','#drop'],['#drop','#fire'],['#shuf',null]].forEach(([a,b])=>$(a).addEventListener('click',()=>{
  const v=$(a).getAttribute('aria-pressed')!=='true'; $(a).setAttribute('aria-pressed',v);
  if(v&&b) $(b).setAttribute('aria-pressed','false');
  if(v&&!reduce) $(a).firstElementChild.animate([{transform:'scale(1)'},{transform:'scale(1.45) rotate(-8deg)'},{transform:'scale(1)'}],{duration:520,easing:SPRING});
}));

function seek(ev){const r=bar.getBoundingClientRect(); pos=Math.max(0,Math.min(.995,(ev.clientX-r.left)/r.width))*T[cur].dur; lastSec=-1; last=performance.now(); tick();}
bar.addEventListener('pointerdown',ev=>{bar.setPointerCapture(ev.pointerId); seek(ev); bar.onpointermove=seek;});
bar.addEventListener('pointerup',()=>{bar.onpointermove=null;});
bar.addEventListener('keydown',ev=>{
  if(ev.key==='ArrowRight') pos=Math.min(T[cur].dur-1,pos+5);
  if(ev.key==='ArrowLeft') pos=Math.max(0,pos-5);
  lastSec=-1; last=performance.now(); tick();
});

document.addEventListener('keydown',ev=>{if(ev.key==='Escape') openSheet('');});
$('#chips').addEventListener('click',ev=>{const c=ev.target.closest('.chip'); if(c) say(+c.dataset.k);});
$('#ask').addEventListener('submit',ev=>{
  ev.preventDefault(); const v=$('#askInput').value.trim(); if(!v) return;
  $('#q').textContent=v; $('#askInput').value='';
  stream('В макете ассистент отвечает заготовками. В приложении здесь будет живой ответ со стримингом.',[]);
});
$$('#island button').forEach((b,i)=>b.addEventListener('click',()=>{
  $$('#island button').forEach(x=>x.removeAttribute('aria-current')); b.setAttribute('aria-current','page');
  $('#island').style.setProperty('--i',i); if(i===3&&stage.dataset.sheet!=='ai') openSheet('ai');
}));

/* nothing animates while the stage is off screen */
new IntersectionObserver(en=>stage.classList.toggle('off',!en[0].isIntersecting)).observe(stage);

setTrack(0,1,'none'); pos=14; setDir('k3'); tick();
setInterval(tick,250);
})();
