// GOOGLE CLOUD RUN QA READER. No Firebase service-account keys, user records,
// writes, moderation decisions, or public diagnostic information.
import {Firestore} from '../src/firestore.js';
import {scanQaShadow} from '../src/shadow-qa.js';
import {validateShadowOutcome} from '../src/remote-gate.js';

const PROJECT='atrio-catolico-qa-v2';
const READER='guardian-qa-reader@'+PROJECT+'.iam.gserviceaccount.com';
const METADATA='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
const QA_FLAGS=Object.freeze({
  GUARDIAN_V2_TEST_MODE:'true',
  GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',
  GUARDIAN_V2_QA_SHADOW_READS:'true',
  GUARDIAN_FIREBASE_PROJECT_ID:PROJECT,
  GUARDIAN_V2_QA_PROJECT_ID:PROJECT
});

export function allowCloudRunQa(env={}) {
  return env.GUARDIAN_QA_CLOUD_RUN_ENABLED==='true'
    && env.GUARDIAN_QA_CLOUD_RUN_PROJECT===PROJECT
    && env.GUARDIAN_QA_CLOUD_RUN_ALLOWED_PROJECT===PROJECT
    && env.GUARDIAN_V2_ENABLED==='false'
    && env.GUARDIAN_V2_HOLD_ENABLED==='false'
    && env.GUARDIAN_V2_TEST_MODE==='true'
    && !env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON
    && !env.GUARDIAN_QA_ACCESS_TOKEN;
}
export async function metadata(fetcher=fetch) {
  const headers={'Metadata-Flavor':'Google'};
  const [who,token]=await Promise.all([
    fetcher(METADATA+'email',{method:'GET',headers,signal:AbortSignal.timeout(4000)}),
    fetcher(METADATA+'token',{method:'GET',headers,signal:AbortSignal.timeout(4000)})
  ]);
  if(!who.ok||!token.ok)throw Error('metadata_unavailable');
  const email=(await who.text()).trim();
  if(email!==READER)throw Error('wrong_service_identity');
  const data=await token.json();
  if(typeof data?.access_token!=='string'||data.access_token.length<20||
     data.token_type!=='Bearer'||Number(data.expires_in)<60)
    throw Error('identity_token_unavailable');
  return data.access_token;
}
export async function runCloudRunQa(env={},deps={}) {
  if(!allowCloudRunQa(env))return {status:'disabled'};
  try {
    const token=await (deps.obtainToken||metadata)(deps.fetcher);
    const reader=deps.reader||new Firestore(token,PROJECT);
    // Only expose 'scanQa' to the classifier; no commit or other writes.
    const observed=await scanQaShadow({scan:(...args)=>reader.scanQa(...args)},QA_FLAGS);
    const counts=validateShadowOutcome(observed);
    return {status:'shadow_read_only',counts};
  }catch {
    return {status:'unavailable'};
  }
}
export const QA_READER_SERVICE_ACCOUNT=READER;
