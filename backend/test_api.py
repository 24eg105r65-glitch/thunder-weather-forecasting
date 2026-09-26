"""Verification test script for Aerocast-AI backend endpoints."""

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_endpoints():
    print("Testing Aerocast-AI API Endpoints...")
    
    # 1. Status
    res = client.get("/api/status")
    assert res.status_code == 200, f"Status failed: {res.text}"
    print("[OK] /api/status OK:", res.json()["service_name"])
    
    # 2. Regions
    res = client.get("/api/regions")
    assert res.status_code == 200
    regions = res.json()
    print(f"[OK] /api/regions OK: Found {len(regions)} regions ({[r['id'] for r in regions]})")
    
    # 3. Full Nowcast for Hyderabad at t0
    res = client.get("/api/nowcast?region=hyderabad&time_offset=0")
    assert res.status_code == 200, f"Nowcast failed: {res.text}"
    data = res.json()
    print(f"[OK] /api/nowcast OK:")
    print(f"   * Region: {data['region_name']}")
    print(f"   * 30m Thunderstorm Probability: {data['nowcasts']['30m']['thunderstorm_probability']*100:.1f}% ({data['nowcasts']['30m']['thunderstorm_risk']})")
    print(f"   * 60m Thunderstorm Probability: {data['nowcasts']['60m']['thunderstorm_probability']*100:.1f}% ({data['nowcasts']['60m']['thunderstorm_risk']})")
    print(f"   * Active Convective Cells: {len(data['active_cells'])}")
    print(f"   * Recent Lightning Strikes: {len(data['recent_lightning_strikes'])}")
    print(f"   * Active Alerts: {len(data['active_alerts'])}")
    
    # 4. Radar Grid
    res = client.get("/api/radar-grid?region=hyderabad&time_offset=0")
    assert res.status_code == 200
    r_grid = res.json()
    print(f"[OK] /api/radar-grid OK: Grid shape {r_grid['rows']}x{r_grid['cols']}, Max dBZ: {r_grid['max_dbz']}")
    
    # 5. Model Performance
    res = client.get("/api/model-performance")
    assert res.status_code == 200
    perf = res.json()
    print(f"[OK] /api/model-performance OK: Overall ROC-AUC = {perf['metrics']['overall_roc_auc']}")
    
    # 6. Interactive Custom Sandbox
    sample_obs = {
        "timestamp": "2026-09-24T23:00:00Z",
        "region_id": "hyderabad",
        "lat": 17.3850,
        "lon": 78.4867,
        "max_reflectivity_dbz": 54.0,
        "mean_reflectivity_dbz": 42.0,
        "vil_kg_m2": 32.0,
        "echo_top_km": 14.5,
        "reflectivity_trend_15min": 4.5,
        "cloud_top_temp_c": -68.0,
        "cloud_cooling_rate_15min": -8.5,
        "water_vapor_bt_c": -64.0,
        "flash_count_15min": 45,
        "flash_rate_per_min": 18.0,
        "lightning_jump_sigma": 2.8,
        "cg_ratio": 0.35,
        "cape_j_kg": 2900.0,
        "cin_j_kg": 18.0,
        "lifted_index": -6.5,
        "k_index": 39.0,
        "surface_temp_c": 35.0,
        "dew_point_c": 25.5,
        "wind_shear_0_6km_mps": 21.0,
        "rh_850hpa_pct": 82.0
    }
    res = client.post("/api/predict-custom", json=sample_obs)
    assert res.status_code == 200, f"Custom predict failed: {res.text}"
    custom_pred = res.json()
    print(f"[OK] /api/predict-custom OK: 30m Prob = {custom_pred['predictions']['30m']['thunderstorm_probability']*100:.1f}%, Risk = {custom_pred['predictions']['30m']['thunderstorm_risk']}")

    # 7. Thermodynamic Sounding

    res = client.get("/api/sounding?region=hyderabad&time_offset=0")
    assert res.status_code == 200, f"Sounding failed: {res.text}"
    snd = res.json()
    print(f"[OK] /api/sounding OK: CAPE={snd['cape_j_kg']} J/kg, CIN={snd['cin_j_kg']} J/kg, Levels={len(snd['levels'])}")

    # 8. Model Benchmark
    res = client.get("/api/model-benchmark")
    assert res.status_code == 200
    benchmarks = res.json()
    print(f"[OK] /api/model-benchmark OK: {len(benchmarks)} benchmarked models")

    # 9. Meteogram Series
    res = client.get("/api/meteogram?region=hyderabad")
    assert res.status_code == 200
    mg = res.json()
    print(f"[OK] /api/meteogram OK: {len(mg['data_points'])} timeline points")

    # 10. OASIS CAP XML Feed
    res = client.get("/api/alerts/cap.xml?region=hyderabad&time_offset=0")
    assert res.status_code == 200 and "urn:oasis:names:tc:emergency:cap:1.2" in res.text
    print(f"[OK] /api/alerts/cap.xml OK: Valid OASIS CAP v1.2 XML feed")

    # 11. GeoJSON Alert Polygons
    res = client.get("/api/alerts/geojson?region=hyderabad&time_offset=0")
    assert res.status_code == 200
    gj = res.json()
    print(f"[OK] /api/alerts/geojson OK: FeatureCollection with {len(gj['features'])} features")

    # 12. Meteorological Bulletin Export
    res = client.get("/api/export-bulletin?region=hyderabad&time_offset=0")
    assert res.status_code == 200 and "AEROCAST-AI METEOROLOGICAL NOWCAST BULLETIN" in res.text
    print(f"[OK] /api/export-bulletin OK: Plaintext bulletin generated")

    # 13. Area Search API
    res = client.get("/api/search-locations?q=gachibowli")
    assert res.status_code == 200, f"Search locations failed: {res.text}"
    search_data = res.json()
    assert len(search_data) > 0, "Expected at least 1 search result for 'gachibowli'"
    print(f"[OK] /api/search-locations OK: Found {len(search_data)} results for 'gachibowli' (Top: {search_data[0]['name']})")

    # 14. Area Threat Assessment API
    gachi = search_data[0]
    res = client.get(f"/api/area-assessment?lat={gachi['lat']}&lon={gachi['lon']}&time_offset=0&name={gachi['name']}")
    assert res.status_code == 200, f"Area assessment failed: {res.text}"
    assessment = res.json()
    assert "threat_level" in assessment
    print(f"[OK] /api/area-assessment OK: {assessment['location_name']} -> Threat: {assessment['threat_level']} ({assessment['threat_score_pct']}%), Local dBZ: {assessment['local_dbz']}, Nearest Cell: {assessment['distance_to_nearest_cell_km']} km")
    
    print("\n[ALL TESTS PASSED SUCCESSFULLY!]")


if __name__ == "__main__":
    test_endpoints()

