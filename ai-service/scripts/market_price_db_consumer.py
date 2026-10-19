import os
import json
import logging
from datetime import datetime, timezone
from dotenv import load_dotenv

from services.kafka_client import get_consumer, KafkaEventProducer
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

from services.local_database_guard import load_approved_local_env, assert_local_supabase_url

load_approved_local_env()

# Configuration
GROUP_ID = os.getenv("KAFKA_MARKET_PRICE_DB_GROUP", "market-price-db-consumer")
TOPIC = os.getenv("KAFKA_MARKET_PRICE_TOPIC", "market-prices")
DLQ_TOPIC = os.getenv("KAFKA_DEAD_LETTER_TOPIC", "dead-letter-events")

class MarketPriceDBConsumer:
    def __init__(self):
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not supabase_url or not supabase_key:
            raise ValueError("Supabase credentials missing.")
        
        assert_local_supabase_url(supabase_url, context="MarketPriceDBConsumer")
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.producer = KafkaEventProducer()
        self.consumer = get_consumer(GROUP_ID)
        self.consumer.subscribe([TOPIC])

    def _is_processed(self, event_id: str) -> bool:
        """Check idempotency table."""
        try:
            resp = self.supabase.table("processed_events").select("event_id").eq("event_id", event_id).eq("consumer_group", GROUP_ID).execute()
            return len(resp.data) > 0
        except Exception as e:
            logger.error(f"Error checking idempotency: {e}")
            # If DB fails, assume not processed, but it might fail the next insert anyway
            return False

    def _mark_processed(self, event_id: str, topic: str):
        """Mark event as processed."""
        try:
            self.supabase.table("processed_events").insert({
                "event_id": event_id,
                "topic": topic,
                "consumer_group": GROUP_ID,
                "processed_at": datetime.now(timezone.utc).isoformat()
            }).execute()
        except Exception as e:
            logger.error(f"Failed to mark event {event_id} as processed: {e}")

    def _send_to_dlq(self, event: dict, error_msg: str):
        """Send unrecoverable failures to Dead Letter Queue."""
        dlq_event = {
            "event_id": str(os.urandom(16).hex()),
            "event_type": "DEAD_LETTER",
            "event_version": "1.0",
            "event_timestamp": datetime.now(timezone.utc).isoformat(),
            "source": GROUP_ID,
            "payload": {
                "original_topic": TOPIC,
                "original_event_id": event.get("event_id", "unknown"),
                "event_type": event.get("event_type", "unknown"),
                "error": error_msg,
                "retry_count": 0,
                "failed_at": datetime.now(timezone.utc).isoformat(),
                "original_payload": event
            }
        }
        logger.warning(f"Sending event {event.get('event_id')} to DLQ: {error_msg}")
        self.producer.publish_event(DLQ_TOPIC, dlq_event)

    def _validate_schema(self, payload: dict) -> bool:
        required_keys = ["date", "commodity", "market", "min_price", "max_price", "modal_price"]
        return all(k in payload for k in required_keys)

    def process_message(self, msg):
        try:
            event = json.loads(msg.value().decode('utf-8'))
        except Exception as e:
            logger.error(f"Failed to parse message: {e}")
            return

        event_id = event.get("event_id")
        if not event_id:
            logger.error("Event missing event_id")
            self._send_to_dlq(event, "Missing event_id")
            return

        # 1. Idempotency Check
        if self._is_processed(event_id):
            logger.info(f"Event {event_id} already processed. Skipping.")
            return

        payload = event.get("payload", {})

        # 2. Schema Validation
        if not self._validate_schema(payload):
            error_msg = "Invalid schema for MARKET_PRICE_UPDATED"
            logger.error(f"Event {event_id}: {error_msg}")
            self._send_to_dlq(event, error_msg)
            # Mark processed so we don't retry a bad schema infinitely
            self._mark_processed(event_id, TOPIC)
            return

        # 3. Upsert to Supabase
        db_record = {
            "event_id": event_id,
            "date": payload["date"],
            "commodity": payload["commodity"],
            "market": payload["market"],
            "state": payload.get("state", "Unknown"),
            "district": payload.get("district", "Unknown"),
            "variety": payload.get("variety", "FAQ"),
            "grade": payload.get("grade", "FAQ"),
            "min_price": payload["min_price"],
            "max_price": payload["max_price"],
            "modal_price": payload["modal_price"],
            "arrivals": payload.get("arrivals", 0.0),
            "source": payload.get("source", "UNKNOWN"),
            "data_as_of": payload.get("data_as_of", payload["date"]),
            "fetched_at": payload.get("fetched_at", datetime.now(timezone.utc).isoformat())
        }
        
        # Add optional retail fields if present
        if "wholesale_price" in payload:
            db_record["wholesale_price"] = payload["wholesale_price"]
        if "retail_min" in payload:
            db_record["retail_min"] = payload["retail_min"]
        if "retail_max" in payload:
            db_record["retail_max"] = payload["retail_max"]
        if "retail_unit" in payload:
            db_record["retail_unit"] = payload["retail_unit"]

        try:
            # We rely on the unique constraint (commodity, market, date) for upsert resolution
            # In Supabase REST API, upsert merges on the unique constraint automatically if specified,
            # or uses primary key if not. We'll specify on_conflict.
            self.supabase.table("market_prices").upsert(db_record, on_conflict="commodity,market,date").execute()
            logger.info(f"Successfully upserted price for {payload['commodity']}/{payload['market']} on {payload['date']}")
            
            # 4. Mark Processed
            self._mark_processed(event_id, TOPIC)

        except Exception as e:
            logger.error(f"Database upsert failed for event {event_id}: {e}")
            # If it's a transient DB error, we don't mark as processed, 
            # so the consumer group offset won't commit or we'll retry later.
            # For simplicity in this demo, we'll DLQ it if it repeatedly fails, 
            # but right now we'll just DLQ it immediately to follow the rule:
            self._send_to_dlq(event, f"DB Upsert failed: {str(e)}")
            self._mark_processed(event_id, TOPIC)

    def run(self):
        logger.info(f"Starting MarketPriceDBConsumer on topic {TOPIC}...")
        try:
            while True:
                msg = self.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    logger.error(f"Consumer error: {msg.error()}")
                    continue
                
                self.process_message(msg)
        except KeyboardInterrupt:
            logger.info("Stopping consumer...")
        finally:
            self.consumer.close()

if __name__ == "__main__":
    consumer = MarketPriceDBConsumer()
    consumer.run()
