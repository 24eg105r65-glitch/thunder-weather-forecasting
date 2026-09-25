"""Model training and verification script for TabularNowcaster."""

import sys
import os

# Ensure backend root is in Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from app.core.data_generator import generate_training_dataset
from app.models.tabular_classifier import TabularNowcaster


def main():
    print("==================================================================")
    print("[*] Aerocast-AI: Training Baseline Multimodal Nowcasting Models...")
    print("==================================================================")
    
    print("1. Synthesizing domain-grounded atmospheric datasets (N=5,000 samples)...")
    X, targets, feature_names = generate_training_dataset(n_samples=5000, random_seed=42)
    print(f"   + Generated feature matrix shape: {X.shape}")
    print(f"   + Atmospheric feature count: {len(feature_names)}")
    
    print("2. Fitting XGBoost & Random Forest models across lead times (30m, 60m, 90m)...")
    nowcaster = TabularNowcaster()
    nowcaster.train_and_evaluate(X, targets, feature_names)
    
    print("\n================ METEOROLOGICAL VERIFICATION METRICS ================")
    for lead, m in nowcaster.metrics["lead_times"].items():
        print(f"\n--- Lead Time: +{lead} Forecast ---")
        print(f"  * ROC-AUC Score:          {m['roc_auc']:.4f}")
        print(f"  * Accuracy:               {m['accuracy'] * 100:.2f}%")
        print(f"  * Precision:              {m['precision'] * 100:.2f}%")
        print(f"  * POD (Recall/Detection): {m['recall_pod'] * 100:.2f}%")
        print(f"  * CSI (Threat Score):     {m['critical_success_index_csi']:.4f}")
        print(f"  * FAR (False Alarm Rate): {m['false_alarm_ratio_far']:.4f}")
        print(f"  * Confusion Matrix:       TP={m['confusion_matrix']['tp']}, FP={m['confusion_matrix']['fp']}, FN={m['confusion_matrix']['fn']}, TN={m['confusion_matrix']['tn']}")
        
    print(f"\n* Lightning Risk 4-Class Accuracy: {nowcaster.metrics['lightning_risk_accuracy'] * 100:.2f}%")
    print(f"* Overall Combined ROC-AUC:        {nowcaster.metrics['overall_roc_auc']:.4f}")
    
    print("\n================ TOP FEATURE IMPORTANCES (SHAP/GAIN) ================")
    for item in nowcaster.metrics["feature_importance"][:7]:
        bar = "#" * int(item["importance_pct"] * 0.8)
        print(f"  {item['feature']:<28} {item['importance_pct']:>5.1f}% {bar}")
        
    print("\n+ Model weights and verification artifacts successfully saved to app/models/weights/.")
    print("==================================================================")


if __name__ == "__main__":
    main()
