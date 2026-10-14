import type { Bridge } from './types';
import { webBridge } from './web';

declare global { interface Window { cutlab?: Bridge } }

export const bridge: Bridge = window.cutlab ?? webBridge;
export type { Bridge };
