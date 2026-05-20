document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';
  if (text.length > 0) {
    chrome.runtime.sendMessage({
      type: 'text-selected',
      text: text,
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'get-selection') {
    const selection = window.getSelection();
    sendResponse({
      text: selection ? selection.toString().trim() : '',
      title: document.title || '',
    });
  }
  return true;
});
