#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node --test ./*.test.mjs
node --input-type=module -e 'import {createLocalQaRuntime} from "./local-qa-runtime.mjs"; import {CTX,NOW,exampleRows} from "./qa-dashboard-bridge.mjs"; const db=createLocalQaRuntime(); try {const r=db.moderation(CTX,exampleRows(),NOW); if(!r.ok)process.exitCode=1; else process.stdout.write(r.projection);} finally {db.close();}' > "$tmp/fixture.tsv"
kotlinc GuardianDashboardModel.kt GuardianDashboardModelTest.kt -include-runtime -d "$tmp/model.jar"
java -jar "$tmp/model.jar"
kotlinc GuardianDashboardModel.kt GuardianDashboardBridgeTest.kt -include-runtime -d "$tmp/bridge.jar"
java -jar "$tmp/bridge.jar" "$tmp/fixture.tsv"
kotlinc ../../app/src/main/java/br/com/atriocatolico/GuardianReportPageSummary.kt GuardianReportPageSummaryTest.kt -include-runtime -d "$tmp/page.jar"
java -jar "$tmp/page.jar"
