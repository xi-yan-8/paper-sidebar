// Paper Sidebar — In-page injection script
// Creates a resizable sidebar iframe that pushes page content aside
(() => {
  const DEFAULT_WIDTH = 380;
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 580;
  const HANDLE_W = 8;

  let root = null, handle = null, iframe = null, closeBtn = null;
  let sidebarWidth = DEFAULT_WIDTH;
  let isOpen = false;
  let dragActive = false;

  // ── Page push (multi-strategy) ──

  function pushPage(w) {
    // Strategy 1: body margin (works for most pages)
    document.body.style.marginRight = w + 'px';
    // Strategy 2: shrink PDF embed / full-width viewer elements
    const viewers = document.querySelectorAll('embed, iframe, object, .pdfViewer, #viewer');
    viewers.forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.width === '100%' || cs.width === '100vw' || parseFloat(cs.width) > window.innerWidth * 0.8) {
        el.style.maxWidth = 'calc(100% - ' + w + 'px)';
        el.style.width = 'calc(100% - ' + w + 'px)';
      }
    });
    // Strategy 3: html element overflow handling
    document.documentElement.style.overflowX = 'hidden';
  }

  function restorePage() {
    document.body.style.marginRight = '';
    document.querySelectorAll('embed, iframe, object, .pdfViewer, #viewer').forEach(el => {
      el.style.maxWidth = '';
      el.style.width = '';
    });
    document.documentElement.style.overflowX = '';
  }

  // ── Build sidebar ──

  function createSidebar() {
    if (root) return;
    const extUrl = chrome.runtime.getURL('sidepanel.html');

    root = document.createElement('div');
    root.id = 'paper-sidebar-root';
    Object.assign(root.style, {
      position: 'fixed', top: '0', right: '0', bottom: '0',
      width: sidebarWidth + 'px', zIndex: '2147483646',
      background: '#0d0d0d',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    });

    // Resize handle
    handle = document.createElement('div');
    handle.id = 'paper-sidebar-handle';
    Object.assign(handle.style, {
      position: 'absolute', left: '-' + (HANDLE_W / 2) + 'px',
      top: '0', bottom: '0', width: HANDLE_W + 'px',
      cursor: 'col-resize', zIndex: '2',
    });
    handle.addEventListener('pointerdown', onResizeStart);
    root.appendChild(handle);

    // Close button
    closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭侧边栏';
    Object.assign(closeBtn.style, {
      position: 'absolute', top: '10px', right: '10px', zIndex: '3',
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
      color: '#999', width: '28px', height: '28px', borderRadius: '6px',
      cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    closeBtn.addEventListener('click', closeSidebar);
    root.appendChild(closeBtn);

    // Iframe
    iframe = document.createElement('iframe');
    iframe.id = 'paper-sidebar-iframe';
    iframe.src = extUrl;
    Object.assign(iframe.style, {
      width: '100%', height: '100%', border: 'none', background: '#0d0d0d',
    });
    root.appendChild(iframe);

    document.body.appendChild(root);
    pushPage(sidebarWidth);
    isOpen = true;
  }

  function closeSidebar() {
    if (dragActive) return; // don't close during resize
    if (handle) handle.removeEventListener('pointerdown', onResizeStart);
    if (root) root.remove();
    root = handle = iframe = closeBtn = null;
    restorePage();
    isOpen = false;
  }

  // ── Resize (setPointerCapture — no ghosting) ──

  function onResizeStart(e) {
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    dragActive = true;
    handle.setPointerCapture(e.pointerId);

    const sx = e.clientX;
    const sw = sidebarWidth;

    handle.onpointermove = (ev) => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, sw + (sx - ev.clientX)));
      sidebarWidth = w;
      root.style.width = w + 'px';
      // Update all push strategies
      document.body.style.marginRight = w + 'px';
      const viewers = document.querySelectorAll('embed, iframe, object, .pdfViewer, #viewer');
      viewers.forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.width === '100%' || cs.width === '100vw' || parseFloat(cs.width) > window.innerWidth * 0.8) {
          el.style.maxWidth = 'calc(100% - ' + w + 'px)';
          el.style.width = 'calc(100% - ' + w + 'px)';
        }
      });
    };

    handle.onpointerup = () => {
      handle.releasePointerCapture(e.pointerId);
      handle.onpointermove = null;
      handle.onpointerup = null;
      dragActive = false;
    };

    handle.onpointercancel = () => {
      handle.onpointermove = null;
      handle.onpointerup = null;
      dragActive = false;
    };
  }

  // ── Iframe comm ──

  function forwardQuestion(q, retries = 0) {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'ask-from-parent', question: q }, '*');
    } else if (retries < 30) {
      setTimeout(() => forwardQuestion(q, retries + 1), 200);
    }
  }

  // ── Background messages ──

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle-sidebar') {
      if (isOpen) closeSidebar(); else createSidebar();
    } else if (msg.type === 'open-sidebar') {
      if (!isOpen) createSidebar();
      if (msg.question) forwardQuestion(msg.question);
    } else if (msg.type === 'get-selection') {
      const s = window.getSelection();
      return Promise.resolve({
        text: s ? s.toString().trim() : '',
        title: document.title || '',
      });
    }
  });

  // ── Text selection notification ──

  document.addEventListener('mouseup', () => {
    const s = window.getSelection();
    const t = s ? s.toString().trim() : '';
    if (t.length > 0) {
      chrome.runtime.sendMessage({ type: 'text-selected', text: t }).catch(() => {});
    }
  });

  // ── Auto-open on PDF pages ──

  function isPDFPage() {
    if (document.contentType === 'application/pdf') return true;
    if (/\.pdf$/i.test(location.href)) return true;
    if (document.querySelector('embed[type="application/pdf"]')) return true;
    return false;
  }

  if (isPDFPage()) {
    setTimeout(createSidebar, 600);
  }
})();
