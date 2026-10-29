import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,webcrypto} from 'node:crypto';
import handler from './index.js';
if(!globalThis.crypto) globalThis.crypto=webcrypto;
const actor='trusted-admin';
const owner='review-owner';
const publicId='atrio-avatares/'+owner+'/147e7fca-2e75-4a1e-9c32-c11e19f937a7';
const token='Bearer '+'z'.repeat(150);
const jpeg=Uint8Array.from({length:400},(_,i)=>i===0||i===398?255:i===1?216:i===399?217:1);
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();

function setup(isAdmin=true) {
  const state={pending:publicId,approval:'pending',publicPhoto:null,log:[],calls:[],signedPreview:'https://res.cloudinary.com/demo/image/authenticated/s--ABCD1234--/v1780000000/'+publicId+'.jpg'};
  const env={CLOUDINARY_CLOUD_NAME:'demo',CLOUDINARY_API_KEY:'test-key',
    CLOUDINARY_API_SECRET:'test-secret',FIREBASE_WEB_API_KEY:'test-firebase',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
      project_id:'atrio-catolico',client_email:'test@atrio-catolico.iam.gserviceaccount.com',
      private_key:pem
    }),AVATAR_DB:{prepare(sql){return {
      all:async()=>({results:state.pending?[{uid:owner,public_id:state.pending,created_at:1790000000}]:[]}),
      bind(...args){return {
        first:async()=>sql.includes('FROM avatar_pending') && state.pending?
          {public_id:state.pending}:null,
        run:async()=>{
          if(sql.includes('INSERT INTO avatar_moderation')) state.log.push(args);
          if(sql.includes('DELETE FROM avatar_pending')) state.pending=null;
          return {meta:{changes:1}};
        }
      }}
    }}}
  };
  const fetchMock=async(url,options={})=>{
    const address=String(url);
    const method=options.method||'GET';
    state.calls.push({address,method});
    if(address.includes('identitytoolkit.googleapis.com'))
      return reply({users:[{localId:actor,disabled:false}]});
    if(address.includes('/documents/admins/'+actor))
      return isAdmin?reply({fields:{enabled:{booleanValue:true}}}):reply({},404);
    if(address.includes('/resources/image/authenticated/'+publicId)) {
      if(method==='POST') {
        state.approval=String(options.body.get('moderation_status'));
        assert.equal(options.headers.Authorization,'Basic '+btoa('test-key:test-secret'));
      }
      return reply({public_id:publicId,type:'authenticated',
        secure_url:state.signedPreview,version:1780000000,
        moderation:[{kind:'manual',status:state.approval}]});
    }
    if(address===state.signedPreview)
      return new Response(jpeg,{status:200,headers:{'Content-Type':'image/jpeg'}});
    if(address.includes('oauth2.googleapis.com/token'))
      return reply({access_token:'offline-token',expires_in:3600});
    if(address.includes('/profile_photos/'+owner)) {
      if(method==='GET')return state.publicPhoto?reply({fields:state.publicPhoto}):reply({},404);
      if(method==='PATCH'){
        state.publicPhoto=JSON.parse(options.body).fields;
        return reply({name:'ok'});
      }
    }
    if(address.endsWith('/image/rename'))return reply({
      public_id:publicId,type:'upload',version:1780000001});
    if(address.endsWith('/image/destroy'))return reply({result:'ok'});
    throw Error('unexpected service call: '+method+' '+address);
  };
  const call=async(path,method='GET',payload)=>{
    const headers={Authorization:token};
    if(payload)headers['Content-Type']='application/json';
    return handler.fetch(new Request('https://avatars.invalid'+path,{method,headers,
      body:payload?JSON.stringify(payload):undefined}),env);
  };
  return {state,env,fetchMock,call};
}
test('anonimo nao lista nem aprova fotos privadas',async()=>{
  const f=setup();
  const original=globalThis.fetch;
  globalThis.fetch=f.fetchMock;
  try {
    for(const [path,method] of [['/avatar/moderation/pending','GET'],
      ['/avatar/moderation/preview?uid='+owner,'GET'],
      ['/avatar/moderation/review','POST']]) {
      const r=await handler.fetch(new Request('https://avatars.invalid'+path,{method}),f.env);
      assert.equal(r.status,401);
    }
    assert.equal(f.state.calls.length,0);
  }finally{globalThis.fetch=original;}
});
test('usuario comum sem admins.enabled nao recebe fila nem preview',async()=>{
  const f=setup(false);
  const original=globalThis.fetch;
  globalThis.fetch=f.fetchMock;
  try {
    const q=await f.call('/avatar/moderation/pending');
    assert.equal(q.status,403);
    const p=await f.call('/avatar/moderation/preview?uid='+owner);
    assert.equal(p.status,403);
    const d=await f.call('/avatar/moderation/review','POST',{
      uid:owner,action:'approved',reason:'Foto adequada'});
    assert.equal(d.status,403);
    assert.equal(f.state.approval,'pending');
  }finally{globalThis.fetch=original;}
});
test('administrador pode ver fila e preview privado por Worker',async()=>{
  const f=setup();
  const original=globalThis.fetch;
  globalThis.fetch=f.fetchMock;
  try {
    const q=await f.call('/avatar/moderation/pending');
    assert.equal(q.status,200);
    assert.deepEqual((await q.json()).photos,[{uid:owner,status:'pending',createdAt:1790000000}]);
    const p=await f.call('/avatar/moderation/preview?uid='+owner);
    assert.equal(p.status,200);
    assert.equal(p.headers.get('Cache-Control'),'private, no-store, max-age=0');
    assert.equal((await p.arrayBuffer()).byteLength,400);
    assert.ok(!JSON.stringify(await (await f.call('/avatar/moderation/pending')).json())
      .includes('s--ABCD1234--'),'nunca devolver URL assinada');
  }finally{globalThis.fetch=original;}
});
test('rejeicao guarda auditoria e nunca publica a foto',async()=>{
  const f=setup();
  const original=globalThis.fetch;
  globalThis.fetch=f.fetchMock;
  try {
    const response=await f.call('/avatar/moderation/review','POST',{
      uid:owner,action:'rejected',reason:'Imagem inadequada'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).status,'rejected');
    assert.equal(f.state.publicPhoto,null);
    assert.equal(f.state.log.length,1);
    const q=await f.call('/avatar/moderation/pending');
    assert.deepEqual((await q.json()).photos,[]);
  }finally{globalThis.fetch=original;}
});
test('aprovacao pelo administrador publica sem o dono confirmar no celular',async()=>{
  const f=setup();
  const original=globalThis.fetch;
  globalThis.fetch=f.fetchMock;
  try {
    const response=await f.call('/avatar/moderation/review','POST',{
      uid:owner,action:'approved',reason:'Foto adequada'});
    assert.equal(response.status,200);
    assert.equal((await response.json()).status,'published');
    assert.equal(f.state.publicPhoto.photoPublicId.stringValue,publicId);
    assert.equal(f.state.pending,null);
    assert.equal(f.state.log.length,1);
  }finally{globalThis.fetch=original;}
});
test('decisao rejeita IDs e ações malformadas antes de tocar no Cloudinary',async()=>{
  const f=setup();
  const original=globalThis.fetch;
  globalThis.fetch=f.fetchMock;
  try {
    const r=await f.call('/avatar/moderation/review','POST',{
      uid:'../../',action:'approved',reason:'valid reason'});
    assert.equal(r.status,400);
    assert.equal(f.state.approval,'pending');
  }finally{globalThis.fetch=original;}
});
