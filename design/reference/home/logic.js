(function(){
'use strict';
const D=window.DATA, IC=window.ICONS;
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING='cubic-bezier(.34,1.56,.64,1)', EASE='cubic-bezier(.22,.9,.3,1)';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const page=$('#page'), stage=$('#stage'), viewport=$('#viewport');
let S=1, playing=false, now=D.recent[0];

/* icons: the app's own set (web/src/ui/icons.tsx), drawn the same way */
function icon(name,size){const d=IC[name]; if(!d) return '';
  return '<svg class="i" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" aria-hidden="true">'+d.d.map((p,i)=>d.fill.includes(i)?'<path d="'+p+'" fill="currentColor"/>':'<path d="'+p+'" fill="none" stroke="currentColor" stroke-width="'+d.w+'" stroke-linecap="round" stroke-linejoin="round"/>').join('')+'</svg>';}
const img=id=>(D.images[id]||{}).uri||'';
const cv=(id,cls)=>'<span class="cv'+(cls?' '+cls:'')+'" style="background-image:url('+img(id)+')"></span>';
const plural=(n,a,b,c)=>{const m=n%100, k=n%10; return m>10&&m<20?c:k===1?a:k>=2&&k<=4?b:c;};
const dur=ms=>{const m=Math.round(ms/60000); return m<60?m+' мин':Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' м';};

/* the taste's colours: from the anchors' covers (the server palette), a little dusted */
const pal=D.anchors.map(a=>D.images[a.c]).filter(Boolean);
['#e0703a','#c9c287','#5664b3','#b85a8a'].forEach((f,i)=>stage.style.setProperty('--c'+i,'color-mix(in srgb,'+((pal[i]||{}).vib||f)+' 72%,#6d6d78)'));
stage.style.setProperty('--acc',(pal[0]||{}).acc||'#e0703a');
stage.style.setProperty('--acc2',(pal[2]||{}).vib||'#5664b3');
$('#bgImg').style.backgroundImage='url('+D.bg+')';

/* ── the pieces both variants share ─────────────────────────────────────────── */
const PH={lib:'Артист, альбом или песня',ai:'Строчка, звучание, плейлист…'};
const SAYS=['Найди песню, где поют про дождь и пустой город','Что-нибудь похожее по звучанию на Discovery','Собери плейлист на вечер из спокойного'];
$$('[data-find]').forEach(el=>{el.innerHTML='<div class="find" data-mode="lib"><span class="fmode" role="radiogroup" aria-label="Где искать"><span class="thumb" aria-hidden="true"></span>'
  +'<button type="button" role="radio" data-m="lib" aria-checked="true">'+icon('Search',14)+'Библиотека</button><button type="button" role="radio" data-m="ai" aria-checked="false">'+icon('Sparkles',14)+'ИИ</button></span>'
  +'<input type="text" autocomplete="off" spellcheck="false" placeholder="'+PH.lib+'" aria-label="Поиск"><kbd>/</kbd></div>';});
$$('[data-wavebtn]').forEach(el=>{el.innerHTML='<button type="button" class="wave js-play" aria-label="Моя волна"><span class="w-pool"></span><span class="w-body"><span class="w-liquid"><i></i><i></i></span><span class="w-frost"></span><span class="w-vinyl"><span class="w-label"><i></i></span></span><span class="w-sheen"></span><canvas class="w-ripple" aria-hidden="true"></canvas><span class="w-core"></span></span>'
  +'<span class="w-glyph"><span data-when="idle">'+icon('Play',40)+'</span><span data-when="playing">'+icon('Pause',40)+'</span></span></button>';});
const FAM=D.presets.filter(p=>p.row==='familiarity'), SND=D.presets.filter(p=>p.row==='sound');
$$('[data-tuner]').forEach(el=>{el.innerHTML='<div class="tuner" role="group" aria-label="Настрой волны"><div class="tseg" role="radiogroup" aria-label="Что играть"><span class="thumb" aria-hidden="true"></span>'
  +FAM.map(p=>'<button type="button" role="radio" data-fam="'+p.id+'" aria-checked="false">'+esc(p.label)+'</button>').join('')+'</div><div class="tsound">'
  +SND.map(p=>'<button type="button" class="tchip" data-sound="'+p.id+'" aria-pressed="false">'+esc(p.label)+'</button>').join('')+'</div></div>';});
$$('[data-i]').forEach(el=>{const [n,s]=el.dataset.i.split(':'); el.innerHTML=icon(n,+s||20);});

/* the phrase; the names in it (Latin words in a Russian sentence) lead to their artists */
const NAME=/([A-Za-z](?:[A-Za-z0-9'’.&-]*[A-Za-z0-9])?(?: [A-Z](?:[A-Za-z0-9'’.&-]*[A-Za-z0-9])?)*)/;
$$('[data-phrase]').forEach(el=>{el.innerHTML=D.phrase.split(NAME).map((part,i)=>i%2?'<a href="#" class="nm" data-go="'+esc('Артист: '+part)+'">'+esc(part)+'</a>':esc(part)).join('');});
$$('[data-vstacks]').forEach(el=>{el.innerHTML=D.vibes.map((v,i)=>{const t=v.tracks, p=[t[2]||t[0],t[1]||t[0],t[0]];
  return '<button type="button" class="vstack js-vibe" data-n="'+i+'"><span class="pile">'+p.map(x=>cv(x.c)).join('')+'</span><span style="min-width:0"><b>'+esc(v.name)+'</b><small>'+t.length+' '+plural(t.length,'трек','трека','треков')+icon('Play',10)+'</small></span></button>';}).join('');});

/* albums to put on whole: the sleeve with its record; the label takes the cover's colour */
$$('[data-albums]').forEach(el=>{el.innerHTML=D.albums.map((a,i)=>'<button type="button" class="alb js-album" data-n="'+i+'" style="--lab:'+((D.images[a.c]||{}).vib||'#b7b0a0')+'"><span class="sleeve"><span class="disc"></span>'+cv(a.c)+'</span><b>'+esc(a.title)+'</b><small>'+esc(a.artist)+'</small><em>'+esc(a.why)+'</em></button>').join('');});
const albCap=$('#albCap'), ALB_IDLE='что давно не включал и до чего не дошёл';
function capSay(t){ if(albCap.textContent===t) return; albCap.textContent=t; if(!reduce) albCap.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:240,easing:EASE}); }
albCap.textContent=ALB_IDLE;
$$('.b-albums .rowx').forEach(r=>{ r.addEventListener('pointerover',ev=>{const a=ev.target.closest('.alb'); if(a){const x=D.albums[+a.dataset.n]; capSay(x.title+' · '+x.artist+' · '+x.why);}});
  r.addEventListener('pointerleave',()=>capSay(ALB_IDLE)); });

/* playlists have no pictures of their own: plain names, or a mosaic of their tracks' covers */
const PLS=[...D.playlists].sort((a,b)=>b.count-a.count);
$$('[data-plnames]').forEach(el=>{el.innerHTML=PLS.slice(0,4).map(p=>'<button type="button" data-go="'+esc('Плейлист: '+p.name)+'"><span>'+esc(p.name)+'</span><small>'+p.count+'</small></button>').join('');});
$$('[data-plmos]').forEach(el=>{el.innerHTML=PLS.slice(0,6).map(p=>{const m=p.covers.length>=4?p.covers.slice(0,4):p.covers.slice(0,1);
  return '<button type="button" class="pl" data-go="'+esc('Плейлист: '+p.name)+'"><span class="mos'+(m.length<4?' one':'')+'">'+m.map(c=>cv(c)).join('')+'</span><span style="min-width:0"><b>'+esc(p.name)+'</b><small>'+p.count+' '+plural(p.count,'трек','трека','треков')+'</small></span></button>';}).join('');});

/* the week: the last seven days, today last. The test database has almost no listening, so
   the numbers here are an example; the app takes them from /home */
(function(){const WD=['вс','пн','вт','ср','чт','пт','сб'], IN=['в воскресенье','в понедельник','во вторник','в среду','в четверг','в пятницу','в субботу'];
  const real=D.pulse.playedMs>30*60000, dow=new Date().getDay();
  const days=real?D.pulse.dailyMs.slice(-7):[64,131,0,97,148,58,41].map(m=>m*60000), total=days.reduce((a,b)=>a+b,0), mx=Math.max(1,...days);
  let streak=0; for(let i=6;i>=0&&days[i]>0;i--) streak++;
  const fresh=real?D.pulse.discoveries:17, top=D.recent[0];
  const say=i=>i===6?'сегодня':i===5?'вчера':IN[(dow-(6-i)+7)%7];
  $$('[data-week]').forEach(el=>{
    el.innerHTML='<span class="cap">За 7 дней</span><div class="wrow"><span class="val"><span class="n">'+dur(total)+'</span><small>музыки</small></span><span class="bars">'
      +days.map((ms,i)=>'<button type="button" data-d="'+i+'"'+(i===6?' class="today"':'')+' aria-label="'+say(i)+': '+dur(ms)+'"><i style="--h:'+(ms/mx).toFixed(3)+';--n:'+i+'"></i>'+WD[(dow-(6-i)+7)%7]+'</button>').join('')+'</span></div>'
      +'<div class="mets"><span><b>'+streak+'</b> '+plural(streak,'день','дня','дней')+' подряд</span><span><b>'+fresh+'</b> '+plural(fresh,'трек','трека','треков')+' впервые</span><span class="who">'+cv(top.c)+'чаще всего <b>'+esc(top.artist)+'</b></span></div>';
    const n=$('.n',el), cap=$('.val small',el);
    const show=(a,b)=>{ if(n.textContent===a&&cap.textContent===b) return; n.textContent=a; cap.textContent=b; if(!reduce) n.animate([{opacity:.2,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:260,easing:EASE}); };
    $$('.bars button',el).forEach(b=>{const i=+b.dataset.d, on=()=>show(dur(days[i]),say(i)); b.addEventListener('pointerenter',on); b.addEventListener('focus',on);});
    $('.bars',el).addEventListener('pointerleave',()=>show(dur(total),'музыки')); $('.bars',el).addEventListener('focusout',()=>show(dur(total),'музыки'));
  });})();

/* ── the frame ──────────────────────────────────────────────────────────────── */
let toastT=0;
function toast(msg){const el=$('#toast'); el.textContent=msg; el.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),2600);}
function setNow(t){now=t; $('#miniCover').style.backgroundImage='url('+img(t.c)+')'; $('#miniTitle').textContent=t.title; $('#miniArtist').textContent=t.artist;
  const a=(D.images[t.c]||{}).acc; if(a) $('#mini').style.setProperty('--acc',a);}
function setPlaying(v){playing=v; stage.dataset.playing=String(v); flow(); kick();}
function pop(el){const g=el&&[...el.querySelectorAll('svg')].find(x=>x.getClientRects().length); if(g&&!reduce) g.animate([{transform:'scale(1)'},{transform:'scale(1.45) rotate(-8deg)'},{transform:'scale(1)'}],{duration:520,easing:SPRING});}
const at=el=>{const r=el.getBoundingClientRect(), s=stage.getBoundingClientRect(); return {x:(r.left-s.left)/S,y:(r.top-s.top)/S,w:r.width/S,h:r.height/S};};

/* a cover that starts playing flies from where it lay into the mini player */
function fly(from,t){const to=$('#miniCover'); if(!from||reduce){setNow(t); return;}
  const a=at(from), b=at(to), g=document.createElement('span'); g.className='cv';
  Object.assign(g.style,{position:'absolute',zIndex:7,left:b.x+'px',top:b.y+'px',width:b.w+'px',backgroundImage:'url('+img(t.c)+')',transformOrigin:'0 0',pointerEvents:'none',boxShadow:'0 20px 40px -14px rgba(0,0,0,.8)'});
  stage.appendChild(g);
  g.animate([{transform:'translate('+(a.x-b.x)+'px,'+(a.y-b.y)+'px) scale('+(a.w/b.w)+')'},{transform:'none'}],{duration:560,easing:'cubic-bezier(.2,.8,.2,1)'}).onfinish=()=>{setNow(t); g.remove();
    to.animate([{transform:'scale(1)'},{transform:'scale(1.18)'},{transform:'scale(1)'}],{duration:420,easing:SPRING});};}

/* ── the wave's button ──────────────────────────────────────────────────────── */
/* The light (frost) turns all the time, and how fast says what is going on: barely at
   rest, alive under the pointer, quick while the wave plays; the sound setting slows or
   drives it. The record (vinyl) stands still until the wave plays, and only nudges under
   the pointer. Rates change through the animations' playback rate, so nothing jumps */
let fam='mix', sound=null, hot=false, burstT=0;
const liquids=reduce?[]:$$('.w-liquid i').map((el,i)=>el.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:i%2?12000:20000,iterations:Infinity,direction:i%2?'reverse':'normal'}));
const labels=reduce?[]:$$('.w-label').map(el=>el.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:1800,iterations:Infinity}));
function flow(k){const rate=(playing?2.3:hot?1:.14)*(sound==='calm'?.55:sound==='energetic'?1.8:1)*(k||1); liquids.forEach(a=>a.updatePlaybackRate(rate));
  labels.forEach(a=>a.updatePlaybackRate(playing?1:hot?.2:0));}
function ring(w){ if(reduce) return; if(stage.dataset.wave==='ripple'){emit(2.4); return;} const r=document.createElement('span'); r.className='w-ring'; w.appendChild(r);
  r.animate([{transform:'scale(1)',opacity:.7},{transform:'scale(1.55)',opacity:0}],{duration:700,easing:'cubic-bezier(.2,.7,.2,1)'}).onfinish=()=>r.remove();}
function gulp(){ $$('.wave').forEach(w=>{ if(w.offsetWidth) ring(w); }); flow(4.5); clearTimeout(burstT); burstT=setTimeout(()=>flow(),620); }
$$('.wave').forEach(w=>{ let raf=0, x=50, y=50;
  w.addEventListener('pointermove',ev=>{const r=w.getBoundingClientRect(); x=(ev.clientX-r.left)/r.width*100; y=(ev.clientY-r.top)/r.height*100;
    if(!raf) raf=requestAnimationFrame(()=>{raf=0; w.style.setProperty('--lx',x.toFixed(1)+'%'); w.style.setProperty('--ly',y.toFixed(1)+'%'); w.style.setProperty('--sa',(Math.atan2(y-50,x-50)*180/Math.PI+90).toFixed(0)+'deg');});});
  w.addEventListener('pointerenter',()=>{hot=true; flow();});
  w.addEventListener('pointerleave',()=>{hot=false; flow(); ['--lx','--ly','--sa'].forEach(k=>w.style.removeProperty(k));});
  w.addEventListener('click',()=>ring(w)); });

/* rings on water: a canvas wider than the button, rings run out from its centre and fade.
   One on every beat while the wave plays, a quiet one now and then at rest */
const COLS=['#e0703a','#c9c287','#5664b3','#b85a8a'].map((f,i)=>(pal[i]||{}).vib||f);
const rings=[]; let ripRaf=0, lastEmit=0, nextIdle=0, beatOn=false;
function emit(w){ rings.push({t0:performance.now(),w:w||1.5,c:COLS[rings.length%4]}); lastEmit=performance.now(); ripKick(); }
function ripFrame(t){ ripRaf=0; const on=stage.dataset.wave==='ripple'; if(!on){rings.length=0; $$('.w-ripple').forEach(c=>{const x=c.getContext('2d'); x.clearRect(0,0,c.width,c.height);}); return;}
  if(!playing&&t>nextIdle){ emit(1.2); nextIdle=t+(hot?1100:2600); }
  const d=Math.min(devicePixelRatio||1,2);
  for(const c of $$('.w-ripple')){ if(!c.offsetWidth) continue; const r=c.getBoundingClientRect(), w=Math.round(r.width/S*d), h=Math.round(r.height/S*d); if(c.width!==w||c.height!==h){c.width=w; c.height=h;}
    const x=c.getContext('2d'); x.clearRect(0,0,w,h); const R=w/2, r0=R*.105, r1=R*.98;
    for(const g of rings){ const k=(t-g.t0)/1700; if(k>=1) continue; const e=1-Math.pow(1-k,2.2); x.beginPath(); x.arc(R,R,r0+(r1-r0)*e,0,Math.PI*2); x.globalAlpha=(1-k)*(1-k)*.9; x.strokeStyle=g.c; x.lineWidth=g.w*d*(1-k*.6); x.stroke(); } x.globalAlpha=1; }
  for(let i=rings.length-1;i>=0;i--) if(t-rings[i].t0>=1700) rings.splice(i,1);
  ripRaf=requestAnimationFrame(ripFrame); }
function ripKick(){ if(!ripRaf&&!reduce) ripRaf=requestAnimationFrame(ripFrame); }

/* the wave's style: one state, shown by every tuner on the page and by the ball itself */
function thumbs(){ $$('.fmode,.tseg').forEach(g=>{const b=$('[aria-checked="true"]',g), t=$('.thumb',g); if(!b||!b.offsetWidth) return; t.style.setProperty('--x',b.offsetLeft+'px'); t.style.setProperty('--w',b.offsetWidth+'px');}); }
function tune(){ stage.dataset.fam=fam; $$('.tseg button').forEach(b=>b.setAttribute('aria-checked',b.dataset.fam===fam)); $$('.tchip').forEach(b=>b.setAttribute('aria-pressed',b.dataset.sound===sound)); thumbs(); }
stage.addEventListener('click',ev=>{
  const f=ev.target.closest('.tseg button'); if(f){ if(f.dataset.fam!==fam){fam=f.dataset.fam; tune(); gulp(); if(playing) toast('Волна перестраивается: «'+f.textContent+'»');} return; }
  const c=ev.target.closest('.tchip'); if(c){ sound=sound===c.dataset.sound?null:c.dataset.sound; tune(); gulp(); if(playing) toast(sound?'Волна перестраивается: «'+c.textContent+'»':'Волна вернулась к обычному звуку'); return; }
  const p=ev.target.closest('.js-play'); if(p){setPlaying(!playing); pop(p); return;}
  const v=ev.target.closest('.js-vibe'); if(v){const vibe=D.vibes[+v.dataset.n]; fly(v.querySelector('.cv:last-child')||v.querySelector('.cv'),vibe.tracks[0]); setPlaying(true); toast('Играет вайбик «'+vibe.name+'»'); return;}
  const a=ev.target.closest('.js-album'); if(a){const x=D.albums[+a.dataset.n]; toast('В приложении: альбом «'+x.title+'» раскрывается, пластинка выезжает из конверта'); return;}
  const g=ev.target.closest('[data-go]'); if(g){ev.preventDefault(); toast('В приложении: '+g.dataset.go);}
});
$$('#island button').forEach((b,i)=>b.addEventListener('click',()=>{ if(i===0) return; $('#island').style.setProperty('--i',i);
  setTimeout(()=>$('#island').style.setProperty('--i',0),1500);}));

/* ── search: the library at once by default; the switch hands the field to the assistant ─ */
const idx=(function(){const seen=new Map(), artists=new Map(), albums=new Map();
  const all=[...D.recent,...D.added,...D.anchors,...D.vibes.flatMap(v=>v.tracks)];
  for(const a of D.albums) albums.set(a.title,{title:a.title,artist:a.artist,year:a.year,c:a.c});
  for(const t of all){ if(!seen.has(t.id)) seen.set(t.id,t);
    for(const n of t.artist.split(/,\s*|\s+feat\.?\s+/)){ if(n&&!artists.has(n)) artists.set(n,{name:n,c:t.c,n:0}); if(n) artists.get(n).n++; }
    if(t.album&&!albums.has(t.album)) albums.set(t.album,{title:t.album,artist:t.artist,year:t.year,c:t.c}); }
  return {tracks:[...seen.values()],artists:[...artists.values()],albums:[...albums.values()]};})();
const qs=$('#qs'); let qsBy=null, sel=0, hits=[], mode='lib';
const mark=(s,q)=>{const i=s.toLowerCase().indexOf(q); return i<0?esc(s):esc(s.slice(0,i))+'<mark>'+esc(s.slice(i,i+q.length))+'</mark>'+esc(s.slice(i+q.length));};
const row=(n,art,b,small,k)=>'<button type="button" class="hit" role="option" data-n="'+n+'">'+art+'<span><b>'+b+'</b><small>'+small+'</small></span><span class="k">'+k+'</span></button>';
const askRow=(n,q,first)=>'<button type="button" class="hit ai" role="option" data-n="'+n+'"'+(first?' style="margin-top:0;border-top:0"':'')+'><span class="orbit">'+icon('Sparkles',18)+'</span><span><b>Спросить ассистента</b><small>«'+esc(q)+'»: по тексту, по звучанию, собрать плейлист</small></span><span class="k">⏎</span></button>';
function search(q){q=q.trim(); const lq=q.toLowerCase(); hits=[]; let h='';
  if(mode==='ai'){
    if(!q){h='<h4>Спроси ассистента</h4>'; SAYS.forEach(s=>{hits.push({ai:s}); h+='<button type="button" class="say" role="option" data-n="'+(hits.length-1)+'">'+esc(s)+'</button>';});}
    else{hits.push({ai:q}); h=askRow(0,q,true);}
  }else if(q){
    const ar=idx.artists.filter(a=>a.name.toLowerCase().includes(lq)).slice(0,3), al=idx.albums.filter(a=>a.title.toLowerCase().includes(lq)).slice(0,3), tr=idx.tracks.filter(t=>t.title.toLowerCase().includes(lq)).slice(0,5);
    if(ar.length){h+='<h4>Артисты</h4>'; ar.forEach(a=>{hits.push({go:'Артист: '+a.name}); h+=row(hits.length-1,cv(a.c,'round'),mark(a.name,lq),a.n+' '+plural(a.n,'трек','трека','треков'),'артист');});}
    if(al.length){h+='<h4>Альбомы</h4>'; al.forEach(a=>{hits.push({go:'Альбом: '+a.title}); h+=row(hits.length-1,cv(a.c),mark(a.title,lq),esc(a.artist)+(a.year?', '+a.year:''),'альбом');});}
    if(tr.length){h+='<h4>Треки</h4>'; tr.forEach(t=>{hits.push({t}); h+=row(hits.length-1,cv(t.c),mark(t.title,lq),esc(t.artist),'трек');});}
    if(!hits.length) h+='<p class="empty">В библиотеке такого нет. Ассистент поищет по словам песни и по звучанию.</p>';
    hits.push({ai:q}); h+=askRow(hits.length-1,q,false);
  }
  sel=0; qs.innerHTML=h; qs.classList.toggle('on',!!h); paint();}
function paint(){ $$('[data-n]',qs).forEach(el=>el.setAttribute('aria-selected',+el.dataset.n===sel)); const el=$('[aria-selected="true"]',qs); if(el) el.scrollIntoView({block:'nearest'}); }
function openQs(field){qsBy=field; const p=at(field), w=Math.max(p.w,440);
  const left=Math.min(Math.max(16,p.x+p.w-w),stage.clientWidth-w-16);
  qs.style.width=w+'px'; qs.style.left=left+'px'; qs.style.top=(p.y+p.h+8)+'px'; qs.style.setProperty('--ox',(p.x+p.w/2-left)+'px'); search($('input',field).value);}
function closeQs(){qs.classList.remove('on'); qsBy=null;}
function choose(n){const h=hits[n]; if(!h) return; const input=qsBy&&$('input',qsBy);
  if(h.t){fly(qs.querySelector('[data-n="'+n+'"] .cv'),h.t); setPlaying(true);} else if(h.go) toast('В приложении: '+h.go); else toast('Откроется ассистент: «'+h.ai+'»');
  if(input){input.value=''; input.blur();} closeQs();}
function setMode(m){ mode=m; $$('.find').forEach(f=>{f.dataset.mode=m; $$('.fmode button',f).forEach(b=>b.setAttribute('aria-checked',b.dataset.m===m)); $('input',f).placeholder=PH[m]; $('kbd',f).textContent=m==='ai'?'⏎':'/';}); thumbs(); }
$$('.find').forEach(f=>{const input=$('input',f);
  f.addEventListener('click',ev=>{const b=ev.target.closest('.fmode button'); if(b){ if(b.dataset.m!==mode) setMode(b.dataset.m); input.focus(); openQs(f); return; } if(ev.target!==input) input.focus();});
  input.addEventListener('focus',()=>openQs(f)); input.addEventListener('input',()=>openQs(f));
  input.addEventListener('keydown',ev=>{ if(ev.key==='ArrowDown'){ev.preventDefault(); sel=Math.min(hits.length-1,sel+1); paint();}
    else if(ev.key==='ArrowUp'){ev.preventDefault(); sel=Math.max(0,sel-1); paint();}
    else if(ev.key==='Enter'){ev.preventDefault(); choose(sel);} else if(ev.key==='Escape'){input.blur(); closeQs();} });});
qs.addEventListener('pointerdown',ev=>ev.preventDefault());   // the field keeps the focus
qs.addEventListener('click',ev=>{const h=ev.target.closest('[data-n]'); if(h){ev.stopPropagation(); choose(+h.dataset.n);}});
document.addEventListener('pointerdown',ev=>{ if(qsBy&&!ev.target.closest('.find')&&!ev.target.closest('#qs')) closeQs(); });
document.addEventListener('keydown',ev=>{ if(ev.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){ev.preventDefault(); const f=$('.screen.v'+stage.dataset.v+' .find input'); if(f) f.focus();} });

/* the mini player's spectrum: 16 bands, drawn every frame while the music plays. In the
   app it is fed by the track's real bands; here by a stand-in that moves like music. The
   same bass moves the wave's ball */
const spec=$('#spec'), sx=spec.getContext('2d'), level=new Float32Array(16), bodies=$$('.w-body'); let raf=0, last=0;
function draw(){const r=spec.getBoundingClientRect(), d=Math.min(devicePixelRatio||1,2)*Math.max(1,S), w=Math.round(r.width/S*d), h=Math.round(r.height/S*d);
  if(spec.width!==w||spec.height!==h){spec.width=w; spec.height=h;} if(!w||!h) return;
  sx.clearRect(0,0,w,h); if(Math.max.apply(null,level)<.01) return; const acc=getComputedStyle(spec).color, base=h-d, span=h-3*d, x0=w*.04, dx=w*.92/15; let px=0, py=base;
  sx.beginPath(); sx.moveTo(0,base);
  for(let i=0;i<=16;i++){const x=i<16?x0+i*dx:w, y=i<16?base-level[i]*span:base; sx.quadraticCurveTo(px,py,(px+x)/2,(py+y)/2); px=x; py=y;}
  sx.lineTo(w,base); const g=sx.createLinearGradient(0,0,0,h); g.addColorStop(0,acc); g.addColorStop(1,'transparent');
  sx.globalAlpha=.5; sx.fillStyle=g; sx.fill(); sx.globalAlpha=.95; sx.strokeStyle=acc; sx.lineWidth=1.5*d; sx.stroke(); sx.globalAlpha=1;}
function frame(t){raf=0; const dt=last?Math.min(64,t-last):16; last=t; const up=1-Math.exp(-dt/18), down=1-Math.exp(-dt/150); let top=0;
  for(let b=0;b<16;b++){let v=0; if(playing){const beat=Math.pow(Math.max(0,Math.sin(t/1000*Math.PI*2.05-b*.12)),6-b*.2); v=Math.min(1,.16+.5*beat*(1-b/26)+.3*Math.abs(Math.sin(t/470+b*1.7)*Math.sin(t/1310+b*.6)));}
    level[b]+=(v-level[b])*(v>level[b]?up:down); top=Math.max(top,level[b]);}
  const bassN=Math.max(0,(level[0]+level[1]+level[2])/3-.16), bass=bassN.toFixed(3); bodies.forEach(el=>el.style.setProperty('--beat',bass));
  if(playing&&stage.dataset.wave==='ripple'){ if(bassN>.3&&!beatOn&&t-lastEmit>300){beatOn=true; emit(1.6);} else if(bassN<.16) beatOn=false; }
  draw(); if(!playing&&top<.01){last=0; bodies.forEach(el=>el.style.removeProperty('--beat')); return;} raf=requestAnimationFrame(frame);}
function kick(){ if(!raf&&!reduce) raf=requestAnimationFrame(frame); }
spec.style.color='var(--acc)';

/* ── fitting: the headline takes the largest size at which it stands in four lines; a row
   of albums or playlists shows exactly as many as fit whole, never a cut one ─────────── */
function fitPhrase(){const el=$('.b-phrase'); if(!el||!el.offsetWidth) return; el.style.fontSize='';
  let size=parseFloat(getComputedStyle(el).fontSize); const room=()=>size*4.12;
  while(size>30&&el.scrollHeight>room()){size-=2; el.style.fontSize=size+'px';}}
function trimRows(){ $$('[data-trim]').forEach(r=>{ if(!r.offsetWidth) return; const kids=[...r.children]; kids.forEach(k=>{k.style.display='';});
  const cols=getComputedStyle(r).gridTemplateColumns.split(' ').filter(Boolean).length; kids.forEach((k,i)=>{ if(i>=cols) k.style.display='none'; }); }); }
function settle(){ thumbs(); trimRows(); fitPhrase(); }

/* ── the page's own switches: the variant and the size of the screen ─────────── */
let size={w:1728,h:1117,name:'16″'};
function fit(){const vw=viewport.clientWidth; let w=size.w, h=size.h;
  if(!w){w=Math.max(960,vw); h=Math.max(620,Math.min(window.innerHeight-40,Math.round(w*.62)));}
  S=Math.min(1,vw/w); stage.style.width=w+'px'; stage.style.height=h+'px'; stage.style.transform=S<1?'scale('+S+')':'none'; viewport.style.height=Math.round(h*S)+'px';
  $('#sizeTag').textContent=w+' × '+h+(size.w?' · '+size.name:'')+(S<1?' · показано в '+Math.round(S*100)+' %':'');
  closeQs(); settle(); draw();}
function setVariant(v){page.dataset.v=stage.dataset.v=v; $$('#variants button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===v)); closeQs(); settle();}
$('#sizes').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; $$('#sizes button').forEach(x=>x.setAttribute('aria-pressed',x===b)); size={w:+b.dataset.w,h:+b.dataset.h,name:b.textContent}; fit();});
function setWave(m){stage.dataset.wave=m; $$('#waves button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.wave===m)); nextIdle=0; ripKick();}
$('#waves').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; setWave(b.dataset.wave); try{localStorage.setItem('home-mock-wave',b.dataset.wave);}catch(e){}});
try{const m=localStorage.getItem('home-mock-wave'); if(m&&['frost','vinyl','ripple'].includes(m)) setWave(m);}catch(e){}
$('#variants').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; setVariant(b.dataset.v); try{localStorage.setItem('home-mock-v2',b.dataset.v);}catch(e){}});
window.addEventListener('resize',fit);
try{const v=localStorage.getItem('home-mock-v2'); if(v&&'bc'.includes(v)) setVariant(v);}catch(e){}
if(/^#[bc]$/.test(location.hash)) setVariant(location.hash.slice(1));

setNow(now); tune(); flow(); fit(); ripKick();
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(settle);
})();
