import { randomUUID } from 'node:crypto';
import { Fault, fail } from '../core/contracts.mjs';
import { RehearsalProvider, OpenAIProvider } from '../server/provider.mjs';
import { createDocumentService } from './service.mjs';
import { hostedAuthConfig, createOAuthAuthenticator, protectedResourceMetadata, authChallenge } from './oauth.mjs';
import { createNeonStore } from './neon/index.mjs';
import { handleAppsMcpRequest } from './apps/server.mjs';

const MAX_BODY=1000000;
export async function readMcpBody(req) {
  if((req.headers['content-type']??'').split(';')[0].trim()!=='application/json')fail(415,'CONTENT_TYPE','Send application/json.');
  if(req.body!==undefined){
    const serialized=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(Buffer.byteLength(serialized)>MAX_BODY)fail(413,'TOO_LARGE','Request is larger than 1 MB.');
    try{return typeof req.body==='string'?JSON.parse(serialized):req.body;}catch{fail(400,'JSON','Invalid JSON.');}
  }
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)fail(413,'TOO_LARGE','Request is larger than 1 MB.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'JSON','Invalid JSON.');}
}
export function hostedProvider(env){
  if(!env.DOCUMENT_PROVIDER||env.DOCUMENT_PROVIDER==='rehearsal')return new RehearsalProvider();
  if(env.DOCUMENT_PROVIDER==='openai')return new OpenAIProvider({key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL,reviewModel:env.OPENAI_REVIEW_MODEL??env.OPENAI_MODEL,timeout:45000});
  fail(500,'PROVIDER_CONFIG','Unknown Document provider.');
}
/** Dependencies are trusted deployment/test adapters, never HTTP parameters. */
export function createHostedHandler({env=process.env,authenticate,storeFactory,provider}={}) {
  let config,auth;
  return async function handler(req,res){
    const requestId=randomUUID();
    res.setHeader('X-Request-Id',requestId);res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Strict-Transport-Security','max-age=31536000');
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    let store;
    try{
      const path=new URL(req.url,'http://document.invalid').pathname;
      if(req.method==='GET'&&path==='/healthz'){send(200,{status:'ok',adapter:'apps-sdk-neon',version:'1.0.0'});return;}
      config??=hostedAuthConfig(env);
      if(req.headers.host!==new URL(config.origin).host)fail(403,'HOST','Unrecognized host.');
      if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp'){
        if(req.method!=='GET')fail(405,'METHOD','Method not allowed.');
        res.setHeader('Access-Control-Allow-Origin','*');send(200,protectedResourceMetadata(config));return;
      }
      if(path!=='/mcp')fail(404,'NOT_FOUND','Resource not found.');
      if(req.headers.origin&&req.headers.origin!==config.origin)fail(403,'ORIGIN','Cross-origin MCP requests are not allowed.');
      if(req.headers['sec-fetch-site']==='cross-site')fail(403,'ORIGIN','Cross-site MCP requests are not allowed.');
      if(!['POST','GET','DELETE'].includes(req.method))fail(405,'METHOD','Method not allowed.');
      auth??=authenticate??createOAuthAuthenticator(config);
      const actor=await auth(req);
      const parsedBody=req.method==='POST'?await readMcpBody(req):undefined;
      store=await (storeFactory?storeFactory():createNeonStore({connectionString:env.DATABASE_URL}));
      const dispatch=createDocumentService({store,provider:provider??hostedProvider(env),meter:a=>store.meter(a),inference:async(a,fn)=>{const release=await store.acquireInference(a);try{return await fn();}finally{await release();}}});
      await handleAppsMcpRequest(req,res,{dispatch,actor,assetBase:config.origin,widgetDomain:config.origin,securitySchemes:[{type:'oauth2',scopes:['document:read']}],authorizationChallenge:authChallenge(config,'insufficient_scope'),parsedBody});
    }catch(e){
      if(e.status===401||e.status===403&&e.oauthError)res.setHeader('WWW-Authenticate',authChallenge(config,e.oauthError??'invalid_token'));
      const known=e instanceof Fault||Number.isInteger(e.status)&&typeof e.code==='string';
      if(!res.headersSent)send(known?e.status:503,{error:{code:known?e.code:'HOST_UNAVAILABLE',message:known?e.message:'The hosted Document service is unavailable. Check server configuration.',requestId}});
      else res.end();
    }finally{if(store)await store.close().catch(()=>{});}
  };
}
