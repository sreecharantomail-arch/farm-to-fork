#!/usr/bin/env python3
"""
FarmChain AI - Production Hardened FastAPI Service
"""

import os
import logging
from datetime import datetime
from services.local_database_guard import (
    load_approved_local_env,
    LocalDatabaseGuardError,
    assert_approved_local_environment,
)

# Ensure local environment variables are loaded with backend/.env.local precedence
load_approved_local_env()

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Setup basic logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ai-service")

# Services
from services.price_prediction_service import PricePredictionService
from services.kafka_client import check_kafka_health, KafkaEventProducer

app = FastAPI(title="FarmChain AI Service", version="1.0.0")

# ─────────────────────────────────────────────
# CONFIGURATION & CORS
# ─────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model strictly once at startup
try:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.join(base_dir, "models", "price_model")
    if not os.path.isdir(model_dir):
        model_dir = "models/price_model"
    price_service = PricePredictionService(model_dir=model_dir)
except Exception as e:
    logger.error(f"Failed to initialize PricePredictionService: {e}")
    price_service = None

kafka_producer = KafkaEventProducer()

# ─────────────────────────────────────────────
# EXCEPTION HANDLING CONTRACT
# ─────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "available": False,
            "error_code": "INTERNAL_SERVER_ERROR",
            "message": "AI Service experienced an internal error."
        }
    )

# ─────────────────────────────────────────────
# REQUEST SCHEMAS WITH VALIDATION
# ─────────────────────────────────────────────
class ImageInput(BaseModel):
    image_url: str = Field(..., min_length=5, description="URL to the crop image")

class CropData(BaseModel):
    crop_type: str = Field(..., min_length=2, max_length=50)
    temperature: float = Field(..., ge=-50.0, le=60.0)
    humidity: float = Field(..., ge=0.0, le=100.0)
    quantity: float = Field(..., ge=0.0, description="Quantity must be non-negative")

class SalesData(BaseModel):
    product: str = Field(..., min_length=2, max_length=100)
    historical_sales: list[float] = Field(..., min_items=1)

class PricePredictionRequest(BaseModel):
    commodity: str = Field(..., min_length=2, max_length=100)
    market: str = Field(..., min_length=2, max_length=100)
    forecast_days: int = Field(default=7, ge=1, le=7)


# ─────────────────────────────────────────────
# 1. Crop Quality Classification (Mock/Unavailable)
# ─────────────────────────────────────────────
@app.post("/predict/quality")
def predict_quality(data: ImageInput):
    """Classify crop quality from image URL (Deterministic Unavailable)."""
    logger.info("Quality prediction requested.")
    return {
        "quality": "AI Inspection Unavailable",
        "score": 0.0,
        "confidence": 0.0,
        "analyzed_at": datetime.utcnow().isoformat()
    }


# ─────────────────────────────────────────────
# 2. Disease Detection (Mock/Unavailable)
# ─────────────────────────────────────────────
@app.post("/predict/disease")
def predict_disease(data: CropData):
    """Detect crop disease from crop data (Deterministic Unavailable)."""
    logger.info(f"Disease prediction requested for {data.crop_type}.")
    return {
        "disease_detected": False,
        "disease_name": "AI Service Unavailable",
        "severity": None,
        "confidence": 0.0,
        "recommendation": "Manual inspection required"
    }


# ─────────────────────────────────────────────
# 3. Shelf Life Prediction (Mock/Unavailable)
# ─────────────────────────────────────────────
@app.post("/predict/shelf-life")
def predict_shelf_life(data: CropData):
    """Predict shelf life in days (Deterministic Unavailable)."""
    logger.info(f"Shelf life prediction requested for {data.crop_type}.")
    return {
        "shelf_life_days": 0,
        "expiry_date": None,
        "storage_recommendation": "AI Service Unavailable",
        "freshness_score": 0.0
    }


# ─────────────────────────────────────────────
# 4. Market Price Prediction (XGBoost Real Pipeline)
# ─────────────────────────────────────────────
import uuid
from services.database import fetch_historical_prices

@app.post("/api/farmer/price-prediction")
@app.post("/ai/price-prediction")
def predict_price_real(data: PricePredictionRequest):
    """
    Real AI Endpoint predicting multi-day prices using XGBoost.
    """
    logger.info(f"Price prediction requested for {data.commodity} at {data.market}")
    
    if not price_service or price_service.model is None:
        logger.warning("Price prediction failed: Model unavailable")
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "available": False,
                "error_code": "MODEL_UNAVAILABLE",
                "message": "Price prediction model is currently unavailable."
            }
        )

    try:
        df_history = fetch_historical_prices(data.commodity, data.market, limit=40)
    except LocalDatabaseGuardError as ldge:
        logger.error(f"Local database guard blocked request: {ldge}")
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "available": False,
                "error_code": "LOCAL_DATABASE_GUARD_FAILED",
                "message": "Price prediction is unavailable because database target violates local-only policy."
            }
        )
    except ValueError as ve:
        logger.warning(f"Insufficient verified historical data: {ve}")
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "available": False,
                "error_code": "INSUFFICIENT_HISTORICAL_DATA",
                "message": f"Price prediction is unavailable: {ve}"
            }
        )
    except Exception as e:
        logger.error(f"Failed to retrieve verified historical data: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "available": False,
                "error_code": "VERIFIED_DATA_UNAVAILABLE",
                "message": "Price prediction is unavailable because verified historical market data is unavailable."
            }
        )

    result = price_service.predict(
        commodity=data.commodity,
        market=data.market,
        recent_history_df=df_history,
        forecast_days=data.forecast_days
    )
    
    if "error" in result:
        logger.warning(f"Price service returned error: {result['error']}")
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "available": False,
                "error_code": result["error"],
                "message": result.get("message", "Prediction failed")
            }
        )
    
    # Optionally publish to Kafka if successful
    try:
        event = {
            "event_id": str(uuid.uuid4()),
            "event_type": "PRICE_PREDICTION_CREATED",
            "event_version": "1.0",
            "event_timestamp": datetime.utcnow().isoformat() + "Z",
            "source": "price-prediction-service",
            "payload": {
                "commodity": result["commodity"],
                "market": result["market"],
                "predicted_price": result["predictions"][-1]["predicted_price"],
                "forecast_days": data.forecast_days,
                "data_source": result.get("data_source"),
                "model_version": result.get("model_version")
            }
        }
        topic = os.getenv("KAFKA_PRICE_PREDICTION_TOPIC", "price-predictions")
        kafka_producer.publish_event(topic, event)
    except Exception as e:
        logger.error(f"Failed to publish prediction to Kafka: {e}")
    
    return result


# ─────────────────────────────────────────────
# 5. Demand Forecasting (Mock/Unavailable)
# ─────────────────────────────────────────────
@app.post("/predict/demand")
def predict_demand(data: SalesData):
    """Forecast next-week demand (Deterministic Unavailable)."""
    logger.info(f"Demand prediction requested for {data.product}.")
    return {
        "product": data.product,
        "forecast_7_days": [],
        "recommended_stock": 0,
        "confidence": 0.0
    }


# ─────────────────────────────────────────────
# 6. Fraud Detection (Mock/Unavailable)
# ─────────────────────────────────────────────
@app.post("/predict/fraud")
def detect_fraud(data: dict):
    """Detect duplicate or suspicious entries (Deterministic Unavailable)."""
    logger.info("Fraud detection requested.")
    return {
        "is_suspicious": False,
        "fraud_score": 0.0,
        "flags": [],
        "recommendation": "AI Service Unavailable"
    }


# ─────────────────────────────────────────────
# Health Check & Root
# ─────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "service": "FarmChain AI",
        "status": "ok",
        "version": "1.0.0",
        "health": "/health",
        "docs": "/docs"
    }

@app.get("/health")
def health():
    price_model_status = "loaded" if (price_service and price_service.model) else "unavailable"
    status = "ok" if price_model_status == "loaded" else "degraded"
    
    return {
        "status": status,
        "service": "FarmChain AI",
        "price_model": price_model_status,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/api/kafka/health")
def kafka_health():
    return check_kafka_health()
