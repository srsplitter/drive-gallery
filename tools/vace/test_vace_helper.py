"""CPU-only contract/security tests; never contacts a model server or runs inference."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

from vace_helper import APIError, App, Handler, ThreadingHTTPServer, MAX_CHUNK, MAX_SAFE_INTEGER, RESERVE, range_bounds


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="helper-test-", dir=Path(__file__).resolve().parent)
        self.app = App(Path(self.tmp.name))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.app = self.app
        self.app.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, data=None, headers=None):
        base = {"Origin": "https://srsplitter.github.io", "X-Vace-Client": "drive-gallery"}
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            base["Content-Type"] = "application/json"
        base.update(headers or {})
        connection = http.client.HTTPConnection("127.0.0.1", self.app.port, timeout=3)
        connection.request(method, path, body=data, headers=base)
        response = connection.getresponse()
        status, result_headers, body = response.status, dict(response.getheaders()), response.read()
        connection.close()
        if result_headers.get("Content-Type", "").startswith("application/json"):
            body = json.loads(body)
        return status, result_headers, body

    def upload(self, payload=b"abcdef"):
        status, _, data = self.request("POST", "/uploads", {"name": "../display.mp4", "size": len(payload)})
        self.assertEqual(status, 201)
        uid = data["id"]
        status, _, result = self.request("PUT", f"/uploads/{uid}?offset=0", payload)
        self.assertEqual(status, 200)
        self.assertTrue(result["complete"])
        return uid

    def test_origin_host_and_mutation_header(self):
        for headers in ({"Origin": "https://attacker.invalid"}, {"X-Vace-Client": "wrong"},
                        {"Host": "attacker.invalid"}, {"Host": f"127.0.0.1.evil:{self.app.port}"}):
            self.assertEqual(self.request("POST", "/uploads", {"size": 1}, headers)[0], 403)
        self.assertEqual(len(self.app.uploads), 0)

    def test_preflight_allows_private_network_only_for_allowed_site(self):
        status, headers, _ = self.request("OPTIONS", "/uploads")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://srsplitter.github.io")
        status, headers, _ = self.request("OPTIONS", "/uploads", headers={"Origin": "null"})
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_upload_order_and_no_filename_path_traversal(self):
        _, _, data = self.request("POST", "/uploads", {"name": "../../outside.mp4", "size": 6})
        uid = data["id"]
        endpoint = f"/uploads/{uid}"
        self.assertEqual(self.request("PUT", endpoint + "?offset=1", b"abc")[0], 409)
        self.assertEqual(self.request("PUT", endpoint + "?offset=0", b"abc")[0], 200)
        status, _, info = self.request("GET", endpoint)
        self.assertEqual((status, info["received"], info["complete"]), (200, 3, False))
        self.assertEqual(self.request("PUT", endpoint + "?offset=0", b"abc")[0], 409)
        self.assertEqual(self.request("PUT", endpoint + "?offset=3", b"defg")[0], 409)
        self.assertEqual(self.request("PUT", endpoint + "?offset=3", b"def")[0], 200)
        stored = self.app.uploads[uid]["path"]
        self.assertTrue(stored.is_relative_to(self.app.jobs_root))
        self.assertEqual(stored.read_bytes(), b"abcdef")
        self.assertEqual(self.request("PUT", endpoint + "?offset=6", b"g")[0], 409)

    def test_invalid_upload_sizes(self):
        for size in (0, -1, True, False, 1.0, "123", None, MAX_SAFE_INTEGER + 1):
            with self.subTest(size=size):
                self.assertEqual(self.request("POST", "/uploads", {"size": size})[0], 400)
        self.assertEqual(self.app.uploads, {})

    def test_large_metadata_and_remaining_upload_reservations(self):
        gib = 1024**3
        with patch("vace_helper.shutil.disk_usage") as disk:
            disk.return_value.free = RESERVE + 5 * gib
            status, _, data = self.request("POST", "/uploads", {"size": 3 * gib})
            self.assertEqual(status, 201)
            upload = self.app.uploads[data["id"]]
            self.assertEqual(upload["path"].stat().st_size, 0)
            self.assertEqual(self.app.upload_capacity()["available_upload_bytes"], 2 * gib)
            self.assertEqual(self.request("POST", "/uploads", {"size": 2 * gib + 1})[0], 507)
            self.assertEqual(self.request("PUT", f"/uploads/{data['id']}?offset=0", b"abcd")[0], 200)
            disk.return_value.free -= 4
            capacity = self.app.upload_capacity()
            self.assertEqual(capacity["reserved_upload_bytes"], 3 * gib - 4)
            self.assertEqual(capacity["available_upload_bytes"], 2 * gib)
            self.assertEqual(self.request("POST", "/uploads", {"size": 2 * gib})[0], 201)
            self.assertEqual(self.request("POST", "/uploads", {"size": 1})[0], 507)
            self.assertEqual(upload["path"].stat().st_size, 4)

    def test_offset_above_two_gib_is_not_truncated(self):
        offset = 2 * 1024**3 + 123
        with patch("vace_helper.shutil.disk_usage") as disk:
            disk.return_value.free = RESERVE + offset + 10
            _, _, data = self.request("POST", "/uploads", {"size": offset + 4})
            upload = self.app.uploads[data["id"]]
            upload["received"] = offset
            # Simulate already-transferred bytes; never allocate a multi-gigabyte file.
            fake_path = MagicMock()
            upload["path"] = fake_path
            status, _, result = self.request("PUT", f"/uploads/{data['id']}?offset={offset}", b"abc")
            self.assertEqual(status, 200)
            self.assertEqual(result["received"], offset + 3)
            output = fake_path.open.return_value.__enter__.return_value
            output.seek.assert_called_once_with(offset)
            output.write.assert_called_once_with(b"abc")

    def test_health_capacity_is_live_even_when_engine_status_is_cached(self):
        with patch("vace_helper.urllib.request.urlopen", side_effect=OSError("test: no engine")), \
             patch("vace_helper.shutil.disk_usage") as disk:
            disk.return_value.free = RESERVE + 100
            first = self.app.health()
            self.assertEqual(first["max_upload_bytes"], MAX_SAFE_INTEGER)
            self.assertEqual(first["available_upload_bytes"], 100)
            self.assertEqual(first["disk_reserve_bytes"], RESERVE)
            self.app.new_upload({"size": 40})
            second = self.app.health()
            self.assertEqual(second["available_upload_bytes"], 60)
            self.assertEqual(second["reserved_upload_bytes"], 40)
            disk.return_value.free = RESERVE + 30
            self.assertEqual(self.app.health()["available_upload_bytes"], 0)

    def test_chunk_limit_and_disk_reserve_reject_before_writing(self):
        with patch("vace_helper.shutil.disk_usage") as disk:
            disk.return_value.free = 10
            self.assertEqual(self.request("POST", "/uploads", {"size": 1})[0], 507)
        _, _, data = self.request("POST", "/uploads", {"size": 20})
        status, _, _ = self.request("PUT", f"/uploads/{data['id']}?offset=0", b"", {"Content-Length": str(MAX_CHUNK + 1)})
        self.assertEqual(status, 413)
        self.assertEqual(self.app.uploads[data["id"]]["path"].stat().st_size, 0)
        with patch("vace_helper.shutil.disk_usage") as disk:
            disk.return_value.free = RESERVE + 2
            self.assertEqual(self.request("PUT", f"/uploads/{data['id']}?offset=0", b"abc")[0], 507)
            self.assertEqual(self.app.uploads[data["id"]]["path"].stat().st_size, 0)
            disk.return_value.free = RESERVE + 3
            self.assertEqual(self.request("PUT", f"/uploads/{data['id']}?offset=0", b"abc")[0], 200)

    def test_job_validation_and_single_worker(self):
        uid = self.upload()
        self.app.uploads[uid]["metadata"] = dict(width=1920, height=1080, duration=10)
        payload = dict(upload_id=uid, start=1, duration=3, box=[0.2, 0.2, 0.4, 0.4], prompt="A fictional adult face")
        with patch.object(self.app, "health", return_value=dict(ready=True, busy=False)), patch.object(self.app, "process_job"):
            status, _, result = self.request("POST", "/jobs", payload)
            self.assertEqual(status, 202)
            self.assertEqual((result["frames"], result["fps"]), (45, 16))
            self.assertLessEqual(result["width"], 832)
            self.assertLessEqual(result["height"], 480)
            self.assertEqual((result["width"] % 16, result["height"] % 16), (0, 0))
            self.assertEqual(self.request("POST", "/jobs", payload)[0], 409)
        for changes in (dict(start=float("nan")), dict(duration=6), dict(box=[0, 0, 2, 1]),
                        dict(box=[0.5, 0.5, 0.1, 0.1]), dict(upload_id=[]), dict(start=9)):
            self.assertEqual(self.request("POST", "/jobs", dict(payload, **changes))[0], 400)

    def test_unready_engine_does_not_accept_job(self):
        uid = self.upload()
        self.app.uploads[uid]["metadata"] = dict(width=640, height=480, duration=10)
        with patch.object(self.app, "health", return_value=dict(ready=False, busy=False, error="Models incomplete")):
            status, _, data = self.request("POST", "/jobs", dict(upload_id=uid, start=0, duration=1,
                box=[0, 0, 1, 1], prompt="fictional adult"))
        self.assertEqual(status, 503)
        self.assertEqual(self.app.jobs, {})

    def test_mp4_ranges_and_unknown_paths(self):
        jid = "a" * 32
        folder = self.app.jobs_root / ("job-" + jid)
        (folder / "final").mkdir(parents=True)
        (folder / "final/composite.mp4").write_bytes(b"0123456789")
        self.app.jobs[jid] = dict(id=jid, status="done", stage="done", folder=folder)
        for value, expected in (("bytes=2-5", b"2345"), ("bytes=7-", b"789"), ("bytes=-3", b"789")):
            status, headers, body = self.request("GET", f"/jobs/{jid}/output", headers={"Range": value})
            self.assertEqual((status, body), (206, expected))
            self.assertEqual(headers["Accept-Ranges"], "bytes")
        self.assertEqual(self.request("GET", f"/jobs/{jid}/output", headers={"Range": "bytes=20-"})[0], 416)
        self.assertEqual(self.request("GET", "/jobs/../../windows/system.ini")[0], 404)


class RangeTests(unittest.TestCase):
    def test_invalid_ranges(self):
        for value in ("bytes=5-2", "bytes=-0", "bytes=1-2,4-5", "bytes=-", "garbage"):
            with self.assertRaises(APIError):
                range_bounds(value, 10)


if __name__ == "__main__":
    unittest.main()
