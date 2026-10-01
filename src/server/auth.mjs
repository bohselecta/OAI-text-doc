import { verify, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fail } from '../core/contracts.mjs';
export function authentication(config) {
  if(config.auth==='local') {
    if(config.production||!['127.0.0.1','localhost','::1'].includes(config.host))fail(500,'AUTH_CONFIG','Local authentication is only allowed on a loopback development server.');
    return ()=>({sub:'local-author',tenant:'local-workspace',role:'admin'});
  }
  if(config.auth!=='jwt'||!config.publicKey||!config.issuer||!config.audience)fail(500,'AUTH_CONFIG','Configure RS256 JWT authentication with a public key, issuer and audience.');
  const publicKey=createPublicKey(config.publicKey);
  if(publicKey.asymmetricKeyType!=='rsa'||(publicKey.asymmetricKeyDetails?.modulusLength??0)<2048)fail(500,'AUTH_CONFIG','Use an RSA public key with at least 2048 bits.');
  return req=>{
    const auth=req.headers.authorization??'';
    if(!auth.startsWith('Bearer ')||auth.length>12000)fail(401,'AUTH_REQUIRED','Sign in through the host to use Document.');
    const token=auth.slice(7),parts=token.split('.');
    if(parts.length!==3)fail(401,'INVALID_TOKEN','Invalid access token.');
    let header,claims;
    try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{fail(401,'INVALID_TOKEN','Invalid access token.');}
    if(header.alg!=='RS256'||header.crit||!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),publicKey,Buffer.from(parts[2],'base64url')))fail(401,'INVALID_TOKEN','Invalid token signature.');
    const now=Math.floor(Date.now()/1000);
    if(claims.iss!==config.issuer||!(Array.isArray(claims.aud)?claims.aud.includes(config.audience):claims.aud===config.audience)||!Number.isSafeInteger(claims.exp)||claims.exp<=now||(claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now+30))||!Number.isSafeInteger(claims.iat)||claims.iat>now+30||claims.exp-claims.iat>3600||claims.exp<=claims.iat)fail(401,'INVALID_TOKEN','Token issuer, audience or lifetime is invalid.');
    if(typeof claims.sub!=='string'||typeof claims.workspace_id!=='string'||!/^[\w:@.-]{1,160}$/.test(claims.sub)||!/^[\w-]{1,100}$/.test(claims.workspace_id)||!['viewer','editor','publisher','admin'].includes(claims.document_role))fail(401,'INVALID_TOKEN','Token lacks a valid subject, workspace or Document role.');
    return {sub:claims.sub,tenant:claims.workspace_id,role:claims.document_role};
  };
}
export function environment(env=process.env){
  const production=env.NODE_ENV==='production',host=env.HOST??'127.0.0.1',port=Number(env.PORT??4173),origin=env.DOCUMENT_ORIGIN??`http://127.0.0.1:${port}`;
  if(!Number.isInteger(port)||port<0||port>65535)fail(500,'CONFIG','Invalid server port.');
  let parsed;try{parsed=new URL(origin);}catch{fail(500,'CONFIG','Invalid origin.');}
  if(parsed.origin!==origin||parsed.username||parsed.password||(production&&parsed.protocol!=='https:'))fail(500,'CONFIG','Configure one exact HTTPS origin in production.');
  return {host,port,origin,production,auth:env.DOCUMENT_AUTH??'local',publicKey:env.DOCUMENT_JWT_PUBLIC_KEY_FILE?readFileSync(env.DOCUMENT_JWT_PUBLIC_KEY_FILE,'utf8'):null,issuer:env.DOCUMENT_JWT_ISSUER,audience:env.DOCUMENT_JWT_AUDIENCE,db:env.DOCUMENT_DB??'./data/document.sqlite',provider:env.DOCUMENT_PROVIDER??'rehearsal',key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL,reviewModel:env.OPENAI_REVIEW_MODEL??env.OPENAI_MODEL};
}
