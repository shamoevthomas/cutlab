import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles/app.css';
import { platform } from './platform';

document.documentElement.dataset.platform = platform;

createRoot(document.getElementById('root')!).render(<App />);
import { useStore } from './store';
(window as any).__cutlab = useStore;
import * as dsp from './model/denoise';
import * as media from './engine/media';
(window as any).__cutlabDebug = { dsp, media };
