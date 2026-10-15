# çilek 🍓

İki kişilik sesli/görüntülü görüşme uygulaması. Tarayıcıdan açılır, telefona ve bilgisayara **uygulama olarak yüklenebilir** (PWA).

## Özellikler

- **Ses:** yankı engelleme, gürültü engelleme (destekleyen tarayıcıda ses yalıtımı), otomatik ses seviyesi, mikrofon kazancı (%0–200), kişi başına ses ayarı, sağırlaştırma
- **Kamera:** 10 filtre, **portre modu** (arka plan bulanıklaştırma), güçlü bulanıklık, çilek arka planı, ışık ayarı, cilt yumuşatma, fotoğraf çekme, ön/arka kamera değiştirme, 360p/720p/1080p kalite
- **Ekran paylaşımı:** 720p–1440p, 15–60 fps, sistem sesi (görüşmenin kendi sesi geri gönderilmez)
- **Sohbet:** zaman damgası, tıklanabilir bağlantılar, okunmamış sayacı
- **Tepkiler:** 👍 ❤️ 😂 😮 👏 🍓 🎉 😢
- **Oda:** 6 haneli kod, iki kişide kilitlenir, üçüncü kişi tek kullanımlık davetle girer
- Cihaz seçimi (mikrofon, kamera, hoparlör), bağlantı kalitesi göstergesi, pencere içinde oynatma, tam ekran
- Açık/koyu tema, mobil uyumlu arayüz, klavye kısayolları (M, V, D, E, C, Esc)
- Ağ koparsa otomatik yeniden bağlanma; sayfa yenilenince aynı odaya dönüş

## Çalıştırma

Node.js 20 veya üstü gerekir.

```bash
npm install
npm run build
npm start
```

Windows sunucuda `start.bat`, macOS/Linux'ta `./start.sh` aynı adımları yapar.

Geliştirme için `npm run dev` (http://localhost:5173).

## Ayarlar (ortam değişkenleri ya da `.env` dosyası)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `38471` | Web sunucusu portu |
| `HOST` | `0.0.0.0` | Dinlenecek arayüz |
| `PUBLIC_HOST` | otomatik | Boşsa sunucu kendi dış IP'sini bulur; bulunamazsa `13.53.198.78`. Elle IP veya alan adı da verilebilir. Sertifika ve TURN için |
| `CERT_FILE`, `KEY_FILE` | — | Gerçek TLS sertifikası (ör. Let's Encrypt) |
| `HTTPS` | `1` | `0` yapılırsa düz HTTP (Caddy/Nginx gibi bir ters vekil arkasında) |
| `TURN` | `1` | Dahili TURN sunucusu (`0` kapatır) |
| `TURN_PORT`, `TURN_USER`, `TURN_PASS` | `3478`, `cilek`, `cilek-ses` | TURN ayarları |
| `TURN_MIN_PORT`, `TURN_MAX_PORT` | `49160`, `49180` | TURN aktarım portları (UDP) |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | — | Cloudflare TURN anahtarı (aşağıya bak) |
| `CF_TURN_TTL` | `86400` | Cloudflare kimlik süresi (saniye) |
| `ICE_SERVERS` | — | Kendi STUN/TURN listen (JSON ya da JSON dosya yolu) |

## Cloudflare TURN (önerilir)

İki kişi doğrudan bağlanamadığında (sıkı NAT, kurumsal ağ, mobil hat) görüntü bir TURN sunucusundan geçer. Cloudflare'in TURN ağı hızlı ve dünyanın her yerinde yakın bir noktası var; yerel TURN yalnızca yedek olarak bekler.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Realtime** → **TURN Server** → **Create** ile bir anahtar oluştur.
2. Verilen **Turn Token ID** ve **API Token**'ı proje klasöründeki `.env` dosyasına yaz (`.env.example`'ı kopyala):

   ```
   CF_TURN_KEY_ID=...
   CF_TURN_API_TOKEN=...
   ```

3. Sunucuyu yeniden başlat. Konsolda `Cloudflare TURN hazır.` yazmalı.

Kontrol: `https://ADRES:PORT/healthz` adresinde `"turn":"cloudflare","cloudflareReady":true` görünmeli. Görüşmede doğrudan bağlantı kurulamazsa Kişiler panelinde **TURN** etiketi çıkar.

API anahtarı yalnızca sunucuda kalır; tarayıcıya 24 saat geçerli, kısa ömürlü kimlikler verilir (6 saatte bir yenilenir). Cloudflare'e ulaşılamazsa uygulama otomatik olarak yerel TURN'e döner.

## Uygulama olarak yükleme

Tarayıcılar uygulama yüklemeye yalnızca **geçerli bir sertifikayla** izin verir. Kendinden imzalı sertifikada (varsayılan) site çalışır ama "Yükle" seçeneği çıkmaz.

En kolay yol bir alan adı ve Let's Encrypt:

1. Bir alan adını sunucunun IP'sine yönlendir (alan adın yoksa `13-53-198-78.sslip.io` gibi ücretsiz bir ad da olur).
2. Sertifikayı al (ör. `certbot` ya da Windows'ta `win-acme`).
3. `CERT_FILE` ve `KEY_FILE` ile başlat ve `PUBLIC_HOST`'u alan adı yap.

Sonra:

- **Android / Chrome / Edge:** lobideki "Uygulamayı yükle" düğmesi ya da tarayıcı menüsü
- **iPhone / iPad:** Safari → Paylaş → Ana Ekrana Ekle
- **Windows / macOS:** adres çubuğundaki yükle simgesi

## Portre modu

Arka plan efektleri MediaPipe ile cihazda çalışır; görüntü hiçbir sunucuya gönderilmez. Modül yalnızca portre modu seçilince yüklenir. Model varsayılan olarak Google'ın deposundan indirilir. Kendi sunucunda barındırmak için:

```bash
npm run fetch-model
npm run build
```

## Notlar

- Kamera ve mikrofon yalnızca `https://` (ya da `localhost`) üzerinde çalışır.
- En iyi yankı engelleme için hoparlör yerine kulaklık önerilir; yankı engelleme ayarlardan kapatılmamalıdır.
- Ekran paylaşımı mobil tarayıcılarda desteklenmez; düğme orada gizlenir.
