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
$$('[data-i]').forEach(el=>{const [n,s]=el.dataset.i.split(':'); el.innerHTML=icon(n,+s||20);});
const img=id=>(D.images[id]||{}).uri||'';
const cv=(id,cls)=>'<span class="cv'+(cls?' '+cls:'')+'" style="background-image:url('+img(id)+')"></span>';
const plural=(n,a,b,c)=>{const m=n%100, k=n%10; return m>10&&m<20?c:k===1?a:k>=2&&k<=4?b:c;};
const num=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const dur=ms=>{const m=Math.round(ms/60000); return m<60?m+' мин':Math.floor(m/60)+' ч '+(m%60)+' м';};

/* the taste's colours: from the anchors' covers (the server palette), a little dusted */
const pal=D.anchors.map(a=>D.images[a.c]).filter(Boolean);
['#e0703a','#c9c287','#5664b3','#b85a8a'].forEach((f,i)=>stage.style.setProperty('--c'+i,'color-mix(in srgb,'+((pal[i]||{}).vib||f)+' 72%,#6d6d78)'));
stage.style.setProperty('--acc',(pal[0]||{}).acc||'#e0703a');
stage.style.setProperty('--acc2',(pal[2]||{}).vib||'#5664b3');
$('#bgImg').style.backgroundImage='url('+D.bg+')';

/* ── fill the screens from the data ─────────────────────────────────────────── */
$$('[data-phrase]').forEach(el=>{el.textContent=D.phrase;});
$$('[data-anchors]').forEach(el=>{el.innerHTML=D.anchors.map(t=>'<a href="#" title="'+esc(t.title+' — '+t.artist)+'" data-go="'+esc('Артист: '+t.artist)+'">'+cv(t.c)+'</a>').join('');});
$$('[data-anchor-links]').forEach(el=>{const names=[...new Set(D.anchors.map(t=>t.artist))].slice(0,4);
  el.innerHTML=names.map(n=>'<button type="button" class="lnk" data-go="'+esc('Артист: '+n)+'"><span>'+esc(n)+'</span></button>').join(', ');});
$$('[data-vibes]').forEach(el=>{el.innerHTML=D.vibes.map((v,i)=>'<button type="button" class="chip js-vibe" data-n="'+i+'">'+cv(v.tracks[0].c)+'<b>'+esc(v.name)+'</b>'+icon('Play',11)+'</button>').join('');});
$$('[data-vstacks]').forEach(el=>{el.innerHTML=D.vibes.map((v,i)=>{const t=v.tracks, p=[t[2]||t[0],t[1]||t[0],t[0]];
  return '<button type="button" class="vstack js-vibe" data-n="'+i+'"><span class="pile">'+p.map(x=>cv(x.c)).join('')+'</span><span><b>'+esc(v.name)+'</b><small>'+t.length+' '+plural(t.length,'трек','трека','треков')+' · играть</small></span></button>';}).join('');});
$$('[data-fan]').forEach(el=>{el.innerHTML=D.added.slice(0,3).map(t=>cv(t.c)).join('');});
$$('[data-mosaic]').forEach(el=>{const a=D.anchors.slice(0,4); while(a.length<4) a.push(a[a.length%Math.max(1,a.length)]); el.innerHTML=a.map(t=>cv(t.c)).join('');});
$$('[data-recent-strip]').forEach(el=>{el.innerHTML=D.recent.slice(0,20).map((t,i)=>'<button type="button" class="js-track" data-list="recent" data-n="'+i+'" title="'+esc(t.title+' — '+t.artist)+'">'+cv(t.c)+'</button>').join('');});
$$('[data-shelf]').forEach(el=>{const list=D[el.dataset.shelf], small=el.dataset.shelf==='added';
  el.innerHTML=list.slice(0,small?10:14).map((t,i)=>'<button type="button" class="card js-track" data-list="'+el.dataset.shelf+'" data-n="'+i+'" title="'+esc(t.title+' — '+t.artist)+'"><span class="art">'+cv(t.c)+(small?'':'<span class="pl">'+icon('Play',16)+'</span>')+'</span>'+(small?'':'<b>'+esc(t.title)+'</b><small>'+esc(t.artist)+'</small>')+'</button>').join('');});
$$('[data-playlists]').forEach(el=>{el.innerHTML=[...D.playlists].sort((a,b)=>b.count-a.count).slice(0,5).map(p=>'<button type="button" data-go="'+esc('Плейлист: '+p.name)+'"><span class="t">'+icon('List',15)+'</span><b>'+esc(p.name)+'</b><small>'+p.count+'</small></button>').join('');});

/* discoveries: what the card says, in a sentence */
const KIND={samples:'сэмплы',relation:'связь',producer:'продюсер',artist:'артист'};
function says(c){
  if(c.fact) return c.fact;
  if(c.kind==='samples') return 'В «'+c.headline+'» '+(c.badge||'есть сэмплы')+'. Откуда они взяты и что из них получилось?';
  if(c.kind==='producer') return c.headline+' спродюсировал '+(c.subline||'').replace(' у тебя','')+' из твоей фонотеки. Общий продюсер часто значит похожий звук.';
  if(c.kind==='artist') return (c.subline||'')+'. С чего начать и что в нём главное?';
  return c.subline||'';
}
const head=c=>c.kind==='relation'&&c.badge&&c.headline.includes(' '+c.badge+' ')?c.headline.split(' '+c.badge+' ').join(' → '):c.headline;
const sub=c=>c.kind==='relation'?(c.badge||KIND.relation):(c.subline||KIND[c.kind]||'');
$$('[data-discs]').forEach(el=>{el.innerHTML=D.cards.slice(0,+el.dataset.discs).map((c,i)=>'<button type="button" class="disc js-disc" data-n="'+i+'">'+cv(c.c)+'<span><b>'+esc(head(c))+'</b><small>'+esc(sub(c))+'</small></span><p>'+esc(says(c))+'<span class="go" style="display:flex">'+icon('Sparkles',14)+'Объяснит ассистент</span></p></button>').join('');});

/* the pulse of the week */
const DAYS=['п','в','с','ч','п','с','в'], today=(new Date().getDay()+6)%7, mx=Math.max(1,...D.pulse.dailyMs);
$$('[data-pulse]').forEach(el=>{el.innerHTML='<span class="cap">За эту неделю</span><span class="val">'+dur(D.pulse.playedMs)+'</span><span class="bars" aria-hidden="true">'+D.pulse.dailyMs.map((ms,i)=>'<span'+(i===today?' class="today"':'')+'><i style="--h:'+(ms/mx).toFixed(3)+';--n:'+i+'"></i>'+DAYS[i]+'</span>').join('')+'</span><span class="meta">'+(D.pulse.topGenre?'<b>'+esc(D.pulse.topGenre)+'</b> · ':'')+D.pulse.discoveries+' '+plural(D.pulse.discoveries,'трек','трека','треков')+' впервые</span>';});

/* the counts tick up once, like a counter coming to rest */
function countUp(){ $$('[data-counts]').forEach(el=>{const a=D.counts.albums, t=D.counts.tracks, t0=performance.now();
  const txt=k=>num(Math.round(a*k))+' '+plural(a,'альбом','альбома','альбомов')+' · '+num(Math.round(t*k))+' '+plural(t,'трек','трека','треков');
  if(reduce){el.textContent=txt(1); return;}
  const step=n=>{const k=Math.min(1,(n-t0)/900), e=1-Math.pow(1-k,4); el.textContent=txt(e); if(k<1) requestAnimationFrame(step);}; requestAnimationFrame(step);});}

/* the plate «В твоей музыке» (вариант Б): the discoveries as pages; as tall as the tallest */
let fi=0;
const box=$('#factBox');
function fact(anim){const c=D.cards[fi];
  box.innerHTML=D.cards.map(x=>'<p data-sizer aria-hidden="true">'+esc(says(x))+'</p>').join('')+'<p id="factText">'+esc(says(c))+'</p>';
  $('#factTag').textContent=KIND[c.kind]||''; $('#factPos').textContent=(fi+1)+' / '+D.cards.length;
  if(anim&&!reduce) $('#factText').animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:320,easing:EASE});}
$('#factPrev').addEventListener('click',()=>{fi=(fi-1+D.cards.length)%D.cards.length; fact(true);});
$('#factNext').addEventListener('click',()=>{fi=(fi+1)%D.cards.length; fact(true);});
$('#factAsk').addEventListener('click',()=>toast('Откроется ассистент: «'+D.cards[fi].prompt+'»'));

/* ── the frame ──────────────────────────────────────────────────────────────── */
let toastT=0;
function toast(msg){const el=$('#toast'); el.textContent=msg; el.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),2600);}
function setNow(t){now=t; $('#miniCover').style.backgroundImage='url('+img(t.c)+')'; $('#miniTitle').textContent=t.title; $('#miniArtist').textContent=t.artist;
  const a=(D.images[t.c]||{}).acc; if(a) $('#mini').style.setProperty('--acc',a);}
function setPlaying(v){playing=v; stage.dataset.playing=String(v); kick();}
function pop(el){const g=el&&el.querySelector('svg'); if(g&&!reduce) g.animate([{transform:'scale(1)'},{transform:'scale(1.45) rotate(-8deg)'},{transform:'scale(1)'}],{duration:520,easing:SPRING});}
const at=el=>{const r=el.getBoundingClientRect(), s=stage.getBoundingClientRect(); return {x:(r.left-s.left)/S,y:(r.top-s.top)/S,w:r.width/S,h:r.height/S};};

/* a cover that starts playing flies from where it lay into the mini player */
function fly(from,t){const to=$('#miniCover'); if(!from||reduce){setNow(t); return;}
  const a=at(from), b=at(to), g=document.createElement('span'); g.className='cv';
  Object.assign(g.style,{position:'absolute',zIndex:7,left:b.x+'px',top:b.y+'px',width:b.w+'px',backgroundImage:'url('+img(t.c)+')',transformOrigin:'0 0',pointerEvents:'none',boxShadow:'0 20px 40px -14px rgba(0,0,0,.8)'});
  stage.appendChild(g);
  g.animate([{transform:'translate('+(a.x-b.x)+'px,'+(a.y-b.y)+'px) scale('+(a.w/b.w)+')'},{transform:'none'}],{duration:560,easing:'cubic-bezier(.2,.8,.2,1)'}).onfinish=()=>{setNow(t); g.remove();
    to.animate([{transform:'scale(1)'},{transform:'scale(1.18)'},{transform:'scale(1)'}],{duration:420,easing:SPRING});};}

stage.addEventListener('click',ev=>{
  const p=ev.target.closest('.js-play'); if(p){setPlaying(!playing); pop(p); return;}
  const v=ev.target.closest('.js-vibe'); if(v){const vibe=D.vibes[+v.dataset.n]; fly(v.querySelector('.cv:last-child')||v.querySelector('.cv'),vibe.tracks[0]); setPlaying(true); toast('Играет вайбик «'+vibe.name+'»'); return;}
  const t=ev.target.closest('.js-track'); if(t){const tr=D[t.dataset.list][+t.dataset.n]; fly(t.querySelector('.cv'),tr); setPlaying(true); return;}
  const d=ev.target.closest('.js-disc'); if(d){toast('Откроется ассистент: «'+D.cards[+d.dataset.n].prompt+'»'); return;}
  const a=ev.target.closest('.ask'); if(a){ev.preventDefault(); toast('Откроется ассистент'); return;}
  const g=ev.target.closest('[data-go]'); if(g){ev.preventDefault(); toast('В приложении: '+g.dataset.go);}
});
$$('#island button').forEach((b,i)=>b.addEventListener('click',()=>{ if(i===0) return; $('#island').style.setProperty('--i',i);
  setTimeout(()=>$('#island').style.setProperty('--i',0),1500);}));

/* the orb's highlight leans to the pointer */
$$('.orb').forEach(o=>o.addEventListener('pointermove',ev=>{const r=o.getBoundingClientRect(); o.style.setProperty('--lx',((ev.clientX-r.left)/r.width*100).toFixed(0)+'%'); o.style.setProperty('--ly',((ev.clientY-r.top)/r.height*100).toFixed(0)+'%');}));

/* the tile tilts and glares like the player's cover */
(function(){const tile=$('#tile'), tilt=$('#tileTilt'); if(!tile||reduce||!matchMedia('(hover:hover)').matches) return;
  let rect=null, raf=0, px=.5, py=.5;
  tile.addEventListener('pointerenter',()=>{rect=tile.getBoundingClientRect();});
  tile.addEventListener('pointermove',ev=>{rect=rect||tile.getBoundingClientRect(); px=(ev.clientX-rect.left)/rect.width; py=(ev.clientY-rect.top)/rect.height;
    if(!raf) raf=requestAnimationFrame(()=>{raf=0; tilt.style.setProperty('--ry',((px-.5)*8).toFixed(2)+'deg'); tilt.style.setProperty('--rx',((.5-py)*8).toFixed(2)+'deg'); tile.style.setProperty('--gx',(px*100).toFixed(0)+'%'); tile.style.setProperty('--gy',(py*100).toFixed(0)+'%'); tile.style.setProperty('--go','1');});});
  tile.addEventListener('pointerleave',()=>{rect=null; tilt.style.setProperty('--rx','0deg'); tilt.style.setProperty('--ry','0deg'); tile.style.setProperty('--go','0');});
  tile.addEventListener('pointerdown',()=>tilt.style.setProperty('--press','.96'));
  ['pointerup','pointerleave','pointercancel'].forEach(n=>tile.addEventListener(n,()=>tilt.style.setProperty('--press','1')));
})();

/* «Настроить волну» */
const tune=$('#tune'); let tuneBy=null;
function closeTune(){tune.classList.remove('on'); if(tuneBy) tuneBy.setAttribute('aria-expanded','false'); tuneBy=null;}
$$('.js-tune').forEach(b=>b.addEventListener('click',ev=>{ev.stopPropagation(); if(tuneBy===b) return closeTune(); closeTune(); const p=at(b);
  tune.style.left=Math.min(p.x,stage.clientWidth-420)+'px'; tune.style.top=(p.y+p.h+10)+'px'; tune.classList.add('on'); tuneBy=b; b.setAttribute('aria-expanded','true');}));
tune.addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; ev.stopPropagation();
  const row=b.parentElement, single=row===tune.firstElementChild;
  if(single) $$('button',row).forEach(x=>x.setAttribute('aria-pressed',x===b)); else b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true');
  if(playing) toast('Волна перестроится под новый выбор');});

/* quick search: the library at once, from what is already on the device. No AI in it;
   the last row hands the words to the assistant */
const idx=(function(){const seen=new Map(), artists=new Map(), albums=new Map();
  const all=[...D.recent,...D.added,...D.anchors,...D.vibes.flatMap(v=>v.tracks)];
  for(const t of all){ if(!seen.has(t.id)) seen.set(t.id,t);
    for(const n of t.artist.split(/,\s*|\s+feat\.?\s+/)){ if(n&&!artists.has(n)) artists.set(n,{name:n,c:t.c,n:0}); if(n) artists.get(n).n++; }
    if(t.album&&!albums.has(t.album)) albums.set(t.album,{title:t.album,artist:t.artist,year:t.year,c:t.c}); }
  return {tracks:[...seen.values()],artists:[...artists.values()],albums:[...albums.values()]};})();
const qs=$('#qs'); let qsBy=null, sel=0, hits=[];
const mark=(s,q)=>{const i=s.toLowerCase().indexOf(q); return i<0?esc(s):esc(s.slice(0,i))+'<mark>'+esc(s.slice(i,i+q.length))+'</mark>'+esc(s.slice(i+q.length));};
function search(q){q=q.trim().toLowerCase(); hits=[]; let h='';
  if(!q){ h='<h4>Недавно играло</h4>'; D.recent.slice(0,5).forEach(t=>{hits.push({t}); h+=row(hits.length-1,cv(t.c),esc(t.title),esc(t.artist),'трек');}); }
  else{
    const ar=idx.artists.filter(a=>a.name.toLowerCase().includes(q)).slice(0,3), al=idx.albums.filter(a=>a.title.toLowerCase().includes(q)).slice(0,3), tr=idx.tracks.filter(t=>t.title.toLowerCase().includes(q)).slice(0,5);
    if(ar.length){h+='<h4>Артисты</h4>'; ar.forEach(a=>{hits.push({go:'Артист: '+a.name}); h+=row(hits.length-1,cv(a.c,'round'),mark(a.name,q),a.n+' '+plural(a.n,'трек','трека','треков'),'артист');});}
    if(al.length){h+='<h4>Альбомы</h4>'; al.forEach(a=>{hits.push({go:'Альбом: '+a.title}); h+=row(hits.length-1,cv(a.c),mark(a.title,q),esc(a.artist)+(a.year?', '+a.year:''),'альбом');});}
    if(tr.length){h+='<h4>Треки</h4>'; tr.forEach(t=>{hits.push({t}); h+=row(hits.length-1,cv(t.c),mark(t.title,q),esc(t.artist),'трек');});}
    if(!hits.length) h+='<p class="empty">В библиотеке такого нет. Ассистент поищет по словам песни и по звучанию.</p>';
    hits.push({ai:q}); h+='<button type="button" class="hit ai" role="option" data-n="'+(hits.length-1)+'"><span class="orbit">'+icon('Sparkles',18)+'</span><span><b>Спросить ассистента</b><small>«'+esc(q)+'»: по тексту, по звучанию, собрать плейлист</small></span><span class="k">⏎</span></button>';
  }
  sel=0; qs.innerHTML=h; paint();}
function row(n,art,b,small,k){return '<button type="button" class="hit" role="option" data-n="'+n+'">'+art+'<span><b>'+b+'</b><small>'+small+'</small></span><span class="k">'+k+'</span></button>';}
function paint(){ $$('.hit',qs).forEach(el=>el.setAttribute('aria-selected',+el.dataset.n===sel)); const el=$('.hit[aria-selected="true"]',qs); if(el) el.scrollIntoView({block:'nearest'}); }
function openQs(field){qsBy=field; const p=at(field); qs.style.width=Math.max(p.w,440)+'px';
  const left=Math.min(Math.max(16,p.x+p.w-Math.max(p.w,440)),stage.clientWidth-Math.max(p.w,440)-16);
  qs.style.left=(p.w>=440?p.x:left)+'px'; qs.style.top=(p.y+p.h+8)+'px'; qs.style.setProperty('--ox',(p.x+p.w/2-parseFloat(qs.style.left))+'px'); qs.classList.add('on'); search($('input',field).value);}
function closeQs(){qs.classList.remove('on'); qsBy=null;}
function choose(n){const h=hits[n]; if(!h) return; const input=qsBy&&$('input',qsBy);
  if(h.t){fly(qs.querySelector('.hit[data-n="'+n+'"] .cv'),h.t); setPlaying(true);} else if(h.go) toast('В приложении: '+h.go); else toast('Откроется ассистент: «'+h.ai+'»');
  if(input){input.value=''; input.blur();} closeQs();}
$$('.find').forEach(f=>{const input=$('input',f);
  input.addEventListener('focus',()=>openQs(f)); input.addEventListener('input',()=>search(input.value));
  input.addEventListener('keydown',ev=>{ if(ev.key==='ArrowDown'){ev.preventDefault(); sel=Math.min(hits.length-1,sel+1); paint();}
    else if(ev.key==='ArrowUp'){ev.preventDefault(); sel=Math.max(0,sel-1); paint();}
    else if(ev.key==='Enter'){ev.preventDefault(); choose(sel);} else if(ev.key==='Escape'){input.blur(); closeQs();} });});
qs.addEventListener('pointerdown',ev=>ev.preventDefault());   // the field keeps the focus
qs.addEventListener('click',ev=>{const h=ev.target.closest('.hit'); if(h){ev.stopPropagation(); choose(+h.dataset.n);}});
document.addEventListener('pointerdown',ev=>{ if(qsBy&&!ev.target.closest('.find')&&!ev.target.closest('#qs')) closeQs(); if(tuneBy&&!ev.target.closest('#tune')&&!ev.target.closest('.js-tune')) closeTune(); });
document.addEventListener('keydown',ev=>{ if(ev.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){ev.preventDefault(); const f=$('.screen.v'+stage.dataset.v+' .find input'); if(f) f.focus();} if(ev.key==='Escape') closeTune(); });

/* the mini player's spectrum: 16 bands, drawn every frame while the music plays. In the
   app it is fed by the track's real bands; here by a stand-in that moves like music */
const spec=$('#spec'), sx=spec.getContext('2d'), level=new Float32Array(16); let raf=0, last=0;
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
  draw(); if(!playing&&top<.01){last=0; return;} raf=requestAnimationFrame(frame);}
function kick(){ if(!raf&&!reduce) raf=requestAnimationFrame(frame); }
spec.style.color='var(--acc)';

/* ── the page's own switches: the variant and the size of the screen ─────────── */
let size={w:1728,h:1117,name:'16″'};
function fit(){const vw=viewport.clientWidth; let w=size.w, h=size.h;
  if(!w){w=Math.max(960,vw); h=Math.max(620,Math.min(window.innerHeight-40,Math.round(w*.62)));}
  S=Math.min(1,vw/w); stage.style.width=w+'px'; stage.style.height=h+'px'; stage.style.transform=S<1?'scale('+S+')':'none'; viewport.style.height=Math.round(h*S)+'px';
  $('#sizeTag').textContent=w+' × '+h+(size.w?' · '+size.name:'')+(S<1?' · показано в '+Math.round(S*100)+' %':'');
  closeQs(); closeTune(); draw();}
$('#sizes').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; $$('#sizes button').forEach(x=>x.setAttribute('aria-pressed',x===b)); size={w:+b.dataset.w,h:+b.dataset.h,name:b.textContent}; fit();});
$('#variants').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; $$('#variants button').forEach(x=>x.setAttribute('aria-pressed',x===b));
  page.dataset.v=stage.dataset.v=b.dataset.v; closeQs(); closeTune(); countUp(); try{localStorage.setItem('home-mock-v',b.dataset.v);}catch(e){}});
window.addEventListener('resize',fit);
try{const v=localStorage.getItem('home-mock-v'); if(v&&'abc'.includes(v)){page.dataset.v=stage.dataset.v=v; $$('#variants button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===v));}}catch(e){}
if(/^#[abc]$/.test(location.hash)){const v=location.hash.slice(1); page.dataset.v=stage.dataset.v=v; $$('#variants button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===v));}

setNow(now); fact(false); countUp(); fit(); draw();
})();
