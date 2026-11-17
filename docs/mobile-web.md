# Veyra mobile web / iPhone

The application is served by FastAPI, not Vite. `mobile.css` is loaded after the
existing stylesheets; its layout rules apply only at **600 CSS pixels or less**,
matching the project's existing phone breakpoint. Larger tablet and desktop
layouts keep their original styles and markup. `mobile.js` handles presentation
and format feedback only. `app.js` still owns sign-in, email OTP, session storage,
account state, all API calls, payments, profile and sign-out.

The dock presents the existing balance/activity/card sections without duplicating
financial state. Profile opens the existing modal. Home includes savings spaces.
The avatar follows the existing profile renderer. Resizing back to a phone resets
the dock to Home. Modals remain scrollable while the on-screen keyboard is open;
inputs use at least 16px text to avoid iOS focus zoom. Zoom remains enabled.

Face ID is an explicitly inactive visual placeholder. There is no biometric or
passkey authentication implementation. The interface is installable as a Home
Screen web app; there is no service worker, offline financial cache or offline
payment queue. Financial operations still require the backend connection. A saved
session is restored by the existing authentication flow; a fresh Home Screen
launch opens the existing sign-in flow on phones.

## Exact head tags

These tags are already integrated into `app/static/index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Veyra">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/static/manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="/static/assets/apple-touch-icon.png">
```

The `black-translucent` status bar keeps the system status indicators over the
page. CSS protects controls with `env(safe-area-inset-top)` and
`env(safe-area-inset-bottom)`; standalone mode removes Safari navigation chrome,
not the iOS status bar or home indicator. Regular Safari tabs retain browser UI.

The complete manifest at `app/static/manifest.webmanifest` is:

```json
{
  "id": "/",
  "name": "Veyra — Your money, in perspective",
  "short_name": "Veyra",
  "description": "Your currencies, transfers and savings in one workspace.",
  "lang": "en",
  "start_url": "/?launch=app#workspace",
  "scope": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    {"src": "/static/assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "/static/assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}
  ]
}
```

PNG icons are included at 180, 192 and 512px, with an opaque background and a mark
inside the maskable safe zone. No extra package or frontend build is needed.

References: [Apple web app configuration](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
and [Apple's iPhone Home Screen instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios).

## iPhone üzerinde adım adım test

1. Bilgisayar ve iPhone'u aynı Wi-Fi ağına bağla. Docker Desktop'ı aç ve Linux
   engine hazır olana kadar bekle. Proje klasöründe PowerShell aç:

   ```powershell
   Set-Location 'D:\AI Projects\bank-core'
   docker compose -f docker-compose.yml -f docker-compose.mobile.yml up -d --build --wait
   ```

   Uvicorn konteyner içinde zaten `--host 0.0.0.0 --port 8000` kullanıyor.
   Normal Compose yalnızca bilgisayardaki `127.0.0.1:8000` adresini açar. Ek dosya,
   uygulamayı telefon için `0.0.0.0:8001` üzerinden de açar; PostgreSQL, Redis ve
   Mailpit'in yerel bağlantılarını değiştirmez. Bu dosya yalnızca bu komutta etkin.

2. Bilgisayarın Wi-Fi IPv4 adresini bul:

   ```powershell
   ipconfig
   ```

   **Wireless LAN adapter Wi-Fi → IPv4 Address** satırını kullan; örneğin
   `192.168.1.42`. Docker/WSL/VPN sanal adaptörünü veya `127.0.0.1` adresini alma.
   İstersen yalnızca bu arayüze bağlanmak için başlatmadan önce
   `$env:VEYRA_PHONE_IP = '192.168.1.42'` ayarla.

3. iPhone Safari'de `http://192.168.1.42:8001` adresini aç; örnekteki IP yerine
   kendi IPv4 adresini yaz. Demo ile gezinmeyi kontrol et veya geliştirme hesabınla
   giriş yap. Mailpit bilgisayarda `http://localhost:8025` üzerinden erişilebilir.
   Yerel HTTP yalnızca geliştirme testi içindir; gerçek kullanımda HTTPS gerekir.
   Uygulamayı Docker kullanmadan çalıştırıyorsan mevcut PostgreSQL/Redis ortamın
   hazırken şu komutu kullan (bu durumda telefonda port `8000`):

   ```powershell
   .\venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

4. Sayfa açılmazsa önce bilgisayarda `http://localhost:8001` adresini kontrol et.
   VPN/proxy veya misafir ağının cihaz izolasyonu bağlantıyı engelleyebilir.
   Gerekirse Windows Güvenlik Duvarı'nda yalnızca özel ağ ve TCP 8001 için erişim
   izni ver; güvenlik duvarını kapatma.

5. Safari'de **Paylaş / Share → Ana Ekrana Ekle / Add to Home Screen** seç.
   Yeni iOS sürümlerinde **Web Uygulaması Olarak Aç / Open as Web App** seçeneğini
   açık tut. Adı **Veyra** olarak bırak ve **Ekle / Add** düğmesine dokun.

6. Safari'den çık, Ana Ekran'daki Veyra simgesine dokun. Adres çubuğu olmadan
   standalone açılışı, çentik/Dynamic Island altındaki üst boşluğu ve home
   indicator üzerindeki dock boşluğunu kontrol et. Eski bir kısayolu kullanıyorsan
   manifest ve ikonların yenilenmesi için kısayolu kaldırıp tekrar ekle.

7. 320–440px genişliklerde açık/koyu tema, giriş hataları, Show/Hide, yüklenme,
   OTP, klavye açıkken formun altına erişim, dock, kart kontrolleri, Spaces,
   profil ve çıkışı test et. 768px tablet ve 1280/1440px masaüstünde mevcut
   kenar menüsü, grid ve giriş penceresini kontrol et. Telefon yatayda 600px'i
   aştığında mevcut tablet düzenine döner; bu, tablet görünümünü koruyan sınırdır.

8. Test bitince ek Wi-Fi portunu kaldırıp normal yerel düzene dön:

   ```powershell
   docker compose -f docker-compose.yml up -d --force-recreate api
   ```

   Bu komut veritabanı volume'larını silmez. Geliştirme sunucusunu ve bilgisayarı
   açık tut; Home Screen uygulaması da aynı yerel sunucuya bağlanır.
