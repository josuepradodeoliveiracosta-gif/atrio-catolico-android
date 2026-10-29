// Simulação offline de ponta a ponta: Firebase Auth, Firestore IAM, Cloudinary e D1.
// Nenhuma credencial, serviço ou imagem real é utilizada nos testes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,webcrypto} from 'node:crypto';
import handler from './index.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const userId = 'qa-member';
const bearer = 'Bearer ' + 'a'.repeat(120);
const assetPrefix = 'atrio-avatares/' + userId + '/';
const {privateKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const pem = privateKey.export({type:'pkcs8',format:'pem'}).toString();
const json = (data,status=200) => new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json'}
});

function fixture() {
  const events = [];
  const state = {pending:null,publicPhoto:null,cloudId:null,approval:'pending',rate:0,failNextUpload:false};
  const db = {
    prepare(statement) {
      return {
        bind(...args) {
          return {
            async first() {
              if(statement.includes('FROM avatar_pending')) {
                return state.pending ? {public_id:state.pending} : null;
              }
              return null;
            },
            async run() {
              if(statement.includes('INSERT INTO avatar_rate')) {
                state.rate++;
                return {meta:{changes:state.rate===1?1:0}};
              }
              if(statement.includes('INSERT INTO avatar_pending')) {
                state.pending=args[1];
                return {meta:{changes:1}};
              }
              if(statement.includes('DELETE FROM avatar_pending')) {
                if(!statement.includes('AND public_id') || state.pending===args[1])
                  state.pending=null;
                return {meta:{changes:1}};
              }
              return {meta:{changes:1}};
            }
          };
        }
      };
    }
  };
  const env = {
    CLOUDINARY_CLOUD_NAME:'test-environment',
    CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret',
    FIREBASE_WEB_API_KEY:'test-firebase-key',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
      project_id:'atrio-catolico',
      client_email:'test@atrio-catolico.iam.gserviceaccount.com',
      private_key:pem
    }), AVATAR_DB:db
  };
  const response = async (url,options={}) => {
    const endpoint=String(url);
    const method=options.method||'GET';
    events.push({endpoint,method});
    if(endpoint.includes('identitytoolkit.googleapis.com'))
      return json({users:[{localId:userId,disabled:false}]});
    if(endpoint.includes('oauth2.googleapis.com/token'))
      return json({access_token:'offline-iam-token',expires_in:3600});
    if(endpoint.endsWith('/image/authenticated') && method==='POST') {
      if(state.failNextUpload) { state.failNextUpload=false; return json({error:'simulated'},503); }
      const form=options.body;
      assert.equal(form.get('type'),null);
      assert.equal(form.get('moderation'),'manual');
      assert.equal(form.get('api_key'),'test-key');
      const id=form.get('public_id');
      assert.ok(id.startsWith(assetPrefix));
      state.cloudId=id;
      return json({type:'authenticated',public_id:id,version:1780000000});
    }
    if(endpoint.includes('/resources/image/authenticated/')) {
      if(!state.cloudId) return json({error:'missing'},404);
      return json({public_id:state.cloudId,
        moderation:[{kind:'manual',status:state.approval}]});
    }
    if(endpoint.endsWith('/image/rename') && method==='POST') {
      const form=options.body;
      assert.equal(form.get('from_public_id'),state.cloudId);
      assert.equal(form.get('to_public_id'),state.cloudId);
      assert.equal(form.get('to_type'),'upload');
      assert.equal(form.get('type'),'authenticated');
      return json({type:'upload',public_id:state.cloudId,version:1780000001});
    }
    if(endpoint.endsWith('/image/destroy') && method==='POST')
      return json({result:'ok'});
    if(endpoint.endsWith('/profile_photos/'+userId)) {
      if(method==='GET')
        return state.publicPhoto ? json({fields:state.publicPhoto}):json({error:'missing'},404);
      if(method==='PATCH') {
        state.publicPhoto=JSON.parse(options.body).fields;
        return json({name:'saved'});
      }
      if(method==='DELETE') {
        state.publicPhoto=null;
        return json({});
      }
    }
    throw new Error('Unexpected request: '+method+' '+endpoint);
  };
  const call = async (path,method,body=null) => {
    const init={method,headers:{Authorization:bearer}};
    if(body) {
      init.headers['Content-Type']='image/jpeg';
      init.body=body;
    }
    const result=await handler.fetch(new Request('https://avatars.invalid'+path,init),env);
    return {status:result.status,body:(await result.json()).status};
  };
  return {state,events,response,call};
}

test('dois estados de moderação: envio privado, aprovação pública e remoção',async()=>{
  const oldFetch=globalThis.fetch;
  const f=fixture();
  globalThis.fetch=f.response;
  try {
    const image=Uint8Array.from({length:400},(_,i)=>
      i===0||i===398?255:i===1?216:i===399?217:1);
    const sent=await f.call('/avatar/upload','POST',image);
    assert.deepEqual(sent,{status:202,body:'pending_moderation'});
    assert.equal(f.state.publicPhoto,null,'uma foto pendente não é visível no Firestore');
    assert.ok(f.state.pending.startsWith(assetPrefix));
    const pending=await f.call('/avatar/status','POST');
    assert.deepEqual(pending,{status:200,body:'pending_moderation'});
    assert.equal(f.state.publicPhoto,null);
    f.state.approval='approved';
    const approved=await f.call('/avatar/status','POST');
    assert.deepEqual(approved,{status:200,body:'published'});
    assert.ok(f.state.publicPhoto.photoUrl.stringValue.startsWith(
      'https://res.cloudinary.com/test-environment/image/upload/'));
    assert.equal(f.state.publicPhoto.photoPublicId.stringValue,f.state.cloudId);
    assert.equal(f.state.pending,null);
    const removed=await f.call('/avatar','DELETE');
    assert.deepEqual(removed,{status:200,body:'removed'});
    assert.equal(f.state.publicPhoto,null);
    assert.ok(f.events.some(e=>e.endpoint.endsWith('/image/destroy')));
  } finally {globalThis.fetch=oldFetch;}
});


test('troca preserva foto aprovada se novo envio falhar ou for rejeitado',async()=>{
  const oldFetch=globalThis.fetch;
  const f=fixture();
  globalThis.fetch=f.response;
  try {
    const image=Uint8Array.from({length:400},(_,i)=>
      i===0||i===398?255:i===1?216:i===399?217:1);
    assert.deepEqual(await f.call('/avatar/upload','POST',image),
      {status:202,body:'pending_moderation'});
    f.state.approval='approved';
    assert.deepEqual(await f.call('/avatar/status','POST'),
      {status:200,body:'published'});
    const first=f.state.publicPhoto.photoPublicId.stringValue;
    const firstUrl=f.state.publicPhoto.photoUrl.stringValue;

    // O primeiro upload seguinte falha no Cloudinary; foto aprovada é intocada.
    f.state.rate=0;
    f.state.failNextUpload=true;
    const unavailable=await f.call('/avatar/upload','POST',image);
    assert.deepEqual(unavailable,{status:503,body:'temporarily_unavailable'});
    assert.equal(f.state.publicPhoto.photoPublicId.stringValue,first);
    assert.equal(f.state.pending,null);

    f.state.rate=0;
    f.state.approval='pending';
    assert.deepEqual(await f.call('/avatar/upload','POST',image),
      {status:202,body:'pending_moderation'});
    const second=f.state.pending;
    assert.notEqual(first,second);
    assert.equal(f.state.publicPhoto.photoUrl.stringValue,firstUrl,
      'a foto original permanece visível enquanto a moderação decide');

    f.state.approval='rejected';
    assert.deepEqual(await f.call('/avatar/status','POST'),
      {status:200,body:'rejected'});
    assert.equal(f.state.publicPhoto.photoPublicId.stringValue,first);

    // Se o moderador posteriormente reverter a decisão, só então publica.
    f.state.approval='approved';
    assert.deepEqual(await f.call('/avatar/status','POST'),
      {status:200,body:'published'});
    assert.equal(f.state.publicPhoto.photoPublicId.stringValue,second);
    assert.ok(f.events.some(e=>e.endpoint.endsWith('/image/destroy')));
    assert.equal(f.state.pending,null);
  } finally {globalThis.fetch=oldFetch;}
});

test('solicitação sem token nunca altera estado de perfil',async()=>{
  const oldFetch=globalThis.fetch;
  const f=fixture();
  globalThis.fetch=f.response;
  try {
    const r=await handler.fetch(new Request('https://avatars.invalid/avatar',
      {method:'DELETE'}),{
      CLOUDINARY_CLOUD_NAME:'test-environment',
      CLOUDINARY_API_KEY:'test-key',
      CLOUDINARY_API_SECRET:'test-secret',
      FIREBASE_WEB_API_KEY:'test-firebase-key',
      FIREBASE_SERVICE_ACCOUNT_JSON:'{}',
      AVATAR_DB:{}
    });
    assert.equal(r.status,401);
    assert.equal(f.state.publicPhoto,null);
    assert.equal(f.events.length,0);
  } finally {globalThis.fetch=oldFetch;}
});
