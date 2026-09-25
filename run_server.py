"""Launcher script for Aerocast-AI Nowcasting Platform."""

import uvicorn
import sys
import os

if __name__ == "__main__":
    # Ensure backend path is configured
    backend_path = os.path.join(os.path.dirname(__file__), "backend")
    sys.path.insert(0, backend_path)
    
    print("=" * 70)
    print("   AEROCAST-AI: Multimodal Thunderstorm & Lightning Nowcasting Platform")
    print("=" * 70)
    print(" [>] Starting FastAPI Server on http://127.0.0.1:8000 ...")
    print(" [>] Open your web browser at: http://127.0.0.1:8000")
    print("=" * 70)
    
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)
