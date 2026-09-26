/**
 * Aerocast-AI Frontend Application
 * Operational Multimodal Thunderstorm & Lightning Nowcasting Platform
 */

const STATE = {
  currentRegion: "hyderabad",
  selectedLead: "30m", // "30m", "60m", "90m"
  timeOffsetIdx: 4,    // 0 to 9 (4 = t0 Live)
  isPlaying: false,
  playTimer: null,
  audioEnabled: false,
  map: null,
  layers: {
    radarCanvas: null,
    owmTileLayer: null,
    lightningGroup: null,
    stormCellsGroup: null,
    trajectoryGroup: null,
    searchedAreaGroup: null
  },
  layerVisibility: {
    radar: true,
    satellite: true,
    lightning: true,
    tracking: true,
    owmPrecip: true
  },
  currentNowcastData: null,
  regionsData: [],
  searchedLocation: null,
  searchedAssessment: null,
  activeSuggestionIdx: -1
};


const TIMELINE_STEPS = [
  { offset_min: -60, label: "t-60m", type: "observed" },
  { offset_min: -45, label: "t-45m", type: "observed" },
  { offset_min: -30, label: "t-30m", type: "observed" },
  { offset_min: -15, label: "t-15m", type: "observed" },
  { offset_min: 0,   label: "t0 (Live)", type: "observed" },
  { offset_min: 15,  label: "+15m (AI)", type: "nowcasted" },
  { offset_min: 30,  label: "+30m (AI)", type: "nowcasted" },
  { offset_min: 45,  label: "+45m (AI)", type: "nowcasted" },
  { offset_min: 60,  label: "+60m (AI)", type: "nowcasted" },
  { offset_min: 90,  label: "+90m (AI)", type: "nowcasted" }
];

// API Base URL Resolver
function getApiUrl(endpoint) {
  if (window.location.protocol === "file:" || !window.location.origin || window.location.origin === "null") {
    return `http://127.0.0.1:8000${endpoint}`;
  }
  return endpoint;
}

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initTimelineUI();
  setupEventListeners();
  initAreaSearch();
  await loadRegions();
  await fetchAndRenderData();
});

/* ================= 1. Leaflet GIS Map Initialization ================= */
function initMap() {
  if (typeof L === "undefined") {
    console.warn("Leaflet library not ready yet, retrying in 250ms...");
    setTimeout(initMap, 250);
    return;
  }
  if (STATE.map) return;

  const mapEl = document.getElementById("gisMap");
  if (!mapEl) return;

  // Center on Hyderabad by default
  STATE.map = L.map("gisMap", {
    center: [17.3850, 78.4867],
    zoom: 9,
    zoomControl: true,
    attributionControl: false
  });

  // Dark CartoDB base tiles
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 18,
    subdomains: "abcd"
  }).addTo(STATE.map);

  // OpenWeatherMap Precipitation Layer (Ground Observation overlay)
  STATE.layers.owmTileLayer = L.tileLayer("https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=6fd95f47f4586bd267deccc0834fa5fa", {
    maxZoom: 18,
    opacity: 0.65,
    zIndex: 2
  }).addTo(STATE.map);

  // Initialize Layer Groups
  STATE.layers.lightningGroup = L.layerGroup().addTo(STATE.map);
  STATE.layers.stormCellsGroup = L.layerGroup().addTo(STATE.map);
  STATE.layers.trajectoryGroup = L.layerGroup().addTo(STATE.map);
  STATE.layers.searchedAreaGroup = L.layerGroup().addTo(STATE.map);
}

/* ================= 2. Data Fetching & Sync ================= */
async function loadRegions() {
  try {
    const res = await fetch(getApiUrl("/api/regions"));
    if (res.ok) {
      STATE.regionsData = await res.json();
    }
  } catch (err) {
    console.warn("Failed to load regions via API, using fallback regions:", err);
    STATE.regionsData = [
      { id: "hyderabad", name: "Hyderabad & Telangana (DWR Begumpet)", center: [17.3850, 78.4867] },
      { id: "kolkata", name: "Kolkata & Bengal (Nor'wester / Kalbaisakhi)", center: [22.5726, 88.3639] },
      { id: "delhi", name: "Delhi-NCR & Western UP (Mausam Bhawan)", center: [28.6139, 77.2090] },
      { id: "bhubaneswar", name: "Bhubaneswar & Odisha Coast (DWR Paradip)", center: [20.2961, 85.8245] },
      { id: "mumbai", name: "Mumbai & Konkan Coast (DWR Veravali)", center: [19.0760, 72.8777] },
      { id: "chennai", name: "Chennai & Coastal TN (DWR Sriharikota)", center: [13.0827, 80.2707] },
      { id: "guwahati", name: "Guwahati & Assam Valley (DWR Borjhar)", center: [26.1445, 91.7362] },
      { id: "bengaluru", name: "Bengaluru & South Karnataka (DWR Bengaluru)", center: [12.9716, 77.5946] }
    ];
  }
}

async function fetchAndRenderData() {
  const step = TIMELINE_STEPS[STATE.timeOffsetIdx];
  const offset = step.offset_min;
  const regionId = STATE.currentRegion;

  let nowcast = null;
  let radarGrid = null;

  try {
    // 1. Fetch full nowcast
    const nowcastRes = await fetch(getApiUrl(`/api/nowcast?region=${regionId}&time_offset=${offset}`));
    if (nowcastRes.ok) {
      nowcast = await nowcastRes.json();
      STATE.currentNowcastData = nowcast;
    }
  } catch (err) {
    console.warn("API nowcast fetch error, generating local fallback nowcast:", err);
  }

  try {
    // 2. Fetch radar grid
    const radarRes = await fetch(getApiUrl(`/api/radar-grid?region=${regionId}&time_offset=${offset}`));
    if (radarRes.ok) {
      radarGrid = await radarRes.json();
    }
  } catch (err) {
    console.warn("API radar grid fetch error:", err);
  }

  // If nowcast data failed from API, generate fallback
  if (!nowcast) {
    nowcast = generateFallbackNowcast(regionId, offset);
    STATE.currentNowcastData = nowcast;
  }

  // Render all components
  renderTelemetry(nowcast);
  renderMapOverlays(radarGrid, nowcast);
  renderActiveCellsList(nowcast.active_cells || []);
  renderAlerts(nowcast.active_alerts || []);
  updateTimelineDisplay();

  // Synchronize searched area assessment with the new timeline step if active
  if (STATE.searchedLocation) {
    await fetchAndRenderSearchedAreaThreat(
      STATE.searchedLocation.lat,
      STATE.searchedLocation.lon,
      STATE.searchedLocation.name,
      STATE.searchedLocation.category,
      false
    );
  }
}

// Fallback Nowcast Generator (ensures UI always displays data even offline)
function generateFallbackNowcast(regionId, offset) {
  const regNames = {
    hyderabad: "Hyderabad & Telangana Region",
    kolkata: "Kolkata & Bengal Region",
    delhi: "Delhi-NCR & Western UP Region",
    bhubaneswar: "Bhubaneswar & Odisha Coast",
    mumbai: "Mumbai & Konkan Coast",
    chennai: "Chennai & Coastal TN",
    guwahati: "Guwahati & Assam Valley",
    bengaluru: "Bengaluru & South Karnataka"
  };
  const regName = regNames[regionId] || "Hyderabad & Telangana Region";
  const nowStr = new Date().toISOString();

  return {
    current_time: nowStr,
    region_id: regionId,
    region_name: regName,
    overall_threat_level: "Severe",
    observation: {
      timestamp: nowStr,
      region_id: regionId,
      lat: 17.3850,
      lon: 78.4867,
      max_reflectivity_dbz: 62.5,
      mean_reflectivity_dbz: 44.0,
      vil_kg_m2: 28.5,
      echo_top_km: 14.2,
      reflectivity_trend_15min: 4.5,
      cloud_top_temp_c: -64.0,
      cloud_cooling_rate_15min: -7.5,
      water_vapor_bt_c: -26.0,
      flash_count_15min: 58,
      flash_rate_per_min: 18.5,
      lightning_jump_sigma: 2.8,
      cg_ratio: 0.35,
      cape_j_kg: 2750.0,
      cin_j_kg: 32.0,
      lifted_index: -7.2,
      k_index: 38.5,
      surface_temp_c: 33.5,
      dew_point_c: 25.2,
      wind_shear_0_6km_mps: 21.0,
      rh_850hpa_pct: 82.0
    },
    nowcasts: {
      "30m": {
        timestamp: nowStr,
        lead_time_minutes: 30,
        forecast_time: "+30 min",
        thunderstorm_probability: 0.94,
        lightning_probability: 0.96,
        thunderstorm_risk: "Severe",
        lightning_risk: "Severe",
        expected_lightning_rate_per_min: 24.5,
        expected_max_dbz: 65.0,
        cell_growth_trend: "Intensifying",
        storm_classification: "Severe Supercell",
        storm_speed_kmh: 42.0,
        storm_heading_deg: 52.0,
        storm_direction_cardinal: "NE",
        confidence_score: 0.92,
        key_drivers: [
          { feature: "max_reflectivity_dbz", label: "Radar Core Reflectivity", value: 62.5, unit: "dBZ", impact: "high_risk", description: "Intense core of 62.5 dBZ indicates deep convective hail core." },
          { feature: "cape_j_kg", label: "Convective Instability (CAPE)", value: 2750, unit: "J/kg", impact: "high_risk", description: "Extreme updraft energy supporting explosive convection." },
          { feature: "lightning_jump_sigma", label: "Schultz Lightning Jump", value: 2.8, unit: "σ", impact: "high_risk", description: "Surge in flash rate precedes severe downbursts by 20 min." }
        ]
      },
      "60m": {
        timestamp: nowStr,
        lead_time_minutes: 60,
        forecast_time: "+60 min",
        thunderstorm_probability: 0.88,
        lightning_probability: 0.91,
        thunderstorm_risk: "Severe",
        lightning_risk: "Severe",
        expected_lightning_rate_per_min: 19.0,
        expected_max_dbz: 58.0,
        cell_growth_trend: "Mature",
        storm_classification: "Multicell Cluster",
        storm_speed_kmh: 38.0,
        storm_heading_deg: 55.0,
        storm_direction_cardinal: "NE",
        confidence_score: 0.89,
        key_drivers: []
      },
      "90m": {
        timestamp: nowStr,
        lead_time_minutes: 90,
        forecast_time: "+90 min",
        thunderstorm_probability: 0.72,
        lightning_probability: 0.76,
        thunderstorm_risk: "High",
        lightning_risk: "High",
        expected_lightning_rate_per_min: 12.0,
        expected_max_dbz: 48.0,
        cell_growth_trend: "Decaying",
        storm_classification: "Dissipating Anvil",
        storm_speed_kmh: 32.0,
        storm_heading_deg: 60.0,
        storm_direction_cardinal: "ENE",
        confidence_score: 0.85,
        key_drivers: []
      }
    },
    active_cells: [
      {
        cell_id: `CELL-${regionId.substring(0, 3).toUpperCase()}-01`,
        centroid_lat: 17.4800,
        centroid_lon: 78.5200,
        max_reflectivity_dbz: 63.5,
        area_sq_km: 380,
        speed_kmh: 42.0,
        heading_deg: 52.0,
        direction_cardinal: "NE",
        severity: "Severe",
        growth_trend: "Intensifying",
        trajectory: [
          { lead_time_min: 15, lat: 17.54, lon: 78.60 },
          { lead_time_min: 30, lat: 17.60, lon: 78.68 },
          { lead_time_min: 60, lat: 17.72, lon: 78.84 }
        ]
      }
    ],
    recent_lightning_strikes: [
      { lat: 17.44, lon: 78.49, peak_current_ka: -42.5, strike_type: "CG", polarity: "Negative", age_seconds: 18 },
      { lat: 17.46, lon: 78.53, peak_current_ka: 31.0, strike_type: "IC", polarity: "Positive", age_seconds: 45 },
      { lat: 17.41, lon: 78.46, peak_current_ka: -58.2, strike_type: "CG", polarity: "Negative", age_seconds: 82 }
    ],
    active_alerts: [
      {
        headline: `RED ALERT: Severe Thunderstorm & Lightning Warning for ${regName}`,
        severity: "Extreme",
        storm_intensity: "Intense convective core with dangerous cloud-to-ground lightning and microburst winds.",
        affected_zones: ["Urban Core", "East Sector", "North Highway Corridor"],
        expected_hazards: ["Severe cloud-to-ground lightning", "Damaging wind gusts (60-80 km/h)", "Localized torrential downpours"],
        safety_instructions: ["Seek immediate indoor shelter in sturdy structures", "Avoid open grounds, trees, and metal poles", "Unplug sensitive electrical appliances"]
      }
    ]
  };
}

/* ================= 3. Left Sidebar Telemetry Rendering ================= */
function renderTelemetry(nowcast) {
  const pred = nowcast.nowcasts[STATE.selectedLead];
  const obs = nowcast.observation;

  if (!pred) return;

  // Probability & Risk Levels
  const probPct = Math.round(pred.thunderstorm_probability * 100);
  document.getElementById("tsProbabilityText").innerText = `${probPct}%`;
  document.getElementById("currentLeadPill").innerText = `+${pred.lead_time_minutes} Min Lead`;

  // Update Conic Gradient on Threat Gauge Circle
  const gauge = document.getElementById("threatGaugeCircle");
  if (gauge) {
    const color = probPct >= 75 ? "#ef4444" : probPct >= 40 ? "#f59e0b" : "#10b981";
    gauge.style.background = `conic-gradient(${color} 0% ${probPct}%, rgba(255, 255, 255, 0.08) ${probPct}% 100%)`;
  }

  const tsBadge = document.getElementById("tsRiskBadge");
  tsBadge.innerText = pred.thunderstorm_risk;
  tsBadge.className = `badge badge-${pred.thunderstorm_risk.toLowerCase()}`;

  const ltgBadge = document.getElementById("ltgRiskBadge");
  ltgBadge.innerText = pred.lightning_risk;
  ltgBadge.className = `badge badge-${pred.lightning_risk.toLowerCase()}`;

  document.getElementById("expectedDbzVal").innerText = `${pred.expected_max_dbz} dBZ`;
  document.getElementById("expectedFlashRateVal").innerText = `${pred.expected_lightning_rate_per_min} f/min`;

  // Motion
  document.getElementById("stormHeadingVal").innerText = `${pred.storm_direction_cardinal} (${pred.storm_heading_deg}°)`;
  document.getElementById("stormSpeedVal").innerText = `${pred.storm_speed_kmh} km/h`;
  document.getElementById("stormGrowthVal").innerText = pred.cell_growth_trend;

  // Rotate compass icon
  const compass = document.getElementById("compassIcon");
  compass.style.transform = `rotate(${pred.storm_heading_deg}deg)`;

  // Lightning Jump
  const isJump = obs.lightning_jump_sigma >= 2.0;
  const jumpText = document.getElementById("jumpStatusText");
  jumpText.innerText = isJump ? `JUMP (${obs.lightning_jump_sigma}σ)` : `Normal (${obs.lightning_jump_sigma}σ)`;
  jumpText.className = isJump ? "stat-val text-danger" : "stat-val text-success";
  document.getElementById("flashCountVal").innerText = obs.flash_count_15min;

  // Sounding
  document.getElementById("capeVal").innerText = `${Math.round(obs.cape_j_kg)} J/kg`;
  document.getElementById("cinVal").innerText = `${Math.round(obs.cin_j_kg)} J/kg`;
  document.getElementById("liVal").innerText = `${obs.lifted_index.toFixed(1)} °C`;
  document.getElementById("kIndexVal").innerText = `${obs.k_index.toFixed(1)}`;
  document.getElementById("echoTopVal").innerText = `${obs.echo_top_km.toFixed(1)} km`;
  document.getElementById("vilVal").innerText = `${obs.vil_kg_m2.toFixed(1)} kg/m²`;

  // Explainable AI (XAI) Feature Drivers
  const xaiContainer = document.getElementById("xaiDriversList");
  xaiContainer.innerHTML = "";

  if (pred.key_drivers && pred.key_drivers.length > 0) {
    pred.key_drivers.forEach(d => {
      const item = document.createElement("div");
      item.className = `xai-item ${d.impact}`;
      item.innerHTML = `
        <div class="xai-item-head">
          <span>${d.label}</span>
          <span class="font-mono">${d.value} ${d.unit}</span>
        </div>
        <p class="xai-item-desc">${d.description}</p>
      `;
      xaiContainer.appendChild(item);
    });
  } else {
    xaiContainer.innerHTML = `<p class="modal-desc">No severe triggers detected at this forecast horizon.</p>`;
  }

  // Update Natural Language Situation Summary Card
  updateSituationSummary(nowcast, pred);
}

/* ================= Natural Language Situation Summary ================= */
function updateSituationSummary(nowcast, pred) {
  const summaryEl = document.getElementById("situationSummaryText");
  const hailChip = document.getElementById("chipHailRisk");
  const windChip = document.getElementById("chipWindRisk");
  if (!summaryEl) return;

  const prob = pred.thunderstorm_probability;
  const isJump = nowcast.observation.lightning_jump_sigma >= 2.0;
  const regionName = nowcast.region_name || "the forecast area";
  const dbz = pred.expected_max_dbz || nowcast.observation.max_reflectivity_dbz;

  let text = "";
  if (prob >= 0.75) {
    text = `<i class="fa-solid fa-triangle-exclamation text-danger"></i> <strong>Severe Convection Alert:</strong> High probability (${Math.round(prob * 100)}%) of intense storm activity approaching ${regionName}. Heavy lightning (${nowcast.observation.flash_count_15min} strikes) and severe rain core (${dbz.toFixed(0)} dBZ) active.`;
  } else if (prob >= 0.40) {
    text = `<i class="fa-solid fa-cloud-bolt text-warning"></i> <strong>Developing Storm:</strong> Moderate convective cells (${Math.round(prob * 100)}% probability) tracking ${pred.storm_direction_cardinal} at ${pred.storm_speed_kmh} km/h. Localized rain and lightning likely within ${pred.lead_time_minutes} min.`;
  } else {
    text = `<i class="fa-solid fa-circle-check text-success"></i> <strong>Stable Atmospheric Conditions:</strong> Low storm probability (${Math.round(prob * 100)}%) across ${regionName}. No severe microbursts or squalls detected.`;
  }

  if (isJump) {
    text += ` <em>(Schultz 2σ Lightning Jump active - severe wind/hail precursor).</em>`;
  }

  summaryEl.innerHTML = text;

  // Chips
  if (hailChip) {
    const isHail = dbz >= 58 || nowcast.observation.vil_kg_m2 >= 25;
    hailChip.innerHTML = isHail ? `<i class="fa-solid fa-snowflake text-danger"></i> Hail Risk: HIGH` : `<i class="fa-solid fa-snowflake text-success"></i> Hail Risk: LOW`;
  }
  if (windChip) {
    windChip.innerHTML = `<i class="fa-solid fa-wind text-cyan"></i> Gusts: ${Math.round(pred.storm_speed_kmh * 1.3)}-${Math.round(pred.storm_speed_kmh * 1.6)} km/h`;
  }
}

/* ================= Toast Notification System ================= */
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let icon = "fa-circle-info";
  if (type === "success") icon = "fa-circle-check";
  else if (type === "warning") icon = "fa-triangle-exclamation";
  else if (type === "danger") icon = "fa-radiation";

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4000);
}

/* ================= 4. Map Overlays (Radar Canvas, Lightning, Cells, Trajectory) ================= */
function renderMapOverlays(radarData, nowcast) {
  // 1. Render Radar Reflectivity Canvas
  if (STATE.layers.radarCanvas) {
    STATE.map.removeLayer(STATE.layers.radarCanvas);
    STATE.layers.radarCanvas = null;
  }

  if (STATE.layerVisibility.radar && radarData && radarData.color_matrix_rgba) {
    const bounds = radarData.bounds; // [min_lat, min_lon, max_lat, max_lon]
    const leafletBounds = [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]]
    ];

    // Create offscreen canvas to paint pixels
    const rows = radarData.rows;
    const cols = radarData.cols;
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rgba = radarData.color_matrix_rgba[rows - 1 - r][c]; // Flip Y for map
        const idx = (r * cols + c) * 4;
        imgData.data[idx] = rgba[0];
        imgData.data[idx + 1] = rgba[1];
        imgData.data[idx + 2] = rgba[2];
        imgData.data[idx + 3] = rgba[3];
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const imageUrl = canvas.toDataURL();
    STATE.layers.radarCanvas = L.imageOverlay(imageUrl, leafletBounds, {
      opacity: 0.85,
      interactive: false
    }).addTo(STATE.map);
  }

  // 2. Render Lightning Strikes
  STATE.layers.lightningGroup.clearLayers();
  if (STATE.layerVisibility.lightning && nowcast.recent_lightning_strikes) {
    nowcast.recent_lightning_strikes.forEach(strike => {
      const isCG = strike.strike_type === "CG";
      const marker = L.circleMarker([strike.lat, strike.lon], {
        radius: isCG ? 6 : 4,
        fillColor: isCG ? "#f59e0b" : "#fde047",
        color: "#ffffff",
        weight: 1,
        opacity: 0.9,
        fillOpacity: 0.85
      });

      marker.bindPopup(`
        <div style="font-size:11px;">
          <strong><i class="fa-solid fa-bolt text-warning"></i> Lightning Strike (${strike.strike_type})</strong><br>
          Peak Current: <b>${strike.peak_current_ka} kA (${strike.polarity})</b><br>
          Age: <b>${strike.age_seconds}s ago</b>
        </div>
      `);
      STATE.layers.lightningGroup.addLayer(marker);
    });
  }

  // 3. Render Storm Cells & Trajectories
  STATE.layers.stormCellsGroup.clearLayers();
  STATE.layers.trajectoryGroup.clearLayers();

  if (nowcast.active_cells && nowcast.active_cells.length > 0) {
    nowcast.active_cells.forEach(cell => {
      // Cell Core Marker
      const cellMarker = L.circleMarker([cell.centroid_lat, cell.centroid_lon], {
        radius: 12,
        fillColor: "#ef4444",
        color: "#ffffff",
        weight: 2,
        fillOpacity: 0.7
      });

      cellMarker.bindTooltip(`<b>${cell.cell_id}</b><br>${cell.max_reflectivity_dbz} dBZ`, {
        permanent: false,
        direction: "top"
      });

      cellMarker.on("click", () => {
        showCellFloatingInfo(cell);
      });

      STATE.layers.stormCellsGroup.addLayer(cellMarker);

      // Uncertainty Cone & Trajectory
      if (STATE.layerVisibility.tracking && cell.trajectory) {
        const pathCoords = [[cell.centroid_lat, cell.centroid_lon]];

        cell.trajectory.forEach(pt => {
          pathCoords.push([pt.lat, pt.lon]);

          // Forecast waypoints
          const wpMarker = L.circleMarker([pt.lat, pt.lon], {
            radius: 5,
            fillColor: "#38bdf8",
            color: "#ffffff",
            weight: 1.5,
            fillOpacity: 0.9
          });
          wpMarker.bindTooltip(`+${pt.lead_time_min}m forecast`, { direction: "right" });
          STATE.layers.trajectoryGroup.addLayer(wpMarker);
        });

        // Dashed trajectory vector line
        const trajLine = L.polyline(pathCoords, {
          color: "#38bdf8",
          weight: 3,
          dashArray: "6, 8",
          opacity: 0.9
        });
        STATE.layers.trajectoryGroup.addLayer(trajLine);

        // Render 60-min uncertainty cone polygon
        if (cell.uncertainty_cone_polygons && cell.uncertainty_cone_polygons[60]) {
          const conePoly = L.polygon(cell.uncertainty_cone_polygons[60], {
            color: "#38bdf8",
            fillColor: "rgba(56, 189, 248, 0.2)",
            weight: 1,
            dashArray: "3, 5"
          });
          conePoly.bindTooltip("60-Min Forecast Uncertainty Zone", { sticky: true });
          STATE.layers.trajectoryGroup.addLayer(conePoly);
        }
      }
    });
  }
}

function showCellFloatingInfo(cell) {
  const panel = document.getElementById("floatingCellInfo");
  document.getElementById("cellInfoId").innerText = cell.cell_id;
  document.getElementById("cellInfoSeverity").innerText = `${cell.severity} Core`;
  document.getElementById("cellInfoMaxDbz").innerText = `${cell.max_reflectivity_dbz} dBZ`;
  document.getElementById("cellInfoTraj").innerText = `${cell.direction_cardinal} @ ${cell.speed_kmh} km/h`;
  document.getElementById("cellInfoArea").innerText = `${cell.area_sq_km} km²`;
  panel.style.display = "block";
}

/* ================= 5. Active Convective Cells List ================= */
function renderActiveCellsList(cells) {
  const container = document.getElementById("cellsContainer");
  container.innerHTML = "";

  document.getElementById("activeCellsCount").innerText = `${cells.length} Cell${cells.length === 1 ? '' : 's'} Active`;

  if (!cells || cells.length === 0) {
    container.innerHTML = `<p style="font-size:11px; color:var(--text-muted); padding:8px;">No convective cells exceeding 35 dBZ threshold.</p>`;
    return;
  }

  cells.forEach(cell => {
    const item = document.createElement("div");
    item.className = "cell-card-item";
    item.innerHTML = `
      <div class="cell-item-top">
        <span>${cell.cell_id}</span>
        <span class="badge badge-${cell.severity.toLowerCase()}">${cell.severity}</span>
      </div>
      <div class="cell-item-metrics">
        <span>Max: <b>${cell.max_reflectivity_dbz} dBZ</b></span>
        <span>Speed: <b>${cell.speed_kmh} km/h</b></span>
        <span>Heading: <b>${cell.direction_cardinal}</b></span>
      </div>
    `;

    item.addEventListener("click", () => {
      STATE.map.flyTo([cell.centroid_lat, cell.centroid_lon], 10, { duration: 1 });
      showCellFloatingInfo(cell);
    });

    container.appendChild(item);
  });
}

/* ================= 6. Alerts & CAP Warnings ================= */
function renderAlerts(alerts) {
  const banner = document.getElementById("topAlertBanner");
  const countBadge = document.getElementById("alertCountBadge");
  countBadge.innerText = alerts.length;

  if (alerts && alerts.length > 0) {
    const alert = alerts[0];
    banner.classList.remove("hidden");
    document.getElementById("bannerHeadline").innerText = alert.headline;
    document.getElementById("bannerDetails").innerText = alert.storm_intensity;

    // Active Alert Card in right sidebar
    document.getElementById("capAlertHeadline").innerText = alert.headline;
    document.getElementById("capSeverityBadge").innerText = alert.severity;
    document.getElementById("capSeverityBadge").className = `badge badge-${alert.severity === 'Extreme' ? 'severe' : 'high'}`;

    // Zones
    const zonesContainer = document.getElementById("capAffectedZones");
    zonesContainer.innerHTML = "";
    alert.affected_zones.forEach(z => {
      const tag = document.createElement("span");
      tag.className = "zone-tag";
      tag.innerText = z;
      zonesContainer.appendChild(tag);
    });

    // Hazards
    const hazardsList = document.getElementById("capHazardsList");
    hazardsList.innerHTML = "";
    alert.expected_hazards.forEach(h => {
      const li = document.createElement("li");
      li.innerText = h;
      hazardsList.appendChild(li);
    });

    // Safety
    const safetyList = document.getElementById("capSafetyList");
    safetyList.innerHTML = "";
    alert.safety_instructions.forEach(s => {
      const li = document.createElement("li");
      li.innerText = s;
      safetyList.appendChild(li);
    });

    // Mockup modal bindings
    document.getElementById("mockupHeadline").innerText = alert.headline;
    document.getElementById("mockupBody").innerText = alert.safety_instructions.join(" ");

    // Update Export Feed Links
    const offset = TIMELINE_STEPS[STATE.timeOffsetIdx].offset_min;
    const capLink = document.getElementById("btnDownloadCapXml");
    if (capLink) capLink.href = `/api/alerts/cap.xml?region=${STATE.currentRegion}&time_offset=${offset}`;
    const geoLink = document.getElementById("btnDownloadGeoJson");
    if (geoLink) geoLink.href = `/api/alerts/geojson?region=${STATE.currentRegion}&time_offset=${offset}`;
    const bulLink = document.getElementById("btnDownloadBulletin");
    if (bulLink) bulLink.href = `/api/export-bulletin?region=${STATE.currentRegion}&time_offset=${offset}`;

    // Trigger audio siren if enabled
    if (STATE.audioEnabled && (alert.severity === "Extreme" || alert.severity === "Severe")) {
      const audio = document.getElementById("alertAudio");
      if (audio && audio.paused) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    }
  } else {
    banner.classList.add("hidden");
  }
}


/* ================= 7. Timeline Playback & Controls ================= */
function initTimelineUI() {
  const container = document.getElementById("timelineTicks");
  container.innerHTML = "";
  TIMELINE_STEPS.forEach(step => {
    const span = document.createElement("span");
    span.innerText = step.label;
    container.appendChild(span);
  });
}

function updateTimelineDisplay() {
  const step = TIMELINE_STEPS[STATE.timeOffsetIdx];
  const slider = document.getElementById("timelineSlider");
  slider.value = STATE.timeOffsetIdx;

  const typeBadge = document.getElementById("timelineTypeBadge");
  if (step.type === "observed") {
    typeBadge.innerText = step.offset_min === 0 ? "LIVE SCAN" : "OBSERVED RADAR";
    typeBadge.className = "badge badge-low";
  } else {
    typeBadge.innerText = "AI NOWCAST";
    typeBadge.className = "badge badge-high";
  }

  document.getElementById("timelineTimeDisplay").innerText = step.label;
}

function togglePlayback() {
  STATE.isPlaying = !STATE.isPlaying;
  const icon = document.getElementById("playIcon");

  if (STATE.isPlaying) {
    icon.className = "fa-solid fa-pause";
    STATE.playTimer = setInterval(async () => {
      STATE.timeOffsetIdx = (STATE.timeOffsetIdx + 1) % TIMELINE_STEPS.length;
      await fetchAndRenderData();
    }, 2500);
  } else {
    icon.className = "fa-solid fa-play";
    clearInterval(STATE.playTimer);
  }
}

/* ================= 8. Event Listeners & Modals ================= */
function setupEventListeners() {
  // Region Change
  document.getElementById("regionSelector").addEventListener("change", async (e) => {
    STATE.currentRegion = e.target.value;
    const regObj = STATE.regionsData.find(r => r.id === STATE.currentRegion);
    if (regObj) {
      STATE.map.flyTo(regObj.center, 9, { duration: 1.2 });
      showToast(`Switched radar zone to ${regObj.name}`, "info");
    }
    await fetchAndRenderData();
  });

  // Lead Time Tab Switch (30m, 60m, 90m)
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      STATE.selectedLead = btn.dataset.lead;
      showToast(`Selected +${btn.dataset.lead} Forecast Horizon`, "info");
      if (STATE.currentNowcastData) {
        renderTelemetry(STATE.currentNowcastData);
      }
    });
  });

  // Timeline Slider
  document.getElementById("timelineSlider").addEventListener("input", async (e) => {
    STATE.timeOffsetIdx = parseInt(e.target.value, 10);
    await fetchAndRenderData();
  });

  // Play / Pause Button
  document.getElementById("btnPlayPause").addEventListener("click", togglePlayback);

  // Live Button
  document.getElementById("btnLiveMode").addEventListener("click", async () => {
    STATE.timeOffsetIdx = 4; // Index of t0
    if (STATE.isPlaying) togglePlayback();
    showToast("Jumped to Live Radar Scan (t0)", "success");
    await fetchAndRenderData();
  });

  // Banner Close
  document.getElementById("btnCloseBanner").addEventListener("click", () => {
    document.getElementById("topAlertBanner").classList.add("hidden");
  });

  // Layer Toggles
  document.getElementById("chkRadar").addEventListener("change", (e) => {
    STATE.layerVisibility.radar = e.target.checked;
    fetchAndRenderData();
  });
  document.getElementById("chkSat").addEventListener("change", (e) => {
    STATE.layerVisibility.satellite = e.target.checked;
    fetchAndRenderData();
  });
  document.getElementById("chkLtg").addEventListener("change", (e) => {
    STATE.layerVisibility.lightning = e.target.checked;
    if (!e.target.checked) STATE.layers.lightningGroup.clearLayers();
    else fetchAndRenderData();
  });
  document.getElementById("chkTrack").addEventListener("change", (e) => {
    STATE.layerVisibility.tracking = e.target.checked;
    if (!e.target.checked) STATE.layers.trajectoryGroup.clearLayers();
    else fetchAndRenderData();
  });
  document.getElementById("chkOwmPrecip")?.addEventListener("change", (e) => {
    STATE.layerVisibility.owmPrecip = e.target.checked;
    if (STATE.layers.owmTileLayer) {
      if (e.target.checked) {
        STATE.map.addLayer(STATE.layers.owmTileLayer);
      } else {
        STATE.map.removeLayer(STATE.layers.owmTileLayer);
      }
    }
  });

  // User Guide Modal
  const btnOpenGuide = document.getElementById("btnOpenGuide");
  if (btnOpenGuide) {
    btnOpenGuide.addEventListener("click", () => {
      document.getElementById("guideModal").classList.remove("hidden");
    });
  }
  const btnCloseGuide = document.getElementById("btnCloseGuide");
  if (btnCloseGuide) {
    btnCloseGuide.addEventListener("click", () => {
      document.getElementById("guideModal").classList.add("hidden");
    });
  }

  // User Guide Subtabs
  const guideTabs = [
    { btn: "guideTab1Btn", content: "guideTab1Content" },
    { btn: "guideTab2Btn", content: "guideTab2Content" },
    { btn: "guideTab3Btn", content: "guideTab3Content" },
    { btn: "guideTab4Btn", content: "guideTab4Content" }
  ];

  guideTabs.forEach(t => {
    const el = document.getElementById(t.btn);
    if (el) {
      el.addEventListener("click", () => {
        guideTabs.forEach(ot => {
          document.getElementById(ot.btn)?.classList.remove("active");
          document.getElementById(ot.content)?.classList.add("hidden");
        });
        el.classList.add("active");
        document.getElementById(t.content)?.classList.remove("hidden");
      });
    }
  });

  // Modal Triggers
  document.getElementById("btnOpenSandbox").addEventListener("click", openSandboxModal);
  document.getElementById("btnCloseSandbox").addEventListener("click", () => {
    document.getElementById("sandboxModal").classList.add("hidden");
  });

  document.getElementById("btnOpenSounding").addEventListener("click", openSoundingModal);
  document.getElementById("btnCloseSounding").addEventListener("click", () => {
    document.getElementById("soundingModal").classList.add("hidden");
  });

  document.getElementById("btnOpenMeteogram").addEventListener("click", openMeteogramModal);
  document.getElementById("btnCloseMeteogram").addEventListener("click", () => {
    document.getElementById("meteogramModal").classList.add("hidden");
  });

  document.getElementById("btnOpenMetrics").addEventListener("click", openMetricsModal);
  document.getElementById("btnCloseMetrics").addEventListener("click", () => {
    document.getElementById("metricsModal").classList.add("hidden");
  });

  // Model Subtabs in Metrics Modal
  document.getElementById("btnTabOperational").addEventListener("click", () => {
    document.getElementById("btnTabOperational").classList.add("active");
    document.getElementById("btnTabBenchmark").classList.remove("active");
    document.getElementById("tabContentOperational").classList.remove("hidden");
    document.getElementById("tabContentBenchmark").classList.add("hidden");
  });

  document.getElementById("btnTabBenchmark").addEventListener("click", () => {
    document.getElementById("btnTabBenchmark").classList.add("active");
    document.getElementById("btnTabOperational").classList.remove("active");
    document.getElementById("tabContentBenchmark").classList.remove("hidden");
    document.getElementById("tabContentOperational").classList.add("hidden");
    loadModelBenchmarks();
  });

  // Audio Siren Toggle
  document.getElementById("btnToggleAudio").addEventListener("click", () => {
    STATE.audioEnabled = !STATE.audioEnabled;
    const icon = document.getElementById("audioIcon");
    if (STATE.audioEnabled) {
      icon.className = "fa-solid fa-volume-high text-cyan";
      icon.parentElement.style.borderColor = "var(--accent-cyan)";
      const audio = document.getElementById("alertAudio");
      if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
      showToast("Audio emergency sirens enabled", "warning");
    } else {
      icon.className = "fa-solid fa-volume-xmark";
      icon.parentElement.style.borderColor = "rgba(255,255,255,0.1)";
      showToast("Audio emergency sirens muted", "info");
    }
  });

  document.getElementById("btnOpenAlerts").addEventListener("click", () => {
    document.getElementById("broadcastModal").classList.remove("hidden");
  });
  document.getElementById("btnSimulateBroadcast").addEventListener("click", () => {
    document.getElementById("broadcastModal").classList.remove("hidden");
    showToast("Simulating NDMA Emergency Public Broadcast", "danger");
  });
  document.getElementById("btnCloseBroadcast").addEventListener("click", () => {
    document.getElementById("broadcastModal").classList.add("hidden");
  });

  // Privacy Policy Modal
  const btnOpenPrivacy = document.getElementById("btnOpenPrivacy");
  if (btnOpenPrivacy) {
    btnOpenPrivacy.addEventListener("click", () => {
      document.getElementById("privacyModal")?.classList.remove("hidden");
    });
  }
  const linkFooterPrivacy = document.getElementById("linkFooterPrivacy");
  if (linkFooterPrivacy) {
    linkFooterPrivacy.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("privacyModal")?.classList.remove("hidden");
    });
  }
  const btnClosePrivacy = document.getElementById("btnClosePrivacy");
  if (btnClosePrivacy) {
    btnClosePrivacy.addEventListener("click", () => {
      document.getElementById("privacyModal")?.classList.add("hidden");
    });
  }
  const btnDismissPrivacy = document.getElementById("btnDismissPrivacy");
  if (btnDismissPrivacy) {
    btnDismissPrivacy.addEventListener("click", () => {
      document.getElementById("privacyModal")?.classList.add("hidden");
    });
  }

  // Close modals on overlay click
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.classList.add("hidden");
      }
    });
  });

  // Sandbox Live Sliders
  const sandboxSliders = [
    "sliderMaxDbz", "sliderCape", "sliderCin", "sliderCtt",
    "sliderCooling", "sliderFlashRate", "sliderJump"
  ];
  sandboxSliders.forEach(id => {
    const s = document.getElementById(id);
    if (s) s.addEventListener("input", runCustomSandboxPrediction);
  });

  // Sandbox Presets
  const setPreset = (dbz, cape, cin, ctt, cooling, flash, jump, name, type) => {
    document.getElementById("sliderMaxDbz").value = dbz;
    document.getElementById("sliderCape").value = cape;
    document.getElementById("sliderCin").value = cin;
    document.getElementById("sliderCtt").value = ctt;
    document.getElementById("sliderCooling").value = cooling;
    document.getElementById("sliderFlashRate").value = flash;
    document.getElementById("sliderJump").value = jump;
    runCustomSandboxPrediction();
    showToast(`Loaded ${name} preset`, type);
  };

  document.getElementById("presetNorwester")?.addEventListener("click", () => {
    setPreset(62, 3600, 15, -74, -12, 45, 3.2, "Nor'wester Squall", "danger");
  });
  document.getElementById("presetSevere")?.addEventListener("click", () => {
    setPreset(54, 2800, 25, -68, -8, 25, 2.4, "Severe Supercell", "warning");
  });
  document.getElementById("presetModerate")?.addEventListener("click", () => {
    setPreset(38, 1400, 65, -42, -3, 8, 0.8, "Moderate Shower", "info");
  });
  document.getElementById("presetFair")?.addEventListener("click", () => {
    setPreset(18, 350, 160, -12, 1, 0, 0.1, "Fair Weather", "success");
  });
  document.getElementById("presetReset")?.addEventListener("click", () => {
    if (STATE.currentNowcastData && STATE.currentNowcastData.observation) {
      const obs = STATE.currentNowcastData.observation;
      setPreset(
        Math.round(obs.max_reflectivity_dbz),
        Math.round(obs.cape_j_kg),
        Math.round(obs.cin_j_kg),
        Math.round(obs.cloud_top_temp_c),
        obs.cloud_cooling_rate_15min,
        Math.round(obs.flash_rate_per_min),
        obs.lightning_jump_sigma,
        "Live Scan",
        "info"
      );
    }
  });

  // Keyboard Shortcuts Listener
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    
    if (e.code === "Space") {
      e.preventDefault();
      togglePlayback();
      showToast(STATE.isPlaying ? "Timeline Playing" : "Timeline Paused", "info");
    } else if (e.key === "1") {
      document.getElementById("tab30m")?.click();
    } else if (e.key === "2") {
      document.getElementById("tab60m")?.click();
    } else if (e.key === "3") {
      document.getElementById("tab90m")?.click();
    } else if (e.key === "ArrowLeft") {
      if (STATE.timeOffsetIdx > 0) {
        STATE.timeOffsetIdx--;
        fetchAndRenderData();
      }
    } else if (e.key === "ArrowRight") {
      if (STATE.timeOffsetIdx < TIMELINE_STEPS.length - 1) {
        STATE.timeOffsetIdx++;
        fetchAndRenderData();
      }
    } else if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
    }
  });
}


/* ================= 9. Interactive Sandbox Predictions ================= */
async function openSandboxModal() {
  document.getElementById("sandboxModal").classList.remove("hidden");
  await runCustomSandboxPrediction();
}

async function runCustomSandboxPrediction() {
  const maxDbz = parseFloat(document.getElementById("sliderMaxDbz").value);
  const cape = parseFloat(document.getElementById("sliderCape").value);
  const cin = parseFloat(document.getElementById("sliderCin").value);
  const ctt = parseFloat(document.getElementById("sliderCtt").value);
  const cooling = parseFloat(document.getElementById("sliderCooling").value);
  const flashRate = parseFloat(document.getElementById("sliderFlashRate").value);
  const jump = parseFloat(document.getElementById("sliderJump").value);

  // Update slider label texts
  document.getElementById("valMaxDbz").innerText = `${maxDbz} dBZ`;
  document.getElementById("valCape").innerText = `${cape} J/kg`;
  document.getElementById("valCin").innerText = `${cin} J/kg`;
  document.getElementById("valCtt").innerText = `${ctt} °C`;
  document.getElementById("valCooling").innerText = `${cooling} °C/15m`;
  document.getElementById("valFlashRate").innerText = `${flashRate} f/min`;
  document.getElementById("valJump").innerText = `${jump} σ`;

  const payload = {
    timestamp: new Date().toISOString(),
    region_id: STATE.currentRegion,
    lat: 17.3850,
    lon: 78.4867,
    max_reflectivity_dbz: maxDbz,
    mean_reflectivity_dbz: maxDbz * 0.72,
    vil_kg_m2: Math.max(0.5, (10 ** (maxDbz / 20.0)) * 0.07),
    echo_top_km: Math.max(2.0, 6.0 + (maxDbz - 30.0) * 0.32),
    reflectivity_trend_15min: 2.5,
    cloud_top_temp_c: ctt,
    cloud_cooling_rate_15min: cooling,
    water_vapor_bt_c: ctt + 4.0,
    flash_count_15min: Math.round(flashRate * 15),
    flash_rate_per_min: flashRate,
    lightning_jump_sigma: jump,
    cg_ratio: 0.30,
    cape_j_kg: cape,
    cin_j_kg: cin,
    lifted_index: -5.0,
    k_index: 37.0,
    surface_temp_c: 34.0,
    dew_point_c: 24.5,
    wind_shear_0_6km_mps: 18.0,
    rh_850hpa_pct: 78.0
  };

  try {
    const res = await fetch(getApiUrl("/api/predict-custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    const p = data.predictions;

    document.getElementById("res30mProb").innerText = `${Math.round(p["30m"].thunderstorm_probability * 100)}% (${p["30m"].thunderstorm_risk})`;
    document.getElementById("res60mProb").innerText = `${Math.round(p["60m"].thunderstorm_probability * 100)}% (${p["60m"].thunderstorm_risk})`;
    document.getElementById("res90mProb").innerText = `${Math.round(p["90m"].thunderstorm_probability * 100)}% (${p["90m"].thunderstorm_risk})`;

    const ltgBadge = document.getElementById("resLtgClass");
    ltgBadge.innerText = p["30m"].lightning_risk;
    ltgBadge.className = `badge badge-${p["30m"].lightning_risk.toLowerCase()}`;

    document.getElementById("resStormType").innerText = p["30m"].storm_classification;

    // Sandbox Drivers
    const driversDiv = document.getElementById("sandboxDrivers");
    driversDiv.innerHTML = "";
    p["30m"].key_drivers.forEach(d => {
      const item = document.createElement("div");
      item.className = `xai-item ${d.impact}`;
      item.innerHTML = `<strong style="font-size:11px;">${d.label}:</strong> <span style="font-size:10px; color:var(--text-secondary);">${d.description}</span>`;
      driversDiv.appendChild(item);
    });
  } catch (err) {
    console.error("Sandbox error:", err);
  }
}

/* ================= 10. Model AI Performance Modal ================= */
async function openMetricsModal() {
  document.getElementById("metricsModal").classList.remove("hidden");
  try {
    const res = await fetch(getApiUrl("/api/model-performance"));
    const data = await res.json();
    const metrics = data.metrics;

    // Table rows
    const tbody = document.getElementById("metricsTableBody");
    tbody.innerHTML = "";

    for (const [lead, m] of Object.entries(metrics.lead_times)) {
      const tr = document.createElement("tr");
      const cm = m.confusion_matrix;
      tr.innerHTML = `
        <td><strong class="lead-pill">+${lead}</strong></td>
        <td><b class="font-mono text-cyan">${m.roc_auc.toFixed(4)}</b></td>
        <td><span class="font-mono">${(m.accuracy * 100).toFixed(1)}%</span></td>
        <td><span class="font-mono">${(m.precision * 100).toFixed(1)}%</span></td>
        <td><span class="font-mono text-success">${(m.recall_pod * 100).toFixed(1)}%</span></td>
        <td><span class="font-mono text-warning">${m.critical_success_index_csi.toFixed(4)}</span></td>
        <td><span class="font-mono text-danger">${m.false_alarm_ratio_far.toFixed(4)}</span></td>
        <td><span class="font-mono" style="font-size:10px;">TP:${cm.tp} FP:${cm.fp} FN:${cm.fn} TN:${cm.tn}</span></td>
      `;
      tbody.appendChild(tr);
    }

    // Feature Importances
    const featDiv = document.getElementById("featureImportanceBars");
    featDiv.innerHTML = "";
    metrics.feature_importance.slice(0, 8).forEach(item => {
      const row = document.createElement("div");
      row.className = "feat-row";
      row.innerHTML = `
        <span class="feat-name">${item.feature}</span>
        <div class="feat-bar-bg">
          <div class="feat-bar-fill" style="width: ${Math.min(100, item.importance_pct * 3)}%"></div>
        </div>
        <span class="feat-pct">${item.importance_pct}%</span>
      `;
      featDiv.appendChild(row);
    });
  } catch (err) {
    console.error("Error loading model metrics:", err);
  }
}

async function loadModelBenchmarks() {
  try {
    const res = await fetch(getApiUrl("/api/model-benchmark"));
    const benchmarks = await res.json();

    const tbody = document.getElementById("benchmarkTableBody");
    tbody.innerHTML = "";

    const grid = document.getElementById("benchmarkCurvesGrid");
    grid.innerHTML = "";

    benchmarks.forEach(bm => {
      // Benchmark table row
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong style="color:var(--accent-cyan);">${bm.model_name}</strong></td>
        <td><span style="font-size:10px; color:var(--text-secondary);">${bm.model_type}</span></td>
        <td><b class="font-mono text-cyan">${bm.roc_auc_30m.toFixed(4)}</b></td>
        <td><b class="font-mono text-warning">${bm.csi_threat_score_30m.toFixed(4)}</b></td>
        <td><span class="font-mono text-success">${(bm.pod_recall_30m * 100).toFixed(1)}%</span></td>
        <td><span class="font-mono text-danger">${(bm.far_false_alarm_30m * 100).toFixed(1)}%</span></td>
        <td><span class="font-mono">${bm.hss_heidke_30m.toFixed(3)}</span></td>
        <td><span class="badge badge-low font-mono">${bm.inference_latency_ms} ms</span></td>
      `;
      tbody.appendChild(tr);

      // Degradation Curve Card
      const card = document.createElement("div");
      card.className = "benchmark-card";
      let barsHtml = "";
      for (const [lead, score] of Object.entries(bm.lead_time_csi_curve)) {
        const pct = Math.round(score * 100);
        barsHtml += `
          <div class="curve-row">
            <span>+${lead}:</span>
            <div class="curve-bar-bg">
              <div class="curve-bar-fill" style="width: ${pct}%"></div>
            </div>
            <strong>${score.toFixed(3)}</strong>
          </div>
        `;
      }

      card.innerHTML = `
        <h4>${bm.model_name}</h4>
        <p>${bm.strengths}</p>
        <div class="lead-curves-bars">
          ${barsHtml}
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error("Error loading model benchmarks:", err);
  }
}

/* ================= 11. Thermodynamic Skew-T Sounding Modal & Canvas ================= */
async function openSoundingModal() {
  document.getElementById("soundingModal").classList.remove("hidden");
  const offset = TIMELINE_STEPS[STATE.timeOffsetIdx].offset_min;
  
  try {
    const res = await fetch(getApiUrl(`/api/sounding?region=${STATE.currentRegion}&time_offset=${offset}`));
    const data = await res.json();

    // Summary banner values
    document.getElementById("sndCapeVal").innerText = `${Math.round(data.cape_j_kg)} J/kg`;
    document.getElementById("sndCinVal").innerText = `${Math.round(data.cin_j_kg)} J/kg`;
    document.getElementById("sndLiVal").innerText = `${data.lifted_index} °C`;
    document.getElementById("sndKIndexVal").innerText = `${data.k_index}`;
    document.getElementById("sndShearVal").innerText = `${data.bulk_shear_0_6km_mps} m/s`;
    document.getElementById("sndPwatVal").innerText = `${data.precipitable_water_mm} mm`;

    // Populate levels table
    const tbody = document.getElementById("soundingTableBody");
    tbody.innerHTML = "";
    data.levels.forEach(lvl => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${lvl.pressure_hpa} hPa</strong></td>
        <td>${Math.round(lvl.height_m)} m</td>
        <td class="text-danger">${lvl.temp_c} °C</td>
        <td class="text-success">${lvl.dewpoint_c} °C</td>
        <td>${lvl.wind_speed_mps} m/s (${lvl.wind_dir_deg}°)</td>
        <td>${lvl.theta_e_k} K</td>
      `;
      tbody.appendChild(tr);
    });

    // Render Canvas
    renderSkewTChart(data);
  } catch (err) {
    console.error("Error loading sounding data:", err);
  }
}

function renderSkewTChart(data) {
  const canvas = document.getElementById("skewTCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = "#070d18";
  ctx.fillRect(0, 0, W, H);

  // Coordinate mapping functions
  const padLeft = 60;
  const padRight = 70;
  const padTop = 30;
  const padBottom = 40;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  // Log-P mapping (1000 hPa at bottom, 100 hPa at top)
  function getY(p) {
    const logP = Math.log(p);
    const log1000 = Math.log(1000);
    const log100 = Math.log(100);
    return padTop + ((log1000 - logP) / (log1000 - log100)) * plotH;
  }

  // Skewed T mapping (-80°C to +40°C)
  function getX(temp, p) {
    const y = getY(p);
    const skewFactor = (H - y) * 0.38; // 45-degree skew
    const tNorm = (temp - (-80)) / (40 - (-80));
    return padLeft + tNorm * plotW + skewFactor;
  }

  // 1. Draw Isobars (horizontal pressure lines)
  const isobars = [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100];
  ctx.lineWidth = 1;
  isobars.forEach(p => {
    const y = getY(p);
    ctx.strokeStyle = p === 1000 || p === 850 || p === 500 || p === 200 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px JetBrains Mono";
    ctx.textAlign = "right";
    ctx.fillText(`${p} hPa`, padLeft - 6, y + 3);
  });

  // 2. Draw Skewed Isotherms (temperatures at 45°)
  const isotherms = [-80, -60, -40, -20, 0, 20, 40];
  isotherms.forEach(t => {
    ctx.strokeStyle = t === 0 ? "rgba(59, 130, 246, 0.4)" : "rgba(255,255,255,0.05)";
    ctx.lineWidth = t === 0 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(getX(t, 1000), getY(1000));
    ctx.lineTo(getX(t, 100), getY(100));
    ctx.stroke();

    // Bottom label
    const xBot = getX(t, 1000);
    if (xBot >= padLeft && xBot <= W - padRight) {
      ctx.fillStyle = t === 0 ? "#60a5fa" : "rgba(255,255,255,0.4)";
      ctx.font = "9px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText(`${t}°`, xBot, H - padBottom + 14);
    }
  });

  // 3. Hail Growth Zone (-10°C to -30°C band)
  const yHmin = getY(700);
  const yHmax = getY(350);
  ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
  ctx.fillRect(padLeft, yHmax, plotW, yHmin - yHmax);
  ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(padLeft, yHmax, plotW, yHmin - yHmax);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
  ctx.font = "10px Outfit";
  ctx.textAlign = "left";
  ctx.fillText("HAIL GROWTH ZONE (-10°C to -30°C)", padLeft + 10, yHmax + 16);

  // 4. LCL & LFC Markers
  const yLcl = getY(900);
  ctx.strokeStyle = "rgba(6, 182, 212, 0.7)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padLeft, yLcl);
  ctx.lineTo(W - padRight, yLcl);
  ctx.stroke();
  ctx.fillStyle = "#06b6d4";
  ctx.font = "10px Outfit";
  ctx.fillText(`LCL (${Math.round(data.lcl_height_m)}m)`, W - padRight - 90, yLcl - 4);
  ctx.setLineDash([]);

  // 5. Plot Dewpoint Curve (Td) - Green
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  data.levels.forEach((lvl, idx) => {
    const x = getX(lvl.dewpoint_c, lvl.pressure_hpa);
    const y = getY(lvl.pressure_hpa);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 6. Plot Temperature Curve (T) - Red
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  data.levels.forEach((lvl, idx) => {
    const x = getX(lvl.temp_c, lvl.pressure_hpa);
    const y = getY(lvl.pressure_hpa);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 7. Plot Parcel Ascent Curve - Cyan Dashed
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  data.levels.forEach((lvl, idx) => {
    const parcelT = lvl.pressure_hpa >= 850 ? data.surface_temp_c - (lvl.height_m / 1000) * 5.0 : lvl.temp_c + (data.cape_j_kg / 500);
    const x = getX(parcelT, lvl.pressure_hpa);
    const y = getY(lvl.pressure_hpa);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 8. Draw Points on Curves & Wind Barbs
  data.levels.forEach(lvl => {
    const xt = getX(lvl.temp_c, lvl.pressure_hpa);
    const xd = getX(lvl.dewpoint_c, lvl.pressure_hpa);
    const y = getY(lvl.pressure_hpa);

    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(xt, y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(xd, y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Wind Barbs
    const barbX = W - padRight + 28;
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(barbX, y);
    ctx.lineTo(barbX + 24, y);
    ctx.stroke();

    const spd = lvl.wind_speed_mps;
    if (spd >= 10) {
      ctx.beginPath();
      ctx.moveTo(barbX + 24, y);
      ctx.lineTo(barbX + 18, y - 8);
      ctx.stroke();
    }
    if (spd >= 20) {
      ctx.beginPath();
      ctx.moveTo(barbX + 18, y);
      ctx.lineTo(barbX + 12, y - 8);
      ctx.stroke();
    }
  });
}

/* ================= 12. Meteogram Time-Series Modal & Canvas ================= */
async function openMeteogramModal() {
  document.getElementById("meteogramModal").classList.remove("hidden");
  try {
    const res = await fetch(getApiUrl(`/api/meteogram?region=${STATE.currentRegion}`));
    const data = await res.json();
    renderMeteogramChart(data);
  } catch (err) {
    console.error("Error loading meteogram data:", err);
  }
}

function renderMeteogramChart(data) {
  const canvas = document.getElementById("meteogramCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = "#070d18";
  ctx.fillRect(0, 0, W, H);

  const padLeft = 55;
  const padRight = 55;
  const padTop = 35;
  const padBottom = 45;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const pts = data.data_points;
  const N = pts.length;
  if (N === 0) return;

  function getX(idx) {
    return padLeft + (idx / (N - 1)) * plotW;
  }

  // 1. Draw Grid Lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padTop + (i / 5) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.stroke();

    const val = 100 - i * 20;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px JetBrains Mono";
    ctx.textAlign = "right";
    ctx.fillText(`${val}`, padLeft - 6, y + 3);
  }

  // 2. Draw t0 Live Separator Line
  const t0Idx = pts.findIndex(p => p.offset_min === 0);
  if (t0Idx !== -1) {
    const x0 = getX(t0Idx);
    ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, padTop);
    ctx.lineTo(x0, H - padBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#06b6d4";
    ctx.font = "10px Outfit";
    ctx.textAlign = "center";
    ctx.fillText("LIVE SCAN (t0)", x0, padTop - 12);
  }

  // 3. Draw X-axis Timeline Labels
  pts.forEach((pt, idx) => {
    const x = getX(idx);
    ctx.fillStyle = pt.offset_min === 0 ? "#06b6d4" : "rgba(255,255,255,0.6)";
    ctx.font = "10px JetBrains Mono";
    ctx.textAlign = "center";
    ctx.fillText(pt.label, x, H - padBottom + 16);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "9px Outfit";
    ctx.fillText(pt.timestamp, x, H - padBottom + 28);
  });

  // Helper to draw series curve
  function drawSeries(getValue, color, lineWidth = 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    pts.forEach((pt, idx) => {
      const val = getValue(pt);
      const y = padTop + (1.0 - (val / 100.0)) * plotH;
      const x = getX(idx);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots
    ctx.fillStyle = color;
    pts.forEach((pt, idx) => {
      const val = getValue(pt);
      const y = padTop + (1.0 - (val / 100.0)) * plotH;
      const x = getX(idx);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Curve 1: Max dBZ (Orange)
  drawSeries(p => p.max_reflectivity_dbz, "#f97316", 2.5);

  // Curve 2: 30m Storm Probability % (Red)
  drawSeries(p => p.thunderstorm_prob_30m, "#ef4444", 2.5);

  // Curve 3: 60m Storm Probability % (Cyan)
  drawSeries(p => p.thunderstorm_prob_60m, "#06b6d4", 2);

  // Curve 4: Flash Rate normalized to 0-100 (Yellow)
  drawSeries(p => Math.min(100, p.flash_rate_per_min * 1.5), "#eab308", 1.8);
}


/* ================= 13. Specific Area Search & Pinpoint Assessment ================= */
let searchDebounceTimer = null;
let currentSuggestions = [];

function initAreaSearch() {
  const searchInput = document.getElementById("areaSearchInput");
  const clearBtn = document.getElementById("btnClearSearch");
  const dropdown = document.getElementById("searchSuggestionsDropdown");
  const listEl = document.getElementById("suggestionsList");

  if (!searchInput) return;

  // Global Keyboard Shortcuts (Ctrl+K, Cmd+K, or /)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if (e.key === "/" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "SELECT") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  // Input typing with debounce
  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val.length > 0) {
      clearBtn.classList.remove("hidden");
    } else {
      clearBtn.classList.add("hidden");
    }

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
      await performAreaSearch(val);
    }, 220);
  });

  // Focus & Click
  searchInput.addEventListener("focus", async () => {
    const val = searchInput.value.trim();
    await performAreaSearch(val);
  });

  // Clear button
  clearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.classList.add("hidden");
    dropdown.classList.add("hidden");
    clearSearchedArea();
    searchInput.focus();
  });

  // Keyboard navigation inside search
  searchInput.addEventListener("keydown", (e) => {
    if (dropdown.classList.contains("hidden")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      STATE.activeSuggestionIdx = Math.min(STATE.activeSuggestionIdx + 1, currentSuggestions.length - 1);
      updateActiveSuggestionHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      STATE.activeSuggestionIdx = Math.max(STATE.activeSuggestionIdx - 1, -1);
      updateActiveSuggestionHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (STATE.activeSuggestionIdx >= 0 && STATE.activeSuggestionIdx < currentSuggestions.length) {
        selectSearchedArea(currentSuggestions[STATE.activeSuggestionIdx]);
      } else if (currentSuggestions.length > 0) {
        selectSearchedArea(currentSuggestions[0]);
      } else if (searchInput.value.trim().length >= 3) {
        geocodeFallback(searchInput.value.trim());
      }
    } else if (e.key === "Escape") {
      dropdown.classList.add("hidden");
      searchInput.blur();
    }
  });

  // Close dropdown on click outside
  document.addEventListener("click", (e) => {
    const container = document.getElementById("areaSearchContainer");
    if (container && !container.contains(e.target)) {
      dropdown.classList.add("hidden");
    }
  });

  // Disable click propagation to map on Searched Area Card
  const areaCardEl = document.getElementById("searchedAreaCard");
  if (areaCardEl && typeof L !== "undefined" && L.DomEvent) {
    L.DomEvent.disableClickPropagation(areaCardEl);
    L.DomEvent.disableScrollPropagation(areaCardEl);
  }

  // Searched Area Card Buttons
  document.getElementById("btnCloseSearchedArea")?.addEventListener("click", (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const card = document.getElementById("searchedAreaCard");
    if (card) {
      card.classList.add("hidden");
      card.style.display = "none";
    }
  });

  document.getElementById("btnRecenterSearchedArea")?.addEventListener("click", () => {
    if (STATE.searchedLocation) {
      STATE.map.flyTo([STATE.searchedLocation.lat, STATE.searchedLocation.lon], 12, { duration: 1 });
    }
  });

  document.getElementById("btnSwitchToNearestRadar")?.addEventListener("click", async () => {
    if (STATE.searchedAssessment && STATE.searchedAssessment.nearest_region_id) {
      const regId = STATE.searchedAssessment.nearest_region_id;
      if (regId !== STATE.currentRegion) {
        STATE.currentRegion = regId;
        const sel = document.getElementById("regionSelector");
        if (sel) sel.value = regId;
        showToast(`Switched radar overlay to ${STATE.searchedAssessment.nearest_radar_station}`, "info");
        await fetchAndRenderData();
        if (STATE.searchedLocation) {
          STATE.map.flyTo([STATE.searchedLocation.lat, STATE.searchedLocation.lon], 12, { duration: 1 });
        }
      } else {
        showToast(`Already displaying ${STATE.searchedAssessment.nearest_radar_station}`, "info");
      }
    }
  });

  document.getElementById("btnClearAreaPin")?.addEventListener("click", () => {
    clearSearchedArea();
    showToast("Cleared searched area pin", "info");
  });

  // Map Click to Search / Pinpoint
  STATE.map.on("click", async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    const name = `Coordinates (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`;
    const locObj = {
      name: name,
      lat: lat,
      lon: lon,
      category: "coordinate",
      state: "Pinned on Map"
    };
    await selectSearchedArea(locObj);
  });
}

async function performAreaSearch(query) {
  const dropdown = document.getElementById("searchSuggestionsDropdown");
  const listEl = document.getElementById("suggestionsList");
  const countEl = document.getElementById("suggestionsCount");
  
  if (!query || query.length === 0) {
    // Show top radar zones & popular tech hubs as presets
    const presets = [
      { name: "Gachibowli, Hyderabad", lat: 17.4401, lon: 78.3489, category: "locality", state: "Telangana", nearest_region_id: "hyderabad", nearest_radar_station: "DWR Begumpet", distance_to_radar_km: 14.2 },
      { name: "Salt Lake (Bidhannagar / Sector V), Kolkata", lat: 22.5804, lon: 88.4287, category: "locality", state: "West Bengal", nearest_region_id: "kolkata", nearest_radar_station: "DWR Kolkata", distance_to_radar_km: 11.5 },
      { name: "Connaught Place (Central Delhi)", lat: 28.6315, lon: 77.2167, category: "landmark", state: "Delhi", nearest_region_id: "delhi", nearest_radar_station: "DWR Mausam Bhawan", distance_to_radar_km: 4.8 },
      { name: "Whitefield (ITPB), Bengaluru", lat: 12.9698, lon: 77.7500, category: "locality", state: "Karnataka", nearest_region_id: "bengaluru", nearest_radar_station: "DWR Bengaluru", distance_to_radar_km: 18.6 },
      { name: "Bandra-Kurla Complex (BKC), Mumbai", lat: 19.0657, lon: 72.8687, category: "locality", state: "Maharashtra", nearest_region_id: "mumbai", nearest_radar_station: "DWR Veravali", distance_to_radar_km: 7.2 },
      { name: "Patia & Infocity, Bhubaneswar", lat: 20.3541, lon: 85.8193, category: "locality", state: "Odisha", nearest_region_id: "bhubaneswar", nearest_radar_station: "DWR Paradip", distance_to_radar_km: 82.0 },
      { name: "OMR IT Corridor (Sholinganallur), Chennai", lat: 12.9010, lon: 80.2279, category: "locality", state: "Tamil Nadu", nearest_region_id: "chennai", nearest_radar_station: "DWR Sriharikota", distance_to_radar_km: 91.0 }
    ];
    currentSuggestions = presets;
    renderSuggestionsList(presets, "Popular Convective & Radar Hotspots");
    dropdown.classList.remove("hidden");
    return;
  }

  try {
    const res = await fetch(getApiUrl(`/api/search-locations?q=${encodeURIComponent(query)}&limit=8`));
    let results = await res.json();

    // If local results are empty and user typed 3+ chars, try OpenStreetMap Nominatim geocoding
    if ((!results || results.length === 0) && query.length >= 3) {
      try {
        const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', India')}&limit=4`, {
          headers: { "Accept-Language": "en" }
        });
        if (nomRes.ok) {
          const nomData = await nomRes.json();
          nomData.forEach(item => {
            results.push({
              name: item.display_name.split(",").slice(0, 3).join(","),
              lat: parseFloat(item.lat),
              lon: parseFloat(item.lon),
              category: item.type === "city" ? "city" : "locality",
              state: "India",
              nearest_region_id: STATE.currentRegion,
              nearest_radar_station: "Indian Radar Network",
              distance_to_radar_km: 0
            });
          });
        }
      } catch (nomErr) {
        console.warn("Nominatim fallback geocode error:", nomErr);
      }
    }

    currentSuggestions = results;
    STATE.activeSuggestionIdx = -1;

    if (results.length > 0) {
      renderSuggestionsList(results, `Found ${results.length} Locations`);
      dropdown.classList.remove("hidden");
    } else {
      listEl.innerHTML = `
        <div style="padding:16px; text-align:center; color:var(--text-muted); font-size:11.5px;">
          <i class="fa-solid fa-map-location-dot" style="font-size:22px; color:rgba(255,255,255,0.2); margin-bottom:8px; display:block;"></i>
          No matching area found for "<strong>${query}</strong>".<br>
          <span style="font-size:10px; color:var(--text-secondary);">Try searching a city, locality, district or GPS coordinates (e.g. 17.44, 78.34).</span>
        </div>
      `;
      if (countEl) countEl.innerText = "0 found";
      dropdown.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Search error:", err);
  }
}

async function geocodeFallback(query) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const loc = {
          name: item.display_name.split(",").slice(0, 3).join(","),
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          category: "locality",
          state: "Searched Location"
        };
        await selectSearchedArea(loc);
      } else {
        showToast(`Could not find coordinates for "${query}"`, "warning");
      }
    }
  } catch (err) {
    showToast(`Search lookup failed for "${query}"`, "danger");
  }
}

function renderSuggestionsList(items, headerText) {
  const listEl = document.getElementById("suggestionsList");
  const countEl = document.getElementById("suggestionsCount");
  if (countEl) countEl.innerText = `${items.length} found`;
  listEl.innerHTML = "";

  items.forEach((loc, idx) => {
    const itemEl = document.createElement("div");
    itemEl.className = "suggestion-item";
    itemEl.dataset.idx = idx;

    let iconClass = "fa-location-dot";
    let catClass = loc.category || "locality";
    if (loc.category === "radar_station") iconClass = "fa-tower-broadcast";
    else if (loc.category === "airport") iconClass = "fa-plane-departure";
    else if (loc.category === "city") iconClass = "fa-city";
    else if (loc.category === "landmark") iconClass = "fa-monument";
    else if (loc.category === "coordinate") iconClass = "fa-crosshairs";

    itemEl.innerHTML = `
      <div class="suggestion-left">
        <div class="suggestion-icon ${catClass}">
          <i class="fa-solid ${iconClass}"></i>
        </div>
        <div class="suggestion-info">
          <span class="suggestion-name">${loc.name}</span>
          <span class="suggestion-sub">
            <span>${loc.state || (loc.category ? loc.category.toUpperCase() : "India")}</span>
            <span>•</span>
            <span class="font-mono">${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°</span>
          </span>
        </div>
      </div>
      <div class="suggestion-right">
        <span class="radar-dist-tag" title="Nearest Radar: ${loc.nearest_radar_station || 'IMD DWR'}">
          ${loc.distance_to_radar_km ? loc.distance_to_radar_km + ' km DWR' : (loc.nearest_region_id || '').toUpperCase()}
        </span>
      </div>
    `;

    itemEl.addEventListener("click", () => {
      selectSearchedArea(loc);
    });

    listEl.appendChild(itemEl);
  });
}

function updateActiveSuggestionHighlight() {
  const items = document.querySelectorAll(".suggestion-item");
  items.forEach((el, idx) => {
    if (idx === STATE.activeSuggestionIdx) {
      el.classList.add("active");
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      el.classList.remove("active");
    }
  });
}

async function selectSearchedArea(loc) {
  STATE.searchedLocation = loc;
  
  const searchInput = document.getElementById("areaSearchInput");
  const clearBtn = document.getElementById("btnClearSearch");
  const dropdown = document.getElementById("searchSuggestionsDropdown");

  if (searchInput) searchInput.value = loc.name;
  if (clearBtn) clearBtn.classList.remove("hidden");
  if (dropdown) dropdown.classList.add("hidden");

  // Fly Map to area
  STATE.map.flyTo([loc.lat, loc.lon], 12, { duration: 1.2 });

  showToast(`Located ${loc.name}`, "info");

  // Fetch threat assessment & render overlays
  await fetchAndRenderSearchedAreaThreat(loc.lat, loc.lon, loc.name, loc.category, true);
}

async function fetchAndRenderSearchedAreaThreat(lat, lon, name, category = "locality", autoSwitchRegion = true) {
  const step = TIMELINE_STEPS[STATE.timeOffsetIdx];
  const offset = step.offset_min;

  try {
    const res = await fetch(getApiUrl(`/api/area-assessment?lat=${lat}&lon=${lon}&time_offset=${offset}&name=${encodeURIComponent(name || '')}`));
    if (!res.ok) throw new Error("Area assessment failed");
    const data = await res.json();
    STATE.searchedAssessment = data;

    // Sync resolved name if available
    if (data.location_name) {
      if (STATE.searchedLocation) STATE.searchedLocation.name = data.location_name;
      const sInput = document.getElementById("areaSearchInput");
      if (sInput && (!sInput.value || sInput.value.startsWith("Coordinates ("))) {
        sInput.value = data.location_name;
      }
    }

    // Render Pin & Proximity Circle on Map
    renderSearchedAreaPin(data, category);

    // Render Floating Searched Area Card
    renderSearchedAreaCard(data, category);

    // If searched location belongs to another radar region and autoSwitchRegion is true, notify user
    if (autoSwitchRegion && data.nearest_region_id && data.nearest_region_id !== STATE.currentRegion) {
      const currentRegObj = STATE.regionsData.find(r => r.id === STATE.currentRegion);
      if (currentRegObj) {
        const dCurrent = haversineDistance(lat, lon, currentRegObj.center[0], currentRegObj.center[1]);
        if (dCurrent > 150) {
          STATE.currentRegion = data.nearest_region_id;
          const regSelect = document.getElementById("regionSelector");
          if (regSelect) regSelect.value = data.nearest_region_id;
          showToast(`Synced radar overlay with ${data.nearest_radar_station}`, "info");
          await fetchAndRenderData();
        }
      }
    }
  } catch (err) {
    console.error("Error fetching area assessment:", err);
  }
}

function renderSearchedAreaPin(data, category) {
  if (!STATE.layers.searchedAreaGroup) {
    STATE.layers.searchedAreaGroup = L.layerGroup().addTo(STATE.map);
  }
  STATE.layers.searchedAreaGroup.clearLayers();

  const lat = data.query_lat;
  const lon = data.query_lon;

  // Custom HTML DivIcon with pulsing beacon
  const pinIcon = L.divIcon({
    className: "search-pin-divicon",
    html: `
      <div class="search-pin-wrapper">
        <div class="search-radar-beacon"></div>
        <div class="search-pin-center"></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const marker = L.marker([lat, lon], { icon: pinIcon, zIndexOffset: 1000 });

  marker.bindTooltip(`
    <div style="font-size:11px; font-weight:700;">
      <i class="fa-solid fa-location-dot text-cyan"></i> <b>${data.location_name}</b><br>
      <span class="badge badge-${data.threat_level.toLowerCase()}">${data.threat_level} Threat (${data.threat_score_pct}%)</span><br>
      Local: <b>${data.local_dbz} dBZ</b> | Rain: <b>${data.estimated_rain_rate_mmh} mm/h</b>
    </div>
  `, { permanent: false, direction: "top", offset: [0, -12] });

  marker.on("click", () => {
    document.getElementById("searchedAreaCard").classList.remove("hidden");
    renderSearchedAreaCard(data, category);
  });

  STATE.layers.searchedAreaGroup.addLayer(marker);

  // Proximity 10 km Warning Radius Ring
  const proximityCircle = L.circle([lat, lon], {
    radius: 10000, // 10 km
    color: data.threat_level === "Severe" ? "#ef4444" : data.threat_level === "High" ? "#f59e0b" : "#06b6d4",
    fillColor: data.threat_level === "Severe" ? "#ef4444" : data.threat_level === "High" ? "#f59e0b" : "#06b6d4",
    fillOpacity: 0.08,
    weight: 1.5,
    dashArray: "4, 6"
  });
  proximityCircle.bindTooltip("10 km Area Monitoring Radius", { sticky: true });
  STATE.layers.searchedAreaGroup.addLayer(proximityCircle);

  // If a storm cell is active, draw a vector line from cell to searched location
  if (data.nearest_cell_id && STATE.currentNowcastData && STATE.currentNowcastData.active_cells) {
    const cell = STATE.currentNowcastData.active_cells.find(c => c.cell_id === data.nearest_cell_id);
    if (cell && data.distance_to_nearest_cell_km !== null) {
      const vectorLine = L.polyline([[lat, lon], [cell.centroid_lat, cell.centroid_lon]], {
        color: "#f59e0b",
        weight: 2,
        dashArray: "3, 5",
        opacity: 0.85
      });
      vectorLine.bindTooltip(`Distance to ${cell.cell_id}: <b>${data.distance_to_nearest_cell_km} km</b>`, { sticky: true });
      STATE.layers.searchedAreaGroup.addLayer(vectorLine);
    }
  }
}

function renderSearchedAreaCard(data, category) {
  const card = document.getElementById("searchedAreaCard");
  if (!card) return;

  card.classList.remove("hidden");
  card.style.display = "block";

  // Title & Coordinates
  document.getElementById("searchedAreaTitle").innerText = data.location_name || `Location (${data.query_lat.toFixed(4)}°, ${data.query_lon.toFixed(4)}°)`;
  document.getElementById("searchedAreaCategory").innerText = category || "Locality";
  document.getElementById("searchedAreaCoords").innerText = `${data.query_lat.toFixed(4)}° N, ${data.query_lon.toFixed(4)}° E`;

  // Threat badge & score
  const badge = document.getElementById("searchedAreaThreatBadge");
  badge.innerText = `${data.threat_level} Threat`;
  badge.className = `badge badge-${data.threat_level.toLowerCase()}`;

  document.getElementById("searchedThreatScore").innerText = `${data.threat_score_pct}%`;
  
  // Threat banner text
  const headlineEl = document.getElementById("searchedThreatHeadline");
  if (data.threat_level === "Severe") {
    headlineEl.innerText = "High-Impact Severe Convective Core";
    headlineEl.className = "text-danger";
  } else if (data.threat_level === "High") {
    headlineEl.innerText = "Elevated Convection & Lightning Threat";
    headlineEl.className = "text-warning";
  } else if (data.threat_level === "Moderate") {
    headlineEl.innerText = "Developing Showers in Vicinity";
    headlineEl.className = "text-accent";
  } else {
    headlineEl.innerText = "Atmospherically Stable / Low Risk";
    headlineEl.className = "text-success";
  }

  document.getElementById("searchedRadarContext").innerText = `Covered by ${data.nearest_radar_station} (${data.distance_to_radar_km} km)`;

  // OpenWeatherMap Live In-Situ Observations
  const owmBox = document.getElementById("owmLiveBox");
  if (data.live_weather) {
    if (owmBox) owmBox.classList.remove("hidden");
    const lw = data.live_weather;
    const tempVal = typeof lw.temperature_c === "number" ? lw.temperature_c : (typeof lw.temp_c === "number" ? lw.temp_c : 28.0);
    const feelsVal = typeof lw.feels_like_c === "number" ? lw.feels_like_c : tempVal;
    
    const tempEl = document.getElementById("owmTemp");
    if (tempEl) tempEl.innerText = `${tempVal.toFixed(1)} °C (feels ${feelsVal.toFixed(1)}°)`;
    
    const condEl = document.getElementById("owmCondition");
    if (condEl) condEl.innerText = lw.condition || lw.description || lw.condition_main || "Current Weather";
    
    const humEl = document.getElementById("owmHumidity");
    if (humEl) humEl.innerText = `${lw.humidity_pct ?? 60}%`;
    
    const windEl = document.getElementById("owmWind");
    const windKmh = typeof lw.wind_speed_kmh === "number" ? lw.wind_speed_kmh : (typeof lw.wind_speed_mps === "number" ? lw.wind_speed_mps * 3.6 : 10.0);
    const windDeg = lw.wind_deg ?? 0;
    if (windEl) windEl.innerText = `${windKmh.toFixed(1)} km/h (${windDeg}°)`;
    
    const presEl = document.getElementById("owmPressure");
    if (presEl) presEl.innerText = `${lw.pressure_hpa ?? 1010} hPa`;
    
    const iconEl = document.getElementById("owmWeatherIcon");
    if (iconEl) {
      if (lw.icon_url) {
        iconEl.src = lw.icon_url;
      } else if (lw.icon_code) {
        iconEl.src = `https://openweathermap.org/img/wn/${lw.icon_code}@2x.png`;
      }
    }
  } else if (owmBox) {
    owmBox.classList.add("hidden");
  }

  // Meteorological metrics
  document.getElementById("searchedLocalDbz").innerText = `${data.local_dbz} dBZ`;
  document.getElementById("searchedRainRate").innerText = `${data.estimated_rain_rate_mmh} mm/h rain`;

  const cellEl = document.getElementById("searchedNearestCell");
  const etaEl = document.getElementById("searchedCellEta");
  if (data.distance_to_nearest_cell_km !== null && data.distance_to_nearest_cell_km <= 60.0) {
    cellEl.innerText = `${data.distance_to_nearest_cell_km} km`;
    if (data.nearest_cell_approaching && data.estimated_cell_eta_minutes) {
      etaEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up text-danger"></i> Approaching (ETA ~${data.estimated_cell_eta_minutes}m)`;
    } else if (data.nearest_cell_approaching) {
      etaEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up text-warning"></i> Approaching`;
    } else {
      etaEl.innerHTML = `<i class="fa-solid fa-arrow-right text-muted"></i> Tracking away`;
    }
  } else {
    cellEl.innerText = "None in range";
    etaEl.innerText = "No storm core within 60km";
  }

  document.getElementById("searchedLightningCount").innerText = `${data.lightning_strikes_15km} strikes`;
  document.getElementById("searchedCloudTemp").innerText = `${data.local_cloud_top_temp_c} °C`;

  // NDMA safety advice
  document.getElementById("searchedSafetyText").innerText = data.safety_directive;
}

function clearSearchedArea() {
  STATE.searchedLocation = null;
  STATE.searchedAssessment = null;
  if (STATE.layers.searchedAreaGroup) {
    STATE.layers.searchedAreaGroup.clearLayers();
  }
  const card = document.getElementById("searchedAreaCard");
  if (card) {
    card.classList.add("hidden");
    card.style.display = "none";
  }
  const searchInput = document.getElementById("areaSearchInput");
  if (searchInput) searchInput.value = "";
  document.getElementById("btnClearSearch")?.classList.add("hidden");
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}


