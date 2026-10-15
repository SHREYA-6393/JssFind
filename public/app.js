import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  getAuth,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const elements = {
  accountMenu: document.querySelector("#account-menu"),
  board: document.querySelector("#listing-board"),
  boardCount: document.querySelector("#board-count"),
  categoryFilter: document.querySelector("#category-filter"),
  dialogIntro: document.querySelector("#dialog-intro"),
  dialogTitle: document.querySelector("#dialog-title"),
  emptyMessage: document.querySelector("#empty-message"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  form: document.querySelector("#post-form"),
  formError: document.querySelector("#form-error"),
  gate: document.querySelector("#sign-in-gate"),
  grid: document.querySelector("#listing-grid"),
  searchForm: document.querySelector("#board-search-form"),
  itemDate: document.querySelector("#item-date"),
  photoInput: document.querySelector("#item-photo"),
  photoPreview: document.querySelector("#photo-preview"),
  photoPreviewImage: document.querySelector("#photo-preview-image"),
  photoPreviewName: document.querySelector("#photo-preview-name"),
  photoStatus: document.querySelector("#photo-status"),
  removePhoto: document.querySelector("#remove-photo"),
  loginButtons: document.querySelectorAll("[data-sign-in]"),
  logoutButtons: document.querySelectorAll("[data-sign-out]"),
  postButtons: document.querySelectorAll("[data-open-post]"),
  postDialog: document.querySelector("#post-dialog"),
  searchInput: document.querySelector("#search-input"),
  submitPost: document.querySelector("#submit-post"),
  toast: document.querySelector("#toast"),
  userAvatar: document.querySelector("#user-avatar"),
  userName: document.querySelector("#user-name"),
};

let currentUser = null;
let allItems = [];
let activeType = "all";
let stopListeningToItems = null;
let toastTimer = null;
let photoPreviewUrl = null;
let uploadedPhotoFile = null;
let uploadedPhotoUrl = null;
let editingItemId = null;

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

if (elements.itemDate) {
  elements.itemDate.max = new Date().toISOString().slice(0, 10);
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, isError ? 7000 : 3800);
}

function friendlyError(error) {
  const messages = {
    "auth/unauthorized-domain":
      "This site’s domain isn’t authorized for Firebase sign-in yet. Add the current preview or Vercel domain in Firebase Authentication settings.",
    "auth/operation-not-allowed":
      "Google sign-in is not enabled yet. Turn on Google in Firebase Authentication → Sign-in method.",
    "auth/popup-blocked":
      "Your browser blocked the sign-in popup. Allow popups for this site and try again.",
    "auth/network-request-failed":
      "Could not reach Firebase. Check your connection and try again.",
    "permission-denied":
      "Firestore denied this request. Publish the provided Firestore rules in your Firebase console.",
    "firestore/permission-denied":
      "Firestore denied this request. Publish the provided Firestore rules in your Firebase console.",
  };
  return messages[error?.code] || error?.message || "Something went wrong. Please try again.";
}

async function handleSignIn() {
  try {
    await signInWithPopup(auth, googleProvider);
    if (document.body.dataset.page === "home") {
      window.location.assign("/browse");
    }
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") {
      showToast(friendlyError(error), true);
      console.error("Google sign-in failed:", error);
    }
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
    showToast("You’re signed out.");
  } catch (error) {
    showToast(friendlyError(error), true);
    console.error("Sign-out failed:", error);
  }
}

function setSignedInView(user) {
  currentUser = user;
  const signedIn = Boolean(user);
  const isBrowsePage = document.body.dataset.page === "browse";

  if (elements.accountMenu) elements.accountMenu.hidden = !signedIn;
  elements.loginButtons.forEach((button) => {
    button.hidden = signedIn;
  });
  elements.postButtons.forEach((button) => {
    button.hidden = !signedIn;
  });
  if (elements.gate) elements.gate.hidden = signedIn;
  if (elements.board) elements.board.hidden = !signedIn;

  if (signedIn) {
    const name = user.displayName?.trim() || "Campus member";
    if (elements.userName) elements.userName.textContent = name;
    if (elements.userAvatar) {
      elements.userAvatar.title = name;
      const photoUrl = getSafeGooglePhotoUrl(user.photoURL);
      if (photoUrl) {
        const image = document.createElement("img");
        image.src = photoUrl;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
          if (elements.userAvatar.querySelector("img") === image) {
            elements.userAvatar.classList.remove("has-photo");
            elements.userAvatar.textContent = name.charAt(0).toUpperCase();
          }
        }, { once: true });
        elements.userAvatar.classList.add("has-photo");
        elements.userAvatar.replaceChildren(image);
      } else {
        elements.userAvatar.classList.remove("has-photo");
        elements.userAvatar.textContent = name.charAt(0).toUpperCase();
      }
    }
  }

  if (stopListeningToItems) {
    stopListeningToItems();
    stopListeningToItems = null;
  }

  if (signedIn && isBrowsePage) {
    listenForItems();
  } else if (!signedIn) {
    allItems = [];
    renderItems();
  }
}

function listenForItems() {
  const itemsQuery = query(
    collection(db, "items"),
    orderBy("createdAt", "desc"),
    limit(60),
  );
  let receivedSnapshot = false;

  stopListeningToItems = onSnapshot(
    itemsQuery,
    (snapshot) => {
      receivedSnapshot = true;
      allItems = snapshot.docs.map((itemDoc) => ({
        id: itemDoc.id,
        ...itemDoc.data(),
      }));
      renderItems();
    },
    (error) => {
      console.error("Could not load listings:", error);
      if (!receivedSnapshot) {
        elements.boardCount.textContent = "Could not load listings";
        elements.emptyState.hidden = false;
        elements.emptyTitle.textContent = "Could not load listings";
        elements.emptyMessage.textContent = `${friendlyError(error)} (${error.code || "unknown error"})`;
      }
      showToast(friendlyError(error), true);
    },
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function getSafeGooglePhotoUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const photoUrl = new URL(value);
    const isGoogleHosted =
      photoUrl.hostname === "googleusercontent.com" ||
      photoUrl.hostname.endsWith(".googleusercontent.com");
    return photoUrl.protocol === "https:" && isGoogleHosted ? photoUrl.href : "";
  } catch {
    return "";
  }
}

function formatDate(dateString) {
  if (!dateString) return "Date not listed";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Date not listed";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatRelativeTime(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date) return "Just posted";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just posted";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function locationIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 6.7c0 3.3-5 7.3-5 7.3S3 10 3 6.7a5 5 0 1 1 10 0Z"/><circle cx="8" cy="6.5" r="1.5"/></svg>';
}

function calendarIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M5 2v3M11 2v3M2.5 6.5h11"/></svg>';
}

function contactIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="5" r="2.5"/><path d="M3.5 13c.4-2.1 2.1-3.5 4.5-3.5s4.1 1.4 4.5 3.5"/></svg>';
}

function renderContactInfo(value) {
  const contact = String(value || "").trim();
  if (!contact) return "";

  const escapedContact = escapeHtml(contact);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return `Contact: <a href="mailto:${encodeURIComponent(contact)}">${escapedContact}</a>`;
  }
  if (/^\+?[\d\s().-]{7,24}$/.test(contact)) {
    const phoneNumber = contact.replace(/[^\d+]/g, "");
    return `Contact: <a href="tel:${phoneNumber}">${escapedContact}</a>`;
  }
  return `Contact: ${escapedContact}`;
}

function getFilteredItems() {
  const search = (elements.searchInput?.value || "").trim().toLocaleLowerCase();
  const category = elements.categoryFilter?.value || "all";

  return allItems.filter((item) => {
    const matchesType = activeType === "all" || item.itemType === activeType;
    const matchesCategory = category === "all" || item.category === category;
    const searchableText = `${item.title} ${item.description} ${item.location} ${item.meetingPoint} ${item.contactInfo} ${item.category}`.toLocaleLowerCase();
    const matchesSearch = !search || searchableText.includes(search);
    return matchesType && matchesCategory && matchesSearch;
  });
}

function renderCard(item) {
  const isOwner = currentUser?.uid === item.ownerUid;
  const isResolved = item.status === "resolved";
  const imageUrl = getSafeCloudinaryImageUrl(item.imageUrl);
  const typeLabel = item.itemType === "found" ? "Found" : "Lost";
  const cardClass = isResolved ? "item-card is-resolved" : "item-card";
  const statusBadge = isResolved
    ? '<span class="resolved-label">Resolved</span>'
    : `<span class="item-badge ${item.itemType === "found" ? "found" : "lost"}">${typeLabel}</span>`;
  const ownerActions = isOwner
    ? `<div class="owner-actions">
        <button class="text-action" data-edit-item="${escapeHtml(item.id)}" type="button">Edit</button>
        ${isResolved
          ? `<button class="text-action" data-toggle-status="${escapeHtml(item.id)}" data-next-status="open" type="button">Reopen</button>
             <button class="text-action delete-action" data-delete-item="${escapeHtml(item.id)}" type="button">Delete</button>`
          : `<button class="text-action delete-action" data-complete-item="${escapeHtml(item.id)}" type="button">Mark complete</button>`}
      </div>`
    : "";
  const description = item.description?.trim()
    ? escapeHtml(item.description)
    : "No extra details added.";

  return `<article class="${cardClass}">
    ${imageUrl
      ? `<img class="item-card-image" src="${imageUrl}" alt="Photo of ${escapeHtml(item.title)}" loading="lazy" />`
      : ""}
    <div class="item-card-content">
      <div class="item-card-top">
        ${statusBadge}
        <span class="category-label">${escapeHtml(item.category)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="item-description">${description}</p>
      <div class="item-meta">
        <span>${locationIcon()}${escapeHtml(item.location)}</span>
        <span>${calendarIcon()}${escapeHtml(formatDate(item.eventDate))}</span>
      </div>
      <details class="item-details">
        <summary><span>View details</span><span aria-hidden="true">→</span></summary>
        <div class="item-details-content">
          <p>${description}</p>
          ${item.meetingPoint
            ? `<p><strong>Meet at</strong> ${escapeHtml(item.meetingPoint)}</p>`
            : '<p class="detail-empty">No meetup point added.</p>'}
          ${item.contactInfo
            ? `<p class="item-contact">${contactIcon()}${renderContactInfo(item.contactInfo)}</p>`
            : '<p class="detail-empty">No contact method added.</p>'}
        </div>
      </details>
      <div class="item-card-footer">
        <span class="posted-time">${escapeHtml(formatRelativeTime(item.createdAt))}</span>
        ${ownerActions}
      </div>
    </div>
  </article>`;
}

function getSafeCloudinaryImageUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const imageUrl = new URL(value);
    if (imageUrl.protocol === "https:" && imageUrl.hostname === "res.cloudinary.com") {
      return escapeHtml(value);
    }
  } catch {
    return "";
  }
  return "";
}

function renderItems() {
  if (!elements.grid) return;
  const filteredItems = getFilteredItems();
  elements.grid.innerHTML = filteredItems.map(renderCard).join("");
  elements.boardCount.textContent = `${filteredItems.length} ${filteredItems.length === 1 ? "item" : "items"}`;
  elements.emptyState.hidden = filteredItems.length > 0;

  if (allItems.length === 0) {
    elements.emptyTitle.textContent = "Nothing here just yet";
    elements.emptyMessage.textContent = "Be the first to share a lost or found item with campus.";
  } else {
    elements.emptyTitle.textContent = "No matches found";
    elements.emptyMessage.textContent = "Try another search or filter, or share a new item with campus.";
  }
}

function openPostDialog(itemId = null) {
  if (!currentUser) {
    showToast("Sign in with Google before posting.", true);
    return;
  }
  const item = itemId ? allItems.find((candidate) => candidate.id === itemId) : null;
  if (itemId && (!item || item.ownerUid !== currentUser.uid)) {
    showToast("You can only edit your own posts.", true);
    return;
  }

  editingItemId = item?.id || null;
  elements.form.reset();
  clearPhotoSelection();
  elements.itemDate.max = new Date().toISOString().slice(0, 10);
  elements.formError.hidden = true;
  elements.formError.textContent = "";
  elements.submitPost.disabled = false;

  if (item) {
    elements.form.elements.namedItem("itemType").value = item.itemType;
    elements.form.elements.namedItem("title").value = item.title || "";
    elements.form.elements.namedItem("category").value = item.category || "";
    elements.form.elements.namedItem("eventDate").value = item.eventDate || "";
    elements.form.elements.namedItem("location").value = item.location || "";
    elements.form.elements.namedItem("meetingPoint").value = item.meetingPoint || "";
    elements.form.elements.namedItem("contactInfo").value = item.contactInfo || "";
    elements.form.elements.namedItem("description").value = item.description || "";
    elements.dialogTitle.textContent = "Edit your post";
    elements.dialogIntro.textContent = "Update your details. Your current photo stays unless you choose a replacement.";
    elements.submitPost.textContent = "Save changes";
    if (item.imageUrl) setPhotoStatus("Current photo will be kept unless replaced.", true);
  } else {
    elements.dialogTitle.textContent = "Post an item";
    elements.dialogIntro.textContent = "Share a few details so the right person can spot it.";
    elements.submitPost.textContent = "Share with campus ↗";
  }

  elements.postDialog.showModal();
}

function setPhotoStatus(message, visible = true) {
  elements.photoStatus.textContent = message;
  elements.photoStatus.hidden = !visible;
}

function clearPhotoSelection() {
  if (photoPreviewUrl) {
    URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
  }
  elements.photoInput.value = "";
  elements.photoPreviewImage.removeAttribute("src");
  elements.photoPreviewName.textContent = "";
  elements.photoPreview.hidden = true;
  setPhotoStatus("", false);
  uploadedPhotoFile = null;
  uploadedPhotoUrl = null;
}

function handlePhotoSelection() {
  const file = elements.photoInput.files?.[0];
  if (!file) {
    clearPhotoSelection();
    return;
  }

  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    clearPhotoSelection();
    elements.formError.textContent = "Choose a JPG, PNG, or WebP image.";
    elements.formError.hidden = false;
    return;
  }

  if (file.size > MAX_PHOTO_SIZE) {
    clearPhotoSelection();
    elements.formError.textContent = "Choose an image smaller than 5 MB.";
    elements.formError.hidden = false;
    return;
  }

  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  uploadedPhotoFile = null;
  uploadedPhotoUrl = null;
  photoPreviewUrl = URL.createObjectURL(file);
  elements.photoPreviewImage.src = photoPreviewUrl;
  elements.photoPreviewName.textContent = file.name;
  elements.photoPreview.hidden = false;
  setPhotoStatus("Ready to upload");
  elements.formError.hidden = true;
  elements.formError.textContent = "";
}

async function uploadPhoto(file) {
  setPhotoStatus("Preparing secure upload…");
  const token = await currentUser.getIdToken();
  const signatureResponse = await fetch("/api/cloudinary-signature", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const signature = await signatureResponse.json().catch(() => ({}));
  if (!signatureResponse.ok) {
    throw new Error(signature.error || "Could not prepare the photo upload.");
  }

  const uploadData = new FormData();
  uploadData.append("file", file);
  uploadData.append("api_key", signature.apiKey);
  uploadData.append("timestamp", String(signature.timestamp));
  uploadData.append("folder", signature.folder);
  uploadData.append("public_id", signature.publicId);
  uploadData.append("signature", signature.signature);

  setPhotoStatus("Uploading photo…");
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloudName)}/image/upload`,
    );
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setPhotoStatus(`Uploading photo… ${Math.round((event.loaded / event.total) * 100)}%`);
      }
    });
    request.addEventListener("error", () => reject(new Error("Could not reach Cloudinary. Check your connection and retry.")));
    request.addEventListener("load", () => {
      let result;
      try {
        result = JSON.parse(request.responseText);
      } catch {
        reject(new Error("Cloudinary returned an unreadable response."));
        return;
      }

      const safeImageUrl = getSafeCloudinaryImageUrl(result.secure_url);
      if (request.status < 200 || request.status >= 300 || !safeImageUrl) {
        reject(new Error(result.error?.message || "Cloudinary could not upload this photo."));
        return;
      }

      resolve(result.secure_url);
    });
    request.send(uploadData);
  });
}

async function submitListing(event) {
  event.preventDefault();
  if (!currentUser) {
    showToast("Sign in with Google before posting.", true);
    return;
  }

  const formData = new FormData(elements.form);
  const item = {
    itemType: String(formData.get("itemType")),
    title: String(formData.get("title") || "").trim(),
    category: String(formData.get("category") || ""),
    description: String(formData.get("description") || "").trim(),
    location: String(formData.get("location") || "").trim(),
    meetingPoint: String(formData.get("meetingPoint") || "").trim(),
    contactInfo: String(formData.get("contactInfo") || "").trim(),
    eventDate: String(formData.get("eventDate") || ""),
  };
  const listing = editingItemId
    ? { ...item, updatedAt: serverTimestamp() }
    : { ...item, ownerUid: currentUser.uid, status: "open", createdAt: serverTimestamp() };

  elements.formError.hidden = true;
  elements.submitPost.disabled = true;
  const photoFile = elements.photoInput.files?.[0] || null;
  elements.submitPost.textContent = photoFile
    ? "Uploading photo…"
    : editingItemId ? "Saving…" : "Posting…";

  try {
    if (photoFile) {
      if (uploadedPhotoFile === photoFile && uploadedPhotoUrl) {
        listing.imageUrl = uploadedPhotoUrl;
      } else {
        listing.imageUrl = await uploadPhoto(photoFile);
        uploadedPhotoFile = photoFile;
        uploadedPhotoUrl = listing.imageUrl;
      }
      setPhotoStatus("Photo uploaded");
      elements.submitPost.textContent = editingItemId ? "Saving post…" : "Sharing post…";
    }

    if (editingItemId) {
      await updateDoc(doc(db, "items", editingItemId), listing);
    } else {
      await addDoc(collection(db, "items"), listing);
    }
    const wasEditing = Boolean(editingItemId);
    editingItemId = null;
    elements.postDialog.close();
    elements.form.reset();
    clearPhotoSelection();
    showToast(wasEditing ? "Your changes have been saved." : "Your post is on the campus board.");
  } catch (error) {
    console.error(editingItemId ? "Could not update listing:" : "Could not create listing:", error);
    elements.formError.textContent = friendlyError(error);
    elements.formError.hidden = false;
  } finally {
    elements.submitPost.disabled = false;
    elements.submitPost.innerHTML = editingItemId
      ? "Save changes"
      : 'Share with campus <span aria-hidden="true">↗</span>';
  }
}

async function toggleItemStatus(itemId, nextStatus) {
  try {
    await updateDoc(doc(db, "items", itemId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    showToast(nextStatus === "resolved" ? "Marked as resolved." : "Post reopened.");
  } catch (error) {
    console.error("Could not update listing:", error);
    showToast(friendlyError(error), true);
  }
}

async function completeItem(itemId) {
  const confirmed = window.confirm(
    "Mark this post complete and permanently remove it from Firestore? This cannot be undone. Its uploaded photo, if any, will remain in Cloudinary.",
  );
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "items", itemId));
    showToast("The completed post was permanently deleted.");
  } catch (error) {
    console.error("Could not complete listing:", error);
    showToast(friendlyError(error), true);
  }
}

async function removeItem(itemId) {
  const confirmed = window.confirm(
    "Delete this post permanently? This cannot be undone. Its uploaded photo, if any, will remain in Cloudinary.",
  );
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "items", itemId));
    showToast("Post deleted.");
  } catch (error) {
    console.error("Could not delete listing:", error);
    showToast(friendlyError(error), true);
  }
}

elements.loginButtons.forEach((button) => button.addEventListener("click", handleSignIn));
elements.logoutButtons.forEach((button) => button.addEventListener("click", handleSignOut));
elements.postButtons.forEach((button) => button.addEventListener("click", () => openPostDialog()));
if (elements.form) elements.form.addEventListener("submit", submitListing);
if (elements.photoInput) elements.photoInput.addEventListener("change", handlePhotoSelection);
if (elements.removePhoto) elements.removePhoto.addEventListener("click", clearPhotoSelection);
if (elements.searchInput) elements.searchInput.addEventListener("input", renderItems);
if (elements.searchForm) {
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentUser) showToast("Sign in to search campus listings.", true);
  });
}
if (elements.categoryFilter) elements.categoryFilter.addEventListener("change", renderItems);
if (elements.grid) {
  elements.grid.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-item]");
    if (editButton) {
      openPostDialog(editButton.dataset.editItem);
      return;
    }

    const completeButton = event.target.closest("[data-complete-item]");
    if (completeButton) {
      completeItem(completeButton.dataset.completeItem);
      return;
    }

    const statusButton = event.target.closest("[data-toggle-status]");
    if (statusButton) {
      toggleItemStatus(statusButton.dataset.toggleStatus, statusButton.dataset.nextStatus);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-item]");
    if (deleteButton) {
      removeItem(deleteButton.dataset.deleteItem);
    }
  });
}

document.querySelectorAll("[data-type-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeType = button.dataset.typeFilter;
    document.querySelectorAll("[data-type-filter]").forEach((filterButton) => {
      const isActive = filterButton === button;
      filterButton.classList.toggle("is-active", isActive);
      filterButton.setAttribute("aria-pressed", String(isActive));
    });
    renderItems();
  });
});

if (elements.postDialog) {
  document.querySelector("#close-dialog").addEventListener("click", () => elements.postDialog.close());
  document.querySelector("#cancel-dialog").addEventListener("click", () => elements.postDialog.close());
  elements.postDialog.addEventListener("click", (event) => {
    if (event.target === elements.postDialog) {
      elements.postDialog.close();
    }
  });
}

onAuthStateChanged(auth, setSignedInView);
