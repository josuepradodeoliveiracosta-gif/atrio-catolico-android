import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {collection,doc,setDoc,getDoc,getDocs,updateDoc,deleteDoc,query,where,serverTimestamp} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
const alice=env.authenticatedContext('alice').firestore();
const bob=env.authenticatedContext('bob').firestore();
const admin=env.authenticatedContext('admin').firestore();
let passed=0;
async function check(name,fn){await fn();passed++;console.log('GUARDIAN V2 PASS',name);}
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   await setDoc(doc(db,'admins/admin'),{enabled:true});
   await setDoc(doc(db,'guardian_config/policy'),{enabled:false,allowHold:false,emergencyStop:true});
   await setDoc(doc(db,'guardian_cases/guard_example'),{ownerUid:'alice',status:'review',ruleCode:'personal_data'});
   await setDoc(doc(db,'guardian_cases/guard_other'),{ownerUid:'bob',status:'review',ruleCode:'possible_threat'});
   await setDoc(doc(db,'guardian_notices/alice/items/c1'),{body:'Aviso',caseId:'guard_example'});
   await setDoc(doc(db,'guardian_audit/a1'),{actor:'guardian_v2',event:'review'});
   await setDoc(doc(db,'guardian_runtime/last_scan'),{state:'qa_only'});
 });
 await check('cliente lê apenas o seu caso',async()=>{await assertSucceeds(getDoc(doc(alice,'guardian_cases/guard_example')));await assertFails(getDoc(doc(alice,'guardian_cases/guard_other')));});
 await check('consulta proprietária requer filtro',()=>assertSucceeds(getDocs(query(collection(alice,'guardian_cases'),where('ownerUid','==','alice')))));
 await check('não pode listar casos de outros proprietários',()=>assertFails(getDocs(collection(alice,'guardian_cases'))));
 await check('admin ativo lê fila inteira',()=>assertSucceeds(getDocs(collection(admin,'guardian_cases'))));
 await check('apenas admin consulta configuração',async()=>{await assertFails(getDoc(doc(alice,'guardian_config/policy')));await assertSucceeds(getDoc(doc(admin,'guardian_config/policy')));});
 await check('usuário não ativa moderação por conta própria',()=>assertFails(updateDoc(doc(alice,'guardian_config/policy'),{enabled:true})));
 await check('nem admin do APK pode mudar configuração',()=>assertFails(updateDoc(doc(admin,'guardian_config/policy'),{enabled:true})));
 await check('usuário não cria decisão nem alerta falso',async()=>{await assertFails(setDoc(doc(alice,'guardian_cases/c2'),{ownerUid:'alice'}));await assertFails(setDoc(doc(alice,'guardian_notices/alice/items/c2'),{body:'Falso'}));});
 await check('usuário não elimina trilha de auditoria',async()=>{await assertFails(deleteDoc(doc(alice,'guardian_audit/a1')));await assertFails(deleteDoc(doc(admin,'guardian_audit/a1')));});
 await check('auditoria restrita a administradores',async()=>{await assertFails(getDoc(doc(alice,'guardian_audit/a1')));await assertSucceeds(getDoc(doc(admin,'guardian_audit/a1')));});
 await check('notificação somente do destinatário',async()=>{await assertSucceeds(getDoc(doc(alice,'guardian_notices/alice/items/c1')));await assertFails(getDoc(doc(bob,'guardian_notices/alice/items/c1')));});
 await check('usuário não modifica avisos do servidor',()=>assertFails(updateDoc(doc(alice,'guardian_notices/alice/items/c1'),{body:'Alterado'})));
 await check('conta comum não pode conceder cargo administrativo ou consultar isolamento',async()=>{
   await assertFails(setDoc(doc(alice,'admins/alice'),{enabled:true}));
   await assertFails(updateDoc(doc(admin,'admins/admin'),{enabled:false}));
   await assertFails(getDoc(doc(alice,'admins/admin')));
   await assertFails(getDoc(doc(alice,'guardian_runtime/last_scan')));
   await assertFails(getDocs(collection(bob,'guardian_audit')));
 });
 await check('recurso de autoria é único, sem permitir alterar ou eliminar retenção',async()=>{
   await env.withSecurityRulesDisabled(async c=>{
     await setDoc(doc(c.firestore(),'guardiao_quarantine/guard_qa_appeal'),{
       ownerUid:'alice',status:'held',reason:'Ensaio sintético de QA',
       targetType:'reply',originalFields:{uid:'alice',body:'Texto de QA'},
       createdAt:'2026-10-30T00:00:00Z'
     });
   });
   const ref=doc(alice,'guardiao_quarantine/guard_qa_appeal');
   await assertSucceeds(getDoc(ref));
   await assertFails(getDoc(doc(bob,'guardiao_quarantine/guard_qa_appeal')));
   await assertFails(updateDoc(ref,{status:'restored'}));
   await assertFails(updateDoc(ref,{appealText:'Texto válido de recurso mas altera também status',status:'removed'}));
   await assertSucceeds(updateDoc(ref,{
     appealText:'Peço revisão humana: é uma simulação de QA.',
     appealedAt:serverTimestamp()
   }));
   await assertFails(updateDoc(ref,{
     appealText:'Nova contestação não permitida neste caso.',
     appealedAt:serverTimestamp()
   }));
   await assertFails(deleteDoc(ref));
 });
 await check('revogação de administrador bloqueia imediatamente acesso ao painel e auditoria',async()=>{
   // Revogação somente pelo contexto privilegiado do emulador,
   // nunca por usuário, APK, Worker remoto ou Firebase real.
   await assertSucceeds(getDoc(doc(admin,'guardian_config/policy')));
   await assertSucceeds(getDocs(collection(admin,'guardian_cases')));
   await assertSucceeds(getDoc(doc(admin,'guardian_audit/a1')));
   await assertSucceeds(getDoc(doc(admin,'guardian_runtime/last_scan')));
   await assertSucceeds(getDoc(doc(admin,'guardiao_quarantine/guard_qa_appeal')));
   await env.withSecurityRulesDisabled(async c=>{
     await updateDoc(doc(c.firestore(),'admins/admin'),{enabled:false});
   });
   await assertFails(getDoc(doc(admin,'guardian_config/policy')));
   await assertFails(getDocs(collection(admin,'guardian_cases')));
   await assertFails(getDoc(doc(admin,'guardian_cases/guard_example')));
   await assertFails(getDoc(doc(admin,'guardian_audit/a1')));
   await assertFails(getDoc(doc(admin,'guardian_runtime/last_scan')));
   await assertFails(getDoc(doc(admin,'guardiao_quarantine/guard_qa_appeal')));
   await assertFails(updateDoc(doc(admin,'guardian_config/policy'),{enabled:true}));
   await assertFails(updateDoc(doc(admin,'admins/admin'),{enabled:true}));
   // A própria conta continua podendo reconhecer que foi revogada.
   const self=await assertSucceeds(getDoc(doc(admin,'admins/admin')));
   assert.equal(self.data().enabled,false);
   // O autor conserva seu recurso legítimo após revogação da equipe.
   assert.equal((await getDoc(doc(alice,'guardiao_quarantine/guard_qa_appeal'))).exists(),true);
 });
 console.log('GUARDIAN V2 RULES:',passed,'cases');
}finally{await env.cleanup();}
