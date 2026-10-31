// QA-only read-only cycle for a future GitHub Actions keyless backend.
// No cron, moderation writes, service-account keys, or production API access.
import {classify} from './policy.js';
import {validateQaWifContext} from './qa-wif-probe.js';

const PATH = 'projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1';
const URL = 'https://firestore.googleapis.com/v1/' + PATH;
const MAX_BYTES = 8192;
const denied = () => { throw Error('qa_keyless_cycle_denied'); };

async function readBoundedJson(response) {
  const len = response.headers?.get('content-length');
  if (len != null && (!/^\d+$/.test(len) || Number(len) > MAX_BYTES)) denied();
  if (!response.body?.getReader) denied();
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) denied();
      size += value.byteLength;
      if (size > MAX_BYTES) denied();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { denied(); }
}

export async function runQaKeylessCycle(env = {}, fetcher = fetch, classifier = classify) {
  // This is strictly MANUAL QA. Scheduling requires a separate approval and
  // WIF authorization for the default branch. Never silently fall back to IAM.
  validateQaWifContext(env);
  if (env.GUARDIAN_V2_QA_AUTO_DISPATCH === 'true' ||
      env.GUARDIAN_V2_PRODUCTION_APPROVED === 'true' ||
      env.GUARDIAN_V2_IDENTITY_APPROVED === 'true') denied();
  const token = env.QA_ACCESS_TOKEN;
  if (typeof token !== 'string' || token.length < 20 || /\s/.test(token)) denied();
  if (typeof classifier !== 'function' || typeof fetcher !== 'function') denied();
  let response;
  try {
    response = await fetcher(URL, {
      method:'GET', redirect:'error',
      headers:{Authorization:'Bearer '+token, Accept:'application/json'},
      signal:AbortSignal.timeout(6500)
    });
  } catch { denied(); }
  if (response?.status !== 200) denied(); // Includes 404: never false success.
  const doc = await readBoundedJson(response);
  if (doc?.name !== PATH || doc?.fields?.qaFixture?.booleanValue !== true) denied();
  const body = doc?.fields?.body?.stringValue;
  if (typeof body !== 'string' || body.length > 4000) denied();
  let result;
  try { result = classifier(body, {}); } catch { denied(); }
  if (!['clear','warning','review','hold_candidate'].includes(result?.level)) denied();
  // No write client, no decisions, no text/uid/token/body returned or logged.
  return {status:'qa_keyless_cycle_readonly_pass', documents:1, possibleSignals:result.level==='clear'?0:1};
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === 'file://'+process.argv[1]) {
  runQaKeylessCycle(process.env)
    .then(r => console.log('GUARDIAN_QA_KEYLESS_CYCLE', r.status, r.documents, r.possibleSignals))
    .catch(() => { console.error('GUARDIAN_QA_KEYLESS_CYCLE denied'); process.exitCode=1; });
}
