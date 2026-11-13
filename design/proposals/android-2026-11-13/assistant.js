/* Phone integration of the accepted Steps showcase. createRichbox is the original
 * MIT mishanaer implementation in vendor/tactile-lib.js, unchanged. Only the host
 * layout and lifecycle differ: hidden/finished work must not keep its waiting loop. */
const answerSessions=new Map();
function answerVisible(session){
  if(!session.host.isConnected||document.hidden)return false;
  return session.host.closest('#sheet') ? sheetName==='chat' : pageName==='assistant'&&!playerTarget&&!sheetName;
}
function syncThinkingMotion(){
  for(const [host,session] of answerSessions){
    if(!host.isConnected){disposeAnswer(host);continue;}
    const visible=answerVisible(session);host.classList.toggle('thinking-visible',visible);
    for(const step of session.steps){
      if(!visible){if(step.rb.state==='waiting')step.rb.setState('empty');continue;}
      const target=step.status;
      if(step.rb.state!==target)step.rb.setState(target);
    }
  }
}
function disposeAnswer(host){
  const session=answerSessions.get(host);if(!session)return;
  session.timers.forEach(clearTimeout);
  // Leaving "waiting" cancels the vendor component's timer and animation frame.
  session.steps.forEach(step=>{if(step.rb.state==='waiting')step.rb.setState('empty');});
  answerSessions.delete(host);
}
function updateAnswerState(session,state){
  session.state=state;session.host.dataset.state=state;
  session.host.setAttribute('aria-busy',String(state==='working'));
  if(session.host.id==='assistantAnswer'){
    $('page-assistant').dataset.answer=state;$('assistantReset').hidden=state==='idle';
    if(['idle','working','ready','error'].includes(state))$('reviewAssistant').value=state;
  }
}
function animateAnswerIn(el,answer=false){
  const session=answerSessions.get(el.closest('.assistant-turn'));if(session&&!answerVisible(session))return;
  if(!REDUCED)el.animate([{opacity:0,transform:`translateY(${answer?10:6}px)`},{opacity:1,transform:'none'}],
    {duration:answer?420:300,easing:answer?'cubic-bezier(.2,.9,.3,1)':'ease-out'});
}
function finishStep(step,session){
  if(!step)return;step.status='done';step.el.className='step done';step.el.querySelector('.step-word').textContent=step.label;
  step.el.querySelector('.sr-only').textContent='Готово: ';if(answerVisible(session))step.rb.setState('done');
}
function addAnswerStep(session,index,finished=false){
  finishStep(session.steps.at(-1),session);
  const label=session.labels[index],el=document.createElement('div');el.className='step '+(finished?'done':'cur');
  el.innerHTML=`<span class="rbs"></span><span class="sr-only">${finished?'Готово: ':'Сейчас: '}</span><span class="step-word">${esc(label)}${finished?'':'…'}</span>`;
  session.host.querySelector('.steps').append(el);
  const status=finished?'done':'waiting';
  const step={el,label,status,rb:createRichbox(el.querySelector('.rbs'),16,finished?'done':'empty')};
  session.steps.push(step);syncThinkingMotion();animateAnswerIn(el);
  session.host.querySelector('.answer-announcement').textContent=label;
}
function completeAnswer(session){
  if(!session.host.isConnected||answerSessions.get(session.host)!==session)return;finishStep(session.steps.at(-1),session);updateAnswerState(session,'ready');
  session.host.querySelector('.thinking-actions').remove();
  const answer=document.createElement('article');answer.className='assistant-response';
  const t=session.track;
  if(session.kind==='about'){
    answer.innerHTML=`<p><strong>«${esc(t.t)}»</strong> — ${esc(t.a)}. Песня из альбома «${esc(t.album)}»${t.year?`, ${t.year} года`:''}.</p>${t.producer?`<p>В продюсерских кредитах — ${esc(t.producer)}.</p>`:''}<div class="answer-tracks">${row(t)}</div>`;
  }else{
    answer.innerHTML=`<p>Вот три песни из вашей библиотеки. Можно начать с любой.</p><div class="answer-tracks">${[t,...tracks.filter(x=>x.id!==(t.sourceId||t.id))].slice(0,3).map(row).join('')}</div>`;
  }
  session.host.append(answer);animateAnswerIn(answer,true);
  session.host.querySelector('.answer-announcement').textContent='Ответ готов';syncThinkingMotion();
}
function failAnswer(session,cancelled=false){
  session.timers.forEach(clearTimeout);session.timers=[];
  const last=session.steps.at(-1);
  if(last){last.status=cancelled?'cancelled':'error';last.el.className='step failed';if(answerVisible(session))last.rb.setState(last.status);last.el.querySelector('.step-word').textContent=cancelled?'Ответ остановлен':'Не удалось получить ответ';last.el.querySelector('.sr-only').textContent='';}
  updateAnswerState(session,cancelled?'cancelled':'error');
  const actions=session.host.querySelector('.thinking-actions');
  actions.innerHTML=`<button type="button" class="text-action">${cancelled?'Попробовать снова':'Повторить'}</button>`;
  actions.querySelector('button').onclick=()=>simulateAnswer(session.host,session.question);
  session.host.querySelector('.answer-announcement').textContent=cancelled?'Ответ остановлен':'Не удалось получить ответ';syncThinkingMotion();
}
function simulateAnswer(host,question,{preview='auto'}={}){
  question=question.trim();if(!question)return;disposeAnswer(host);host.classList.add('assistant-turn');
  const t=(host.closest('#sheet')?detailTrack:null)||currentTrack(),kind=/песн|истори|названи|звучани|расскажи/i.test(question)?'about':'tracks';
  const session={host,question,track:t,kind,steps:[],timers:[],state:'working',
    labels:kind==='about'?['Нахожу песню в библиотеке','Проверяю альбом и участников записи','Собираю ответ']:['Ищу в библиотеке похожее по звуку','Сверяю продюсеров и год','Собираю подборку']};
  answerSessions.set(host,session);
  host.innerHTML=`<h3 class="answer-question">${esc(question)}</h3><div class="steps" aria-label="Этапы ответа"></div><div class="thinking-actions"><button type="button" class="text-action">Остановить</button></div><span class="answer-announcement sr-only" role="status" aria-live="polite"></span>`;
  host.querySelector('.thinking-actions button').onclick=()=>failAnswer(session,true);
  updateAnswerState(session,'working');host.closest('.assistant-content')?.scrollTo({top:0});animateAnswerIn(host.querySelector('.answer-question'));
  if(preview==='ready'){
    session.labels.forEach((_,i)=>addAnswerStep(session,i,true));completeAnswer(session);
  }else if(preview==='working'||preview==='error'){
    addAnswerStep(session,0,true);addAnswerStep(session,1);
    if(preview==='error')failAnswer(session);
  }else{
    session.labels.forEach((_,i)=>session.timers.push(setTimeout(()=>{
      if(answerSessions.get(host)!==session)return;if(!host.isConnected){disposeAnswer(host);return;}addAnswerStep(session,i);
    },300+i*1300)));
    session.timers.push(setTimeout(()=>completeAnswer(session),4200));
  }
  syncThinkingMotion();
}
function resetAssistant(){
  disposeAnswer($('assistantAnswer'));$('assistantAnswer').replaceChildren();$('assistantAnswer').removeAttribute('data-state');
  $('assistantAnswer').setAttribute('aria-busy','false');$('page-assistant').dataset.answer='idle';$('assistantReset').hidden=true;
  $('reviewAssistant').value='idle';$('assistantForm').querySelector('input').value='';
}
async function setReviewAssistant(value){
  closeSheet();if(playerTarget)setPlayer(false);await showPage('assistant');
  if(value==='idle')resetAssistant();else simulateAnswer($('assistantAnswer'),'Расскажи о текущей песне',{preview:value});
}
function initAssistant(){
  document.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>simulateAnswer($('assistantAnswer'),b.dataset.ask));
  $('assistantForm').onsubmit=e=>{e.preventDefault();const input=e.target.querySelector('input');simulateAnswer($('assistantAnswer'),input.value);input.value='';};
  $('assistantReset').onclick=resetAssistant;
  $('reviewAssistant').onchange=e=>setReviewAssistant(e.target.value);
  $('reviewThinking').onclick=()=>setReviewAssistant('working');
  document.addEventListener('visibilitychange',syncThinkingMotion);
}
