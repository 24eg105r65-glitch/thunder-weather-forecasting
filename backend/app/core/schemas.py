from typing import List, Dict, Optional, Any, Literal
from pydantic import BaseModel, Field


class AtmosphericObservation(BaseModel):
    """Multi-sensor atmospheric observation input payload."""
    timestamp: str = Field(..., description="ISO timestamp of the observation")
    region_id: str = Field("hyderabad", description="Region identifier (e.g., hyderabad, kolkata, delhi, bhubaneswar)")
    lat: float = Field(..., description="Latitude of observation point/cell")
    lon: float = Field(..., description="Longitude of observation point/cell")
    
    # Radar observations (DWR)
    max_reflectivity_dbz: float = Field(..., description="Maximum radar reflectivity in dBZ (0 - 75)")
    mean_reflectivity_dbz: float = Field(..., description="Mean radar reflectivity in core in dBZ")
    vil_kg_m2: float = Field(..., description="Vertically Integrated Liquid in kg/m²")
    echo_top_km: float = Field(..., description="Radar Echo Top (18 dBZ boundary) height in km")
    reflectivity_trend_15min: float = Field(0.0, description="Change in dBZ over previous 15 mins")
    
    # Satellite observations (INSAT-3D / 3DR IR)
    cloud_top_temp_c: float = Field(..., description="Infrared Cloud Top Temperature in Celsius (-90 to +30)")
    cloud_cooling_rate_15min: float = Field(..., description="Cloud top cooling rate (°C per 15 min, negative indicates rapid cooling)")
    water_vapor_bt_c: float = Field(-25.0, description="Water vapor channel brightness temp in °C")
    
    # Lightning observations (IITM / GLD360 / IMD network)
    flash_count_15min: int = Field(0, description="Number of lightning flashes detected in past 15 mins")
    flash_rate_per_min: float = Field(0.0, description="Lightning flash rate (flashes per minute)")
    lightning_jump_sigma: float = Field(0.0, description="Lightning jump metric (standard deviation units > 2 signifies jump)")
    cg_ratio: float = Field(0.25, description="Cloud-to-Ground to total flash ratio (0 to 1)")
    
    # Thermodynamic & NWP model data (WRF / ERA5 / Sounding)
    cape_j_kg: float = Field(..., description="Convective Available Potential Energy in J/kg")
    cin_j_kg: float = Field(..., description="Convective Inhibition in J/kg")
    lifted_index: float = Field(..., description="Lifted Index (°C, negative indicates instability)")
    k_index: float = Field(32.0, description="K-Index (thunderstorm potential index)")
    surface_temp_c: float = Field(32.0, description="Surface dry-bulb temperature in °C")
    dew_point_c: float = Field(24.0, description="Surface dew point temperature in °C")
    wind_shear_0_6km_mps: float = Field(15.0, description="0-6 km Bulk Wind Shear in m/s")
    rh_850hpa_pct: float = Field(75.0, description="Relative humidity at 850 hPa in %")


class ExplainabilityItem(BaseModel):
    feature: str
    label: str
    value: float
    unit: str
    impact: Literal["high_risk", "moderate_risk", "inhibiting", "neutral"]
    description: str


class NowcastPrediction(BaseModel):
    """Output prediction for a given forecast lead-time."""
    timestamp: str
    lead_time_minutes: int  # 30, 60, or 90
    forecast_time: str
    
    # Probabilities
    thunderstorm_probability: float = Field(..., description="0.0 to 1.0 probability")
    lightning_probability: float = Field(..., description="0.0 to 1.0 probability")
    
    # Qualitative Risk Levels
    thunderstorm_risk: Literal["Low", "Moderate", "High", "Severe"]
    lightning_risk: Literal["Low", "Moderate", "High", "Severe"]
    
    # Expected storm metrics
    expected_lightning_rate_per_min: float
    expected_max_dbz: float
    cell_growth_trend: Literal["Developing", "Intensifying", "Mature", "Dissipating", "Stable"]
    storm_classification: Literal["Ordinary Convective Cell", "Multicell Cluster", "Squall Line", "Supercell Convection", "Non-Severe"]
    
    # Movement
    storm_speed_kmh: float
    storm_heading_deg: float
    storm_direction_cardinal: str
    
    # Confidence and XAI
    confidence_score: float
    key_drivers: List[ExplainabilityItem]


class ForecastTrajectoryPoint(BaseModel):
    lead_time_min: int
    forecast_time: str
    lat: float
    lon: float
    uncertainty_radius_km: float
    projected_max_dbz: float
    risk_level: Literal["Low", "Moderate", "High", "Severe"]


class StormCell(BaseModel):
    """Identified and tracked convective storm cell."""
    cell_id: str
    region_id: str
    centroid_lat: float
    centroid_lon: float
    area_sq_km: float
    max_reflectivity_dbz: float
    mean_reflectivity_dbz: float
    vil_kg_m2: float
    echo_top_km: float
    cloud_top_temp_c: float
    lightning_flash_rate: float
    speed_kmh: float
    heading_deg: float
    direction_cardinal: str
    severity: Literal["Low", "Moderate", "High", "Severe"]
    growth_state: Literal["Developing", "Intensifying", "Mature", "Dissipating"]
    contour_polygon: List[List[float]] = Field(default_factory=list, description="[[lat, lon], ...]")
    trajectory: List[ForecastTrajectoryPoint] = Field(default_factory=list)
    uncertainty_cone_polygons: Dict[int, List[List[float]]] = Field(default_factory=dict, description="Lead-time to polygon")


class LightningStrike(BaseModel):
    strike_id: str
    lat: float
    lon: float
    timestamp: str
    age_seconds: int
    peak_current_ka: float
    strike_type: Literal["IC", "CG"]  # Intra-cloud or Cloud-to-ground
    polarity: Literal["+", "-"]


class EarlyWarningAlert(BaseModel):
    alert_id: str
    created_at: str
    region_id: str
    region_name: str
    headline: str
    severity: Literal["Minor", "Moderate", "Severe", "Extreme"]
    color_code: Literal["#10b981", "#f59e0b", "#f97316", "#ef4444"]
    lead_time_minutes: int
    valid_from: str
    valid_until: str
    affected_zones: List[str]
    storm_intensity: str
    expected_hazards: List[str]
    safety_instructions: List[str]
    alert_polygon: List[List[float]] = Field(default_factory=list)


class RadarGridResponse(BaseModel):
    region_id: str
    timestamp: str
    grid_type: Literal["observed", "nowcasted"]
    lead_time_min: int
    bounds: List[float]  # [min_lat, min_lon, max_lat, max_lon]
    rows: int
    cols: int
    max_dbz: float
    mean_dbz: float
    # 2D grid matrix of reflectivity dBZ values
    grid: List[List[float]]
    color_matrix_rgba: Optional[List[List[List[int]]]] = None


class SatelliteGridResponse(BaseModel):
    region_id: str
    timestamp: str
    bounds: List[float]
    rows: int
    cols: int
    min_temp_c: float
    mean_temp_c: float
    grid: List[List[float]]  # Cloud top temperatures in °C


class VerticalProfileLevel(BaseModel):
    pressure_hpa: float
    height_m: float
    temp_c: float
    dewpoint_c: float
    wind_speed_mps: float
    wind_dir_deg: float
    theta_e_k: float


class ThermodynamicSoundingProfile(BaseModel):
    region_id: str
    region_name: str
    timestamp: str
    surface_temp_c: float
    surface_dewpoint_c: float
    surface_pressure_hpa: float
    cape_j_kg: float
    cin_j_kg: float
    lifted_index: float
    k_index: float
    total_totals_index: float
    precipitable_water_mm: float
    bulk_shear_0_6km_mps: float
    lcl_height_m: float
    lfc_height_m: float
    el_height_m: float
    wet_bulb_zero_m: float
    hail_growth_zone_min_m: float  # -10°C level
    hail_growth_zone_max_m: float  # -30°C level
    levels: List[VerticalProfileLevel]


class ModelBenchmarkData(BaseModel):
    model_name: str
    model_type: str
    roc_auc_30m: float
    csi_threat_score_30m: float
    pod_recall_30m: float
    far_false_alarm_30m: float
    hss_heidke_30m: float
    inference_latency_ms: float
    lead_time_csi_curve: Dict[str, float]  # e.g. {"15m": 0.94, "30m": 0.89, "60m": 0.92, "90m": 0.83}
    strengths: str
    operational_role: str


class FullNowcastResponse(BaseModel):
    current_time: str
    region_id: str
    region_name: str
    observation: AtmosphericObservation
    nowcasts: Dict[str, NowcastPrediction]  # "30m", "60m", "90m"
    active_cells: List[StormCell]
    recent_lightning_strikes: List[LightningStrike]
    active_alerts: List[EarlyWarningAlert]
    overall_threat_level: Literal["Low", "Moderate", "High", "Severe"]


class LocationSearchResult(BaseModel):
    name: str
    lat: float
    lon: float
    category: Literal["city", "locality", "landmark", "airport", "radar_station", "coordinate"]
    state: Optional[str] = None
    nearest_region_id: str
    nearest_radar_station: str
    distance_to_radar_km: float


class LiveWeatherObservation(BaseModel):
    source: str = "OpenWeatherMap Live In-Situ Network"
    condition: str
    condition_main: str
    description: Optional[str] = None
    icon_url: str
    icon_code: Optional[str] = None
    temperature_c: float
    temp_c: Optional[float] = None
    feels_like_c: float
    humidity_pct: int
    pressure_hpa: float
    wind_speed_kmh: float
    wind_speed_mps: float
    wind_deg: float
    cloud_coverage_pct: int
    rain_1h_mm: float
    city_name: Optional[str] = None


class AreaThreatAssessment(BaseModel):
    query_lat: float
    query_lon: float
    location_name: str
    time_offset_min: int
    nearest_region_id: str
    nearest_radar_station: str
    distance_to_radar_km: float
    local_dbz: float
    local_cloud_top_temp_c: float
    estimated_rain_rate_mmh: float
    threat_level: Literal["Low", "Moderate", "High", "Severe"]
    threat_score_pct: int
    nearest_cell_id: Optional[str] = None
    distance_to_nearest_cell_km: Optional[float] = None
    nearest_cell_approaching: bool = False
    estimated_cell_eta_minutes: Optional[int] = None
    lightning_strikes_15km: int = 0
    safety_directive: str
    live_weather: Optional[LiveWeatherObservation] = None



