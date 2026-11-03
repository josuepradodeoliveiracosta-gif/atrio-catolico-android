/**
 * QA ONLY: actual Firebase Auth Emulator login and Admin SDK verification,
 * plus Firestore Admin SDK role/founder/freeze reads.
 *
 * Must run within firebase emulators:exec (Auth + Firestore) and with
 * FIREBASE_CONFIG unset. No credentials, production URLs, deletion,
 * IAM mutation, Worker's bindings, or real account identifiers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createFounderDeletionReadGate} from '../../../cloudflare/account-deletion-audit/src/founder-admin-read-gate.js';

const LOCAL_PROJECT='demo-atrio-v11';
const TARGET_PROJECT='atrio-catolico';
const UID='qa-founder-login-emulator-only';
const APP='qa-founder-gate-emulator-only';
const EMAIL='qa-founder-login@example.invalid';
const PASSWORD='qa-fixture-password-1234567';
const AUTH_HOST='127.0.0.1:9099';
const DB_HOST='127.0.0.1:8089';
const forbid=[
  ['project',process.env.GCLOUD_PROJECT!==LOCAL_PROJECT],
  ['auth_host',process.env.FIREBASE_AUTH_EMULATOR_HOST!==AUTH_HOST],
  ['firestore_host',process.env.FIRESTORE_EMULATOR_HOST!==DB_HOST],
  ['firebase_config',Boolean(process.env.FIREBASE_CONFIG)],
  ['google_credentials',Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)],
  ['firebase_service_account',Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)],
  ['cloud_project',Boolean(process.env.GOOGLE_CLOUD_PROJECT)],
  ['account_deletion_execution',Boolean(process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)],
  ['cloudinary_secret',Boolean(process.env.CLOUDINARY_API_SECRET)],
  ['cloudinary_key',Boolean(process.env.CLOUDINARY_API_KEY)],
  ['cloudinary_name',Boolean(process.env.CLOUDINARY_CLOUD_NAME)]
].find(([,blocked])=>blocked);
if(forbid)throw Error('qa_founder_gate_nonlocal_environment_'+forbid[0]);

test('actual Auth Emulator login plus Admin SDK founder permissions are revoked correctly',async()=>{
  // Target project name deliberately matches the production gate, but every
  // SDK is forcibly routed to the ephemeral 127.0.0.1 emulators. No prod IO.
  const app=initializeApp({projectId:TARGET_PROJECT},APP);
  const auth=getAuth(app);
  const firestore=getFirestore(app);
  // Firebase Admin Firestore returns a Google Cloud Firestore object without
  // app.options; bind an explicitly pinned SDK app, not a client-supplied one.
  const boundDb=Object.freeze({
    app,
    collection:name=>firestore.collection(name)
  });
  const adminRef=firestore.collection('admins').doc(UID);
  const founderRef=firestore.collection('app_config').doc('founder');
  const freezeRef=firestore.collection('account_deletion_freeze').doc(UID);
  let created=false;
  try {
    await auth.createUser({
      uid:UID,email:EMAIL,password:PASSWORD,
      emailVerified:true,disabled:false
    });
    created=true;
    await adminRef.set({enabled:true});
    await founderRef.set({uid:UID});
    const url='http://'+AUTH_HOST+
      '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-fake';
    const reply=await fetch(url,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:EMAIL,password:PASSWORD,returnSecureToken:true})
    });
    assert.equal(reply.status,200,'Local Auth Emulator login must succeed');
    const signedIn=await reply.json();
    assert.equal(signedIn.localId,UID);
    assert.equal(typeof signedIn.idToken,'string');
    assert.ok(signedIn.idToken.length>=100);
    // Auth Emulator JWTs end with an empty signature segment; accepting
    // their syntax is safe ONLY because verifyIdToken(...,true) checks them.
    assert.ok(signedIn.idToken.endsWith('.'));
    const gate=createFounderDeletionReadGate({
      idToken:signedIn.idToken,auth,db:boundDb
    });
    assert.equal(await gate(),true);

    // The active founder role is required on EVERY gate invocation.
    await adminRef.set({enabled:false});
    await assert.rejects(gate(),/founder_role_or_freeze_denied/);
    await adminRef.set({enabled:true});

    await founderRef.set({uid:'qa-unrelated-founder'});
    await assert.rejects(gate(),/founder_role_or_freeze_denied/);
    await founderRef.set({uid:UID});

    await freezeRef.set({uid:UID,status:'processing',scope:'qa-only'});
    await assert.rejects(gate(),/founder_role_or_freeze_denied/);
    await freezeRef.delete();

    await auth.updateUser(UID,{disabled:true});
    await assert.rejects(gate(),
      /firebase_identity_not_verified|user_disabled_or_changed/);
    await auth.updateUser(UID,{disabled:false});
    assert.equal(await gate(),true);

    await auth.revokeRefreshTokens(UID);
    await assert.rejects(gate(),/firebase_identity_not_verified/);
    // A token already revoked cannot regain access after role toggles.
    await adminRef.set({enabled:true});
    await assert.rejects(gate(),/firebase_identity_not_verified/);
  } finally {
    try{await freezeRef.delete();}catch{}
    try{await adminRef.delete();}catch{}
    try{await founderRef.delete();}catch{}
    if(created){try{await auth.deleteUser(UID);}catch{}}
    await deleteApp(app);
  }
});
