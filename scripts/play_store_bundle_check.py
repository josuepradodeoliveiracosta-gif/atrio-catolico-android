#!/usr/bin/env python3
"""Fail-closed validation of the unsigned Play candidate and its merged manifest.

Runs after :app:bundlePlayRelease. Never signs or publishes a bundle.
"""
from pathlib import Path
import argparse
import sys
import xml.etree.ElementTree as ET
import zipfile

ANDROID = "{http://schemas.android.com/apk/res/android}"
EXPECTED_PACKAGE = "br.com.atriocatolico"
FORBIDDEN_INSTALL_PERMISSION = "android.permission.REQUEST_INSTALL_PACKAGES"
FORBIDDEN_PROVIDER = "androidx.core.content.FileProvider"


def verify_manifest(manifest):
    root = ET.parse(manifest).getroot()
    assert root.tag == "manifest", "invalid merged manifest"
    assert root.get("package") == EXPECTED_PACKAGE, "different packageId"
    for perm in root.findall("uses-permission") + root.findall("uses-permission-sdk-23"):
        assert perm.get(ANDROID + "name") != FORBIDDEN_INSTALL_PERMISSION, \
            "Play bundle must not request installing third-party APKs"
    sdk_nodes = root.findall("uses-sdk")
    assert len(sdk_nodes) == 1, "targetSdk must be explicit in merged manifest"
    assert sdk_nodes[0].get(ANDROID + "targetSdkVersion") == "36", \
        "Play requires targetSdkVersion 36"
    app = root.find("application")
    assert app is not None, "application declaration missing"
    assert app.get(ANDROID + "debuggable") != "true", "Play bundle cannot be debuggable"
    assert not any(x.get(ANDROID + "name") == FORBIDDEN_PROVIDER
                   for x in app.findall("provider")), \
        "Play bundle must not expose OTA APK FileProvider"


def verify_bundle(bundle):
    assert bundle.is_file() and bundle.stat().st_size > 0, "AAB not generated"
    with zipfile.ZipFile(bundle) as z:
        members = set(z.namelist())
        assert "base/manifest/AndroidManifest.xml" in members, \
            "bundle missing Android manifest"
        assert "BundleConfig.pb" in members, "not an Android App Bundle"
        assert z.testzip() is None, "corrupted ZIP/AAB"


def locate_merged_manifest(root):
    candidates = sorted(set(root.glob(
        "app/build/intermediates/merged_manifests/playRelease/**/AndroidManifest.xml"
    )) | set(root.glob(
        "app/build/intermediates/merged_manifest/playRelease/**/AndroidManifest.xml"
    )))
    assert len(candidates) == 1, \
        f"Expected one playRelease merged manifest, found {len(candidates)}"
    return candidates[0]


def verify_play_flag(root):
    candidates = list(root.glob(
        "app/build/generated/source/buildConfig/playRelease/**/BuildConfig.java"
    ))
    assert len(candidates) == 1, "Missing Play build configuration"
    text = candidates[0].read_text()
    assert "PLAY_STORE_BUILD = true" in text, "OTA sideloading is not disabled for Play"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--project-root", default=".")
    args = p.parse_args()
    project = Path(args.project_root)
    try:
        manifest = locate_merged_manifest(project)
        verify_manifest(manifest)
        verify_play_flag(project)
        bundle = project / "app/build/outputs/bundle/playRelease/app-playRelease.aab"
        verify_bundle(bundle)
        print(f"APROVADO: Play AAB {bundle.name}, SDK 36, pacote {EXPECTED_PACKAGE}, "
              "sem instalador de APK/OTA, nao depuravel")
        return 0
    except (AssertionError, OSError, ValueError, ET.ParseError,
            zipfile.BadZipFile) as ex:
        print(f"Play AAB REPROVADO: {ex}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
