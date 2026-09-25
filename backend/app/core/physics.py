"""Meteorological physics, atmospheric indices, and colormap mapping utilities.

Grounds all predictions in meteorological fundamentals:
- Radar reflectivity (dBZ) & Vertically Integrated Liquid (VIL)
- Satellite Infrared Brightness Temperature (CTT / Tbb)
- Schultz Lightning Jump Algorithm (dF/dt > 2σ)
- Thermodynamic Convective Instability (CAPE, CIN, Lifted Index, K-Index)
"""

import math
from typing import List, Tuple, Dict, Any


def dbz_to_rain_rate(dbz: float, a: float = 300.0, b: float = 1.4) -> float:
    """Convert radar reflectivity factor Z (dBZ) to rain rate R (mm/hr) using convective Z-R relation.
    
    Z = 10^(dBZ / 10) = a * R^b  ==> R = (10^(dBZ/10) / a)^(1/b)
    """
    if dbz < 10.0:
        return 0.0
    z_linear = 10.0 ** (dbz / 10.0)
    return round((z_linear / a) ** (1.0 / b), 2)


def calculate_vil_density(vil_kg_m2: float, echo_top_km: float) -> float:
    """Calculate VIL Density in g/m³.
    
    VIL Density > 3.5 g/m³ strongly indicates severe hail / deep convective core.
    """
    if echo_top_km <= 0.0:
        return 0.0
    return round((vil_kg_m2 / (echo_top_km * 1000.0)) * 1000.0, 2)


def evaluate_lightning_jump(flash_rates_per_min: List[float], dt_minutes: float = 2.0) -> Tuple[bool, float]:
    """Evaluate Schultz et al. (2011) 2-sigma Lightning Jump.
    
    Returns:
        (is_jump, sigma_score)
    """
    if len(flash_rates_per_min) < 3:
        return False, 0.0
    
    # Calculate df/dt
    df_dt = (flash_rates_per_min[-1] - flash_rates_per_min[-2]) / max(dt_minutes, 0.1)
    
    # Past rate differences
    past_diffs = []
    for i in range(1, len(flash_rates_per_min) - 1):
        diff = (flash_rates_per_min[i] - flash_rates_per_min[i-1]) / max(dt_minutes, 0.1)
        past_diffs.append(diff)
        
    if not past_diffs:
        return False, 0.0
        
    mean_diff = sum(past_diffs) / len(past_diffs)
    variance = sum((x - mean_diff) ** 2 for x in past_diffs) / max(len(past_diffs), 1)
    std_diff = math.sqrt(variance) if variance > 0 else 1.0
    
    sigma_score = (df_dt - mean_diff) / max(std_diff, 0.5)
    is_jump = sigma_score >= 2.0 and flash_rates_per_min[-1] >= 10.0
    
    return is_jump, round(sigma_score, 2)


def cardinal_direction(heading_deg: float) -> str:
    """Convert heading angle (0-360) to 8-point cardinal direction string."""
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    ix = round(heading_deg / 45.0) % 8
    return dirs[ix]


def get_imd_radar_color(dbz: float) -> Tuple[int, int, int, int]:
    """Return RGBA color for radar reflectivity adhering to IMD DWR standard palette."""
    if dbz < 10.0:
        return (0, 0, 0, 0)       # Transparent
    elif dbz < 18.0:
        return (64, 160, 255, 140)  # Light Blue (Very Light drizzle)
    elif dbz < 25.0:
        return (0, 100, 255, 180)   # Blue (Light Rain)
    elif dbz < 30.0:
        return (0, 200, 160, 200)   # Cyan (Moderate Rain)
    elif dbz < 35.0:
        return (0, 220, 0, 215)     # Green (Moderate Convection)
    elif dbz < 40.0:
        return (160, 240, 0, 225)   # Yellow-Green (Convective core)
    elif dbz < 45.0:
        return (255, 220, 0, 235)   # Yellow (Heavy Rain / Thunderstorm)
    elif dbz < 50.0:
        return (255, 140, 0, 245)   # Orange (Intense Thunderstorm)
    elif dbz < 55.0:
        return (240, 0, 0, 250)     # Red (Severe Thunderstorm)
    elif dbz < 60.0:
        return (180, 0, 0, 255)     # Dark Red (Severe / Hail)
    elif dbz < 65.0:
        return (255, 0, 255, 255)   # Magenta (Extreme / Large Hail)
    else:
        return (255, 255, 255, 255) # Pure White (Extreme Core > 65 dBZ)


def get_satellite_ir_color(temp_c: float) -> Tuple[int, int, int, int]:
    """Return RGBA color for INSAT-3D enhanced infrared cloud-top temperature."""
    if temp_c > 15.0:
        return (0, 0, 0, 0)        # Warm ground / clear sky
    elif temp_c > 0.0:
        return (120, 120, 120, 80) # Low cloud (Grey)
    elif temp_c > -20.0:
        return (80, 160, 240, 140) # Mid cloud (Cyan-Blue)
    elif temp_c > -40.0:
        return (40, 200, 100, 180) # High cloud (Green)
    elif temp_c > -52.0:
        return (255, 220, 0, 210)  # Developing anvil (Yellow)
    elif temp_c > -62.0:
        return (255, 100, 0, 230)  # Intense convective cloud (Orange)
    elif temp_c > -72.0:
        return (220, 0, 0, 245)    # Severe overshooting top (Red)
    elif temp_c > -82.0:
        return (200, 0, 200, 255)  # Violent deep convection (Magenta)
    else:
        return (255, 255, 255, 255)# Extreme overshooting dome < -82°C (White)


def generate_uncertainty_cone(
    start_lat: float,
    start_lon: float,
    heading_deg: float,
    speed_kmh: float,
    lead_time_minutes: int,
    initial_radius_km: float = 8.0,
    growth_rate_km_per_hr: float = 12.0
) -> List[List[float]]:
    """Generate geospatial polygon representing the storm position uncertainty cone."""
    dist_km = speed_kmh * (lead_time_minutes / 60.0)
    uncertainty_r_km = initial_radius_km + (growth_rate_km_per_hr * (lead_time_minutes / 60.0))
    
    # Earth coordinates math (1 deg lat ~ 111 km, 1 deg lon ~ 111 * cos(lat) km)
    rad = math.radians(heading_deg)
    d_lat_center = (dist_km * math.cos(rad)) / 111.0
    d_lon_center = (dist_km * math.sin(rad)) / (111.0 * math.cos(math.radians(start_lat)))
    
    center_lat = start_lat + d_lat_center
    center_lon = start_lon + d_lon_center
    
    # Form a circular / fan polygon
    num_pts = 16
    poly = []
    for i in range(num_pts):
        angle = (2 * math.pi * i) / num_pts
        d_lat_pt = (uncertainty_r_km * math.sin(angle)) / 111.0
        d_lon_pt = (uncertainty_r_km * math.cos(angle)) / (111.0 * math.cos(math.radians(center_lat)))
        poly.append([round(center_lat + d_lat_pt, 5), round(center_lon + d_lon_pt, 5)])
    
    # Close polygon
    if poly:
        poly.append(poly[0])
        
    return poly
