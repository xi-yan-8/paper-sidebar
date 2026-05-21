chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-claude',
    title: '🔍 问问 Claude',
    contexts: ['selection'],
  });
});

// Send a message to the active tab's content script
async function sendToActiveTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    return chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// Toolbar icon click → toggle sidebar
chrome.action.onClicked.addListener(() => {
  sendToActiveTab({ type: 'toggle-sidebar' });
});

// Context menu → open sidebar with selected text
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'ask-claude' && info.selectionText) {
    sendToActiveTab({
      type: 'open-sidebar',
      question: info.selectionText,
    });
  }
});
