import { createHostedHandler } from '../src/adapters/hosted.mjs';
// Stateless Vercel Node function. No SQLite, writable filesystem or process-owned user state.
export default createHostedHandler();
