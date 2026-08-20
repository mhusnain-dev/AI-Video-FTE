import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { wait } from './src/shared/utils.js'; // This won't work directly

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
  // Start API
  const api = spawn('npx', ['tsx', 'src/main.ts'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });

  // Wait for API to be ready
  await new Promise(r => setTimeout(r, 8000));

  // Test health
  try {
    const resp = await fetch('http://localhost:3000/health');
    const data = await resp.json();
    console.log('Health:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('Health check failed:', e.message);
  }

  // Approve story
  try {
    const resp = await fetch('http://localhost:3000/api/stories/7351c83a-26f7-46b1-9e2b-8a80c2315373/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzZGI2YThjNS1jYzk5LTRhOWEtOGJhMS0wOTU1ODg4MjM2ZDIiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE3ODcwODA0MzgsImV4cCI6MTc4NzE2NjgzOH0.gaGWYVYvMxTBDpOgQakaSNXpeylBqghAIkcPdaOu_Po'
      },
      body: JSON.stringify({ userId: '3db6a8c5-cc99-4a9a-8ba1-0955888236d2' })
    });
    const data = await resp.json();
    console.log('Approve:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('Approve failed:', e.message);
  }

  // Wait for generation
  await new Promise(r => setTimeout(r, 30000));

  // Check story status
  try {
    const resp = await fetch('http://localhost:3000/api/stories/7351c83a-26f7-46b1-9e2b-8a80c2315373', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzZGI2YThjNS1jYzk5LTRhOWEtOGJhMS0wOTU1ODg4MjM2ZDIiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJpYXQiOjE3ODcwODA0MzgsImV4cCI6MTc4NzE2NjgzOH0.gaGWYVYvMxTBDpOgQakaSNXpeylBqghAIkcPdaOu_Po'
      }
    });
    const data = await resp.json();
    console.log('Story status:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('Story check failed:', e.message);
  }

  api.kill('SIGTERM');
}

run().catch(console.error);
