// ESKYNA / EStyle PWA Konfiguration
// Nutzt denselben Analysedienst wie https://eskyna.com/estylepwa/.
// Diese Datei ist absichtlich sowohl im Browser als auch im Service Worker ladbar.
(function initEskynaConfig(globalScope) {
  const config = {
    appBasePath: "/app/",
    pwaStartUrl: "/app/#welcome",
    apiEndpoint: "https://api.eskyna-style.workers.dev/v1/images",
    // Auf true setzen, wenn die UI ohne Backend mit sample-api-response.json getestet werden soll.
    demoMode: false,
    uploadMode: "binary",
    contentType: "application/octet-stream",
    credentials: "same-origin",
    maxUploadWidth: 1600,
    jpegQuality: 0.88,
    timeoutMs: 60000,
    maxPhotos: 4,
    // Bei einem Foto bleibt der bestehende Binary-Upload aktiv.
    // Ab zwei Fotos sendet die App multipart/form-data an denselben Endpunkt.
    multiPhotoUploadMode: "multipart",

    push: {
      enabled: true,
      provider: "firebase-cloud-messaging",
      // Oeffentlicher Web-Push-Zertifikatsschluessel aus Firebase Console > Project settings > Cloud Messaging.
      // Er ist kein Secret und darf im Frontend stehen. Ohne diesen Key kann die App kein FCM Token erstellen.
      fcmVapidKey: "",
      // GitHub Pages kann keine /api/fcm/register POST-Endpunkte ausfuehren.
      // Deshalb speichert die App FCM Tokens direkt in Cloud Firestore.
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
      // Popup ist stabiler auf eskyna.com; falls ein Browser Popups blockiert, faellt die App automatisch auf Redirect zurueck.
      signInMode: "popup",
      redirectAfterLogin: "create",

      // Optional: auf true setzen, wenn der Analyse-Worker Firebase ID Tokens pruefen soll.
      // Achtung: Dann muss die API CORS fuer den Header Authorization erlauben.
      attachIdTokenToAnalysisRequest: false,

      // Firebase Web App Konfiguration.
      // In Firebase Authentication vorerst nur Google aktivieren; Email/Password deaktiviert lassen.
      firebaseConfig: {
        apiKey: "AIzaSyBLnOeqtIgBUObt5S4G9vImavaeS0lua1E",
        authDomain: "eskyna-style.firebaseapp.com",
        projectId: "eskyna-style",
        storageBucket: "eskyna-style.firebasestorage.app",
        messagingSenderId: "349179931593",
        appId: "1:349179931593:web:332b9c02eaee3e8e525618",
        measurementId: "G-ERP45XHEG9",
      },
    },
  };

  globalScope.ESKYNA_CONFIG = config;
})(typeof self !== "undefined" ? self : window);
