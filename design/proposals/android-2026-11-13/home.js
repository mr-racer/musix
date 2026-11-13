/* First phone study of the approved WEB home. The orb's four drift paths and
 * periods come from web/src/ui/Orb.tsx; the source recipe is not a new material. */
const homeAnimations=[];
let homeState='ready',homeSearchMode='library';
function syncHomeMotion(){
  const visible=pageName==='home'&&!playerTarget&&!sheetName&&!document.hidden&&!['empty','error','loading'].includes(homeState);
  const on=playing&&stream,orb=$('orb');
  orb.setAttribute('aria-pressed',String(on));orb.querySelector('.o-glyph').innerHTML=icon(on?'Pause':'Play');
  $('homeFlowTitle').textContent=on?'Поток играет':'Поток';
  homeAnimations.forEach((a,i)=>{a.updatePlaybackRate(on?(i===4?2.6:2.2):1);visible?a.play():a.pause();});
}
function syncScreenMotion(){syncThinkingMotion();syncHomeMotion();}
function selectHomeSearch(mode){
  homeSearchMode=mode;const modes=document.querySelector('.search-modes'),buttons=[...modes.querySelectorAll('button')],index=mode==='ai'?1:0,button=buttons[index];
  buttons.forEach(b=>b.setAttribute('aria-selected',String(b===button)));
  const lens=modes.querySelector('.mode-lens');lens.style.width=button.offsetWidth+'px';lens.style.transform=`translateX(${button.offsetLeft}px)`;
  $('homeSearch').innerHTML=`${mode==='ai'?'Спросить':'Найти музыку'}<span>${icon(mode==='ai'?'Sparkles':'Search')}</span>`;
  $('homeSearch').setAttribute('aria-label',mode==='ai'?'Спросить ассистента':'Поиск в библиотеке');
}
async function setReviewHome(value){
  closeSheet();if(playerTarget)setPlayer(false);await showPage('home');
  homeState=value;$('page-home').dataset.home=value;$('reviewHome').value=value;
  $('page-home').setAttribute('aria-busy',String(value==='loading'));
  $('page-home').querySelector('.eyebrow').textContent=value==='offline'?'Без сети · сохранённая библиотека':'Твой вайб';
  $('orb').disabled=value==='offline';
  $('orb').setAttribute('aria-label',value==='offline'?'Поток недоступен без сети':'Включить Поток');
  const status=$('homeStatus');status.hidden=!['loading','empty','error'].includes(value);
  if(value==='loading')status.innerHTML='<div class="home-skeleton" aria-hidden="true"><i></i><i></i><i></i></div><h2>Собираем вашу музыку</h2><p>Обновляем библиотеку.</p>';
  if(value==='empty')status.innerHTML=`<span class="empty-note">${icon('Library')}</span><h2>Начнём с любимого</h2><p>Добавьте первый альбом — здесь появятся ваша музыка и Поток.</p><button class="pill" data-sheet="add">Добавить музыку</button>`;
  if(value==='error'){status.innerHTML='<h2>Музыка пока недоступна</h2><p>Не удалось обновить главную. Попробуйте ещё раз.</p><button class="pill" id="homeRetry">Повторить</button>';$('homeRetry').onclick=()=>setReviewHome('ready');}
  $('homeAlbums').innerHTML=tracks.slice(0,3).map(tile).join('');
  if(value==='long')$('homeAlbums').querySelectorAll('b').forEach((b,i)=>b.textContent=['Очень длинное название альбома с продолжением','Ray Of Light — The Complete Collection','Everything Not Saved Will Be Lost, Part 1'][i]);
  syncHomeMotion();selectHomeSearch(homeSearchMode);
}
function initHome(){
  $('homeFan').innerHTML=tracks.slice(0,3).map(t=>`<img src="${t.cover}" alt="">`).join('');
  $('homeCounts').textContent=`${new Set(tracks.map(t=>t.album)).size} альбома · ${new Set(tracks.map(t=>t.a)).size} артиста`;
  $('homeSearch').onclick=async()=>{if(homeSearchMode==='library')openSheet('search');else{await showPage('assistant');$('assistantForm').querySelector('input').focus({preventScroll:true});}};
  const modes=document.querySelector('.search-modes'),buttons=[...modes.querySelectorAll('button')];
  buttons.forEach(b=>b.onclick=()=>selectHomeSearch(b.dataset.searchMode));
  const indexAt=x=>{const r=modes.getBoundingClientRect();return x-r.left<buttons[1].offsetLeft?0:1;};
  let original=0,over=0;
  gesture(modes,{down:()=>{original=homeSearchMode==='ai'?1:0;over=original;},start:d=>{if(d.axis!=='x')d.axis='none';},
    move:(d,e)=>{if(d.axis!=='x')return;const i=indexAt(e.clientX);if(i!==over){over=i;selectHomeSearch(buttons[i].dataset.searchMode);haptic('tick');}},
    cancel:()=>selectHomeSearch(buttons[original].dataset.searchMode)});
  modes.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const i=e.key==='ArrowRight'?1:0;selectHomeSearch(buttons[i].dataset.searchMode);buttons[i].focus();}};
  new ResizeObserver(()=>selectHomeSearch(homeSearchMode)).observe(modes);
  if(!REDUCED){
    const drift=[
      ['translate(-25%,-15%) scale(1)','translate(35%,20%) scale(1.35)','translate(5%,-30%) scale(.85)','translate(-25%,-15%) scale(1)'],
      ['translate(30%,25%) scale(1.1)','translate(-20%,-10%) scale(.9)','translate(25%,30%) scale(1.3)','translate(30%,25%) scale(1.1)'],
      ['translate(10%,30%) scale(.9)','translate(-30%,-20%) scale(1.25)','translate(10%,30%) scale(.9)'],
      ['translate(-30%,20%) scale(1.2)','translate(30%,-25%) scale(.95)','translate(-30%,20%) scale(1.2)']
    ];
    $('orb').querySelectorAll('.o-liquid i').forEach((el,i)=>homeAnimations.push(el.animate(drift[i].map(transform=>({transform})),{duration:[7000,9000,11000,8000][i],iterations:Infinity,easing:'ease-in-out'})));
    homeAnimations.push($('orb').querySelector('.o-ring').animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:6000,iterations:Infinity}));
  }
  $('orb').addEventListener('pointerdown',()=>{if(REDUCED)return;$('orb').querySelector('.o-halo').animate([{transform:'scale(.8)',opacity:.9},{transform:'scale(2.1)',opacity:0}],{duration:820,easing:'cubic-bezier(.2,.7,.2,1)'});});
  $('reviewHome').onchange=e=>setReviewHome(e.target.value);
  document.addEventListener('visibilitychange',syncHomeMotion);syncHomeMotion();
  if(document.body.dataset.reviewFocus==='home'){
    document.querySelector('.review-controls h1').innerHTML='Главная.<br>Первый разбор.';
    document.querySelector('.review-controls>p').textContent='Композиция WEB в телефоне: Поток, поиск, фонотека, альбомы и неделя. Шесть состояний, три размера. Это предложение для отдельного разбора главной.';
  }
}
