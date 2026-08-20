import { clearStream, ensureRedisConnected, STREAMS } from '../src/shared/redis.js';

async function main() {
  await ensureRedisConnected();
  const cleared = await clearStream(STREAMS.STORY_COMMANDS);
  console.log('Cleared', cleared, 'messages from story_commands');
  process.exit(0);
}

main();