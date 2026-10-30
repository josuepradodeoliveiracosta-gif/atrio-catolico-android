#!/usr/bin/env python3
"""Termux: Auth/Firestore Rules check, exclusively Firebase QA.
Uses stdlib; prompts for Firebase QA API key + temporary email/password.
Never saves or prints keys/tokens/passwords. --test creates then deletes one QA user.
"""
import argparse
import getpass
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT="atrio-catolico-qa-v2"
APP_ID="1:53068022813:web:57fe6acbf9686fa1b5f2f4"
DOC=f"projects/{PROJECT}/databases/(default)/documents/posts/qa_post_1"
FIRESTORE="https://firestore.googleapis.com/v1/"+DOC
AUTH="https://identitytoolkit.googleapis.com/v1/"

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

def test_qa(key,email,password):
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
    args=parser.parse_args()
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
    if claimed is not None and claimed!=PROJECT:
        print("QA_AUTH_PROJECT_MISMATCH: nada criado")
        return 1
    if not args.test:
        print("QA_PRECHECK_PASS: nenhuma conta criada. Para testar, use --test.")
        return 0
    email=input("E-mail seu, exclusivo para teste QA: ").strip()
    if len(email)>200 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email):
        print("QA_TEST_EMAIL_INVALID")
        return 1
    password=getpass.getpass("Senha temporária (oculta, mínimo 8 caracteres): ")
    if not 8<=len(password)<=128:
        print("QA_TEST_PASSWORD_INVALID")
        return 1
    print("QA_TEMP_ACCOUNT_TEST: cadastro, login, regras, exclusão")
    return test_qa(key,email,password)

if __name__=="__main__":
    try:sys.exit(main())
    except (TimeoutError,urllib.error.URLError,ValueError):
        print("QA_NETWORK_UNAVAILABLE")
        sys.exit(1)
