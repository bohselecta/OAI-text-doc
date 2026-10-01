import { buildIntention } from './build-intention.mjs';
import { startIntentionServer } from '../src/intention/server.mjs';
await buildIntention();startIntentionServer();
