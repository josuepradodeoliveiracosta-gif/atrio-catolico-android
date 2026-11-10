import unittest
from scripts.qa_m3_integration_manifest_check import validate_manifest

def valid():
    files = []
    tree = {}
    for pr in range(218,227):
        path = f"scripts/synthetic_test_{pr}.mjs"
        sha = f"{pr:040x}"
        files.append({"pr":pr,"files":[{"path":path,"sha":sha}]})
        tree[path] = sha
    for i in range(26):
        path = f"docs/qa-homologacao/synthetic_check_{i}.md"
        sha = f"{1000+i:040x}"
        files[0]["files"].append({"path":path,"sha":sha})
        tree[path]=sha
    manifest={
        "version":1,"status":"NO_GO","sourceParentPr":193,
        "sourceParentSha":"530395026d0dc37ac424b788c3f5a22f79bb8fed",
        "expectedFiles":35,
        "requiredApproval":"human-policy-and-separate-QA-deploy",
        "sources":files,
    }
    return manifest,tree

class ManifestTests(unittest.TestCase):
    def test_35_blobs_from_nine_prs(self):
        obj,tree=valid()
        self.assertEqual(validate_manifest(obj,tree),[])

    def test_file_change_not_accepted(self):
        obj,tree=valid()
        key=obj["sources"][0]["files"][0]["path"]
        tree[key]="f"*40
        self.assertTrue(any("BLOB_MISMATCH" in e
          for e in validate_manifest(obj,tree)))

    def test_outside_scope_and_deletion_targets_rejected(self):
        obj,tree=valid()
        obj["sources"][0]["files"][0]["path"]="firestore.rules"
        self.assertIn("FILE_SCOPE_INVALID",validate_manifest(obj,tree))

    def test_backups_and_external_paths_rejected(self):
        obj,tree=valid()
        obj["sources"][0]["files"][0]["path"]="../backups/real.zip"
        self.assertIn("FILE_SCOPE_INVALID",validate_manifest(obj,tree))

    def test_duplicate_file_from_another_pr_rejected(self):
        obj,tree=valid()
        obj["sources"][1]["files"][0]["path"]=obj["sources"][0]["files"][0]["path"]
        self.assertIn("DUPLICATE_FILE",validate_manifest(obj,tree))

    def test_policy_or_approval_never_set_go(self):
        obj,tree=valid()
        obj["status"]="GO"
        self.assertIn("MANIFEST_SCOPE_OR_APPROVAL_MISMATCH",
                      validate_manifest(obj,tree))

    def test_missing_pr_requires_review(self):
        obj,tree=valid()
        obj["sources"]=obj["sources"][:-1]
        self.assertIn("PR_SET_INVALID",validate_manifest(obj,tree))

    def test_blob_invalid_does_not_pass(self):
        obj,tree=valid()
        obj["sources"][0]["files"][0]["sha"]="not-a-blob"
        self.assertIn("FILE_SCOPE_INVALID",validate_manifest(obj,tree))

if __name__ == "__main__":
    unittest.main()
