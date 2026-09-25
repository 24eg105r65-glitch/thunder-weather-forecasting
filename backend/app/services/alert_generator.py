"""Common Alerting Protocol (CAP) and meteorological early warning generator.

Translates AI predictions, lightning jumps, and storm trajectories into actionable,
color-coded early warnings adhering to IMD and NDMA disaster management protocols.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from ..core.schemas import EarlyWarningAlert, NowcastPrediction, StormCell


class AlertGenerator:
    def __init__(self):
        pass

    def generate_alerts(
        self,
        region_id: str,
        region_name: str,
        prediction_30m: NowcastPrediction,
        prediction_60m: NowcastPrediction,
        active_cells: List[StormCell]
    ) -> List[EarlyWarningAlert]:
        """Generate structured CAP-compliant early warnings based on multimodal nowcast."""
        alerts: List[EarlyWarningAlert] = []
        now = datetime.now(timezone.utc)
        
        # Determine highest severity among predictions and active cells
        max_ts_prob = max(prediction_30m.thunderstorm_probability, prediction_60m.thunderstorm_probability)
        max_cell_dbz = max([c.max_reflectivity_dbz for c in active_cells], default=prediction_30m.expected_max_dbz)
        has_severe_cell = any(c.severity in ["High", "Severe"] for c in active_cells)
        
        # 1. Red Alert (Extreme / Severe Danger)
        if max_ts_prob >= 0.75 or max_cell_dbz >= 55.0 or prediction_30m.lightning_risk == "Severe":
            lead_time = 30
            alert_id = f"CAP-ALERT-RED-{uuid.uuid4().hex[:6].upper()}"
            
            # Extract affected districts / sub-zones based on region
            affected = self._get_affected_zones(region_id, prediction_30m.storm_direction_cardinal)
            
            alerts.append(EarlyWarningAlert(
                alert_id=alert_id,
                created_at=now.isoformat(),
                region_id=region_id,
                region_name=region_name,
                headline=f"RED ALERT: Severe Thunderstorm & Intense Lightning Strike Warning for {region_name}",
                severity="Extreme",
                color_code="#ef4444",
                lead_time_minutes=lead_time,
                valid_from=now.isoformat(),
                valid_until=(now + timedelta(minutes=90)).isoformat(),
                affected_zones=affected,
                storm_intensity=f"Severe Convective Core ({max_cell_dbz:.1f} dBZ) moving {prediction_30m.storm_direction_cardinal} at {prediction_30m.storm_speed_kmh} km/h",
                expected_hazards=[
                    "Frequent cloud-to-ground lightning strikes with high casualty risk",
                    f"Intense localized downbursts with wind gusts exceeding 65-80 km/h",
                    "Sudden heavy rainfall (> 40 mm/hr) leading to localized waterlogging",
                    "Possible small to medium hail precipitation"
                ],
                safety_instructions=[
                    "Seek immediate shelter in a sturdy pucca building or enclosed vehicle.",
                    "DO NOT take shelter under tall isolated trees, tin sheds, or near metal towers.",
                    "Unplug all electrical and electronic appliances; avoid corded phones.",
                    "Halt all open-field agricultural, construction, and outdoor sports activities immediately.",
                    "Aviation and ground transport operators advised to institute convective weather protocols."
                ],
                alert_polygon=self._build_alert_polygon(active_cells)
            ))
            
        # 2. Orange Alert (Be Prepared / High Risk)
        elif max_ts_prob >= 0.50 or max_cell_dbz >= 45.0 or prediction_30m.lightning_risk == "High":
            lead_time = 45
            alert_id = f"CAP-ALERT-ORG-{uuid.uuid4().hex[:6].upper()}"
            affected = self._get_affected_zones(region_id, prediction_30m.storm_direction_cardinal)
            
            alerts.append(EarlyWarningAlert(
                alert_id=alert_id,
                created_at=now.isoformat(),
                region_id=region_id,
                region_name=region_name,
                headline=f"ORANGE ALERT: Moderate to Severe Thunderstorm & Lightning Alert for {region_name}",
                severity="Severe",
                color_code="#f97316",
                lead_time_minutes=lead_time,
                valid_from=now.isoformat(),
                valid_until=(now + timedelta(minutes=75)).isoformat(),
                affected_zones=affected,
                storm_intensity=f"Active Multicell Thunderstorm ({max_cell_dbz:.1f} dBZ) tracking {prediction_30m.storm_direction_cardinal}",
                expected_hazards=[
                    "Moderate to frequent lightning strikes",
                    "Squally surface winds reaching 45-60 km/h",
                    "Short-duration heavy downpours"
                ],
                safety_instructions=[
                    "Stay indoors and avoid non-essential outdoor travel.",
                    "Secure loose rooftop objects, signboards, and outdoor structures.",
                    "Farmers should postpone spraying and harvesting operations until cell clears."
                ],
                alert_polygon=self._build_alert_polygon(active_cells)
            ))
            
        # 3. Yellow Alert (Be Updated / Moderate Risk)
        elif max_ts_prob >= 0.25 or max_cell_dbz >= 35.0:
            lead_time = 60
            alert_id = f"CAP-ALERT-YEL-{uuid.uuid4().hex[:6].upper()}"
            affected = self._get_affected_zones(region_id, prediction_30m.storm_direction_cardinal)
            
            alerts.append(EarlyWarningAlert(
                alert_id=alert_id,
                created_at=now.isoformat(),
                region_id=region_id,
                region_name=region_name,
                headline=f"YELLOW WATCH: Developing Convective Cells & Light-to-Moderate Lightning Risk",
                severity="Moderate",
                color_code="#f59e0b",
                lead_time_minutes=lead_time,
                valid_from=now.isoformat(),
                valid_until=(now + timedelta(minutes=60)).isoformat(),
                affected_zones=affected,
                storm_intensity=f"Developing Convective Echoes ({max_cell_dbz:.1f} dBZ)",
                expected_hazards=[
                    "Isolated lightning discharges",
                    "Gusty winds 30-40 km/h and light to moderate showers"
                ],
                safety_instructions=[
                    "Monitor real-time nowcast radar updates.",
                    "Keep mobile phones charged and prepare for temporary power disruptions."
                ],
                alert_polygon=self._build_alert_polygon(active_cells)
            ))
            
        return alerts

    def _get_affected_zones(self, region_id: str, direction: str) -> List[str]:
        """Return localized district / municipal zone names along storm path."""
        zones_map = {
            "hyderabad": [
                "Secunderabad & Malkajgiri", "Gachibowli & HITEC City Corridor",
                "Shamshabad / RGI Airport Corridor", "Uppal & Ghatkesar Belt",
                "Medchal-Malkajgiri District", "Rangareddy Rural North"
            ],
            "kolkata": [
                "Kolkata North & Salt Lake", "Howrah Urban Cluster",
                "North 24 Parganas (Barasat, Barrackpore)", "South 24 Parganas Coastal Zone",
                "Hooghly Industrial Corridor"
            ],
            "delhi": [
                "Central & South Delhi", "Gurugram & Manesar Belt",
                "Noida & Greater Noida Expressway", "Ghaziabad & Hindon Basin",
                "Faridabad Industrial Sector"
            ],
            "bhubaneswar": [
                "Bhubaneswar Municipal Area", "Cuttack Twin City Corridor",
                "Khurda District Rural", "Puri Highway Belt", "Paradip Coastal Reach"
            ],
            "mumbai": [
                "Mumbai Suburban & Andheri", "South Mumbai Marine Lines",
                "Thane Urban Belt", "Navi Mumbai & Panvel Corridor",
                "Kalyan-Dombivli Sector"
            ],
            "chennai": [
                "North Chennai & Ennore Port", "Central Chennai & Marina",
                "Guindy & OMR IT Corridor", "Tambaram & Chengalpattu Reach",
                "Sriperumbudur Industrial Hub"
            ],
            "guwahati": [
                "Guwahati Metropolitan Area", "Kamrup Rural District",
                "Dispur Capital Complex", "Borjhar Airport Belt",
                "North Guwahati Hills Sector"
            ],
            "bengaluru": [
                "Bengaluru Urban & Central", "Whitefield & Mahadevapura Belt",
                "Electronic City & Hosur Road", "Yelahanka & Airport Expressway",
                "Kengeri & Mysore Road Corridor"
            ]
        }
        base_zones = zones_map.get(region_id, ["Central Zone", "North-East Sector", "East Sector"])
        return base_zones[:4]

    def _build_alert_polygon(self, active_cells: List[StormCell]) -> List[List[float]]:
        """Combine storm cell contours or bounding box into warning polygon."""
        if active_cells and active_cells[0].contour_polygon:
            return active_cells[0].contour_polygon
        return []

    def generate_cap_xml(self, alerts: List[EarlyWarningAlert]) -> str:
        """Generate OASIS Common Alerting Protocol (CAP-v1.2) XML document."""
        if not alerts:
            now = datetime.now(timezone.utc).isoformat()
            return f"""<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>CAP-AEROCAST-EMPTY</identifier>
  <sender>aerocast-ai@imd.gov.in</sender>
  <sent>{now}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <category>Met</category>
    <event>No Active Meteorological Alerts</event>
    <urgency>Past</urgency>
    <severity>Minor</severity>
    <certainty>Observed</certainty>
    <headline>All regions normal - No severe thunderstorms detected</headline>
  </info>
</alert>"""

        primary_alert = alerts[0]
        # Format polygon coordinates as "lat,lon lat,lon ..."
        poly_str = " ".join([f"{p[0]:.4f},{p[1]:.4f}" for p in primary_alert.alert_polygon]) if primary_alert.alert_polygon else ""
        
        urgency_map = {"Extreme": "Immediate", "Severe": "Expected", "Moderate": "Future", "Minor": "Past"}
        urgency = urgency_map.get(primary_alert.severity, "Expected")
        
        hazards_xml = "\n".join([f"    <hazard>{h}</hazard>" for h in primary_alert.expected_hazards])
        instructions_text = " ".join(primary_alert.safety_instructions)
        areas_xml = "\n".join([f"      <areaDesc>{zone}</areaDesc>" for zone in primary_alert.affected_zones])

        return f"""<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>{primary_alert.alert_id}</identifier>
  <sender>aerocast-ai@imd.gov.in</sender>
  <sent>{primary_alert.created_at}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <codeContext>IMD-NDMA-CONVECTIVE-NOWCAST-V2</codeContext>
  <info>
    <language>en-IN</language>
    <category>Met</category>
    <event>Severe Thunderstorm &amp; Lightning Hazard</event>
    <responseType>Shelter</responseType>
    <urgency>{urgency}</urgency>
    <severity>{primary_alert.severity}</severity>
    <certainty>Observed</certainty>
    <eventCode>
      <valueName>IMD_WEATHER_EVENT</valueName>
      <value>THUNDERSTORM_LIGHTNING_GALE</value>
    </eventCode>
    <effective>{primary_alert.valid_from}</effective>
    <onset>{primary_alert.valid_from}</onset>
    <expires>{primary_alert.valid_until}</expires>
    <senderName>Aerocast-AI Automated Early Warning System (IMD/NDMA)</senderName>
    <headline>{primary_alert.headline}</headline>
    <description>{primary_alert.storm_intensity}. Key hazards include:\n{chr(10).join(['- ' + h for h in primary_alert.expected_hazards])}</description>
    <instruction>{instructions_text}</instruction>
    <parameter>
      <valueName>LeadTimeMinutes</valueName>
      <value>{primary_alert.lead_time_minutes}</value>
    </parameter>
    <parameter>
      <valueName>ColorCode</valueName>
      <value>{primary_alert.color_code}</value>
    </parameter>
    <area>
      <areaDesc>{primary_alert.region_name} Convective Warning Zone</areaDesc>
{areas_xml}
      {f"<polygon>{poly_str}</polygon>" if poly_str else ""}
    </area>
  </info>
</alert>"""

    def generate_geojson(self, alerts: List[EarlyWarningAlert], active_cells: List[StormCell]) -> Dict[str, Any]:
        """Generate standard GeoJSON FeatureCollection for GIS interoperability."""
        features = []
        
        # 1. Add Alert Warning Polygons
        for alert in alerts:
            if alert.alert_polygon and len(alert.alert_polygon) >= 3:
                # GeoJSON coordinates are [lon, lat]
                coords = [[p[1], p[0]] for p in alert.alert_polygon]
                if coords[0] != coords[-1]:
                    coords.append(coords[0])  # Close linear ring
                    
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords]
                    },
                    "properties": {
                        "feature_type": "CAP_WARNING_POLYGON",
                        "alert_id": alert.alert_id,
                        "headline": alert.headline,
                        "severity": alert.severity,
                        "color_code": alert.color_code,
                        "valid_from": alert.valid_from,
                        "valid_until": alert.valid_until,
                        "lead_time_min": alert.lead_time_minutes,
                        "hazards": alert.expected_hazards
                    }
                })
                
        # 2. Add Storm Cells (Centroids and Trajectories)
        for cell in active_cells:
            # Centroid Point
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [cell.centroid_lon, cell.centroid_lat]
                },
                "properties": {
                    "feature_type": "STORM_CELL_CENTROID",
                    "cell_id": cell.cell_id,
                    "max_reflectivity_dbz": cell.max_reflectivity_dbz,
                    "vil_kg_m2": cell.vil_kg_m2,
                    "echo_top_km": cell.echo_top_km,
                    "cloud_top_temp_c": cell.cloud_top_temp_c,
                    "lightning_flash_rate": cell.lightning_flash_rate,
                    "heading_deg": cell.heading_deg,
                    "speed_kmh": cell.speed_kmh,
                    "severity": cell.severity
                }
            })
            
            # Forecast Trajectory LineString
            if cell.trajectory:
                line_coords = [[cell.centroid_lon, cell.centroid_lat]]
                for tp in cell.trajectory:
                    line_coords.append([tp.lon, tp.lat])
                    
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": line_coords
                    },
                    "properties": {
                        "feature_type": "PROJECTED_TRAJECTORY_LINE",
                        "cell_id": cell.cell_id,
                        "speed_kmh": cell.speed_kmh,
                        "heading_deg": cell.heading_deg,
                        "direction": cell.direction_cardinal
                    }
                })
                
        return {
            "type": "FeatureCollection",
            "metadata": {
                "generated_by": "Aerocast-AI Multimodal Nowcaster",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "crs": "urn:ogc:def:crs:OGC:1.3:CRS84"
            },
            "features": features
        }

