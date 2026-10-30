import importlib.util
import pathlib
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name("bootstrap-qa-fixture.py")
spec = importlib.util.spec_from_file_location("qa_fixture_bootstrap", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FixtureGuardTest(unittest.TestCase):
    def test_target_and_content_are_qa_only(self):
        self.assertIn("atrio-catolico-qa-v2", mod.URL)
        self.assertTrue(mod.URL.endswith("/posts/qa_post_1"))
        fields = mod.fixture_fields()["fields"]
        self.assertIs(fields["qaFixture"]["booleanValue"], True)
        self.assertEqual(fields["uid"]["stringValue"], "qa-synthetic-user")
        self.assertLessEqual(len(fields["title"]["stringValue"]), 120)
        self.assertLessEqual(len(fields["body"]["stringValue"]), 1200)

    def test_readonly_default_when_absent(self):
        with patch.object(mod, "checked_environment"), patch.object(
            mod, "gcloud", return_value="token" * 10
        ), patch.object(mod, "request", return_value=(404, None)) as req:
            mod.main([])
            self.assertEqual([c.args[0] for c in req.call_args_list], ["GET"])

    def test_write_needs_confirmation(self):
        with self.assertRaisesRegex(RuntimeError, "Confirmação"):
            mod.main(["--apply"])

    def test_existing_doc_never_overwritten(self):
        with patch.object(mod, "checked_environment"), patch.object(
            mod, "gcloud", return_value="token" * 10
        ), patch.object(mod, "request", return_value=(200, {"name": mod.RESOURCE, "fields": {}})) as req:
            with self.assertRaisesRegex(RuntimeError, "não sobrescrever"):
                mod.main(["--apply", "--confirm", mod.CONFIRM])
            self.assertEqual([c.args[0] for c in req.call_args_list], ["GET"])

    def test_apply_only_one_write_then_read_verification(self):
        calls = []
        def request(method, token, payload=None):
            calls.append(method)
            if len(calls) == 1:
                return (404, None)
            if len(calls) == 2:
                return (200, {})
            return (200, {"name": mod.RESOURCE, "fields": {"qaFixture": {"booleanValue": True}}})
        with patch.object(mod, "checked_environment"), patch.object(
            mod, "gcloud", return_value="token" * 10
        ), patch.object(mod, "request", side_effect=request):
            mod.main(["--apply", "--confirm", mod.CONFIRM])
        self.assertEqual(calls, ["GET", "PATCH", "GET"])


if __name__ == "__main__":
    unittest.main()
