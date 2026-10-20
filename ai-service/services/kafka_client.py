import os
import json
import logging
from typing import Optional, Dict, Any, List
try:
    from confluent_kafka import Producer, Consumer, KafkaException
    from confluent_kafka.admin import AdminClient, NewTopic
    KAFKA_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - depends on native Kafka binary availability
    Producer = Consumer = KafkaException = None
    AdminClient = NewTopic = None
    KAFKA_IMPORT_ERROR = exc

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS")

def is_kafka_configured() -> bool:
    return bool(KAFKA_BOOTSTRAP_SERVERS and KAFKA_BOOTSTRAP_SERVERS.strip() and KAFKA_BOOTSTRAP_SERVERS.lower() not in ("none", "disabled", "false"))

# Kafka configuration
def get_kafka_config() -> dict:
    return {
        'bootstrap.servers': KAFKA_BOOTSTRAP_SERVERS or "localhost:9092"
    }

def _kafka_unavailable() -> bool:
    return (not is_kafka_configured()) or Producer is None or Consumer is None or AdminClient is None

def get_producer():
    """Initialize and return a Kafka producer."""
    if not is_kafka_configured():
        return None
    if Producer is None:
        raise RuntimeError(f"Kafka client unavailable: {KAFKA_IMPORT_ERROR}")
    return Producer(get_kafka_config())

def get_consumer(group_id: str):
    """Initialize and return a Kafka consumer."""
    if not is_kafka_configured():
        return None
    if Consumer is None:
        raise RuntimeError(f"Kafka client unavailable: {KAFKA_IMPORT_ERROR}")
    config = get_kafka_config()
    config.update({
        'group.id': group_id,
        'auto.offset.reset': 'earliest'
    })
    return Consumer(config)

def get_admin_client():
    if not is_kafka_configured():
        return None
    if AdminClient is None:
        raise RuntimeError(f"Kafka client unavailable: {KAFKA_IMPORT_ERROR}")
    return AdminClient(get_kafka_config())

def check_kafka_health() -> dict:
    """Check if Kafka is reachable and list topics."""
    if not is_kafka_configured():
        return {
            "kafka_available": False,
            "bootstrap_servers": None,
            "message": "Kafka is not configured (KAFKA_BOOTSTRAP_SERVERS not set)",
            "topics": []
        }
    if _kafka_unavailable():
        logger.warning("Kafka support is disabled because the native client could not be loaded: %s", KAFKA_IMPORT_ERROR)
        return {
            "kafka_available": False,
            "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
            "topics": []
        }
    try:
        admin_client = get_admin_client()
        # Request cluster metadata, timeout after 2 seconds
        metadata = admin_client.list_topics(timeout=2.0)
        return {
            "kafka_available": True,
            "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
            "topics": list(metadata.topics.keys())
        }
    except Exception as e:
        logger.error(f"Kafka health check failed: {e}")
        return {
            "kafka_available": False,
            "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
            "topics": []
        }

def create_topics(topics: List[str]):
    """Create topics if they don't exist."""
    if not is_kafka_configured() or _kafka_unavailable():
        return
    admin_client = get_admin_client()
    new_topics = [NewTopic(topic, num_partitions=1, replication_factor=1) for topic in topics]
    
    try:
        # Call create_topics to asynchronously create topics
        fs = admin_client.create_topics(new_topics)
        for topic, f in fs.items():
            try:
                f.result()  # The result itself is None
                logger.info(f"Topic '{topic}' created")
            except Exception as e:
                # Topic might already exist
                if "TopicAlreadyExists" in str(e) or "already exists" in str(e):
                    logger.info(f"Topic '{topic}' already exists")
                else:
                    logger.error(f"Failed to create topic {topic}: {e}")
    except Exception as e:
        logger.error(f"Failed to connect to Kafka for topic creation: {e}")

class KafkaEventProducer:
    def __init__(self):
        if not is_kafka_configured():
            self.producer = None
            return
        try:
            self.producer = get_producer()
        except Exception as e:
            logger.error(f"Failed to initialize producer: {e}")
            self.producer = None

    def delivery_report(self, err, msg):
        """Called once for each message produced to indicate delivery result."""
        if err is not None:
            logger.error(f"Message delivery failed: {err}")
        else:
            logger.debug(f"Message delivered to {msg.topic()} [{msg.partition()}]")

    def publish_event(self, topic: str, event: Dict[str, Any], key: Optional[str] = None):
        if not self.producer:
            logger.warning("Kafka producer unavailable. Event not published.")
            return False
            
        try:
            payload = json.dumps(event).encode('utf-8')
            key_bytes = key.encode('utf-8') if key else None
            
            self.producer.produce(
                topic=topic,
                key=key_bytes,
                value=payload,
                callback=self.delivery_report
            )
            # Trigger any available delivery report callbacks
            self.producer.poll(0)
            return True
        except Exception as e:
            logger.error(f"Failed to publish event to topic {topic}: {e}")
            return False
            
    def flush(self):
        if self.producer:
            self.producer.flush()

class SimpleConsumer:
    """A wrapper for a basic consumer to test the connection."""
    def __init__(self, group_id: str, topics: List[str]):
        self.consumer = get_consumer(group_id)
        self.topics = topics
        
    def start_consuming(self, message_handler):
        try:
            self.consumer.subscribe(self.topics)
            logger.info(f"Subscribed to topics: {self.topics}")
            
            while True:
                msg = self.consumer.poll(1.0)
                if msg is None:
                    continue
                if msg.error():
                    logger.error(f"Consumer error: {msg.error()}")
                    continue
                    
                message_handler(msg)
        except KeyboardInterrupt:
            pass
        finally:
            self.consumer.close()
