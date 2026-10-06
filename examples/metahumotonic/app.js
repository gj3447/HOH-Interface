import { mountHohUI } from './hoh-ui.js';
import { createProgramFeedAdapter } from './program-feed-adapter.js';

mountHohUI({ root: document.querySelector('#hoh-root'), adapter: createProgramFeedAdapter(), workspaceName: 'MetaHumotonic' });
