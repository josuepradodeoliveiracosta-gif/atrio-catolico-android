// Generate local deployment modules for the existing QA relay.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {renderQaSchema} from './chat-qa-build.mjs';
import {renderConversationPushPilotWorker} from './conversation-push-pilot.mjs';
import {conversationPushIdentity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

const [databaseId] = process.argv.slice(2);
if (!databaseId || process.argv.length !== 3) {
  throw Error('Uso: node build-conversation-push-pilot.mjs <UUID do D1 QA>');
}

const baseProject = 'atrio-catolico-qa-geral';
const {projectId} = conversationPushIdentity;
const schema = renderQaSchema(baseProject, databaseId)
  .replace("'atrio-qa-geral', '" + baseProject + "'", "'atrio-qa-conversations-pilot', '" + projectId + "'");
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const worker = renderConversationPushPilotWorker(source);

const directory = new URL('../.wrangler/conversations/', import.meta.url);
mkdirSync(directory, {recursive: true});
writeFileSync(new URL('worker.mjs', directory), worker);
writeFileSync(new URL('schema.sql', directory), schema);
writeFileSync(new URL('entry.mjs', directory), `
import {createQaRelay} from '../../src/qa-geral.js';
import conversationWorker from './worker.mjs';

export default createQaRelay(conversationWorker);
`.trimStart());
