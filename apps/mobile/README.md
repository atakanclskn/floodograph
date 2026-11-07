# Floodograph Mobil

Expo SDK 58 + expo-router + TypeScript. Hibrit ilk sürüm: ana ekran, pilot bölge kartı ve kademe özeti yerel
ekranlar; sel analiz haritası `https://floodograph.vercel.app/demo` sayfasının WebView içinde açılmış hâli.
Native modül eklenmedi, yani uygulama olduğu gibi **Expo Go** içinde çalışır.

| Ekran | Dosya | Ne yapar |
| --- | --- | --- |
| Ana ekran | `app/index.tsx` | Logo, kısa tanıtım, "Haritayı aç", pilot bölge kartı, kademe özeti (aşağı çekince yenilenir) |
| Harita | `app/harita.tsx` | `/demo` WebView, yükleme göstergesi, hata ekranı, Android geri tuşu, yeniden yükle |

Veri: `@floodograph/core` içindeki `SupabaseFloodRepository` (`listCities`, `listScenarios`, `summary`).
Senaryo yüklüyse kademeler `get_scenario_summary` RPC'sinden, değilse binaları indirmeden dört sayım
sorgusuyla (`HEAD`, `count=exact`) `HAND_THRESHOLDS` kurallarına göre gelir. Anahtar, herkese açık
publishable anahtardır, RLS ile salt okumadır. İstenirse `EXPO_PUBLIC_SUPABASE_URL` ve
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ortam değişkenleriyle değiştirilebilir.

## Kurulum

Bağımlılıklar monorepo kökünden kurulur (npm workspaces):

```bash
# repo kökünde
npm install
```

## Expo Go ile açma (iOS ve Android)

1. Telefona **Expo Go** uygulamasını kur (App Store / Google Play). SDK 58 destekleyen güncel sürüm olmalı.
2. Bilgisayarda:

   ```bash
   cd apps/mobile
   npx expo start
   ```

3. Terminalde çıkan QR kodu okut:
   - **iOS:** Kamera uygulamasıyla okut, "Expo Go'da aç" bildirimine dokun.
   - **Android:** Expo Go içindeki "Scan QR code" ile okut.
4. Telefon ve bilgisayar aynı Wi-Fi ağında olmalı. Farklı ağdaysanız ya da kurum ağı engelliyorsa:

   ```bash
   npx expo start --tunnel
   ```

   (İlk seferde `@expo/ngrok` kurulmasını ister, onaylayın.)

Tarayıcıda hızlı bakış için `npx expo start --web` (harita burada iframe ile açılır).

## Android APK alma (EAS bulut derlemesi)

Yerel Android SDK ya da Java gerekmez, derleme Expo sunucularında yapılır. Ücretsiz bir Expo hesabı yeterli.

> Not: CLI paketinin adı `eas-cli`. `npx eas ...` yazmayın; npm'de `eas` adlı alakasız bir paket var.

```bash
cd apps/mobile

# 1. Giriş (hesap yoksa https://expo.dev/signup)
npx eas-cli@latest login

# 2. APK derlemesi (preview profili, buildType: apk)
npx eas-cli@latest build -p android --profile preview
```

- İlk derlemede EAS, projeyi hesabınıza bağlamayı ve `app.json` içine `extra.eas.projectId` ile `owner`
  yazmayı sorar: **Evet** deyin, sonra bu değişikliği commit'leyin.
- Android imzalama anahtarı sorulduğunda "Generate a new Android Keystore" seçin, EAS saklar.
- Derleme 10-20 dakika sürer. Bitince terminalde ve https://expo.dev üzerinde APK indirme bağlantısı ve QR
  kodu çıkar. Telefonda bağlantıyı açıp APK'yı indirin, "bilinmeyen kaynaklardan yükleme" iznini verin.
- Kısayol: `npm run build:apk -w @floodograph/mobile` (aynı komut; önce giriş yapılmış olmalı).

Profiller (`eas.json`):

| Profil | Çıktı | Kullanım |
| --- | --- | --- |
| `preview` | Android `.apk`, internal dağıtım | Jüri ve ekip telefonlarına doğrudan kurulum |
| `production` | Android `.aab` | İleride Play Store |
| `development` | Dev client | Native modül eklenirse |

Uygulama kimliği: ad `Floodograph`, slug `floodograph`, paket `app.floodograph.mobile` (iOS bundle id aynı).

## Kontroller

```bash
cd apps/mobile
npx tsc --noEmit                       # tip denetimi
npx expo-doctor                        # bkz. bilinen uyarı
npx expo export --platform android     # paketlemenin hatasız olduğunu doğrular
```

## Monorepo notları

- `@floodograph/core` doğrudan `packages/core/src` TypeScript kaynağından derlenir. Expo SDK 52+ Metro
  ayarı workspace kökünü kendiliğinden izlediği için ek `watchFolders` gerekmez.
- **Bilinen `expo-doctor` uyarısı (bilerek bırakıldı):** "duplicate dependencies: react, react-dom".
  `apps/web` kökte `react@latest` (19.3.1) kullanıyor, React Native ise tam olarak Expo'nun sabitlediği
  19.3.0'ı istiyor (renderer sürüm eşleşmesini denetler). Mobil kopya `apps/mobile/node_modules` altında
  durur ve `metro.config.js` her `react` / `react-dom` içe aktarımını bu kopyaya yönlendirir; paketlenmiş
  Android, iOS ve web çıktılarında yalnızca 19.3.0 bulunduğu doğrulandı. React native modül olmadığı için
  APK derlemesini etkilemez. Web de 19.3.0'a sabitlenirse uyarı kendiliğinden kalkar.
