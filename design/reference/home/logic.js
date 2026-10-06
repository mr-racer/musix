(function(){
'use strict';
const D=window.DATA, IC=window.ICONS;
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPRING='cubic-bezier(.34,1.56,.64,1)', EASE='cubic-bezier(.22,.9,.3,1)';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const stage=$('#stage'), viewport=$('#viewport');
let S=1, playing=false, now=D.recent[0];

/* icons: the app's own set (web/src/ui/icons.tsx), drawn the same way */
function icon(name,size){const d=IC[name]; if(!d) return '';
  return '<svg class="i" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" aria-hidden="true">'+d.d.map((p,i)=>d.fill.includes(i)?'<path d="'+p+'" fill="currentColor"/>':'<path d="'+p+'" fill="none" stroke="currentColor" stroke-width="'+d.w+'" stroke-linecap="round" stroke-linejoin="round"/>').join('')+'</svg>';}
const img=id=>(D.images[id]||{}).uri||'';
const cv=(id,cls)=>'<span class="cv'+(cls?' '+cls:'')+'" style="background-image:url('+img(id)+')"></span>';
const plural=(n,a,b,c)=>{const m=n%100, k=n%10; return m>10&&m<20?c:k===1?a:k>=2&&k<=4?b:c;};
const num=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const dur=ms=>{const m=Math.round(ms/60000); return m<60?m+' мин':Math.floor(m/60)+' ч '+String(m%60).padStart(2,'0')+' м';};

/* the taste's colours: from the anchors' covers (the server palette), a little dusted */
const pal=D.anchors.map(a=>D.images[a.c]).filter(Boolean);
['#e0703a','#c9c287','#5664b3','#b85a8a'].forEach((f,i)=>stage.style.setProperty('--c'+i,'color-mix(in srgb,'+((pal[i]||{}).vib||f)+' 72%,#6d6d78)'));
stage.style.setProperty('--acc',(pal[0]||{}).acc||'#e0703a');
stage.style.setProperty('--acc2',(pal[2]||{}).vib||'#5664b3');
$('#bgImg').style.backgroundImage='url('+D.bg+')';

/* ── the pieces ─────────────────────────────────────────────────────────────── */
const PH={lib:'Артист, альбом или песня',ai:'Строчка, звучание, плейлист…'};
const SAYS=['Найди песню, где поют про дождь и пустой город','Что-нибудь похожее по звучанию на Discovery','Собери плейлист на вечер из спокойного'];
$$('[data-find]').forEach(el=>{el.innerHTML='<div class="find" data-mode="lib"><span class="fmode" role="radiogroup" aria-label="Где искать"><span class="thumb" aria-hidden="true"></span>'
  +'<button type="button" role="radio" data-m="lib" aria-checked="true">'+icon('Search',14)+'Библиотека</button><button type="button" role="radio" data-m="ai" aria-checked="false">'+icon('Sparkles',14)+'ИИ</button></span>'
  +'<input type="text" id="findInput" autocomplete="off" spellcheck="false" placeholder="'+PH.lib+'" aria-label="Поиск"><kbd>/</kbd></div>';});
$$('[data-wavebtn]').forEach(el=>{el.innerHTML='<button type="button" class="orb js-play" aria-label="Включить поток"><span class="o-ring"></span><span class="o-clip"><span class="o-breathe"><span class="o-liquid"><i class="o-b1"></i><i class="o-b2"></i><i class="o-b3"></i><i class="o-b4"></i></span></span></span><span class="o-cap"></span>'
  +'<span class="o-glyph"><span data-when="idle">'+icon('Play',24)+'</span><span data-when="playing">'+icon('Pause',24)+'</span></span><span class="o-halo"></span></button>';});
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
$$('[data-fan]').forEach(el=>{el.innerHTML=D.added.slice(0,3).map(t=>cv(t.c)).join('');});

/* albums to put on whole: the sleeve with its record; the label takes the cover's colour */
/* v1's picks (recommend/vibes/album-suggestions): for every current вайбик, the album whose
   mean CLAP is closest to the vibe's centre but which is not inside the vibe, two per vibe
   at most, round-robin (every vibe places its first before any places its second). The
   reason is the vibe itself. The mock has no CLAP, so the albums here are stand-ins laid
   out in that order; the app gets the real ones from the ported endpoint */
const PICKS=D.albums.slice(0,6).map((a,i)=>({...a,why:'≈ '+D.vibes[i%D.vibes.length].name}));
$$('[data-albums]').forEach(el=>{el.innerHTML=PICKS.map((a,i)=>'<button type="button" class="alb js-album" data-n="'+i+'" style="--lab:'+((D.images[a.c]||{}).vib||'#b7b0a0')+'"><span class="sleeve"><span class="disc"></span>'+cv(a.c)+'</span><span style="min-width:0"><b>'+esc(a.title)+'</b><small>'+esc(a.artist)+(a.year?' · '+a.year:'')+'</small><em>'+esc(a.why)+'</em></span></button>').join('');});
const albCap=$('#albCap'), ALB_IDLE='звучат как твои вайбики, но не из них';
function capSay(t){ if(albCap.textContent===t) return; albCap.textContent=t; if(!reduce) albCap.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:240,easing:EASE}); }
albCap.textContent=ALB_IDLE;
$$('.a-albums .rowx').forEach(r=>{ r.addEventListener('pointerover',ev=>{const a=ev.target.closest('.alb'); if(a){const x=PICKS[+a.dataset.n]; capSay(x.n+' '+plural(x.n,'трек','трека','треков')+(x.plays?' · слушал '+x.plays+' '+plural(x.plays,'раз','раза','раз'):' · ещё ни разу'));}});
  r.addEventListener('pointerleave',()=>capSay(ALB_IDLE)); });

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

/* the counts tick up once, like a counter coming to rest */
function countUp(){ $$('[data-counts]').forEach(el=>{const a=D.counts.albums, t=D.counts.tracks, t0=performance.now();
  const txt=k=>num(Math.round(a*k))+' '+plural(a,'альбом','альбома','альбомов')+' · '+num(Math.round(t*k))+' '+plural(t,'трек','трека','треков');
  if(reduce){el.textContent=txt(1); return;}
  const step=n=>{const k=Math.min(1,(n-t0)/900), e=1-Math.pow(1-k,4); el.textContent=txt(e); if(k<1) requestAnimationFrame(step);}; requestAnimationFrame(step);});}

/* ── the sky ────────────────────────────────────────────────────────────────── */
/* v1's home had a soft ambient in its top half; this is the same idea drawn on a canvas a
   tenth of the stage's size and stretched, so the light is soft by nature and costs
   nothing. Three spots of sky in real colours for the hour and the weather, the sun (or
   the moon), two quieter spots in the taste's colours, and while the wave plays those two
   take the colours of the cover that is playing: the room is lit by what sounds */
const COLS=['#e0703a','#c9c287','#5664b3','#b85a8a'].map((f,i)=>(pal[i]||{}).vib||f);
const hex=h=>{const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h); return m?[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)]:[200,120,90];};
const hsl2=s=>{const m=/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(s); if(!m) return hex(s); const h=+m[1]/360,sa=+m[2]/100,l=+m[3]/100; const f=n=>{const k=(n+h*12)%12, a=sa*Math.min(l,1-l); return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));}; return [f(0),f(8),f(4)];};
const rgb=c=>c.startsWith('hsl')?hsl2(c):hex(c);
const SKY={
  morning:{clear:{c:[[255,214,150],[170,205,245],[255,170,160]],sun:{c:[255,238,200],x:.1,y:.22,r:.55,a:.6},bright:1.18,veil:0,speed:1},
    cloudy:{c:[[205,212,225],[175,185,205],[225,215,205]],sun:{c:[245,245,245],x:.3,y:.1,r:.6,a:.22},bright:.9,veil:.1,speed:.6},
    rain:{c:[[150,165,190],[120,135,160],[170,180,195]],sun:null,bright:.75,veil:.14,speed:.8},
    snow:{c:[[222,226,236],[198,206,222],[236,232,238]],sun:null,bright:.95,veil:.08,speed:.45}},
  day:{clear:{c:[[140,190,250],[200,225,255],[255,250,235]],sun:{c:[255,255,240],x:.55,y:-.15,r:.5,a:.5},bright:1.1,veil:0,speed:1},
    cloudy:{c:[[175,185,200],[150,160,180],[200,205,215]],sun:null,bright:.85,veil:.12,speed:.6},
    rain:{c:[[110,125,150],[90,105,130],[140,150,170]],sun:null,bright:.7,veil:.16,speed:.8},
    snow:{c:[[205,212,225],[185,195,212],[230,232,240]],sun:null,bright:.9,veil:.08,speed:.45}},
  evening:{clear:{c:[[255,140,60],[255,80,110],[120,70,160]],sun:{c:[255,205,130],x:.14,y:.48,r:.5,a:.62},bright:1,veil:0,speed:1},
    cloudy:{c:[[200,120,100],[120,90,130],[90,80,120]],sun:{c:[255,170,110],x:.14,y:.5,r:.35,a:.25},bright:.8,veil:.1,speed:.6},
    rain:{c:[[120,90,110],[80,75,110],[60,60,90]],sun:null,bright:.65,veil:.14,speed:.8},
    snow:{c:[[190,150,170],[140,120,160],[100,95,135]],sun:null,bright:.8,veil:.08,speed:.45}},
  night:{clear:{c:[[20,35,80],[40,50,110],[60,45,90]],sun:{c:[200,215,240],x:.82,y:.08,r:.16,a:.4},bright:.6,veil:0,speed:.8},
    cloudy:{c:[[25,30,45],[35,40,60],[40,40,55]],sun:null,bright:.5,veil:.08,speed:.5},
    rain:{c:[[20,28,48],[30,38,60],[28,30,50]],sun:null,bright:.5,veil:.1,speed:.7},
    snow:{c:[[40,48,70],[55,62,88],[60,58,80]],sun:null,bright:.55,veil:.06,speed:.4}}};
/* how much of the taste's own colour the sky lets through, by hour: at night they would be acid */
const TASTE={morning:{sat:.5,lum:.95},day:{sat:.5,lum:1},evening:{sat:.6,lum:.9},night:{sat:.28,lum:.5}};
let todPick='auto', wx='clear';
const hourTod=()=>{const h=new Date().getHours(); return h<5?'night':h<11?'morning':h<17?'day':h<22?'evening':'night';};
const todNow=()=>todPick==='auto'?hourTod():todPick;
const au=$('#aurora'), ax=au.getContext('2d');
const SPOTS=[{x:.15,y:.16,r:.5,fx:.13,fy:.07,ph:0},{x:.5,y:.04,r:.55,fx:.09,fy:.11,ph:1.7},{x:.86,y:.2,r:.5,fx:.11,fy:.06,ph:3.1}];
const TSPOTS=[{x:.32,y:.46,r:.3,fx:.1,fy:.08,ph:.9},{x:.72,y:.4,r:.3,fx:.08,fy:.12,ph:2.4}];
let auRaf=0, auLast=0, auT=0, playingTint=0;
const tone=(c,sat,lum)=>{const g=(c[0]*.3+c[1]*.59+c[2]*.11); return c.map(v=>Math.round((g+(v-g)*sat)*lum));};
function auFrame(t){auRaf=0; const dt=auLast?Math.min(50,t-auLast):16; auLast=t;
  const tod=todNow(), sky=SKY[tod][wx], ts=TASTE[tod]; auT+=dt*.00004*sky.speed;
  const W=Math.max(2,Math.round(stage.clientWidth/10)), H=Math.max(2,Math.round(stage.clientHeight/10)); if(au.width!==W||au.height!==H){au.width=W; au.height=H;}
  playingTint+=((playing?1:0)-playingTint)*(1-Math.exp(-dt/1400));
  const im=D.images[now.c]||{}, tc=[rgb(im.acc||COLS[0]),rgb(im.vib||COLS[2])];
  ax.clearRect(0,0,W,H); ax.globalCompositeOperation='lighter';
  const draw=(x,y,r,c,a)=>{const g=ax.createRadialGradient(x*W,y*H,0,x*W,y*H,r*W); g.addColorStop(0,'rgba('+c[0]+','+c[1]+','+c[2]+','+Math.min(1,a)+')'); g.addColorStop(1,'rgba('+c[0]+','+c[1]+','+c[2]+',0)'); ax.fillStyle=g; ax.fillRect(0,0,W,H);};
  const at=(s)=>[s.x+.1*Math.sin(auT*s.fx*9+s.ph)+.04*Math.sin(auT*s.fy*17+s.ph*2), s.y+.08*Math.cos(auT*s.fy*8+s.ph)+.03*Math.sin(auT*s.fx*13)];
  SPOTS.forEach((s,i)=>{const [x,y]=at(s); draw(x,y,s.r,sky.c[i],.5*sky.bright);});
  if(sky.sun) draw(sky.sun.x,sky.sun.y,sky.sun.r,sky.sun.c,sky.sun.a*sky.bright);
  TSPOTS.forEach((s,i)=>{const [x,y]=at(s); const base=rgb(COLS[i*2]), c=[0,1,2].map(k=>base[k]+(tc[i][k]-base[k])*playingTint); draw(x,y,s.r,tone(c,ts.sat+.25*playingTint,ts.lum),(.2+.14*playingTint)*sky.bright);});
  if(sky.veil){ax.globalCompositeOperation='source-over'; ax.fillStyle='rgba(165,170,180,'+sky.veil+')'; ax.fillRect(0,0,W,H);}
  /* the sky lives in the top half: fade it out towards the floor */
  ax.globalCompositeOperation='destination-in'; const m=ax.createLinearGradient(0,0,0,H); m.addColorStop(0,'rgba(0,0,0,1)'); m.addColorStop(.3,'rgba(0,0,0,.85)'); m.addColorStop(.52,'rgba(0,0,0,.35)'); m.addColorStop(.74,'rgba(0,0,0,0)'); ax.fillStyle=m; ax.fillRect(0,0,W,H);
  ax.globalCompositeOperation='source-over';
  weatherFrame(dt,t); auRaf=requestAnimationFrame(auFrame);}

/* Rain and snow, in front of the screen, at the stage's own resolution. Both know the
   edges of what stands on the screen: the headline's lines, the search field, the albums'
   plate, the island on the left. A drop that reaches one breaks into a few droplets that
   fly up and fall back; a flake that reaches the field, the plate or the island stays
   where it fell, and the snow there grows as a height field (a little spills onto the
   neighbouring cells, so a pile forms), then melts when the snow stops */
const wc=$('#weather'), wcx=wc.getContext('2d'), CW=5; let falls=[], splash=[], edges=[], caps={}, edgeAt=0;
const LANDS={find:{rad:24,max:7},plate:{rad:20,max:11},island:{rad:16,max:9}};
function findEdges(){const list=[]; const ph=$('.a-phrase'); if(ph&&ph.offsetWidth){const rg=document.createRange(); rg.selectNodeContents(ph); for(const r of rg.getClientRects()){ if(r.width>20) list.push(rect(r,'text')); }}
  for(const [sel,kind] of [['.find','find'],['.a-albums','plate'],['#island','island']]){const e=$(sel); if(e&&e.offsetWidth) list.push(rect(e.getBoundingClientRect(),kind));}
  edges=list;
  for(const e of edges){ if(e.kind==='text') continue; const L=LANDS[e.kind], x0=e.l+L.rad, n=Math.max(1,Math.floor((e.w-2*L.rad)/CW)); const c=caps[e.kind];
    if(!c||c.n!==n||Math.abs(c.x0-x0)>1){ caps[e.kind]={kind:e.kind,x0,n,cells:new Float32Array(n),max:L.max}; } }}
function rect(r,kind){const s=stage.getBoundingClientRect(); return {kind,l:(r.left-s.left)/S,t:(r.top-s.top)/S,r:(r.right-s.left)/S,w:r.width/S};}
const snowAt=(e,x)=>{const c=caps[e.kind]; if(!c) return 0; const i=Math.floor((x-c.x0)/CW); return i>=0&&i<c.n?c.cells[i]:0;};
function weatherFrame(dt,t){const W=stage.clientWidth, H=stage.clientHeight, snowing=wx==='snow', raining=wx==='rain';
  const lying=Object.values(caps).some(c=>{for(let i=0;i<c.n;i++) if(c.cells[i]>.05) return true; return false;});
  const alive=snowing||raining||falls.length||splash.length||lying;
  if(!alive){ if(wc.width){wc.width=0;} return; }
  if(wc.width!==W||wc.height!==H){wc.width=W; wc.height=H;}
  if(t-edgeAt>400){edgeAt=t; findEdges();}
  wcx.clearRect(0,0,W,H);
  const n=raining?110:snowing?80:0; while(falls.length<n) falls.push({x:Math.random()*W,y:-Math.random()*H,v:.5+Math.random(),s:Math.random()});
  if(!raining&&!snowing) falls.length=0;
  const hit=(d,ny)=>{for(const e of edges){ if(d.x<e.l||d.x>e.r) continue; const top=e.t-(e.kind==='text'?0:snowAt(e,d.x)); if(d.y<top&&ny>=top) return {e,top};} return null;};
  if(raining){wcx.strokeStyle='rgba(205,220,245,.55)'; wcx.lineWidth=1; wcx.beginPath();
    for(const d of falls){const l=9+d.v*13, ny=d.y+dt*(.5+d.v*.55); const h=hit(d,ny);
      if(h){ for(let k=0;k<4;k++) splash.push({x:d.x,y:h.top-1,vx:(Math.random()-.5)*.6,vy:-(.3+Math.random()*.5),life:0}); d.y=-20-Math.random()*60; d.x=Math.random()*W; continue; }
      wcx.moveTo(d.x,d.y); wcx.lineTo(d.x-l*.16,d.y+l); d.y=ny; d.x-=dt*.05; if(d.y>H){d.y=-20; d.x=Math.random()*W;}}
    wcx.stroke();}
  else if(snowing){wcx.fillStyle='rgba(255,255,255,.85)';
    for(const d of falls){const r=1+d.s*1.7, ny=d.y+dt*(.028+d.v*.035); const h=hit(d,ny);
      if(h&&h.e.kind!=='text'){const c=caps[h.e.kind]; if(c){const i=Math.floor((d.x-c.x0)/CW); const add=(j,v)=>{ if(j>=0&&j<c.n) c.cells[j]=Math.min(c.max,c.cells[j]+v); }; add(i,1.1); add(i-1,.5); add(i+1,.5); add(i-2,.18); add(i+2,.18);} d.y=-10-Math.random()*40; d.x=Math.random()*W; continue;}
      wcx.globalAlpha=.35+d.s*.5; wcx.beginPath(); wcx.arc(d.x,d.y,r,0,Math.PI*2); wcx.fill(); d.y=ny; d.x+=Math.sin((d.y+d.s*300)/60)*.35; if(d.y>H){d.y=-6; d.x=Math.random()*W;}}
    wcx.globalAlpha=1;}
  /* droplets of the splashes */
  if(splash.length){wcx.fillStyle='rgba(215,228,250,.8)'; for(const q of splash){q.life+=dt; q.vy+=dt*.0025; q.x+=q.vx*dt; q.y+=q.vy*dt; wcx.globalAlpha=Math.max(0,1-q.life/520); wcx.beginPath(); wcx.arc(q.x,q.y,1.5,0,Math.PI*2); wcx.fill();} wcx.globalAlpha=1; splash=splash.filter(q=>q.life<520);}
  /* the snow lying where it fell: the height field, smoothed, thinning out towards the ends
     of the surface, drawn twice: a soft wider underlay, then the body, so no edge is hard */
  for(const c of Object.values(caps)){ const e=edges.find(e=>e.kind===c.kind); if(!e) continue; let any=false;
    if(!snowing) for(let i=0;i<c.n;i++) c.cells[i]=Math.max(0,c.cells[i]-dt*.0012);
    for(let i=0;i<c.n;i++) if(c.cells[i]>.05){any=true; break;} if(!any) continue;
    const taper=i=>{const k=Math.min(i+.5,c.n-.5-i)/5; return k>=1?1:k<=0?0:k*k*(3-2*k);};
    const hAt=i=>{const a=c.cells[Math.max(0,i-1)], b=c.cells[i], d=c.cells[Math.min(c.n-1,i+1)]; return (a+2*b+d)/4*taper(i);};
    const band=(grow,alpha)=>{wcx.beginPath(); wcx.moveTo(c.x0,e.t+3);
      for(let i=0;i<c.n;i++){const x=c.x0+i*CW+CW/2, h=hAt(i), y=e.t-h-grow*Math.min(1,h);
        if(i===0) wcx.lineTo(x,y); else {const hm=(hAt(i-1)+h)/2; wcx.quadraticCurveTo(c.x0+i*CW,e.t-hm-grow*Math.min(1,hm),x,y);}}
      wcx.lineTo(c.x0+c.n*CW,e.t+3); wcx.closePath(); wcx.fillStyle='rgba(248,250,255,'+alpha+')'; wcx.fill();};
    band(1.6,.28); band(.6,.4); band(0,.86); }}
function auKick(){ if(!auRaf&&!reduce) auRaf=requestAnimationFrame(auFrame); }
$('#tods').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; todPick=b.dataset.tod; $$('#tods button').forEach(x=>x.setAttribute('aria-pressed',x===b));});
$('#weathers').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; wx=b.dataset.weather; falls.length=0; $$('#weathers button').forEach(x=>x.setAttribute('aria-pressed',x===b));});

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

/* ── the orb of «Поток» ─────────────────────────────────────────────────────── */
/* The drops drift and the ring turns all the time; how fast says what is going on: slow at
   rest, quicker under the pointer, quick while the wave plays. The rates change through
   the animations' playback rate, so nothing ever jumps (v1 switched animation-duration,
   which made the drops leap) */
let fam='mix', sound=null, hot=false, burstT=0;
const DRIFT=[
  [{transform:'translate(-25%,-15%) scale(1)'},{transform:'translate(35%,20%) scale(1.35)',offset:.33},{transform:'translate(5%,-30%) scale(.85)',offset:.66},{transform:'translate(-25%,-15%) scale(1)'}],
  [{transform:'translate(30%,25%) scale(1.1)'},{transform:'translate(-20%,-10%) scale(.9)',offset:.33},{transform:'translate(25%,30%) scale(1.3)',offset:.66},{transform:'translate(30%,25%) scale(1.1)'}],
  [{transform:'translate(10%,30%) scale(.9)'},{transform:'translate(-30%,-20%) scale(1.25)',offset:.5},{transform:'translate(10%,30%) scale(.9)'}],
  [{transform:'translate(-30%,20%) scale(1.2)'},{transform:'translate(30%,-25%) scale(.95)',offset:.5},{transform:'translate(-30%,20%) scale(1.2)'}]];
const drops=reduce?[]:$$('.o-clip i').map((el,i)=>el.animate(DRIFT[i%4],{duration:[7000,9000,11000,8000][i%4],iterations:Infinity,easing:'ease-in-out'}));
const rings=reduce?[]:$$('.o-ring').map(el=>el.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:6000,iterations:Infinity}));
function flow(k){const r=(playing?2.2:hot?2:1)*(sound==='calm'?.7:sound==='energetic'?1.5:1)*(k||1); drops.forEach(a=>a.updatePlaybackRate(r)); rings.forEach(a=>a.updatePlaybackRate((playing?2.6:hot?2.5:1)*(k||1)));}
/* the press: the liquid gulps, the halo bursts once, the ring hurries, then everything settles */
function launch(o){ if(reduce) return; const br=$('.o-liquid',o), halo=$('.o-halo',o);
  br.animate([{transform:'scale(1)'},{transform:'scale(.78)',offset:.3},{transform:'scale(1.1)',offset:.65},{transform:'scale(1)'}],{duration:720,easing:EASE,composite:'replace'});
  halo.animate([{transform:'scale(.8)',opacity:.9},{transform:'scale(2.1)',opacity:0}],{duration:820,easing:'cubic-bezier(.2,.7,.2,1)'});
  flow(3.5); clearTimeout(burstT); burstT=setTimeout(()=>flow(),700); }
$$('.orb').forEach(o=>{ let raf=0, px=0, py=0;
  o.addEventListener('pointermove',ev=>{const r=o.getBoundingClientRect(); px=(ev.clientX-r.left)/r.width-.5; py=(ev.clientY-r.top)/r.height-.5;
    if(!raf) raf=requestAnimationFrame(()=>{raf=0; o.style.setProperty('--px',px.toFixed(3)); o.style.setProperty('--py',py.toFixed(3));});});
  o.addEventListener('pointerenter',()=>{hot=true; flow();});
  o.addEventListener('pointerleave',()=>{hot=false; flow(); o.style.setProperty('--px','0'); o.style.setProperty('--py','0');});
  o.addEventListener('click',()=>launch(o)); });

/* the wave's style: one state; the drops take its colour */
function thumbs(){ $$('.fmode,.tseg').forEach(g=>{const b=$('[aria-checked="true"]',g), t=$('.thumb',g); if(!b||!b.offsetWidth) return; t.style.setProperty('--x',b.offsetLeft+'px'); t.style.setProperty('--w',b.offsetWidth+'px');}); }
function tune(){ stage.dataset.fam=fam; $$('.tseg button').forEach(b=>b.setAttribute('aria-checked',b.dataset.fam===fam)); $$('.tchip').forEach(b=>b.setAttribute('aria-pressed',b.dataset.sound===sound)); thumbs(); }
/* «Настроить волну» opens in place; the rows below slide down with it */
const tuneBox=$('#tuneBox'), tunePill=$('.js-tune'); let tuneOpen=false, tuneAnim=null;
function setTune(open){ if(open===tuneOpen) return; tuneOpen=open; tunePill.setAttribute('aria-expanded',String(open)); if(tuneAnim) tuneAnim.cancel();
  if(open){ tuneBox.hidden=false; thumbs(); const h=tuneBox.scrollHeight; if(reduce) return;
    tuneAnim=tuneBox.animate([{height:'0px',opacity:0},{height:h+'px',opacity:1}],{duration:420,easing:EASE}); tuneAnim.onfinish=()=>{tuneAnim=null;}; }
  else{ const h=tuneBox.offsetHeight; if(reduce){tuneBox.hidden=true; return;}
    tuneAnim=tuneBox.animate([{height:h+'px',opacity:1},{height:'0px',opacity:0}],{duration:320,easing:EASE}); tuneAnim.onfinish=()=>{tuneAnim=null; tuneBox.hidden=true;}; } }
tunePill.addEventListener('click',()=>setTune(!tuneOpen));

stage.addEventListener('click',ev=>{
  const f=ev.target.closest('.tseg button'); if(f){ if(f.dataset.fam!==fam){fam=f.dataset.fam; tune(); flow(3); clearTimeout(burstT); burstT=setTimeout(()=>flow(),600); if(playing) toast('Волна перестраивается: «'+f.textContent+'»');} return; }
  const c=ev.target.closest('.tchip'); if(c){ sound=sound===c.dataset.sound?null:c.dataset.sound; tune(); flow(); if(playing) toast(sound?'Волна перестраивается: «'+c.textContent+'»':'Волна вернулась к обычному звуку'); return; }
  const p=ev.target.closest('.js-play'); if(p){setPlaying(!playing); pop(p); return;}
  const v=ev.target.closest('.js-vibe'); if(v){const vibe=D.vibes[+v.dataset.n]; fly(v.querySelector('.cv:last-child')||v.querySelector('.cv'),vibe.tracks[0]); setPlaying(true); toast('Играет вайбик «'+vibe.name+'»'); return;}
  const a=ev.target.closest('.js-album'); if(a){const x=PICKS[+a.dataset.n]; toast('В приложении: альбом «'+x.title+'» раскрывается, пластинка выезжает из конверта'); return;}
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
document.addEventListener('keydown',ev=>{ if(ev.key==='/'&&!/input|textarea/i.test(document.activeElement.tagName)){ev.preventDefault(); const f=$('.find input'); if(f) f.focus();} });

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

/* ── fitting: a row of albums shows exactly as many as fit whole, never a cut one ──── */
function trimRows(){ $$('[data-trim]').forEach(r=>{ if(!r.offsetWidth) return; const kids=[...r.children]; kids.forEach(k=>{k.style.display='';});
  const cols=getComputedStyle(r).gridTemplateColumns.split(' ').filter(Boolean).length; kids.forEach((k,i)=>{ if(i>=cols) k.style.display='none'; }); }); }
function settle(){ thumbs(); trimRows(); }

/* ── the page's own switch: the size of the screen ──────────────────────────── */
let size={w:1728,h:1117,name:'16″'};
function fit(){const vw=viewport.clientWidth; let w=size.w, h=size.h;
  if(!w){w=Math.max(960,vw); h=Math.max(620,Math.min(window.innerHeight-40,Math.round(w*.62)));}
  S=Math.min(1,vw/w); stage.style.width=w+'px'; stage.style.height=h+'px'; stage.style.transform=S<1?'scale('+S+')':'none'; viewport.style.height=Math.round(h*S)+'px';
  $('#sizeTag').textContent=w+' × '+h+(size.w?' · '+size.name:'')+(S<1?' · показано в '+Math.round(S*100)+' %':'');
  closeQs(); settle(); draw();}
$('#sizes').addEventListener('click',ev=>{const b=ev.target.closest('button'); if(!b) return; $$('#sizes button').forEach(x=>x.setAttribute('aria-pressed',x===b)); size={w:+b.dataset.w,h:+b.dataset.h,name:b.textContent}; fit();});
window.addEventListener('resize',fit);

setNow(now); tune(); flow(); countUp(); fit(); auKick();
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(settle);
})();
