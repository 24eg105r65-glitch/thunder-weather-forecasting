"""FastAPI Backend Application for Multimodal Thunderstorm & Lightning Nowcasting (Aerocast-AI).

Serves RESTful APIs, WebSocket live streams, and GIS interactive dashboard.
"""

import os
import json
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse

from .core.schemas import (
    AtmosphericObservation,
    NowcastPrediction,
    FullNowcastResponse,
    RadarGridResponse,
    SatelliteGridResponse,
    EarlyWarningAlert,
    ThermodynamicSoundingProfile,
    ModelBenchmarkData
)
from .core.data_generator import REGIONS, get_all_regions
from .services.nowcast_service import NowcastService



app = FastAPI(
    title="Aerocast-AI: Multimodal Thunderstorm & Lightning Nowcasting Platform",
    description="Operational AI/ML Nowcasting Engine fusing Doppler Weather Radar, INSAT-3D Satellite, Lightning Networks, and NWP Model data.",
    version="2.0.0"
)

# Enable CORS for local & network development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize single service instance
service = NowcastService()

TIMELINE_STEPS = [
    {"offset_min": -60, "label": "t - 60 min", "type": "observed"},
    {"offset_min": -45, "label": "t - 45 min", "type": "observed"},
    {"offset_min": -30, "label": "t - 30 min", "type": "observed"},
    {"offset_min": -15, "label": "t - 15 min", "type": "observed"},
    {"offset_min": 0,   "label": "t0 (Live Scan)", "type": "observed"},
    {"offset_min": 15,  "label": "t + 15 min (AI Nowcast)", "type": "nowcasted"},
    {"offset_min": 30,  "label": "t + 30 min (AI Nowcast)", "type": "nowcasted"},
    {"offset_min": 45,  "label": "t + 45 min (AI Nowcast)", "type": "nowcasted"},
    {"offset_min": 60,  "label": "t + 60 min (AI Nowcast)", "type": "nowcasted"},
    {"offset_min": 90,  "label": "t + 90 min (AI Nowcast)", "type": "nowcasted"},
]


@app.get("/api/status")
def get_status():
    """Health check and model status metadata."""
    return {
        "status": "operational",
        "service_name": "Aerocast-AI Nowcaster",
        "version": "2.0.0",
        "is_model_loaded": service.tabular_model.is_trained,
        "supported_lead_times": ["30m", "60m", "90m"],
        "sensors_integrated": [
            "IMD Doppler Weather Radar (DWR C-Band / S-Band)",
            "INSAT-3D / 3DR Geostationary Satellite (TIR-1, TIR-2, WV)",
            "IITM / IMD Lightning Detection Network (LNDN / GLD360)",
            "NWP Numerical Weather Prediction (WRF / GFS / ERA5 Soundings)"
        ],
        "active_regions_count": len(REGIONS)
    }


@app.get("/api/regions")
def get_regions():
    """Get list of active meteorological forecast zones and DWR stations."""
    return get_all_regions()


@app.get("/api/timeline")
def get_timeline():
    """Get available historical observation and AI nowcast timeline steps."""
    return TIMELINE_STEPS


@app.get("/api/nowcast", response_model=FullNowcastResponse)
def get_full_nowcast(
    region: str = Query("hyderabad", description="Region ID (hyderabad, kolkata, delhi, bhubaneswar)"),
    time_offset: int = Query(0, description="Time offset in minutes (-60 to +90)")
):
    """Execute end-to-end multimodal nowcast and return active cells, lightning, and CAP alerts."""
    if region not in REGIONS:
        region = "hyderabad"
    return service.run_full_nowcast(region_id=region, time_offset_min=time_offset)


@app.get("/api/radar-grid", response_model=RadarGridResponse)
def get_radar_grid(
    region: str = Query("hyderabad"),
    time_offset: int = Query(0)
):
    """Get 2D radar reflectivity grid (dBZ) with RGBA colormap matrix."""
    if region not in REGIONS:
        region = "hyderabad"
    return service.get_radar_grid_response(region_id=region, time_offset_min=time_offset)


@app.get("/api/satellite-grid", response_model=SatelliteGridResponse)
def get_satellite_grid(
    region: str = Query("hyderabad"),
    time_offset: int = Query(0)
):
    """Get 2D INSAT-3D enhanced infrared cloud top temperature grid."""
    if region not in REGIONS:
        region = "hyderabad"
    return service.get_satellite_grid_response(region_id=region, time_offset_min=time_offset)


@app.get("/api/alerts", response_model=List[EarlyWarningAlert])
def get_alerts(region: str = Query("hyderabad"), time_offset: int = Query(0)):
    """Get active CAP early warning alerts."""
    nowcast = service.run_full_nowcast(region_id=region, time_offset_min=time_offset)
    return nowcast.active_alerts


@app.get("/api/model-performance")
def get_model_performance():
    """Retrieve full meteorological model validation scores, CSI, ROC-AUC, FAR, and feature importances."""
    return {
        "metrics": service.tabular_model.metrics,
        "model_architecture": {
            "baseline_tabular": "Multi-Output Tuned XGBoost Classifier + Random Forest 4-Class Lightning Risk",
            "spatiotemporal_radar": "SCIT/TITAN Convective Cell Clustering + Semi-Lagrangian Optical Flow Advection",
            "validation_method": "Holdout Test (N=1,250) with Meteorological Threat Scoring (CSI, POD, FAR, ROC-AUC)",
            "physics_grounding": "Schultz 2-sigma Lightning Jump Algorithm, Marshall-Palmer Convective Z-R, VIL Density, CAPE/CIN/Lapse Rates"
        }
    }


@app.post("/api/predict-custom")
def predict_custom_observation(obs: AtmosphericObservation):
    """Interactive What-If AI Sandbox: Run live ML inference on custom atmospheric parameters."""
    try:
        predictions = service.tabular_model.predict_observation(obs)
        return {
            "status": "success",
            "observation_received": obs,
            "predictions": predictions
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/sounding", response_model=ThermodynamicSoundingProfile)
def get_atmospheric_sounding(
    region: str = Query("hyderabad"),
    time_offset: int = Query(0)
):

    """Retrieve full vertical Skew-T atmospheric sounding profile and thermodynamic instability indices."""
    return service.get_sounding_response(region_id=region, time_offset_min=time_offset)


@app.get("/api/model-benchmark", response_model=List[ModelBenchmarkData])
def get_model_benchmarks():
    """Retrieve comparative multi-model benchmark evaluation (XGBoost vs Optical Flow vs ConvLSTM/FNO)."""
    return service.get_model_benchmarks_response()


@app.get("/api/meteogram")
def get_meteogram(region: str = Query("hyderabad")):
    """Retrieve historical observation and nowcast trend time-series for meteogram charts."""
    return service.get_meteogram_series(region_id=region)


@app.get("/api/alerts/cap.xml")
def get_cap_xml_feed(region: str = Query("hyderabad"), time_offset: int = Query(0)):
    """Export standard OASIS CAP-v1.2 compliant early warning XML feed for NDMA / IMD / civil defense."""
    xml_content = service.get_cap_xml_response(region_id=region, time_offset_min=time_offset)
    return Response(content=xml_content, media_type="application/xml")


@app.get("/api/alerts/geojson")
def get_alerts_geojson(region: str = Query("hyderabad"), time_offset: int = Query(0)):
    """Export standard GeoJSON FeatureCollection for GIS software (QGIS, ArcGIS, Mapbox, Leaflet)."""
    geojson_data = service.get_geojson_response(region_id=region, time_offset_min=time_offset)
    return Response(content=json.dumps(geojson_data, indent=2), media_type="application/geo+json")


@app.get("/api/export-bulletin")
def get_export_bulletin(region: str = Query("hyderabad"), time_offset: int = Query(0)):
    """Generate structured markdown / text bulletin suitable for meteorological briefings & dispatches."""
    nowcast = service.run_full_nowcast(region_id=region, time_offset_min=time_offset)
    p30 = nowcast.nowcasts["30m"]
    p60 = nowcast.nowcasts["60m"]
    
    bulletin = f"""========================================================================
⚡ AEROCAST-AI METEOROLOGICAL NOWCAST BULLETIN
ISSUED BY: Automated Convective Early Warning Engine (IMD / NDMA Standard)
TIMESTAMP: {nowcast.current_time}
FORECAST REGION: {nowcast.region_name} (ID: {nowcast.region_id.upper()})
OVERALL THREAT LEVEL: {nowcast.overall_threat_level.upper()}
========================================================================

1. CONVECTIVE NOWCAST SUMMARY:
   * +30 Min Lead: Storm Probability {p30.thunderstorm_probability*100:.1f}%, Risk: {p30.thunderstorm_risk}, Lightning: {p30.lightning_risk}
   * +60 Min Lead: Storm Probability {p60.thunderstorm_probability*100:.1f}%, Risk: {p60.thunderstorm_risk}, Lightning: {p60.lightning_risk}
   * Motion Vector: Moving {p30.storm_direction_cardinal} ({p30.storm_heading_deg:.0f}°) at {p30.storm_speed_kmh:.0f} km/h
   * Trend: {p30.cell_growth_trend} ({p30.storm_classification})

2. MULTI-SENSOR IN SITU OBSERVATIONS:
   * Radar Core Reflectivity: {nowcast.observation.max_reflectivity_dbz:.1f} dBZ (VIL: {nowcast.observation.vil_kg_m2:.1f} kg/m², Echo Top: {nowcast.observation.echo_top_km:.1f} km)
   * INSAT-3D Cloud Top Temp: {nowcast.observation.cloud_top_temp_c:.1f} °C (Cooling Rate: {nowcast.observation.cloud_cooling_rate_15min:.1f} °C/15m)
   * Lightning Activity: {nowcast.observation.flash_count_15min} flashes in past 15 min ({nowcast.observation.flash_rate_per_min:.1f} f/min, Schultz Jump: {nowcast.observation.lightning_jump_sigma:.1f}σ)
   * Thermodynamic Instability: CAPE = {nowcast.observation.cape_j_kg:.0f} J/kg, CIN = {nowcast.observation.cin_j_kg:.0f} J/kg, Lifted Index = {nowcast.observation.lifted_index:.1f} °C

3. ACTIVE EARLY WARNING ADVISORIES ({len(nowcast.active_alerts)} ACTIVE):
"""
    for alert in nowcast.active_alerts:
        bulletin += f"""   - [{alert.severity.upper()}] {alert.headline}
     Valid: {alert.valid_from} -> {alert.valid_until}
     Target Zones: {", ".join(alert.affected_zones)}
     Directives: {alert.safety_instructions[0]}
"""

    bulletin += "\n========================================================================\n"
    return Response(content=bulletin, media_type="text/plain")



# WebSocket Live Stream for real-time dashboard updates
@app.websocket("/ws/live-feed")
async def websocket_live_feed(websocket: WebSocket):
    await websocket.accept()
    region = "hyderabad"
    current_offset_idx = 4  # Start at t0
    
    try:
        while True:
            step = TIMELINE_STEPS[current_offset_idx]
            nowcast = service.run_full_nowcast(region_id=region, time_offset_min=step["offset_min"])
            
            payload = {
                "type": "live_update",
                "timeline_step": step,
                "data": nowcast.model_dump()
            }
            
            await websocket.send_text(json.dumps(payload))
            
            # Step through timeline every 6 seconds
            current_offset_idx = (current_offset_idx + 1) % len(TIMELINE_STEPS)
            await asyncio.sleep(6.0)
    except WebSocketDisconnect:
        pass


# Mount static directory for frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
def serve_index():
    """Serve the interactive GIS nowcasting dashboard."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Aerocast-AI Backend Running</h1><p>Frontend index.html initializing...</p>")
