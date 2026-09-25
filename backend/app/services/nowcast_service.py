"""Unified Nowcasting Orchestrator Service.

Coordinates:
- Ingestion of Radar, Satellite, Lightning, and NWP thermodynamic data
- Execution of Baseline XGBoost models (30m, 60m, 90m) + Random Forest
- Spatiotemporal tracking & Semi-Lagrangian radar extrapolation
- Automated CAP early warning alert generation
- Real-time serialization for GIS dashboard and API consumers
"""

import numpy as np
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Any, Optional, Tuple

from ..core.schemas import (
    AtmosphericObservation,
    NowcastPrediction,
    StormCell,
    LightningStrike,
    EarlyWarningAlert,
    RadarGridResponse,
    SatelliteGridResponse,
    FullNowcastResponse,
    ThermodynamicSoundingProfile,
    ModelBenchmarkData
)
from ..core.physics import (
    get_imd_radar_color,
    get_satellite_ir_color,
    evaluate_lightning_jump,
    cardinal_direction
)
from ..core.data_generator import (
    REGIONS,
    generate_spatiotemporal_grid,
    get_simulated_lightning_strikes,
    generate_sounding_profile,
    get_benchmark_models_data
)
from ..models.tabular_classifier import TabularNowcaster
from ..models.radar_extrapolator import SpatiotemporalNowcaster
from .alert_generator import AlertGenerator



class NowcastService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(NowcastService, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        self.tabular_model = TabularNowcaster()
        if not self.tabular_model.load_models():
            # Train if weights don't exist yet
            from ..core.data_generator import generate_training_dataset
            X, targets, names = generate_training_dataset(3000)
            self.tabular_model.train_and_evaluate(X, targets, names)
            
        self.radar_model = SpatiotemporalNowcaster(dbz_threshold=35.0)
        self.alert_generator = AlertGenerator()

    def get_synoptic_observation(
        self,
        region_id: str = "hyderabad",
        time_offset_min: int = 0
    ) -> Tuple[AtmosphericObservation, np.ndarray, np.ndarray, List[Dict[str, Any]], List[LightningStrike]]:
        """Construct multimodal observation snapshot for a given region and time offset (-60 to +90m)."""
        region = REGIONS.get(region_id, REGIONS["hyderabad"])
        min_lat, min_lon, max_lat, max_lon = region["bounds"]
        
        # 1. Generate 2D Radar and Satellite grids
        radar_grid, sat_grid, cells_meta = generate_spatiotemporal_grid(
            region_id=region_id,
            time_offset_min=time_offset_min,
            rows=50,
            cols=50
        )
        
        max_dbz = float(np.max(radar_grid))
        mean_dbz = float(np.mean(radar_grid[radar_grid >= 15.0])) if np.any(radar_grid >= 15.0) else 10.0
        min_sat_temp = float(np.min(sat_grid))
        
        # 2. Get lightning strikes
        main_cell_lat = cells_meta[0]["lat"]
        main_cell_lon = cells_meta[0]["lon"]
        strikes = get_simulated_lightning_strikes(
            region_id=region_id,
            time_offset_min=time_offset_min,
            base_cell_lat=main_cell_lat,
            base_cell_lon=main_cell_lon,
            max_dbz=max_dbz
        )
        
        # 3. Compute derived trends
        # Simulate cooling rate & flash rate progression
        cooling_rate = -7.5 if time_offset_min <= 15 and max_dbz >= 45.0 else -2.0
        flash_count = len(strikes) * 5
        flash_rate = float(round(flash_count / 15.0, 1))
        
        # Calculate Schultz Lightning Jump
        past_rates = [max(0.0, flash_rate * 0.2), max(0.0, flash_rate * 0.45), flash_rate]
        is_jump, jump_sigma = evaluate_lightning_jump(past_rates, dt_minutes=5.0)
        
        # Region-specific thermodynamic environment
        if region_id == "kolkata":
            cape = 3250.0
            cin = 22.0
            shear = 22.0
            dew_point = 26.5
        elif region_id == "delhi":
            cape = 1850.0
            cin = 65.0
            shear = 18.0
            dew_point = 21.0
        elif region_id == "bhubaneswar":
            cape = 2800.0
            cin = 30.0
            shear = 16.0
            dew_point = 25.8
        else: # hyderabad
            cape = 2550.0
            cin = 35.0
            shear = 19.5
            dew_point = 24.2
            
        now = datetime.now(timezone.utc) + timedelta(minutes=time_offset_min)
        
        obs = AtmosphericObservation(
            timestamp=now.isoformat(),
            region_id=region_id,
            lat=main_cell_lat,
            lon=main_cell_lon,
            max_reflectivity_dbz=round(max_dbz, 1),
            mean_reflectivity_dbz=round(mean_dbz, 1),
            vil_kg_m2=round(float((10 ** (max_dbz / 20.0)) * 0.07), 1),
            echo_top_km=round(float(6.0 + max(0.0, max_dbz - 30.0) * 0.32), 1),
            reflectivity_trend_15min=3.5 if time_offset_min <= 0 else -1.5,
            cloud_top_temp_c=round(min_sat_temp, 1),
            cloud_cooling_rate_15min=cooling_rate,
            water_vapor_bt_c=round(min_sat_temp + 4.5, 1),
            flash_count_15min=flash_count,
            flash_rate_per_min=flash_rate,
            lightning_jump_sigma=jump_sigma,
            cg_ratio=0.32,
            cape_j_kg=cape,
            cin_j_kg=cin,
            lifted_index=-5.8,
            k_index=36.5,
            surface_temp_c=34.5,
            dew_point_c=dew_point,
            wind_shear_0_6km_mps=shear,
            rh_850hpa_pct=78.0
        )
        
        return obs, radar_grid, sat_grid, cells_meta, strikes

    def run_full_nowcast(
        self,
        region_id: str = "hyderabad",
        time_offset_min: int = 0
    ) -> FullNowcastResponse:
        """Execute end-to-end multimodal nowcasting chain for selected region & time."""
        region = REGIONS.get(region_id, REGIONS["hyderabad"])
        obs, radar_grid, sat_grid, cells_meta, strikes = self.get_synoptic_observation(
            region_id=region_id,
            time_offset_min=time_offset_min
        )
        
        # 1. Run Baseline Tabular ML Predictions (XGBoost / RF)
        nowcasts = self.tabular_model.predict_observation(obs)
        
        # 2. Run Spatiotemporal SCIT / TITAN Storm Cell Segmentation & Tracking
        active_cells = self.radar_model.segment_storm_cells(
            radar_grid=radar_grid,
            bounds=region["bounds"],
            region_id=region_id,
            cloud_top_temp_c=obs.cloud_top_temp_c,
            lightning_rate=obs.flash_rate_per_min,
            default_heading=region["default_heading"],
            default_speed=region["default_speed"]
        )
        
        # 3. Generate CAP Early Warning Alerts
        alerts = self.alert_generator.generate_alerts(
            region_id=region_id,
            region_name=region["name"],
            prediction_30m=nowcasts["30m"],
            prediction_60m=nowcasts["60m"],
            active_cells=active_cells
        )
        
        # Determine overall threat level
        p30 = nowcasts["30m"].thunderstorm_probability
        if p30 >= 0.75 or (active_cells and active_cells[0].severity == "Severe"):
            threat = "Severe"
        elif p30 >= 0.50 or (active_cells and active_cells[0].severity == "High"):
            threat = "High"
        elif p30 >= 0.25:
            threat = "Moderate"
        else:
            threat = "Low"
            
        return FullNowcastResponse(
            current_time=obs.timestamp,
            region_id=region_id,
            region_name=region["name"],
            observation=obs,
            nowcasts=nowcasts,
            active_cells=active_cells,
            recent_lightning_strikes=strikes,
            active_alerts=alerts,
            overall_threat_level=threat
        )

    def get_radar_grid_response(
        self,
        region_id: str = "hyderabad",
        time_offset_min: int = 0
    ) -> RadarGridResponse:
        """Return 2D radar grid and pre-computed RGBA color matrix for map rendering."""
        region = REGIONS.get(region_id, REGIONS["hyderabad"])
        radar_grid, _, _ = generate_spatiotemporal_grid(
            region_id=region_id,
            time_offset_min=time_offset_min,
            rows=50,
            cols=50
        )
        
        rows, cols = radar_grid.shape
        color_matrix = []
        for r in range(rows):
            row_colors = []
            for c in range(cols):
                val = float(radar_grid[r, c])
                rgba = list(get_imd_radar_color(val))
                row_colors.append(rgba)
            color_matrix.append(row_colors)
            
        now = datetime.now(timezone.utc) + timedelta(minutes=time_offset_min)
        
        return RadarGridResponse(
            region_id=region_id,
            timestamp=now.isoformat(),
            grid_type="observed" if time_offset_min <= 0 else "nowcasted",
            lead_time_min=max(0, time_offset_min),
            bounds=region["bounds"],
            rows=rows,
            cols=cols,
            max_dbz=round(float(np.max(radar_grid)), 1),
            mean_dbz=round(float(np.mean(radar_grid)), 1),
            grid=np.round(radar_grid, 1).tolist(),
            color_matrix_rgba=color_matrix
        )

    def get_satellite_grid_response(
        self,
        region_id: str = "hyderabad",
        time_offset_min: int = 0
    ) -> SatelliteGridResponse:
        """Return 2D satellite cloud top temperature grid."""
        region = REGIONS.get(region_id, REGIONS["hyderabad"])
        _, sat_grid, _ = generate_spatiotemporal_grid(
            region_id=region_id,
            time_offset_min=time_offset_min,
            rows=50,
            cols=50
        )
        
        rows, cols = sat_grid.shape
        now = datetime.now(timezone.utc) + timedelta(minutes=time_offset_min)
        
        return SatelliteGridResponse(
            region_id=region_id,
            timestamp=now.isoformat(),
            bounds=region["bounds"],
            rows=rows,
            cols=cols,
            min_temp_c=round(float(np.min(sat_grid)), 1),
            mean_temp_c=round(float(np.mean(sat_grid)), 1),
            grid=np.round(sat_grid, 1).tolist()
        )

    def get_sounding_response(
        self,
        region_id: str = "hyderabad",
        time_offset_min: int = 0
    ) -> ThermodynamicSoundingProfile:
        """Return vertical Skew-T thermodynamic sounding profile."""
        if region_id not in REGIONS:
            region_id = "hyderabad"
        return generate_sounding_profile(region_id=region_id, time_offset_min=time_offset_min)

    def get_model_benchmarks_response(self) -> List[ModelBenchmarkData]:
        """Return verified multi-model benchmark statistics."""
        return get_benchmark_models_data()

    def get_meteogram_series(self, region_id: str = "hyderabad") -> Dict[str, Any]:
        """Return time-series meteogram trend for past 60m and forecast 90m."""
        if region_id not in REGIONS:
            region_id = "hyderabad"
            
        timeline_offsets = [-60, -45, -30, -15, 0, 15, 30, 45, 60, 90]
        series = []
        now = datetime.now(timezone.utc)
        
        for offset in timeline_offsets:
            obs, _, _, _, strikes = self.get_synoptic_observation(region_id=region_id, time_offset_min=offset)
            preds = self.tabular_model.predict_observation(obs)
            p30 = preds["30m"].thunderstorm_probability
            p60 = preds["60m"].thunderstorm_probability
            
            series.append({
                "offset_min": offset,
                "label": f"{offset:+d}m" if offset != 0 else "t0",
                "timestamp": (now + timedelta(minutes=offset)).strftime("%H:%M UTC"),
                "max_reflectivity_dbz": obs.max_reflectivity_dbz,
                "vil_kg_m2": obs.vil_kg_m2,
                "cloud_top_temp_c": obs.cloud_top_temp_c,
                "flash_rate_per_min": obs.flash_rate_per_min,
                "lightning_jump_sigma": obs.lightning_jump_sigma,
                "thunderstorm_prob_30m": round(p30 * 100, 1),
                "thunderstorm_prob_60m": round(p60 * 100, 1),
                "cape_j_kg": obs.cape_j_kg,
                "cin_j_kg": obs.cin_j_kg
            })
            
        return {
            "region_id": region_id,
            "region_name": REGIONS[region_id]["name"],
            "data_points": series
        }

    def get_cap_xml_response(self, region_id: str = "hyderabad", time_offset_min: int = 0) -> str:
        """Generate OASIS CAP v1.2 compliant XML feed."""
        nowcast = self.run_full_nowcast(region_id=region_id, time_offset_min=time_offset_min)
        return self.alert_generator.generate_cap_xml(nowcast.active_alerts)

    def get_geojson_response(self, region_id: str = "hyderabad", time_offset_min: int = 0) -> Dict[str, Any]:
        """Generate standard GeoJSON FeatureCollection for GIS software."""
        nowcast = self.run_full_nowcast(region_id=region_id, time_offset_min=time_offset_min)
        return self.alert_generator.generate_geojson(nowcast.active_alerts, nowcast.active_cells)

