#!/usr/bin/env python3
"""Read the deployed QA Rules using short-lived read-only WIF; test locally.
No remote Firestore data/Auth calls, publication, artifact or source logging.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request
import urllib.error
from guardian_qa_prepare_disabled_identities import snapshot, PROJECT, NUMBER, RULES, NoRedirect, Stop

REPO="josuepradodeoliveiracosta-gif/atrio-catolico-android"
REF="refs/heads/qa/guardian-validation-no-apk"
WORKFLOW=REPO+"/.github/workflows/guardiao-v2-qa-wif-manual.yml@"+REF
BILLING=f"https://cloudbilling.googleapis.com/v1/projects/{PROJECT}/billingInfo"
ROOT=Path(__file__).resolve().parents[1]
EXPECTED={"GITHUB_REPOSITORY":REPO,"GITHUB_REPOSITORY_ID":"1432799501",
          "GITHUB_REPOSITORY_OWNER_ID":"347622360","GITHUB_REF":REF,
          "GITHUB_WORKFLOW_REF":WORKFLOW,"GITHUB_EVENT_NAME":"workflow_dispatch",
          "GUARDIAN_QA_CONFIRM":"true"}

def validate(env):
    if any(env.get(k)!=v for k,v in EXPECTED.items()):
        raise Stop("context_denied")
    if not re.fullmatch(r"[0-9a-f]{40}",env.get("GITHUB_SHA","")):
        raise Stop("commit_missing")
    if any(env.get(k) for k in ("GOOGLE_APPLICATION_CREDENTIALS","GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON","FIRESTORE_EMULATOR_HOST","GUARDIAN_V2_ENABLED")):
        raise Stop("unexpected_credentials_or_flags")

def reader(token,opener=None):
    if not isinstance(token,str) or len(token)<20 or any(c.isspace() for c in token):
        raise Stop("missing_token")
    opener=opener or urllib.request.build_opener(NoRedirect())
    def call(method,url,body=None):
        if method!="GET" or body is not None or not (
            url==BILLING or url==RULES+"releases/cloud.firestore" or
            re.fullmatch(re.escape(RULES)+r"rulesets/[A-Za-z0-9_-]{1,160}",url)):
            raise Stop("read_endpoint_denied")
        req=urllib.request.Request(url,headers={"Authorization":"Bearer "+token,
            "X-Goog-User-Project":PROJECT,"Accept":"application/json"},method="GET")
        try:
            with opener.open(req,timeout=30) as res:
                raw=res.read(500001)
            if len(raw)>500000:raise Stop("response_limit")
            data=json.loads(raw)
            if not isinstance(data,dict):raise Stop("invalid_response")
            return data
        except urllib.error.HTTPError as e:
            stage="billing" if url==BILLING else "rules"
            raise Stop(stage+"_http_"+str(e.code)) from None
        except (OSError,ValueError):
            raise Stop("request_failed") from None
    return call

def fetch_rules(call):
    bill=call("GET",BILLING)
    if bill.get("projectId")!=PROJECT or bill.get("billingEnabled") is not False:
        raise Stop("billing_not_confirmed_disabled")
    _,source=snapshot(call)
    data=source.encode("utf-8")
    if not data or len(data)>256*1024:
        raise Stop("rules_size_limit")
    return data

def sanitized_env(env):
    # Explicit allowlist for local emulator subprocess, no OIDC/API tokens.
    allowed=("PATH","HOME","LANG","LC_ALL","JAVA_HOME","TMPDIR","CI","NODE_EXTRA_CA_CERTS")
    return {**{k:env[k] for k in allowed if k in env},
            "CI":"true","GCLOUD_PROJECT":"demo-atrio-v11","GOOGLE_CLOUD_PROJECT":"demo-atrio-v11"}

def run_regression(data,run=subprocess.run):
    with tempfile.TemporaryDirectory(prefix="guardian-qa-private-") as tmp:
        root=Path(tmp); old=root/"baseline.rules"; out=root/"candidate.rules"
        old.write_bytes(data); os.chmod(old,0o600)
        # Compiler errors may quote private rules. Never print subprocess logs.
        log=root/"private.log"
        with log.open("wb") as f:
            result=run(["python3",str(ROOT/"scripts/guardian_qa_rules_regression.py"),
                "--legacy",str(old),"--out",str(out)],cwd=ROOT,
                env=sanitized_env(os.environ),stdout=f,stderr=subprocess.STDOUT,timeout=1100)
        # Only emit validated fixed fields, never arbitrary log excerpts.
        print("BASELINE_SHA256:",hashlib.sha256(data).hexdigest())
        if out.is_file():
            print("CANDIDATE_SHA256:",hashlib.sha256(out.read_bytes()).hexdigest())
        statuses={}
        for line in log.read_text(errors="replace").splitlines():
            if line.startswith("RESULTADOS: "):
                try:
                    value=json.loads(line[len("RESULTADOS: "):])
                    if set(value)=={"BASELINE","BOUNDARY","CANDIDATE"} and all(type(x) is int and 0<=x<=255 for x in value.values()):
                        statuses=value
                except (ValueError,TypeError):pass
        print("RESULTADOS:",json.dumps(statuses,sort_keys=True))
        if result.returncode!=0 or statuses!={"BASELINE":0,"BOUNDARY":0,"CANDIDATE":0}:
            raise Stop("regression_not_approved")

def main():
    try:
        validate(os.environ)
        token=os.environ.pop("QA_RULES_ACCESS_TOKEN","")
        data=fetch_rules(reader(token))
        del token
        print("QA_RULES_READ_OK; billing disabled")
        run_regression(data)
        print("QA_REMOTE_RULES_REGRESSION_OK; NO_GO_DEPLOY")
        return 0
    except Stop as e:
        print("QA_RULES_STOP:",str(e))
    except Exception:
        print("QA_RULES_STOP: unexpected_failure")
    return 2
if __name__=="__main__":raise SystemExit(main())
