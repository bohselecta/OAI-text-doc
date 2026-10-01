import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

/** The original UI modules/assets are served separately without transformation. */
export async function buildApps({outfile='dist/apps/apps-widget.js'}={}) {
  await build({entryPoints:['src/adapters/apps/widget.mjs'],outfile,bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await buildApps();console.log('Built MCP Apps bridge; original Document UI is imported unchanged.');}
