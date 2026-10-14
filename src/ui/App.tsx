import { useEffect } from 'react';
import { useStore } from '../store';
import { Home } from './Home';
import { Editor } from './Editor';
import { installShortcuts } from './shortcuts';

export function App() {
  const screen = useStore(s => s.screen);
  const toast = useStore(s => s.toast);
  useEffect(() => installShortcuts(), []);
  return (
    <>
      {screen === 'home' ? <Home /> : <Editor />}
      {toast && <div className={'toast ' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.text}</div>}
    </>
  );
}
