import { mountHohInterface } from './hoh-ui.js';
import { createProgramFeedAdapter } from './program-feed-adapter.js';

mountHohInterface({ root: document.querySelector('#hoh-root'), adapter: createProgramFeedAdapter(), workspaceName: 'MetaHumotonic' });
