// GET /api/call-recording?id=<vapi call id> — streams a call's audio to an
// admin. Edge runtime so it does not count against the Hobby 12-function cap
// (see CLAUDE.md); the logic lives in _lib/call-recording.js.
import { streamRecording } from './_lib/call-recording.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const id = new URL(req.url).searchParams.get('id');
  return streamRecording(req, id);
}
