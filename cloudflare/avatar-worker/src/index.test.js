import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {boundedBytes,publicUrl,cloudSigned,uploadProtected,avatarDeletionFrozen} from './index.js';
import {createHash,webcrypto} from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const env = {
  CLOUDINARY_CLOUD_NAME:'atrio-demo',
  CLOUDINARY_API_KEY:'fake-key',
  CLOUDINARY_API_SECRET:'fake-secret',
  FIREBASE_WEB_API_KEY:'fake-firebase',
  FIREBASE_SERVICE_ACCOUNT_JSON:'{}',
  AVATAR_DB:{}
};
test('rota desconhecida não consulta serviços',async()=>{
  const r=await handler.fetch(new Request('https://test.invalid/external'),env);
  assert.equal(r.status,404);
});
test('método inválido é recusado antes de autenticar',async()=>{
  const r=await handler.fetch(new Request('https://test.invalid/avatar/upload'),env);
  assert.equal(r.status,405);
});
test('conta anônima nunca pode apagar foto',async()=>{
  const r=await handler.fetch(new Request('https://test.invalid/avatar',{method:'DELETE'}),env);
  assert.equal(r.status,401);
});
test('upload com MIME não permitido é recusado',async()=>{
  await assert.rejects(()=>boundedBytes(new Request('https://test.invalid',{method:'POST',
    headers:{'Content-Type':'image/svg+xml'},body:'<svg/>',duplex:'half'})),/invalid_image/);
});
test('upload com JPEG malformado é recusado',async()=>{
  await assert.rejects(()=>boundedBytes(new Request('https://test.invalid',{method:'POST',
    headers:{'Content-Type':'image/jpeg'},body:Uint8Array.from({length:300},()=>0),
    duplex:'half'})),/invalid_image/);
});
test('bloqueia payload com tamanho declarado acima de 5 MB',async()=>{
  await assert.rejects(()=>boundedBytes(new Request('https://test.invalid',{method:'POST',
    headers:{'Content-Type':'image/jpeg','Content-Length':String(6*1024*1024)},
    body:Uint8Array.from([0xff,0xd8,0xff,0xd9]),duplex:'half'})),/invalid_image/);
});
test('JPEG normalizado de tamanho permitido passa pela validação',async()=>{
  const photo=Uint8Array.from({length:400},(_,i)=>(i===0||i===398)?0xff:
    (i===1)?0xd8:(i===399)?0xd9:1);
  const bytes=await boundedBytes(new Request('https://test.invalid',{method:'POST',
    headers:{'Content-Type':'image/jpeg'},body:photo,duplex:'half'}));
  assert.deepEqual(bytes,photo);
});
test('URL pública usa cloud + id versionado do servidor',()=>{
  const url=publicUrl(env,{version:1740000001,
    public_id:'atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7'});
  assert.ok(url.startsWith('https://res.cloudinary.com/atrio-demo/image/upload/'));
  assert.ok(url.includes('/v1740000001/'));
});
test('rejeita identificador Cloudinary externo',()=>{
  assert.throws(()=>publicUrl(env,{version:1740000001,public_id:'outsider/avatar'}),
    /invalid_response/);
});

test('upload REST authenticated usa rota protegida e parâmetros assinados',async()=>{
  const previous=globalThis.fetch;
  let called=false;
  globalThis.fetch=async (url,options)=>{
    called=true;
    assert.equal(url,'https://api.cloudinary.com/v1_1/atrio-demo/image/authenticated');
    assert.equal(options.method,'POST');
    const p=options.body;
    assert.equal(p.get('type'),null);
    assert.equal(p.get('moderation'),'manual');
    assert.equal(p.get('public_id'),'atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7');
    assert.equal(p.get('api_key'),'fake-key');
    const input = ['moderation','overwrite','public_id','timestamp']
      .map(k=>k+'='+p.get(k)).join('&')+'fake-secret';
    assert.equal(p.get('signature'),createHash('sha1').update(input).digest('hex'));
    assert.equal(p.get('file').type,'image/jpeg');
    return new Response(JSON.stringify({type:'authenticated',public_id:p.get('public_id')}),{status:200});
  };
  try {
    const result=await cloudSigned(env,'authenticated',{
      moderation:'manual',overwrite:'false',
      public_id:'atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7'
    },Uint8Array.from([255,216,255,217]),'upload');
    assert.equal(result.type,'authenticated');
    assert.equal(called,true);
  } finally {globalThis.fetch=previous;}
});

test('Cloudinary rejeita upload sem revelar detalhes ou credenciais',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async ()=>new Response(JSON.stringify({error:{message:'Invalid Signature: sample private token'}}),{status:401});
  try {
    await assert.rejects(async()=>cloudSigned(env,'authenticated',{public_id:'atrio-avatares/qa/test',moderation:'manual'},Uint8Array.from([255,216,255,217]),'upload'),e=>{
      assert.equal(e.safeCode,'cloudinary_signature_invalid');
      assert.equal(e.message,'cloudinary_request_failed');
      assert.ok(!JSON.stringify(e).includes('private token'));
      return true;
    });
  } finally {globalThis.fetch=previous;}
});

test('Cloudinary 404 classifica ambiente inválido sem expor resposta bruta', async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Cloud name not found'}}),{status:404});
  try {
    await assert.rejects(()=>cloudSigned(env,'authenticated',{public_id:'atrio-avatares/test/abc'},Uint8Array.from([255,216,255,217]),'upload'), e=>{
      assert.equal(e.safeCode,'cloudinary_environment_not_found');
      assert.equal(e.message,'cloudinary_request_failed');return true;
    });
  }finally{globalThis.fetch=original;}
});


test('404 no endpoint protegido tenta alternativa assinada e continua privada',async()=>{
  const old=globalThis.fetch;
  const id='atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7';
  const calls=[];
  globalThis.fetch=async(url,opt)=>{
    calls.push(String(url));
    const f=opt.body;
    if(String(url).endsWith('/image/authenticated'))
      return new Response('Not Found',{status:404,headers:{'Content-Type':'text/plain'}});
    assert.equal(String(url),'https://api.cloudinary.com/v1_1/atrio-demo/image/upload');
    assert.equal(f.get('type'),'authenticated');
    const keys=['moderation','overwrite','public_id','timestamp','type'];
    const input=keys.map(k=>k+'='+f.get(k)).join('&')+'fake-secret';
    assert.equal(f.get('signature'),createHash('sha1').update(input).digest('hex'));
    return new Response(JSON.stringify({type:'authenticated',public_id:id,
      moderation:[{kind:'manual',status:'pending'}]}),{status:200});
  };
  try{
    const result=await uploadProtected(env,id,Uint8Array.from([255,216,255,217]));
    assert.equal(result.type,'authenticated');
    assert.equal(calls.length,2);
  } finally{ globalThis.fetch=old; }
});
test('fallback nunca aceita foto pública e tenta removê-la imediatamente',async()=>{
  const old=globalThis.fetch;
  const id='atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7';
  let destroyed=false;
  globalThis.fetch=async(url,opt)=>{
    const path=String(url);
    if(path.endsWith('/image/authenticated'))
      return new Response('Not Found',{status:404});
    if(path.endsWith('/image/upload'))
      return new Response(JSON.stringify({type:'upload',public_id:id}),{status:200});
    if(path.endsWith('/image/destroy')){
      destroyed=true;
      assert.equal(opt.body.get('type'),'upload');
      return new Response(JSON.stringify({result:'ok'}),{status:200});
    }
    throw Error('Unexpected endpoint '+path);
  };
  try{
    await assert.rejects(()=>uploadProtected(env,id,Uint8Array.from([255,216,255,217])),
      /cloudinary_protection_failed/);
    assert.equal(destroyed,true);
  } finally{ globalThis.fetch=old; }
});

test('freeze do avatar permite somente marcador ausente (HTTP 404)',async()=>{
  const old=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async(url,options)=>{
    seen.push({url:String(url),authorization:options?.headers?.Authorization});
    return new Response('{}',{status:404});
  };
  try{
    assert.equal(await avatarDeletionFrozen('fake-qa-service','qa-bob'),false);
    assert.deepEqual(seen,[{url:'https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/account_deletion_freeze/qa-bob',
      authorization:'Bearer fake-qa-service'}]);
  }finally{globalThis.fetch=old;}
});
test('freeze do avatar bloqueia uid marcado antes do efeito externo',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.ok(String(url).endsWith('/account_deletion_freeze/qa-alice'));
    return Response.json({fields:{status:{stringValue:'draining'}}});
  };
  try{assert.equal(await avatarDeletionFrozen('fake-qa-service','qa-alice'),true);}
  finally{globalThis.fetch=old;}
});
test('freeze do avatar nega falhas HTTP e UID forjado sem chamadas adicionais',async()=>{
  const old=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:503});};
  try{
    await assert.rejects(()=>avatarDeletionFrozen('fake','../admin'),/invalid_scope/);
    await assert.rejects(()=>avatarDeletionFrozen('', 'qa-alice'),/invalid_scope/);
    assert.equal(calls,0);
    for(const status of [401,403,429,500,503]){
      globalThis.fetch=async()=>{calls++;return new Response('{}',{status});};
      await assert.rejects(()=>avatarDeletionFrozen('fake','qa-alice'),/freeze_check_unavailable/);
    }
    assert.equal(calls,5);
  }finally{globalThis.fetch=old;}
});


// Exercita o handler real e a checagem REST do Firestore, com serviços
// simulados em memória. Chaves RSA são sintéticas e geradas no próprio teste.
async function qaAvatarStatusFixture(freezeStates){
  const key=await webcrypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
  },true,['sign','verify']);
  const pkcs8=await webcrypto.subtle.exportKey('pkcs8',key.privateKey);
  const pem='-----BEGIN PRIVATE KEY-----\\n'+Buffer.from(pkcs8).toString('base64')+
    '\\n-----END PRIVATE KEY-----';
  const uid='qa-alice';
  const id='atrio-avatares/'+uid+'/147e7fca-2e75-4a1e-9c32-c11e19f937a7';
  const events=[];
  let locks=0,unlocks=0,freezeReads=0,patches=0,renames=0,destroys=0,pendingDeletes=0;
  const qaEnv={...env,FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
    project_id:'atrio-catolico',client_email:'qa-only@atrio.invalid',
    private_key:pem
  }),AVATAR_DB:{
    prepare(sql){
      return {bind(...args){
        return {
          async first(){
            assert.match(sql,/SELECT public_id FROM avatar_pending/);
            assert.equal(args[0],uid);
            return {public_id:id};
          },
          async run(){
            if(sql.startsWith('INSERT INTO avatar_mutex'))locks++;
            else if(sql.startsWith('DELETE FROM avatar_mutex'))unlocks++;
            else if(sql.startsWith('DELETE FROM avatar_pending'))pendingDeletes++;
            else throw Error('unexpected_d1_write');
            return {meta:{changes:1}};
          }
        };
      }};
    }
  }};
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const value=String(url);events.push(value);
    if(value.startsWith('https://identitytoolkit.googleapis.com/'))
      return Response.json({users:[{localId:uid,disabled:false}]});
    if(value==='https://oauth2.googleapis.com/token')
      return Response.json({access_token:'qa-fake-oauth',expires_in:3600});
    if(value.includes('/account_deletion_freeze/')){
      assert.ok(value.endsWith('/'+uid));
      return new Response('{}',{status:freezeStates[freezeReads++]??200});
    }
    if(value.includes('/resources/image/authenticated/'))
      return Response.json({type:'authenticated',public_id:id,
        moderation:[{kind:'manual',status:'approved'}]});
    if(value.includes('/image/rename')){
      renames++;
      return Response.json({type:'upload',public_id:id,version:1740000001});
    }
    if(value.includes('/profile_photos/')){
      if(options.method==='PATCH'){patches++;return Response.json({});}
      return new Response('{}',{status:404});
    }
    if(value.includes('/image/destroy')){
      destroys++;
      assert.equal(options.body.get('type'),'upload');
      return Response.json({result:'ok'});
    }
    throw Error('Unexpected QA external endpoint');
  };
  try{
    const response=await handler.fetch(new Request(
      'https://test.invalid/avatar/status',{method:'POST',
        headers:{Authorization:'Bearer '+'q'.repeat(150)}}),qaEnv);
    return {status:response.status,body:await response.json(),events,
      locks,unlocks,freezeReads,patches,renames,destroys,pendingDeletes};
  }finally{globalThis.fetch=previous;}
}
test('status: freeze after remote Cloudinary read blocks public promotion',async()=>{
  // 2 entry-point checks (before/after D1 lock), then freeze after get.
  const result=await qaAvatarStatusFixture([404,404,200]);
  assert.equal(result.status,409);
  assert.equal(result.body.status,'account_deletion_in_progress');
  assert.equal(result.renames,0);
  assert.equal(result.patches,0);
  assert.equal(result.pendingDeletes,0);
  assert.equal(result.locks,1);
  assert.equal(result.unlocks,1);
});
test('status: freeze during promotion compensates public image without profile write',async()=>{
  // The owner freezes during Cloudinary rename / profile retrieval.
  const result=await qaAvatarStatusFixture([404,404,404,200]);
  assert.equal(result.status,409);
  assert.equal(result.body.status,'account_deletion_in_progress');
  assert.equal(result.renames,1);
  assert.equal(result.destroys,1);
  assert.equal(result.patches,0);
  assert.equal(result.pendingDeletes,0);
  assert.equal(result.locks,1);
  assert.equal(result.unlocks,1);
});
