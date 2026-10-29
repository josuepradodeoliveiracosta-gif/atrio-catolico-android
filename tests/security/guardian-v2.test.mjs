import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {collection,doc,setDoc,getDoc,getDocs,updateDoc,deleteDoc,query,where} from 'firebase/firestore';
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
 console.log('GUARDIAN V2 RULES:',passed,'cases');
}finally{await env.cleanup();}
