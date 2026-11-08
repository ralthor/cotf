import sys
from pathlib import Path

import pytest

from cloud.engine import StockfishRunner
from cloud.models import AnalysisJob

pytestmark = pytest.mark.django_db
FAKE_ENGINE = f"{sys.executable} {Path(__file__).with_name('fake_uci.py')}"


def cp(v):
    return {"kind": "cp", "value": v, "perspective": "white"}


def test_runner_against_fake_engine(settings):
    with StockfishRunner(FAKE_ENGINE, threads=1, hash_mb=16) as r:
        res = r.analyse("rnbqkbnr/ppp1pppp/8/3p4/4P1Q1/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2", depth=2, multipv=2)
        assert res.lines[0]["pvUci"][0] == "c8g4"
        assert res.lines[0]["score"]["value"] < -500  # white-relative: Black wins the queen
        assert [d["depth"] for d in res.by_depth] == [1, 2]
        restricted = r.analyse("rnbqkbnr/ppp1pppp/8/3p4/4P1Q1/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2", 2, 1, ["a7a6"])
        assert restricted.lines[0]["pvUci"][0] == "a7a6"
        mate = r.analyse("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", 2)
        assert mate.terminal == "checkmate" and mate.lines[0]["score"]["winner"] == "b"


def test_cloud_job_end_to_end(api, games, settings, django_capture_on_commit_callbacks):
    settings.STOCKFISH_PATH = FAKE_ENGINE
    settings.CLOUD_ENGINE_THREADS = 1
    g = games["Blunder"]
    profiles = api.get("/api/engine-profiles/").json()
    assert {p["id"] for p in profiles["profiles"]} == {"cloud-standard", "cloud-deep"}
    with django_capture_on_commit_callbacks(execute=True):
        r = api.post(f"/api/games/{g.id}/analyse/", {"profile": "cloud-standard"}, format="json")
    assert r.status_code == 202, r.json()
    job = AnalysisJob.objects.get(id=r.json()["id"])
    assert job.status == "done", job.error
    detail = api.get(f"/api/analysis-jobs/{job.id}/").json()
    cats = [m["category"] for m in detail["analysis"]["moves"]]
    assert cats[2] == "blunder" and cats[3] == "best"
    assert detail["analysis"]["source"] == "cloud"
    assert detail["stats"]["max_depth_reached"] >= 1 and detail["stats"]["engine"] == "FakeFish 1.0"
    assert job.positions_analysed > 0


def test_cloud_quota_and_dedupe(api, games, settings, django_capture_on_commit_callbacks):
    settings.CELERY_TASK_ALWAYS_EAGER = False
    from config.celery import app

    app.conf.task_always_eager = False
    settings.CLOUD_MAX_ACTIVE_JOBS_PER_USER = 1
    g1, g2 = games["Blunder"], games["Fixture"]
    from unittest.mock import patch

    with patch("cloud.views.run_cloud_job.delay") as delay, django_capture_on_commit_callbacks(execute=True):
        a = api.post(f"/api/games/{g1.id}/analyse/", {"profile": "cloud-standard"}, format="json")
        b = api.post(f"/api/games/{g1.id}/analyse/", {"profile": "cloud-standard"}, format="json")
        c = api.post(f"/api/games/{g2.id}/analyse/", {"profile": "cloud-standard"}, format="json")
    assert a.status_code == 202 and b.status_code == 200 and b.json()["id"] == a.json()["id"]
    assert c.status_code == 429
    assert delay.call_count == 1
    cancel = api.post(f"/api/analysis-jobs/{a.json()['id']}/cancel/").json()
    assert cancel["status"] == "cancelled"
    settings.CLOUD_DAILY_QUOTA_POSITIONS = 0
    with patch("cloud.views.run_cloud_job.delay"):
        assert api.post(f"/api/games/{g2.id}/analyse/", {"profile": "cloud-deep"}, format="json").status_code == 429
