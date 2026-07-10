const DEFAULT_CONFIG = {
  apiEndpoint: "https://api.eskyna-style.workers.dev/v1/images",
  demoMode: false,
  uploadMode: "binary",
  contentType: "application/octet-stream",
  credentials: "same-origin",
  maxUploadWidth: 1600,
  jpegQuality: 0.88,
  timeoutMs: 60000,
  maxPhotos: 4,
  multiPhotoUploadMode: "multipart",
  push: {
    enabled: true,
    provider: "firebase-cloud-messaging",
    fcmVapidKey: "",
    tokenStorage: "firestore",
    fcmTokensCollection: "fcmTokens",
    registerTokenEndpoint: "",
    unregisterTokenEndpoint: "",
    topic: "patchnotes",
    attachIdTokenToRegisterRequest: true,
  },
  auth: {
    enabled: true,
    required: true,
    provider: "firebase",
    firebaseSdkVersion: "12.15.0",
    allowedProviders: ["google"],
    signInMode: "popup",
    redirectAfterLogin: "create",
    attachIdTokenToAnalysisRequest: false,
    firebaseConfig: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      appId: "",
    },
  },
};

const CONFIG = mergeConfig(DEFAULT_CONFIG, window.ESKYNA_CONFIG || {});
const STORAGE_KEYS = {
  authUser: "eskyna:authUser",
  authReturnRoute: "eskyna:authReturnRoute",
  analysis: "eskyna:lastAnalysis",
  pushSubscription: "eskyna:pushSubscription",
  fcmToken: "eskyna:fcmToken",
};
const PROTECTED_ROUTES = new Set(["create", "camera", "result"]);

const SAMPLE_ANALYSIS = {
  colorType: "SANFT- KALT",
  baseColors: [
    { name: "Navy", hex: "#00203d" },
    { name: "Mauve Brown", hex: "#645055" },
    { name: "Slate", hex: "#6d7a86" },
    { name: "Cool Grey", hex: "#7d878a" },
    { name: "Soft Lilac Grey", hex: "#a99aa8" },
    { name: "Mist", hex: "#aebbc1" },
  ],
  accentColors: [
    { name: "Blue", hex: "#2e5fa8" },
    { name: "Periwinkle", hex: "#7ea0d8" },
    { name: "Petrol", hex: "#1d7769" },
    { name: "Berry", hex: "#a14276" },
    { name: "Raspberry", hex: "#dd3158" },
    { name: "Rose", hex: "#ed839e" },
  ],
  noGoColors: [
    { name: "Tomate", hex: "#dc4744" },
    { name: "Orange", hex: "#f57100" },
    { name: "Eigelb", hex: "#ffbc0a" },
    { name: "Senf", hex: "#a58408" },
  ],
  noGoText: "Eigelb, Tomate, Orange, Senf - sie lassen dein Teint müde und gelblich wirken.",
};

const state = {
  view: "welcome",
  cameraStream: null,
  facingMode: "user",
  selectedPhotoBlob: null,
  selectedPhotoDataUrl: "",
  selectedPhotoName: "",
  photos: [],
  activePhotoIndex: -1,
  analysisTimer: null,
  analysisStartedAt: 0,
  latestAnalysis: null,
  latestRaw: null,
  deferredInstallPrompt: null,
  serviceWorkerRegistration: null,
  waitingServiceWorker: null,
  updateRefreshing: false,
  updateBannerDismissed: false,
  returnRoute: CONFIG.auth?.redirectAfterLogin || "create",
  lastStartAt: 0,
  push: {
    status: "idle",
    subscription: null,
    token: "",
    messaging: null,
    messagingModule: null,
    firestore: null,
    firestoreModule: null,
    foregroundListenerReady: false,
    error: "",
  },
  auth: {
    status: "idle",
    user: null,
    idToken: "",
    error: "",
    initPromise: null,
    firebase: null,
  },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  views: $$(".view"),
  authStatus: $("#authStatus"),
  loginButtons: $$("[data-provider]"),
  startButton: $("#startButton"),
  menuOverlay: $("#menuOverlay"),
  menuUser: $("#menuUser"),
  menuUserAvatar: $("#menuUserAvatar"),
  menuUserName: $("#menuUserName"),
  menuUserEmail: $("#menuUserEmail"),
  logoutButton: $("#logoutButton"),
  installButton: $("#installButton"),
  installButtons: $$('[data-action="install-app"]'),
  toast: $("#toast"),
  updateBanner: $("#updateBanner"),
  avatarImages: $$(".avatar-button img"),
  cameraVideo: $("#cameraVideo"),
  cameraCard: $("#cameraCard"),
  cameraEmpty: $("#cameraEmpty"),
  captureCanvas: $("#captureCanvas"),
  photoPreview: $("#photoPreview"),
  fileInput: $("#fileInput"),
  cameraActions: $("#cameraActions"),
  reviewActions: $("#reviewActions"),
  photoTray: $("#photoTray"),
  photoThumbs: $("#photoThumbs"),
  photoCount: $("#photoCount"),
  cameraMessage: $("#cameraMessage"),
  resultPortrait: $("#resultPortrait"),
  colorTypeText: $("#colorTypeText"),
  baseColors: $("#baseColors"),
  accentColors: $("#accentColors"),
  noGoColors: $("#noGoColors"),
  noGoText: $("#noGoText"),
  rawResponse: $("#rawResponse"),
  rawJson: $("#rawJson"),
  resultInfoButton: $("#resultInfoButton"),
  detectionSheet: $("#detectionSheet"),
  detectionDetailsList: $("#detectionDetailsList"),
  detectionRawJson: $("#detectionRawJson"),
  analysisOverlay: $("#analysisOverlay"),
  analysisElapsed: $("#analysisElapsed"),
  analysisPhotoCount: $("#analysisPhotoCount"),
  pushButton: $("#pushButton"),
  pushStatus: $("#pushStatus"),
};

init();

function init() {
  restoreUserState();
  bindEvents();
  renderAuthState();
  updateInstallButtons();
  updatePhotoUI();
  renderResult(state.latestAnalysis, state.latestRaw);
  registerServiceWorker();
  refreshPushState().catch(() => undefined);

  const initialRoute = sanitizeRoute(location.hash.replace("#", "")) || "welcome";
  state.returnRoute = PROTECTED_ROUTES.has(initialRoute)
    ? initialRoute
    : CONFIG.auth?.redirectAfterLogin || "create";
  navigate(initialRoute, { replace: true, silent: true });
  initAuth().catch((error) => {
    console.error(error);
    state.auth.status = "error";
    state.auth.error = authErrorMessage(error);
    renderAuthState();
  });
}

function bindEvents() {
  if (els.startButton) {
    const handleStartActivation = (event) => {
      event.preventDefault();
      event.stopPropagation();
      startApp();
    };
    els.startButton.addEventListener("click", handleStartActivation);
    els.startButton.addEventListener("touchend", handleStartActivation, { passive: false });
  }

  document.addEventListener("click", async (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      event.preventDefault();
      const route = routeButton.dataset.route;
      closeMenu();
      navigate(route);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    event.preventDefault();

    const action = actionButton.dataset.action;
    switch (action) {
      case "open-menu":
        openMenu();
        break;
      case "close-menu":
        closeMenu();
        break;
      case "start-camera":
        await startCamera();
        break;
      case "switch-camera":
        state.facingMode = state.facingMode === "user" ? "environment" : "user";
        await startCamera();
        break;
      case "capture-photo":
        await capturePhoto();
        break;
      case "pick-file":
        els.fileInput.click();
        break;
      case "retake-photo":
        await retakePhoto();
        break;
      case "add-photo":
        await addAnotherPhoto();
        break;
      case "remove-photo":
        removePhoto(Number(actionButton.dataset.photoIndex));
        break;
      case "select-photo":
        selectPhoto(Number(actionButton.dataset.photoIndex));
        break;
      case "send-photo":
        await sendPhotoForAnalysis(actionButton);
        break;
      case "login-google":
        await signInWithProvider("google", actionButton);
        break;
      case "logout":
        await signOutUser();
        break;
      case "style-question":
        showToast("Der KI-Stylist kann hier später mit deinem Chat-Endpunkt verbunden werden.");
        break;
      case "open-detection-details":
        openDetectionDetails();
        break;
      case "close-detection-details":
        closeDetectionDetails();
        break;
      case "install-app":
        await promptInstall();
        break;
      case "enable-push":
        await enablePushNotifications(actionButton);
        break;
      case "apply-update":
        applyAppUpdate();
        break;
      case "dismiss-update":
        dismissAppUpdate();
        break;
      default:
        break;
    }
  });

  els.fileInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    for (const file of files) {
      await handleFile(file);
    }
    event.target.value = "";
  });

  window.addEventListener("hashchange", () => {
    const route = sanitizeRoute(location.hash.replace("#", "")) || "welcome";
    navigate(route, { replace: true, silent: true });
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    showToast("EStyle wurde installiert.");
    updateInstallButtons();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopCamera();
    } else if (state.view === "camera" && !state.selectedPhotoBlob) {
      startCamera().catch(() => undefined);
    }
  });
}

function restoreUserState() {
  const storedUser = safeJsonParse(safeLocalStorageGet(STORAGE_KEYS.authUser));
  if (storedUser?.uid) {
    state.auth.user = storedUser;
    state.auth.status = "cached";
  }

  const storedReturnRoute = sanitizeRoute(safeSessionStorageGet(STORAGE_KEYS.authReturnRoute));
  if (storedReturnRoute) state.returnRoute = storedReturnRoute;

  const storedAnalysis = safeJsonParse(safeLocalStorageGet(STORAGE_KEYS.analysis));
  if (storedAnalysis?.analysis) {
    state.latestAnalysis = storedAnalysis.analysis;
    state.latestRaw = storedAnalysis.raw || storedAnalysis.analysis;
  }

  const storedFcmToken = safeLocalStorageGet(STORAGE_KEYS.fcmToken);
  if (storedFcmToken) {
    state.push.token = storedFcmToken;
    state.push.status = "subscribed";
  } else {
    const storedPushSubscription = safeJsonParse(
      safeLocalStorageGet(STORAGE_KEYS.pushSubscription)
    );
    if (storedPushSubscription?.endpoint) {
      safeLocalStorageRemove(STORAGE_KEYS.pushSubscription);
    }
  }
}

function sanitizeRoute(route) {
  const allowed = new Set(["welcome", "login", "create", "camera", "result"]);
  return allowed.has(route) ? route : "";
}

function startApp() {
  const now = Date.now();
  if (now - state.lastStartAt < 600) return;
  state.lastStartAt = now;

  const targetRoute = CONFIG.auth?.redirectAfterLogin || "create";
  state.returnRoute = sanitizeRoute(targetRoute) || "create";
  safeSessionStorageSet(STORAGE_KEYS.authReturnRoute, state.returnRoute);

  if (!authIsEnabled() || isAuthenticated()) {
    navigate(state.returnRoute);
    return;
  }

  navigate("login");
}

function navigate(route, options = {}) {
  let nextRoute = sanitizeRoute(route) || "welcome";
  const { replace = false, silent = false } = options;

  if (authRequiredFor(nextRoute) && !isAuthenticated()) {
    state.returnRoute = nextRoute;
    safeSessionStorageSet(STORAGE_KEYS.authReturnRoute, nextRoute);
    nextRoute = "login";
  } else if (nextRoute === "login" && isAuthenticated()) {
    nextRoute = sanitizeRoute(state.returnRoute) || CONFIG.auth?.redirectAfterLogin || "create";
  }

  if (state.view === "camera" && nextRoute !== "camera") stopCamera();

  state.view = nextRoute;
  els.views.forEach((view) => {
    view.classList.toggle("is-active", view.id === `view-${nextRoute}`);
  });

  if (!silent) {
    const hash = `#${nextRoute}`;
    if (replace) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
  }

  if (nextRoute === "camera") {
    prepareCameraView();
    if (!state.selectedPhotoBlob && state.photos.length === 0) {
      startCamera().catch(() => undefined);
    }
  }
  if (nextRoute === "result") {
    renderResult(state.latestAnalysis, state.latestRaw);
  }
}

function authIsEnabled() {
  return CONFIG.auth?.enabled !== false;
}

function authRequiredFor(route) {
  return authIsEnabled() && CONFIG.auth?.required !== false && PROTECTED_ROUTES.has(route);
}

function isAuthenticated() {
  return Boolean(state.auth.user?.uid);
}

async function initAuth() {
  if (!authIsEnabled()) {
    state.auth.status = "disabled";
    renderAuthState();
    return;
  }

  if ((CONFIG.auth?.provider || "firebase") !== "firebase") {
    state.auth.status = "error";
    state.auth.error = "Der konfigurierte Auth-Provider wird von dieser PWA nicht unterstützt.";
    renderAuthState();
    return;
  }

  if (!hasFirebaseConfig()) {
    state.auth.status = "missing-config";
    state.auth.error = "Firebase-Konfiguration fehlt. Bitte in config.js eintragen.";
    renderAuthState();
    return;
  }

  state.auth.status = state.auth.user ? "cached" : "initializing";
  state.auth.error = "";
  renderAuthState();

  state.auth.initPromise = setupFirebaseAuth();
  await state.auth.initPromise;
}

async function setupFirebaseAuth() {
  if (state.auth.firebase?.auth && state.auth.firebase?.authModule) return state.auth.firebase;

  const sdkVersion = CONFIG.auth?.firebaseSdkVersion || DEFAULT_CONFIG.auth.firebaseSdkVersion;
  const baseUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(sdkVersion)}`;

  const [appModule, authModule] = await Promise.all([
    import(`${baseUrl}/firebase-app.js`),
    import(`${baseUrl}/firebase-auth.js`),
  ]);

  const app = appModule.getApps?.().length
    ? appModule.getApp()
    : appModule.initializeApp(getFirebaseConfig());
  const auth = authModule.getAuth(app);
  auth.languageCode = "de";

  if (authModule.browserLocalPersistence && authModule.setPersistence) {
    await authModule
      .setPersistence(auth, authModule.browserLocalPersistence)
      .catch(() => undefined);
  }

  state.auth.firebase = { app, appModule, auth, authModule };
  state.auth.status = state.auth.user ? "cached" : "checking-session";
  state.auth.error = "";
  renderAuthState();

  try {
    const redirectResult = await authModule.getRedirectResult(auth);
    if (redirectResult?.user) {
      await handleAuthenticatedFirebaseUser(redirectResult.user, { source: "redirect" });
    } else if (auth.currentUser) {
      await handleAuthenticatedFirebaseUser(auth.currentUser, { source: "currentUser" });
    }
  } catch (error) {
    console.error(error);
    state.auth.error = authErrorMessage(error);
    showToast(state.auth.error);
  }

  await new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    authModule.onAuthStateChanged(
      auth,
      async (user) => {
        try {
          if (user) {
            await handleAuthenticatedFirebaseUser(user, { source: "state" });
          } else if (!state.auth.user?.uid) {
            clearAuthUser();
            state.auth.status = "signed-out";
            renderAuthState();
            if (authRequiredFor(state.view)) navigate("login", { replace: true });
          }
        } finally {
          finish();
        }
      },
      (error) => {
        console.error(error);
        state.auth.status = "error";
        state.auth.error = authErrorMessage(error);
        renderAuthState();
        finish();
      }
    );

    window.setTimeout(finish, 3500);
  });

  return state.auth.firebase;
}

async function handleAuthenticatedFirebaseUser(user, options = {}) {
  await applyFirebaseUser(user);
  const targetRoute = getPostLoginRoute();
  safeSessionStorageRemove(STORAGE_KEYS.authReturnRoute);
  updatePushUI();

  if (
    state.view === "login" ||
    authRequiredFor(state.view) ||
    options.forceNavigation ||
    options.source === "redirect"
  ) {
    navigate(targetRoute, { replace: true });
  }
}

function getPostLoginRoute() {
  const storedRoute = sanitizeRoute(safeSessionStorageGet(STORAGE_KEYS.authReturnRoute));
  const stateRoute = sanitizeRoute(state.returnRoute);
  const configuredRoute = sanitizeRoute(CONFIG.auth?.redirectAfterLogin) || "create";
  const targetRoute = storedRoute || stateRoute || configuredRoute;
  return targetRoute === "login" || targetRoute === "welcome" ? configuredRoute : targetRoute;
}

async function applyFirebaseUser(user) {
  const normalized = normalizeFirebaseUser(user);
  state.auth.user = normalized;
  state.auth.status = "authenticated";
  state.auth.error = "";
  state.auth.idToken = await user.getIdToken().catch(() => "");
  safeLocalStorageSet(STORAGE_KEYS.authUser, JSON.stringify(normalized));
  renderAuthState();
}

function normalizeFirebaseUser(user) {
  const providerData = Array.isArray(user.providerData) ? user.providerData : [];
  const providerId = providerData[0]?.providerId || "";
  const email = user.email || providerData.find((item) => item.email)?.email || "";
  return {
    uid: user.uid,
    displayName:
      user.displayName ||
      providerData.find((item) => item.displayName)?.displayName ||
      email.split("@")[0] ||
      "EStyle Nutzerin",
    email,
    photoURL: user.photoURL || providerData.find((item) => item.photoURL)?.photoURL || "",
    providerId,
    signedInAt: new Date().toISOString(),
  };
}

async function signInWithProvider(providerName, button) {
  if (!authIsEnabled()) {
    navigate(CONFIG.auth?.redirectAfterLogin || "create");
    return;
  }

  const allowedProviders = CONFIG.auth?.allowedProviders || DEFAULT_CONFIG.auth.allowedProviders;
  if (!allowedProviders.includes(providerName)) {
    showToast("Dieser Login-Anbieter ist deaktiviert.");
    return;
  }

  if (!hasFirebaseConfig()) {
    state.auth.status = "missing-config";
    state.auth.error = "Firebase-Konfiguration fehlt. Bitte zuerst config.js ausfüllen.";
    renderAuthState();
    showToast(state.auth.error);
    return;
  }

  const returnRoute = getPostLoginRoute();
  safeSessionStorageSet(STORAGE_KEYS.authReturnRoute, returnRoute);
  state.returnRoute = returnRoute;
  state.auth.status = "signing-in";
  state.auth.error = "";
  renderAuthState();

  setBusy(button, true, "Google öffnen...");
  try {
    if (!state.auth.firebase) {
      if (!state.auth.initPromise) state.auth.initPromise = setupFirebaseAuth();
      await state.auth.initPromise;
    }

    const { auth, authModule } = state.auth.firebase;
    const provider = createFirebaseProvider(providerName, authModule);
    const signInMode = CONFIG.auth?.signInMode || DEFAULT_CONFIG.auth.signInMode || "popup";

    if (signInMode !== "redirect" && authModule.signInWithPopup) {
      try {
        const popupResult = await authModule.signInWithPopup(auth, provider);
        const user = popupResult?.user || auth.currentUser;
        if (!user)
          throw new Error(
            "Google Login wurde abgeschlossen, aber Firebase hat keinen Nutzer zurückgegeben."
          );
        await handleAuthenticatedFirebaseUser(user, { source: "popup", forceNavigation: true });
        setBusy(button, false);
        return;
      } catch (popupError) {
        if (!shouldFallbackToRedirect(popupError)) throw popupError;
        console.warn("Popup-Login nicht möglich, fallback auf Redirect:", popupError);
      }
    }

    setBusy(button, true, "Weiterleitung...");
    await authModule.signInWithRedirect(auth, provider);
  } catch (error) {
    console.error(error);
    state.auth.status = "error";
    state.auth.error = authErrorMessage(error);
    renderAuthState();
    showToast(state.auth.error);
    setBusy(button, false);
  }
}

function shouldFallbackToRedirect(error) {
  const code = error?.code || "";
  return (
    code.includes("popup-blocked") ||
    code.includes("cancelled-popup-request") ||
    code.includes("operation-not-supported-in-this-environment") ||
    code.includes("web-storage-unsupported") ||
    code.includes("internal-error")
  );
}

function createFirebaseProvider(providerName, authModule) {
  if (providerName === "google") {
    const provider = new authModule.GoogleAuthProvider();
    provider.addScope("email");
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  throw new Error("Unbekannter Login-Anbieter.");
}

async function signOutUser() {
  closeMenu();
  try {
    if (state.auth.firebase?.authModule?.signOut) {
      await state.auth.firebase.authModule.signOut(state.auth.firebase.auth);
    }
  } catch (error) {
    console.error(error);
  }
  clearAuthUser();
  state.auth.status = "signed-out";
  renderAuthState();
  navigate("login", { replace: true });
}

function clearAuthUser() {
  state.auth.user = null;
  state.auth.idToken = "";
  safeLocalStorageRemove(STORAGE_KEYS.authUser);
}

async function getCurrentIdToken() {
  if (!authIsEnabled()) return "";
  if (state.auth.firebase?.auth?.currentUser) {
    state.auth.idToken = await state.auth.firebase.auth.currentUser
      .getIdToken()
      .catch(() => state.auth.idToken || "");
  }
  return state.auth.idToken || "";
}

function renderAuthState() {
  const allowedProviders = CONFIG.auth?.allowedProviders || DEFAULT_CONFIG.auth.allowedProviders;
  els.loginButtons.forEach((button) => {
    const provider = button.dataset.provider;
    button.hidden = !allowedProviders.includes(provider);
    button.disabled = ["initializing", "checking-session", "signing-in"].includes(
      state.auth.status
    );
  });

  const user = state.auth.user;
  document.body.classList.toggle("is-authenticated", Boolean(user));

  if (els.authStatus) {
    els.authStatus.classList.remove("error", "success");
    if (!authIsEnabled()) {
      els.authStatus.textContent = "Login ist aktuell deaktiviert.";
    } else if (state.auth.status === "initializing" || state.auth.status === "checking-session") {
      els.authStatus.textContent = "Anmeldung wird geprüft...";
    } else if (state.auth.status === "signing-in") {
      els.authStatus.textContent = "Google Login wird geöffnet...";
    } else if (state.auth.status === "missing-config") {
      els.authStatus.textContent = "Firebase Auth ist noch nicht konfiguriert.";
      els.authStatus.classList.add("error");
    } else if (state.auth.error) {
      els.authStatus.textContent = state.auth.error;
      els.authStatus.classList.add("error");
    } else if (user) {
      els.authStatus.textContent = `Angemeldet als ${user.displayName || user.email || "EStyle Nutzerin"}.`;
      els.authStatus.classList.add("success");
    } else {
      els.authStatus.textContent = "Bitte mit Google anmelden.";
    }
  }

  if (els.logoutButton) els.logoutButton.hidden = !user;
  if (els.menuUser) els.menuUser.hidden = !user;
  if (user) {
    const displayName = user.displayName || "EStyle Nutzerin";
    const email = user.email || providerLabel(user.providerId);
    const avatarSrc = user.photoURL || "assets/avatar.webp";
    if (els.menuUserName) els.menuUserName.textContent = displayName;
    if (els.menuUserEmail) els.menuUserEmail.textContent = email;
    if (els.menuUserAvatar) els.menuUserAvatar.src = avatarSrc;
    els.avatarImages.forEach((image) => {
      image.src = avatarSrc;
    });
  } else {
    if (els.menuUserAvatar) els.menuUserAvatar.src = "assets/avatar.webp";
    els.avatarImages.forEach((image) => {
      image.src = "assets/avatar.webp";
    });
  }
}

function hasFirebaseConfig() {
  const firebaseConfig = getFirebaseConfig();
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);
}

function getFirebaseConfig() {
  return CONFIG.auth?.firebaseConfig || CONFIG.auth?.firebase || CONFIG.firebase || {};
}

function providerLabel(providerId = "") {
  if (providerId.includes("google")) return "Google Login";
  return "Social Login";
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request"))
    return "Login wurde abgebrochen.";
  if (code.includes("configuration-not-found"))
    return "Firebase Authentication ist im Projekt noch nicht fertig eingerichtet. Bitte in Firebase unter Authentication > Get started den Anbieter Google aktivieren und eskyna.com als autorisierte Domain eintragen.";
  if (code.includes("unauthorized-domain"))
    return "Diese Domain ist in Firebase Authentication noch nicht freigeschaltet. Bitte eskyna.com unter Authorized domains eintragen.";
  if (code.includes("popup-blocked"))
    return "Das Google Login-Fenster wurde blockiert. Bitte Pop-ups für eskyna.com erlauben oder erneut versuchen.";
  if (code.includes("popup-closed-by-user")) return "Login wurde abgebrochen.";
  if (code.includes("network-request-failed"))
    return "Netzwerkfehler beim Login. Bitte erneut versuchen.";
  if (code.includes("operation-not-allowed"))
    return "Google Login ist in Firebase Authentication noch nicht aktiviert.";
  return error?.message || "Login fehlgeschlagen. Bitte erneut versuchen.";
}

function openMenu() {
  els.menuOverlay.hidden = false;
}

function closeMenu() {
  els.menuOverlay.hidden = true;
}

function prepareCameraView() {
  setCameraMessage("", "");
  if (state.selectedPhotoBlob) {
    showSelectedPhotoPreview();
  } else if (state.photos.length) {
    selectPhoto(state.photos.length - 1, { silent: true });
  } else {
    showCameraCaptureControls();
  }
  updatePhotoUI();
}

function showCameraCaptureControls() {
  if (els.cameraActions) els.cameraActions.hidden = false;
  if (els.reviewActions) els.reviewActions.hidden = true;
  if (els.photoPreview) {
    els.photoPreview.hidden = true;
    els.photoPreview.removeAttribute("src");
  }
  els.cameraCard?.classList.remove("has-photo");
}

function showSelectedPhotoPreview() {
  if (!state.selectedPhotoDataUrl) return;
  els.photoPreview.src = state.selectedPhotoDataUrl;
  els.photoPreview.hidden = false;
  els.cameraCard.classList.add("has-photo", "is-live");
  els.cameraActions.hidden = true;
  els.reviewActions.hidden = false;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMessage(
      "Dein Browser erlaubt keinen direkten Kamerazugriff. Bitte wähle ein Foto aus.",
      "error"
    );
    return;
  }

  clearSelectedPhoto(false);
  showCameraCaptureControls();
  stopCamera();
  setCameraMessage("Kamera wird gestartet...", "");

  try {
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: 1280 },
        height: { ideal: 1600 },
      },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraStream = stream;
    els.cameraVideo.srcObject = stream;
    els.cameraVideo.classList.toggle("is-front", state.facingMode === "user");
    await els.cameraVideo.play();
    els.cameraCard.classList.add("is-live");
    setCameraMessage(
      "Positioniere dein Gesicht mittig und blicke direkt in die Kamera.",
      "success"
    );
  } catch (error) {
    console.error(error);
    setCameraMessage(
      "Kamera konnte nicht gestartet werden. Prüfe die Berechtigung oder wähle ein Foto aus.",
      "error"
    );
  }
}

function stopCamera() {
  if (!state.cameraStream) return;
  state.cameraStream.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  if (els.cameraVideo) els.cameraVideo.srcObject = null;
  els.cameraCard?.classList.remove("is-live");
}

async function capturePhoto() {
  if (!state.cameraStream || !els.cameraVideo.videoWidth) {
    await startCamera();
    return;
  }

  const { blob, dataUrl } = await drawMediaToJpeg(els.cameraVideo);
  if (setCapturedPhoto(blob, dataUrl, `estyle-color-id-${Date.now()}.jpg`)) {
    stopCamera();
    setCameraMessage(photoReadyMessage(), "success");
  }
}

async function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    setCameraMessage("Bitte wähle eine Bilddatei aus.", "error");
    return;
  }

  if (state.photos.length >= getMaxPhotos()) {
    setCameraMessage(
      `Maximal ${getMaxPhotos()} Fotos pro Analyse. Entferne ein Foto oder starte die Analyse.`,
      "error"
    );
    return;
  }

  setCameraMessage("Foto wird vorbereitet...", "");
  try {
    const image = await loadImage(file);
    const { blob, dataUrl } = await drawMediaToJpeg(image);
    if (setCapturedPhoto(blob, dataUrl, file.name || `estyle-color-id-${Date.now()}.jpg`)) {
      stopCamera();
      setCameraMessage(photoReadyMessage(), "success");
    }
  } catch (error) {
    console.error(error);
    setCameraMessage("Das Foto konnte nicht gelesen werden. Bitte versuche es erneut.", "error");
  }
}

async function retakePhoto() {
  clearAllPhotos(true);
  await startCamera();
}

async function addAnotherPhoto() {
  if (state.photos.length >= getMaxPhotos()) {
    setCameraMessage(
      `Du hast bereits ${getMaxPhotos()} Fotos ausgewählt. Entferne eines, um ein anderes hinzuzufügen.`,
      "error"
    );
    return;
  }
  clearSelectedPhoto(true);
  await startCamera();
}

function setCapturedPhoto(blob, dataUrl, name) {
  if (state.photos.length >= getMaxPhotos()) {
    setCameraMessage(`Maximal ${getMaxPhotos()} Fotos pro Analyse.`, "error");
    return false;
  }

  const photo = {
    id: createId(),
    blob,
    dataUrl,
    name,
    capturedAt: new Date().toISOString(),
  };
  state.photos.push(photo);
  selectPhoto(state.photos.length - 1, { silent: true });
  updatePhotoUI();
  return true;
}

function selectPhoto(index, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= state.photos.length) return;
  const photo = state.photos[index];
  state.activePhotoIndex = index;
  state.selectedPhotoBlob = photo.blob;
  state.selectedPhotoDataUrl = photo.dataUrl;
  state.selectedPhotoName = photo.name;
  stopCamera();
  showSelectedPhotoPreview();
  updatePhotoUI();
  if (!options.silent) setCameraMessage(`Foto ${index + 1} ausgewählt.`, "success");
}

function removePhoto(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.photos.length) return;
  state.photos.splice(index, 1);
  if (!state.photos.length) {
    clearSelectedPhoto(true);
    showCameraCaptureControls();
    setCameraMessage("Foto entfernt. Nimm ein neues Foto auf oder wähle eines aus.", "");
  } else {
    selectPhoto(Math.min(index, state.photos.length - 1), { silent: true });
    setCameraMessage(photoReadyMessage(), "success");
  }
  updatePhotoUI();
}

function clearSelectedPhoto(clearPreview) {
  state.selectedPhotoBlob = null;
  state.selectedPhotoDataUrl = "";
  state.selectedPhotoName = "";
  state.activePhotoIndex = -1;
  if (clearPreview && els.photoPreview) {
    els.photoPreview.removeAttribute("src");
    els.photoPreview.hidden = true;
  }
  els.cameraCard?.classList.remove("has-photo");
}

function clearAllPhotos(clearPreview) {
  state.photos = [];
  clearSelectedPhoto(clearPreview);
  updatePhotoUI();
}

function updatePhotoUI() {
  const count = state.photos.length;
  if (els.photoTray) els.photoTray.hidden = count === 0;
  if (els.photoCount)
    els.photoCount.textContent = count === 1 ? "1 Foto bereit" : `${count} Fotos bereit`;

  if (els.photoThumbs) {
    els.photoThumbs.innerHTML = "";
    state.photos.forEach((photo, index) => {
      const item = document.createElement("div");
      item.className = `photo-thumb${index === state.activePhotoIndex ? " active" : ""}`;

      const select = document.createElement("button");
      select.type = "button";
      select.dataset.action = "select-photo";
      select.dataset.photoIndex = String(index);
      select.setAttribute("aria-label", `Foto ${index + 1} anzeigen`);
      const image = document.createElement("img");
      image.src = photo.dataUrl;
      image.alt = `Foto ${index + 1}`;
      select.append(image);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.dataset.action = "remove-photo";
      remove.dataset.photoIndex = String(index);
      remove.setAttribute("aria-label", `Foto ${index + 1} entfernen`);
      remove.textContent = "×";

      item.append(select, remove);
      els.photoThumbs.append(item);
    });
  }

  const sendButtonLabel = document.querySelector('[data-action="send-photo"] span:last-child');
  if (sendButtonLabel)
    sendButtonLabel.textContent =
      count > 1 ? `Analyse mit ${count} Fotos starten` : "Analyse starten";
}

function getMaxPhotos() {
  return Math.max(1, Math.min(8, Number(CONFIG.maxPhotos) || DEFAULT_CONFIG.maxPhotos));
}

function photoReadyMessage() {
  const count = state.photos.length;
  if (count <= 1)
    return "Foto bereit. Du kannst die Analyse starten oder ein weiteres Foto hinzufügen.";
  return `${count} Fotos bereit. Je mehr gute Bilder, desto genauer kann die Erkennung werden.`;
}

async function drawMediaToJpeg(media) {
  const naturalWidth = media.videoWidth || media.naturalWidth || media.width;
  const naturalHeight = media.videoHeight || media.naturalHeight || media.height;
  if (!naturalWidth || !naturalHeight) throw new Error("Keine Bilddimensionen erkannt.");

  const maxDimension = Number(CONFIG.maxUploadWidth) || DEFAULT_CONFIG.maxUploadWidth;
  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
  const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = els.captureCanvas;
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  context.drawImage(media, 0, 0, targetWidth, targetHeight);

  const quality = Math.max(
    0.55,
    Math.min(0.98, Number(CONFIG.jpegQuality) || DEFAULT_CONFIG.jpegQuality)
  );
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error("JPEG konnte nicht erzeugt werden.")),
      "image/jpeg",
      quality
    );
  });
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { blob, dataUrl };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht geladen werden."));
    };
    image.src = url;
  });
}

async function sendPhotoForAnalysis(button) {
  if (authRequiredFor("camera") && !isAuthenticated()) {
    setCameraMessage("Bitte melde dich zuerst mit Google an.", "error");
    state.returnRoute = "camera";
    navigate("login");
    return;
  }

  if (!state.photos.length || !state.selectedPhotoBlob) {
    setCameraMessage("Nimm zuerst ein Foto auf oder wähle eines aus.", "error");
    return;
  }

  setBusy(button, true, "Analyse läuft...");
  setCameraMessage("Foto wird sicher an die Analyse-API gesendet...", "");
  showAnalysisOverlay(state.photos.length);

  try {
    const raw = CONFIG.demoMode ? await getDemoResponse() : await postPhotoToApi();
    const analysis = normalizeAnalysis(raw);
    state.latestAnalysis = analysis;
    state.latestRaw = raw;
    persistAnalysis(analysis, raw);
    renderResult(analysis, raw, state.selectedPhotoDataUrl);
    setCameraMessage("Analyse abgeschlossen.", "success");
    navigate("result");
  } catch (error) {
    console.error(error);
    setCameraMessage(error.message || "Analyse fehlgeschlagen. Bitte versuche es erneut.", "error");
    showToast(error.message || "Analyse fehlgeschlagen.");
  } finally {
    hideAnalysisOverlay();
    setBusy(button, false);
    updatePhotoUI();
  }
}

async function postPhotoToApi() {
  if (!CONFIG.apiEndpoint) throw new Error("Kein API-Endpunkt konfiguriert.");

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    Number(CONFIG.timeoutMs) || DEFAULT_CONFIG.timeoutMs
  );
  const headers = { Accept: "application/json" };
  const authToken = CONFIG.auth?.attachIdTokenToAnalysisRequest ? await getCurrentIdToken() : "";
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  try {
    const { body, isMultipart } = buildAnalysisRequestBody();
    if (!isMultipart) headers["Content-Type"] = CONFIG.contentType || "application/octet-stream";

    const response = await fetch(CONFIG.apiEndpoint, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      credentials: CONFIG.credentials || "same-origin",
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const apiMessage = typeof payload === "object" ? payload.message || payload.error : payload;
      throw new Error(apiMessage || `API-Fehler ${response.status}`);
    }
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Die API hat kein JSON zurückgegeben.");
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("Die Analyse hat zu lange gedauert. Bitte erneut versuchen.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildAnalysisRequestBody() {
  const photos = state.photos.length
    ? state.photos
    : [
        {
          blob: state.selectedPhotoBlob,
          name: state.selectedPhotoName,
          capturedAt: new Date().toISOString(),
        },
      ];
  const uploadMode = CONFIG.uploadMode || "binary";
  const multiMode = CONFIG.multiPhotoUploadMode || DEFAULT_CONFIG.multiPhotoUploadMode;
  const shouldSendMultipart =
    uploadMode === "multipart" || (photos.length > 1 && multiMode === "multipart");

  if (shouldSendMultipart) {
    const formData = new FormData();
    photos.forEach((photo, index) => {
      const fieldName = photos.length > 1 ? "photos[]" : CONFIG.requestFieldName || "photo";
      formData.append(
        fieldName,
        photo.blob,
        normalizeFileName(photo.name || `estyle-color-id-${index + 1}.jpg`)
      );
    });
    formData.append("client", "eskyna-pwa");
    formData.append("photoCount", String(photos.length));
    formData.append("capturedAt", new Date().toISOString());
    formData.append("facingMode", state.facingMode);
    formData.append("uploadMode", photos.length > 1 ? "multi-photo" : "single-photo");
    if (state.auth.user?.uid) {
      formData.append("userId", state.auth.user.uid);
      formData.append("email", state.auth.user.email || "");
      formData.append("authProvider", state.auth.user.providerId || "");
    }
    return { body: formData, isMultipart: true };
  }

  const activePhoto = photos[state.activePhotoIndex] || photos[photos.length - 1] || photos[0];
  return { body: activePhoto.blob, isMultipart: false };
}

function showAnalysisOverlay(photoCount) {
  if (!els.analysisOverlay) return;
  const countText = photoCount === 1 ? "1 Foto" : `${photoCount} Fotos`;
  if (els.analysisPhotoCount) {
    els.analysisPhotoCount.textContent = `Wir analysieren ${countText}. Das dauert meist etwa 30 Sekunden. Bitte bleibe auf dieser Seite.`;
  }
  state.analysisStartedAt = Date.now();
  updateAnalysisElapsed();
  window.clearInterval(state.analysisTimer);
  state.analysisTimer = window.setInterval(updateAnalysisElapsed, 1000);
  els.analysisOverlay.hidden = false;
  document.body.classList.add("is-analyzing");
}

function hideAnalysisOverlay() {
  window.clearInterval(state.analysisTimer);
  state.analysisTimer = null;
  if (els.analysisOverlay) els.analysisOverlay.hidden = true;
  document.body.classList.remove("is-analyzing");
}

function updateAnalysisElapsed() {
  if (!els.analysisElapsed || !state.analysisStartedAt) return;
  const seconds = Math.max(0, Math.round((Date.now() - state.analysisStartedAt) / 1000));
  els.analysisElapsed.textContent = `${seconds} Sekunden`;
}

async function getDemoResponse() {
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  try {
    const response = await fetch("sample-api-response.json", { cache: "no-store" });
    if (response.ok) return await response.json();
  } catch (_) {
    // Fallback below.
  }
  return SAMPLE_ANALYSIS;
}

function normalizeFileName(name) {
  const clean = (name || `estyle-color-id-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, "-");
  return clean.toLowerCase().endsWith(".jpg") || clean.toLowerCase().endsWith(".jpeg")
    ? clean
    : `${clean}.jpg`;
}

function normalizeAnalysis(raw) {
  const colorType =
    pick(raw, [
      "colorType",
      "colourType",
      "farbtyp",
      "season",
      "type",
      "analysis.colorType",
      "analysis.farbtyp",
      "result.colorType",
      "result.farbtyp",
      "data.colorType",
      "data.farbtyp",
    ]) || "Analyse erhalten";

  const baseColors = normalizePalette(
    pick(raw, [
      "baseColors",
      "grundfarben",
      "palette.base",
      "palette.baseColors",
      "colors.base",
      "analysis.baseColors",
      "analysis.grundfarben",
      "result.baseColors",
      "data.baseColors",
    ])
  );

  const accentColors = normalizePalette(
    pick(raw, [
      "accentColors",
      "akzentfarben",
      "palette.accent",
      "palette.accentColors",
      "colors.accent",
      "analysis.accentColors",
      "analysis.akzentfarben",
      "result.accentColors",
      "data.accentColors",
    ])
  );

  const noGoColors = normalizePalette(
    pick(raw, [
      "noGoColors",
      "nogoColors",
      "no_go_colors",
      "noGo",
      "nogos",
      "palette.noGo",
      "colors.noGo",
      "analysis.noGoColors",
      "analysis.no_go_colors",
      "result.noGoColors",
      "data.noGoColors",
    ])
  );

  const noGoText =
    pick(raw, [
      "noGoText",
      "noGoDescription",
      "nogoText",
      "avoidText",
      "beschreibung",
      "analysis.noGoText",
      "analysis.noGoDescription",
      "result.noGoText",
      "data.noGoText",
    ]) || "";

  const imageUrl =
    pick(raw, [
      "imageUrl",
      "portraitUrl",
      "analysis.imageUrl",
      "result.imageUrl",
      "data.imageUrl",
    ]) || "";

  return {
    colorType: String(colorType).trim(),
    baseColors,
    accentColors,
    noGoColors,
    noGoText: String(noGoText).trim(),
    imageUrl: String(imageUrl).trim(),
    receivedAt: new Date().toISOString(),
  };
}

function pick(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function getPath(source, path) {
  if (!source || typeof source !== "object") return undefined;
  return path.split(".").reduce((current, key) => {
    if (current && Object.prototype.hasOwnProperty.call(current, key)) return current[key];
    return undefined;
  }, source);
}

function normalizePalette(value) {
  if (!value) return [];

  if (typeof value === "string") {
    const hexes = value.match(/#?[0-9a-fA-F]{6}\b/g) || [];
    return hexes.map((hex) => normalizeColorItem(hex));
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value)
      .map(([name, val]) =>
        normalizeColorItem({ name, ...(typeof val === "object" ? val : { hex: val }) })
      )
      .filter(Boolean);
  }

  if (!Array.isArray(value)) return [];
  return value.map(normalizeColorItem).filter(Boolean).slice(0, 12);
}

function normalizeColorItem(item) {
  if (!item) return null;

  if (typeof item === "string") {
    const hex = normalizeHex(item);
    return hex ? { hex, name: hex.toUpperCase() } : null;
  }

  if (typeof item === "object") {
    const hexCandidate = item.hex || item.color || item.value || item.code || item.hsl || item.rgb;
    const hex = normalizeHex(hexCandidate);
    if (!hex) return null;
    const name = item.name || item.label || item.title || hex.toUpperCase();
    return { hex, name: String(name) };
  }

  return null;
}

function normalizeHex(value) {
  if (!value) return "";
  const raw = String(value).trim();

  const long = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (long) return `#${long[1].toLowerCase()}`;

  const short = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (short) {
    return `#${short[1]
      .split("")
      .map((char) => char + char)
      .join("")
      .toLowerCase()}`;
  }

  const rgb = raw.match(/rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    const parts = rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))));
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }

  return "";
}

function renderResult(analysis = null, raw = null, portraitOverride = "") {
  const hasAnalysis = Boolean(analysis);
  const data = analysis || {
    colorType: "Noch keine Analyse",
    baseColors: [],
    accentColors: [],
    noGoColors: [],
    noGoText: "",
  };

  els.colorTypeText.textContent = data.colorType || "Analyse erhalten";
  renderPalette(els.baseColors, data.baseColors || []);
  renderPalette(els.accentColors, data.accentColors || []);
  renderPalette(els.noGoColors, data.noGoColors || [], true);

  els.noGoText.textContent =
    data.noGoText ||
    (hasAnalysis
      ? "Die API hat keine No-Go-Beschreibung geliefert."
      : "Mache zuerst ein Foto, damit deine persönlichen Farben angezeigt werden.");
  els.resultPortrait.src =
    portraitOverride ||
    data.imageUrl ||
    state.selectedPhotoDataUrl ||
    "assets/portrait-default.webp";
  if (els.resultInfoButton) els.resultInfoButton.hidden = !raw;

  if (raw) {
    els.rawResponse.hidden = false;
    els.rawJson.textContent = JSON.stringify(raw, null, 2);
  } else {
    els.rawResponse.hidden = true;
    els.rawJson.textContent = "";
  }
}

function renderPalette(container, colors, compact = false) {
  container.innerHTML = "";
  if (!colors.length) {
    const empty = document.createElement("span");
    empty.className = "empty-palette";
    empty.textContent = "Noch nicht verfügbar";
    container.append(empty);
    return;
  }

  colors.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = compact ? "swatch compact" : "swatch";
    swatch.style.setProperty("--color", color.hex);
    swatch.title = `${color.name} ${color.hex}`;
    swatch.setAttribute("aria-label", `${color.name} ${color.hex}`);
    container.append(swatch);
  });
}

function openDetectionDetails() {
  if (!state.latestRaw) {
    showToast("Noch keine Detektionsdetails verfügbar.");
    return;
  }
  renderDetectionDetails(state.latestRaw);
  if (els.detectionSheet) els.detectionSheet.hidden = false;
}

function closeDetectionDetails() {
  if (els.detectionSheet) els.detectionSheet.hidden = true;
}

function renderDetectionDetails(raw) {
  const details = getDetectionDetails(raw);
  if (els.detectionDetailsList) {
    els.detectionDetailsList.innerHTML = "";
    if (!details.length) {
      const message = document.createElement("div");
      message.className = "details-empty";
      message.textContent = "Die API hat keine separaten Detektionsdetails geliefert.";
      els.detectionDetailsList.append(message);
    } else {
      details.forEach((item) => {
        const dt = document.createElement("dt");
        dt.textContent = item.label;
        const dd = document.createElement("dd");
        dd.textContent = item.value;
        els.detectionDetailsList.append(dt, dd);
      });
    }
  }
  if (els.detectionRawJson) els.detectionRawJson.textContent = JSON.stringify(raw, null, 2);
}

function getDetectionDetails(raw) {
  const details = [];
  const photoCount =
    state.photos.length ||
    pick(raw, ["photoCount", "analysis.photoCount", "result.photoCount", "data.photoCount"]);
  if (photoCount) details.push({ label: "Verwendete Fotos", value: String(photoCount) });
  const receivedAt =
    state.latestAnalysis?.receivedAt ||
    pick(raw, ["receivedAt", "analysis.receivedAt", "createdAt", "timestamp"]);
  if (receivedAt) details.push({ label: "Analysezeit", value: formatDetailValue(receivedAt) });

  const explicitPaths = [
    "detection.faceDetected",
    "detection.faces",
    "detection.faceCount",
    "detection.confidence",
    "detection.quality",
    "face.detected",
    "face.count",
    "face.confidence",
    "face.quality",
    "image.quality",
    "image.brightness",
    "image.sharpness",
    "image.lighting",
    "analysis.detection.faceDetected",
    "analysis.detection.confidence",
    "analysis.quality",
    "result.detection.faceDetected",
    "result.detection.confidence",
    "data.detection.confidence",
  ];

  explicitPaths.forEach((path) => {
    const value = getPath(raw, path);
    if (value !== undefined && value !== null && value !== "") {
      details.push({ label: formatDetailLabel(path), value: formatDetailValue(value) });
    }
  });

  const seen = new Set(details.map((item) => `${item.label}:${item.value}`));
  flattenObject(raw)
    .filter((item) => isDetectionKey(item.path))
    .slice(0, 24)
    .forEach((item) => {
      const detail = { label: formatDetailLabel(item.path), value: formatDetailValue(item.value) };
      const key = `${detail.label}:${detail.value}`;
      if (!seen.has(key)) {
        details.push(detail);
        seen.add(key);
      }
    });

  return details.slice(0, 28);
}

function flattenObject(value, prefix = "", depth = 0, output = []) {
  if (depth > 4 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => typeof item !== "object" || item === null)) {
      output.push({ path: prefix, value });
    } else {
      value
        .slice(0, 8)
        .forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, depth + 1, output));
    }
    return output;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (nested && typeof nested === "object") flattenObject(nested, path, depth + 1, output);
      else output.push({ path, value: nested });
    });
    return output;
  }
  output.push({ path: prefix, value });
  return output;
}

function isDetectionKey(path) {
  return /(detect|face|gesicht|quality|qualit|score|confidence|confiden|light|brightness|illum|skin|undertone|eye|hair|blur|sharp|pose|angle|exposure|contrast|background|neutral|model)/i.test(
    path
  );
}

function formatDetailLabel(path) {
  return String(path)
    .replace(/\[(\d+)\]/g, " $1")
    .split(".")
    .filter(Boolean)
    .slice(-3)
    .join(" / ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDetailValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number") {
    if (value > 0 && value <= 1) return `${Math.round(value * 100)} %`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (Array.isArray(value)) return value.map(formatDetailValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  const raw = String(value);
  const date = Date.parse(raw);
  if (!Number.isNaN(date) && /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(raw)) {
    return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(date)
    );
  }
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

function persistAnalysis(analysis, raw) {
  safeLocalStorageSet(
    STORAGE_KEYS.analysis,
    JSON.stringify({ analysis, raw, createdAt: new Date().toISOString() })
  );
}

function setCameraMessage(message, type) {
  els.cameraMessage.textContent = message;
  els.cameraMessage.classList.remove("error", "success");
  if (type) els.cameraMessage.classList.add(type);
}

function setBusy(button, busy, label = "") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    const labelNode = button.querySelector("span:last-child") || button;
    labelNode.textContent = label || "Bitte warten...";
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => els.toast.classList.remove("show"), 2800);
}

async function promptInstall() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice.catch(() => undefined);
    state.deferredInstallPrompt = null;
    updateInstallButtons();
    return;
  }

  if (isStandaloneDisplay()) {
    showToast("EStyle ist bereits als App geöffnet.");
    return;
  }

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isiOS) {
    showToast("Installation: Teilen-Button öffnen und „Zum Home-Bildschirm“ wählen.");
  } else {
    showToast("Installation: Browser-Menü öffnen und „App installieren“ wählen.");
  }
}

function updateInstallButtons() {
  const installed = isStandaloneDisplay();
  els.installButtons.forEach((button) => {
    button.hidden = false;
    button.disabled = installed;
    button.textContent = installed ? "App installiert" : "App installieren";
  });
}

function isStandaloneDisplay() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    updatePushUI("Push benötigt Service Worker-Unterstützung.");
    return;
  }
  if (!["http:", "https:"].includes(location.protocol)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (state.updateRefreshing) return;
    state.updateRefreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    getServiceWorkerRegistration()
      .then((registration) => {
        watchServiceWorkerRegistration(registration);
        registration.update?.().catch(() => undefined);
      })
      .catch((error) => console.warn("Service Worker konnte nicht registriert werden:", error));
  });
}

function getAppBasePath() {
  const configuredPath = CONFIG.appBasePath || "/app/";
  return configuredPath.endsWith("/") ? configuredPath : `${configuredPath}/`;
}

async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator))
    throw new Error("Service Worker werden von diesem Browser nicht unterstützt.");
  if (state.serviceWorkerRegistration) return state.serviceWorkerRegistration;

  const appBasePath = getAppBasePath();
  const appScopeUrl = new URL(appBasePath, location.origin);
  const swScriptUrl = new URL("sw.js", appScopeUrl);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const existing = registrations.find((registration) => {
    try {
      return new URL(registration.scope).pathname === appScopeUrl.pathname;
    } catch (error) {
      return false;
    }
  });

  state.serviceWorkerRegistration =
    existing ||
    (await navigator.serviceWorker.register(swScriptUrl.pathname, {
      scope: appScopeUrl.pathname,
      updateViaCache: "none",
    }));
  return state.serviceWorkerRegistration;
}

function watchServiceWorkerRegistration(registration) {
  if (!registration) return;

  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;

    installingWorker.addEventListener("statechange", () => {
      if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdateBanner(installingWorker);
      }
    });
  });
}

function showUpdateBanner(worker) {
  if (!worker || state.updateBannerDismissed) return;
  state.waitingServiceWorker = worker;
  if (els.updateBanner) els.updateBanner.hidden = false;
}

function dismissAppUpdate() {
  state.updateBannerDismissed = true;
  if (els.updateBanner) els.updateBanner.hidden = true;
  showToast("Update wird beim nächsten Neustart der App geladen.");
}

function applyAppUpdate() {
  const worker = state.waitingServiceWorker || state.serviceWorkerRegistration?.waiting;
  if (!worker) {
    window.location.reload();
    return;
  }

  if (els.updateBanner) els.updateBanner.hidden = true;
  showToast("EStyle wird aktualisiert...");
  worker.postMessage({ type: "SKIP_WAITING" });

  window.setTimeout(() => {
    if (!state.updateRefreshing) window.location.reload();
  }, 1800);
}

async function refreshPushState() {
  if (!pushSupported()) {
    updatePushUI(pushUnavailableMessage());
    return;
  }

  if (Notification?.permission === "denied") {
    state.push.status = "denied";
    updatePushUI(
      "Push wurde im Browser blockiert. Bitte in den Website-Einstellungen wieder erlauben."
    );
    return;
  }

  const storedToken = safeLocalStorageGet(STORAGE_KEYS.fcmToken);
  if (storedToken) {
    state.push.token = storedToken;
    state.push.status = "subscribed";
    updatePushUI("Patchnotes sind auf diesem Gerät aktiviert.");
    setupForegroundMessaging().catch(() => undefined);
    return;
  }

  state.push.status = "idle";
  updatePushUI();
}

function pushSupported() {
  const firebaseConfig = getFirebaseConfig();
  return Boolean(
    CONFIG.push?.enabled &&
    (CONFIG.push.provider || "firebase-cloud-messaging") === "firebase-cloud-messaging" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId
  );
}

function pushUnavailableMessage() {
  if (!CONFIG.push?.enabled) return "Pushnachrichten sind in config.js deaktiviert.";
  if ((CONFIG.push.provider || "firebase-cloud-messaging") !== "firebase-cloud-messaging")
    return "Push ist nicht auf Firebase Cloud Messaging konfiguriert.";
  if (!("Notification" in window) || !("serviceWorker" in navigator))
    return "Dieser Browser unterstützt Web Push nicht.";
  const firebaseConfig = getFirebaseConfig();
  if (!firebaseConfig.messagingSenderId) return "Firebase messagingSenderId fehlt in config.js.";
  return "Push ist auf diesem Gerät nicht verfügbar.";
}

function getFcmVapidKey() {
  return CONFIG.push?.fcmVapidKey || CONFIG.push?.vapidPublicKey || "";
}

async function enablePushNotifications(button) {
  closeMenu();
  if (!CONFIG.push?.enabled) {
    showToast("Pushnachrichten sind in config.js deaktiviert.");
    return;
  }
  if (!pushSupported()) {
    const message = pushUnavailableMessage();
    showToast(message);
    updatePushUI(message);
    return;
  }
  if (!isAuthenticated()) {
    showToast("Bitte zuerst mit Google anmelden.");
    navigate("login");
    return;
  }
  if (!getFcmVapidKey()) {
    const message =
      "FCM Web Push Key fehlt. Bitte in Firebase unter Project settings > Cloud Messaging > Web Push certificates erzeugen und in config.js als fcmVapidKey eintragen.";
    updatePushUI(message);
    showToast("FCM Web Push Key fehlt noch.");
    return;
  }

  setBusy(button, true, "Aktiviere...");
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      state.push.status = permission === "denied" ? "denied" : "idle";
      updatePushUI(
        permission === "denied" ? "Push wurde im Browser blockiert." : "Push wurde nicht aktiviert."
      );
      return;
    }

    const token = await getFcmRegistrationToken();
    if (!token)
      throw new Error(
        "Firebase hat kein FCM Token zurückgegeben. Bitte Push-Key und Domain-Konfiguration prüfen."
      );

    await sendFcmTokenToServer(token);
    state.push.token = token;
    state.push.status = "subscribed";
    safeLocalStorageSet(STORAGE_KEYS.fcmToken, token);
    await setupForegroundMessaging();
    updatePushUI("Patchnotes sind aktiviert.");
    showToast("Patchnotes aktiviert.");
  } catch (error) {
    console.error(error);
    state.push.status = "error";
    state.push.error = fcmErrorMessage(error);
    updatePushUI(state.push.error);
    showToast(state.push.error);
  } finally {
    setBusy(button, false);
    updatePushUI();
  }
}

async function setupFirebaseMessaging() {
  if (state.push.messaging && state.push.messagingModule)
    return { messaging: state.push.messaging, messagingModule: state.push.messagingModule };

  if (!state.auth.firebase?.app) {
    if (state.auth.initPromise) await state.auth.initPromise;
    if (!state.auth.firebase?.app) await setupFirebaseAuth();
  }

  const sdkVersion = CONFIG.auth?.firebaseSdkVersion || DEFAULT_CONFIG.auth.firebaseSdkVersion;
  const baseUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(sdkVersion)}`;
  const messagingModule = await import(`${baseUrl}/firebase-messaging.js`);

  if (messagingModule.isSupported) {
    const supported = await messagingModule.isSupported().catch(() => false);
    if (!supported)
      throw new Error("Firebase Cloud Messaging wird von diesem Browser nicht unterstützt.");
  }

  const messaging = messagingModule.getMessaging(state.auth.firebase.app);
  state.push.messaging = messaging;
  state.push.messagingModule = messagingModule;
  return { messaging, messagingModule };
}

async function getFcmRegistrationToken() {
  const registration = await getServiceWorkerRegistration();
  await navigator.serviceWorker.ready.catch(() => undefined);
  const { messaging, messagingModule } = await setupFirebaseMessaging();
  return messagingModule.getToken(messaging, {
    vapidKey: getFcmVapidKey(),
    serviceWorkerRegistration: registration,
  });
}

async function setupForegroundMessaging() {
  if (state.push.foregroundListenerReady) return;
  if (!pushSupported() || Notification?.permission !== "granted") return;

  const { messaging, messagingModule } = await setupFirebaseMessaging();
  if (!messagingModule.onMessage) return;

  messagingModule.onMessage(messaging, (payload) => {
    const notification = payload.notification || {};
    const data = payload.data || {};
    const title = notification.title || data.title || "EStyle Update";
    const body = notification.body || data.body || "Es gibt Neuigkeiten in deiner EStyle App.";
    showToast(`${title}: ${body}`);
  });
  state.push.foregroundListenerReady = true;
}

async function sendFcmTokenToServer(token) {
  // EStyle PWA stores FCM tokens directly in Firestore.
  // This avoids endpoint dependencies that do not exist on GitHub Pages.
  await saveFcmTokenToFirestore(token);
}

function buildFcmTokenPayload(token) {
  return {
    token,
    provider: "firebase-cloud-messaging",
    topic: CONFIG.push.topic || "patchnotes",
    uid: state.auth.user?.uid || "",
    user: state.auth.user
      ? {
          uid: state.auth.user.uid,
          email: state.auth.user.email || "",
          displayName: state.auth.user.displayName || "",
          providerId: state.auth.user.providerId || "",
        }
      : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notificationPermission: Notification.permission,
    userAgent: navigator.userAgent,
    app: {
      basePath: CONFIG.appBasePath || "/app/",
      startUrl: CONFIG.pwaStartUrl || "/app/#welcome",
    },
  };
}

async function setupFirebaseFirestore() {
  if (state.push.firestore && state.push.firestoreModule) {
    return { firestore: state.push.firestore, firestoreModule: state.push.firestoreModule };
  }

  if (!state.auth.firebase?.app) {
    if (state.auth.initPromise) await state.auth.initPromise;
    if (!state.auth.firebase?.app) await setupFirebaseAuth();
  }

  const sdkVersion = CONFIG.auth?.firebaseSdkVersion || DEFAULT_CONFIG.auth.firebaseSdkVersion;
  const baseUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(sdkVersion)}`;
  const firestoreModule = await import(`${baseUrl}/firebase-firestore.js`);
  const firestore = firestoreModule.getFirestore(state.auth.firebase.app);

  state.push.firestore = firestore;
  state.push.firestoreModule = firestoreModule;
  return { firestore, firestoreModule };
}

async function saveFcmTokenToFirestore(token) {
  if (!state.auth.user?.uid) {
    throw new Error("FCM Token erstellt, aber Speichern in Firestore erfordert einen Login.");
  }

  const { firestore, firestoreModule } = await setupFirebaseFirestore();
  const collectionName = CONFIG.push?.fcmTokensCollection || "fcmTokens";
  const tokenHash = await sha256Hex(token);
  const documentId = `${state.auth.user.uid}_${tokenHash}`;
  const payload = buildFcmTokenPayload(token);

  await firestoreModule.setDoc(
    firestoreModule.doc(firestore, collectionName, documentId),
    {
      ...payload,
      tokenHash,
      uid: state.auth.user.uid,
      lastSeenAt: firestoreModule.serverTimestamp(),
      updatedAt: firestoreModule.serverTimestamp(),
    },
    { merge: true }
  );
}

async function removeFcmTokenFromFirestore(token) {
  if (!state.auth.user?.uid || !token) return;
  const { firestore, firestoreModule } = await setupFirebaseFirestore();
  const collectionName = CONFIG.push?.fcmTokensCollection || "fcmTokens";
  const tokenHash = await sha256Hex(token);
  const documentId = `${state.auth.user.uid}_${tokenHash}`;
  await firestoreModule.deleteDoc(firestoreModule.doc(firestore, collectionName, documentId));
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function updatePushUI(message = "") {
  if (!els.pushButton && !els.pushStatus) return;
  let label = "Patchnotes aktivieren";
  let status = message;

  if (!CONFIG.push?.enabled) {
    label = "Push deaktiviert";
    status ||= "Pushnachrichten sind deaktiviert.";
  } else if (!pushSupported()) {
    label = "Push nicht verfügbar";
    status ||= pushUnavailableMessage();
  } else if (!getFcmVapidKey()) {
    label = "Patchnotes aktivieren";
    status ||= "FCM Web Push Key fehlt noch in config.js.";
  } else if (state.push.status === "subscribed") {
    label = "Patchnotes aktiviert";
    status ||= "Du erhältst Pushnachrichten für Updates.";
  } else if (state.push.status === "denied") {
    label = "Push blockiert";
    status ||= "Bitte Push im Browser erlauben.";
  } else if (state.push.status === "error") {
    label = "Erneut versuchen";
    status ||= state.push.error || "Push konnte nicht aktiviert werden.";
  } else if (!isAuthenticated()) {
    status ||= "Patchnotes können nach dem Login aktiviert werden.";
  } else {
    status ||= "Aktiviere Patchnotes über Firebase Cloud Messaging.";
  }

  if (els.pushButton) {
    els.pushButton.textContent = label;
    els.pushButton.disabled = state.push.status === "subscribed" || state.push.status === "denied";
  }
  if (els.pushStatus) els.pushStatus.textContent = status;
}

function fcmErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("messaging/permission-blocked"))
    return "Push wurde im Browser blockiert. Bitte in den Website-Einstellungen erlauben.";
  if (code.includes("messaging/token-subscribe-failed"))
    return "FCM konnte kein Token erstellen. Bitte Web Push Key und autorisierte Domain prüfen.";
  if (code.includes("messaging/unsupported-browser"))
    return "Firebase Cloud Messaging wird von diesem Browser nicht unterstützt.";
  if (code.includes("messaging/failed-service-worker-registration"))
    return "Der Service Worker konnte nicht für FCM registriert werden.";
  if (code.includes("firestore/permission-denied") || code.includes("permission-denied"))
    return "FCM Token erstellt, aber Firestore hat das Speichern blockiert. Bitte Firestore und die Security Rules prüfen.";
  if (code.includes("firestore/unavailable") || code.includes("unavailable"))
    return "FCM Token erstellt, aber Firestore ist gerade nicht erreichbar.";
  return error?.message || "Push konnte nicht aktiviert werden.";
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    /* Storage kann in privaten Browserfenstern blockiert sein. */
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (_) {
    /* Storage kann in privaten Browserfenstern blockiert sein. */
  }
}

function safeSessionStorageGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (_) {
    return "";
  }
}

function safeSessionStorageSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (_) {
    /* Storage kann in privaten Browserfenstern blockiert sein. */
  }
}

function safeSessionStorageRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (_) {
    /* Storage kann in privaten Browserfenstern blockiert sein. */
  }
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function mergeConfig(base, override) {
  if (!override || typeof override !== "object") return base;
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = output[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue)
    ) {
      output[key] = mergeConfig(baseValue, value);
    } else if (Array.isArray(value)) {
      output[key] = [...value];
    } else {
      output[key] = value;
    }
  }
  return output;
}
