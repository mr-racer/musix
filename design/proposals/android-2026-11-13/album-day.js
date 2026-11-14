/* Album of the day, phone round 2: the card, its filled button and its phrases.
 * Scenario fixtures over the snapshot's real track lists (albums.json): which album is picked,
 * the listening numbers and the progress are labelled as scenarios in the review panel.
 * Progress counts songs heard since the album became the album of the day. */
const AD_DAY=new Date(2026,10,13),AD_MON=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
let adKind='one',adProg='zero',adPick=null,adPlays=[],adPhraseIdx=0,adVariant=0,adUsable=[],adSpring=null,adEdgeAnim=null,adFinaleShown=false;
let adWon=false,adWonSpring=null,adJoiTimer=0,adJoiOff=null;
function adBase(kind){const by=t=>tracks.find(x=>x.t===t);return {one:by('Frozen'),never:by('Exits'),long:by('Power')}[kind];}
function adFixture(kind){
  const base=adBase(kind),album=PHONE_ALBUMS[base.id],long=homeState==='long';
  const facts=kind==='one'?{song:long?'Monster (ft. Jay-Z, Rick Ross, Nicki Minaj & Bon Iver)':'Frozen',n:47,k:adCountable(album.tracks).length-1}
    :kind==='never'?{artist:long?'Everything Everything Orchestra':'Foals',rank:4,hours:12,artistGender:'group',otherAlbumsHeard:1}
    :{plays:32,monthGen:'марта',days:Math.round((AD_DAY-new Date(2026,2,12))/864e5)};
  const songs=album.tracks.map((x,i)=>({...base,id:`ad-${base.id}-${i}`,t:x.t,d:x.d,album:album.album,albumDay:base.id}));
  return {kind,base,album,facts,songs,title:long?`${album.album} (Deluxe Edition, Remastered 2026)`:album.album};
}
function adHeardFor(state,total){const finishAt=Math.ceil(.75*total);return {zero:0,mid:Math.min(7,finishAt-1),last:finishAt-1,done:finishAt}[state]??0;}
function adSetPlays(state){
  const counted=adPick.songs.map((s,i)=>[s,i]).filter(([s])=>s.d>60),n=adHeardFor(state,counted.length);
  adPlays=adPick.songs.map(()=>0);counted.slice(0,n).forEach(([,i])=>adPlays[i]=1);
}
const adTracksWithPlays=()=>adPick.songs.map((s,i)=>({d:s.d,plays:adPlays[i]}));
const adNow=()=>adProgress(adTracksWithPlays());
const adIsCurrent=()=>!!adPick&&currentTrack()?.albumDay===adPick.base.id;
function adFirstUnheard(){
  const p=adNow(),list=adPick.songs.map((s,i)=>[s,i]).filter(([s])=>s.d>60);
  return (p.done?list[0]:list.find(([,i])=>!adPlays[i])||list[0])[0];
}
/* Every usable phrase fits two lines at this width; a long title is shortened inside the
 * quotes first, a template that still does not fit is left out. */
function adFitPhrases(el){
  const lines=()=>Math.round(el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight));
  const keep=el.innerHTML,full=adPhrases(adPick.kind,adPick.facts),short=adPhrases(adPick.kind,{...adPick.facts,songMax:20,artistMax:14});
  if(!el.getBoundingClientRect().width)return full;
  const out=full.flatMap((s,i)=>{el.innerHTML=s;if(lines()<=2)return [s];el.innerHTML=short[i];return lines()<=2?[short[i]]:[];});
  el.innerHTML=keep;return out;
}
/* After the finale the button reads «Обыграна ✓» for the rest of the day; tapping it plays again. */
const adWonNow=p=>adWon&&p.done;
const adLabelText=p=>adWonNow(p)?'Обыграна':adButtonLabel(p);
const adGlyph=p=>adIsCurrent()&&playing?'Pause':adWonNow(p)?'Check':'Play';
function adButtonHTML(p){
  const label=`<span class="ad-label">${icon(adGlyph(p),16)}<span>${adLabelText(p)}</span></span>`;
  return `${label}<span class="ad-fill" aria-hidden="true">${label}</span><span class="ad-edge" aria-hidden="true"><i></i></span><i class="ad-notch" aria-hidden="true"></i>`;
}
function adPaint(animate=true){
  const card=$('homeAlbumDay').querySelector('.ad-card');if(!card)return;
  const p=adNow(),btn=card.querySelector('.ad-btn');adEdgeAnim?.cancel();
  btn.innerHTML=adButtonHTML(p);btn.setAttribute('aria-label',`${adWonNow(p)?'Обыграна, слушать ещё раз':adButtonLabel(p)}: ${adPick.title}`);
  btn.classList.toggle('ad-won',adWonNow(p));if(!adWonNow(p))btn.style.width='';else if(!btn.style.width)btn.style.width=adWonWidth(btn)+'px';
  card.querySelector('.ad-progress').innerHTML=adProgressPhrase(p,adVariant)??'';
  card.dataset.done=String(p.done);
  const strip=card.querySelector('.ad-strip-count');if(strip)strip.textContent=`${p.heard}/${p.total}`;
  adSpring??=createSpring({value:0,stiffness:260,damping:30,onUpdate:v=>$('homeAlbumDay').style.setProperty('--p',v.toFixed(4))});
  animate?adSpring.to(p.fraction):adSpring.set(p.fraction);
  adEdgeAnim=null;syncAlbumDayMotion(pageName==='home'&&!playerTarget&&!sheetName&&!document.hidden);
}
function adShowPhrase(i){
  const el=$('homeAlbumDay').querySelector('.ad-phrase');if(!el||!adUsable.length)return;
  adPhraseIdx=i%adUsable.length;el.innerHTML=adUsable[adPhraseIdx];
}
function adShuffle(){
  const el=$('homeAlbumDay').querySelector('.ad-phrase');const next=adNextIndex(adUsable.length,adPhraseIdx);adVariant++;
  if(REDUCED||!el.animate){adShowPhrase(next);return;}
  el.animate([{opacity:1},{opacity:0}],{duration:90,easing:'ease-in'}).onfinish=()=>{adShowPhrase(next);el.animate([{opacity:0},{opacity:1}],{duration:90,easing:'ease-out'});};
}
function adPlay(){
  if(homeState==='offline'){toast('Для воспроизведения нужна сеть');return;}
  if(adIsCurrent()){setPlaying(!playing);adPaint();return;}
  playHomeTrack(adFirstUnheard(),$('homeAlbumDay').querySelector('.ad-cover img'),adPick.songs);adPaint();
}
function renderAlbumDayCard(){
  const host=$('homeAlbumDay');if(!host||!['one','never','long'].includes(adKind)){if(host)host.innerHTML='';return;}
  const fresh=!adPick||adPick.kind!==adKind||adPick.long!==(homeState==='long');
  if(fresh){adCloseJoi(true);adPick={...adFixture(adKind),long:homeState==='long'};adSetPlays(adProg);adPhraseIdx=0;adFinaleShown=adNow().done;adWon=false;}
  const b=adPick.base,acc=b.palette?.accent?.dark||'#b49acb',art=adPick.album.artist;
  host.style.setProperty('--ad-acc',acc);
  host.innerHTML=`<div class="ad-card"><div class="ad-plate"><span class="ad-lit" style="background-image:url(${b.bg})"></span></div>
    <button class="ad-cover" data-album="${b.id}" aria-label="Открыть разворот: ${esc(adPick.title)}"><img src="${b.cover}" alt=""></button>
    <div class="ad-meta"><small class="ad-kicker">Альбом дня · ${AD_DAY.getDate()} ${AD_MON[AD_DAY.getMonth()]}</small><b class="ad-title">${esc(adPick.title)}</b><small class="ad-artist">${esc(art)}${adPick.album.year?' · '+adPick.album.year:''}</small></div>
    <div class="ad-say"><p class="ad-phrase" aria-live="polite"></p><button class="icon ad-shuffle" aria-label="Другая фраза">${icon('Shuffle',18)}</button></div>
    <button class="ad-btn"></button><p class="ad-progress" aria-live="polite"></p>
    <button class="ad-strip" tabindex="-1" aria-label="Развернуть альбом дня: ${esc(adPick.title)}"><span class="ad-strip-count"></span>${icon('ChevronDown',16)}<i class="ad-strip-bar"><i class="ad-notch"></i></i></button></div>`;
  const phraseEl=host.querySelector('.ad-phrase');adUsable=adFitPhrases(phraseEl);adShowPhrase(adPhraseIdx);
  host.querySelector('.ad-shuffle').onclick=adShuffle;host.querySelector('.ad-btn').onclick=adPlay;
  host.querySelector('.ad-strip').onclick=()=>typeof homeFold!=='undefined'&&homeFold.close();
  adFoldGeo=null;adPaint(!fresh);
  if(typeof homeFoldRefresh==='function')homeFoldRefresh();
}
/* The fold, seen from inside the card. The cover and the title are the same nodes in both states:
 * the cover shrinks to 40 dp at the strip's left edge, the kicker and title slide into the strip
 * row; the rest fades out early, and the strip's count and progress line fade in last. */
const AD_STRIP=56,AD_STRIP_COVER=40;
let adFoldGeo=null;
function albumDayFold(f,cardH){
  const card=$('homeAlbumDay')?.querySelector('.ad-card');if(!card)return;
  if(!adFoldGeo||adFoldGeo.card!==card){
    const cover=card.querySelector('.ad-cover'),meta=card.querySelector('.ad-meta'),top=meta.querySelector('.ad-kicker').offsetHeight+meta.querySelector('.ad-title').offsetHeight+2;
    adFoldGeo={card,cs:cover.offsetWidth,cx:cover.offsetLeft,cy:cover.offsetTop,mx:meta.offsetLeft,my:meta.offsetTop,top};
  }
  const g=adFoldGeo,pad=(AD_STRIP-AD_STRIP_COVER)/2,cut=Math.max(0,cardH-AD_STRIP)*f,fade=String(clamp01(1-3*f)),gone=f>=1/3?'hidden':'';
  card.querySelector('.ad-plate').style.bottom=cut?`${cut.toFixed(2)}px`:'';
  card.style.clipPath=cut?`inset(0 0 ${cut.toFixed(2)}px 0)`:'';
  card.querySelector('.ad-cover').style.transform=f?`translate(${lerp(0,pad-g.cx,f).toFixed(2)}px,${lerp(0,pad-g.cy,f).toFixed(2)}px) scale(${lerp(1,AD_STRIP_COVER/g.cs,f).toFixed(4)})`:'';
  card.querySelector('.ad-meta').style.transform=f?`translate(${lerp(0,pad*2+AD_STRIP_COVER-g.mx,f).toFixed(2)}px,${lerp(0,(AD_STRIP-g.top)/2-g.my,f).toFixed(2)}px)`:'';
  card.querySelector('.ad-artist').style.opacity=fade;
  for(const el of card.querySelectorAll('.ad-say,.ad-btn,.ad-progress')){el.style.opacity=fade;el.style.visibility=gone;}
  const strip=card.querySelector('.ad-strip');strip.style.opacity=String(clamp01((f-.6)/.4));strip.style.visibility=f>.6?'visible':'';
}
function albumDayFoldInert(folded){
  const card=$('homeAlbumDay')?.querySelector('.ad-card');if(!card)return;
  for(const el of card.querySelectorAll('.ad-cover,.ad-say,.ad-btn'))el.inert=folded;
  card.querySelector('.ad-strip').tabIndex=folded?0:-1;
}
function syncAlbumDayMotion(visible){
  const edge=$('homeAlbumDay')?.querySelector('.ad-edge i');if(!edge)return;
  const p=adPick?adNow():null,on=visible&&!REDUCED&&!(typeof homeFold!=='undefined'&&homeFold.isOpen())&&adIsCurrent()&&playing&&p&&p.fraction>0&&p.fraction<1;
  $('homeAlbumDay').classList.toggle('ad-live',!!on);
  if(on){adEdgeAnim??=edge.animate([{transform:'translateY(0)'},{transform:'translateY(12px)'}],{duration:640,iterations:Infinity,easing:'linear'});adEdgeAnim.play();}
  else if(adEdgeAnim){adEdgeAnim.cancel();adEdgeAnim=null;}
  const glyph=$('homeAlbumDay').querySelectorAll('.ad-btn .ad-label>.ico');if(glyph.length&&p){const want=adGlyph(p);if($('homeAlbumDay').dataset.glyph!==want){$('homeAlbumDay').dataset.glyph=want;glyph.forEach(g=>g.outerHTML=icon(want,16));}}
}
/* The finale. A song heard while this album is the pick may cross the 75 % mark: the button
 * flows into «Обыграна ✓» (its width springs to the label's, the text crossfades in 180 ms), and
 * 500 ms later a JoiPro banner rises over the card, inside its bounds, with a finale phrase.
 * No vibration: nobody touched anything. It leaves on a tap elsewhere or after 6 s. Once a day. */
const AD_JOI_MS=6000;
function adWonWidth(btn){const label=btn.querySelector('.ad-label');return Math.ceil([...label.children].reduce((w,el)=>w+el.getBoundingClientRect().width,0)+8+72);}
function adHeard(i){
  if(!adPick||i<0)return;const was=adNow().done;adPlays[i]=(adPlays[i]||0)+1;
  const now=adNow();if(!was&&now.done&&!adFinaleShown){adFinaleShown=true;adFinale();}else adPaint();
}
function adFinale(){
  const btn=$('homeAlbumDay').querySelector('.ad-btn'),from=btn.offsetWidth;adWon=true;
  if(!REDUCED&&btn.animate)btn.querySelectorAll('.ad-label').forEach(l=>l.animate([{opacity:1},{opacity:0}],{duration:90,easing:'ease-in'}));
  const swap=()=>{
    adPaint();const b=$('homeAlbumDay').querySelector('.ad-btn'),to=adWonWidth(b);
    adWonSpring=createSpring({value:from,stiffness:300,damping:30,name:'ad-won',onUpdate:v=>{const x=$('homeAlbumDay').querySelector('.ad-btn');if(x)x.style.width=v.toFixed(1)+'px';}});
    if(REDUCED){adWonSpring.set(to);}else{adWonSpring.to(to);b.querySelectorAll('.ad-label').forEach(l=>l.animate([{opacity:0},{opacity:1}],{duration:90,easing:'ease-out'}));}
  };
  REDUCED?swap():setTimeout(swap,90);
  REDUCED?adShowJoi():setTimeout(adShowJoi,500);
}
function adShowJoi(){
  const card=$('homeAlbumDay').querySelector('.ad-card');if(!card||!adWon)return;adCloseJoi(true);
  const veil=document.createElement('div');veil.className='ad-joi';card.append(veil);
  const host=document.createElement('div');veil.append(host);const b=adPick.base,phrases=adFinalePhrases();
  createJoiPro(host,{kicker:'Пластинка обыграна',title:esc(adPick.album.album),subtitle:esc(phrases[adVariant%phrases.length]),action:'Разворот',art:b.cover,
    colors:[b.palette?.accent?.dark||'#b49acb',b.palette?.vibrant||'#5664b3'],particles:REDUCED?0:28,onAction:()=>{adCloseJoi();openSheet('album',b);}});
  host.querySelector('.jp-action').setAttribute('aria-label','Открыть разворот альбома');
  if(!REDUCED&&veil.animate)veil.animate([{opacity:0},{opacity:1}],{duration:220,easing:'ease-out'}).ready.then(()=>veil.querySelector('.joipro')?.animate([{transform:'translateY(14px) scale(.96)'},{transform:'none'}],{duration:420,easing:'cubic-bezier(.2,.9,.3,1.2)'}));
  const outside=e=>{if(!veil.querySelector('.joipro')?.contains(e.target))adCloseJoi();};
  setTimeout(()=>document.addEventListener('pointerdown',outside,true));
  adJoiOff=()=>document.removeEventListener('pointerdown',outside,true);
  adJoiTimer=setTimeout(()=>adCloseJoi(),AD_JOI_MS);
}
function adCloseJoi(instant=false){
  clearTimeout(adJoiTimer);adJoiOff?.();adJoiOff=null;
  const veil=$('homeAlbumDay')?.querySelector('.ad-joi');if(!veil)return;
  if(instant||REDUCED||!veil.animate){veil.remove();return;}
  veil.style.pointerEvents='none';veil.animate([{opacity:1},{opacity:0}],{duration:200,easing:'ease-in'}).onfinish=()=>veil.remove();
}
window.homeReviewExtra={
  setPick:k=>{adKind=k;adPick=null;$('page-home').dataset.pick=k;if(k==='none'&&homeState==='ready')setReviewHome('nopick');else renderAlbumDayCard();},
  setProgress:s=>{adProg=s;if(!adPick)return renderAlbumDayCard();adCloseJoi(true);adSetPlays(s);adFinaleShown=adNow().done;adWon=false;adPaint(false);},
  hearOne:()=>{if(!adPick)return;const i=adPick.songs.findIndex((s,k)=>s.d>60&&!adPlays[k]);adHeard(i<0?adPick.songs.findIndex(s=>s.d>60):i);},
  phraseLines:()=>{const el=$('homeAlbumDay').querySelector('.ad-phrase'),out=adUsable.map((_,i)=>{adShowPhrase(i);return Math.round(el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight));});adShowPhrase(0);return out;},
  albumDay:()=>({firstUnheard:(({id,t})=>({id,t}))(adFirstUnheard()),progress:adNow(),usable:adUsable.length}),
  albumPlaying:on=>{if(on&&!adIsCurrent())adPlay();else if(adIsCurrent()){setPlaying(on);adPaint();}},
};
