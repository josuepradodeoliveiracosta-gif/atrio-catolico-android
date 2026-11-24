// Generate a disabled QA bundle locally for review before deployment.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renderQaSchema, renderQaWrangler} from './chat-qa-build.mjs';
import {renderConversationPushPilotWorker} from './conversation-push-pilot.mjs';
import {conversationPushIdentity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

const [directory, databaseId] = process.argv.slice(2);
if (!directory || !databaseId || process.argv.length !== 4) {
  throw Error('Uso: node build-conversation-push-pilot.mjs <diretório novo> <UUID do D1 QA>');
}

const baseProject = 'atrio-catolico-qa-geral';
const {projectId} = conversationPushIdentity;
const config = renderQaWrangler(baseProject, databaseId)
  .replace('name = "atrio-qa-geral"', 'name = "atrio-push-qa-conversations"')
  .replace('src/index.general-qa.generated.js', 'worker.mjs')
  .replace('database_name = "atrio-qa-geral-db"', 'database_name = "atrio-push-qa-general-delivery"')
  .replace(`ATRIO_GENERAL_QA_PROJECT = "${baseProject}"`, `ATRIO_GENERAL_QA_PROJECT = "${projectId}"`);
const schema = renderQaSchema(baseProject, databaseId)
  .replace("'atrio-qa-geral', '" + baseProject + "'", "'atrio-qa-conversations-pilot', '" + projectId + "'");
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const worker = renderConversationPushPilotWorker(source);

mkdirSync(directory, {mode: 0o700});
for (const [name, content] of Object.entries({
  'worker.mjs': worker,
  'wrangler.toml': config,
  'schema.sql': schema,
})) {
  writeFileSync(join(directory, name), content, {flag: 'wx'});
}
