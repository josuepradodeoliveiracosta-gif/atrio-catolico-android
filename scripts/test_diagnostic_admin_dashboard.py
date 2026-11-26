import copy
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.operational_diagnostic_center import build
from scripts.test_operational_diagnostic_center import ci, NOW
from scripts.diagnostic_admin_dashboard import model, render, write_private


def snapshot(now=NOW, state=None):
    manifest = None if state is None else {"schema_version":1, "observations":[{
        "environment":"perfil_qa", "component":"authentication", "state":state,
        "observed_at":now.strftime("%Y-%m-%dT%H:%M:%SZ")}]}
    return build(ci(), manifest, now=now)


class DashboardTests(unittest.TestCase):
    def test_unknown_never_healthy(self):
        result = model([snapshot()], now=NOW)
        self.assertEqual(result["counts"]["unknown"], 50)
        html = render(result)
        self.assertIn("Nenhuma saúde global", html)
        self.assertNotIn("<script", html)

    def test_history_and_expiry(self):
        old = snapshot(NOW-timedelta(days=2), "failed")
        recent = snapshot(NOW, "degraded")
        result = model([recent, old], now=NOW)
        self.assertEqual(result["counts"]["reported_degraded"], 1)
        self.assertEqual(len(result["history"]), 2)
        self.assertEqual(model([old], now=NOW)["counts"]["stale"], 1)

    def test_duplicates_future_and_forged_health_rejected(self):
        data = snapshot()
        for rows in ([data,data], [snapshot(NOW+timedelta(seconds=1))],
                     [dict(data, operational_health_verified=True)]):
            with self.assertRaises(ValueError):
                model(rows, now=NOW)

    def test_untrusted_fields_rejected(self):
        data = snapshot()
        for key, value in (("component","<script>alert(1)</script>"),
                           ("source","remote_verified"), ("severity","high")):
            altered = copy.deepcopy(data)
            altered["operational"][0][key] = value
            with self.assertRaises(ValueError):
                model([altered], now=NOW)

    def test_same_second_not_current_head(self):
        data = snapshot()
        second = dict(data, commit_sha="b"*40)
        result = model([data,second], now=NOW)
        self.assertTrue(result["ambiguous_latest"])
        self.assertIn("Ordem atual ambígua", render(result))

    @unittest.skipUnless(os.name == "posix", "POSIX access policy")
    def test_private_file_and_no_overwrite(self):
        with TemporaryDirectory() as temp:
            path = Path(temp)
            path.chmod(0o755)
            with self.assertRaises(ValueError):
                write_private(path, "fixture")
            path.chmod(0o700)
            write_private(path, "fixture")
            self.assertEqual((path/"diagnostics.html").stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                write_private(path, "overwrite")
            self.assertEqual((path/"diagnostics.html").read_text(), "fixture")

    @unittest.skipUnless(os.name == "posix", "POSIX access policy")
    def test_output_symlink_rejected(self):
        with TemporaryDirectory() as temp:
            path = Path(temp)
            path.chmod(0o700)
            target = path/"target"
            target.write_text("untouched")
            (path/"diagnostics.html").symlink_to(target)
            with self.assertRaises(FileExistsError):
                write_private(path, "overwrite")
            self.assertEqual(target.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()
