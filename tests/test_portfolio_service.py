import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from stockagent import workspace_store
from stockagent.portfolio_ledger import PortfolioError
from stockagent.portfolio_service import PortfolioConflict, get_portfolio, portfolio_command


class PortfolioServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "workspace.json"
        self.original = {"version": 10, "updated_at": "2026-01-01T00:00:00Z", "etfs": [
            {"symbol": "513500", "name": "标普", "shares": 100, "cost": 2}], "buys": [], "sells": []}
        self.path.write_text(json.dumps(self.original))
        for target, kwargs in [
            ("stockagent.workspace_store.WORKSPACE_PATH", {"new": self.path}),
            ("stockagent.blob_store.blob_enabled", {"return_value": False}),
            ("stockagent.blob_store.hydrate_local_json", {"return_value": None}),
            ("stockagent.blob_store.persist_json", {"return_value": None}),
        ]:
            patcher = patch(target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)

    def activate(self):
        preview = get_portfolio()
        return portfolio_command({"action": "activate", "workspace_updated_at": preview["workspace_updated_at"], "data": preview["portfolio"]})

    def test_preview_readonly_and_activation_has_exact_backup(self):
        before = self.path.read_bytes()
        preview = get_portfolio()
        self.assertFalse(preview["active"])
        self.assertEqual(before, self.path.read_bytes())
        activated = self.activate()
        self.assertTrue(activated["active"])
        self.assertEqual(activated["portfolio"]["revision"], 1)
        backup = self.path.with_name(activated["portfolio"]["migration"]["backup_file"])
        self.assertEqual(before, backup.read_bytes())
        self.assertEqual(workspace_store.get_workspace()["version"], 11)

    def test_stale_commands_and_double_activation_do_not_write(self):
        activated = self.activate()
        before = self.path.read_bytes()
        with self.assertRaises(PortfolioConflict):
            portfolio_command({"action": "configure", "revision": 0, "data": {"name": "stale"}})
        with self.assertRaises(PortfolioConflict):
            portfolio_command({"action": "activate", "data": activated["portfolio"]})
        self.assertEqual(before, self.path.read_bytes())

    def test_legacy_save_cannot_erase_ledger(self):
        self.activate()
        workspace_store.save_workspace(self.original)
        self.assertIn("portfolio", workspace_store.get_workspace())

    def test_record_confirm_and_duplicate_confirmation(self):
        p = self.activate()["portfolio"]
        result = portfolio_command({"action": "record", "revision": p["revision"], "data": {
            "id": "pending:1", "type": "buy", "status": "pending", "date": p["baseline_date"],
            "account_id": "legacy", "product_id": "exchange:513500", "amount": 100}})
        result = portfolio_command({"action": "confirm", "revision": result["portfolio"]["revision"], "data": {
            "id": "pending:1", "date": p["baseline_date"], "shares": 50, "price": 2, "fee": 0}})
        self.assertEqual(result["summary"]["products"][0]["shares"], 150)
        with self.assertRaises(PortfolioError):
            portfolio_command({"action": "confirm", "revision": result["portfolio"]["revision"], "data": {"id": "pending:1"}})

    def test_invalid_ledger_is_not_silently_read_as_empty_workspace(self):
        result = self.activate()
        saved = json.loads(self.path.read_text())
        saved["portfolio"]["categories"][0]["target_pct"] = 10
        self.path.write_text(json.dumps(saved))
        with self.assertRaises(PortfolioError):
            get_portfolio()

    def test_rollback_restores_legacy_and_backs_up_new_ledger(self):
        active = self.activate()
        name = active["portfolio"]["migration"]["backup_file"]
        before = self.path.read_bytes()
        result = portfolio_command({"action":"rollback", "revision":1,
                                    "workspace_updated_at":active["workspace_updated_at"], "data":{"name":name}})
        self.assertFalse(result["active"])
        self.assertEqual(workspace_store.get_workspace()["etfs"][0]["shares"],100)
        self.assertTrue(any(p.read_bytes() == before for p in self.path.parent.glob("workspace-before-portfolio-*.json")))
        with self.assertRaises(PortfolioConflict):
            portfolio_command({"action":"configure", "revision":1, "data":{"name":"stale"}})

    def test_rollback_cannot_read_arbitrary_paths_or_symlinks(self):
        active = self.activate()
        link = self.path.with_name("workspace-before-portfolio-link.json")
        link.symlink_to(self.path)
        for name in ("../workspace.json", "workspace.json", link.name):
            with self.subTest(name=name), self.assertRaises(PortfolioError):
                portfolio_command({"action":"rollback", "revision":1,
                                    "workspace_updated_at":active["workspace_updated_at"], "data":{"name":name}})

    def test_restore_import_preserves_backup_and_uses_new_revision(self):
        active=self.activate()
        original_bytes=self.path.read_bytes()
        restored=active['portfolio']
        restored['name']='导入的组合'
        restored['revision']=900
        result=portfolio_command({'action':'restore','revision':1,'data':restored})
        self.assertEqual(result['portfolio']['revision'],2)
        self.assertEqual(result['portfolio']['name'],'导入的组合')
        self.assertTrue(any(p.read_bytes()==original_bytes for p in self.path.parent.glob('workspace-before-portfolio-restore-*.json')))
        with self.assertRaises(PortfolioConflict):
            portfolio_command({'action':'restore','revision':1,'data':restored})


if __name__ == "__main__":
    unittest.main()
