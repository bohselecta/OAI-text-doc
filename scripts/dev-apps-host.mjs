// Development host only. Not bundled or published in the production static root.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
try{
  const client=new Client({name:'document-local-rehearsal',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',location.href)));
  const tools=await client.listTools();
  const openTool=tools.tools.find(tool=>tool.name==='open_document');
  const result=await client.callTool({name:openTool.name,arguments:{}});
  const uri=openTool._meta.ui.resourceUri;
  const resource=await client.readResource({uri});
  const frame=document.querySelector('iframe');
  const bridge=new AppBridge(null,{name:'Document local rehearsal',version:'1.0.0'},{serverTools:{},downloadFile:{},logging:{}},{hostContext:{theme:'dark',displayMode:'fullscreen',availableDisplayModes:['fullscreen'],containerDimensions:{width:innerWidth,height:innerHeight-65}}});
  bridge.oncalltool=args=>client.callTool(args);
  bridge.onsizechange=({height})=>{if(Number.isFinite(height)){window.__sizes??=[];window.__sizes.push(height);frame.style.height=height+'px';}};
  bridge.ondownloadfile=async({contents})=>{
    window.__downloads??=[];
    for(const item of contents){
      if(item.type!=='resource')throw new Error('Only embedded Document exports are supported.');
      const resource=item.resource;window.__downloads.push(resource);
      const url=URL.createObjectURL(new Blob([resource.text],{type:resource.mimeType}));
      const a=document.createElement('a');a.href=url;a.download=resource.uri.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    return {};
  };
  bridge.oninitialized=async()=>{await bridge.sendToolInput({arguments:{}});await bridge.sendToolResult(result);};
  await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
  frame.srcdoc=resource.contents[0].text;
}catch(error){document.querySelector('#error').textContent=error.message;console.error(error);}
