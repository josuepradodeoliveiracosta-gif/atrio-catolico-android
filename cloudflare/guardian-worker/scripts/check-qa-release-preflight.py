#!/usr/bin/env python3
"""Fail-closed, offline readiness audit for the isolated QA Worker. No deploy."""
from pathlib import Path
import re
import sys
import tomllib

ROOT=Path(__file__).resolve().parents[1]
cfg=tomllib.loads((ROOT/'wrangler.qa.toml').read_text(encoding='utf-8'))
def require(ok,message):
    if not ok: raise SystemExit('QA PREFLIGHT BLOCKED: '+message)

require(cfg.get('name')=='atrio-guardian-v2-qa','Worker name not QA')
require(cfg.get('main')=='src/index.js','unexpected Worker entrypoint')
vars=cfg.get('vars',{})
required={
 'GUARDIAN_V2_TEST_MODE':'true',
 'GUARDIAN_V2_ENABLED':'false',
 'GUARDIAN_V2_HOLD_ENABLED':'false',
 'GUARDIAN_V2_QA_SHADOW_READS':'false',
 'GUARDIAN_V2_QA_FIRESTORE_BRIDGE':'false',
 'GUARDIAN_V2_QA_BRIDGE_NOT_BEFORE':'',
 'GUARDIAN_V2_QA_BRIDGE_EXPIRES_AT':'',
 'GUARDIAN_V2_QA_AUTO_DISPATCH':'false',
 'GUARDIAN_QA_DISPATCH_READY':'false',
 'GUARDIAN_V2_QA_READER_PROJECT':'atrio-catolico-qa-v2'
}
for key,value in required.items():
    require(vars.get(key)==value,f'{key} must be {value}')
for forbidden in ['GUARDIAN_FIREBASE_PROJECT_ID',
                  'GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON',
                  'GUARDIAN_V2_PRODUCTION_APPROVED',
                  'GUARDIAN_QA_GITHUB_DISPATCH_TOKEN']:
    require(forbidden not in vars,f'unsafe variable {forbidden} in QA')
limits={row.get('name'):row for row in cfg.get('ratelimits',[])}
require(set(limits)=={'GUARDIAN_QA_GLOBAL_LIMITER','GUARDIAN_QA_TOKEN_LIMITER'},
        'rate limiting bindings must be exact')
require(limits['GUARDIAN_QA_GLOBAL_LIMITER'].get('simple')=={'limit':20,'period':60},
        'global limiter must be 20 per 60 seconds')
require(limits['GUARDIAN_QA_TOKEN_LIMITER'].get('simple')=={'limit':3,'period':60},
        'token limiter must be 3 per 60 seconds')
require(limits['GUARDIAN_QA_GLOBAL_LIMITER']['namespace_id']!=
        limits['GUARDIAN_QA_TOKEN_LIMITER']['namespace_id'],
        'two rate limiters must not share namespace')
db=cfg.get('d1_databases',[])
require(len(db)==1,'exactly one QA D1 binding')
require(db[0].get('binding')=='GUARDIAN_QA_BUDGET_DB','wrong DB binding')
require(db[0].get('database_name')=='atrio-guardian-v2-qa-budget','wrong QA D1 database')
require(db[0].get('database_id')=='5ba3bbe6-e319-4c25-b958-6b53e940fb34',
        'wrong isolated QA D1 id')
require(db[0].get('migrations_dir')=='migrations','unexpected migrations directory')
source=(ROOT/'src/qa-d1-budget.js').read_text(encoding='utf-8')
require('QA_DAILY_READ_LIMIT=12' in source,'daily ceiling changed')
require("WHERE used<?2 RETURNING used" in source,'atomic D1 guard missing')
sql=(ROOT/'migrations/001_qa_budget.sql').read_text(encoding='utf-8')
require('CHECK (used BETWEEN 1 AND 12)' in sql,'D1 schema ceiling changed')
bridge=(ROOT/'src/qa-user-firestore-bridge.js').read_text(encoding='utf-8')
require('reserveQaDailyRead(env' in bridge,'Firestore QA is missing D1 reservation')
require('qaReadBudgetGate(env' in bridge,'Firestore QA is missing two rate limits')
print('QA PREFLIGHT PASS: isolated D1, strict 12/day and two limiters; remote bridge disabled')
