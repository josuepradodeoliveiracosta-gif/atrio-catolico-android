#!/usr/bin/env python3
"""Compose a PRIVATE QA candidate. No network, no deploy, no in-place edits.

Legacy allows are individually constrained because overlapping matches are ORed.
Unknown syntax fails closed. The original snapshot is never written.
A successful transformation is NOT approval to publish.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re

# Preserve offsets; comments and strings are single tokens (never rewrite them).
LEX=re.compile(r"//[^\n]*|/\*[\s\S]*?\*/|'(?:\\[\s\S]|[^'\\])*'|\"(?:\\[\s\S]|[^\"\\])*\"|[A-Za-z_$][A-Za-z0-9_$]*|\s+|.",re.S)
HEADER=["rules_version","=","'2'",";","service","cloud",".","firestore","{","match","/","databases","/","{","database","}","/","documents","{"]
METHODS={"read","write","get","list","create","update","delete"}
MARKER="GUARDIAN_QA_COMPOSED_V1"
GUARD="(request.auth == null || (!(request.auth.uid in ['fixture_triage','fixture_activation','fixture_owner']) && !('guardianQaRole' in request.auth.token))) && !request.path[3].matches('qa_guardian_.*')"
LIMIT=256*1024

def tokens(source):
    out=[]
    for m in LEX.finditer(source):
        t=m.group()
        if t.isspace() or t.startswith("//") or t.startswith("/*"):
            continue
        if t in {"'",'"'} or source[m.start():m.start()+2]=="/*":
            raise ValueError("unterminated_token")
        out.append((t,m.start(),m.end()))
    return out

def structure(source):
    ts=tokens(source)
    words=[t[0] for t in ts]
    if len(words)<20:
        raise ValueError("rules_too_short")
    if words[2]=='"2"':
        words[2]="'2'"
    if words[:len(HEADER)]!=HEADER:
        raise ValueError("unsupported_header")
    # Only one enclosing service and database match, with no other scopes.
    stack=[]
    pairs={}
    for i,w in enumerate(words):
        if w in ("{","(","["):
            stack.append((w,i))
        elif w in ("}",")","]"):
            if not stack or stack[-1][0]!={"}":"{",")":"(","]":"["}[w]:
                raise ValueError("unbalanced_rules")
            _,j=stack.pop()
            pairs[j]=i
    if stack or pairs.get(8)!=len(words)-1 or pairs.get(len(HEADER)-1)!=len(words)-2:
        raise ValueError("unsupported_root_structure")
    return ts,words

def compose(legacy,boundary):
    if not isinstance(legacy,str) or not isinstance(boundary,str):
        raise ValueError("invalid_source")
    if any(x in legacy for x in (MARKER,"qa_guardian_","guardianQaRole","fixture_triage","fixture_activation","fixture_owner")):
        raise ValueError("reserved_namespace_present")
    ts,words=structure(legacy)
    bt,bw=structure(boundary)
    # Boundary source is separately integrity-pinned by its caller. Its root
    # match is placed as a sibling so helper names do not collide.
    fragment=boundary[bt[9][1]:bt[-1][1]]
    edits=[]
    count=0
    for i,w in enumerate(words):
        if w!="allow":
            continue
        # Reject ambiguous uses rather than silently skip a legacy allow.
        j=i+1
        if j>=len(words) or words[j] not in METHODS:
            raise ValueError("unsupported_allow_token")
        j+=1
        while j<len(words) and words[j]==",":
            j+=1
            if j>=len(words) or words[j] not in METHODS:
                raise ValueError("unsupported_allow_methods")
            j+=1
        if words[j]==";":
            edits.append((ts[j][1],ts[j][1],": if "+GUARD))
        elif words[j:j+2]==[":","if"]:
            start=j+2
            end=start
            while end<len(words) and words[end]!=";":
                end+=1
            if end==start or end>=len(words) or any(x in {"allow","match","function","service"} for x in words[start:end]):
                raise ValueError("unsupported_allow_expression")
            edits.append((ts[j+1][2],ts[j+1][2]," ("+GUARD+") && ("))
            edits.append((ts[end][1],ts[end][1],")"))
        else:
            raise ValueError("unsupported_allow")
        count+=1
    if not count:
        raise ValueError("no_legacy_allow")
    edits.append((ts[-1][1],ts[-1][1],"\n  // "+MARKER+"\n  "+fragment+"\n"))
    result=legacy
    for a,b,ins in sorted(edits,reverse=True):
        result=result[:a]+ins+result[b:]
    if len(result.encode("utf-8"))>LIMIT:
        raise ValueError("rules_size_limit")
    # Verify every recorded guard survives assembly, no guard omitted.
    if result.count(GUARD)!=count:
        raise ValueError("guard_count_mismatch")
    return result,count

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--legacy",type=Path,required=True)
    ap.add_argument("--boundary",type=Path,required=True)
    ap.add_argument("--out",type=Path,required=True)
    args=ap.parse_args()
    try:
        if args.legacy.resolve()==args.out.resolve() or args.boundary.resolve()==args.out.resolve():
            raise ValueError("in_place_denied")
        old=args.legacy.read_bytes()
        boundary=args.boundary.read_bytes()
        if len(old)>LIMIT or len(boundary)>LIMIT:
            raise ValueError("source_size_limit")
        result,count=compose(old.decode("utf-8"),boundary.decode("utf-8"))
        data=result.encode("utf-8")
        with os.fdopen(os.open(args.out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as f:
            f.write(data)
        print("Legacy SHA256:",sha(old))
        print("Candidate SHA256:",sha(data))
        print("Legacy allows guarded:",count)
        print("CANDIDATE_LOCAL_ONLY")
        print("NO_GO_DEPLOY: review and regression required")
        return 0
    except (OSError,ValueError,IndexError,UnicodeError) as e:
        print("COMPOSITION_STOPPED:", type(e).__name__, str(e) if isinstance(e,ValueError) else "")
        return 2

if __name__=="__main__":
    raise SystemExit(main())
