# EStyle Color ID PWA

Mobile-first PWA fuer die ESKYNA/EStyle Color-ID Fotoanalyse. Das Design orientiert sich an den gelieferten Figma-Screens: Welcome-Screen, Google Login, Foto-Regeln, Kamera-Upload, Warteanimation, Mehrbild-Upload und Ergebnisansicht mit Farbpaletten.

## Dateien

- `index.html` - App-Shell und Views
- `styles.css` - komplettes UI-Design
- `app.js` - Routing, Google Login, Kamera, Mehrbild-Upload, Warteanimation, API-Upload, Ergebnisdarstellung, PWA-Install und Firebase Cloud Messaging
- `config.js` - API-, Auth- und FCM-Konfiguration; laeuft auch im Service Worker
- `manifest.webmanifest` - PWA Manifest
- `sw.js` - Service Worker fuer Offline-App-Shell und FCM-Hintergrundnachrichten
- `assets/` - optimierte Assets, PWA Icons und `sign_gold.png` fuer die Warteanimation
- `server-examples/` - Beispielcode fuer Token-Speicherung und Patchnote-Versand
- `.htaccess` - optionale Apache-Konfiguration fuer eskyna.com
- `sample-api-response.json` - Beispielantwort fuer Demo-/Frontendtests

## Deployment auf https://eskyna.com/app/

1. Auf dem Server den Ordner `app` anlegen und den Inhalt dieses Ordners nach `https://eskyna.com/app/` hochladen.
2. `config.js` aus `config.example.js` erstellen und die Firebase Web-App-Konfiguration fuer `eskyna-style` eintragen.
3. Der Analysedienst ist derselbe wie bei `https://eskyna.com/estylepwa/`.
4. In Firebase Authentication nur den Provider `Google` aktivieren. `Email/Password` deaktiviert lassen. Die PWA enthaelt keine E-Mail-Registrierung, kein Passwortfeld und keinen `createUserWithEmailAndPassword`-Flow.
5. In Firebase unter den autorisierten Domains `eskyna.com` hinterlegen. Falls lokal getestet wird, auch `localhost` erlauben.
6. Die App muss ueber HTTPS laufen, sonst verweigern Browser Kamera, PWA-Installation und Push.
7. Nach Aenderungen an gecachten Dateien ggf. in `sw.js` `CACHE_NAME` erhoehen, damit bestehende Installationen die neue Version laden. In dieser Version steht der Cache auf `eskyna-estyle-pwa-v13`.
8. Wichtig fuer die Installation: `manifest.webmanifest` ist fest auf `id`, `start_url` und `scope` unter `/app/` eingestellt. Dadurch wird beim Installieren `https://eskyna.com/app/` statt `https://eskyna.com/` als PWA verwendet.

Wenn die PWA spaeter in einen anderen Ordner umzieht, muessen `appBasePath` in `config.js`, `id`, `start_url`, `scope` im Manifest sowie die Service-Worker-Registrierung angepasst werden.

### GitHub Pages (Vorschau)

Der Workflow `.github/workflows/pages.yml` veroeffentlicht dieselben statischen Dateien unter `https://eskyna.github.io/app/`. Fuer die Produktion auf `eskyna.com` die Dateien weiterhin in den Server-Ordner `/app` hochladen.

## Aktuelle `config.js`

```js
window.ESKYNA_CONFIG = {
  appBasePath: "/app/",
  pwaStartUrl: "/app/#welcome",
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
```

`fcmVapidKey` ist der oeffentliche Web-Push-Zertifikatsschluessel aus Firebase. Er ist kein Secret. Der private Schluessel bleibt bei Firebase und gehoert nicht ins Repo.

## Login-Logik

Die geschuetzten Bereiche `Color ID erstellen`, `Foto aufnehmen` und `Meine Analyse` sind hinter Login geschaltet. Der Startscreen zeigt nur `Loslegen`; wenn Nutzerinnen noch nicht eingeloggt sind, fuehrt `Loslegen` automatisch zur Login-Ansicht.

In v9 wurde der Login-Flow robuster gemacht: Die App wartet auf die Firebase-Session, uebernimmt Redirect-Ergebnisse aktiv und nutzt standardmaessig `signInWithPopup()` mit Redirect-Fallback.

Implementiert ist Firebase Authentication mit Popup-Flow und Redirect-Fallback fuer mobile Browser/PWAs:

- Google Login: `GoogleAuthProvider`
- Persistenz: lokale Firebase Auth Session plus minimales UI-Profil in `localStorage`
- Nach Google-Login wird der Firebase-User direkt aus Popup, Redirect-Ergebnis oder `onAuthStateChanged` uebernommen
- Logout: im Seitenmenue ueber `Abmelden`

Es gibt bewusst keinen separaten E-Mail-Account in der PWA. Auch die alte E-Mail-Form wurde entfernt.

Optional kann der Firebase ID Token an die Analyse-API gesendet werden:

```js
auth: {
  attachIdTokenToAnalysisRequest: true;
}
```

Dann sendet die App zusaetzlich:

```http
Authorization: Bearer <firebase-id-token>
```

Wichtig: Der Analyse-Worker muss dann CORS fuer den Header `Authorization` erlauben und das Firebase ID Token serverseitig pruefen.

## Firebase Cloud Messaging fuer Patchnotes

Die vorherige generische Web-Push/VAPID-Subscription wurde durch Firebase Cloud Messaging ersetzt.

Clientseitig umgesetzt:

- Button `Patchnotes aktivieren` im Menue
- Browser-Permission Request
- Firebase Messaging SDK
- `getToken()` mit dem Service Worker `sw.js`
- Speicherung des FCM Tokens in `localStorage`
- Speicherung des FCM Tokens direkt in Cloud Firestore, weil GitHub Pages keine `/api/...`-POST-Endpunkte ausfuehren kann
- Sammlung: `fcmTokens`
- Empfang von Vordergrund-Nachrichten per `onMessage()`
- Empfang von Hintergrund-Nachrichten per Service Worker und `onBackgroundMessage()`
- Klick auf Pushnachricht oeffnet die konfigurierte URL wieder in der PWA

### Firebase Console Schritte

1. Firebase Console > Projekt `eskyna-style` oeffnen.
2. Project settings > Cloud Messaging > Web configuration / Web Push certificates.
3. Key pair erzeugen.
4. Den oeffentlichen Key in `config.js` eintragen:

```js
push: {
  fcmVapidKey: "OEFFENTLICHER_FIREBASE_WEB_PUSH_KEY";
}
```

5. Cloud Firestore aktivieren, weil GitHub Pages keine serverseitigen `POST /api/...`-Routen ausfuehren kann. Die App speichert FCM Tokens deshalb direkt in Firestore.

### Firestore fuer FCM Tokens aktivieren

1. Firebase Console > Firestore Database > Create database.
2. Region auswaehlen und starten.
3. Security Rules setzen, z. B.:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /fcmTokens/{tokenId} {
      allow create, update: if request.auth != null
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.provider == 'firebase-cloud-messaging'
        && request.resource.data.token is string;

      allow delete: if request.auth != null
        && resource.data.uid == request.auth.uid;

      allow read: if false;
    }
  }
}
```

Nach Klick auf `Patchnotes aktivieren` sollte in Firestore eine Sammlung `fcmTokens` mit Dokumenten erscheinen. Jedes Dokument enthaelt Token, User-ID, Topic, User-Agent und Zeitstempel.

Die relevanten Einstellungen in `config.js` sind:

```js
push: {
  tokenStorage: "firestore",
  fcmTokensCollection: "fcmTokens",
  registerTokenEndpoint: "",
  unregisterTokenEndpoint: ""
}
```

### Patchnotes senden

Optionen:

- Firebase Console > Messaging: Testnachricht an ein einzelnes FCM Token senden.
- GitHub Actions: Manuelles Workflow-Dispatch-Script liest `fcmTokens` aus Firestore und sendet ueber Firebase Admin SDK. Beispiel liegt in `server-examples/`.
- Cloudflare Worker: Alternative, falls spaeter ein eigener API-Endpunkt gewuenscht ist.

Server-/Private Keys gehoeren nicht ins Repo:

- Firebase Admin SDK Service Account JSON
- Cloudflare Worker Secrets
- Google OAuth private keys

## Neue Funktionen in dieser Version

### Warteanimation waehrend der Analyse

Beim Upload/Analyse-Aufruf wird ein modaler Wartescreen angezeigt. Er nutzt das goldene ESKYNA Kleeblatt als `assets/sign_gold.png`, zeigt eine animierte Ladeflaeche und zaehlt die Wartezeit in Sekunden. Der Text ist auf die typische Analysezeit von ca. 30 Sekunden ausgelegt.

### Mehrere Fotos pro Analyse

Nutzerinnen koennen nach dem ersten Foto weitere Bilder aufnehmen oder auswaehlen. Die App speichert bis zu `maxPhotos` Fotos pro Analyse, zeigt Miniaturen mit Entfernen-/Auswahlfunktion und passt den Button auf `Analyse mit X Fotos starten` an.

Upload-Verhalten:

- 1 Foto: bestehender Binary-Upload bleibt unveraendert.
- Ab 2 Fotos: `multipart/form-data` an denselben API-Endpunkt mit `photos[]`, `photoCount`, `client`, `capturedAt`, `facingMode`, `uploadMode` und optional Login-Feldern.

Wenn der Worker Mehrbild-Analyse serverseitig nutzen soll, muss er `photos[]` aus `multipart/form-data` lesen. Der alte Einzelfoto-Flow bleibt erhalten.

### Detektionsdetails

Auf dem Ergebnisbild gibt es einen kleinen `i`-Button. Er oeffnet ein Bottom Sheet mit technischen Detektionsdetails aus der API-Antwort, z. B. Gesicht erkannt, Confidence, Fotoqualitaet, Licht, Hintergrund oder andere Felder, die Begriffe wie `detection`, `face`, `quality`, `confidence`, `lighting`, `skin`, `pose` usw. enthalten. Die komplette API-Antwort ist weiterhin unter `Rohdaten` sichtbar.

### Installation gezielt fuer `/app/`

Diese Version ist bewusst nicht fuer das Domain-Root konfiguriert. Das Manifest enthaelt:

```json
{
  "id": "/app/",
  "start_url": "/app/#welcome",
  "scope": "/app/"
}
```

Der Service Worker wird mit Scope `/app/` registriert. Falls bereits eine alte Root-PWA installiert wurde, diese auf dem Smartphone entfernen und die neue Version ueber `https://eskyna.com/app/` neu installieren.

### PWA Installation

Auf dem Welcome-Screen und im Menue gibt es `App installieren`. Chrome/Edge nutzen den nativen `beforeinstallprompt`. Auf iOS/Safari zeigt die App einen Hinweis, dass die Installation ueber `Teilen` > `Zum Home-Bildschirm` erfolgt.

## API-Vertrag Fotoanalyse

Die App sendet das vorbereitete JPEG standardmaessig wie die bestehende `estylepwa` als Binary Body an den Worker:

```http
POST https://api.eskyna-style.workers.dev/v1/images
Content-Type: application/octet-stream
Accept: application/json
```

Das Bild wird vor dem Upload auf maximal 1600 px Kantenlaenge skaliert und mit JPEG-Qualitaet 0.88 erzeugt.

Bei einem einzelnen Foto bleibt dieser Binary-Upload aktiv. Sobald mehrere Fotos ausgewaehlt sind, sendet die App `multipart/form-data` mit dem Feld `photos[]`. Optional kann in `config.js` `uploadMode: 'multipart'` gesetzt werden, um auch Einzelfotos als Formularfeld `photo` zu senden. Bei aktivem Login werden zusaetzlich `userId`, `email` und `authProvider` als Formularfelder mitgesendet.

Erwartete JSON-Antwort, empfohlenes Format:

```json
{
  "colorType": "SANFT- KALT",
  "baseColors": [{ "name": "Navy", "hex": "#00203d" }],
  "accentColors": [{ "name": "Rose", "hex": "#ed839e" }],
  "noGoColors": [{ "name": "Orange", "hex": "#f57100" }],
  "noGoText": "Eigelb, Tomate, Orange, Senf - sie lassen dein Teint muede und gelblich wirken.",
  "imageUrl": "https://eskyna.com/uploads/analysis/user-image.jpg",
  "detection": {
    "faceDetected": true,
    "confidence": 0.94,
    "quality": "gut"
  }
}
```

Die App akzeptiert zusaetzlich einige alternative Feldnamen wie `farbtyp`, `grundfarben`, `akzentfarben`, `no_go_colors`, `analysis.colorType` oder `result.baseColors`.

## Lokaler Test

Fuer einen Frontendtest ohne Analyse-Backend kann in `config.js` temporaer `demoMode: true` gesetzt werden. Fuer echte Login- und Push-Tests muss die laufende Domain in Firebase autorisiert sein.

```bash
python3 -m http.server 8080
```

Danach `http://localhost:8080` oeffnen. Fuer echte Kamera- und Push-Tests auf dem Smartphone sollte ueber HTTPS getestet werden.

## Firebase Fehler `auth/configuration-not-found`

Dieser Fehler bedeutet in der Regel, dass Firebase Authentication im Projekt noch nicht gestartet oder der Google-Provider noch nicht aktiviert wurde. In der Firebase Console: `Authentication` > `Get started`, danach unter `Sign-in method` den Provider `Google` aktivieren und unter `Settings` > `Authorized domains` die Domain `eskyna.com` hinterlegen.

## FCM Fehlerbehebung

- `FCM Web Push Key fehlt`: In Firebase Cloud Messaging ein Web-Push-Key-Pair erzeugen und den oeffentlichen Key als `fcmVapidKey` eintragen.
- `Push wurde blockiert`: Browser-/Website-Einstellungen oeffnen und Benachrichtigungen fuer `eskyna.com` erlauben.
- `Server-Speicherung fehlgeschlagen`: `/api/fcm/register` ist noch nicht bereitgestellt oder gibt keinen 2xx-Status zurueck.
- Keine Hintergrundnachricht: Service Worker muss aktualisiert sein. Auf dem Handy die PWA komplett schliessen und neu oeffnen.

## Update-Hinweis für installierte PWAs

Diese Version enthält einen eingebauten Update-Hinweis. Wenn nach einem Deployment ein neuer Service Worker erkannt wird, zeigt die App ein Banner:

- **Neue EStyle Version verfügbar**
- Button **Jetzt aktualisieren** aktiviert den neuen Service Worker per `SKIP_WAITING` und lädt die App neu.
- Button **Später** versteckt den Hinweis; die neue Version wird dann beim nächsten kompletten Neustart der App aktiv.

Für jedes Release bitte den Cache-Namen in `sw.js` erhöhen, z. B. `eskyna-estyle-pwa-v12` → `eskyna-estyle-pwa-v13`.
