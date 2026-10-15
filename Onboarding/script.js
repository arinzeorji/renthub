
/* =========================================================
   RentHUB - script.js (single file, no common.js needed)
   Works with the single-page index.html.
  Accounts and identity verification are stored by the RentIt API.
   ========================================================= */

/* ---------- 1. SMALL HELPERS ---------- */
function byId(id) {
  return document.getElementById(id);
}

function makeSafe(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function naira(n) {
  return "₦" + Number(n).toLocaleString("en-NG");
}

function showError(fieldId, message) {
  var p = byId(fieldId + "Error");
  if (p) p.textContent = message;

  var box = byId(fieldId);
  if (box) {
    box.classList.toggle("border-red-500", message !== "");
    box.classList.toggle("border-slate-300", message === "");
  }

  return message === "";
}

var toastTimer;

function showToast(text) {
  var t = byId("toast");
  t.textContent = text;
  t.classList.remove("opacity-0");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    t.classList.add("opacity-0");
  }, 2200);
}

/* ---------- 2. STORAGE ---------- */
var USERS_KEY = "renthub_users";
var LISTINGS_KEY = "renthub_listings";
var SESSION_KEY = "renthub_session";
var TOKEN_KEY = "renthub_auth_token";
var API_BASE_URL = window.RENTHUB_API_BASE_URL || "http://localhost:3000/api";
var currentEmail = "";
var authToken = "";

function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function getUsers() {
  return readJSON(USERS_KEY, {});
}

function removeCachedPasswords() {
  var users = getUsers();
  var changed = false;

  Object.keys(users).forEach(function (email) {
    if (Object.prototype.hasOwnProperty.call(users[email], "password")) {
      delete users[email].password;
      changed = true;
    }
  });

  if (changed) saveUsers(users);
}

function saveUsers(u) {
  return writeJSON(USERS_KEY, u);
}

function getListings() {
  return readJSON(LISTINGS_KEY, []);
}

function saveListings(l) {
  return writeJSON(LISTINGS_KEY, l);
}

function getCurrentUser() {
  return currentEmail ? getUsers()[currentEmail] || null : null;
}

function updateCurrentUser(changes) {
  var users = getUsers();

  if (!users[currentEmail]) return;

  for (var k in changes) {
    users[currentEmail][k] = changes[k];
  }

  saveUsers(users);
}

function getAuthToken() {
  if (authToken) return authToken;

  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setAuthToken(token) {
  authToken = token || "";

  try {
    if (authToken) localStorage.setItem(TOKEN_KEY, authToken);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

async function apiRequest(path, options) {
  options = options || {};
  var headers = Object.assign({}, options.headers || {});

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  var token = getAuthToken();
  if (token) headers.Authorization = "Bearer " + token;

  var response;
  try {
    response = await fetch(API_BASE_URL + path, Object.assign({}, options, {
      headers: headers
    }));
  } catch (e) {
    throw new Error("Could not connect to the RentIt backend at " + API_BASE_URL + ".");
  }

  var body = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    var error = new Error(body.message || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }

  return body;
}

function cacheAuthenticatedUser(apiUser, token) {
  var users = getUsers();
  var email = String(apiUser.email || "").toLowerCase();
  var previous = users[email] || {};
  var nameParts = String(apiUser.name || "").trim().split(/\s+/);
  var firstName = apiUser.firstName || previous.firstName || nameParts.shift() || "";
  var lastName = apiUser.lastName || previous.lastName || nameParts.join(" ");
  var user = Object.assign({}, previous, {
    role: apiUser.role,
    firstName: firstName,
    lastName: lastName,
    businessName: apiUser.businessName || previous.businessName || "",
    email: email,
    phone: apiUser.phone || previous.phone || "",
    kycSubmitted: previous.kycSubmitted || false,
    kycVerified: previous.kycVerified || false,
    finishedSetup: previous.finishedSetup || false
  });

  delete user.password;
  users[email] = user;
  saveUsers(users);
  currentEmail = email;
  setSession(email);
  setAuthToken(token);
  return user;
}

async function refreshKycStatus() {
  try {
    var result = await apiRequest("/kyc/me");
    updateCurrentUser({
      kycSubmitted: true,
      kycVerified: result.kyc.status === "verified",
      kycStatus: result.kyc.status,
      address: result.kyc.address || ""
    });
  } catch (error) {
    if (error.status === 404) {
      updateCurrentUser({ kycSubmitted: false, kycVerified: false });
      return;
    }
    throw error;
  }
}

function setSession(email) {
  try {
    localStorage.setItem(SESSION_KEY, email);
  } catch (e) {}
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function getSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch (e) {
    return "";
  }
}

// Demo admin account: admin@renthub.com / Admin123
/* ---------- 3. VALIDATION ---------- */
function checkName(v, label) {
  v = v.trim();

  if (v === "") return "Enter your " + label + ".";
  if (v.length < 2) return "Your " + label + " is too short.";

  if (!/^[A-Za-z][A-Za-z '\-]*$/.test(v)) {
    return "Use letters only for your " + label + ".";
  }

  return "";
}

function checkEmail(v) {
  v = v.trim();

  if (v === "") return "Enter your email address.";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    return "Enter a valid email address.";
  }

  return "";
}

function checkPhone(v) {
  v = v.trim();

  if (v === "") return "Enter your phone number.";

  var digits = v.replace(/[\s\-()]/g, "");

  if (!/^\+?\d{10,15}$/.test(digits)) {
    return "Enter a valid phone number, e.g. +234 901 2345678.";
  }

  return "";
}

function checkAccountType(v) {
  return v === "" ? "Select an account type." : "";
}

function checkNewPassword(v) {
  if (v === "") return "Create a password.";
  if (v.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(v)) return "Add a capital letter.";
  if (!/[a-z]/.test(v)) return "Add a small letter.";
  if (!/\d/.test(v)) return "Add a number.";

  return "";
}

function checkConfirmPassword(v, original) {
  if (v === "") return "Re-enter your password.";
  if (v !== original) return "Passwords do not match.";

  return "";
}

function checkAddress(v) {
  v = v.trim();

  if (v === "") return "";
  if (v.length < 8) {
    return "Enter your full address (house number, street, city).";
  }

  return "";
}

function checkFile(file, allowPdf) {
  var max = 5 * 1024 * 1024;

  var okType =
    ["image/jpeg", "image/png", "image/webp"].indexOf(file.type) !== -1 ||
    (allowPdf && file.type === "application/pdf");

  if (!okType) {
    return allowPdf
      ? "Upload an image or a PDF."
      : "Upload an image file.";
  }

  if (file.size > max) {
    return "File is too large. Maximum size is 5MB.";
  }

  return "";
}

/* ---------- 4. SCREENS ---------- */
function showScreen(id) {
  var screens = document.querySelectorAll(".screen");

  for (var i = 0; i < screens.length; i++) {
    screens[i].classList.add("hidden");
  }

  byId(id).classList.remove("hidden");
  window.scrollTo(0, 0);

  if (id === "categoriesScreen") prepareCategoriesScreen();
  if (id === "reviewScreen") fillReviewScreen();

  if (id === "doneScreen") {
    byId("welcomeMessage").textContent =
      "Welcome to RentHUB, " +
      (getCurrentUser() ? getCurrentUser().firstName : "");
  }

  if (id === "homeScreen") fillHome();
  if (id === "ownerDashboardScreen") fillOwnerDashboard();
  if (id === "adminDashboardScreen") fillAdminDashboard();
}

function goToDashboard(user) {
  if (user.role === "admin") {
    showScreen("adminDashboardScreen");
  } else if (user.role === "owner") {
    showScreen("ownerDashboardScreen");
  } else {
    showScreen("homeScreen");
  }
}

function logout() {
  clearSession();
  setAuthToken("");
  currentEmail = "";
  showScreen("welcomeScreen");
}

document.addEventListener("click", function (e) {
  var goBtn = e.target.closest("[data-goto]");

  if (goBtn) {
    showScreen(goBtn.getAttribute("data-goto"));
    return;
  }

  if (e.target.closest(".coming-soon")) {
    showToast("Coming soon!");
    return;
  }

  if (e.target.closest(".logout")) {
    logout();
    return;
  }

  var eye = e.target.closest(".show-hide");

  if (eye) {
    var box = byId(eye.getAttribute("data-target"));

    if (box.type === "password") {
      box.type = "text";
      eye.textContent = "Hide";
    } else {
      box.type = "password";
      eye.textContent = "Show";
    }
  }
});

/* ---------- 5. RENTER SIGN UP ---------- */
var selectedCategories = [];
var idFileName = "";
var selfieFileName = "";
var addressText = "";

var signupFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "accountType",
  "password",
  "confirmPassword"
];

function validateSignupField(id) {
  var m = "";

  if (id === "firstName") {
    m = checkName(byId(id).value, "first name");
  } else if (id === "lastName") {
    m = checkName(byId(id).value, "last name");
  } else if (id === "email") {
    m = checkEmail(byId(id).value);
  } else if (id === "phone") {
    m = checkPhone(byId(id).value);
  } else if (id === "accountType") {
    m = checkAccountType(byId(id).value);
  } else if (id === "password") {
    m = checkNewPassword(byId(id).value);
  } else if (id === "confirmPassword") {
    m = checkConfirmPassword(
      byId(id).value,
      byId("password").value
    );
  }

  return showError(id, m);
}

signupFields.forEach(function (id) {
  var box = byId(id);

  box.addEventListener("blur", function () {
    if (box.value !== "") validateSignupField(id);
  });

  function recheck() {
    if (box.classList.contains("border-red-500")) {
      validateSignupField(id);
    }

    if (
      id === "password" &&
      byId("confirmPassword").value !== ""
    ) {
      validateSignupField("confirmPassword");
    }

    byId("signupFormError").textContent = "";
  }

  box.addEventListener("input", recheck);
  box.addEventListener("change", recheck);
});

byId("signupForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  var firstBad = "";

  signupFields.forEach(function (id) {
    if (!validateSignupField(id) && firstBad === "") {
      firstBad = id;
    }
  });

  if (firstBad) {
    byId(firstBad).focus();
    return;
  }

  var email = byId("email").value.trim().toLowerCase();
  var firstName = byId("firstName").value.trim();
  var lastName = byId("lastName").value.trim();
  var password = byId("password").value;
  var submitButton = byId("signupForm").querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: firstName + " " + lastName,
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: byId("phone").value.trim(),
        role: "renter",
        password: password
      })
    });

    var loginResult = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email, password: password })
    });
    cacheAuthenticatedUser(loginResult.user, loginResult.token);
    updateCurrentUser({ categories: [], idFileName: "", selfieFileName: "", address: "" });
    selectedCategories = [];
    idFileName = "";
    selfieFileName = "";
    addressText = "";
    byId("signupForm").reset();
    openIdentityScreen("renter");
  } catch (error) {
    byId("signupFormError").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

/* ---------- 6. LOGIN (RENTER, OWNER, ADMIN) ---------- */
byId("loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  var email = byId("loginEmail").value.trim().toLowerCase();
  var password = byId("loginPassword").value;

  byId("loginFormError").textContent = "";

  var emailOk = showError("loginEmail", checkEmail(email));
  var passOk = showError(
    "loginPassword",
    password === "" ? "Enter your password." : ""
  );

  if (!emailOk) {
    byId("loginEmail").focus();
    return;
  }

  if (!passOk) {
    byId("loginPassword").focus();
    return;
  }

  var submitButton = byId("loginForm").querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    var result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email, password: password })
    });
    var user = cacheAuthenticatedUser(result.user, result.token);
    await refreshKycStatus();
    user = getCurrentUser();
    byId("loginForm").reset();

    if (resumeSetup(user)) return;
    goToDashboard(user);
  } catch (error) {
    byId("loginFormError").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

["loginEmail", "loginPassword"].forEach(function (id) {
  byId(id).addEventListener("input", function () {
    showError(id, "");
    byId("loginFormError").textContent = "";
  });
});

/* ---------- 7. IDENTITY DOCUMENT SUBMISSION ----------
   Both the government ID and selfie are required.
   This demo records submission only. It does not verify
   the document or compare the selfie with the ID.
------------------------------------------------------ */

var idFileObj = null;
var selfieFileObj = null;
var kycRole = "renter";
var kycBusy = false;

function needsKyc(user) {
  return (
    (user.role === "renter" || user.role === "owner") &&
    !user.kycSubmitted
  );
}

function resumeSetup(user) {
  selectedCategories = user.categories || [];
  idFileName = user.idFileName || "";
  selfieFileName = user.selfieFileName || "";
  addressText = user.address || "";

  if (needsKyc(user)) {
    openIdentityScreen(user.role);
    return true;
  }

  if (user.role === "renter" && !user.finishedSetup) {
    showScreen("categoriesScreen");
    return true;
  }

  return false;
}

function openIdentityScreen(role) {
  kycRole = role;
  resetIdentityScreen();

  byId("identityStepperRenter").classList.toggle(
    "hidden",
    role !== "renter"
  );

  byId("identityStepperOwner").classList.toggle(
    "hidden",
    role !== "owner"
  );

  showScreen("identityScreen");
}

function setOptionLook(buttonId, statusId, look, text) {
  var b = byId(buttonId);
  var s = byId(statusId);

  b.classList.remove(
    "border-slate-300",
    "border-green-600",
    "border-red-500"
  );

  s.classList.remove("text-slate-400", "text-green-600");

  if (look === "done") {
    b.classList.add("border-green-600");
    s.classList.add("text-green-600");
  } else if (look === "problem") {
    b.classList.add("border-red-500");
    s.classList.add("text-slate-400");
  } else {
    b.classList.add("border-slate-300");
    s.classList.add("text-slate-400");
  }

  s.textContent = text;
}

function hookFileOption(btnId, fileId, statusId, errId, onFile) {
  byId(btnId).addEventListener("click", function () {
    byId(fileId).click();
  });

  byId(fileId).addEventListener("change", function () {
    var file = this.files[0];

    byId("identityError").textContent = "";
    byId("kycStatus").textContent = "";

    if (!file) return;

    var m = checkFile(file, false);
    byId(errId).textContent = m;

    if (m !== "") {
      this.value = "";
      onFile(null);
      setOptionLook(btnId, statusId, "problem", "Upload");
      return;
    }

    onFile(file);
    setOptionLook(btnId, statusId, "done", "✓ Added");
  });
}

hookFileOption(
  "idButton",
  "idFile",
  "idStatus",
  "idFileError",
  function (f) {
    idFileObj = f;
    idFileName = f ? f.name : "";
  }
);

hookFileOption(
  "selfieButton",
  "selfieFile",
  "selfieStatus",
  "selfieFileError",
  function (f) {
    selfieFileObj = f;
    selfieFileName = f ? f.name : "";
  }
);

byId("addressButton").addEventListener("click", function () {
  byId("addressBox").classList.toggle("hidden");
  byId("address").focus();
});

byId("address").addEventListener("input", function () {
  var m = checkAddress(this.value);

  showError("address", m);
  byId("identityError").textContent = "";

  if (m === "" && this.value.trim() !== "") {
    addressText = this.value.trim();
    setOptionLook("addressButton", "addressStatus", "done", "✓ Added");
  } else {
    addressText = "";
    setOptionLook("addressButton", "addressStatus", "", "Add");
  }
});

function resetIdentityScreen() {
  idFileObj = null;
  selfieFileObj = null;
  idFileName = "";
  selfieFileName = "";
  addressText = "";
  kycBusy = false;

  byId("idFile").value = "";
  byId("selfieFile").value = "";
  byId("documentType").value = "";
  byId("documentNumber").value = "";
  byId("address").value = "";

  byId("idFileError").textContent = "";
  byId("selfieFileError").textContent = "";
  showError("documentType", "");
  showError("documentNumber", "");

  showError("address", "");

  byId("identityError").textContent = "";
  byId("kycStatus").textContent = "";
  byId("addressBox").classList.add("hidden");

  byId("identityContinue").disabled = false;
  byId("identityContinue").textContent = "Continue";

  setOptionLook("idButton", "idStatus", "", "Upload");
  setOptionLook("selfieButton", "selfieStatus", "", "Upload");
  setOptionLook("addressButton", "addressStatus", "", "Add");
}

function finishIdentity() {
  var saved = getUsers()[currentEmail];

  if (!saved) {
    byId("identityError").textContent =
      "Your account could not be found. Please log in again.";
    return;
  }

  updateCurrentUser({
    idFileName: idFileName,
    selfieFileName: selfieFileName,
    address: addressText,
    kycSubmitted: true,
    kycSubmittedAt: new Date().toISOString(),
    kycVerified: false,
    kycStatus: "under_review"
  });

  if (kycRole === "owner") {
    updateCurrentUser({ finishedSetup: true });
    openEquipmentScreen(true);
  } else {
    showScreen("categoriesScreen");
  }
}

function fileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      resolve(reader.result);
    };
    reader.onerror = function () {
      reject(new Error("A selected document could not be read."));
    };
    reader.readAsDataURL(file);
  });
}

byId("identityContinue").addEventListener("click", async function () {
  if (kycBusy) return;

  var addressMessage = checkAddress(byId("address").value);
  var documentType = byId("documentType").value;
  var documentNumber = byId("documentNumber").value.trim();

  showError("documentType", documentType ? "" : "Select your government ID type.");
  showError("documentNumber", documentNumber ? "" : "Enter the number shown on your ID.");

  if (!documentType) {
    byId("documentType").focus();
    return;
  }

  if (!documentNumber) {
    byId("documentNumber").focus();
    return;
  }

  if (addressMessage !== "") {
    byId("addressBox").classList.remove("hidden");
    showError("address", addressMessage);
    byId("address").focus();
    return;
  }

  if (!idFileObj) {
    byId("identityError").textContent =
      "Upload your government ID to continue.";
    return;
  }

  if (!selfieFileObj) {
    byId("identityError").textContent =
      "Upload your selfie to continue.";
    return;
  }

  byId("identityError").textContent = "";
  byId("identityContinue").disabled = true;
  byId("identityContinue").textContent = "Submitting...";
  byId("kycStatus").textContent = "Submitting your documents securely...";
  kycBusy = true;

  try {
    var files = await Promise.all([
      fileAsDataUrl(idFileObj),
      fileAsDataUrl(selfieFileObj)
    ]);

    await apiRequest("/kyc", {
      method: "POST",
      body: JSON.stringify({
        documentType: documentType,
        documentNumber: documentNumber,
        documentUrl: files[0],
        selfieUrl: files[1],
        address: byId("address").value.trim()
      })
    });

    finishIdentity();
  } catch (error) {
    byId("identityError").textContent = error.message;
    byId("kycStatus").textContent = "";
  } finally {
    kycBusy = false;
    byId("identityContinue").disabled = false;
    byId("identityContinue").textContent = "Verify and continue";
  }
});

/* ---------- 8. RENTER: CATEGORIES ---------- */
var categoryButtons = document.querySelectorAll(".category");

function prepareCategoriesScreen() {
  byId("categoryError").textContent = "";

  categoryButtons.forEach(function (b) {
    var on =
      selectedCategories.indexOf(b.getAttribute("data-name")) !== -1;

    b.classList.toggle("border-blue-600", on);
    b.classList.toggle("bg-blue-50", on);
    b.classList.toggle("border-slate-200", !on);
    b.classList.toggle("bg-white", !on);
  });
}

categoryButtons.forEach(function (b) {
  b.addEventListener("click", function () {
    var name = b.getAttribute("data-name");
    var pos = selectedCategories.indexOf(name);

    if (pos !== -1) {
      selectedCategories.splice(pos, 1);
    } else if (selectedCategories.length >= 2) {
      byId("categoryError").textContent =
        "You can pick up to two categories. Un-select one to choose another.";
      return;
    } else {
      selectedCategories.push(name);
    }

    prepareCategoriesScreen();
  });
});

byId("categoryContinue").addEventListener("click", function () {
  if (selectedCategories.length === 0) {
    byId("categoryError").textContent =
      "Select at least one category to continue, or tap Skip for now.";
    return;
  }

  updateCurrentUser({ categories: selectedCategories.slice() });
  showScreen("reviewScreen");
});

var categorySkip = byId("categorySkip");
if (categorySkip) {
  categorySkip.addEventListener("click", function () {
    showScreen("reviewScreen");
  });
}

/* ---------- 9. RENTER: REVIEW + DONE ---------- */
function reviewRow(label, value) {
  return (
    '<div class="py-3 border-b border-slate-200 last:border-b-0">' +
    '<small class="block text-xs text-slate-500 mb-1">' +
    label +
    "</small>" +
    '<strong class="text-sm">' +
    value +
    "</strong></div>"
  );
}

function fillReviewScreen() {
  var u = getCurrentUser();

  if (!u) {
    showScreen("welcomeScreen");
    return;
  }

  byId("reviewBox").innerHTML =
    reviewRow("First Name", makeSafe(u.firstName)) +
    reviewRow("Last Name", makeSafe(u.lastName)) +
    reviewRow("Email Address", makeSafe(u.email)) +
    reviewRow("Phone Number", makeSafe(u.phone)) +
    reviewRow(
      "Identity Documents",
      (u.kycSubmitted ? "Documents submitted" : "Documents pending") +
      " · " +
      (u.kycVerified ? "Verified" : "Not verified")
    ) +
    reviewRow(
      "Interests",
      makeSafe(
        selectedCategories.length
          ? selectedCategories.join(", ")
          : "None selected"
      )
    );
}

function finishSetup() {
  updateCurrentUser({ finishedSetup: true });
  setSession(currentEmail);
  showScreen("doneScreen");
}

byId("reviewComplete").addEventListener("click", finishSetup);
var reviewSkip = byId("reviewSkip");
if (reviewSkip) reviewSkip.addEventListener("click", finishSetup);

/* ---------- 10. OWNER SIGN UP ---------- */
var ownerFields = [
  "oFirstName",
  "oLastName",
  "oEmail",
  "oPhone",
  "oPassword",
  "oConfirmPassword"
];

function validateOwnerField(id) {
  var m = "";

  if (id === "oFirstName") {
    m = checkName(byId(id).value, "first name");
  } else if (id === "oLastName") {
    m = checkName(byId(id).value, "last name");
  } else if (id === "oEmail") {
    m = checkEmail(byId(id).value);
  } else if (id === "oPhone") {
    m = checkPhone(byId(id).value);
  } else if (id === "oPassword") {
    m = checkNewPassword(byId(id).value);
  } else if (id === "oConfirmPassword") {
    m = checkConfirmPassword(
      byId(id).value,
      byId("oPassword").value
    );
  }

  return showError(id, m);
}

ownerFields.forEach(function (id) {
  var box = byId(id);

  box.addEventListener("blur", function () {
    if (box.value !== "") validateOwnerField(id);
  });

  box.addEventListener("input", function () {
    if (box.classList.contains("border-red-500")) {
      validateOwnerField(id);
    }

    if (
      id === "oPassword" &&
      byId("oConfirmPassword").value !== ""
    ) {
      validateOwnerField("oConfirmPassword");
    }

    byId("ownerSignupFormError").textContent = "";
  });
});

byId("ownerSignupForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  var firstBad = "";

  ownerFields.forEach(function (id) {
    if (!validateOwnerField(id) && firstBad === "") {
      firstBad = id;
    }
  });

  if (firstBad) {
    byId(firstBad).focus();
    return;
  }

  var email = byId("oEmail").value.trim().toLowerCase();
  var firstName = byId("oFirstName").value.trim();
  var lastName = byId("oLastName").value.trim();
  var password = byId("oPassword").value;
  var submitButton = byId("ownerSignupForm").querySelector('[type="submit"]');
  submitButton.disabled = true;

  try {
    await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: firstName + " " + lastName,
        firstName: firstName,
        lastName: lastName,
        businessName: byId("oBusiness").value.trim(),
        email: email,
        phone: byId("oPhone").value.trim(),
        role: "owner",
        password: password
      })
    });

    var loginResult = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email, password: password })
    });
    cacheAuthenticatedUser(loginResult.user, loginResult.token);
    byId("ownerSignupForm").reset();
    openIdentityScreen("owner");
  } catch (error) {
    byId("ownerSignupFormError").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

/* ---------- 11. OWNER: ADD EQUIPMENT ---------- */
var firstTimeSetup = false;
var eqImageData = "";

function openEquipmentScreen(isFirstTime) {
  firstTimeSetup = isFirstTime;

  byId("equipmentForm").reset();
  eqImageData = "";

  byId("eqImagePreview").classList.add("hidden");
  byId("eqImagePreview").removeAttribute("src");
  byId("eqImagePlaceholder").classList.remove("hidden");
  byId("eqFormError").textContent = "";

  [
    "eqImage",
    "eqName",
    "eqCategory",
    "eqCondition",
    "eqPrice",
    "eqLocation",
    "eqSpecs"
  ].forEach(function (id) {
    showError(id, "");
  });

  byId("equipmentStepper").classList.toggle(
    "hidden",
    !isFirstTime
  );

  showScreen("equipmentScreen");
}

byId("ownerAddButton").addEventListener("click", function () {
  openEquipmentScreen(false);
});

var equipmentSkip = byId("equipmentSkip");
if (equipmentSkip) {
  equipmentSkip.addEventListener("click", function () {
    showScreen("ownerDashboardScreen");
  });
}

byId("eqImageButton").addEventListener("click", function () {
  byId("eqImageFile").click();
});

byId("eqImageFile").addEventListener("change", function () {
  var file = this.files[0];

  if (!file) return;

  var m = checkFile(file, false);
  byId("eqImageError").textContent = m;

  if (m !== "") {
    this.value = "";
    return;
  }

  var reader = new FileReader();

  reader.onload = function () {
    var img = new Image();

    img.onload = function () {
      var max = 640;
      var scale = Math.min(
        1,
        max / Math.max(img.width, img.height)
      );

      var canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      canvas
        .getContext("2d")
        .drawImage(img, 0, 0, canvas.width, canvas.height);

      eqImageData = canvas.toDataURL("image/jpeg", 0.7);

      byId("eqImagePreview").src = eqImageData;
      byId("eqImagePreview").classList.remove("hidden");
      byId("eqImagePlaceholder").classList.add("hidden");
    };

    img.onerror = function () {
      byId("eqImageError").textContent =
        "That image could not be read.";
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
});

byId("equipmentForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  var name = byId("eqName").value.trim();
  var category = byId("eqCategory").value;
  var condition = byId("eqCondition").value;
  var price = Number(byId("eqPrice").value);
  var location = byId("eqLocation").value.trim();

  var specs = byId("eqSpecs").value
    .split("\n")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);

  var results = [
    showError("eqName", name.length < 3 ? "Enter the equipment name." : ""),
    showError("eqCategory", category === "" ? "Select a category." : ""),
    showError("eqCondition", condition === "" ? "Select the condition." : ""),
    showError("eqPrice", !(price > 0) ? "Enter a price greater than 0." : ""),
    showError("eqLocation", location === "" ? "Enter a location." : ""),
    showError("eqSpecs", specs.length === 0 ? "Add at least one specification." : "")
  ];

  if (results.indexOf(false) !== -1) return;

  var submitButton = byId("equipmentForm").querySelector('[type="submit"]');
  submitButton.disabled = true;
  byId("eqFormError").textContent = "";

  try {
    var result = await apiRequest("/equipment", {
      method: "POST",
      body: JSON.stringify({
        title: name,
        category: category,
        condition: condition,
        price: price,
        location: location,
        specs: specs,
        description: byId("eqDescription").value.trim(),
        image: eqImageData
      })
    });

    var listings = getListings();
    listings.push({
      id: result.equipment._id,
      ownerEmail: currentEmail,
      name: name,
      category: category,
      condition: condition,
      price: price,
      location: location,
      specs: specs,
      description: byId("eqDescription").value.trim(),
      image: eqImageData
    });
    saveListings(listings);
    showScreen("ownerDashboardScreen");
    showToast("Equipment saved");
  } catch (error) {
    byId("eqFormError").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

/* ---------- 12. LISTING CARDS ---------- */
function listingCard(l, deleteLabel) {
  var thumb = l.image
    ? '<img src="' +
      l.image +
      '" alt="" class="h-16 w-16 shrink-0 rounded-lg object-cover">'
    : '<div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">📦</div>';

  return (
    '<article class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 mb-2.5">' +
    thumb +
    '<div class="min-w-0 flex-1">' +
    '<h3 class="truncate text-sm font-semibold">' +
    makeSafe(l.name) +
    "</h3>" +
    '<p class="truncate text-xs text-slate-500">' +
    makeSafe(l.category) +
    " · " +
    makeSafe(l.condition) +
    " · " +
    makeSafe(l.location) +
    "</p>" +
    '<p class="text-sm font-bold text-[#1f4e79]">' +
    naira(l.price) +
    " / day</p>" +
    "</div>" +
    (deleteLabel
      ? '<button type="button" class="delete-listing text-xs font-bold text-red-600 hover:underline" data-id="' +
        makeSafe(l.id) +
        '">' +
        deleteLabel +
        "</button>"
      : "") +
    "</article>"
  );
}

document.addEventListener("click", function (e) {
  var del = e.target.closest(".delete-listing");

  if (del) {
    var id = del.getAttribute("data-id");

    saveListings(
      getListings().filter(function (l) {
        return l.id !== id;
      })
    );

    if (getCurrentUser() && getCurrentUser().role === "admin") {
      fillAdminDashboard();
    } else {
      fillOwnerDashboard();
    }

    return;
  }

  var delUser = e.target.closest(".delete-user");

  if (delUser) {
    var email = delUser.getAttribute("data-email");
    var users = getUsers();

    delete users[email];
    saveUsers(users);

    saveListings(
      getListings().filter(function (l) {
        return l.ownerEmail !== email;
      })
    );

    fillAdminDashboard();
  }
});

/* ---------- 13. OWNER DASHBOARD ---------- */
function fillOwnerDashboard() {
  var u = getCurrentUser();

  if (!u) {
    showScreen("welcomeScreen");
    return;
  }

  var mine = getListings().filter(function (l) {
    return l.ownerEmail === u.email;
  });

  var total = mine.reduce(function (sum, l) {
    return sum + l.price;
  }, 0);

  byId("ownerGreeting").textContent = "Hi, " + u.firstName;
  byId("ownerListingCount").textContent = mine.length;
  byId("ownerDailyValue").textContent = naira(total);

  byId("ownerListings").innerHTML = mine.length
    ? mine.map(function (l) {
        return listingCard(l, "Delete");
      }).join("")
    : '<p class="text-sm text-slate-500">You have no listings yet. Tap "Add equipment" to create one.</p>';
}

/* ---------- 14. ADMIN DASHBOARD ---------- */
function fillAdminDashboard() {
  var u = getCurrentUser();

  if (!u) {
    showScreen("welcomeScreen");
    return;
  }

  var users = getUsers();
  var list = Object.keys(users).map(function (k) {
    return users[k];
  });

  var listings = getListings();

  byId("adminGreeting").textContent = "Signed in as " + u.email;

  byId("adminRenterCount").textContent = list.filter(function (x) {
    return x.role === "renter";
  }).length;

  byId("adminOwnerCount").textContent = list.filter(function (x) {
    return x.role === "owner";
  }).length;

  byId("adminListingCount").textContent = listings.length;

  byId("adminUsers").innerHTML = list.map(function (x) {
    return (
      '<div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 mb-2">' +
      '<div><strong class="text-sm">' +
      makeSafe(x.firstName + " " + x.lastName) +
      "</strong>" +
      '<p class="text-xs text-slate-500">' +
      makeSafe(x.email) +
      " · " +
      makeSafe(x.role) +
      "</p></div>" +
      (x.role === "admin"
        ? ""
        : '<button type="button" class="delete-user text-xs font-bold text-red-600 hover:underline" data-email="' +
          makeSafe(x.email) +
          '">Remove</button>') +
      "</div>"
    );
  }).join("");

  byId("adminListings").innerHTML = listings.length
    ? listings.map(function (l) {
        return listingCard(l, "Delete");
      }).join("")
    : '<p class="text-sm text-slate-500">No listings yet.</p>';
}

/* ---------- 15. RENTER HOME ---------- */
function fillHome() {
  var u = getCurrentUser();

  if (!u) {
    showScreen("welcomeScreen");
    return;
  }

  var hour = new Date().getHours();

  var part =
    hour < 12
      ? "Good morning"
      : hour < 17
      ? "Good afternoon"
      : "Good evening";

  byId("homeGreeting").textContent =
    part + ", " + u.firstName + " 👋";

  byId("dashAvatar").textContent =
    u.firstName.charAt(0).toUpperCase();

  byId("homeInterests").textContent =
    u.categories && u.categories.length
      ? "Your interests: " + u.categories.join(", ")
      : "Here's your rental activity at a glance.";

  renderHomeListings();
}

function renderHomeListings() {
  var u = getCurrentUser();
  var q = byId("searchInput").value.trim().toLowerCase();
  var interests = (u && u.categories) || [];

  var items = getListings().filter(function (l) {
    return (
      q === "" ||
      (l.name + " " + l.category + " " + l.location)
        .toLowerCase()
        .indexOf(q) !== -1
    );
  });

  items.sort(function (a, b) {
    return (
      (interests.indexOf(b.category) !== -1) -
      (interests.indexOf(a.category) !== -1)
    );
  });

  byId("homeListings").innerHTML = items.length
    ? items.map(function (l) {
        return listingCard(l, "");
      }).join("")
    : '<p class="text-sm text-slate-500">' +
      (q
        ? "No equipment matches your search."
        : "No equipment has been listed yet.") +
      "</p>";
}

byId("searchInput").addEventListener("input", renderHomeListings);

/* ---------- 16. HOME: SIDEBAR AND SMALL BUTTONS ---------- */
function openSidebar() {
  byId("sidebar").classList.remove("-translate-x-full");
  byId("sidebarOverlay").classList.remove("hidden");
}

function closeSidebar() {
  byId("sidebar").classList.add("-translate-x-full");
  byId("sidebarOverlay").classList.add("hidden");
}

byId("menuBtn").addEventListener("click", openSidebar);
byId("sidebarOverlay").addEventListener("click", closeSidebar);

document.querySelectorAll("[data-section]").forEach(function (b) {
  b.addEventListener("click", function () {
    var section = b.getAttribute("data-section");

    closeSidebar();

    if (section === "Dispute") {
      window.location.href = "dispute.html";
      return;
    }

    if (section !== "Dashboard") {
      showToast(section + " is coming soon");
    }
  });
});

document.querySelectorAll(".view-all").forEach(function (b) {
  b.addEventListener("click", function () {
    showToast("Coming soon!");
  });
});

byId("profileButton").addEventListener("click", function () {
  showToast("Profile is coming soon");
});

byId("learnMore").addEventListener("click", function () {
  showToast("Verified owners, secure payments and deposit safety.");
});

byId("markRead").addEventListener("click", function () {
  document.querySelectorAll(".unread").forEach(function (n) {
    n.classList.remove("unread", "bg-[#eef5fb]");

    var badge = n.querySelector(".new-badge");
    if (badge) badge.remove();
  });
});

/* ---------- 17. START ---------- */
(function startApp() {
  removeCachedPasswords();

  var email = getSession();
  var user = email ? getUsers()[email] : null;
  var token = getAuthToken();

  if (user && token) {
    currentEmail = email;
    apiRequest("/auth/me").then(async function () {
      await refreshKycStatus();
      user = getCurrentUser();
      if (!resumeSetup(user)) goToDashboard(user);
    }).catch(function () {
      clearSession();
      setAuthToken("");
      currentEmail = "";
      showScreen("welcomeScreen");
    });
    return;
  }

  showScreen("welcomeScreen");
})();