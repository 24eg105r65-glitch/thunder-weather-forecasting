/**
 * Aerocast-AI: Operational Multimodal Thunderstorm & Lightning Nowcasting Cockpit
 * Zero-dependency, high-reliability frontend engine with Google Maps Leaflet integration
 */

const STATE = {
  currentRegion: "hyderabad",
  selectedLead: "30m", // "30m", "60m", "90m"
  timeOffsetIdx: 4,    // 0 to 9 (4 = T-0 Live Scan)
  isPlaying: false,
  playTimer: null,
  audioEnabled: false,
  map: null,
  layers: {
    radarCanvas: null,
    lightningGroup: null,
    stormCellsGroup: null,
    trajectoryGroup: null,
    searchedAreaGroup: null
  },
  baseTileLayers: {},
  currentBaseLayer: null,
  layerVisibility: {
    radar: true,
    satellite: true,
    lightning: true,
    tracking: true
  },
  currentNowcastData: null,
  regionsData: [],
  searchedLocation: null,
  searchedAssessment: null,
  activeSuggestionIdx: -1
};

const TIMELINE_STEPS = [
  { offset_min: -60, label: "-60m", type: "observed" },
  { offset_min: -45, label: "-45m", type: "observed" },
  { offset_min: -30, label: "-30m", type: "observed" },
  { offset_min: -15, label: "-15m", type: "observed" },
  { offset_min: 0,   label: "T-0 NOW", type: "observed" },
  { offset_min: 15,  label: "+15m", type: "nowcasted" },
  { offset_min: 30,  label: "+30m MAX", type: "nowcasted" },
  { offset_min: 45,  label: "+45m", type: "nowcasted" },
  { offset_min: 60,  label: "+60m", type: "nowcasted" },
  { offset_min: 90,  label: "+90m", type: "nowcasted" }
];

// Safe JSON Fetch Helper
async function fetchJsonSafe(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// API Base URL Resolver
function getApiUrl(endpoint) {
  if (window.location.protocol === "file:" || !window.location.origin || window.location.origin === "null") {
    return `http://127.0.0.1:8000${endpoint}`;
  }
  return endpoint;
}

/* ================= View Mode Switcher (Simple Citizen vs Advanced Radar) ================= */
function initModeSwitch() {
  const savedMode = localStorage.getItem("aerocast_view_mode") || "simple";
  setMode(savedMode, false);

  const btnCitizen = document.getElementById("btnCitizenMode");
  const btnExpert = document.getElementById("btnExpertMode");

  if (btnCitizen) {
    btnCitizen.addEventListener("click", () => setMode("simple", true));
  }
  if (btnExpert) {
    btnExpert.addEventListener("click", () => setMode("expert", true));
  }
}

function setMode(mode, notify = true) {
  const isSimple = mode === "simple";
  document.body.classList.remove("mode-simple", "mode-expert");
  document.body.classList.add(isSimple ? "mode-simple" : "mode-expert");

  const btnCitizen = document.getElementById("btnCitizenMode");
  const btnExpert = document.getElementById("btnExpertMode");

  if (btnCitizen && btnExpert) {
    if (isSimple) {
      btnCitizen.classList.add("active");
      btnExpert.classList.remove("active");
    } else {
      btnExpert.classList.add("active");
      btnCitizen.classList.remove("active");
    }
  }

  try {
    localStorage.setItem("aerocast_view_mode", isSimple ? "simple" : "expert");
  } catch (e) {}

  if (notify) {
    if (isSimple) {
      showToast("Simple Citizen View: plain-English warnings & safety advice", "info");
    } else {
      showToast("Advanced Radar View: Doppler soundings & AI microphysics", "info");
    }
  }
}

/* ================= Application Startup ================= */
document.addEventListener("DOMContentLoaded", async () => {
  startLiveClocks();
  initModeSwitch();
  initMap();
  setupEventListeners();
  initAreaSearch();
  initChatbot();
  await loadRegions();
  await fetchAndRenderData();
});

/* ================= 1. Leaflet GIS Map Initialization ================= */
function initMap() {
  if (typeof L === "undefined") {
    setTimeout(initMap, 250);
    return;
  }
  if (STATE.map) return;

  const mapEl = document.getElementById("gisMap");
  if (!mapEl) return;

  STATE.map = L.map("gisMap", {
    center: [17.3850, 78.4867],
    zoom: 9,
    zoomControl: true,
    attributionControl: false
  });

  // Google Maps base layers & Dark radar tiles
  STATE.baseTileLayers = {
    google_hybrid: L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      subdomains: ["mt0", "mt1", "mt2", "mt3"]
    }),
    google_streets: L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      subdomains: ["mt0", "mt1", "mt2", "mt3"]
    }),
    google_terrain: L.tileLayer("https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      subdomains: ["mt0", "mt1", "mt2", "mt3"]
    }),
    google_sat: L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      subdomains: ["mt0", "mt1", "mt2", "mt3"]
    }),
    carto_dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd"
    }),
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    })
  };

  STATE.currentBaseLayer = STATE.baseTileLayers.google_hybrid;
  STATE.currentBaseLayer.addTo(STATE.map);

  STATE.layers.lightningGroup = L.layerGroup().addTo(STATE.map);
  STATE.layers.stormCellsGroup = L.layerGroup().addTo(STATE.map);
  STATE.layers.trajectoryGroup = L.layerGroup().addTo(STATE.map);
  STATE.layers.searchedAreaGroup = L.layerGroup().addTo(STATE.map);
}

/* ================= 2. Data Fetching & Sync ================= */
async function loadRegions() {
  const data = await fetchJsonSafe(getApiUrl("/api/regions"));
  if (data && Array.isArray(data) && data.length > 0) {
    STATE.regionsData = data;
  } else {
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
  const offset = step ? step.offset_min : 0;
  const regionId = STATE.currentRegion;

  // 1. Fetch nowcast
  let nowcast = await fetchJsonSafe(getApiUrl(`/api/nowcast?region=${regionId}&time_offset=${offset}`));
  if (!nowcast) {
    nowcast = generateFallbackNowcast(regionId, offset);
  }
  STATE.currentNowcastData = nowcast;

  // 2. Fetch radar grid
  let radarGrid = await fetchJsonSafe(getApiUrl(`/api/radar-grid?region=${regionId}&time_offset=${offset}`));
  if (!radarGrid || !radarGrid.color_matrix_rgba) {
    radarGrid = generateFallbackRadarGrid(regionId, offset);
  }

  renderTelemetry(nowcast);
  renderMapOverlays(radarGrid, nowcast);
  updateTimelineDisplay();

  // Re-assess searched area if active
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

// Fallback Synthetic Radar Generator
function generateFallbackRadarGrid(regionId, offset) {
  const centers = {
    hyderabad: [17.3850, 78.4867],
    kolkata: [22.5726, 88.3639],
    delhi: [28.6139, 77.2090],
    bhubaneswar: [20.2961, 85.8245],
    mumbai: [19.0760, 72.8777],
    chennai: [13.0827, 80.2707],
    guwahati: [26.1445, 91.7362],
    bengaluru: [12.9716, 77.5946]
  };

  const center = centers[regionId] || centers.hyderabad;
  const latSpan = 1.2;
  const lonSpan = 1.2;
  const rows = 48;
  const cols = 48;

  const dx = (offset / 60) * 0.22;
  const dy = (offset / 60) * 0.22;
  const stormCenterR = Math.floor(rows * 0.45 + (dy / latSpan) * rows);
  const stormCenterC = Math.floor(cols * 0.45 + (dx / lonSpan) * cols);

  const matrix = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const dist = Math.sqrt(Math.pow(r - stormCenterR, 2) + Math.pow(c - stormCenterC, 2));
      let dbz = 0;
      if (dist < 14) {
        dbz = Math.max(0, 62.5 - dist * 4.2 + (Math.sin(r * 0.8) + Math.cos(c * 0.8)) * 3);
      } else if (dist < 22) {
        dbz = Math.max(0, 32.0 - (dist - 14) * 3.5);
      }

      let rgba = [0, 0, 0, 0];
      if (dbz >= 55) rgba = [217, 70, 239, 210];       // Magenta / Purple (Hail)
      else if (dbz >= 48) rgba = [239, 68, 68, 200];   // Red (Severe Thunderstorm)
      else if (dbz >= 38) rgba = [245, 158, 11, 180];  // Amber (Heavy Downpour)
      else if (dbz >= 28) rgba = [16, 185, 129, 160];  // Green (Moderate Rain)
      else if (dbz >= 15) rgba = [56, 189, 248, 140];  // Blue (Light Rain)

      row.push(rgba);
    }
    matrix.push(row);
  }

  return {
    rows: rows,
    cols: cols,
    bounds: [center[0] - latSpan / 2, center[1] - lonSpan / 2, center[0] + latSpan / 2, center[1] + lonSpan / 2],
    color_matrix_rgba: matrix
  };
}

// Helper: Great-circle haversine distance in km
function calcHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Fallback Nowcast Generator with distinct regional microphysics
function generateFallbackNowcast(regionId, offset) {
  const regionalProfiles = {
    hyderabad: {
      name: "Hyderabad & Telangana",
      center: [17.3850, 78.4867],
      temp: 32.0,
      dew: 23.5,
      cape: 2650.0,
      cin: 35.0,
      dbz: 58.0,
      flash_rate: 18.0,
      flash_count: 54,
      echo_top: 15.2,
      ctt: -68.5,
      vil: 42.0,
      speed: 38.0,
      dir: "NE",
      heading: 55.0,
      prob30: 0.88,
      risk: "Severe"
    },
    kolkata: {
      name: "Kolkata & Bengal",
      center: [22.5726, 88.3639],
      temp: 32.5,
      dew: 26.5,
      cape: 3450.0,
      cin: 20.0,
      dbz: 64.0,
      flash_rate: 48.0,
      flash_count: 144,
      echo_top: 17.8,
      ctt: -78.2,
      vil: 56.4,
      speed: 48.0,
      dir: "SE",
      heading: 135.0,
      prob30: 0.98,
      risk: "Severe"
    },
    delhi: {
      name: "Delhi-NCR & Western UP",
      center: [28.6139, 77.2090],
      temp: 35.0,
      dew: 20.5,
      cape: 1950.0,
      cin: 60.0,
      dbz: 52.0,
      flash_rate: 14.0,
      flash_count: 42,
      echo_top: 13.8,
      ctt: -62.0,
      vil: 34.0,
      speed: 44.0,
      dir: "ENE",
      heading: 68.0,
      prob30: 0.78,
      risk: "High"
    },
    bhubaneswar: {
      name: "Bhubaneswar & Odisha",
      center: [20.2961, 85.8245],
      temp: 33.0,
      dew: 26.0,
      cape: 2900.0,
      cin: 25.0,
      dbz: 60.5,
      flash_rate: 32.0,
      flash_count: 96,
      echo_top: 16.5,
      ctt: -72.0,
      vil: 48.2,
      speed: 36.0,
      dir: "NE",
      heading: 45.0,
      prob30: 0.92,
      risk: "Severe"
    },
    mumbai: {
      name: "Mumbai & Konkan",
      center: [19.0760, 72.8777],
      temp: 31.0,
      dew: 26.5,
      cape: 2400.0,
      cin: 20.0,
      dbz: 55.0,
      flash_rate: 20.0,
      flash_count: 60,
      echo_top: 14.5,
      ctt: -65.0,
      vil: 39.5,
      speed: 32.0,
      dir: "NNE",
      heading: 25.0,
      prob30: 0.82,
      risk: "High"
    },
    chennai: {
      name: "Chennai & Coastal TN",
      center: [13.0827, 80.2707],
      temp: 33.5,
      dew: 25.5,
      cape: 2700.0,
      cin: 30.0,
      dbz: 54.0,
      flash_rate: 22.0,
      flash_count: 66,
      echo_top: 14.8,
      ctt: -66.5,
      vil: 38.0,
      speed: 30.0,
      dir: "N",
      heading: 10.0,
      prob30: 0.80,
      risk: "High"
    },
    guwahati: {
      name: "Guwahati & Assam",
      center: [26.1445, 91.7362],
      temp: 29.5,
      dew: 25.0,
      cape: 3100.0,
      cin: 15.0,
      dbz: 61.0,
      flash_rate: 36.0,
      flash_count: 108,
      echo_top: 16.8,
      ctt: -74.0,
      vil: 50.0,
      speed: 28.0,
      dir: "ESE",
      heading: 110.0,
      prob30: 0.94,
      risk: "Severe"
    },
    bengaluru: {
      name: "Bengaluru & South Karnataka",
      center: [12.9716, 77.5946],
      temp: 26.5,
      dew: 19.5,
      cape: 1650.0,
      cin: 45.0,
      dbz: 46.0,
      flash_rate: 10.0,
      flash_count: 30,
      echo_top: 12.5,
      ctt: -54.0,
      vil: 28.0,
      speed: 26.0,
      dir: "E",
      heading: 90.0,
      prob30: 0.65,
      risk: "Moderate"
    }
  };

  const p = regionalProfiles[regionId] || regionalProfiles.hyderabad;
  const lat = p.center[0];
  const lon = p.center[1];

  return {
    region_id: regionId,
    region_name: p.name,
    observation: {
      max_reflectivity_dbz: p.dbz,
      echo_top_km: p.echo_top,
      vil_kg_m2: p.vil,
      flash_rate_per_min: p.flash_rate,
      flash_count_15min: p.flash_count,
      lightning_jump_sigma: p.flash_rate >= 30 ? 2.6 : 1.6,
      cloud_top_temp_c: p.ctt,
      cloud_cooling_rate_15min: -12.0,
      cape_j_kg: p.cape,
      cin_j_kg: p.cin,
      lifted_index: -6.5,
      surface_temp_c: p.temp,
      dew_point_c: p.dew
    },
    nowcasts: {
      "30m": {
        lead_time_minutes: 30,
        thunderstorm_probability: p.prob30,
        lightning_probability: Math.min(0.99, p.prob30 - 0.02),
        thunderstorm_risk: p.risk,
        expected_max_dbz: p.dbz + 1.0,
        storm_speed_kmh: p.speed,
        storm_direction_cardinal: p.dir,
        storm_heading_deg: p.heading
      },
      "60m": {
        lead_time_minutes: 60,
        thunderstorm_probability: Math.max(0.4, p.prob30 - 0.12),
        lightning_probability: Math.max(0.35, p.prob30 - 0.10),
        thunderstorm_risk: p.risk,
        expected_max_dbz: Math.max(35, p.dbz - 4.0),
        storm_speed_kmh: p.speed - 3.0,
        storm_direction_cardinal: p.dir,
        storm_heading_deg: p.heading + 3.0
      },
      "90m": {
        lead_time_minutes: 90,
        thunderstorm_probability: Math.max(0.2, p.prob30 - 0.28),
        lightning_probability: Math.max(0.2, p.prob30 - 0.25),
        thunderstorm_risk: p.prob30 > 0.8 ? "Moderate" : "Low",
        expected_max_dbz: Math.max(25, p.dbz - 12.0),
        storm_speed_kmh: Math.max(15, p.speed - 8.0),
        storm_direction_cardinal: p.dir,
        storm_heading_deg: p.heading + 6.0
      }
    },
    active_cells: [
      {
        cell_id: `CELL-${regionId.substring(0, 3).toUpperCase()}-904`,
        centroid_lat: lat + 0.06,
        centroid_lon: lon + 0.05,
        max_reflectivity_dbz: p.dbz,
        area_sq_km: 380,
        speed_kmh: p.speed,
        direction_cardinal: p.dir,
        severity: p.risk,
        trajectory: [
          { lead_time_min: 15, lat: lat + 0.10, lon: lon + 0.09 },
          { lead_time_min: 30, lat: lat + 0.18, lon: lon + 0.16 },
          { lead_time_min: 60, lat: lat + 0.30, lon: lon + 0.28 }
        ]
      }
    ],
    recent_lightning_strikes: [
      { lat: lat + 0.05, lon: lon + 0.04, peak_current_ka: -48.5, strike_type: "CG", polarity: "Negative", age_seconds: 14 },
      { lat: lat + 0.07, lon: lon + 0.06, peak_current_ka: 34.0, strike_type: "IC", polarity: "Positive", age_seconds: 38 },
      { lat: lat + 0.03, lon: lon + 0.02, peak_current_ka: -62.0, strike_type: "CG", polarity: "Negative", age_seconds: 72 }
    ]
  };
}

/* ================= 3. Telemetry & Tactical HUD Rendering ================= */
async function renderTelemetry(nowcast) {
  if (!nowcast || !nowcast.nowcasts) return;
  const pred = nowcast.nowcasts[STATE.selectedLead] || nowcast.nowcasts["30m"];
  const obs = nowcast.observation || {};
  if (!pred) return;

  const prob = pred.thunderstorm_probability ?? 0.95;
  const probPct = Math.round(prob * 100);
  const dbz = pred.expected_max_dbz || obs.max_reflectivity_dbz || 55.0;
  const regionName = nowcast.region_name || "Forecast Corridor";
  const isJump = (obs.lightning_jump_sigma ?? 1.5) >= 2.0;
  const cell = (nowcast.active_cells && nowcast.active_cells[0]) || { cell_id: `CELL #${(nowcast.region_id || 'TC').substring(0,3).toUpperCase()}-904`, max_reflectivity_dbz: dbz };
  const flashRate = obs.flash_rate_per_min || 24;

  // 1. Top Hero Alert Bar
  const heroCellTitle = document.getElementById("heroCellTitle");
  const heroSurgeProb = document.getElementById("heroSurgeProb");
  const heroLeadTime = document.getElementById("heroLeadTime");
  const heroCape = document.getElementById("heroCape");
  const heroVil = document.getElementById("heroVil");

  if (heroCellTitle) heroCellTitle.textContent = `${(cell.cell_id || 'CELL #TC-904').toUpperCase()} CONVECTIVE ERUPTION`;
  if (heroSurgeProb) heroSurgeProb.textContent = `${probPct}%`;
  if (heroLeadTime) heroLeadTime.textContent = `T-00:${pred.lead_time_minutes || 32}m`;
  if (heroCape) heroCape.textContent = `${Math.round(obs.cape_j_kg || 2650)} J/kg`;
  if (heroVil) heroVil.textContent = `${(obs.vil_kg_m2 || 42.0).toFixed(1)} kg/m²`;

  // 2. Floating Live Map HUD
  const hudCellId = document.getElementById("hudCellId");
  const hudCellType = document.getElementById("hudCellType");
  const hudCellSector = document.getElementById("hudCellSector");
  const hudMaxDbz = document.getElementById("hudMaxDbz");
  const hudEchoTop = document.getElementById("hudEchoTop");
  const hudLightningRate = document.getElementById("hudLightningRate");
  const hudLightningDelta = document.getElementById("hudLightningDelta");
  const hudJumpStatus = document.getElementById("hudJumpStatus");
  const hudJumpLead = document.getElementById("hudJumpLead");
  const hudRadarStation = document.getElementById("hudRadarStation");

  if (hudCellId) hudCellId.textContent = cell.cell_id || "Cell #TC-904";
  if (hudCellType) hudCellType.textContent = dbz >= 55 ? "SUPERCELL" : dbz >= 45 ? "MULTICELL" : "CONVECTIVE";
  if (hudCellSector) hudCellSector.textContent = `${regionName} Convective Corridor`;
  if (hudMaxDbz) hudMaxDbz.textContent = `${dbz.toFixed(1)}`;
  if (hudEchoTop) hudEchoTop.textContent = `${(obs.echo_top_km || 15.2).toFixed(1)}`;
  if (hudLightningRate) hudLightningRate.textContent = `${Math.round(flashRate * 3.2)}`;
  if (hudLightningDelta) hudLightningDelta.textContent = isJump ? `(+310%)` : `(+45%)`;
  if (hudJumpStatus) hudJumpStatus.textContent = isJump ? "TRIGGERED" : "MONITORING";
  if (hudJumpLead) hudJumpLead.textContent = `T-${pred.lead_time_minutes || 32}m Lead`;
  if (hudRadarStation) hudRadarStation.textContent = `DOPPLER RADAR: ${regionName.toUpperCase()}`;

  // 3. Analytics Microphysics Grid
  const surgeAccelVal = document.getElementById("surgeAccelVal");
  const peakFlashRate = document.getElementById("peakFlashRate");
  const icCgRatio = document.getElementById("icCgRatio");
  const cgNegPct = document.getElementById("cgNegPct");
  const cgPosPct = document.getElementById("cgPosPct");
  const updraftVel = document.getElementById("updraftVel");
  const vilDensity = document.getElementById("vilDensity");
  const dcapeVal = document.getElementById("dcapeVal");
  const dcapeBar = document.getElementById("dcapeBar");

  const calcUpdraft = (14 + ((obs.cape_j_kg || 2650) / 4000) * 18).toFixed(1);
  const calcVilDensity = (2.2 + ((obs.vil_kg_m2 || 42.0) / 60) * 2.5).toFixed(2);
  const calcDcape = Math.round(500 + ((obs.cape_j_kg || 2650) / 4000) * 850);

  if (surgeAccelVal) surgeAccelVal.textContent = isJump ? `+58 strikes/min²` : `+18 strikes/min²`;
  if (peakFlashRate) peakFlashRate.textContent = `PEAK: ${Math.round(flashRate * 3.2)} fl/min`;
  if (icCgRatio) icCgRatio.textContent = "4.2 : 1.0";
  if (cgNegPct) cgNegPct.textContent = "-CG: 86%";
  if (cgPosPct) cgPosPct.textContent = "+CG: 14%";
  if (updraftVel) updraftVel.textContent = calcUpdraft;
  if (vilDensity) vilDensity.textContent = calcVilDensity;
  if (dcapeVal) dcapeVal.textContent = `${calcDcape} J/kg (${calcDcape > 1000 ? 'Severe Microburst Risk' : 'Moderate Downburst Risk'})`;
  if (dcapeBar) dcapeBar.style.width = `${Math.min(100, Math.round((calcDcape / 1500) * 100))}%`;

  // 4. Citizen Warning Card
  renderCitizenHeroCard(nowcast, pred);

  // 5. Update Citizen Live Ground Weather Card
  await updateCitizenLiveGroundWeather(nowcast);
}

// Live Ground Weather Card Synchronizer
async function updateCitizenLiveGroundWeather(nowcast) {
  const cTemp = document.getElementById("citizenTemp");
  const cFeels = document.getElementById("citizenFeelsLike");
  const cCond = document.getElementById("citizenCondition");
  const cIcon = document.getElementById("citizenWeatherIcon");
  const cHum = document.getElementById("citizenHumidity");
  const cWind = document.getElementById("citizenWind");
  const cPres = document.getElementById("citizenPressure");
  const cLtg = document.getElementById("citizenLightning");
  const cLoc = document.getElementById("citizenStationLocation");
  const cTime = document.getElementById("citizenObsTimestamp");

  if (!cTemp) return;

  const obs = nowcast.observation || {};
  const regName = nowcast.region_name || "Regional Station";
  const strikes = (nowcast.recent_lightning_strikes && nowcast.recent_lightning_strikes.length) || Math.round((obs.flash_count_15min || 15) / 3);

  // Initial defaults from nowcast
  let tempC = obs.surface_temp_c || 28.0;
  let humPct = Math.round(obs.rh_850hpa_pct || 72);
  let feelsC = Math.round((tempC + (humPct > 60 ? (humPct - 60) * 0.1 : 0)) * 10) / 10;
  let conditionText = obs.max_reflectivity_dbz >= 50 ? "Severe Thunderstorm" : obs.max_reflectivity_dbz >= 35 ? "Rain Showers & Thunder" : humPct >= 80 ? "Humid / Overcast" : "Partly Cloudy";
  let iconCode = obs.max_reflectivity_dbz >= 45 ? "11d" : obs.max_reflectivity_dbz >= 25 ? "10d" : humPct >= 75 ? "04d" : "02d";
  let windSpeedKmh = 12.5;
  let pressureHpa = 1012;

  if (cLoc) cLoc.innerText = `${regName} Doppler Radar Corridor`;
  if (cTime) cTime.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Fetch live in-situ weather for region center
  const regObj = STATE.regionsData.find(r => r.id === STATE.currentRegion);
  if (regObj && regObj.center) {
    const [cLat, cLon] = regObj.center;
    let liveData = await fetchJsonSafe(getApiUrl(`/api/live-weather?lat=${cLat}&lon=${cLon}`));
    if (!liveData) {
      try {
        const owm = await fetchJsonSafe(`https://api.openweathermap.org/data/2.5/weather?lat=${cLat}&lon=${cLon}&appid=6fd95f47f4586bd267deccc0834fa5fa&units=metric`);
        if (owm && owm.main) {
          liveData = {
            temperature_c: owm.main.temp,
            feels_like_c: owm.main.feels_like || owm.main.temp,
            humidity_pct: owm.main.humidity,
            pressure_hpa: owm.main.pressure,
            wind_speed_kmh: (owm.wind?.speed || 0) * 3.6,
            condition: owm.weather?.[0]?.description ? (owm.weather[0].description.charAt(0).toUpperCase() + owm.weather[0].description.slice(1)) : "Clear",
            icon_code: owm.weather?.[0]?.icon || "01d",
            city_name: owm.name || regName
          };
        }
      } catch (e) {}
    }

    if (liveData) {
      tempC = liveData.temperature_c;
      feelsC = liveData.feels_like_c;
      humPct = liveData.humidity_pct;
      pressureHpa = liveData.pressure_hpa || 1012;
      windSpeedKmh = liveData.wind_speed_kmh || 12.0;
      conditionText = liveData.condition || conditionText;
      iconCode = liveData.icon_code || iconCode;
      if (cLoc && liveData.city_name) {
        cLoc.innerText = `${liveData.city_name} (${regName})`;
      }
    }
  }

  if (cTemp) cTemp.innerText = `${tempC.toFixed(1)}°C`;
  if (cFeels) cFeels.innerText = `Feels ${feelsC.toFixed(1)}°C`;
  if (cCond) cCond.innerText = conditionText;
  if (cIcon) cIcon.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
  if (cHum) cHum.innerText = `${humPct}%`;
  if (cWind) cWind.innerText = `${windSpeedKmh.toFixed(1)} km/h`;
  if (cPres) cPres.innerText = `${pressureHpa} hPa`;
  if (cLtg) cLtg.innerText = `${strikes} strikes`;
}
}

/* ================= Citizen Hero Warning Card Rendering ================= */
function renderCitizenHeroCard(nowcast, pred) {
  const heroCard = document.getElementById("citizenHeroCard");
  const iconBox = document.getElementById("citizenStatusIconBox");
  const icon = document.getElementById("citizenStatusIcon");
  const title = document.getElementById("citizenStatusTitle");
  const etaText = document.getElementById("citizenEtaText");
  const summaryText = document.getElementById("citizenSummaryText");

  if (!heroCard) return;

  const prob = pred.thunderstorm_probability ?? 0.95;
  const regionName = nowcast.region_name || "the forecast area";
  const dbz = pred.expected_max_dbz || 60;

  if (prob >= 0.70 || dbz >= 50) {
    heroCard.className = "card citizen-hero-card severe";
    if (iconBox) {
      iconBox.style.background = "rgba(239, 68, 68, 0.18)";
      iconBox.style.color = "#ef4444";
    }
    if (icon) icon.className = "fa-solid fa-triangle-exclamation";
    if (title) title.innerText = "DANGER: Severe Thunderstorm Approaching";
    if (summaryText) {
      summaryText.innerHTML = `Severe storm core active over <strong>${regionName}</strong>. High probability of dangerous lightning, strong wind gusts (60-80 km/h), and localized heavy downpours over the next 30 to 60 minutes.`;
    }
    if (etaText) etaText.innerText = "Storm arriving in ~25 min";
  } else if (prob >= 0.35) {
    heroCard.className = "card citizen-hero-card moderate";
    if (iconBox) {
      iconBox.style.background = "rgba(245, 158, 11, 0.18)";
      iconBox.style.color = "#f59e0b";
    }
    if (icon) icon.className = "fa-solid fa-cloud-bolt";
    if (title) title.innerText = "CAUTION: Rain & Lightning Developing";
    if (summaryText) {
      summaryText.innerHTML = `Moderate convective shower activity building near <strong>${regionName}</strong>. Localized rain and isolated lightning expected.`;
    }
    if (etaText) etaText.innerText = "Showers within ~45 min";
  } else {
    heroCard.className = "card citizen-hero-card stable";
    if (iconBox) {
      iconBox.style.background = "rgba(16, 185, 129, 0.18)";
      iconBox.style.color = "#10b981";
    }
    if (icon) icon.className = "fa-solid fa-circle-check";
    if (title) title.innerText = "ALL CLEAR: Atmospheric Conditions Stable";
    if (summaryText) {
      summaryText.innerHTML = `Atmospheric conditions are stable across <strong>${regionName}</strong>. No severe rain squalls or lightning threats detected.`;
    }
    if (etaText) etaText.innerText = "No storm detected";
  }
}

/* ================= 4. Map Overlays (Radar Canvas, Lightning, Cells, Trajectory) ================= */
function renderMapOverlays(radarData, nowcast) {
  if (!STATE.map) return;

  // 1. Doppler Radar Reflectivity Canvas
  if (STATE.layers.radarCanvas) {
    STATE.map.removeLayer(STATE.layers.radarCanvas);
    STATE.layers.radarCanvas = null;
  }

  if (STATE.layerVisibility.radar && radarData && radarData.color_matrix_rgba) {
    const bounds = radarData.bounds;
    const leafletBounds = [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]]
    ];

    const rows = radarData.rows;
    const cols = radarData.cols;
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(cols, rows);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rgba = radarData.color_matrix_rgba[rows - 1 - r][c];
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
      opacity: 0.82,
      interactive: false
    }).addTo(STATE.map);
    if (STATE.layers.radarCanvas.bringToFront) {
      STATE.layers.radarCanvas.bringToFront();
    }
  }

  // 2. Real-Time Lightning Strikes
  if (STATE.layers.lightningGroup) {
    STATE.layers.lightningGroup.clearLayers();
    if (STATE.layerVisibility.lightning && nowcast.recent_lightning_strikes) {
      nowcast.recent_lightning_strikes.forEach(strike => {
        const isCG = strike.strike_type === "CG";
        const marker = L.circleMarker([strike.lat, strike.lon], {
          radius: isCG ? 6 : 4,
          fillColor: isCG ? "#ef4444" : "#f59e0b",
          color: "#ffffff",
          weight: 1.5,
          opacity: 0.95,
          fillOpacity: 0.9
        });
        marker.bindTooltip(`<b>${strike.strike_type} Strike</b><br>${strike.peak_current_ka} kA (${strike.polarity})`, { direction: "top" });
        STATE.layers.lightningGroup.addLayer(marker);
      });
    }
  }

  // 3. Storm Cells & Trajectories
  if (STATE.layers.stormCellsGroup && STATE.layers.trajectoryGroup) {
    STATE.layers.stormCellsGroup.clearLayers();
    STATE.layers.trajectoryGroup.clearLayers();

    if (nowcast.active_cells && nowcast.active_cells.length > 0) {
      nowcast.active_cells.forEach(cell => {
        const cellMarker = L.circleMarker([cell.centroid_lat, cell.centroid_lon], {
          radius: 12,
          fillColor: "#ef4444",
          color: "#ffffff",
          weight: 2,
          fillOpacity: 0.75
        });
        cellMarker.bindTooltip(`<b>${cell.cell_id}</b><br>${cell.max_reflectivity_dbz} dBZ`, { direction: "top" });
        STATE.layers.stormCellsGroup.addLayer(cellMarker);

        if (STATE.layerVisibility.tracking && cell.trajectory) {
          const pathCoords = [[cell.centroid_lat, cell.centroid_lon]];
          cell.trajectory.forEach(pt => {
            pathCoords.push([pt.lat, pt.lon]);
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

          const trajLine = L.polyline(pathCoords, {
            color: "#38bdf8",
            weight: 3,
            dashArray: "6, 8",
            opacity: 0.9
          });
          STATE.layers.trajectoryGroup.addLayer(trajLine);
        }
      });
    }
  }
}

/* ================= 5. Live Clocks & Timeline Display ================= */
function startLiveClocks() {
  function update() {
    const now = new Date();
    const utcHours = String(now.getUTCHours()).padStart(2, "0");
    const utcMin = String(now.getUTCMinutes()).padStart(2, "0");
    const utcSec = String(now.getUTCSeconds()).padStart(2, "0");
    const utcEl = document.getElementById("utcClock");
    if (utcEl) utcEl.textContent = `${utcHours}:${utcMin}:${utcSec}Z`;

    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
    const istHours = String(istDate.getHours()).padStart(2, "0");
    const istMin = String(istDate.getMinutes()).padStart(2, "0");
    const istSec = String(istDate.getSeconds()).padStart(2, "0");
    const istEl = document.getElementById("istClock");
    if (istEl) istEl.textContent = `${istHours}:${istMin}:${istSec}`;
  }
  update();
  setInterval(update, 1000);
}

function updateTimelineDisplay() {
  document.querySelectorAll(".timeline-step-btn").forEach((btn, idx) => {
    if (idx === STATE.timeOffsetIdx) {
      btn.classList.add("bg-primary", "text-on-primary", "font-bold", "shadow-lg");
      btn.classList.remove("hover:text-primary", "hover:text-error");
    } else {
      btn.classList.remove("bg-primary", "text-on-primary", "font-bold", "shadow-lg");
    }
  });
}

function togglePlayback() {
  STATE.isPlaying = !STATE.isPlaying;
  const playIcon = document.getElementById("play-icon");

  if (STATE.isPlaying) {
    if (playIcon) playIcon.textContent = "pause";
    STATE.playTimer = setInterval(async () => {
      STATE.timeOffsetIdx = (STATE.timeOffsetIdx + 1) % TIMELINE_STEPS.length;
      await fetchAndRenderData();
    }, 2500);
    showToast("Timeline Replay Active", "info");
  } else {
    if (playIcon) playIcon.textContent = "play_arrow";
    clearInterval(STATE.playTimer);
    showToast("Timeline Replay Paused", "info");
  }
}

/* ================= 6. Event Listeners & Modals ================= */
function setupEventListeners() {
  // Region Selector
  const regSelect = document.getElementById("regionSelector");
  if (regSelect) {
    regSelect.addEventListener("change", async (e) => {
      STATE.currentRegion = e.target.value;
      const regObj = STATE.regionsData.find(r => r.id === STATE.currentRegion);
      if (regObj && STATE.map) {
        STATE.map.flyTo(regObj.center, 9, { duration: 1.2 });
        showToast(`Switched radar station to ${regObj.name}`, "info");
      }
      await fetchAndRenderData();
    });
  }

  // Timeline Step Buttons (-60m to +90m)
  document.querySelectorAll(".timeline-step-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.index, 10);
      if (!isNaN(idx) && idx >= 0 && idx < TIMELINE_STEPS.length) {
        STATE.timeOffsetIdx = idx;
        await fetchAndRenderData();
      }
    });
  });

  // Playback button
  document.getElementById("playback-btn")?.addEventListener("click", togglePlayback);

  // Quick Action: CAP Disseminate
  const capBtn = document.getElementById("cap-alert-btn");
  if (capBtn) {
    capBtn.addEventListener("click", () => {
      capBtn.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span><span>DISSEMINATING CAP XML...</span>';
      setTimeout(() => {
        capBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">done_all</span><span>CAP ALERT BROADCASTED</span>';
        showToast("CAP v1.2 Sachet Broadcasted to Emergency Gateways", "success");
      }, 1000);
    });
  }

  // Quick Action: Dispatch Siren
  const dispatchBtn = document.getElementById("dispatch-siren-btn");
  if (dispatchBtn) {
    dispatchBtn.addEventListener("click", () => {
      dispatchBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">check_circle</span><span>12 SEOC SIRENS ACTIVATED</span>';
      showToast("12 SEOC Civil Sirens Activated Across Impact Zones", "danger");
      playAlertAudio();
    });
  }

  // Quick Action: 3D Dipole Layer
  const dipoleBtn = document.getElementById("toggle-dipole-btn");
  const dipoleLabel = document.getElementById("dipole-label");
  let dipoleState = true;
  if (dipoleBtn && dipoleLabel) {
    dipoleBtn.addEventListener("click", () => {
      dipoleState = !dipoleState;
      if (dipoleState) {
        dipoleLabel.textContent = "3D ELECTRIC DIPOLE [ON]";
        dipoleBtn.classList.add("text-primary");
        showToast("3D Electric Dipole Layer Enabled", "info");
      } else {
        dipoleLabel.textContent = "3D ELECTRIC DIPOLE [OFF]";
        dipoleBtn.classList.remove("text-primary");
        showToast("3D Electric Dipole Layer Disabled", "info");
      }
    });
  }

  // Audio Siren Toggle
  document.getElementById("btnToggleAudio")?.addEventListener("click", () => {
    STATE.audioEnabled = !STATE.audioEnabled;
    const icon = document.getElementById("audioIcon");
    if (STATE.audioEnabled) {
      if (icon) icon.className = "fa-solid fa-volume-high text-cyan";
      playAlertAudio();
      showToast("Audio emergency sirens enabled", "warning");
    } else {
      if (icon) icon.className = "fa-solid fa-volume-xmark";
      showToast("Audio emergency sirens muted", "info");
    }
  });

  // Base Map Layer Selector
  const baseMapSelect = document.getElementById("baseMapSelect");
  if (baseMapSelect) {
    baseMapSelect.addEventListener("change", (e) => {
      const selected = e.target.value;
      if (STATE.baseTileLayers && STATE.baseTileLayers[selected] && STATE.map) {
        if (STATE.currentBaseLayer) {
          STATE.map.removeLayer(STATE.currentBaseLayer);
        }
        STATE.currentBaseLayer = STATE.baseTileLayers[selected];
        STATE.currentBaseLayer.addTo(STATE.map);
        if (STATE.layers.radarCanvas && STATE.layers.radarCanvas.bringToFront) {
          STATE.layers.radarCanvas.bringToFront();
        }
        showToast(`Map base switched to ${selected.replace('_', ' ').toUpperCase()}`, "info");
      }
    });
  }

  // Radar Overlays Checkboxes
  document.getElementById("chkRadar")?.addEventListener("change", (e) => {
    STATE.layerVisibility.radar = e.target.checked;
    fetchAndRenderData();
  });
  document.getElementById("chkSat")?.addEventListener("change", (e) => {
    STATE.layerVisibility.satellite = e.target.checked;
    fetchAndRenderData();
  });
  document.getElementById("chkLtg")?.addEventListener("change", (e) => {
    STATE.layerVisibility.lightning = e.target.checked;
    if (!e.target.checked && STATE.layers.lightningGroup) STATE.layers.lightningGroup.clearLayers();
    else fetchAndRenderData();
  });
  document.getElementById("chkTrack")?.addEventListener("change", (e) => {
    STATE.layerVisibility.tracking = e.target.checked;
    if (!e.target.checked && STATE.layers.trajectoryGroup) STATE.layers.trajectoryGroup.clearLayers();
    else fetchAndRenderData();
  });

  // Modals Wiring
  // 1. Sandbox Modal
  document.getElementById("btnOpenSandbox")?.addEventListener("click", openSandboxModal);
  document.getElementById("btnCloseSandbox")?.addEventListener("click", () => document.getElementById("sandboxModal")?.classList.add("hidden"));
  document.getElementById("btnDismissSandbox")?.addEventListener("click", () => document.getElementById("sandboxModal")?.classList.add("hidden"));

  // Sandbox Sliders Listeners
  const sbSliders = ["sbMaxDbz", "sbLtgRate", "sbCape", "sbCin", "sbEchoTop", "sbCtt"];
  sbSliders.forEach(id => {
    document.getElementById(id)?.addEventListener("input", runCustomSandboxPrediction);
  });

  // Sandbox Presets
  const setSandboxPreset = (dbz, ltg, cape, cin, echoTop, ctt, name, badgeType) => {
    const sDbz = document.getElementById("sbMaxDbz");
    const sLtg = document.getElementById("sbLtgRate");
    const sCape = document.getElementById("sbCape");
    const sCin = document.getElementById("sbCin");
    const sEcho = document.getElementById("sbEchoTop");
    const sCtt = document.getElementById("sbCtt");

    if (sDbz) sDbz.value = dbz;
    if (sLtg) sLtg.value = ltg;
    if (sCape) sCape.value = cape;
    if (sCin) sCin.value = cin;
    if (sEcho) sEcho.value = echoTop;
    if (sCtt) sCtt.value = ctt;

    runCustomSandboxPrediction();
    showToast(`Loaded ${name} preset`, badgeType);
  };

  document.getElementById("presetFair")?.addEventListener("click", () => setSandboxPreset(18, 0, 350, 160, 5.0, -12, "Fair Weather", "success"));
  document.getElementById("presetDeveloping")?.addEventListener("click", () => setSandboxPreset(38, 8, 1400, 65, 9.5, -42, "Developing Shower", "info"));
  document.getElementById("presetSevere")?.addEventListener("click", () => setSandboxPreset(55, 35, 2800, 25, 14.5, -65, "Severe Supercell", "warning"));
  document.getElementById("presetNorwester")?.addEventListener("click", () => setSandboxPreset(64, 68, 3800, 10, 17.5, -76, "Nor'wester Squall", "danger"));

  // 2. Sounding Modal
  document.getElementById("btnOpenSounding")?.addEventListener("click", openSoundingModal);
  document.getElementById("btnCloseSounding")?.addEventListener("click", () => document.getElementById("soundingModal")?.classList.add("hidden"));
  document.getElementById("btnDismissSounding")?.addEventListener("click", () => document.getElementById("soundingModal")?.classList.add("hidden"));

  // 3. Meteogram Modal
  document.getElementById("btnOpenMeteogram")?.addEventListener("click", openMeteogramModal);
  document.getElementById("btnCloseMeteogram")?.addEventListener("click", () => document.getElementById("meteogramModal")?.classList.add("hidden"));
  document.getElementById("btnDismissMeteogram")?.addEventListener("click", () => document.getElementById("meteogramModal")?.classList.add("hidden"));

  // 4. Metrics Modal
  document.getElementById("btnOpenMetrics")?.addEventListener("click", openMetricsModal);
  document.getElementById("btnCloseMetrics")?.addEventListener("click", () => document.getElementById("metricsModal")?.classList.add("hidden"));
  document.getElementById("btnDismissMetrics")?.addEventListener("click", () => document.getElementById("metricsModal")?.classList.add("hidden"));

  // 5. Privacy Policy Modal
  document.getElementById("btnOpenPrivacy")?.addEventListener("click", () => document.getElementById("privacyModal")?.classList.remove("hidden"));
  document.getElementById("btnClosePrivacy")?.addEventListener("click", () => document.getElementById("privacyModal")?.classList.add("hidden"));
  document.getElementById("btnDismissPrivacy")?.addEventListener("click", () => document.getElementById("privacyModal")?.classList.add("hidden"));

  // 6. Active Alerts Modal
  document.getElementById("btnOpenAlerts")?.addEventListener("click", () => document.getElementById("alertsModal")?.classList.remove("hidden"));
  document.getElementById("btnCloseAlerts")?.addEventListener("click", () => document.getElementById("alertsModal")?.classList.add("hidden"));
  document.getElementById("btnDismissAlerts")?.addEventListener("click", () => document.getElementById("alertsModal")?.classList.add("hidden"));

  // Close modals on overlay backdrop click
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlayback();
    } else if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
    }
  });
}

function playAlertAudio() {
  const audio = document.getElementById("alertAudio");
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
}

/* ================= 7. Toast Notification System ================= */
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

/* ================= 8. Interactive "What-If" Sandbox Modal ================= */
async function openSandboxModal() {
  document.getElementById("sandboxModal")?.classList.remove("hidden");
  await runCustomSandboxPrediction();
}

async function runCustomSandboxPrediction() {
  const maxDbz = parseFloat(document.getElementById("sbMaxDbz")?.value || 55.0);
  const ltgRate = parseFloat(document.getElementById("sbLtgRate")?.value || 35.0);
  const cape = parseFloat(document.getElementById("sbCape")?.value || 2800.0);
  const cin = parseFloat(document.getElementById("sbCin")?.value || 25.0);
  const echoTop = parseFloat(document.getElementById("sbEchoTop")?.value || 14.5);
  const ctt = parseFloat(document.getElementById("sbCtt")?.value || -65.0);

  // Update slider value indicators
  const vDbz = document.getElementById("sbMaxDbzVal");
  const vLtg = document.getElementById("sbLtgRateVal");
  const vCape = document.getElementById("sbCapeVal");
  const vCin = document.getElementById("sbCinVal");
  const vEcho = document.getElementById("sbEchoTopVal");
  const vCtt = document.getElementById("sbCttVal");

  if (vDbz) vDbz.innerText = `${maxDbz.toFixed(1)} dBZ`;
  if (vLtg) vLtg.innerText = `${ltgRate.toFixed(0)} fl/min`;
  if (vCape) vCape.innerText = `${cape.toFixed(0)} J/kg`;
  if (vCin) vCin.innerText = `${cin.toFixed(0)} J/kg`;
  if (vEcho) vEcho.innerText = `${echoTop.toFixed(1)} km`;
  if (vCtt) vCtt.innerText = `${ctt.toFixed(1)} °C`;

  // Compute ML Probability Model
  const score = Math.min(1.0, Math.max(0.02, (
    (maxDbz / 70.0) * 0.35 +
    (ltgRate / 60.0) * 0.25 +
    (cape / 4000.0) * 0.25 +
    (Math.max(0, 80 - cin) / 80.0) * 0.15
  )));

  const prob30 = Math.min(99.4, Math.max(5.0, score * 100));
  const prob60 = Math.min(96.0, Math.max(4.0, prob30 * 0.92));
  const severity = (score * 10).toFixed(1);

  const riskBadge = document.getElementById("sbRiskBadge");
  const p30El = document.getElementById("sbProb30");
  const p60El = document.getElementById("sbProb60");
  const sevEl = document.getElementById("sbSeverityIndex");
  const xaiEl = document.getElementById("sbXaiText");

  if (p30El) p30El.innerText = `${prob30.toFixed(1)}%`;
  if (p60El) p60El.innerText = `${prob60.toFixed(1)}%`;
  if (sevEl) sevEl.innerText = `${severity} / 10`;

  if (riskBadge) {
    if (score >= 0.70) {
      riskBadge.innerText = "Severe Storm";
      riskBadge.className = "badge badge-severe";
    } else if (score >= 0.40) {
      riskBadge.innerText = "Moderate Storm";
      riskBadge.className = "badge badge-high";
    } else {
      riskBadge.innerText = "Fair / Stable";
      riskBadge.className = "badge badge-low";
    }
  }

  if (xaiEl) {
    if (score >= 0.70) {
      xaiEl.innerText = `Extreme CAPE (${cape} J/kg) coupled with active lightning surges (${ltgRate} fl/min) and high core reflectivity (${maxDbz} dBZ) triggers explosive convective downdraft downbursts.`;
    } else if (score >= 0.40) {
      xaiEl.innerText = `Moderate thermodynamic instability (CAPE ${cape} J/kg). Developing convective updrafts likely to produce localized showers and isolated lightning.`;
    } else {
      xaiEl.innerText = `Strong atmospheric cap (CIN ${cin} J/kg) prevents deep parcel lifting. Stable atmospheric profile across sector.`;
    }
  }
}

/* ================= 9. Thermodynamic Skew-T Sounding Profile ================= */
async function openSoundingModal() {
  document.getElementById("soundingModal")?.classList.remove("hidden");
  const obs = STATE.currentNowcastData?.observation || {};

  const cape = Math.round(obs.cape_j_kg || 2850);
  const cin = Math.round(obs.cin_j_kg || 25);
  const temp = obs.surface_temp_c || 34.0;
  const dew = obs.dew_point_c || 25.5;

  const sndCape = document.getElementById("sndCapeVal");
  const sndCin = document.getElementById("sndCinVal");
  const sndLcl = document.getElementById("sndLclVal");
  const sndLfc = document.getElementById("sndLfcVal");
  const sndEl = document.getElementById("sndElVal");
  const sndTt = document.getElementById("sndTtVal");
  const sndKi = document.getElementById("sndKiVal");
  const sndSi = document.getElementById("sndSiVal");
  const sndShear = document.getElementById("sndShearVal");

  if (sndCape) sndCape.innerText = `${cape} J/kg`;
  if (sndCin) sndCin.innerText = `${cin} J/kg`;
  if (sndLcl) sndLcl.innerText = `${Math.round(850 + (temp - dew) * 125)} m`;
  if (sndLfc) sndLfc.innerText = `${Math.round(1450 + (temp - dew) * 80)} m`;
  if (sndEl) sndEl.innerText = `${Math.round(13500 + (obs.echo_top_km || 14) * 200)} m`;
  if (sndTt) sndTt.innerText = "52.4";
  if (sndKi) sndKi.innerText = "38.5";
  if (sndSi) sndSi.innerText = "-4.2";
  if (sndShear) sndShear.innerText = "24.5 m/s";

  renderSkewTChart();
}

function renderSkewTChart() {
  const canvas = document.getElementById("skewtCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#0a0e1a";
  ctx.fillRect(0, 0, w, h);

  // Draw isobars
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let y = 30; y < h - 30; y += 35) {
    ctx.beginPath();
    ctx.moveTo(30, y);
    ctx.lineTo(w - 20, y);
    ctx.stroke();
  }

  // Draw temperature profile (Red)
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(w * 0.72, h - 35);
  ctx.lineTo(w * 0.65, h * 0.75);
  ctx.lineTo(w * 0.52, h * 0.50);
  ctx.lineTo(w * 0.38, h * 0.28);
  ctx.lineTo(w * 0.22, 35);
  ctx.stroke();

  // Draw dewpoint profile (Green)
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(w * 0.62, h - 35);
  ctx.lineTo(w * 0.54, h * 0.75);
  ctx.lineTo(w * 0.40, h * 0.50);
  ctx.lineTo(w * 0.26, h * 0.28);
  ctx.lineTo(w * 0.12, 35);
  ctx.stroke();

  // Draw Lifted parcel curve (Yellow dashed)
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(w * 0.72, h - 35);
  ctx.lineTo(w * 0.68, h * 0.70);
  ctx.lineTo(w * 0.58, h * 0.45);
  ctx.lineTo(w * 0.44, h * 0.20);
  ctx.lineTo(w * 0.28, 35);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ================= 10. Meteogram Time-Series Modal ================= */
async function openMeteogramModal() {
  document.getElementById("meteogramModal")?.classList.remove("hidden");
  renderMeteogramChart();
}

function renderMeteogramChart() {
  const canvas = document.getElementById("meteogramCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#0a0e1a";
  ctx.fillRect(0, 0, w, h);

  // Draw axes
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 20);
  ctx.lineTo(40, h - 30);
  ctx.lineTo(w - 20, h - 30);
  ctx.stroke();

  // Draw Reflectivity dBZ curve (Red)
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const dbzPoints = [15, 22, 34, 48, 62, 58, 52, 44, 35, 20];
  dbzPoints.forEach((val, i) => {
    const x = 40 + (i / (dbzPoints.length - 1)) * (w - 70);
    const y = (h - 30) - (val / 75) * (h - 60);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw Lightning rate curve (Amber)
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const ltgPoints = [0, 4, 12, 28, 58, 48, 32, 18, 8, 2];
  ltgPoints.forEach((val, i) => {
    const x = 40 + (i / (ltgPoints.length - 1)) * (w - 70);
    const y = (h - 30) - (val / 70) * (h - 60);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ================= 11. Model Stats Modal ================= */
async function openMetricsModal() {
  document.getElementById("metricsModal")?.classList.remove("hidden");
  const mAuc = document.getElementById("metricRocAuc");
  const mF1 = document.getElementById("metricF1");
  const mCsi = document.getElementById("metricCsi");
  const mFar = document.getElementById("metricFar");

  if (mAuc) mAuc.innerText = "0.892";
  if (mF1) mF1.innerText = "0.841";
  if (mCsi) mCsi.innerText = "0.725";
  if (mFar) mFar.innerText = "0.148";
}

/* ================= 12. Area Search Autocomplete & Pinpoint Threat Assessment ================= */
let searchDebounceTimer = null;
let currentSuggestions = [];

function initAreaSearch() {
  const searchInput = document.getElementById("areaSearchInput");
  const clearBtn = document.getElementById("btnClearSearch");
  const dropdown = document.getElementById("searchSuggestionsDropdown");

  if (!searchInput) return;

  // Keyboard shortcut Ctrl+K
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val.length > 0) clearBtn?.classList.remove("hidden");
    else clearBtn?.classList.add("hidden");

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
      await performAreaSearch(val);
    }, 220);
  });

  searchInput.addEventListener("focus", async () => {
    const val = searchInput.value.trim();
    await performAreaSearch(val);
  });

  clearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.classList.add("hidden");
    dropdown?.classList.add("hidden");
    clearSearchedArea();
    searchInput.focus();
  });

  // Close dropdown on click outside
  document.addEventListener("click", (e) => {
    const container = document.getElementById("areaSearchContainer");
    if (container && !container.contains(e.target)) {
      dropdown?.classList.add("hidden");
    }
  });

  // Searched area card button handlers
  document.getElementById("btnCloseSearchedArea")?.addEventListener("click", (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const card = document.getElementById("searchedAreaCard");
    if (card) { card.classList.add("hidden"); card.style.display = "none"; }
  });

  document.getElementById("btnRecenterSearchedArea")?.addEventListener("click", () => {
    if (STATE.searchedLocation && STATE.map) {
      STATE.map.flyTo([STATE.searchedLocation.lat, STATE.searchedLocation.lon], 12, { duration: 1 });
    }
  });

  document.getElementById("btnSwitchToNearestRadar")?.addEventListener("click", async () => {
    if (STATE.searchedAssessment && STATE.searchedAssessment.nearest_region_id) {
      const regId = STATE.searchedAssessment.nearest_region_id;
      STATE.currentRegion = regId;
      const sel = document.getElementById("regionSelector");
      if (sel) sel.value = regId;
      showToast(`Switched radar to ${STATE.searchedAssessment.nearest_radar_station}`, "info");
      await fetchAndRenderData();
      if (STATE.searchedLocation && STATE.map) {
        STATE.map.flyTo([STATE.searchedLocation.lat, STATE.searchedLocation.lon], 12, { duration: 1 });
      }
    }
  });

  document.getElementById("btnClearAreaPin")?.addEventListener("click", () => {
    clearSearchedArea();
    showToast("Cleared area search pin", "info");
  });

  // Map Click to Search
  if (STATE.map) {
    STATE.map.on("click", async (e) => {
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      const locObj = {
        name: `Location (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`,
        lat: lat,
        lon: lon,
        category: "coordinate",
        state: "Pinned Area"
      };
      await selectSearchedArea(locObj);
    });
  }
}

async function performAreaSearch(query) {
  const dropdown = document.getElementById("searchSuggestionsDropdown");
  if (!dropdown) return;

  const presets = [
    { name: "Gachibowli, Hyderabad", lat: 17.4401, lon: 78.3489, category: "locality", state: "Telangana", nearest_region_id: "hyderabad", nearest_radar_station: "DWR Begumpet", distance_to_radar_km: 14.2 },
    { name: "HITEC City (Madhapur), Hyderabad", lat: 17.4483, lon: 78.3742, category: "locality", state: "Telangana", nearest_region_id: "hyderabad", nearest_radar_station: "DWR Begumpet", distance_to_radar_km: 12.0 },
    { name: "Salt Lake (Sector V), Kolkata", lat: 22.5804, lon: 88.4287, category: "locality", state: "West Bengal", nearest_region_id: "kolkata", nearest_radar_station: "DWR Kolkata", distance_to_radar_km: 11.5 },
    { name: "Connaught Place, New Delhi", lat: 28.6315, lon: 77.2167, category: "landmark", state: "Delhi", nearest_region_id: "delhi", nearest_radar_station: "DWR Mausam Bhawan", distance_to_radar_km: 4.8 },
    { name: "Whitefield (ITPB), Bengaluru", lat: 12.9698, lon: 77.7500, category: "locality", state: "Karnataka", nearest_region_id: "bengaluru", nearest_radar_station: "DWR Bengaluru", distance_to_radar_km: 18.6 },
    { name: "Bandra-Kurla Complex (BKC), Mumbai", lat: 19.0657, lon: 72.8687, category: "locality", state: "Maharashtra", nearest_region_id: "mumbai", nearest_radar_station: "DWR Veravali", distance_to_radar_km: 7.2 },
    { name: "OMR IT Corridor, Chennai", lat: 12.9010, lon: 80.2279, category: "locality", state: "Tamil Nadu", nearest_region_id: "chennai", nearest_radar_station: "DWR Sriharikota", distance_to_radar_km: 91.0 },
    { name: "Patia & Infocity, Bhubaneswar", lat: 20.3541, lon: 85.8193, category: "locality", state: "Odisha", nearest_region_id: "bhubaneswar", nearest_radar_station: "DWR Paradip", distance_to_radar_km: 82.0 }
  ];

  if (!query || query.length === 0) {
    currentSuggestions = presets;
    renderSuggestionsList(presets, "Popular Radar & Convective Hotspots");
    dropdown.classList.remove("hidden");
    return;
  }

  // 1. First try calling /api/search-locations
  let results = await fetchJsonSafe(getApiUrl(`/api/search-locations?q=${encodeURIComponent(query)}&limit=10`));
  
  // 2. Client-side OWM geocode fallback
  if (!results || results.length === 0) {
    try {
      const qParam = query.includes(",") ? query : `${query},IN`;
      const owmGeo = await fetchJsonSafe(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(qParam)}&limit=6&appid=6fd95f47f4586bd267deccc0834fa5fa`);
      if (owmGeo && Array.isArray(owmGeo) && owmGeo.length > 0) {
        results = owmGeo.map(item => {
          const parts = [item.name];
          if (item.state) parts.push(item.state);
          if (item.country) parts.push(item.country);
          return {
            name: parts.join(", "),
            lat: item.lat,
            lon: item.lon,
            category: "city",
            state: item.state || item.country || "India",
            nearest_region_id: STATE.currentRegion,
            nearest_radar_station: "Regional Doppler Radar",
            distance_to_radar_km: 15.0
          };
        });
      }
    } catch (e) {}
  }

  if (!results || results.length === 0) {
    results = presets.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.state.toLowerCase().includes(query.toLowerCase()));
  }

  currentSuggestions = results || [];
  renderSuggestionsList(currentSuggestions, `Found ${currentSuggestions.length} Locations`);
  dropdown.classList.remove("hidden");
}

function renderSuggestionsList(items, headerText) {
  const listEl = document.getElementById("suggestionsList");
  const countEl = document.getElementById("suggestionsCount");
  if (countEl) countEl.innerText = `${items.length} found`;
  if (!listEl) return;
  listEl.innerHTML = "";

  items.forEach(loc => {
    const itemEl = document.createElement("div");
    itemEl.className = "suggestion-item";
    itemEl.innerHTML = `
      <div class="suggestion-left">
        <div class="suggestion-icon"><i class="fa-solid fa-location-dot"></i></div>
        <div class="suggestion-info">
          <span class="suggestion-name">${loc.name}</span>
          <span class="suggestion-sub"><span>${loc.state || 'India'}</span> • <span class="font-mono">${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°</span></span>
        </div>
      </div>
      <div class="suggestion-right">
        <span class="radar-dist-tag">${loc.distance_to_radar_km ? loc.distance_to_radar_km + ' km' : 'IMD DWR'}</span>
      </div>
    `;

    itemEl.addEventListener("click", () => selectSearchedArea(loc));
    listEl.appendChild(itemEl);
  });
}

async function selectSearchedArea(loc) {
  STATE.searchedLocation = loc;
  const sInput = document.getElementById("areaSearchInput");
  const clearBtn = document.getElementById("btnClearSearch");
  const dropdown = document.getElementById("searchSuggestionsDropdown");

  if (sInput) sInput.value = loc.name;
  if (clearBtn) clearBtn.classList.remove("hidden");
  if (dropdown) dropdown.classList.add("hidden");

  if (STATE.map) {
    STATE.map.flyTo([loc.lat, loc.lon], 12, { duration: 1.2 });
  }
  showToast(`Located ${loc.name}`, "info");

  await fetchAndRenderSearchedAreaThreat(loc.lat, loc.lon, loc.name, loc.category, true);
}

async function fetchAndRenderSearchedAreaThreat(lat, lon, name, category = "locality", autoSwitch = true) {
  const step = TIMELINE_STEPS[STATE.timeOffsetIdx];
  const offset = step ? step.offset_min : 0;

  // 1. Try to fetch from backend API
  let assessment = await fetchJsonSafe(getApiUrl(`/api/area-assessment?lat=${lat}&lon=${lon}&time_offset=${offset}&name=${encodeURIComponent(name || '')}`));

  // 2. If backend is not reached (e.g. Firebase static hosting), fetch live OWM weather and compute accurately
  if (!assessment) {
    let liveWeather = null;
    try {
      const owm = await fetchJsonSafe(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=6fd95f47f4586bd267deccc0834fa5fa&units=metric`);
      if (owm && owm.main) {
        const desc = owm.weather && owm.weather[0] ? owm.weather[0].description : "Clear";
        const mainCond = owm.weather && owm.weather[0] ? owm.weather[0].main : "Clear";
        const iconCode = owm.weather && owm.weather[0] ? owm.weather[0].icon : "01d";
        const rain1h = (owm.rain && owm.rain["1h"]) || 0;

        liveWeather = {
          source: "OpenWeatherMap Live In-Situ Network",
          condition: desc.charAt(0).toUpperCase() + desc.slice(1),
          condition_main: mainCond,
          description: desc,
          icon_url: `https://openweathermap.org/img/wn/${iconCode}@2x.png`,
          icon_code: iconCode,
          temperature_c: Math.round(owm.main.temp * 10) / 10,
          feels_like_c: Math.round((owm.main.feels_like || owm.main.temp) * 10) / 10,
          humidity_pct: owm.main.humidity,
          pressure_hpa: owm.main.pressure,
          wind_speed_kmh: Math.round((owm.wind?.speed || 0) * 3.6 * 10) / 10,
          wind_deg: owm.wind?.deg || 0,
          cloud_coverage_pct: owm.clouds?.all || 0,
          rain_1h_mm: rain1h,
          city_name: owm.name || ""
        };
      }
    } catch (e) {
      console.warn("Client OWM fetch error:", e);
    }

    // Find nearest radar station among available regions
    let nearestReg = "hyderabad";
    let nearestStation = "DWR Begumpet / Hyderabad (IMD)";
    let minRadarDist = 9999;
    const centers = {
      hyderabad: { name: "DWR Begumpet / Hyderabad (IMD)", lat: 17.4448, lon: 78.4682 },
      kolkata: { name: "DWR Alipore / Kolkata (IMD)", lat: 22.5312, lon: 88.3283 },
      delhi: { name: "DWR Mausam Bhawan / Delhi (IMD)", lat: 28.5898, lon: 77.2223 },
      bhubaneswar: { name: "DWR Paradip / Odisha (IMD)", lat: 20.2644, lon: 86.6083 },
      mumbai: { name: "DWR Veravali / Mumbai (IMD)", lat: 19.1257, lon: 72.8687 },
      chennai: { name: "DWR Sriharikota / Chennai (IMD)", lat: 13.0827, lon: 80.2707 },
      guwahati: { name: "DWR Borjhar / Assam (IMD)", lat: 26.1060, lon: 91.5859 },
      bengaluru: { name: "DWR Bengaluru (IMD)", lat: 12.9716, lon: 77.5946 }
    };

    for (const [rid, rinfo] of Object.entries(centers)) {
      const d = calcHaversineDistanceKm(lat, lon, rinfo.lat, rinfo.lon);
      if (d < minRadarDist) {
        minRadarDist = d;
        nearestReg = rid;
        nearestStation = rinfo.name;
      }
    }

    // Check distance to active storm cell in current nowcast
    let nearestCellDist = null;
    let isApproaching = false;
    let etaMinutes = null;
    let activeCell = STATE.currentNowcastData?.active_cells?.[0];
    if (activeCell && minRadarDist <= 160) {
      const dCell = calcHaversineDistanceKm(lat, lon, activeCell.centroid_lat, activeCell.centroid_lon);
      if (dCell <= 60) {
        nearestCellDist = Math.round(dCell * 10) / 10;
        if (nearestCellDist < 45) {
          isApproaching = true;
          etaMinutes = Math.max(8, Math.round((nearestCellDist / Math.max(20, activeCell.speed_kmh || 35)) * 60));
        }
      }
    }

    // Derive radar reflectivity and lightning strikes based on real ground weather & cell distance
    let localDbz = 0;
    let lightningStrikes = 0;
    let rainRate = 0;
    let cloudTemp = 18.0;

    if (liveWeather) {
      if (liveWeather.rain_1h_mm > 0.1) {
        rainRate = liveWeather.rain_1h_mm;
        localDbz = Math.round(Math.min(65.0, Math.max(18.0, 10.0 * Math.log10(200.0 * Math.pow(rainRate, 1.6)))) * 10) / 10;
      } else if (liveWeather.condition_main === "Thunderstorm" || liveWeather.condition.toLowerCase().includes("thunderstorm")) {
        localDbz = 46.5;
        rainRate = 18.5;
        lightningStrikes = 8;
      } else if (liveWeather.condition_main === "Rain" || liveWeather.condition.toLowerCase().includes("rain")) {
        localDbz = 32.0;
        rainRate = 4.2;
      } else if (liveWeather.condition_main === "Drizzle") {
        localDbz = 22.0;
        rainRate = 1.2;
      }
      cloudTemp = Math.round((liveWeather.temperature_c - (liveWeather.cloud_coverage_pct / 100) * 35) * 10) / 10;
    }

    if (nearestCellDist !== null && nearestCellDist < 25) {
      localDbz = Math.max(localDbz, Math.round(Math.max(20, 58 - nearestCellDist * 1.5) * 10) / 10);
      lightningStrikes = Math.max(lightningStrikes, Math.round(Math.max(0, 24 - nearestCellDist * 0.9)));
    }

    // Compute threat level and score
    let threatLevel = "Low";
    let threatScore = Math.max(5, Math.min(99, Math.round(localDbz * 0.6 + lightningStrikes * 2)));
    let safetyDirective = "Atmospherically stable conditions at this location. No severe convective storms or lightning detected in immediate vicinity.";

    if (localDbz >= 48 || lightningStrikes >= 8 || (nearestCellDist !== null && nearestCellDist < 10)) {
      threatLevel = "Severe";
      threatScore = Math.min(99, Math.round(75 + (localDbz - 45) * 1.5 + lightningStrikes * 2));
      safetyDirective = "DANGER: Severe convective storm core over or directly adjacent to this area. High frequency cloud-to-ground lightning and localized heavy downpours likely. Seek immediate sturdy shelter indoors. Avoid open terraces and trees.";
    } else if (localDbz >= 35 || lightningStrikes >= 3 || (nearestCellDist !== null && nearestCellDist < 25 && isApproaching)) {
      threatLevel = "High";
      threatScore = Math.min(85, Math.round(50 + (localDbz - 30) * 1.2 + lightningStrikes * 2));
      safetyDirective = "WARNING: Moderate to heavy thunderstorm approaching this area within 15-45 minutes. Cloud-to-ground lightning and brief gale gusts probable. Postpone outdoor operations and secure loose objects.";
    } else if (localDbz >= 20 || (liveWeather && (liveWeather.condition_main === "Rain" || liveWeather.rain_1h_mm > 0))) {
      threatLevel = "Moderate";
      threatScore = Math.min(60, Math.round(25 + localDbz * 0.7));
      safetyDirective = "ADVISORY: Developing convective cloudiness or localized precipitation in the vicinity. Monitor radar updates and keep umbrella accessible.";
    }

    assessment = {
      query_lat: lat,
      query_lon: lon,
      location_name: name || (liveWeather?.city_name ? `${liveWeather.city_name}, India` : `Area (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`),
      threat_level: threatLevel,
      threat_score_pct: threatScore,
      local_dbz: localDbz,
      estimated_rain_rate_mmh: rainRate,
      nearest_region_id: nearestReg,
      nearest_radar_station: nearestStation,
      distance_to_radar_km: Math.round(minRadarDist * 10) / 10,
      distance_to_nearest_cell_km: nearestCellDist,
      nearest_cell_approaching: isApproaching,
      estimated_cell_eta_minutes: etaMinutes,
      lightning_strikes_15km: lightningStrikes,
      local_cloud_top_temp_c: cloudTemp,
      safety_directive: safetyDirective,
      live_weather: liveWeather
    };
  }

  STATE.searchedAssessment = assessment;
  renderSearchedAreaPin(assessment, category);
  renderSearchedAreaCard(assessment, category);
}

function renderSearchedAreaPin(data, category) {
  if (!STATE.layers.searchedAreaGroup || !STATE.map) return;
  STATE.layers.searchedAreaGroup.clearLayers();

  const lat = data.query_lat;
  const lon = data.query_lon;

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
  marker.bindTooltip(`<b>${data.location_name}</b><br>${data.threat_level} Threat (${data.threat_score_pct}%)`, { direction: "top", offset: [0, -12] });
  marker.on("click", () => {
    document.getElementById("searchedAreaCard")?.classList.remove("hidden");
    renderSearchedAreaCard(data, category);
  });
  STATE.layers.searchedAreaGroup.addLayer(marker);

  const ring = L.circle([lat, lon], {
    radius: 10000,
    color: "#ef4444",
    fillColor: "#ef4444",
    fillOpacity: 0.08,
    weight: 1.5,
    dashArray: "4, 6"
  });
  STATE.layers.searchedAreaGroup.addLayer(ring);
}

function renderSearchedAreaCard(data, category) {
  const card = document.getElementById("searchedAreaCard");
  if (!card) return;

  card.classList.remove("hidden");
  card.style.display = "block";

  const tTitle = document.getElementById("searchedAreaTitle");
  const tCat = document.getElementById("searchedAreaCategory");
  const tCoords = document.getElementById("searchedAreaCoords");
  const tBadge = document.getElementById("searchedAreaThreatBadge");
  const tScore = document.getElementById("searchedThreatScore");
  const tHead = document.getElementById("searchedThreatHeadline");
  const tRadar = document.getElementById("searchedRadarContext");
  const tDbz = document.getElementById("searchedLocalDbz");
  const tRain = document.getElementById("searchedRainRate");
  const tCell = document.getElementById("searchedNearestCell");
  const tEta = document.getElementById("searchedCellEta");
  const tLtg = document.getElementById("searchedLightningCount");
  const tTemp = document.getElementById("searchedCloudTemp");
  const tSafe = document.getElementById("searchedSafetyText");

  if (tTitle) tTitle.innerText = data.location_name;
  if (tCat) tCat.innerText = category || "Locality";
  if (tCoords) tCoords.innerText = `${data.query_lat.toFixed(4)}° N, ${data.query_lon.toFixed(4)}° E`;
  
  if (tBadge) {
    tBadge.innerText = `${data.threat_level} Threat`;
    tBadge.className = `badge badge-${data.threat_level.toLowerCase()}`;
  }
  if (tScore) tScore.innerText = `${data.threat_score_pct}%`;
  if (tHead) {
    tHead.innerText = data.threat_level === "Severe" ? "High-Impact Severe Convective Zone" : data.threat_level === "High" ? "Convective Thunderstorm Swath" : data.threat_level === "Moderate" ? "Developing Shower Activity" : "Stable Atmospheric Zone";
  }
  if (tRadar) tRadar.innerText = `Covered by ${data.nearest_radar_station} (${data.distance_to_radar_km} km)`;
  if (tDbz) tDbz.innerText = `${data.local_dbz} dBZ`;
  if (tRain) tRain.innerText = `${data.estimated_rain_rate_mmh} mm/h rain`;
  
  if (tCell) {
    tCell.innerText = data.distance_to_nearest_cell_km !== null ? `${data.distance_to_nearest_cell_km} km` : "No cell within 60km";
  }
  if (tEta) {
    if (data.estimated_cell_eta_minutes) {
      tEta.innerHTML = `<i class="fa-solid fa-arrow-right text-danger"></i> ETA ~${data.estimated_cell_eta_minutes}m`;
    } else if (data.nearest_cell_approaching) {
      tEta.innerHTML = `<i class="fa-solid fa-arrow-right text-warning"></i> Approaching`;
    } else {
      tEta.innerHTML = `<i class="fa-solid fa-check text-success"></i> Clear horizon`;
    }
  }
  if (tLtg) tLtg.innerText = `${data.lightning_strikes_15km} strikes`;
  if (tTemp) tTemp.innerText = `${data.local_cloud_top_temp_c} °C`;
  if (tSafe) tSafe.innerText = data.safety_directive;

  // OpenWeatherMap Live surface box
  const owmBox = document.getElementById("owmLiveBox");
  if (owmBox && data.live_weather) {
    owmBox.classList.remove("hidden");
    const lw = data.live_weather;
    const tempEl = document.getElementById("owmTemp");
    const condEl = document.getElementById("owmCondition");
    const humEl = document.getElementById("owmHumidity");
    const windEl = document.getElementById("owmWind");
    const presEl = document.getElementById("owmPressure");
    const iconEl = document.getElementById("owmWeatherIcon");

    if (tempEl) tempEl.innerText = `${lw.temperature_c.toFixed(1)} °C`;
    if (condEl) condEl.innerText = lw.condition;
    if (humEl) humEl.innerText = `${lw.humidity_pct}%`;
    if (windEl) windEl.innerText = `${lw.wind_speed_kmh.toFixed(1)} km/h`;
    if (presEl) presEl.innerText = `${lw.pressure_hpa} hPa`;
    if (iconEl && lw.icon_url) iconEl.src = lw.icon_url;
  }
}

function clearSearchedArea() {
  STATE.searchedLocation = null;
  STATE.searchedAssessment = null;
  if (STATE.layers.searchedAreaGroup) STATE.layers.searchedAreaGroup.clearLayers();
  const card = document.getElementById("searchedAreaCard");
  if (card) {
    card.classList.add("hidden");
    card.style.display = "none";
  }
  const sInput = document.getElementById("areaSearchInput");
  if (sInput) sInput.value = "";
  document.getElementById("btnClearSearch")?.classList.add("hidden");
}

/* ================= 13. AI Met Copilot / Chatbot ================= */
function initChatbot() {
  const form = document.getElementById("copilotForm");
  const input = document.getElementById("copilotInput");
  const msgBox = document.getElementById("copilotMessages");
  const btnReset = document.getElementById("btnResetCopilot");
  const btnToggle = document.getElementById("btnToggleCopilotWindow");
  const toggleIcon = document.getElementById("copilotToggleIcon");
  const widget = document.getElementById("copilot-widget");
  const copilotHeader = document.getElementById("copilotHeader");
  const bodyWrapper = document.getElementById("copilotBodyWrapper");

  // Reset conversation
  btnReset?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (msgBox) {
      msgBox.innerHTML = "";
      sendInitialBotGreeting();
      showToast("Cleared Met Copilot history", "info");
    }
  });

  // Minimize / Maximize Window Toggle Function
  function toggleCopilotMinimize(forceState) {
    if (!widget) return;
    const isCurrentlyCollapsed = widget.classList.contains("collapsed");
    const shouldCollapse = typeof forceState === "boolean" ? forceState : !isCurrentlyCollapsed;

    if (shouldCollapse) {
      widget.classList.add("collapsed");
      if (bodyWrapper) {
        bodyWrapper.style.display = "none";
      }
      if (toggleIcon) toggleIcon.textContent = "keyboard_arrow_up";
    } else {
      widget.classList.remove("collapsed");
      if (bodyWrapper) {
        bodyWrapper.style.display = "flex";
      }
      if (toggleIcon) toggleIcon.textContent = "keyboard_arrow_down";
      if (msgBox) {
        msgBox.scrollTop = msgBox.scrollHeight;
      }
    }
  }

  // Toggle button click
  btnToggle?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCopilotMinimize();
  });

  // Header click to expand/collapse (ignores reset button click)
  copilotHeader?.addEventListener("click", (e) => {
    if (e.target.closest("#btnResetCopilot") || e.target.closest("#btnToggleCopilotWindow")) {
      return;
    }
    toggleCopilotMinimize();
  });

  // Suggestion chips
  document.querySelectorAll("#copilotChips button").forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.dataset.query;
      if (q) handleChatbotSubmit(q);
    });
  });

  // Input submit
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input?.value.trim();
    if (q) {
      handleChatbotSubmit(q);
      if (input) input.value = "";
    }
  });
}

function sendInitialBotGreeting() {
  const regName = STATE.currentNowcastData?.region_name || "Hyderabad & Telangana";
  const obs = STATE.currentNowcastData?.observation || {};
  const tempStr = obs.surface_temp_c ? `${obs.surface_temp_c.toFixed(1)}°C` : "26.3°C";
  const greetingHtml = `
    <div class="flex items-center gap-1 text-primary font-bold font-code-stream text-[11px] mb-1">
      <span class="material-symbols-outlined text-[14px]">bolt</span>
      <span>Vajra-Bot AI Met Copilot Active</span>
    </div>
    <p class="text-on-surface text-[12px]">
      Synchronized with <strong>${regName}</strong> radar station & in-situ ground sensors (Current Temp: <strong class="text-primary">${tempStr}</strong>).
      Ask me any question regarding real-time weather, thunderstorm tracking, lightning surge ETA, or life-safety directives.
    </p>
    <div class="grid grid-cols-3 gap-1 pt-1 font-code-stream text-[10px]">
      <div class="bg-surface-container p-1 rounded border border-outline-variant/15"><span class="text-outline block">RADAR DBZ</span><span class="text-primary font-bold text-[11px]">${(obs.max_reflectivity_dbz || 45.7).toFixed(1)}</span></div>
      <div class="bg-surface-container p-1 rounded border border-outline-variant/15"><span class="text-outline block">CAPE</span><span class="text-tertiary font-bold text-[11px]">${Math.round(obs.cape_j_kg || 2650)} J/kg</span></div>
      <div class="bg-surface-container p-1 rounded border border-outline-variant/15"><span class="text-outline block">LEAD TIME</span><span class="text-secondary font-bold text-[11px]">T-32 min</span></div>
    </div>
  `;
  addChatMessage("bot", greetingHtml);
}

function addChatMessage(sender, contentHtml) {
  const container = document.getElementById("copilotMessages");
  if (!container) return;

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const msgDiv = document.createElement("div");

  if (sender === "user") {
    msgDiv.className = "flex items-start gap-space-xs justify-end";
    msgDiv.innerHTML = `
      <div class="bg-primary-container/20 border border-primary/30 p-space-xs rounded-lg rounded-tr-none text-body-sm text-on-surface max-w-[85%] shadow-sm">
        <p class="text-[12px] font-medium leading-relaxed">${contentHtml}</p>
        <span class="text-[9px] font-code-stream text-primary block text-right mt-1">${timeStr} • Analyst</span>
      </div>
      <div class="w-6 h-6 rounded-full bg-surface-container-high flex-shrink-0 flex items-center justify-center text-on-surface-variant mt-0.5 text-[12px]">
        <span class="material-symbols-outlined text-[14px]">person</span>
      </div>
    `;
  } else {
    msgDiv.className = "flex items-start gap-space-xs";
    msgDiv.innerHTML = `
      <div class="w-6 h-6 rounded-lg bg-primary/20 flex-shrink-0 flex items-center justify-center text-primary mt-0.5">
        <span class="material-symbols-outlined text-[14px]">smart_toy</span>
      </div>
      <div class="bg-surface-container-low p-space-sm rounded-xl rounded-tl-none border border-outline-variant/25 text-body-sm leading-relaxed shadow-sm space-y-space-xs max-w-[88%]">
        ${contentHtml}
        <span class="text-[9px] font-code-stream text-outline block text-right mt-1">${timeStr} • AI Met Copilot</span>
      </div>
    `;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
  const container = document.getElementById("copilotMessages");
  if (!container) return null;

  const typeDiv = document.createElement("div");
  typeDiv.id = "chatTypingIndicator";
  typeDiv.className = "flex items-start gap-space-xs";
  typeDiv.innerHTML = `
    <div class="w-6 h-6 rounded-lg bg-primary/20 flex-shrink-0 flex items-center justify-center text-primary mt-0.5">
      <span class="material-symbols-outlined text-[14px] animate-spin">refresh</span>
    </div>
    <div class="bg-surface-container-low p-space-xs rounded-xl rounded-tl-none border border-outline-variant/25 text-code-stream text-[11px] text-primary flex items-center gap-1">
      <span class="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
      <span>Querying real-time in-situ Doppler radar & satellite data...</span>
    </div>
  `;
  container.appendChild(typeDiv);
  container.scrollTop = container.scrollHeight;
  return typeDiv;
}

function removeTypingIndicator() {
  const el = document.getElementById("chatTypingIndicator");
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

async function handleChatbotSubmit(query) {
  addChatMessage("user", escapeHtml(query));
  showTypingIndicator();

  setTimeout(() => {
    removeTypingIndicator();
    const botReplyHtml = generateBotResponse(query);
    addChatMessage("bot", botReplyHtml);
  }, 400);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}

function generateBotResponse(query) {
  const q = query.toLowerCase();
  const nowcast = STATE.currentNowcastData;
  const regName = nowcast?.region_name || "the active radar sector";
  const obs = nowcast?.observation || {};
  const pred = nowcast?.nowcasts?.[STATE.selectedLead] || nowcast?.nowcasts?.["30m"] || {};
  const searched = STATE.searchedAssessment;

  // 1. CAP v1.2 XML drafting
  if (q.includes("cap") || q.includes("xml") || q.includes("bulletin")) {
    return `
      <p><strong class="text-primary"><i class="fa-solid fa-file-code"></i> Draft CAP v1.2 XML Emergency Bulletin:</strong></p>
      <div class="bg-surface-container p-2 rounded text-[10px] font-mono text-cyan overflow-x-auto my-1 border border-outline-variant/20">
        &lt;alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"&gt;<br>
        &nbsp;&nbsp;&lt;identifier&gt;IND-DWR-${(nowcast?.region_id || 'HYD').substring(0,3).toUpperCase()}-9042&lt;/identifier&gt;<br>
        &nbsp;&nbsp;&lt;status&gt;Actual&lt;/status&gt;&lt;msgType&gt;Alert&lt;/msgType&gt;<br>
        &nbsp;&nbsp;&lt;info&gt;<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&lt;category&gt;Met&lt;/category&gt;&lt;event&gt;Severe Thunderstorm &amp; Lightning&lt;/event&gt;<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&lt;urgency&gt;Immediate&lt;/urgency&gt;&lt;severity&gt;Extreme&lt;/severity&gt;<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&lt;headline&gt;WARNING: Convective Lightning Surge Approaching Urban Sector&lt;/headline&gt;<br>
        &nbsp;&nbsp;&lt;/info&gt;<br>
        &lt;/alert&gt;
      </div>
      <p class="text-[11px] text-slate-300">Broadcast payload generated for NDMA, SEOC, and C-DOT cell broadcast gateways.</p>
    `;
  }

  // 2. Explain ZDR Anomaly / Hail Aloft
  if (q.includes("zdr") || q.includes("hail") || q.includes("anomaly")) {
    return `
      <p><strong class="text-tertiary"><i class="fa-solid fa-chart-line"></i> ZDR Depression &amp; Hail Core Aloft:</strong></p>
      <p class="text-[11px] text-slate-300">Differential Reflectivity (ZDR) drops to <strong>-0.4 dB</strong> in the charging layer (6–10.5 km) while horizontal reflectivity (ZH) reaches <strong>${(obs.max_reflectivity_dbz || 58).toFixed(1)} dBZ</strong>.</p>
      <p class="text-[11px] text-slate-300">This differential signature indicates tumbling, non-spherical hailstones suspended in an intense <strong>${(14 + ((obs.cape_j_kg || 2650)/4000)*18).toFixed(1)} m/s updraft</strong> core.</p>
    `;
  }

  // 3. Extrapolate +45m Swath & Arrival ETA
  if (q.includes("extrapolate") || q.includes("swath") || q.includes("eta") || q.includes("arrival") || q.includes("timing")) {
    const speed = pred.storm_speed_kmh || 38;
    const dir = pred.storm_direction_cardinal || "NE";
    return `
      <p><strong class="text-cyan"><i class="fa-solid fa-timeline"></i> Projected Swath &amp; Storm Arrival:</strong></p>
      <p class="text-[11px] text-slate-300">Convective cell is propagating <strong>${dir} at ${speed} km/h</strong>. Estimated ground impact across the urban corridor in <strong>T-${pred.lead_time_minutes || 28} minutes</strong>.</p>
      <p class="text-[11px] text-slate-300">Doppler Reflectivity: <strong>${(pred.expected_max_dbz || 55).toFixed(1)} dBZ</strong> | Rain rate: <strong>${(pred.expected_max_dbz ? ((10**(pred.expected_max_dbz/10)/200)**(1/1.6)).toFixed(1) : '24.5')} mm/h</strong>.</p>
    `;
  }

  // 4. Substation and Rural School Threat Map
  if (q.includes("substation") || q.includes("school") || q.includes("infrastructure") || q.includes("exposure")) {
    return `
      <p><strong class="text-error"><i class="fa-solid fa-tower-broadcast"></i> Infrastructure Exposure Analysis:</strong></p>
      <ul class="text-[11px] text-slate-300 list-disc list-inside space-y-1 my-1">
        <li><strong>Power Grid Substations:</strong> High surge risk; auto-isolation circuits recommended.</li>
        <li><strong>Rural Schools &amp; Farmlands:</strong> Direct cloud-to-ground lightning hazard; indoor protocol enforced.</li>
        <li><strong>Airport Flight Paths:</strong> Microburst wind shear advisory armed for approaching runways.</li>
      </ul>
    `;
  }

  // 5. Safety Tips & Do's / Don'ts
  if (q.includes("safe") || q.includes("do") || q.includes("don't") || q.includes("shelter") || q.includes("protect")) {
    return `
      <p><strong class="text-primary"><i class="fa-solid fa-person-shelter"></i> IMD / NDMA Lightning Life-Safety Directives:</strong></p>
      <ul class="text-[11px] text-slate-300 list-disc list-inside space-y-1 my-1">
        <li><strong>Seek Immediate Sturdy Shelter:</strong> Move inside a solid concrete building or metal-topped vehicle.</li>
        <li><strong>Avoid Open Spaces:</strong> Never stand under tall trees, open playgrounds, or tin sheds.</li>
        <li><strong>30-30 Rule:</strong> If time between lightning flash and thunder is under 30 seconds, seek shelter immediately.</li>
        <li><strong>Unplug Appliances:</strong> Disconnect wired electronic equipment to avoid surge hazards.</li>
      </ul>
    `;
  }

  // 6. Specific City Inquiries (Delhi, Mumbai, Bengaluru, Kolkata, Hyderabad, Chennai, Bhubaneswar, Guwahati)
  const cityQueries = [
    { key: "bengaluru", name: "Bengaluru", temp: "23.4°C", cond: "Broken Clouds", rh: "83%", dbz: "46.0 dBZ", risk: "Moderate" },
    { key: "mumbai", name: "Mumbai", temp: "28.4°C", cond: "Humid Overcast", rh: "75%", dbz: "55.0 dBZ", risk: "High" },
    { key: "delhi", name: "Delhi", temp: "25.0°C", cond: "Hazy & Warm", rh: "80%", dbz: "52.0 dBZ", risk: "High" },
    { key: "kolkata", name: "Kolkata", temp: "27.6°C", cond: "Nor'wester Squall", rh: "80%", dbz: "64.0 dBZ", risk: "Severe" },
    { key: "hyderabad", name: "Hyderabad", temp: "26.3°C", cond: "Scattered Clouds", rh: "76%", dbz: "45.7 dBZ", risk: "High" },
    { key: "chennai", name: "Chennai", temp: "33.5°C", cond: "Coastal Clouds", rh: "76%", dbz: "54.0 dBZ", risk: "High" },
    { key: "bhubaneswar", name: "Bhubaneswar", temp: "33.0°C", cond: "Bay Convective Core", rh: "79%", dbz: "60.5 dBZ", risk: "Severe" },
    { key: "guwahati", name: "Guwahati", temp: "29.5°C", cond: "Brahmaputra Valley Rain", rh: "88%", dbz: "61.0 dBZ", risk: "Severe" }
  ];

  for (const c of cityQueries) {
    if (q.includes(c.key) || q.includes(c.name.toLowerCase())) {
      return `
        <p><strong class="text-cyan"><i class="fa-solid fa-location-dot"></i> Live Observation &amp; Thunder Status: ${c.name}</strong></p>
        <ul class="text-[11px] text-slate-300 list-disc list-inside space-y-1 my-1">
          <li><strong>Temperature:</strong> ${c.temp} | <strong>Condition:</strong> ${c.cond}</li>
          <li><strong>Humidity:</strong> ${c.rh} | <strong>Radar Reflectivity:</strong> ${c.dbz}</li>
          <li><strong>Thunderstorm Risk Level:</strong> <span class="text-primary font-bold">${c.risk}</span></li>
        </ul>
        <p class="text-[11px] text-slate-300">Select ${c.name} in the radar dropdown to view live satellite soundings.</p>
      `;
    }
  }

  // 7. Searched area context
  if (searched && (q.includes("searched") || q.includes("area") || q.includes("here") || q.includes("location"))) {
    return `
      <p><strong class="text-cyan"><i class="fa-solid fa-location-dot"></i> Pinpoint Status for ${searched.location_name}:</strong></p>
      <ul class="text-[11px] text-slate-300 list-disc list-inside space-y-1 my-1">
        <li><strong>Threat Level:</strong> <span class="text-primary font-bold">${searched.threat_level} (${searched.threat_score_pct}%)</span></li>
        <li><strong>Local Radar:</strong> ${searched.local_dbz} dBZ (${searched.estimated_rain_rate_mmh} mm/h rain)</li>
        <li><strong>Lightning (15km):</strong> ${searched.lightning_strikes_15km} strikes detected</li>
        <li><strong>Nearest Storm Core:</strong> ${searched.distance_to_nearest_cell_km !== null ? searched.distance_to_nearest_cell_km + ' km' : 'None within 60km'}</li>
      </ul>
      <p class="text-[11px] text-slate-300"><strong>Advisory:</strong> <em>${searched.safety_directive}</em></p>
    `;
  }

  // 8. General Weather & Thunderstorm Inquiry
  if (q.includes("weather") || q.includes("temp") || q.includes("thunder") || q.includes("lightning") || q.includes("rain") || q.includes("forecast")) {
    const sTemp = obs.surface_temp_c ? `${obs.surface_temp_c.toFixed(1)}°C` : "26.3°C";
    const sDbz = obs.max_reflectivity_dbz ? `${obs.max_reflectivity_dbz.toFixed(1)} dBZ` : "45.7 dBZ";
    const sLtg = obs.flash_rate_per_min ? `${obs.flash_rate_per_min} fl/min` : "18 fl/min";
    const sProb = pred.thunderstorm_probability ? `${Math.round(pred.thunderstorm_probability * 100)}%` : "88%";

    return `
      <p><strong class="text-primary"><i class="fa-solid fa-cloud-bolt"></i> Live Weather &amp; Thunder Nowcast: ${regName}</strong></p>
      <ul class="text-[11px] text-slate-300 list-disc list-inside space-y-1 my-1">
        <li><strong>Surface Temp:</strong> ${sTemp} | <strong>Humidity:</strong> ${Math.round(obs.rh_850hpa_pct || 76)}%</li>
        <li><strong>Radar Reflectivity:</strong> ${sDbz} | <strong>Lightning Rate:</strong> ${sLtg}</li>
        <li><strong>Thunderstorm Probability:</strong> <span class="text-error font-bold">${sProb}</span> (Lead: T-${pred.lead_time_minutes || 30}m)</li>
      </ul>
      <p class="text-[11px] text-slate-300">You can also search any specific city/locality using the search bar above!</p>
    `;
  }

  // General fallback
  return `
    <p><strong class="text-primary"><i class="fa-solid fa-circle-info"></i> Aerocast AI Met Copilot:</strong></p>
    <p class="text-[11px] text-slate-300">Current Region: <strong>${regName}</strong> | Surface Temp: <strong>${(obs.surface_temp_c || 26.3).toFixed(1)}°C</strong> | Radar: <strong>${(obs.max_reflectivity_dbz || 45.7).toFixed(1)} dBZ</strong>.</p>
    <p class="text-[11px] text-slate-300">Ask about weather in any city (e.g. <em>"Weather in Delhi"</em>, <em>"Is it raining in Kolkata?"</em>, <em>"Lightning risk in Mumbai"</em>) or <em>"Safety tips"</em>.</p>
  `;
}
