import test from 'node:test';
import assert from 'node:assert/strict';
import handler, {boundedBytes,publicUrl,cloudSigned} from './index.js';
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

test('API autenticada usa endpoint upload oficial e parâmetros assinados',async()=>{
  const previous=globalThis.fetch;
  let called=false;
  globalThis.fetch=async (url,options)=>{
    called=true;
    assert.equal(url,'https://api.cloudinary.com/v1_1/atrio-demo/image/upload');
    assert.equal(options.method,'POST');
    const p=options.body;
    assert.equal(p.get('type'),'authenticated');
    assert.equal(p.get('moderation'),'manual');
    assert.equal(p.get('public_id'),'atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7');
    assert.equal(p.get('api_key'),'fake-key');
    const input = ['moderation','overwrite','public_id','timestamp','type']
      .map(k=>k+'='+p.get(k)).join('&')+'fake-secret';
    assert.equal(p.get('signature'),createHash('sha1').update(input).digest('hex'));
    assert.equal(p.get('file').type,'image/jpeg');
    return new Response(JSON.stringify({type:'authenticated',public_id:p.get('public_id')}),{status:200});
  };
  try {
    const result=await cloudSigned(env,'upload',{
      type:'authenticated',moderation:'manual',overwrite:'false',
      public_id:'atrio-avatares/test-user/147e7fca-2e75-4a1e-9c32-c11e19f937a7'
    },Uint8Array.from([255,216,255,217]),'upload');
    assert.equal(result.type,'authenticated');
    assert.equal(called,true);
  } finally {globalThis.fetch=previous;}
});
