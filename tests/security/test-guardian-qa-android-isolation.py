#!/usr/bin/env python3
"""Synthetic regression tests: no device, credentials, network, or production calls."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory

file_path = Path(__file__).resolve().parents[2] / "scripts" / "check-guardian-qa-android-isolation.py"
spec = importlib.util.spec_from_file_location("guardian_qa_android_isolation", file_path)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

with TemporaryDirectory() as d:
    root = Path(d)
    (root / "app").mkdir()
    base_env = {"ATRIO_GUARDIAN_QA_ISOLATED": "1"}
    assert guard.check_prebuild(root, base_env) == []
    config = root / "app" / "google-services.json"
    config.write_text('{"project_info":{"project_id":"production"}}')
    assert "qa_must_not_package_firebase_config" in guard.check_prebuild(root, base_env)
    config.unlink()
    assert guard.check_prebuild(root, {}) == ["qa_application_id_suffix_not_enabled"]
    for field in guard.DENIED_KEYS:
        denied = guard.check_prebuild(root, {**base_env, field: "synthetic-value"})
        assert "forbidden_environment_value:" + field in denied

good = "package: name='br.com.atriocatolico.guardianqa' versionCode='36'"
assert guard.check_apk_metadata(good, "", ["classes.dex"], b"dex synthetic") == []
assert "qa_package_not_isolated" in guard.check_apk_metadata(
    "package: name='br.com.atriocatolico'", "", ["classes.dex"], b"dex")
assert "qa_package_not_isolated" in guard.check_apk_metadata(
    "", "", ["classes.dex"], b"dex")
assert "firebase_options_found_in_resources" in guard.check_apk_metadata(
    good, "string/google_app_id", ["classes.dex"], b"dex")
assert "firebase_config_or_credential_in_apk" in guard.check_apk_metadata(
    good, "", ["assets/google-services.json"], b"dex")
for url in guard.DENIED_URLS:
    assert "worker_endpoint_in_apk" in guard.check_apk_metadata(
        good, "", ["classes.dex"], url)
assert "apk_missing" in guard.check_apk(Path("/file/that/does/not/exist.apk"))
print("GUARDIAN_QA_ANDROID_ISOLATION_MUTATION_PASS: 8 environment + 6 APK checks")
