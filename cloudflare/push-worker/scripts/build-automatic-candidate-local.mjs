// Local preparation only. No Wrangler config, remote ID, credentials, deploy,
// scheduled handler or HTTP trigger for tick. Output stays inside .wrangler.
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {renderConversationPushPilotWorker} from './conversation-push-pilot.mjs';
import {D1_OUTBOX_LAB_SCHEMA} from './qa-automatic-d1-outbox-lab.mjs';
import {D1_LAB_BUDGET_SCHEMA} from './qa-automatic-d1-budget-lab.mjs';
import {D1_TRIAL_SCHEMA} from './qa-automatic-d1-trial-lab.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function buildLocalAutomaticCandidate(){
 const root=fileURLToPath(new URL('../.wrangler/',import.meta.url));
 mkdirSync(root,{recursive:true});
 const output=mkdtempSync(resolve(root,'automatic-candidate-'));
 const worker=renderConversationPushPilotWorker(readFileSync(new URL('../src/index.js',import.meta.url),'utf8'));
 const entry=[
 "import {createQaAutomaticCandidateRelay} from '../../scripts/qa-automatic-d1-relay-candidate.mjs';",
 "import manualWorker from './worker.mjs';",
 "import conversationsApi from '../../src/qa-conversations-api.js';",
 "const candidate=createQaAutomaticCandidateRelay({manualWorker,conversationsApi,fetchImpl:(...args)=>fetch(...args)});",
 "// Only the existing HTTP routes; no scheduled handler or public tick.",
 "export default {fetch:(req,env)=>candidate.fetch(req,env)};",
 ""].join('\n');
 const schema='-- Additive candidate schema only. No activation or data changes.\n'+D1_OUTBOX_LAB_SCHEMA+'\n'+D1_LAB_BUDGET_SCHEMA+'\n'+D1_TRIAL_SCHEMA+'\n';
 const files={'entry.mjs':entry,'worker.mjs':worker,'schema-candidate.sql':schema};
 for(const [name,content] of Object.entries(files))writeFileSync(resolve(output,name),content,{flag:'wx'});
 const manifest={kind:'qa-automatic-local-candidate',deployable:false,requiresRepository:true,
  defaultMode:'off',compatibilityTarget:'2026-10-26',binding:'QA_PUSH_DB',
  generatedFiles:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,hash(content)]))};
 writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return output;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.length!==2)throw Error('local candidate takes no arguments');
 console.log(buildLocalAutomaticCandidate());
}
