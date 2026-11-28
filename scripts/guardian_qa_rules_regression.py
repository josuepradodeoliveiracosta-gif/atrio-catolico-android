#!/usr/bin/env python3
"""Run baseline/candidate regressions in disposable checkout only, demo emulator."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import json

ROOT=Path(__file__).resolve().parents[1]
SEC=ROOT/"tests/security"
SUITES=["contribution-badges.test.mjs","profile-v3.test.mjs","public-profile.test.mjs",
"developer-support.test.mjs","moderation.test.mjs","community-registration.test.mjs",
"feed-publications.test.mjs","cadastro-v2.test.mjs","email-verification-gate.test.mjs",
"three-bots.test.mjs","three-bots-extended.test.mjs","profile-history-legacy.test.mjs",
"profile-history-auth-query.test.mjs","reaction-emojis.test.mjs","guardian-v2.test.mjs",
"guardian-v2-flow-e2e.test.mjs"]
PROJECT="demo-atrio-v11"
BOUNDARY="demo-atrio-guardian-boundary"

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--legacy",type=Path,required=True)
    ap.add_argument("--out",type=Path,required=True)
    args=ap.parse_args()
    legacy=args.legacy.resolve()
    out=args.out.resolve()
    if not legacy.is_file() or out.exists() or out.is_relative_to(ROOT):
        raise SystemExit("private_output_required")
    if not (ROOT/".git").exists() or not (SEC/"node_modules/.bin/firebase").is_file():
        raise SystemExit("disposable_checkout_with_dependencies_required")
    env={k:v for k,v in os.environ.items() if not k.startswith("GUARDIAN_") and k not in {
        "GOOGLE_APPLICATION_CREDENTIALS","GOOGLE_OAUTH_ACCESS_TOKEN","FIREBASE_TOKEN","FIRESTORE_EMULATOR_HOST","FIREBASE_CONFIG","CLOUDSDK_AUTH_ACCESS_TOKEN"}}
    env.update({"CI":"true","GCLOUD_PROJECT":PROJECT,"GOOGLE_CLOUD_PROJECT":PROJECT})
    subprocess.run(["python3",str(ROOT/"scripts/guardian_qa_compose_rules.py"),"--legacy",str(legacy),"--boundary",str(SEC/"guardian-qa-boundary.rules"),"--out",str(out)],cwd=ROOT,env=env,check=True)
    original=ROOT/"firestore.rules"
    prepared=SEC/"firestore.rules"
    backup=original.read_bytes()
    prior=prepared.read_bytes() if prepared.exists() else None
    results={}
    def execute(project,config,command,extra=None):
        e=dict(env,GCLOUD_PROJECT=project,GOOGLE_CLOUD_PROJECT=project)
        if extra:e.update(extra)
        args=[str(SEC/"node_modules/.bin/firebase"),"emulators:exec","--config",config,"--only","firestore","--project",project,command]
        return subprocess.run(args,cwd=SEC,env=e,timeout=900).returncode
    try:
        for label,source in [("BASELINE",legacy),("CANDIDATE",out)]:
            original.write_bytes(source.read_bytes())
            prepared.write_bytes(source.read_bytes())
            print("\n"+label,flush=True)
            # Run all suites even if an earlier assertion fails. Only fixed
            # filenames, no input shell interpolation.
            command="; ".join("node "+x+"; code=$?; echo "+x+"=$code; test $code -eq 0 || failed=1" for x in SUITES)
            results[label]=execute(PROJECT,"firebase.json","failed=0; "+command+"; exit $failed")
        results["BOUNDARY"]=execute(BOUNDARY,"firebase.guardian-qa-boundary.json","node guardian-qa-boundary.test.mjs",{"GUARDIAN_QA_BOUNDARY_RULES_PATH":str(out)})
    finally:
        original.write_bytes(backup)
        if prior is None: prepared.unlink(missing_ok=True)
        else: prepared.write_bytes(prior)
    print("BASELINE_SHA256:",digest(legacy))
    print("CANDIDATE_SHA256:",digest(out))
    print("RESULTADOS:",json.dumps(results,sort_keys=True))
    print("LOCAL_ONLY; NO_GO_DEPLOY")
    return 0 if all(v==0 for v in results.values()) and len(results)==3 else 2
if __name__=="__main__":raise SystemExit(main())
