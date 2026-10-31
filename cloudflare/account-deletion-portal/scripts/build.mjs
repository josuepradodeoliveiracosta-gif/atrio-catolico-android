import {cpSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, join} from 'node:path';

const HERE=dirname(fileURLToPath(import.meta.url));
const ROOT=resolve(HERE,'..');
const ID='atrio-catolico';

/**
 * Firebase web config is PUBLIC metadata, never a service-account credential.
 * Missing config fails build so no fictitious form gets published.
 */
export function publicFirebaseConfig(env) {
  const apiKey=env.FIREBASE_WEB_API_KEY;
  const appId=env.FIREBASE_WEB_APP_ID;
  const authDomain=env.FIREBASE_AUTH_DOMAIN;
  if(typeof apiKey!=='string' || !/^AIza[A-Za-z0-9_-]{35}$/.test(apiKey))
    throw Error('FIREBASE_WEB_API_KEY is missing or invalid');
  if(typeof appId!=='string' || !/^1:[0-9]{5,20}:web:[a-zA-Z0-9]{8,80}$/.test(appId))
    throw Error('FIREBASE_WEB_APP_ID missing (must be a Firebase WEB application id)');
  if(authDomain!==ID+'.firebaseapp.com')
    throw Error('FIREBASE_AUTH_DOMAIN must match this Firebase project');
  if(env.FIREBASE_PROJECT_ID!==ID)
    throw Error('FIREBASE_PROJECT_ID must be the official Atrio Firebase project');
  return {apiKey,appId,authDomain,projectId:ID};
}

export function buildPortal(env,outputDir) {
  const publicConfig=publicFirebaseConfig(env);
  // Never copy arbitrary user-controlled files or overwrite the repository.
  const out=resolve(outputDir);
  if(out===ROOT || out===join(ROOT,'public'))throw Error('invalid_output_directory');
  mkdirSync(out,{recursive:true});
  cpSync(join(ROOT,'public'),out,{recursive:true});
  const payload=JSON.stringify(publicConfig)
    .replaceAll('<','\\u003c').replaceAll('>','\\u003e');
  writeFileSync(join(out,'config.js'),
    'window.ATRIO_FIREBASE_CONFIG = Object.freeze('+payload+');\n',{mode:0o644});
  return out;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const path=buildPortal(process.env,process.env.PORTAL_OUTPUT_DIR||join(ROOT,'dist'));
    console.log('Portal estatico compilado (NAO implantado): '+path);
  }catch(error){
    console.error('Portal nao gerado: '+error.message);
    process.exitCode=1;
  }
}
