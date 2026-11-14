/* MorphMenu: a button grows into its list and folds back into the button, the way menus open in
 * Telegram for Android. The panel is laid out in its final rectangle ahead of time and hidden;
 * one spring t clips it from the anchor's rectangle (t = 0) to the whole panel (t = 1), so the
 * button seems to change shape rather than open a window. Generic: it knows nothing of search.
 *
 * Closing: the content fades out first (100 ms), then t returns to 0 on the same spring; open()
 * mid-close retargets that spring, so the speed carries over. Scrim tap, Escape and the system
 * Back (one history entry while open) close it. Focus goes to the panel's [autofocus] and back
 * to the anchor. Children marked [data-morph-item] arrive in a 30 ms ladder. */
function createMorphMenu({anchor,panel,stage,radiusFrom=24,radiusTo=20,onOpen,onClose}){
  const scrim=document.createElement('div');scrim.className='morph-scrim';scrim.setAttribute('aria-hidden','true');stage.append(scrim);
  const body=panel.querySelector('.morph-body')||panel;
  let t=0,target=0,pushed=false,pendingBack=0,fade=null,from=null;
  const measure=()=>{const a=anchor.getBoundingClientRect(),p=panel.getBoundingClientRect();from={top:a.top-p.top,right:p.right-a.right,bottom:p.bottom-a.bottom,left:a.left-p.left};};
  const paint=v=>{
    t=v;const k=clamp01(v),u=1-k;if(!from)measure();
    panel.style.clipPath=`inset(${(from.top*u).toFixed(2)}px ${(from.right*u).toFixed(2)}px ${(from.bottom*u).toFixed(2)}px ${(from.left*u).toFixed(2)}px round ${lerp(radiusFrom,radiusTo,k).toFixed(2)}px)`;
    panel.style.visibility=k>0?'visible':'';scrim.style.visibility=k>0?'visible':'';scrim.style.opacity=k.toFixed(3);
    panel.style.setProperty('--morph-in',clamp01((k-.4)/.6).toFixed(3));
    anchor.style.opacity=k>0?clamp01(1-k/.3).toFixed(3):'';
  };
  const spring=createSpring({value:0,stiffness:320,damping:32,name:'morph-'+(panel.id||'menu'),onUpdate:paint,
    onRest:()=>{if(t===0&&target===0){fade?.cancel();fade=null;}}});
  const push=()=>{if(pushed||pendingBack)return;try{history.pushState({morph:1},'');pushed=true;}catch{}};
  function open(){
    if(target===1){spring.to(1);return;}target=1;fade?.cancel();fade=null;
    if(t<=0)measure();
    panel.inert=false;panel.style.visibility='visible';scrim.style.pointerEvents='auto';push();
    spring.to(1);
    if(!REDUCED)panel.querySelectorAll('[data-morph-item]').forEach((el,i)=>el.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:260,delay:120+i*30,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'}));
    panel.querySelector('[autofocus]')?.focus({preventScroll:true});
    onOpen?.();
  }
  function close({fromHistory=false,instant=false}={}){
    if(target===0)return;target=0;panel.inert=true;scrim.style.pointerEvents='';
    if(pushed){pushed=false;if(!fromHistory){pendingBack++;history.back();}}
    if(panel.contains(document.activeElement)||!document.activeElement||document.activeElement===document.body)anchor.focus({preventScroll:true});
    onClose?.();
    if(instant||REDUCED||!body.animate){fade?.cancel();fade=null;spring.set(0);return;}
    fade=body.animate([{opacity:1},{opacity:0}],{duration:100,easing:'ease-in',fill:'forwards'});
    fade.onfinish=()=>{if(target===0)spring.to(0);};
  }
  /* A Back we caused ourselves is swallowed; if the menu reopened meanwhile, its entry is pushed now. */
  addEventListener('popstate',()=>{
    if(pendingBack){pendingBack--;if(target===1)push();return;}
    if(target===1){pushed=false;close({fromHistory:true});}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&target===1){e.preventDefault();e.stopImmediatePropagation();close();}},true);
  scrim.onclick=()=>close();
  panel.inert=true;
  return {open,close,isOpen:()=>target===1,progress:()=>t,set:v=>{fade?.cancel();fade=null;spring.set(v);},relayout:()=>{measure();paint(t);}};
}
