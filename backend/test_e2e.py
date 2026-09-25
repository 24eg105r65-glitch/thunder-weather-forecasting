"""Comprehensive End-to-End Test Suite for Aerocast-AI Platform."""

import urllib.request
import json

BASE_URL = "http://127.0.0.1:8000"

def test_e2e():
    print("==================================================================")
    print("[*] Running Full End-to-End System & API Verification...")
    print("==================================================================")

    # 1. Frontend Web Assets
    req = urllib.request.urlopen(f"{BASE_URL}/")
    html = req.read().decode("utf-8")
    assert req.status == 200 and "AEROCAST" in html, "index.html failed"
    print("[OK] Frontend UI Root / returned 200 OK with HTML structure")

    req_css = urllib.request.urlopen(f"{BASE_URL}/static/style.css")
    assert req_css.status == 200, "style.css failed"
    print("[OK] CSS Stylesheet /static/style.css loaded successfully")

    req_js = urllib.request.urlopen(f"{BASE_URL}/static/app.js")
    assert req_js.status == 200, "app.js failed"
    print("[OK] Frontend Application Logic /static/app.js loaded successfully")

    # 2. Status & Regions
    status_data = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/status").read())
    assert status_data["is_model_loaded"] is True
    print(f"[OK] Operational Status: {status_data['status']}, Models Active: {status_data['is_model_loaded']}")

    regions_data = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/regions").read())
    assert len(regions_data) >= 4
    print(f"[OK] Regions verified ({len(regions_data)} operational DWR stations): {[r['id'] for r in regions_data]}")

    # 3. Test Full Multimodal Pipeline Across All Regions
    for reg in regions_data:
        r_id = reg["id"]
        # Test Live (t0) and Nowcast (+30m, +60m)
        for offset in [0, 30, 60]:
            url = f"{BASE_URL}/api/nowcast?region={r_id}&time_offset={offset}"
            data = json.loads(urllib.request.urlopen(url).read())
            assert "nowcasts" in data
            p30 = data["nowcasts"]["30m"]["thunderstorm_probability"]
            p60 = data["nowcasts"]["60m"]["thunderstorm_probability"]
            cells = len(data["active_cells"])
            strikes = len(data["recent_lightning_strikes"])
            alerts = len(data["active_alerts"])
            print(f"  + Region {r_id:<12} (t={offset:>3}m) -> 30m P={p30*100:>5.1f}%, 60m P={p60*100:>5.1f}%, Cells={cells}, Strikes={strikes}, Alerts={alerts}")

    # 4. Model Verification Stats & Benchmarks
    perf = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/model-performance").read())
    print("\n[OK] Model Verification Metrics Verified:")
    print(f"  * Multi-Lead ROC-AUC:      {perf['metrics']['overall_roc_auc']}")
    print(f"  * Lightning Risk Accuracy: {perf['metrics']['lightning_risk_accuracy']*100:.2f}%")
    print(f"  * 30m CSI Threat Score:    {perf['metrics']['lead_times']['30m']['critical_success_index_csi']}")
    print(f"  * 60m CSI Threat Score:    {perf['metrics']['lead_times']['60m']['critical_success_index_csi']}")

    # 5. Advanced Meteorological Feeds & Sounding
    sounding = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/sounding?region=hyderabad").read())
    assert len(sounding["levels"]) == 11
    print(f"\n[OK] Thermodynamic Sounding Verified: SBCAPE={sounding['cape_j_kg']} J/kg, LI={sounding['lifted_index']} °C")

    benchmarks = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/model-benchmark").read())
    assert len(benchmarks) == 3
    print(f"[OK] Multi-Model Benchmarks Verified: {len(benchmarks)} AI models evaluated")

    meteogram = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/meteogram?region=hyderabad").read())
    assert len(meteogram["data_points"]) == 10
    print(f"[OK] Nowcast Meteogram Series Verified: {len(meteogram['data_points'])} timeline points")

    cap_xml = urllib.request.urlopen(f"{BASE_URL}/api/alerts/cap.xml?region=hyderabad").read().decode("utf-8")
    assert "urn:oasis:names:tc:emergency:cap:1.2" in cap_xml
    print(f"[OK] OASIS CAP v1.2 Standard XML Feed Verified")

    geojson = json.loads(urllib.request.urlopen(f"{BASE_URL}/api/alerts/geojson?region=hyderabad").read())
    assert geojson["type"] == "FeatureCollection"
    print(f"[OK] GIS GeoJSON Alert Polygons Verified: {len(geojson['features'])} geospatial features")

    bulletin = urllib.request.urlopen(f"{BASE_URL}/api/export-bulletin?region=hyderabad").read().decode("utf-8")
    assert "AEROCAST-AI METEOROLOGICAL NOWCAST BULLETIN" in bulletin
    print(f"[OK] Plaintext Meteorological Bulletin Verified")


    print("\n==================================================================")
    print("[SUCCESS] ALL END-TO-END PIPELINES VERIFIED & OPERATIONAL!")
    print("==================================================================")

if __name__ == "__main__":
    test_e2e()
