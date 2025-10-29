let capturedImages = [];
let extensionTabId = null;
let activeInstagramTabId = null;

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }, (newTab) => {
    extensionTabId = newTab.id;
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === extensionTabId) {
    extensionTabId = null;
  }
  if (tabId === activeInstagramTabId) {
    activeInstagramTabId = null;
  }
});

function updateExtensionTab() {
  if (extensionTabId !== null) {
    chrome.tabs.get(extensionTabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.log("Extension tab not found, creating new tab");
        chrome.tabs.create(
          { url: chrome.runtime.getURL("index.html") },
          (newTab) => {
            extensionTabId = newTab.id;
          }
        );
      } else {
        chrome.runtime.sendMessage({ action: "UPDATE_ITEMS" });
      }
    });
  } else {
    console.log("No extension tab found, creating new tab");
    chrome.tabs.create(
      { url: chrome.runtime.getURL("index.html") },
      (newTab) => {
        extensionTabId = newTab.id;
      }
    );
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CAPTURE_IMAGES") {
    capturedImages = request.images;
  } else if (request.action === "FETCH_IMAGE") {
    fetchImageAsDataURL(request.imageUrl)
      .then((dataUrl) => sendResponse({ success: true, dataUrl: dataUrl }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Indicates that the response is sent asynchronously
  } else if (request.action === "GET_CAPTURED_IMAGES") {
    sendResponse(capturedImages);
  } else if (request.action === "SYNC_WITH_INSTAGRAM") {
    chrome.tabs.create({ url: "https://www.instagram.com/" }, (tab) => {
      activeInstagramTabId = tab.id;
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.sendMessage(tabId, { action: "SHOW_SYNC_DRAWER" });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });
  } else if (request.action === "START_SYNC") {
    if (activeInstagramTabId) {
      chrome.tabs.sendMessage(activeInstagramTabId, {
        action: "IMPORT_INSTAGRAM_POSTS",
      });
    }
  } else if (request.action === "RETURN_TO_EXTENSION") {
    if (extensionTabId !== null) {
      chrome.tabs.update(extensionTabId, { active: true }, () => {
        setTimeout(updateExtensionTab, 500);
      });
    } else {
      chrome.tabs.create(
        { url: chrome.runtime.getURL("index.html") },
        (newTab) => {
          extensionTabId = newTab.id;
          setTimeout(updateExtensionTab, 500);
        }
      );
    }
  } else if (request.action === "POST_INSTAGRAM_SAVED_POSTS_TO_IMEMBR") {
    let posts = [];
    let collections = [];

    if (typeof request.data === "object" && request.data !== null) {
      if (Array.isArray(request.data.posts)) {
        posts = request.data.posts.map(formatInstagramPostObj);
      } else {
        console.error(
          "Received invalid posts data format:",
          request.data.posts
        );
      }

      if (Array.isArray(request.data.collections)) {
        collections = request.data.collections;
      } else {
        console.error(
          "Received invalid collections data format:",
          request.data.collections
        );
      }
    } else {
      console.error("Received invalid data format:", request.data);
      if (activeInstagramTabId) {
        chrome.tabs.sendMessage(activeInstagramTabId, {
          action: "IMPORT_FAILED",
          error: "Invalid data format received",
        });
      }
      return true;
    }

    chrome.storage.local.set(
      {
        instagramSavedPosts: JSON.stringify(posts),
        instagramCollections: JSON.stringify(collections),
      },
      function () {
        if (chrome.runtime.lastError) {
          console.error(
            "Error saving to localStorage:",
            chrome.runtime.lastError
          );
          if (activeInstagramTabId) {
            chrome.tabs.sendMessage(activeInstagramTabId, {
              action: "IMPORT_FAILED",
              error: "Failed to save data to localStorage",
            });
          }
        } else {
          chrome.runtime.sendMessage({
            action: "SYNC_COMPLETE",
            posts: posts,
            collections: collections,
            postsCount: posts.length,
          });
          if (activeInstagramTabId) {
            chrome.tabs.sendMessage(activeInstagramTabId, {
              action: "SYNC_COMPLETE",
              postsCount: posts.length,
            });
          }
          setTimeout(updateExtensionTab, 500);
        }
      }
    );
  } else if (request.action === "UPDATE_INSTAGRAM_FETCHED_POSTS_COUNT") {
    if (activeInstagramTabId) {
      chrome.tabs.sendMessage(activeInstagramTabId, {
        action: "UPDATE_INSTAGRAM_FETCHED_POSTS_COUNT",
        data: request.data,
      });
    }
    chrome.runtime.sendMessage({
      action: "UPDATE_INSTAGRAM_FETCHED_POSTS_COUNT",
      data: request.data,
    });
  }

  return true;
});

function formatInstagramPostObj(post) {
  if (!post || typeof post !== "object") {
    console.error("Invalid post object:", post);
    return null;
  }

  console.log(post);

  const { url, title, thumbnail, username, collectionIds, isVideo, videoUrl } =
    post;
  return {
    id: post.id || `${username}-${Date.now()}`,
    link: url,
    image: thumbnail,
    title,
    username,
    collectionIds,
    isVideo,
    videoUrl,
  };
}

async function fetchImageAsDataURL(imageUrl) {
  try {
    const response = await fetch(imageUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Error fetching image:", error);
    throw error;
  }
}
