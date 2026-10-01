import { createHash, randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { authorize, Fault, KINDS, PROFILES, TARGETS } from '../../core/contracts.mjs';
import { APPS_TOOLS, APPS_META, WIDGET_URI, toServiceRequest } from './routes.mjs';

const id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const contextId=z.string().regex(/^[a-f0-9]{64}$/);
const profileIds=z.array(z.enum(Object.keys(PROFILES))).min(1).max(6);
const string=(max,empty=false)=>z.string().min(empty?0:1).max(max);
const object=shape=>z.object(shape).strict();
const createBody=z.discriminatedUnion('type',[
  object({type:z.literal('example')}),
  object({type:z.literal('template'),title:string(120),profiles:profileIds,goal:string(10000,true).optional()}),
  object({type:z.literal('brief'),title:string(120),profiles:profileIds,goal:string(10000)}),
  object({type:z.literal('import'),source:string(1000000),title:string(120).optional(),profiles:profileIds.optional()})
]);
const bodies={
  proposals:object({sectionId:id,instruction:string(6000),revision}),
  accept:object({proposalId:id}),
  undo:object({sectionId:id,revision}),
  lock:object({sectionId:id,revision,locked:z.boolean()}),
  sections:object({title:string(100),kind:z.enum(KINDS),revision}),
  profiles:object({profiles:profileIds,revision}),
  audit:object({revision,target:z.enum(Object.keys(TARGETS)),budget:object({context:z.number().int().min(2048).max(2000000),reserve:z.number().int().min(1024)}),semantic:z.boolean().optional()}),
  export:object({auditId:id,format:z.enum(['md','txt'])}),
  publish:object({auditId:id,acknowledged:z.array(string(200)).max(10000)})
};
export const readInputSchema=object({contextId,request:z.discriminatedUnion('resource',[
  ...['session','documents'].map(resource=>object({resource:z.literal(resource)})),
  ...['document','history','backup'].map(resource=>object({resource:z.literal(resource),documentId:id}))
])});
export const actionInputSchema=object({contextId,request:z.discriminatedUnion('action',[
  object({action:z.literal('create'),body:createBody}),
  ...Object.entries(bodies).map(([action,body])=>object({action:z.literal(action),documentId:id,body}))
])});
const outputSchema=object({ok:z.boolean(),status:z.number().int(),view:z.literal('document').optional(),documentId:id.optional(),documentCount:z.number().int().nonnegative().optional(),code:z.string().optional()});
const annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true};

/** A cache/identity fence only, never an authentication credential. */
export function actorContextId(actor) {
  return createHash('sha256').update(JSON.stringify([actor.sub,actor.tenant,actor.role])).digest('hex');
}
function originOf(value,name) {
  const url=new URL(value);
  if (url.username || url.password || url.search || url.hash || !['http:','https:'].includes(url.protocol)) throw new Error(`Invalid ${name}.`);
  if (url.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error(`${name} must use HTTPS outside loopback development.`);
  return url;
}
const escapeAttribute=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function createWidgetHtml({assetBase}) {
  const base=originOf(assetBase,'assetBase');
  if (!base.pathname.endsWith('/')) base.pathname+='/';
  const script=new URL('apps/apps-widget.js',base).href;
  const moduleUrl=new URL('ui/document.mjs',base).href;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document</title><style>html,body{margin:0;min-height:100%;background:#171819;color:#ededed;font-family:system-ui,sans-serif}#document-root{min-height:600px;height:100vh}#app-status{padding:16px;margin:0}#app-retry{margin:0 16px 16px;padding:8px 14px}language-document{display:block;height:100%;min-height:600px}</style></head><body><p id="app-status" role="status">Connecting to Document…</p><button id="app-retry" type="button" hidden>Retry connection</button><main id="document-root" data-module-url="${escapeAttribute(moduleUrl)}"></main><script type="module" src="${escapeAttribute(script)}"></script></body></html>`;
}

function safeResponse(response) {
  if (!response || !Number.isInteger(response.status)) throw new Error('Invalid service response.');
  // Apps is never the auto-seeding loopback host. Read-only opening must not create data.
  return response;
}
function errorResponse(error) {
  const known=error instanceof Fault;
  return {status:known?error.status:500,body:{error:{code:known?error.code:'INTERNAL',message:known?error.message:'Document could not complete this operation. Refresh before retrying.'}}};
}

/** The caller authenticates each HTTP request; actor is trusted server-side data. */
export function createDocumentMcpServer({dispatch,actor,assetBase,widgetDomain,authorizationChallenge,securitySchemes=[{type:'oauth2',scopes:['document:read']}]}) {
  authorize(actor,'read');
  if (typeof actor.sub!=='string' || !actor.sub || typeof actor.tenant!=='string' || !actor.tenant || typeof dispatch!=='function') throw new Error('Authenticated actor and dispatch are required.');
  if(authorizationChallenge!==undefined&&(typeof authorizationChallenge!=='string'||authorizationChallenge.length>4000||/[\r\n]/.test(authorizationChallenge)))throw new Error('Invalid authorization challenge.');
  actor=Object.freeze({...actor});
  const scope=actorContextId(actor),assetOrigin=originOf(assetBase,'assetBase').origin;
  const domain=widgetDomain?originOf(widgetDomain,'widgetDomain').origin:undefined;
  const server=new McpServer({name:'language-canvas-document',version:'1.0.0'});
  const wrap=(response,extra={})=>{
    response=safeResponse(response);
    const ok=response.status>=200&&response.status<300;
    return {
      content:[{type:'text',text:ok?'Document app operation completed.':'Document app operation could not complete. Review the app for recovery.'}],
      structuredContent:{ok,status:response.status,...(!ok?{code:response.body?.error?.code??'APP_ERROR'}:{}),...(extra.summary??{})},
      ...(!ok?{isError:true}:{}),
      _meta:{[APPS_META]:{kind:extra.kind??'response',contextId:scope,requestId:randomUUID(),response,...(extra.data??{})},...(authorizationChallenge&&response.status===403&&response.body?.error?.code==='FORBIDDEN'?{'mcp/www_authenticate':authorizationChallenge}:{})}
    };
  };
  async function run(request) {
    try {
      const response=safeResponse(await dispatch(actor,request));
      return request.path==='/api/session'&&response.status===200?{...response,body:{...response.body,local:false}}:response;
    } catch(error) {return errorResponse(error);}
  }
  const descriptor={outputSchema,securitySchemes,_meta:{securitySchemes}};
  const actionSecuritySchemes=securitySchemes.map(scheme=>scheme.type==='oauth2'?{...scheme,scopes:[...new Set([...(scheme.scopes??[]),'document:read','document:write','document:publish'])]}:scheme);
  registerAppResource(server,'document-widget',WIDGET_URI,{},async()=>({contents:[{
    uri:WIDGET_URI,mimeType:RESOURCE_MIME_TYPE,text:createWidgetHtml({assetBase}),
    _meta:{ui:{prefersBorder:true,...(domain?{domain}:{}),csp:{connectDomains:[],resourceDomains:[assetOrigin]}},'openai/ui':{availableDisplayModes:['inline','fullscreen']},'openai/widgetDescription':'Document: the original section-scoped Draft and separately audited Publish canvas. Full source remains in the app.'}
  }]}));
  registerAppTool(server,APPS_TOOLS.open,{
    ...descriptor,title:'Open Document',description:'Open the instruction-native Document canvas for the authenticated account. Optionally choose an existing document ID. This only reads data; authoring and publishing require explicit interaction in the app. Source, proposals and exports are private to the app and are not returned to the model.',
    inputSchema:object({documentId:id.optional()}),annotations,
    _meta:{...descriptor._meta,ui:{resourceUri:WIDGET_URI,visibility:['model','app']},'openai/toolInvocation/invoking':'Opening Document…','openai/toolInvocation/invoked':'Document ready'}
  },async({documentId})=>{
    const openedAt=Date.now();
    const session=await run({method:'GET',path:'/api/session'});
    if(session.status!==200)return wrap(session);
    const documents=await run({method:'GET',path:'/api/documents'});
    if(documents.status!==200)return wrap(documents);
    const chosen=documentId??documents.body[0]?.id;
    const document=chosen?await run({method:'GET',path:`/api/documents/${chosen}`}):null;
    if(document&&document.status!==200)return wrap(document);
    return wrap({status:200,body:null},{kind:'bootstrap',summary:{view:'document',documentCount:documents.body.length,...(chosen?{documentId:chosen}:{})},data:{openedAt,session:session.body,documents:documents.body,document:document?.body??null}});
  });
  const call=async({contextId,request})=>{
    if(contextId!==scope)return wrap({status:409,body:{error:{code:'ACCOUNT_CHANGED',message:'The connected account or permissions changed. Reopen Document before continuing.'}}});
    return wrap(await run(toServiceRequest(request)));
  };
  registerAppTool(server,APPS_TOOLS.read,{
    ...descriptor,title:'Read Document app data',description:'App-only data adapter for the current authenticated Document canvas. Reads only session, document list, source, history or backup through a closed operation list. Requires the app context fence; never use host metadata as identity.',
    inputSchema:readInputSchema,annotations,_meta:{...descriptor._meta,ui:{visibility:['app']}}
  },call);
  registerAppTool(server,APPS_TOOLS.action,{
    ...descriptor,securitySchemes:actionSecuritySchemes,title:'Perform Document app action',description:'App-only adapter for explicit canvas actions: creation, section proposals and acceptance, undo, locks, profiles, sections, audit, draft export, or guarded immutable publication. A proposal never accepts itself. Source changes remain section-scoped and revision checked; publish retains all review gates. The full workflow requests read, write and publish scopes; server roles still govern each action. Operations may incur configured provider usage and are not automatically retried.',
    inputSchema:actionInputSchema,annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false,idempotentHint:false},_meta:{...descriptor._meta,securitySchemes:actionSecuritySchemes,ui:{visibility:['app']}}
  },call);
  return server;
}

/** HTTP host must enforce authentication, host/origin and bounded JSON first. */
export async function handleAppsMcpRequest(req,res,{parsedBody,...options}) {
  // This stateless JSON-only adapter has no cross-request event stream or
  // session to terminate. Decline optional SSE explicitly instead of leaving
  // an idle GET connection (and its request-scoped store) open indefinitely.
  if(req.method!=='POST') {
    res.writeHead(405,{'Allow':'POST','Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message:'This stateless MCP endpoint supports POST only.'},id:null}));
    return;
  }
  const server=createDocumentMcpServer(options);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  const close=()=>{void transport.close();void server.close();};
  res.once('close',close);
  try {await server.connect(transport);await transport.handleRequest(req,res,parsedBody);}
  catch(error){close();throw error;}
}
