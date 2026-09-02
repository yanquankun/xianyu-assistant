import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '../../src/sidepanel/App';
import { createBrowserSidePanelServices } from '../../src/sidepanel/services';
import './styles.css';
import './enhancements.css';

const root = document.querySelector('#root');
if (root === null) {
  throw new Error('无法初始化侧边栏');
}

createRoot(root).render(
  <StrictMode>
    <App
      services={createBrowserSidePanelServices()}
      appVersion={browser.runtime.getManifest().version}
    />
  </StrictMode>
);
