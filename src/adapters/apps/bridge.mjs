import { APPS_META, APPS_TOOLS, toToolRequest } from './routes.mjs';

const appError=(code,message)=>Object.assign(new Error(message),{code});
const stale=()=>appError('APP_STALE','This Document view is no longer active.');
const clone=value=>structuredClone(value);
function payload(result) {
  const value=result?._meta?.[APPS_META];
  if (!value || typeof value.contextId!=='string' || !value.response || !Number.isInteger(value.response.status)) throw appError('APP_RESPONSE','Document returned an unreadable app response. Retry the connection.');
  return value;
}
function responseBody(result) {
  const value=payload(result),response=value.response;
  if(result.isError || response.status<200 || response.status>=300) throw appError(response.body?.error?.code??'APP_ERROR',response.body?.error?.message??'Document could not complete this operation.');
  return response.body;
}
function bootstrap(result) {
  const value=payload(result);
  if (value.kind!=='bootstrap') return null;
  responseBody(result);
  if(!value.session?.actor || !Array.isArray(value.documents) || !Number.isFinite(value.openedAt) || (value.document!==null && (!value.document?.id || !Array.isArray(value.document.sections)))) throw appError('APP_RESPONSE','Document returned an incomplete initial view.');
  return value;
}

/**
 * Adapts only one instance's API/download boundary. The original custom element,
 * source, rendering, styles and Draft/Publish handlers remain unchanged.
 * No fetch patch, bearer token, browser storage or model-context update is used.
 */
export function createDocumentWidgetController({createApp,loadModule,createElement,root,onStatus=()=>{},initialResultDelay=150}) {
  let app,element=null,ready=false,disposed=false,connection=0,view=0,latest,opening,startPromise,moduleReady=false,received=0;
  let lastRequestId=null,latestInput={},retryNumber=0;
  const timers=new Map();
  function clearView() {
    ++view;
    if(element) {
      element.remove();
      // Disconnect is not cancellation in the legacy component. Fence its async
      // requests and erase private state, including unsubmitted instructions.
      element.api=async()=>{throw stale();};
      element.download=()=>{throw stale();};
      if(element.s) element.s={...element.s,docs:[],doc:null,session:null,proposal:null,audit:null,release:null,instructions:{},history:null,dialog:null,error:null,notice:'',busy:false};
      element.root?.replaceChildren();
      element=null;
    }
    root.replaceChildren();
  }
  function showError(error) {onStatus(error?.message??'Document could not connect. Retry the connection.',true);}
  async function reopen() {
    if(disposed || !ready)return;
    if(opening)return opening;
    const current=connection,receivedBefore=received;
    opening=(async()=>{
      const result=await app.callServerTool({name:APPS_TOOLS.open,arguments:latestInput},{timeout:30000});
      if(current!==connection || disposed)return;
      responseBody(result);
      // A model-initiated result received while this fallback was running wins.
      if(received===receivedBefore) receive(result);
    })().catch(error=>{if(current===connection&&!disposed)showError(error);}).finally(()=>{if(current===connection)opening=null;});
    return opening;
  }
  function accountChanged() {
    clearView();latest=null;lastRequestId=null;latestInput={};
    onStatus('The connected account or permissions changed. Reopening Document…',false);
    void reopen();
  }
  function mount(value) {
    if(disposed || !ready || !moduleReady)return;
    clearView();
    const ownView=view,ownConnection=connection,ownApp=app;
    const live=()=>!disposed&&view===ownView&&connection===ownConnection;
    const cache=new Map([['/session',{...value.session,local:false}],['/documents',value.documents]]);
    if(value.document)cache.set(`/documents/${value.document.id}`,value.document);
    const current=createElement();element=current;
    current.api=async(path,method='GET',body)=>{
      if(!live())throw stale();
      if(method==='GET'&&cache.has(path)) {
        const result=clone(cache.get(path));cache.delete(path);
        await Promise.resolve();if(!live())throw stale();return result;
      }
      if(method!=='GET')cache.clear();
      const request=toToolRequest(path,method,body,value.contextId);
      let result;
      try {result=await ownApp.callServerTool(request,{timeout:135000});}
      catch(error){if(!live())throw stale();throw appError('APP_CONNECTION','The host connection was interrupted. Refresh to check the saved state before retrying an action.');}
      if(!live())throw stale();
      const data=payload(result);
      if(data.contextId!==value.contextId || data.response.body?.error?.code==='ACCOUNT_CHANGED') {
        accountChanged();throw appError('ACCOUNT_CHANGED','Account changed. The previous view was cleared; review the new account before retrying.');
      }
      if(data.response.status===401) {
        clearView();latest=null;onStatus('Reconnect your Document account, then retry the connection.',true);
        throw appError('AUTH_REQUIRED','Reconnect your Document account.');
      }
      if(data.response.status===403&&data.response.body?.error?.code==='FORBIDDEN'&&result._meta?.['mcp/www_authenticate']) {
        throw appError('INSUFFICIENT_SCOPE','Reconnect your Document account with the required authoring or publishing permissions, then try again. Your saved source is unchanged.');
      }
      const answer=responseBody(result);
      return path==='/session'?{...answer,local:false}:answer;
    };
    current.download=(content,name,type='text/plain;charset=utf-8')=>{
      if(!live())throw stale();
      if(!ownApp.getHostCapabilities?.()?.downloadFile)throw appError('DOWNLOAD_UNAVAILABLE','This host cannot download files from apps. Your source is still saved; use a host with app file-download support.');
      const safeName=String(name).replace(/[^A-Za-z0-9._-]/g,'_');
      void ownApp.downloadFile({contents:[{type:'resource',resource:{uri:`file:///${safeName}`,mimeType:type.split(';')[0],text:String(content)}}]},{timeout:60000}).then(result=>{
        if(result.isError)throw appError('DOWNLOAD_DECLINED','The download was declined. Saved source and any created release are unchanged.');
      }).catch(error=>{
        if(!live())return;
        current.s.notice='';current.s.error={code:error.code??'DOWNLOAD_FAILED',message:error.message??'The host could not download this file. Saved source and any created release are unchanged.'};current.render();
      });
    };
    // Keep the complete original independent reference UI so New, Import and
    // document switching stay reachable. This is not native Spaces integration.
    current.configure({apiBase:'/apps-bridge',...(value.document?{documentId:value.document.id}:{})});
    root.append(current);
    onStatus('',false);
  }
  function receive(result) {
    if(disposed)return;
    try {
      const value=bootstrap(result);if(!value){if(!element&&result?.isError)responseBody(result);return;}
      if(value.requestId===lastRequestId || (latest&&value.openedAt<latest.openedAt))return;
      latest=value;lastRequestId=value.requestId;++received;
      if(ready&&moduleReady)mount(value);
    } catch(error) {showError(error);}
  }
  function start() {
    if(disposed)throw stale();
    if(startPromise)return startPromise;
    const current=++connection;ready=false;clearView();latest=null;lastRequestId=null;latestInput={};opening=null;
    const oldApp=app;app=createApp();const ownApp=app;
    onStatus('Connecting to Document…',false);
    // Subscribe before connect: hosts may deliver the initial result immediately.
    ownApp.ontoolresult=result=>{if(current===connection)receive(result);};
    ownApp.ontoolinput=params=>{if(current===connection)latestInput=typeof params?.arguments?.documentId==='string'?{documentId:params.arguments.documentId}:{};};
    ownApp.ontoolcancelled=()=>{if(current===connection&&!element)onStatus('Opening Document was cancelled. Retry when you are ready.',true);};
    // Keep the transport open long enough for the SDK to acknowledge teardown.
    // The host then removes the iframe; pagehide closes its transport.
    ownApp.onteardown=async()=>{dispose(false);return {};};
    ownApp.onclose=()=>{if(current===connection&&!disposed){ready=false;clearView();showError(appError('APP_CLOSED','The Document host connection closed. Retry the connection.'));}};
    startPromise=(async()=>{
      try {
        if(oldApp)await oldApp.close().catch(()=>{});
        await Promise.all([ownApp.connect(undefined,{timeout:10000}),moduleReady?Promise.resolve():loadModule(retryNumber++).then(()=>{moduleReady=true;})]);
        if(current!==connection||disposed)return;
        ready=true;
        if(latest){mount(latest);return;}
        await new Promise(resolve=>{const timer=setTimeout(()=>{timers.delete(timer);resolve();},initialResultDelay);timers.set(timer,resolve);});
        if(current!==connection||disposed)return;
        if(!latest)await reopen();
      } catch(error) {
        if(current!==connection||disposed)return;
        ready=false;clearView();showError(appError('APP_INIT','Document could not initialize its host connection or load the canvas. Retry the connection.'));
        ++connection;await ownApp.close().catch(()=>{});
      }
    })().finally(()=>{startPromise=null;});
    return startPromise;
  }
  function dispose(closeBridge=true) {
    if(disposed){if(closeBridge&&app)void app.close().catch(()=>{});return;}
    disposed=true;ready=false;++connection;clearView();latest=null;latestInput={};
    for(const [timer,resolve]of timers){clearTimeout(timer);resolve();}timers.clear();
    if(app){app.ontoolresult=undefined;app.ontoolinput=undefined;app.ontoolcancelled=undefined;app.onclose=undefined;if(closeBridge)void app.close().catch(()=>{});}
  }
  return {start,dispose,receive,get element(){return element;}};
}
