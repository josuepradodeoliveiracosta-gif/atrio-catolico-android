#!/usr/bin/env python3
"""Termux: Auth/Firestore Rules check, exclusively Firebase QA.
Uses stdlib; prompts for Firebase QA API key + temporary email/password.
Never saves or prints keys/tokens/passwords. --test creates then deletes one QA user.
"""
import argparse
import getpass
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT="atrio-catolico-qa-v2"
# Some legacy Identity Toolkit project configurations use the numeric project ID.
# Both identifiers were verified in the Firebase QA SDK configuration.
PROJECT_NUMBER="53068022813"
APP_ID="1:53068022813:web:57fe6acbf9686fa1b5f2f4"
DOC=f"projects/{PROJECT}/databases/(default)/documents/posts/qa_post_1"
FIRESTORE="https://firestore.googleapis.com/v1/"+DOC
AUTH="https://identitytoolkit.googleapis.com/v1/"
# Fixed QA hostname. No caller-supplied URL or production endpoint.
QA_WORKER="https://atrio-guardian-v2-qa.atrio-catolico.workers.dev"
QA_BRIDGE_URL=QA_WORKER+"/qa/firebase-fixture"
QA_BRIDGE_OK={"qa_fixture_clear","qa_fixture_review","qa_fixture_warn"}

class NeverFollowRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        # Never send a Firebase Auth Bearer outside the literal QA Worker.
        return None

def qa_worker_post(id_token=None,opener=None):
    """One POST, no redirects, no JWT in URL/logs or untrusted response text."""
    if id_token is not None and not (
      isinstance(id_token,str) and re.fullmatch(
        r"[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,2048}",id_token)):
        return (0,"qa_invalid_token")
    if opener is None:
        opener=urllib.request.build_opener(NeverFollowRedirect())
    headers={"Accept":"application/json"}
    if id_token is not None:
        headers["Authorization"]="Bearer "+id_token
    req=urllib.request.Request(QA_BRIDGE_URL,data=b"",headers=headers,method="POST")
    try:
        with opener.open(req,timeout=12) as response:
            status=response.status
            data=response.read(1025)
    except urllib.error.HTTPError as exc:
        status=exc.code
        data=exc.read(1025)
    except (urllib.error.URLError,TimeoutError,OSError,ValueError):
        return (0,"qa_remote_network_unavailable")
    if len(data)>1024:
        return (0,"qa_remote_invalid_response")
    try:
        payload=json.loads(data)
        category=payload.get("status")
    except (ValueError,AttributeError,TypeError):
        return (0,"qa_remote_invalid_response")
    if not isinstance(category,str):
        return (0,"qa_remote_invalid_response")
    allowed={200:QA_BRIDGE_OK,401:{"unauthorized"},403:{"forbidden"},
      429:{"qa_rate_limited","qa_daily_budget_exhausted"},
      503:{"qa_bridge_disabled","qa_daily_budget_unavailable",
        "qa_rate_limit_unavailable","qa_upstream_network_unavailable",
        "qa_upstream_response_invalid","qa_upstream_http_unavailable",
        "qa_upstream_redirect_blocked","qa_upstream_throttled",
        "qa_bridge_unavailable","invalid_qa_fixture"}}
    if category not in allowed.get(status,set()):
        return (0,"qa_remote_invalid_response")
    return (status,category)

def qa_remote_preflight():
    """No account creation unless the public QA bridge explicitly requires auth."""
    code,category=qa_worker_post()
    if code==401 and category=="unauthorized":
        print("QA_BRIDGE_REMOTE_READY: autenticação obrigatória")
        return True
    if code==503 and category=="qa_bridge_disabled":
        print("QA_BRIDGE_REMOTE_DISABLED: nenhuma conta criada; ponte QA desligada")
    else:
        print("QA_BRIDGE_REMOTE_NOT_READY: nenhuma conta criada")
    return False

def qa_bridge_remote(token):
    """Exactly one authenticated read through public QA Worker; fail closed."""
    code,category=qa_worker_post(token)
    if code==200 and category in QA_BRIDGE_OK:
        print("QA_BRIDGE_REMOTE_PASS:",category)
        return True
    # Fixed short status only; never upstream content, JWT, UID or error detail.
    print("QA_BRIDGE_REMOTE_BLOCKED:",category)
    return False


def call(method,url,data=None,token=None):
    headers={"Accept":"application/json"}
    if data is not None:headers["Content-Type"]="application/json"
    if token:headers["Authorization"]="Bearer "+token
    payload=None if data is None else json.dumps(data).encode("utf-8")
    req=urllib.request.Request(url,data=payload,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=15) as response:
            body=response.read(12289)
            if len(body)>12288:return 503,{"error":{"message":"TOO_LARGE"}}
            return response.status,json.loads(body)
    except urllib.error.HTTPError as exc:
        try:
            body=exc.read(12289)
            message=json.loads(body).get("error",{}).get("message","HTTP_ERROR")
        except (ValueError,TypeError):message="HTTP_ERROR"
        safe={"OPERATION_NOT_ALLOWED","EMAIL_EXISTS","INVALID_EMAIL","WEAK_PASSWORD",
              "INVALID_PASSWORD","INVALID_LOGIN_CREDENTIALS","TOO_MANY_ATTEMPTS_TRY_LATER",
              "API_KEY_INVALID","API_KEY_SERVICE_BLOCKED","PERMISSION_DENIED"}
        if not isinstance(message,str) or message.split(" : ")[0] not in safe:message="HTTP_ERROR"
        return exc.code,{"error":{"message":message.split(" : ")[0]}}

def auth_url(route,key):
    return AUTH+route+"?key="+urllib.parse.quote(key,safe="")

def qa_bridge_local(token):
    """Run real Worker bridge locally with mocked limits; token only on stdin."""
    script=pathlib.Path(__file__).with_name("qa-bridge-auth-local.mjs")
    if not script.is_file():
        print("QA_BRIDGE_LOCAL_BLOCKED: script ausente")
        return False
    try:
        result=subprocess.run(["node",str(script)],input=token,text=True,
                              capture_output=True,timeout=20,check=False)
        line=result.stdout.strip()
        safe={"QA_BRIDGE_LOCAL_PASS: qa_fixture_clear",
              "QA_BRIDGE_LOCAL_PASS: qa_fixture_review",
              "QA_BRIDGE_LOCAL_PASS: qa_fixture_warn"}
        if result.returncode==0 and line in safe:
            print(line)
            return True
    except (OSError,subprocess.TimeoutExpired):
        pass
    print("QA_BRIDGE_LOCAL_BLOCKED: sem leitura QA confirmada")
    return False


def test_qa(key,email,password,bridge_local=False,bridge_remote=False):
    registered_id=None
    token=None
    try:
        status,created=call("POST",auth_url("accounts:signUp",key),
                           {"email":email,"password":password,"returnSecureToken":True})
        if status!=200:
            print("QA_SIGNUP_BLOCKED:",created.get("error",{}).get("message","HTTP_ERROR"))
            return 1
        token=created.get("idToken")
        registered_id=created.get("localId")
        if not isinstance(token,str) or len(token)<100 or not isinstance(registered_id,str):
            print("QA_SIGNUP_INVALID_RESPONSE")
            return 1
        print("QA_ACCOUNT_CREATED: projeto QA, conta temporária")
        status,signed=call("POST",auth_url("accounts:signInWithPassword",key),
                           {"email":email,"password":password,"returnSecureToken":True})
        if status!=200 or signed.get("localId")!=registered_id:
            print("QA_SIGNIN_FAILED")
            return 1
        print("QA_EMAIL_PASSWORD_LOGIN: OK")
        status,_=call("GET",FIRESTORE)
        if status not in (401,403):
            print("QA_ANONYMOUS_READ_UNEXPECTED:",status)
            return 1
        print("QA_ANONYMOUS_READ: BLOCKED")
        token=signed.get("idToken")
        if not isinstance(token,str) or len(token)<100:
            print("QA_SIGNIN_INVALID_TOKEN")
            return 1
        status,fixture=call("GET",FIRESTORE,token=token)
        if status!=200:
            print("QA_AUTH_READ_FAILED:",status)
            return 1
        fields=fixture.get("fields") or {}
        if fixture.get("name")!=DOC or (fields.get("qaFixture") or {}).get("booleanValue") is not True:
            print("QA_FIXTURE_INVALID")
            return 1
        print("QA_AUTHENTICATED_FIRESTORE_RULES: OK")
        if bridge_local and not qa_bridge_local(token):
            return 1
        if bridge_remote and not qa_bridge_remote(token):
            return 1
        print("QA_TEST_RESULT: PASS")
        return 0
    finally:
        if registered_id:
            if token:
                status,_=call("POST",auth_url("accounts:delete",key),{"idToken":token})
                print("QA_TEST_ACCOUNT_REMOVED:" if status==200 else "QA_TEST_ACCOUNT_CLEANUP_REQUIRED:",
                      "YES" if status==200 else "Verificar Authentication > Users no QA")

def qa_key_from_firebase_cli():
    """Get QA key without displaying or copying it. Bind to exact app & project."""
    try:
        command=["firebase","apps:sdkconfig","WEB",APP_ID,
                 "--project",PROJECT,"--json"]
        result=subprocess.run(command, capture_output=True, text=True,
                              timeout=45, check=False)
        if result.returncode!=0:return None
        payload=json.loads(result.stdout)
        if payload.get("status")!="success":return None
        sdk=payload.get("result",{}).get("sdkConfig")
        if isinstance(sdk,str):sdk=json.loads(sdk)
        if not isinstance(sdk,dict):return None
        if sdk.get("projectId")!=PROJECT or sdk.get("appId")!=APP_ID:
            return None
        key=sdk.get("apiKey")
        if not isinstance(key,str) or not re.fullmatch(r"[A-Za-z0-9_-]{20,120}",key):
            return None
        return key
    except (OSError,subprocess.TimeoutExpired,ValueError,TypeError,AttributeError):
        return None


def main():
    parser=argparse.ArgumentParser(description="Auth e Firestore QA no Termux, sem produção")
    parser.add_argument("--test",action="store_true",help="cria conta QA temporária, testa e exclui")
    parser.add_argument("--bridge-local",action="store_true",
                        help="com --test, usa a ponte real do Worker localmente; D1/Rate Limits simulados")
    parser.add_argument("--bridge-remote",action="store_true",
                        help="com --test, valida o Worker QA remoto usando o token de uma conta temporária")
    args=parser.parse_args()
    if args.bridge_local and args.bridge_remote:
        print("QA_BRIDGE_MODE_CONFLICT: escolha apenas uma ponte")
        return 1
    if (args.bridge_local or args.bridge_remote) and not args.test:
        print("QA_BRIDGE_NEEDS_TEST: use --test com a ponte escolhida")
        return 1
    key=qa_key_from_firebase_cli()
    if key is None:
        print("QA_CLI_CONFIG_UNAVAILABLE: execute firebase login --no-localhost; confira o app QA")
        return 1
    # Key & project were verified against Firebase Management with CLI login.
    # The public Auth configuration check is separate: new projects may return 400.
    print("QA_PROJECT_VERIFIED:",PROJECT)
    code,conf=call("GET",auth_url("projects",key))
    if code!=200:
        reason=conf.get("error",{}).get("message","HTTP_ERROR") if isinstance(conf,dict) else "HTTP_ERROR"
        print("QA_AUTH_CONFIGURATION_PENDING:",code,reason)
        print("QA_AUTH_ACTION: habilite E-mail/senha em Authentication SOMENTE no Firebase QA")
        return 1
    # The public getProjects response may omit projectId; that does NOT
    # invalidate the already verified Firebase Management SDK config.
    # Still reject a projectId explicitly supplied by the Auth API if different.
    if not isinstance(conf,dict) or not conf:
        print("QA_AUTH_CONFIGURATION_INVALID: nada criado")
        return 1
    claimed=conf.get("projectId")
    if claimed is not None and claimed not in (PROJECT,PROJECT_NUMBER):
        # Only fixed safe diagnostics: never echo API responses, keys or tokens.
        if isinstance(claimed,str) and claimed.isdecimal():
            kind="OTHER_PROJECT_NUMBER"
        elif isinstance(claimed,str):
            kind="OTHER_PROJECT_ID"
        else:
            kind="INVALID_PROJECT_ID"
        print("QA_AUTH_PROJECT_MISMATCH:",kind,"(nenhuma conta criada)")
        return 1
    if not args.test:
        print("QA_PRECHECK_PASS: nenhuma conta criada. Para testar, use --test.")
        return 0
    # A closed QA bridge is not a reason to create/delete new Auth accounts.
    if args.bridge_remote and not qa_remote_preflight():
        return 1
    email=input("E-mail seu, exclusivo para teste QA: ").strip()
    if len(email)>200 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email):
        print("QA_TEST_EMAIL_INVALID")
        return 1
    password=getpass.getpass("Senha temporária (oculta, mínimo 8 caracteres): ")
    if not 8<=len(password)<=128:
        print("QA_TEST_PASSWORD_INVALID")
        return 1
    print("QA_TEMP_ACCOUNT_TEST: cadastro, login, regras, exclusão")
    return test_qa(key,email,password,
                   bridge_local=args.bridge_local,bridge_remote=args.bridge_remote)

if __name__=="__main__":
    try:sys.exit(main())
    except (TimeoutError,urllib.error.URLError,ValueError):
        print("QA_NETWORK_UNAVAILABLE")
        sys.exit(1)
