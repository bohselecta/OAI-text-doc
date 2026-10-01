/** Closed mapping for the existing Document API. No arbitrary URL/tool execution. */
export const APPS_TOOLS = Object.freeze({open:'open_document',read:'read_document_data',action:'document_action'});
export const APPS_META = 'languageCanvas';
export const WIDGET_URI = 'ui://language-canvas/document-v1.html';
const actions = new Set(['proposals','accept','undo','lock','sections','profiles','audit','export','publish']);
const routeError = () => Object.assign(new Error('This operation is not available through the Document app.'), {code:'APP_ROUTE'});

export function toToolRequest(path, method='GET', body, contextId) {
  if (typeof path !== 'string' || !contextId) throw routeError();
  let request;
  if (method === 'GET' && path === '/session') request={resource:'session'};
  else if (method === 'GET' && path === '/documents') request={resource:'documents'};
  else if (method === 'POST' && path === '/documents') request={action:'create',body};
  else {
    const match=path.match(/^\/documents\/([A-Za-z0-9_-]{1,80})(?:\/(history|backup|proposals|accept|undo|lock|sections|profiles|audit|export|publish))?$/);
    if (!match) throw routeError();
    const [,documentId,action]=match;
    if (method === 'GET' && (!action || ['history','backup'].includes(action))) request={resource:action??'document',documentId};
    else if (method === 'POST' && actions.has(action)) request={action,documentId,body};
    else throw routeError();
  }
  return {name:method==='GET'?APPS_TOOLS.read:APPS_TOOLS.action,arguments:{contextId,request}};
}

export function toServiceRequest(request) {
  if (request.resource) {
    const path=request.resource==='session'?'/api/session':request.resource==='documents'?'/api/documents':`/api/documents/${request.documentId}${request.resource==='document'?'':`/${request.resource}`}`;
    return {method:'GET',path};
  }
  return {method:'POST',path:request.action==='create'?'/api/documents':`/api/documents/${request.documentId}/${request.action}`,body:request.body};
}
