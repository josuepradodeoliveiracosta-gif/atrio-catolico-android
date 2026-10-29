import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,cpfValid,safeNotice} from './policy.js';
import {processDocument,scanOnce,settingsOf,handleRequest} from './index.js';
import {caseId,ROOT,str} from './firestore.js';
const mkDoc=(path,text,extra={})=>({name:ROOT+'/'+path,updateTime:'2026-10-29T18:00:01.000000Z',fields:{uid:str('alice'),createdAt:{timestampValue:'2026-10-29T17:59:00.000000Z'},body:str(text),...(path.split('/').length===2?{title:str('Título de discussão')}:{}) ,...extra}});
class FakeStore{
  constructor(entries=[]){this.docs=new Map(entries.map(d=>[d.name,structuredClone(d)]));this.calls=0;}
  async commit(writes){this.calls++;
    for(const w of writes){let name=w.update?.name||w.delete;let current=this.docs.get(name);
      if(w.currentDocument?.exists===false&&current){const e=Error('exists');e.status=409;throw e;}
      if(w.currentDocument?.updateTime&&current?.updateTime!==w.currentDocument.updateTime){const e=Error('conflict');e.status=409;throw e;}
    }
    for(const w of writes){let name=w.update?.name||w.delete;
      if(w.delete){this.docs.delete(name);continue;}
      const old=this.docs.get(name);const d={name,updateTime:'2026-10-29T18:10:00.000000Z',fields:{...(old?.fields||{}),...w.update.fields}};
      this.docs.set(name,d);
    }
    return {};
  }
  get(path){return this.docs.get(ROOT+'/'+path)||null;}
  scan(group){return [...this.docs.values()].filter(d=>d.name.includes('/'+group+'/')).filter(d=>d.name.startsWith(ROOT+'/posts/'));}
}
const enabled={enabled:true,allowHold:false};
test('expressão religiosa legítima não gera infração',()=>assert.equal(classify('O Evangelho narra a perseguição dos mártires; qual o significado?').level,'clear'));
test('discussão teológica não é punida por divergência',()=>assert.equal(classify('Discordo da interpretação de um texto do catecismo.').level,'clear'));
test('CPF válido é um alerta, não punição automática',()=>{assert.equal(cpfValid('52998224725'),true);assert.equal(classify('Meu CPF 529.982.247-25').level,'review');});
test('CPF inválido não é prova automática',()=>assert.equal(classify('000.000.000-00').level,'clear'));
test('ameaça direta vai à análise humana',()=>assert.equal(classify('Vou te matar amanhã').level,'review'));
test('relato de ameaça é contextual',()=>assert.equal(classify('Ele me ameaçou e disse vou te matar').level,'clear'));
test('golpe explícito cria candidato restrito',()=>assert.equal(classify('Clique https://exemplo.invalid para informar sua senha').level,'hold_candidate'));
test('links abusivos geram advertência educativa',()=>assert.equal(classify('http://a.test http://b.test http://c.test http://d.test').level,'warning'));
test('denúncias falsas não contam como infração',()=>assert.equal(classify('Olá irmãos!',{reports:9000}).level,'clear'));
test('reincidência não dispara banimento',()=>assert.equal(classify('Olá',{duplicateCount:12,confirmedInfractions:15}).level,'warning'));
test('notificações são genéricas e não vazam os dados originais',()=>assert.ok(!JSON.stringify(safeNotice('personal_data','review')).includes('52998224725')));
test('duplo desligamento mantém o motor inativo',()=>{assert.equal(settingsOf({fields:{enabled:{booleanValue:true}}},{GUARDIAN_V2_ENABLED:'false'}).enabled,false);assert.equal(settingsOf({fields:{enabled:{booleanValue:true},emergencyStop:{booleanValue:true}}},{GUARDIAN_V2_ENABLED:'true'}).enabled,false);});
test('modo padrão registra caso de revisão e preserva resposta',async()=>{
 const doc=mkDoc('posts/p1/replies/r1','Clique https://exemplo.invalid e informe sua senha');const db=new FakeStore([doc]);
 assert.equal(await processDocument(db,doc,enabled),'review');assert.ok(db.docs.has(doc.name));
 assert.ok(db.docs.has(ROOT+'/guardian_cases/'+await caseId('posts/p1/replies/r1')));
 assert.ok(db.docs.has(ROOT+'/guardian_notices/alice/items/'+await caseId('posts/p1/replies/r1')));
});
test('evento duplicado não duplica alerta e mantém cópia original',async()=>{
 const doc=mkDoc('posts/p1/replies/r2','Clique https://exemplo.invalid para enviar senha');const db=new FakeStore([doc]);await processDocument(db,doc,enabled);
 assert.equal(await processDocument(db,doc,enabled),'duplicate_or_changed');assert.ok(db.docs.has(doc.name));
});
test('retenção precisa de autorização dupla e só age sobre resposta',async()=>{
 const post=mkDoc('posts/p1','Clique https://exemplo.invalid para informar sua senha');const reply=mkDoc('posts/p1/replies/r3','Clique https://exemplo.invalid para informar sua senha');const db=new FakeStore([post,reply]);
 assert.equal(await processDocument(db,reply,{enabled:true,allowHold:true}),'hold');
 assert.equal(db.docs.has(reply.name),false);assert.ok(db.docs.has(ROOT+'/guardiao_quarantine/'+await caseId('posts/p1/replies/r3')));
 assert.equal(await processDocument(db,post,{enabled:true,allowHold:true}),'review');assert.ok(db.docs.has(post.name));
});
test('falha no commit não apaga conteúdo nem cria casos parciais',async()=>{
 const doc=mkDoc('posts/p1/replies/r4','Clique https://exemplo.invalid para enviar senha');const db=new FakeStore([doc]);db.commit=async()=>{throw Error('offline')};
 await assert.rejects(processDocument(db,doc,{enabled:true,allowHold:true}));assert.ok(db.docs.has(doc.name));assert.equal(db.docs.size,1);
});
test('concorrência com edição mais recente impede retenção',async()=>{
 const doc=mkDoc('posts/p1/replies/r5','Clique https://exemplo.invalid para enviar senha');const db=new FakeStore([doc]);const old=structuredClone(doc);
 db.docs.get(doc.name).updateTime='2026-10-29T18:05:01.000000Z';
 assert.equal(await processDocument(db,old,{enabled:true,allowHold:true}),'duplicate_or_changed');assert.ok(db.docs.has(doc.name));
});
test('sem ativação o scanner não consulta o banco',async()=>{const db=new FakeStore();assert.deepEqual(await scanOnce(db,{enabled:false}),{status:'disabled'});assert.equal(db.calls,0);});
test('endpoint público não permite configurar ou decidir',async()=>{const response=await handleRequest(new Request('https://example.com/admin/config',{method:'POST',body:'{}'}),{});assert.equal(response.status,503);});