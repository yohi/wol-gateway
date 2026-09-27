from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WorkflowTests(unittest.TestCase):
    def test_deploy_workflow_uses_expected_cloudflare_inputs(self):
        text = (ROOT / ".github/workflows/deploy-worker.yml").read_text()
        self.assertIn("cloudflare/wrangler-action@v4", text)
        self.assertIn("secrets.CLOUDFLARE_API_TOKEN", text)
        self.assertIn("secrets.CLOUDFLARE_ACCOUNT_ID", text)
        self.assertIn("secrets.WOL_RELAY_SHARED_SECRET", text)
        self.assertIn("vars.CLOUDFLARE_TUNNEL_ID", text)
        self.assertIn("workingDirectory: \"worker\"", text)
        self.assertIn("--secrets-file .secrets.production.json", text)

    def test_ci_has_no_live_wrangler_deploy(self):
        text = (ROOT / ".github/workflows/ci.yml").read_text()
        for line in text.splitlines():
            if "wrangler" in line and "deploy" in line:
                self.assertIn("--dry-run", line)

    def test_workflows_do_not_contain_literal_cloudflare_tokens(self):
        combined = "\n".join(
            path.read_text() for path in (ROOT / ".github/workflows").glob("*.yml")
        )
        self.assertIsNone(re.search(r"(?:apiToken|WOL_RELAY_SHARED_SECRET):\s+[A-Za-z0-9_-]{24,}$", combined, re.MULTILINE))


if __name__ == "__main__":
    unittest.main()
