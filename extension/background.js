chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-claude',
    title: '🔍 问问 Claude',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ask-claude' && info.selectionText) {
    chrome.sidePanel.open({ tabId: tab.id }).then(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'ask-from-context',
          question: info.selectionText,
          context: {
            pageTitle: tab.title || '',
            selectedText: info.selectionText,
          },
        });
      }, 300);
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
