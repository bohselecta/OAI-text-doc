/** Own the observer AND queued frame; the SDK autoResize option does not dispose
 * either on close in ext-apps 2.0.3. This is host chrome, never module source. */
export function observeDocumentSize(app,{window:win=window,document:doc=document,ResizeObserver:Observer=ResizeObserver}={}) {
  let disposed=false,frame=null,previous='';
  const notify=()=>{
    frame=null;if(disposed)return;
    const root=doc.documentElement,heightBefore=root.style.height;
    let height;
    try{root.style.height='max-content';height=Math.ceil(root.getBoundingClientRect().height);}
    finally{root.style.height=heightBefore;}
    const width=Math.ceil(win.innerWidth),key=`${width}/${height}`;
    if(key===previous)return;previous=key;
    // A host can close between measurement and delivery. Resize failure cannot
    // become an unhandled rejection or retry a document operation.
    Promise.resolve().then(()=>{if(!disposed)return app.sendSizeChanged({width,height});}).catch(()=>{});
  };
  const schedule=()=>{if(!disposed&&frame===null)frame=win.requestAnimationFrame(notify);};
  const observer=new Observer(schedule);observer.observe(doc.documentElement);observer.observe(doc.body);schedule();
  return ()=>{if(disposed)return;disposed=true;observer.disconnect();if(frame!==null)win.cancelAnimationFrame(frame);frame=null;};
}
