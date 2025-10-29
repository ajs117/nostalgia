let postsCount = 0;

const defaultRequest = {
  headers: {
    accept: "*/*",
    "sec-ch-ua-mobile": "?0",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "sec-gpc": "1",
    "x-ig-app-id": "936619743392459",
    "x-asbd-id": "198387",
    "x-requested-with": "XMLHttpRequest",
  },
  referrer: "https://www.instagram.com/",
  credentials: "include",
  mode: "cors",
};

function createSyncDrawer() {
  const drawer = document.createElement("div");
  drawer.id = "instagram-sync-drawer";
  drawer.style.cssText = `
    position: fixed;
    top: 0;
    right: -300px;
    width: 300px;
    height: 100%;
    background: var(--drawer-bg, white);
    color: var(--drawer-text, black);
    box-shadow: -2px 0 5px rgba(0,0,0,0.2);
    transition: right 0.3s ease;
    z-index: 10000;
    padding: 20px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  `;

  const heading = document.createElement("h2");
  heading.textContent = "Sync Instagram Saved Posts";
  heading.style.cssText = `
    margin-bottom: 20px;
    color: var(--drawer-heading, black);
  `;

  const syncButton = document.createElement("button");
  syncButton.id = "sync-button";
  syncButton.textContent = "Start Sync";
  syncButton.style.cssText = `
    padding: 10px 20px;
    background-color: var(--drawer-button-bg, #0095f6);
    color: var(--drawer-button-text, white);
    border: none;
    border-radius: 5px;
    cursor: pointer;
    margin-bottom: 10px;
  `;

  syncButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "START_SYNC" });
    syncButton.textContent = "Syncing...";
    syncButton.disabled = true;
  });

  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--drawer-text, black);
  `;

  closeButton.addEventListener("click", () => {
    drawer.style.right = "-300px";
  });

  const progressElement = document.createElement("p");
  progressElement.id = "sync-progress";
  progressElement.style.marginTop = "10px";

  drawer.appendChild(closeButton);
  drawer.appendChild(heading);
  drawer.appendChild(syncButton);
  drawer.appendChild(progressElement);
  document.body.appendChild(drawer);

  // Apply theme-based styles
  applyThemeStyles();

  return drawer;
}

function updateSyncDrawer(postsCount) {
  const drawer = document.getElementById("instagram-sync-drawer");
  if (drawer) {
    const syncButton = drawer.querySelector("#sync-button");
    if (syncButton) {
      syncButton.textContent = "Sync Complete";
      syncButton.disabled = true;
    }

    const progressElement = drawer.querySelector("#sync-progress");
    if (progressElement) {
      progressElement.textContent = `Successfully synced ${postsCount} posts from Instagram.`;
    }

    const existingReturnButton = drawer.querySelector("#return-button");
    if (!existingReturnButton) {
      const returnButton = document.createElement("button");
      returnButton.id = "return-button";
      returnButton.textContent = "Return to Extension";
      returnButton.style.cssText = `
        padding: 10px 20px;
        background-color: var(--drawer-button-bg, #0095f6);
        color: var(--drawer-button-text, white);
        border: none;
        border-radius: 5px;
        cursor: pointer;
        margin-top: 20px;
      `;
      returnButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "RETURN_TO_EXTENSION" });
        // Close the drawer after clicking the return button
        drawer.style.right = "-300px";
      });
      drawer.appendChild(returnButton);
    }
  }
}

function showDrawer(drawer) {
  drawer.style.right = "0";
}

function applyThemeStyles() {
  const isDarkMode = true;
  const style = document.createElement("style");
  style.textContent = `
    :root {
      --drawer-bg: ${isDarkMode ? "#1f2937" : "white"};
      --drawer-text: ${isDarkMode ? "#e5e7eb" : "black"};
      --drawer-heading: ${isDarkMode ? "#f3f4f6" : "black"};
      --drawer-button-bg: ${isDarkMode ? "#3b82f6" : "#0095f6"};
      --drawer-button-text: ${isDarkMode ? "#ffffff" : "white"};
    }
  `;
  document.head.appendChild(style);
}

// Call this function when the theme changes
function updateTheme() {
  applyThemeStyles();
  const drawer = document.getElementById("instagram-sync-drawer");
  if (drawer) {
    drawer.style.background = "var(--drawer-bg)";
    drawer.style.color = "var(--drawer-text)";
    const heading = drawer.querySelector("h2");
    if (heading) {
      heading.style.color = "var(--drawer-heading)";
    }

    const button = drawer.querySelector("button");
    if (button) {
      button.style.backgroundColor = "var(--drawer-button-bg)";
      button.style.color = "var(--drawer-button-text)";
    }
  }
}

// Listen for theme changes
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.attributeName === "class") {
      updateTheme();
    }
  });
});

observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class"],
});

// Initial theme application
applyThemeStyles();

async function fetchSavedPosts(maxId = "") {
  try {
    const response = await fetch(
      `https://i.instagram.com/api/v1/feed/saved/posts/?max_id=${maxId}`,
      {
        method: "GET",
        ...defaultRequest,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    let data = await response.json();
    data.items = data.items.map((item) => item.media);

    return data;
  } catch (error) {
    console.error(`Error fetching saved posts: ${error.message}`);
    throw error;
  }
}

async function fetchCollections() {
  let allCollections = [];
  let moreAvailable = true;
  let maxId = "";

  while (moreAvailable) {
    const url = `https://i.instagram.com/api/v1/collections/list/?collection_types=["ALL_MEDIA_AUTO_COLLECTION", "MEDIA"]&include_public_only=1&max_id=${maxId}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        ...defaultRequest,
        redirect: "error",
      });

      if (response.status !== 200) {
        throw new Error(
          `Failed to get collections. Status: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (Array.isArray(data.items)) {
        allCollections = allCollections.concat(data.items);
      }

      moreAvailable = data.more_available;
      maxId = data.next_max_id || "";

      // Optional: Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching collections: ${error.message}`);
      moreAvailable = false;
    }
  }

  return allCollections;
}

async function getInstagramSavedPosts() {
  try {
    const collections = await fetchCollections();
    let elements = [];
    let maxId = "";
    let moreAvailable = true;
    let retryCount = 0;
    const maxRetries = 3;

    while (moreAvailable) {
      // while (elements.length < 20) {
      try {
        chrome.runtime.sendMessage({
          action: "UPDATE_INSTAGRAM_FETCHED_POSTS_COUNT",
          data: {
            fetchedPosts: elements.length,
            postsCount: elements.length,
          },
        });

        const savedPosts = await fetchSavedPosts(maxId);
        maxId = savedPosts.next_max_id;

        for (const post of savedPosts.items) {
          const url = `https://www.instagram.com/p/${post.code}`;
          const element = {
            url,
            // TODO: Select max of image_versions2.candidates heights
            thumbnail: post.image_versions2?.candidates[0]?.url,
            title: post.caption?.text ?? `${post.user.username} post`,
            username: post.user.username,
            collectionIds: post.saved_collection_ids || [],
            isVideo: post.media_type === 2, // Instagram uses 2 for video type
            videoUrl: post.video_versions ? post.video_versions[0]?.url : null,
          };
          elements.push(element);
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        moreAvailable = savedPosts.more_available;
        retryCount = 0;
      } catch (error) {
        console.error(`Error in fetch loop: ${error.message}`);
        retryCount++;
        if (retryCount > maxRetries) {
          moreAvailable = false;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    return { posts: elements, collections };
  } catch (error) {
    console.error(`Error syncing Instagram data: ${error.message}`);
    throw error;
  }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "SHOW_SYNC_DRAWER") {
    const drawer = createSyncDrawer();
    setTimeout(() => showDrawer(drawer), 1000);
  } else if (request.action === "SYNC_COMPLETE") {
    updateSyncDrawer(request.postsCount);
  } else if (request.action === "IMPORT_INSTAGRAM_POSTS") {
    try {
      const savedPosts = await getInstagramSavedPosts();
      chrome.runtime.sendMessage({
        action: "POST_INSTAGRAM_SAVED_POSTS_TO_IMEMBR",
        data: savedPosts,
      });
    } catch (error) {
      console.error(`Error during import: ${error.message}`);
      chrome.runtime.sendMessage({
        action: "IMPORT_FAILED",
        error: error.message,
      });
    }
  } else if (request.action === "UPDATE_INSTAGRAM_FETCHED_POSTS_COUNT") {
    // Update the drawer with the current progress
    const drawer = document.getElementById("instagram-sync-drawer");
    if (drawer) {
      const progressElement = drawer.querySelector("#sync-progress");
      if (progressElement) {
        progressElement.textContent = `Synced ${request.data.fetchedPosts} posts`;
      }
    }
  }
});

(function () {
  if (window.location.hostname === "www.instagram.com") {
    console.log("Instagram page detected. Ready for sync.");
  }
})();
