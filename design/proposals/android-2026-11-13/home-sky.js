/* Sky recipe ported from design/reference/home/logic.js, with the current WEB
 * light-weather colours. Only host coordinates, phone density and visibility lifetime
 * are adapted. Palette tables, collision physics and local snow accumulation stay intact. */
function createPhoneSky(){
const stage=phone,reduce=REDUCED,S=1,$=selector=>stage.querySelector(selector);
const pal=tracks.map(t=>({vib:t.palette?.vibrant}));
let active=false,light=false,frames=0;
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
const au=$('#homeSky'), ax=au.getContext('2d');
const SPOTS=[{x:.15,y:.16,r:.5,fx:.13,fy:.07,ph:0},{x:.5,y:.04,r:.55,fx:.09,fy:.11,ph:1.7},{x:.86,y:.2,r:.5,fx:.11,fy:.06,ph:3.1}];
const TSPOTS=[{x:.32,y:.46,r:.3,fx:.1,fy:.08,ph:.9},{x:.72,y:.4,r:.3,fx:.08,fy:.12,ph:2.4}];
let auRaf=0, auLast=0, auT=0, playingTint=0;
const tone=(c,sat,lum)=>{const g=(c[0]*.3+c[1]*.59+c[2]*.11); return c.map(v=>Math.round((g+(v-g)*sat)*lum));};
function auFrame(t){auRaf=0; const dt=auLast?Math.min(50,t-auLast):16; auLast=t;
  const tod=todNow(), sky=SKY[tod][wx], ts=TASTE[tod]; auT+=dt*.00004*sky.speed;
  const W=Math.max(2,Math.round(stage.clientWidth/10)), H=Math.max(2,Math.round(stage.clientHeight/10)); if(au.width!==W||au.height!==H){au.width=W; au.height=H;}
  playingTint+=((playing?1:0)-playingTint)*(1-Math.exp(-dt/1400));
  const im=currentTrack().palette||{}, tc=[rgb(im.accent?.dark||COLS[0]),rgb(im.vibrant||COLS[2])];
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
  if(!reduce)weatherFrame(dt,t); frames++; if(active&&!reduce)auRaf=requestAnimationFrame(auFrame);}

/* Rain and snow, in front of the screen, at the stage's own resolution. Both know the
   edges of what stands on the screen: the headline's lines, the search field, the albums'
   plate, the island on the left. A drop that reaches one breaks into a few droplets that
   fly up and fall back; a flake that reaches the field, the plate or the island stays
   where it fell, and the snow there grows as a height field (a little spills onto the
   neighbouring cells, so a pile forms), then melts when the snow stops */
const wc=$('#homeWeather'), wcx=wc.getContext('2d'), CW=5; let falls=[], splash=[], edges=[], caps={}, edgeAt=0;
const LANDS={find:{rad:24,max:7},plate:{rad:20,max:11},island:{rad:16,max:9}};
function findEdges(){const list=[]; const ph=$('#homePhrase'); if(ph&&ph.offsetWidth){const rg=document.createRange(); rg.selectNodeContents(ph); for(const r of rg.getClientRects()){ if(r.width>20) list.push(rect(r,'text')); }}
  for(const [sel,kind] of [['.home-search','find'],['#homeAlbumPlate','plate'],['#nav','island']]){const e=$(sel); if(e&&e.offsetWidth) list.push(rect(e.getBoundingClientRect(),kind));}
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
  const density=Math.min(1,W*H/(800*900)),n=Math.round((raining?110:snowing?80:0)*density); while(falls.length<n) falls.push({x:Math.random()*W,y:-Math.random()*H,v:.5+Math.random(),s:Math.random()});
  if(!raining&&!snowing) falls.length=0;
  const hit=(d,ny)=>{for(const e of edges){ if(d.x<e.l||d.x>e.r) continue; const top=e.t-(e.kind==='text'?0:snowAt(e,d.x)); if(d.y<top&&ny>=top) return {e,top};} return null;};
  if(raining){wcx.strokeStyle=light?'rgba(72,99,143,.55)':'rgba(205,220,245,.55)'; wcx.lineWidth=1; wcx.beginPath();
    for(const d of falls){const l=9+d.v*13, ny=d.y+dt*(.5+d.v*.55); const h=hit(d,ny);
      if(h){ for(let k=0;k<4;k++) splash.push({x:d.x,y:h.top-1,vx:(Math.random()-.5)*.6,vy:-(.3+Math.random()*.5),life:0}); d.y=-20-Math.random()*60; d.x=Math.random()*W; continue; }
      wcx.moveTo(d.x,d.y); wcx.lineTo(d.x-l*.16,d.y+l); d.y=ny; d.x-=dt*.05; if(d.y>H){d.y=-20; d.x=Math.random()*W;}}
    wcx.stroke();}
  else if(snowing){wcx.fillStyle=light?'rgba(114,132,161,.85)':'rgba(255,255,255,.85)';
    for(const d of falls){const r=1+d.s*1.7, ny=d.y+dt*(.028+d.v*.035); const h=hit(d,ny);
      if(h&&h.e.kind!=='text'){const c=caps[h.e.kind]; if(c){const i=Math.floor((d.x-c.x0)/CW); const add=(j,v)=>{ if(j>=0&&j<c.n) c.cells[j]=Math.min(c.max,c.cells[j]+v); }; add(i,1.1); add(i-1,.5); add(i+1,.5); add(i-2,.18); add(i+2,.18);} d.y=-10-Math.random()*40; d.x=Math.random()*W; continue;}
      wcx.globalAlpha=.35+d.s*.5; wcx.beginPath(); wcx.arc(d.x,d.y,r,0,Math.PI*2); wcx.fill(); d.y=ny; d.x+=Math.sin((d.y+d.s*300)/60)*.35; if(d.y>H){d.y=-6; d.x=Math.random()*W;}}
    wcx.globalAlpha=1;}
  /* droplets of the splashes */
  if(splash.length){wcx.fillStyle=light?'rgba(72,99,143,.8)':'rgba(215,228,250,.8)'; for(const q of splash){q.life+=dt; q.vy+=dt*.0025; q.x+=q.vx*dt; q.y+=q.vy*dt; wcx.globalAlpha=Math.max(0,1-q.life/520); wcx.beginPath(); wcx.arc(q.x,q.y,1.5,0,Math.PI*2); wcx.fill();} wcx.globalAlpha=1; splash=splash.filter(q=>q.life<520);}
  /* the snow lying where it fell: the height field, smoothed, thinning out towards the ends
     of the surface, drawn twice: a soft wider underlay, then the body, so no edge is hard */
  for(const c of Object.values(caps)){ const e=edges.find(e=>e.kind===c.kind); if(!e) continue; let any=false;
    if(!snowing) for(let i=0;i<c.n;i++) c.cells[i]=Math.max(0,c.cells[i]-dt*.0012);
    for(let i=0;i<c.n;i++) if(c.cells[i]>.05){any=true; break;} if(!any) continue;
    const taper=i=>{const k=Math.min(i+.5,c.n-.5-i)/5; return k>=1?1:k<=0?0:k*k*(3-2*k);};
    const hAt=i=>{const a=c.cells[Math.max(0,i-1)], b=c.cells[i], d=c.cells[Math.min(c.n-1,i+1)]; return (a+2*b+d)/4*taper(i);};
    const band=(grow,alpha,color='248,250,255')=>{const top=i=>{const h=hAt(i); return e.t-h-grow*Math.min(1,h);}, bottom=i=>e.t+3*Math.min(1,hAt(i));
      wcx.beginPath(); wcx.moveTo(c.x0,e.t);
      for(let i=0;i<c.n;i++){const x=c.x0+i*CW+CW/2; if(i===0) wcx.lineTo(x,top(i)); else wcx.quadraticCurveTo(c.x0+i*CW,(top(i-1)+top(i))/2,x,top(i));}
      wcx.lineTo(c.x0+c.n*CW,e.t); for(let i=c.n-1;i>=0;i--) wcx.lineTo(c.x0+i*CW+CW/2,bottom(i));
      wcx.closePath(); wcx.fillStyle='rgba('+color+','+alpha+')'; wcx.fill();};
    band(1.6,.28,light?'72,99,143':'248,250,255'); band(.6,.4,light?'174,190,214':'248,250,255'); band(0,.86); }}
function auKick(){ if(active&&!auRaf&&!reduce) auRaf=requestAnimationFrame(auFrame); }

return {
  sync({visible,show,theme,time,weather}){
    const changed=light!==(theme==='light')||todPick!==time||wx!==weather;
    light=theme==='light';todPick=time;if(wx!==weather){wx=weather;falls.length=0;edgeAt=0;}
    $('#homeSkyScene').hidden=!show;wc.hidden=!visible;
    active=visible;
    if(!active){cancelAnimationFrame(auRaf);auRaf=0;auLast=0;}
    if((changed||!frames)&&show&&!auRaf){auFrame(performance.now());}
    auKick();
  },
  stats(){return {running:!!auRaf,frames,falls:falls.length,snowCells:Object.values(caps).reduce((n,c)=>n+[...c.cells].filter(x=>x>.05).length,0)};}
};
}
