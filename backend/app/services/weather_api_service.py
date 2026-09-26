"""OpenWeatherMap Live Weather & Geocoding Service for Aerocast-AI.

Integrates real-time in situ ground weather observations, global geocoding,
and precipitation/cloud radar tile feeds.
"""

import os
import json
import urllib.request
import urllib.parse
from typing import Dict, Any, List, Optional


def _load_env_file():
    """Load variables from .env file into os.environ if present."""
    search_dirs = [
        os.getcwd(),
        os.path.dirname(os.path.abspath(__file__)),
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ]
    for d in search_dirs:
        env_file = os.path.join(d, ".env")
        if os.path.isfile(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and not os.environ.get(k):
                                os.environ[k] = v
                break
            except Exception:
                pass

_load_env_file()

OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY", "")
GEO_BASE_URL = "http://api.openweathermap.org/geo/1.0"
WEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5"
TILE_BASE_URL = "https://tile.openweathermap.org/map"


def search_openweather_locations(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Query OpenWeatherMap Geocoding API for direct location coordinates."""
    if not query or not query.strip():
        return []
    
    q_clean = query.strip()
    # If no country specified and not coordinates, append India as primary context
    if "," not in q_clean and not any(char.isdigit() for char in q_clean):
        query_param = f"{q_clean},IN"
    else:
        query_param = q_clean

    url = f"{GEO_BASE_URL}/direct?q={urllib.parse.quote(query_param)}&limit={limit}&appid={OPENWEATHER_API_KEY}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Aerocast-AI/2.0"})
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                results = []
                for item in data:
                    name_parts = [item.get("name", "")]
                    if item.get("state"):
                        name_parts.append(item.get("state"))
                    if item.get("country"):
                        name_parts.append(item.get("country"))
                    
                    full_name = ", ".join(name_parts)
                    results.append({
                        "name": full_name,
                        "local_name": item.get("name", ""),
                        "lat": float(item["lat"]),
                        "lon": float(item["lon"]),
                        "state": item.get("state", ""),
                        "country": item.get("country", "IN"),
                        "category": "city"
                    })
                return results
    except Exception as e:
        print(f"[OWM Geocode Error] {e}")
    return []


def reverse_geocode_location(lat: float, lon: float) -> Optional[Dict[str, str]]:
    """Reverse geocode GPS coordinates to obtain the actual city/locality, state, and country name."""
    url = f"{GEO_BASE_URL}/reverse?lat={lat}&lon={lon}&limit=1&appid={OPENWEATHER_API_KEY}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Aerocast-AI/2.0"})
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                if data and len(data) > 0:
                    item = data[0]
                    name = item.get("name", "")
                    state = item.get("state", "")
                    country = item.get("country", "IN")
                    
                    full_name_parts = [p for p in [name, state, country] if p]
                    full_name = ", ".join(full_name_parts) if full_name_parts else f"Coordinates ({lat:.4f}°, {lon:.4f}°)"
                    return {
                        "name": full_name,
                        "city": name,
                        "state": state,
                        "country": country
                    }
    except Exception as e:
        print(f"[OWM Reverse Geocode Error] {e}")
    return None


def fetch_live_weather(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """Fetch real-time atmospheric surface observations from OpenWeatherMap."""
    url = f"{WEATHER_BASE_URL}/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Aerocast-AI/2.0"})
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                
                weather_desc = data["weather"][0]["description"].title() if data.get("weather") else "Clear"
                weather_main = data["weather"][0]["main"] if data.get("weather") else "Clear"
                weather_icon = data["weather"][0]["icon"] if data.get("weather") else "01d"
                
                main_sec = data.get("main", {})
                wind_sec = data.get("wind", {})
                clouds_sec = data.get("clouds", {})
                rain_sec = data.get("rain", {})
                
                temp_c = float(main_sec.get("temp", 30.0))
                feels_like_c = float(main_sec.get("feels_like", temp_c))
                humidity_pct = int(main_sec.get("humidity", 65))
                pressure_hpa = float(main_sec.get("pressure", 1010.0))
                
                wind_speed_mps = float(wind_sec.get("speed", 3.0))
                wind_speed_kmh = round(wind_speed_mps * 3.6, 1)
                wind_deg = float(wind_sec.get("deg", 0.0))
                
                cloud_pct = int(clouds_sec.get("all", 20))
                rain_1h = float(rain_sec.get("1h", 0.0)) if isinstance(rain_sec, dict) else 0.0
                
                city_name = data.get("name", "")
                
                return {
                    "source": "OpenWeatherMap Live In-Situ Network",
                    "condition": weather_desc,
                    "condition_main": weather_main,
                    "description": weather_desc,
                    "icon_url": f"https://openweathermap.org/img/wn/{weather_icon}@2x.png",
                    "icon_code": weather_icon,
                    "temperature_c": round(temp_c, 1),
                    "temp_c": round(temp_c, 1),
                    "feels_like_c": round(feels_like_c, 1),
                    "humidity_pct": humidity_pct,
                    "pressure_hpa": round(pressure_hpa, 1),
                    "wind_speed_kmh": wind_speed_kmh,
                    "wind_speed_mps": round(wind_speed_mps, 1),
                    "wind_deg": wind_deg,
                    "cloud_coverage_pct": cloud_pct,
                    "rain_1h_mm": round(rain_1h, 1),
                    "city_name": city_name
                }
    except Exception as e:
        print(f"[OWM Live Weather Error] {e}")
    return None


def get_tile_layer_url(layer_type: str = "precipitation_new") -> str:
    """Get OpenWeatherMap Tile Layer URL template for Leaflet."""
    # Available layers: precipitation_new, clouds_new, wind_new, temp_new
    return f"{TILE_BASE_URL}/{layer_type}/{{z}}/{{x}}/{{y}}.png?appid={OPENWEATHER_API_KEY}"
