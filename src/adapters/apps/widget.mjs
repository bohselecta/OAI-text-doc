import { App } from '@modelcontextprotocol/ext-apps';
import { createDocumentWidgetController } from './bridge.mjs';

export function mountDocumentWidget({root=document.getElementById('document-root'),status=document.getElementById('app-status'),retry=document.getElementById('app-retry')}={}) {
  if(!root?.dataset.moduleUrl)throw new Error('Document widget module URL is missing.');
  const moduleUrl=new URL(root.dataset.moduleUrl);
  const controller=createDocumentWidgetController({
    root,
    createApp:()=>new App({name:'language-canvas-document',version:'1.0.0'},{availableDisplayModes:['inline','fullscreen']},{autoResize:true,strict:true}),
    loadModule:async attempt=>{
      if(customElements.get('language-document'))return;
      const url=new URL(moduleUrl);if(attempt)url.searchParams.set('document_retry',String(attempt));
      await import(url.href);
    },
    createElement:()=>document.createElement('language-document'),
    onStatus:(message,canRetry)=>{if(status){status.textContent=message;status.hidden=!message;}if(retry)retry.hidden=!canRetry;}
  });
  const reconnect=()=>{void controller.start();};
  retry?.addEventListener('click',reconnect);
  const dispose=()=>{retry?.removeEventListener('click',reconnect);controller.dispose();};
  window.addEventListener('pagehide',dispose,{once:true});
  void controller.start();
  return controller;
}

if(typeof document!=='undefined'&&document.getElementById('document-root'))mountDocumentWidget();
