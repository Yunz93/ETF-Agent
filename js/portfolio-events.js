import {els,state} from './state.js';
import {exportWorkspaceBackup,importWorkspaceBackup} from './workspace.js';
import {saveAppConfig,renderSettings} from './settings.js';
import {loadPortfolio} from './portfolio-client.js';
import {refreshPortfolio,renderPortfolio} from './views/portfolio.js';
import {renderDividend} from './views/render.js';
import {switchView,closeMobileSidebar,toggleMobileSidebar,toggleSidebar,toggleTheme,syncSidebarForViewport} from './navigation.js';

export function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
  els.etfRefresh?.addEventListener('click',()=>state.activeView==='dividend'?renderDividend({force:true}):refreshPortfolio());
  els.saveConfig?.addEventListener('click',saveAppConfig);
  els.exportWorkspace?.addEventListener('click',exportWorkspaceBackup);
  els.importWorkspace?.addEventListener('click',()=>els.importWorkspaceFile?.click());
  els.importWorkspaceFile?.addEventListener('change',importWorkspaceBackup);
  els.syncWorkspaceNow?.addEventListener('click',async()=>{
    try {
      await loadPortfolio();
      renderSettings();
      renderPortfolio();
      els.workspaceStatus.hidden=false;
      els.workspaceStatus.textContent='已读取最新组合';
    } catch(error) {
      els.workspaceStatus.hidden=false;
      els.workspaceStatus.textContent=error.message;
    }
  });
  els.themeToggle?.addEventListener('click',toggleTheme);
  els.sidebarToggle?.addEventListener('click',toggleSidebar);
  els.mobileSidebarToggle?.addEventListener('click',toggleMobileSidebar);
  els.mobileSidebarClose?.addEventListener('click',()=>closeMobileSidebar({restoreFocus:true}));
  els.sidebarBackdrop?.addEventListener('click',()=>closeMobileSidebar({restoreFocus:true}));
  document.addEventListener('keydown',event=>{
    if(document.documentElement.dataset.mobileSidebar!=='open') return;
    if(event.key==='Escape') {closeMobileSidebar({restoreFocus:true});return;}
    if(event.key!=='Tab') return;
    const items=[...document.querySelectorAll('#appSidebar button:not([disabled]), #appSidebar a[href]')].filter(e=>e.getClientRects().length);
    if(!items.length) return;
    if(event.shiftKey&&document.activeElement===items[0]) {event.preventDefault();items.at(-1).focus();}
    else if(!event.shiftKey&&document.activeElement===items.at(-1)) {event.preventDefault();items[0].focus();}
  });
  window.addEventListener('resize',syncSidebarForViewport);
}
