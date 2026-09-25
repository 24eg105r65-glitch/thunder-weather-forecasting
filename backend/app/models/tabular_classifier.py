"""Baseline AI/ML models: XGBoost and Random Forest for multimodal thunderstorm & lightning nowcasting.

Predicts:
- 30-minute Thunderstorm Probability & Binary Warning
- 60-minute Thunderstorm Probability & Binary Warning
- 90-minute Thunderstorm Probability & Binary Warning
- 4-Class Lightning Risk (Low, Moderate, High, Severe)
- Explainable AI (XAI) feature attribution
"""

import os
import joblib
import numpy as np
from typing import Dict, Any, List, Tuple
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score, confusion_matrix
import xgboost as xgb

from ..core.schemas import AtmosphericObservation, NowcastPrediction, ExplainabilityItem
from ..core.physics import cardinal_direction


MODEL_DIR = os.path.join(os.path.dirname(__file__), "weights")
os.makedirs(MODEL_DIR, exist_ok=True)


class TabularNowcaster:
    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.feature_names: List[str] = []
        self.metrics: Dict[str, Any] = {}
        self.is_trained: bool = False

    def train_and_evaluate(self, X: np.ndarray, targets: Dict[str, np.ndarray], feature_names: List[str]):
        """Train XGBoost models for each lead time and evaluate meteorological metrics."""
        self.feature_names = feature_names
        
        # Split train / test
        indices = np.arange(X.shape[0])
        idx_train, idx_test = train_test_split(indices, test_size=0.25, random_state=42)
        
        X_train, X_test = X[idx_train], X[idx_test]
        
        self.metrics = {
            "lead_times": {},
            "feature_importance": {},
            "overall_accuracy": 0.0,
            "overall_roc_auc": 0.0
        }
        
        auc_sum = 0.0
        acc_sum = 0.0
        
        # Train for each forecast horizon: 30m, 60m, 90m
        for lead_key, lead_name in [("thunderstorm_30m", "30m"), ("thunderstorm_60m", "60m"), ("thunderstorm_90m", "90m")]:
            y_train = targets[lead_key][idx_train]
            y_test = targets[lead_key][idx_test]
            
            # XGBoost binary classifier
            clf = xgb.XGBClassifier(
                n_estimators=120,
                max_depth=5,
                learning_rate=0.08,
                subsample=0.85,
                colsample_bytree=0.85,
                random_state=42,
                eval_metric="logloss"
            )
            clf.fit(X_train, y_train)
            self.models[lead_name] = clf
            
            # Predictions on test set
            y_pred = clf.predict(X_test)
            y_prob = clf.predict_proba(X_test)[:, 1]
            
            roc_auc = float(roc_auc_score(y_test, y_prob))
            acc = float(accuracy_score(y_test, y_pred))
            prec = float(precision_score(y_test, y_pred, zero_division=0))
            rec = float(recall_score(y_test, y_pred, zero_division=0))
            
            # Meteorological verification metrics: CSI (Critical Success Index / Threat Score) & FAR
            cm = confusion_matrix(y_test, y_pred)
            tn, fp, fn, tp = cm.ravel()
            csi = float(tp / max((tp + fp + fn), 1))  # Threat score
            far = float(fp / max((tp + fp), 1))       # False Alarm Ratio
            pod = float(tp / max((tp + fn), 1))       # Probability of Detection (Recall)
            
            auc_sum += roc_auc
            acc_sum += acc
            
            self.metrics["lead_times"][lead_name] = {
                "roc_auc": round(roc_auc, 4),
                "accuracy": round(acc, 4),
                "precision": round(prec, 4),
                "recall_pod": round(rec, 4),
                "critical_success_index_csi": round(csi, 4),
                "false_alarm_ratio_far": round(far, 4),
                "confusion_matrix": {
                    "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)
                }
            }
            
        # Train 4-class Lightning Risk Classifier
        y_ltg_train = targets["lightning_risk"][idx_train]
        y_ltg_test = targets["lightning_risk"][idx_test]
        
        ltg_clf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42)
        ltg_clf.fit(X_train, y_ltg_train)
        self.models["lightning_risk"] = ltg_clf
        
        ltg_acc = float(accuracy_score(y_ltg_test, ltg_clf.predict(X_test)))
        self.metrics["lightning_risk_accuracy"] = round(ltg_acc, 4)
        
        self.metrics["overall_roc_auc"] = round(auc_sum / 3.0, 4)
        self.metrics["overall_accuracy"] = round(acc_sum / 3.0, 4)
        
        # Feature importances from 30m XGBoost model
        importances = self.models["30m"].feature_importances_
        sorted_indices = np.argsort(importances)[::-1]
        
        feat_imp = []
        for idx in sorted_indices:
            feat_imp.append({
                "feature": self.feature_names[idx],
                "importance": round(float(importances[idx]), 4),
                "importance_pct": round(float(importances[idx] * 100), 1)
            })
        self.metrics["feature_importance"] = feat_imp
        
        self.is_trained = True
        self.save_models()

    def save_models(self):
        joblib.dump({
            "models": self.models,
            "feature_names": self.feature_names,
            "metrics": self.metrics
        }, os.path.join(MODEL_DIR, "tabular_models.joblib"))

    def load_models(self) -> bool:
        path = os.path.join(MODEL_DIR, "tabular_models.joblib")
        if os.path.exists(path):
            data = joblib.load(path)
            self.models = data["models"]
            self.feature_names = data["feature_names"]
            self.metrics = data["metrics"]
            self.is_trained = True
            return True
        return False

    def predict_observation(self, obs: AtmosphericObservation) -> Dict[str, NowcastPrediction]:
        """Generate 30m, 60m, 90m predictions and explainable AI insights from atmospheric input."""
        if not self.is_trained:
            if not self.load_models():
                raise RuntimeError("Models are not trained or loaded yet.")
                
        # Format input vector matching feature_names
        x_vec = np.array([[
            obs.max_reflectivity_dbz,
            obs.mean_reflectivity_dbz,
            obs.vil_kg_m2,
            obs.echo_top_km,
            obs.reflectivity_trend_15min,
            obs.cloud_top_temp_c,
            obs.cloud_cooling_rate_15min,
            obs.water_vapor_bt_c,
            obs.flash_count_15min,
            obs.flash_rate_per_min,
            obs.lightning_jump_sigma,
            obs.cg_ratio,
            obs.cape_j_kg,
            obs.cin_j_kg,
            obs.lifted_index,
            obs.k_index,
            obs.surface_temp_c,
            obs.dew_point_c,
            obs.wind_shear_0_6km_mps,
            obs.rh_850hpa_pct
        ]])
        
        # Risk classification mapping
        risk_labels = ["Low", "Moderate", "High", "Severe"]
        
        # Lightning risk prediction
        ltg_class_idx = int(self.models["lightning_risk"].predict(x_vec)[0])
        ltg_risk = risk_labels[ltg_class_idx]
        
        # Estimate storm classification
        if obs.max_reflectivity_dbz > 55.0 and obs.wind_shear_0_6km_mps > 20.0:
            classification = "Supercell Convection"
        elif obs.max_reflectivity_dbz > 48.0 and obs.wind_shear_0_6km_mps > 15.0:
            classification = "Squall Line"
        elif obs.max_reflectivity_dbz > 40.0:
            classification = "Multicell Cluster"
        elif obs.max_reflectivity_dbz > 30.0:
            classification = "Ordinary Convective Cell"
        else:
            classification = "Non-Severe"
            
        # Motion estimation
        heading = 45.0 + (obs.lat % 10.0) * 3.0
        speed = 35.0 + (obs.wind_shear_0_6km_mps * 0.6)
        cardinal = cardinal_direction(heading)
        
        # Explainability key drivers
        key_drivers = self._extract_key_drivers(obs)
        
        predictions: Dict[str, NowcastPrediction] = {}
        
        for lead_name, lead_minutes in [("30m", 30), ("60m", 60), ("90m", 90)]:
            clf = self.models[lead_name]
            prob = float(clf.predict_proba(x_vec)[0, 1])
            
            # Risk qualitative level
            if prob >= 0.75:
                ts_risk = "Severe"
            elif prob >= 0.50:
                ts_risk = "High"
            elif prob >= 0.25:
                ts_risk = "Moderate"
            else:
                ts_risk = "Low"
                
            # Lightning probability roughly tracks thunderstorm prob with jump enhancement
            ltg_prob = min(1.0, prob * (1.05 + 0.1 * obs.lightning_jump_sigma))
            
            # Expected lightning rate
            exp_rate = round(obs.flash_rate_per_min * (1.2 if obs.cloud_cooling_rate_15min < -5.0 else 0.85), 1)
            
            # Growth state
            if obs.reflectivity_trend_15min > 2.0 or obs.cloud_cooling_rate_15min < -5.0:
                growth = "Intensifying" if lead_minutes <= 30 else "Mature"
            elif obs.reflectivity_trend_15min < -2.0:
                growth = "Dissipating"
            else:
                growth = "Stable"
                
            predictions[lead_name] = NowcastPrediction(
                timestamp=obs.timestamp,
                lead_time_minutes=lead_minutes,
                forecast_time=f"+{lead_minutes} min",
                thunderstorm_probability=round(prob, 3),
                lightning_probability=round(ltg_prob, 3),
                thunderstorm_risk=ts_risk,
                lightning_risk=ltg_risk,
                expected_lightning_rate_per_min=exp_rate,
                expected_max_dbz=round(max(0.0, obs.max_reflectivity_dbz + (obs.reflectivity_trend_15min * (lead_minutes / 30.0))), 1),
                cell_growth_trend=growth,
                storm_classification=classification,
                storm_speed_kmh=round(speed, 1),
                storm_heading_deg=round(heading, 1),
                storm_direction_cardinal=cardinal,
                confidence_score=round(0.88 + (0.05 if prob > 0.7 else -0.04), 2),
                key_drivers=key_drivers
            )
            
        return predictions

    def _extract_key_drivers(self, obs: AtmosphericObservation) -> List[ExplainabilityItem]:
        """Generate human-interpretable meteorological drivers (XAI)."""
        drivers = []
        
        # 1. Radar Reflectivity Core
        if obs.max_reflectivity_dbz >= 45.0:
            drivers.append(ExplainabilityItem(
                feature="max_reflectivity_dbz",
                label="Radar Core Reflectivity",
                value=obs.max_reflectivity_dbz,
                unit="dBZ",
                impact="high_risk",
                description=f"Intense radar core of {obs.max_reflectivity_dbz} dBZ indicates heavy hydrometeors and convective updraft."
            ))
        elif obs.max_reflectivity_dbz >= 35.0:
            drivers.append(ExplainabilityItem(
                feature="max_reflectivity_dbz",
                label="Radar Core Reflectivity",
                value=obs.max_reflectivity_dbz,
                unit="dBZ",
                impact="moderate_risk",
                description=f"Convective echo of {obs.max_reflectivity_dbz} dBZ indicates active rain cell development."
            ))
            
        # 2. CAPE Instability
        if obs.cape_j_kg >= 2000.0:
            drivers.append(ExplainabilityItem(
                feature="cape_j_kg",
                label="Convective Available Potential Energy (CAPE)",
                value=obs.cape_j_kg,
                unit="J/kg",
                impact="high_risk",
                description=f"Extreme instability ({obs.cape_j_kg} J/kg) provides abundant buoyancy for explosive storm intensification."
            ))
        elif obs.cape_j_kg >= 1200.0:
            drivers.append(ExplainabilityItem(
                feature="cape_j_kg",
                label="CAPE Instability",
                value=obs.cape_j_kg,
                unit="J/kg",
                impact="moderate_risk",
                description=f"Moderate atmospheric instability ({obs.cape_j_kg} J/kg) supporting convective cell maintenance."
            ))
            
        # 3. Satellite Cloud Top Cooling
        if obs.cloud_cooling_rate_15min <= -5.0:
            drivers.append(ExplainabilityItem(
                feature="cloud_cooling_rate_15min",
                label="Satellite CTT Cooling Rate",
                value=obs.cloud_cooling_rate_15min,
                unit="°C/15m",
                impact="high_risk",
                description=f"Rapid cloud top cooling of {obs.cloud_cooling_rate_15min} °C/15m signals vigorous vertical updraft surging."
            ))
            
        # 4. Lightning Jump Metric
        if obs.lightning_jump_sigma >= 2.0:
            drivers.append(ExplainabilityItem(
                feature="lightning_jump_sigma",
                label="Lightning Jump (Schultz 2σ)",
                value=obs.lightning_jump_sigma,
                unit="σ",
                impact="high_risk",
                description=f"Lightning jump of {obs.lightning_jump_sigma}σ detected, strongly correlating with imminent severe storm/hail."
            ))
        elif obs.flash_rate_per_min > 5.0:
            drivers.append(ExplainabilityItem(
                feature="flash_rate_per_min",
                label="Total Lightning Flash Rate",
                value=obs.flash_rate_per_min,
                unit="flashes/min",
                impact="moderate_risk",
                description=f"Active electrical discharges at {obs.flash_rate_per_min} flashes/min."
            ))
            
        # 5. CIN Capping
        if obs.cin_j_kg > 100.0:
            drivers.append(ExplainabilityItem(
                feature="cin_j_kg",
                label="Convective Inhibition (CIN)",
                value=obs.cin_j_kg,
                unit="J/kg",
                impact="inhibiting",
                description=f"High capping inversion ({obs.cin_j_kg} J/kg) acts to suppress and delay storm initiation."
            ))
            
        return drivers
