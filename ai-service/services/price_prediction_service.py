import os
import json
import pickle
import logging
import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

class PricePredictionService:
    def __init__(self, model_dir="models/price_model"):
        self.model_dir = model_dir
        self.model = None
        self.fe = None
        self.metadata = {}
        self._load_artifacts()

    def _load_artifacts(self):
        model_path = os.path.join(self.model_dir, "model.pkl")
        fe_path = os.path.join(self.model_dir, "preprocessor.pkl")
        meta_path = os.path.join(self.model_dir, "metadata.json")

        if not all(os.path.exists(p) for p in [model_path, fe_path, meta_path]):
            logger.warning("Price prediction artifacts missing. Ensure training has occurred.")
            return

        try:
            with open(model_path, "rb") as f:
                self.model = pickle.load(f)
            with open(fe_path, "rb") as f:
                self.fe = pickle.load(f)
            with open(meta_path, "r") as f:
                self.metadata = json.load(f)
            logger.info(f"Loaded Price Prediction Model version {self.metadata.get('model_version')}")
        except Exception as e:
            logger.error(f"Failed to load artifacts: {e}")

    def predict(self, commodity: str, market: str, recent_history_df: pd.DataFrame, forecast_days: int) -> dict:
        if self.model is None or self.fe is None:
            return {"error": "MODEL_NOT_LOADED", "message": "The AI model is not currently available."}

        if recent_history_df.empty or len(recent_history_df) < 30:
            return {"error": "INSUFFICIENT_DATA", "message": "At least 30 days of history required for prediction."}

        # Format historical df
        df = recent_history_df.copy()
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values('date').reset_index(drop=True)

        current_price = float(df.iloc[-1]['modal_price'])
        data_as_of = df.iloc[-1]['date']
        data_source = df.iloc[-1].get('source')
        if pd.isna(data_source) or not data_source:
            data_source = 'DATABASE_CACHE'
        
        # Calculate data age relative to today
        today = datetime.now().date()
        obs_date = data_as_of.date()
        age = (today - obs_date).days
        data_age_days = max(0, age)

        # Established architectural staleness threshold (matches price_ingestion.py)
        PRICE_DATA_MAX_STALENESS_DAYS = 2
        is_stale = data_age_days > PRICE_DATA_MAX_STALENESS_DAYS

        predictions = []
        
        # Recursive prediction loop
        current_df = df.copy()
        for i in range(forecast_days):
            # We want to predict for `next_date`
            next_date = current_df.iloc[-1]['date'] + timedelta(days=1)
            
            # Create a dummy row for the target date so the feature engineer can process it.
            # We copy the last row, update the date, and set 'modal_price' and 'arrivals' 
            # to NaN or last known since the features are mostly shifted.
            last_arrivals = current_df.iloc[-1]['arrivals']
            dummy_row = pd.DataFrame([{
                'date': next_date,
                'commodity': commodity,
                'market': market,
                'modal_price': current_price, # placeholder, feature engine shifts it anyway
                'arrivals': last_arrivals
            }])
            
            temp_df = pd.concat([current_df, dummy_row], ignore_index=True)
            
            # Generate features
            features_df = self.fe.create_features(temp_df)
            latest_features = features_df.iloc[[-1]]
            
            # Extract the exact feature columns required by model
            X = latest_features[self.metadata.get("features", [])]
            
            # Predict
            pred_price = float(self.model.predict(X)[0])
            
            # Format single prediction
            predictions.append({
                "date": next_date.strftime("%Y-%m-%d"),
                "predicted_price": round(pred_price, 2)
            })
            
            # Update current_df with the prediction so next iteration can use it as lag_1
            # We actually replace the dummy row's modal_price with the prediction to become history
            temp_df.loc[temp_df.index[-1], 'modal_price'] = pred_price
            current_df = temp_df

        # Determine trend based on first vs last prediction
        start_price = current_price
        end_price = predictions[-1]["predicted_price"]
        if end_price > start_price * 1.02:
            trend = "INCREASING"
        elif end_price < start_price * 0.98:
            trend = "DECREASING"
        else:
            trend = "STABLE"

        # Calculate retail ratio based on latest data or use 1.30 (30% markup) heuristic
        last_row = df.iloc[-1]
        if "retail_min" in df.columns and not pd.isna(last_row.get("retail_min")) and not pd.isna(last_row.get("retail_max")):
            retail_current = float((last_row["retail_min"] + last_row["retail_max"]) / 2)
        else:
            retail_current = float(current_price * 1.30)

        retail_ratio = float(retail_current / current_price) if current_price > 0 else 1.30

        # Inject retail predictions and expiration status
        for p in predictions:
            p["predicted_retail_price"] = round(float(p["predicted_price"] * retail_ratio), 2)
            p["is_expired"] = bool(is_stale)
            p["status"] = "EXPIRED" if is_stale else "ACTIVE"

        # Get last 10 days of historical data for the frontend chart
        history_subset = df.tail(10)
        historical_data = []
        for idx, (_, row) in enumerate(history_subset.iterrows()):
            w_price = round(float(row['modal_price']), 2)
            if "retail_min" in df.columns and not pd.isna(row.get("retail_min")) and not pd.isna(row.get("retail_max")):
                r_price = round(float(row["retail_min"] + row["retail_max"]) / 2, 2)
            else:
                r_price = round(float(w_price * retail_ratio), 2)
                
            historical_data.append({
                "date": row['date'].strftime("%Y-%m-%d"),
                "price": float(w_price),
                "retail_price": float(r_price),
                "is_latest": idx == len(history_subset) - 1
            })

        staleness_warning = None
        if is_stale:
            first_pred_date = predictions[0]["date"] if predictions else "N/A"
            last_pred_date = predictions[-1]["date"] if predictions else "N/A"
            staleness_warning = (
                f"Live forecast unavailable: Historical market data is stale ({data_age_days} days old, latest observation: "
                f"{data_as_of.strftime('%Y-%m-%d')}, freshness threshold: {PRICE_DATA_MAX_STALENESS_DAYS} days). "
                f"Projections from {first_pred_date} to {last_pred_date} represent expired historical projections anchored to "
                f"{data_as_of.strftime('%Y-%m-%d')} and cannot be used as an active forward-looking forecast. Updated market observations are needed."
            )

        return {
            "commodity": commodity,
            "market": market,
            "current_price": round(float(current_price), 2),
            "current_retail_price": round(float(retail_current), 2),
            "historical_data": historical_data,
            "predictions": predictions,
            "expired_projections": predictions if is_stale else [],
            "forecast_available": not bool(is_stale),
            "forecast_status": "EXPIRED_STALE_OBSERVATIONS" if is_stale else "ACTIVE_FORECAST",
            "trend": trend,
            "data_source": data_source,
            "data_as_of": data_as_of.strftime("%Y-%m-%d"),
            "data_age_days": int(data_age_days),
            "is_stale": bool(is_stale),
            "staleness_threshold_days": PRICE_DATA_MAX_STALENESS_DAYS,
            "warning": staleness_warning,
            "forecast_policy": "OBSERVATION_ANCHORED",
            "forecast_base_date": data_as_of.strftime("%Y-%m-%d"),
            "model_version": str(self.metadata.get("model_version", "unknown"))
        }
