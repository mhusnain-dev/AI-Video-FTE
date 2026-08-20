import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { promises as fs } from 'fs';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzZGI2YThjNS1jYzk5LTRhOWEtOGJhMS0wOTU1ODg4MjM2ZDIiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE3ODcwODA0MzgsImV4cCI6MTc4NzE2NjgzOH0.gaGWYVYvMxTBDpOgQakaSNXpeylBqghAIkcPdaOu_Po';
const USER_ID = '3db6a8c5-cc99-4a9a-8ba1-0955888236d2';
const SCRIPT_TEXT = "One day, a poor woodcutter dropped his axe into a river. A kind spirit appeared and offered him a golden and a silver axe, but the woodcutter honestly said, Neither is mine. Impressed by his honesty, the spirit returned his old axe and gifted him the other two as a reward.";
const OUTPUT_DIR = '/home/dev-logs/Desktop/FTE/output';

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, opts);
  return await resp.json();
}

async function main() {
  // Start API
  const api = spawn('npx', ['tsx', 'src/main.ts'], {
    cwd: '/home/dev-logs/Desktop/FTE',
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, NODE_ENV: 'development' }
  });
  
  let apiReady = false;
  api.stdout.on('data', d => { if (d.toString().includes('API server listening')) apiReady = true; });
  api.stderr.on('data', d => process.stderr.write('[api] ' + d));

  // Wait for API ready
  for (let i = 0; i < 30; i++) {
    if (apiReady) break;
    await sleep(1000);
  }
  if (!apiReady) throw new Error('API did not start');

  console.log('=== API READY ===');

  // Create story
  console.log('=== Creating story ===');
  const createResp = await fetchJSON('http://localhost:3000/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      brief: { narrative: SCRIPT_TEXT, targetDurationSeconds: 20, aspectRatio: '16:9', resolution: '720p' },
      userId: USER_ID
    })
  });
  const storyId = createResp.storyId;
  console.log('Story:', storyId);
  console.log('Shots:', createResp.shotPlan.map(s => s.id));

  // Present shot plan
  console.log('=== Presenting shot plan ===');
  await fetchJSON(`http://localhost:3000/api/stories/${storyId}/present`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ userId: USER_ID })
  });

  // Approve shot plan (triggers async dispatch)
  console.log('=== Approving shot plan ===');
  await fetchJSON(`http://localhost:3000/api/stories/${storyId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({ userId: USER_ID })
  });

  // Poll for completion (up to 5 minutes)
  console.log('=== Polling for completion ===');
  let story;
  let elapsed = 0;
  const MAX_WAIT = 300000; // 5 minutes
  const POLL_INTERVAL = 10000; // 10 seconds

  while (elapsed < MAX_WAIT) {
    await sleep(POLL_INTERVAL);
    elapsed += POLL_INTERVAL;
    story = await fetchJSON(`http://localhost:3000/api/stories/${storyId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const shotStatuses = story.shots.map(s => `${s.order}:${s.status}`).join(', ');
    console.log(`[${elapsed/1000}s] Story: ${story.status} | Shots: [${shotStatuses}]`);
    
    // Check if all shots are completed
    const allCompleted = story.shots.every(s => ['completed', 'merged'].includes(s.status));
    const anyFailed = story.shots.some(s => ['admission_failed', 'failed'].includes(s.status));
    
    if (allCompleted) {
      console.log('=== ALL SHOTS COMPLETED ===');
      break;
    }
    if (anyFailed && elapsed > 60000) {
      console.log('=== SHOTS FAILED - giving up ===');
      break;
    }
  }

  // Check final state
  console.log('=== FINAL STATE ===');
  console.log('Story status:', story.status);
  console.log('Shots:');
  story.shots.forEach(s => console.log(`  Shot ${s.order}: ${s.status} - ${s.video_url || 'no url'}`));
  if (story.merged_video_path) {
    console.log('Merged video path:', story.merged_video_path);
    
    // Copy to output dir with unique name
    const targetPath = `${OUTPUT_DIR}/${storyId}-final.mp4`;
    try {
      await fs.copyFile(story.merged_video_path, targetPath);
      console.log(`=== VIDEO SAVED TO: ${targetPath} ===`);
    } catch (e) {
      console.log('Copy failed:', e.message);
      console.log('Source file may not exist at:', story.merged_video_path);
    }
  } else {
    console.log('No merged video path in story record');
  }

  // Kill API
  api.kill('SIGTERM');
  await sleep(2000);
  process.exit(0);
}

main().catch(e => {
  console.error('ERROR:', e);
  process.exit(1);
});
