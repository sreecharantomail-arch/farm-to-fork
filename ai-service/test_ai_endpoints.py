import os
os.environ["CORS_ORIGINS"] = "http://localhost:3000,http://localhost:8000"

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ok", "degraded"]
    assert "price_model" in data

def test_valid_quality_request():
    response = client.post("/predict/quality", json={"image_url": "http://example.com/image.jpg"})
    assert response.status_code == 200
    assert response.json()["quality"] == "AI Inspection Unavailable"

def test_invalid_quality_request():
    # missing image_url
    response = client.post("/predict/quality", json={})
    assert response.status_code == 422

def test_valid_shelf_life():
    response = client.post("/predict/shelf-life", json={
        "crop_type": "Tomato",
        "temperature": 25.0,
        "humidity": 60.0,
        "quantity": 100
    })
    assert response.status_code == 200
    assert response.json()["storage_recommendation"] == "AI Service Unavailable"

def test_invalid_shelf_life():
    response = client.post("/predict/shelf-life", json={
        "crop_type": "Tomato",
        "temperature": 100.0, # out of range (max 60)
        "humidity": 60.0,
        "quantity": 100
    })
    assert response.status_code == 422

def test_invalid_negative_quantity():
    response = client.post("/predict/shelf-life", json={
        "crop_type": "Tomato",
        "temperature": 25.0,
        "humidity": 60.0,
        "quantity": -10 # invalid
    })
    assert response.status_code == 422

def test_price_prediction_success():
    response = client.post("/api/farmer/price-prediction", json={
        "commodity": "Tomato",
        "market": "Bangalore",
        "forecast_days": 7
    })
    # If the local database is currently unpopulated, verify documented INSUFFICIENT_HISTORICAL_DATA,
    # then verify the observation-anchored stale forecast pipeline using an isolated in-memory fixture.
    if response.status_code == 503 and response.json().get("error_code") == "INSUFFICIENT_HISTORICAL_DATA":
        from unittest.mock import patch
        import pandas as pd
        dates = pd.date_range(end="2026-10-08", periods=35)
        mock_df = pd.DataFrame({
            "date": dates.strftime("%Y-%m-%d"),
            "modal_price": [30.0 + (i * 0.1) for i in range(35)],
            "arrivals": [100.0] * 35,
            "commodity": "Tomato",
            "market": "Bangalore",
            "source": "DATABASE_CACHE"
        })
        with patch("main.fetch_historical_prices", return_value=mock_df):
            response = client.post("/api/farmer/price-prediction", json={
                "commodity": "Tomato",
                "market": "Bangalore",
                "forecast_days": 7
            })

    assert response.status_code == 200
    data = response.json()
    assert data["commodity"] == "Tomato"
    assert data["market"] == "Bangalore"
    assert len(data["predictions"]) == 7
    assert "current_price" in data
    assert "historical_data" in data
    assert len(data["historical_data"]) > 0
    assert data["trend"] in ["INCREASING", "DECREASING", "STABLE"]
    # Forecast policy and staleness verification
    assert data["forecast_policy"] == "OBSERVATION_ANCHORED"
    assert data["forecast_base_date"] == "2026-10-08"
    assert data["is_stale"] is True
    assert data["staleness_threshold_days"] == 2
    assert data["warning"] is not None
    assert "stale" in data["warning"].lower()
    # Stale forecast availability and expiration status
    assert data["forecast_available"] is False
    assert data["forecast_status"] == "EXPIRED_STALE_OBSERVATIONS"
    assert data["predictions"][0]["is_expired"] is True
    assert data["predictions"][0]["status"] == "EXPIRED"
    assert len(data["expired_projections"]) == 7
    # Check historical and forecast separation
    base_date = data["forecast_base_date"]
    for pred in data["predictions"]:
        assert pred["date"] > base_date
    for hist in data["historical_data"]:
        assert hist["date"] <= base_date
    assert data["historical_data"][-1]["is_latest"] is True
    assert data["historical_data"][-1]["date"] == base_date
    assert data["historical_data"][0]["is_latest"] is False

def test_price_prediction_insufficient_data():
    response = client.post("/api/farmer/price-prediction", json={
        "commodity": "ExoticCropXYZ",
        "market": "UnknownMarketABC",
        "forecast_days": 7
    })
    assert response.status_code == 503
    data = response.json()
    assert data["success"] is False
    assert data["error_code"] == "INSUFFICIENT_HISTORICAL_DATA"
    assert "Insufficient verified historical data" in data["message"]

def test_price_prediction_missing_db(monkeypatch=None):
    from unittest.mock import patch
    with patch("services.database.get_supabase_client", return_value=None):
        response = client.post("/api/farmer/price-prediction", json={
            "commodity": "Tomato",
            "market": "Bangalore",
            "forecast_days": 7
        })
        assert response.status_code == 503
        data = response.json()
        assert data["success"] is False
        assert data["error_code"] == "VERIFIED_DATA_UNAVAILABLE"

if __name__ == "__main__":
    test_health_endpoint()
    test_valid_quality_request()
    test_invalid_quality_request()
    test_valid_shelf_life()
    test_invalid_shelf_life()
    test_invalid_negative_quantity()
    test_price_prediction_success()
    test_price_prediction_insufficient_data()
    test_price_prediction_missing_db()
    print("ALL TESTS PASSED")
