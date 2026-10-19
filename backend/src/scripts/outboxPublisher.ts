import { outboxPublisherService } from '../services/outboxPublisherService';

console.log('[CLI] Launching FarmChainAI Outbox Publisher CLI...');

outboxPublisherService.start();

const shutdown = async () => {
  console.log('[CLI] Stopping Outbox Publisher CLI...');
  await outboxPublisherService.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
