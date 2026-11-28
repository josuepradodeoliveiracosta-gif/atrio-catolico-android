import unittest
from pathlib import Path
from scripts import guardian_qa_compose_rules as m
BOUNDARY=(Path(__file__).resolve().parents[1]/"tests/security/guardian-qa-boundary.rules").read_text()
def legacy(body):
    return "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { "+body+" } }"
class Compose(unittest.TestCase):
    def test_or_is_grouped(self):
        s,n=m.compose(legacy("match /posts/{id} { allow read: if true || false; }"),BOUNDARY)
        self.assertEqual(n,1)
        self.assertIn("("+m.GUARD+") && ( true || false)",s)
    def test_comments_and_strings_unchanged(self):
        body="match /posts/{id} { // allow read: if true;\n allow read: if id == 'allow read; }'; }"
        s,n=m.compose(legacy(body),BOUNDARY)
        self.assertEqual(n,1)
        self.assertIn("// allow read: if true;",s)
        self.assertIn("'allow read; }'",s)
    def test_allows_nested_and_unconditional(self):
        s,n=m.compose(legacy("match /posts/{id} { allow read, write; match /replies/{r} { allow get: if true; } }"),BOUNDARY)
        self.assertEqual(n,2)
        self.assertEqual(s.count(m.GUARD),2)
    def test_duplicate_composition_denied(self):
        s,_=m.compose(legacy("match /posts/{id} { allow get: if true; }"),BOUNDARY)
        with self.assertRaises(ValueError):m.compose(s,BOUNDARY)
    def test_v1_and_wrong_root_denied(self):
        s=legacy("match /posts/{id} { allow get: if true; }")
        for x in [s.replace("'2'","'1'"),s.replace("cloud.firestore","firebase.storage"),s+" service other {}"]:
            with self.assertRaises(ValueError):m.compose(x,BOUNDARY)
    def test_reserved_claim_or_namespace_denied(self):
        for x in ["qa_guardian_cases","guardianQaRole","fixture_triage"]:
            with self.assertRaises(ValueError):m.compose(legacy("match /"+x+"/{id} { allow read: if true; }"),BOUNDARY)
    def test_ambiguous_allow_denied(self):
        with self.assertRaises(ValueError):m.compose(legacy("match /posts/{id} { allow weird: if true; }"),BOUNDARY)
    def test_size_limit_denied(self):
        with self.assertRaises(ValueError):m.compose(legacy("/*"+"x"*m.LIMIT+"*/ match /posts/{id} { allow read: if true; }"),BOUNDARY)
    def test_missing_semicolon_denied(self):
        with self.assertRaises(ValueError):m.compose(legacy("match /posts/{id} { allow read: if true }"),BOUNDARY)
if __name__=="__main__":unittest.main()
