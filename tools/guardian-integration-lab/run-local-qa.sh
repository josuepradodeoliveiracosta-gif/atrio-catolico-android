#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node --test ./*.test.mjs
node --input-type=module -e 'import {dashboardFixture,CTX,NOW,exampleRows} from "./qa-dashboard-bridge.mjs"; const r=dashboardFixture(CTX,exampleRows(),NOW); if(r===null)process.exit(1); process.stdout.write(r)' > "$tmp/fixture.tsv"
kotlinc GuardianDashboardModel.kt GuardianDashboardModelTest.kt -include-runtime -d "$tmp/model.jar"
java -jar "$tmp/model.jar"
kotlinc GuardianDashboardModel.kt GuardianDashboardBridgeTest.kt -include-runtime -d "$tmp/bridge.jar"
java -jar "$tmp/bridge.jar" "$tmp/fixture.tsv"
