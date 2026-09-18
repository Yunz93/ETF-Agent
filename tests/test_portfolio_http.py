import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from stockagent.handler import Handler


class PortfolioHttpTests(unittest.TestCase):
    def test_migration_commands_performance_and_rollback_via_http(self):
        with tempfile.TemporaryDirectory() as directory, patch('stockagent.blob_store.blob_enabled',return_value=False), patch('stockagent.blob_store.hydrate_local_json'), patch('stockagent.blob_store.persist_json'):
            path=Path(directory)/'workspace.json'
            path.write_text(json.dumps({'version':10,'etfs':[{'symbol':'513500','shares':100,'cost':2}]}))
            with patch('stockagent.workspace_store.WORKSPACE_PATH',path):
                server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
                thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                try:
                    base=f'http://127.0.0.1:{server.server_port}'
                    def request(route='/api/portfolio',body=None):
                        req=urllib.request.Request(base+route,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
                        try:
                            with urllib.request.urlopen(req,timeout=5) as response:
                                return response.status,json.load(response)
                        except urllib.error.HTTPError as error:
                            return error.code,json.load(error)
                    status,preview=request();self.assertEqual(status,200);self.assertFalse(preview['active'])
                    status,active=request(body={'action':'activate','workspace_updated_at':preview['workspace_updated_at'],'data':preview['portfolio']})
                    self.assertEqual(status,200)
                    status,_=request(body={'action':'configure','revision':0,'data':{'name':'stale'}})
                    self.assertEqual(status,409)
                    status,detail=request('/api/portfolio/performance?kind=product&id=exchange%3A513500')
                    self.assertEqual(status,200);self.assertIn('points',detail['performance'])
                    status,_=request('/api/portfolio/performance?kind=product&id=missing')
                    self.assertEqual(status,400)
                    status,_=request('/api/portfolio/simulation',{'budget':100,'account_id':'missing'})
                    self.assertEqual(status,400)
                    name=active['portfolio']['migration']['backup_file']
                    status,rolled=request(body={'action':'rollback','revision':active['portfolio']['revision'],'workspace_updated_at':active['workspace_updated_at'],'data':{'name':name}})
                    self.assertEqual(status,200);self.assertFalse(rolled['active'])
                    self.assertEqual(rolled['portfolio']['openings'][0]['shares'],100)
                finally:
                    server.shutdown();server.server_close();thread.join(timeout=5)
