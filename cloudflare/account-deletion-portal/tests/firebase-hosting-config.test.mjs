import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const portal=resolve(import.meta.dirname,'..');
const settings=JSON.parse(readFileSync(
  resolve(portal,'firebase.hosting.proposed.json'),'utf8'
));
const source=readFileSync(resolve(portal,'public/_headers'),'utf8');
const main=JSON.parse(readFileSync(resolve(portal,'../../firebase.json'),'utf8'));

test('proposta Firebase Hosting isolada sem alterar o site padrão',()=>{
  assert.deepEqual(Object.keys(settings),['hosting']);
  assert.equal(settings.hosting.target,'deletionPortal');
  assert.equal(Object.hasOwn(settings.hosting,'site'),false);
  assert.equal(settings.hosting.public,'dist');
  assert.equal(Object.hasOwn(settings.hosting,'rewrites'),false);
  assert.equal(Object.hasOwn(main,'hosting'),false);
  assert.deepEqual(main.firestore,{rules:'firestore.rules',indexes:'firestore.indexes.json'});
  assert.ok(settings.hosting.ignore.includes('_headers'));
});

test('o Firebase Hosting preserva a politica de seguranca do portal',()=>{
  const matches=settings.hosting.headers;
  assert.equal(matches.length,1);
  assert.equal(matches[0].source,'**');
  const headers=Object.fromEntries(matches[0].headers.map(h=>[h.key,h.value]));
  const siteCsp=source.split('\n').find(x=>x.trim().startsWith(
    'Content-Security-Policy:'))?.trim().slice('Content-Security-Policy: '.length);
  assert.equal(headers['Content-Security-Policy'],siteCsp);
  for(const token of ["frame-ancestors 'none'","default-src 'none'","base-uri 'none'"])
    assert.ok(siteCsp.includes(token));
  assert.equal(siteCsp.includes("'unsafe-inline'"),false);
  assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(headers['X-Frame-Options'],'DENY');
  assert.equal(headers['X-Content-Type-Options'],'nosniff');
  assert.equal(headers['Referrer-Policy'],'no-referrer');
  assert.ok(headers['Permissions-Policy'].includes('geolocation=()'));
});

test('proposta sem qualquer ativacao ou deploy automatico',()=>{
  const content=readFileSync(resolve(portal,'firebase.hosting.proposed.json'),'utf8');
  assert.doesNotMatch(content,/apiKey|access_token|private_key|serviceAccount/);
  assert.equal(Object.hasOwn(settings.hosting,'predeploy'),false);
  assert.equal(Object.hasOwn(settings.hosting,'postdeploy'),false);
  assert.equal(Object.hasOwn(settings.hosting,'cleanUrls'),false);
});
