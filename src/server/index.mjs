import { environment } from './auth.mjs';
import { createApp } from './app.mjs';
const config=environment();
const app=createApp(config);
app.server.listen(config.port,config.host,()=>console.log(`Document 1.0.0 · ${config.origin} · ${config.auth} identity · ${config.provider} provider`));
let stopping=false;
function stop(){if(stopping)return;stopping=true;app.server.close(()=>{app.store.close();process.exit(0);});setTimeout(()=>{app.store.close();process.exit(1);},10000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
