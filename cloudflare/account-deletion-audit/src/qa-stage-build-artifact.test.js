import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  inspectQaWorkerSourceGraph,createQaWorkerSourceArtifact,
  verifyQaWorkerSourceArtifact
} from '../../privacy-freeze-stage/scripts/build-offline.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const SHA='a22cbecd4326552c4f59cc08c4aa55a0cd467859';
const workspace=()=>mkdtempSync(join(tmpdir(),'atrio-qa-artifact-'));
test('source graph is deterministic and contains only reviewed Worker modules',()=>{
  const a=inspectQaWorkerSourceGraph({repoRoot:root,sourceCommit:SHA});
  const b=inspectQaWorkerSourceGraph({repoRoot:root,sourceCommit:SHA});
  assert.equal(a.graphSha256,b.graphSha256);
  assert.equal(a.entry,'privacy-freeze-stage/src/index.js');
  assert.ok(a.moduleCount>=8);
  assert.ok(a.modules.some(x=>x.path==='account-deletion-audit/src/qa-privileged-write-barrier.js'));
  assert.ok(a.modules.some(x=>x.path==='privacy-freeze-stage/src/client.js')===false);
  assert.ok(a.modules.every(x=>x.path.startsWith('privacy-freeze-stage/src/')||
    x.path.startsWith('account-deletion-audit/src/')));
  assert.equal(a.deployAuthorized,false);
});
test('offline package copies byte-exact sources, verifies manifest, never includes secrets',()=>{
  const tmp=workspace();
  try{
    const out=join(tmp,'stage-package');
    const manifest=createQaWorkerSourceArtifact({
      repoRoot:root,sourceCommit:SHA,outDir:out
    });
    const checked=verifyQaWorkerSourceArtifact({outDir:out});
    assert.equal(checked.valid,true);
    assert.equal(checked.graphSha256,manifest.graphSha256);
    assert.equal(checked.moduleCount,manifest.moduleCount);
    assert.equal(checked.deployAuthorized,false);
    assert.equal(manifest.productionAuthorized,false);
    const json=JSON.stringify(manifest);
    assert.equal(json.includes('STAGE_ADMIN_HMAC'),false);
    assert.equal(json.includes('database_id'),false);
    assert.equal(json.includes('wrangler.toml'),false);
    assert.throws(()=>createQaWorkerSourceArtifact({
      repoRoot:root,sourceCommit:SHA,outDir:out
    }),/output_directory_must_not_exist/);
    const copy=manifest.modules[0];
    writeFileSync(join(out,'modules',copy.path),'tampered');
    assert.throws(()=>verifyQaWorkerSourceArtifact({outDir:out}),
      /artifact_integrity_mismatch/);
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
test('unknown import, real-account code import and dynamic import all abort build',()=>{
  const tmp=workspace();
  try{
    const stage=join(tmp,'cloudflare/privacy-freeze-stage/src');
    mkdirSync(stage,{recursive:true});
    const path=join(stage,'index.js');
    for(const [source,error] of [
      ["import secret from 'firebase-admin';\n",/external_import_denied/],
      ["import foo from '../../push-worker/src/index.js';\n",
        /dependency_not_on_allowlist/],
      ["const foo=import('./remote.js');\n",/dynamic_or_opaque_import/],
      ["import foo from '../../../../escape.js';\n",/dependency_outside_root/]
    ]){
      writeFileSync(path,source);
      assert.throws(()=>inspectQaWorkerSourceGraph({
        repoRoot:tmp,sourceCommit:SHA
      }),error);
    }
    assert.throws(()=>inspectQaWorkerSourceGraph({
      repoRoot:tmp,sourceCommit:'not-a-commit'
    }),/invalid_input/);
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
test('unexpected files cannot be smuggled into a reviewed QA package',()=>{
  const tmp=workspace();
  try{
    const out=join(tmp,'stage-package');
    createQaWorkerSourceArtifact({repoRoot:root,sourceCommit:SHA,outDir:out});
    writeFileSync(join(out,'modules/UNREVIEWED.js'),'export default {};');
    assert.throws(()=>verifyQaWorkerSourceArtifact({outDir:out}),
      /unexpected_module_file/);
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
