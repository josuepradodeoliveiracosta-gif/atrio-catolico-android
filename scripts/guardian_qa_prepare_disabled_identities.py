#!/usr/bin/env python3
"""Prepare two DISABLED Firebase Auth users in QA V2 only. Never publish Rules."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import urllib.error

PROJECT = "atrio-catolico-qa-v2"
NUMBER = "53068022813"
AUTH = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts"
RULES = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/"
ROLES = {"fixture_triage": "triage", "fixture_activation": "activation"}
MARK = "Guardian QA V2 preparation: "
CONFIRM = "PREPARAR QA V2 DESATIVADO"

class Stop(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Stop("redirect_denied")

def gcloud(*args, json_output=True):
    command = ["gcloud", *args, "--project="+PROJECT, "--quiet"]
    if json_output:
        command += ["--format=json"]
    try:
        p = subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
        if len(p.stdout)>1000000:
            raise Stop("gcloud_output_limit")
        return json.loads(p.stdout) if json_output else p.stdout.strip()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise Stop("gcloud_failed") from None

def verify_project():
    project = gcloud("projects", "describe", PROJECT)
    if project.get("projectId") != PROJECT or str(project.get("projectNumber")) != NUMBER:
        raise Stop("unexpected_project")
    if gcloud("billing", "projects", "describe", PROJECT).get("billingEnabled") is not False:
        raise Stop("billing_not_confirmed_disabled")

def client(token):
    if not isinstance(token,str) or len(token)<20 or any(c.isspace() for c in token):
        raise Stop("missing_oauth")
    opener = urllib.request.build_opener(NoRedirect())
    def call(method, url, body=None):
        # Fixed service origins and QA project only. No caller-selected target.
        if not (url in {AUTH,AUTH+":lookup",AUTH+":update"} or
                (method=="GET" and url.startswith(RULES) and
                 (url==RULES+"releases/cloud.firestore" or
                  url[len(RULES):].startswith("rulesets/")))):
            raise Stop("endpoint_denied")
        if (method=="GET") != (body is None):
            raise Stop("method_body_mismatch")
        req=urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization":"Bearer "+token,"Accept":"application/json",
                     "Content-Type":"application/json"}, method=method)
        try:
            with opener.open(req,timeout=30) as res:
                raw=res.read(500001)
            if len(raw)>500000:
                raise Stop("response_limit")
            data=json.loads(raw)
            if not isinstance(data,dict):
                raise Stop("invalid_response")
            return data
        except urllib.error.HTTPError as e:
            raise Stop("google_http_"+str(e.code)) from None
        except (OSError,ValueError):
            raise Stop("google_request_failed") from None
    return call

def snapshot(call):
    release=call("GET",RULES+"releases/cloud.firestore")
    expected=f"projects/{PROJECT}/releases/cloud.firestore"
    name=release.get("rulesetName","")
    prefix=f"projects/{PROJECT}/rulesets/"
    suffix=name[len(prefix):]
    if release.get("name")!=expected or not name.startswith(prefix) or not suffix or not all(c.isascii() and (c.isalnum() or c in "-_") for c in suffix):
        raise Stop("unexpected_release")
    data=call("GET",RULES+"rulesets/"+suffix)
    files=data.get("source",{}).get("files",[])
    if data.get("name")!=name or len(files)!=1 or not isinstance(files[0].get("content"),str) or not files[0]["content"].strip():
        raise Stop("unsupported_ruleset")
    return name,files[0]["content"]

def lookup(call,uid):
    data=call("POST",AUTH+":lookup",{"localId":[uid]})
    users=data.get("users",[])
    if not isinstance(users,list) or len(users)>1:
        raise Stop("unexpected_lookup")
    if not users:
        return None
    if users[0].get("localId")!=uid:
        raise Stop("unexpected_uid")
    return users[0]

def verified(user,uid,role):
    if not isinstance(user,dict):
        return False
    try:
        claims=json.loads(user.get("customAttributes","{}"))
    except (ValueError,TypeError):
        return False
    return (user.get("localId")==uid and user.get("disabled") is True
            and user.get("displayName")==MARK+role
            and claims=={"guardianQaRole":role}
            and not user.get("email") and not user.get("phoneNumber")
            and not user.get("providerUserInfo") and not user.get("passwordHash")
            and not user.get("lastLoginAt"))

def prepare(call,apply,verify=verify_project):
    # Check BOTH before any write; never overwrite or adopt an existing user.
    existing={uid:lookup(call,uid) for uid in ROLES}
    for uid,role in ROLES.items():
        if existing[uid] is not None and not verified(existing[uid],uid,role):
            raise Stop("existing_account_conflict_"+role)
    if not apply:
        return {role:"JA_PREPARADA_DESATIVADA" if existing[uid] else "DISPONIVEL" for uid,role in ROLES.items()}
    verify()
    status={}
    for uid,role in ROLES.items():
        if existing[uid]:
            status[role]="JA_PREPARADA_DESATIVADA"
            continue
        created=call("POST",AUTH,{"localId":uid,"displayName":MARK+role,"disabled":True})
        if created.get("localId")!=uid:
            raise Stop("creation_unconfirmed_"+role)
        # Verify disabled and ownership marker before writing claims.
        user=lookup(call,uid)
        if (not user or user.get("disabled") is not True or user.get("displayName")!=MARK+role
            or user.get("email") or user.get("phoneNumber") or user.get("providerUserInfo")
            or user.get("passwordHash") or user.get("lastLoginAt")
            or json.loads(user.get("customAttributes","{}"))!={}):
            raise Stop("created_account_unconfirmed_"+role)
        call("POST",AUTH+":update",{"localId":uid,"disableUser":True,
                                   "customAttributes":json.dumps({"guardianQaRole":role})})
        if not verified(lookup(call,uid),uid,role):
            raise Stop("claim_unconfirmed_"+role)
        status[role]="CRIADA_DESATIVADA"
    return status

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",choices=[CONFIRM])
    args=parser.parse_args()
    try:
        verify_project()
        call=client(gcloud("auth","print-access-token",json_output=False))
        name,source=snapshot(call)
        # Private, fresh directory; never overwrite any existing backup.
        root=Path(tempfile.mkdtemp(prefix="guardian-qa-rules-",dir=str(Path.home())))
        os.chmod(root,0o700)
        path=root/"published-firestore.rules"
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as f:
            f.write(source.encode("utf-8"))
        digest=hashlib.sha256(source.encode("utf-8")).hexdigest()
        print("Projeto QA confirmado; faturamento desativado.")
        print("Snapshot privado:",path)
        print("Rules SHA256:",digest)
        print("Ruleset:",name)
        for role,status in prepare(call,bool(args.apply)).items():
            print(role+": "+status)
        print("Nenhuma identidade habilitada. Nenhuma regra publicada.")
        print("Nenhum IAM, WIF, documento Firestore, APK ou faturamento alterado.")
        print("NO_GO_ESCRITA: falta homologar fronteira com Rules reais.")
        return 0
    except Stop as e:
        print("INTERROMPIDO:",str(e))
        print("Se uma conta foi criada, permanece desativada; verificar antes de repetir.")
        return 2
    except Exception:
        print("INTERROMPIDO: resposta inesperada; nenhuma ativacao solicitada.")
        return 2

if __name__=="__main__":
    raise SystemExit(main())
