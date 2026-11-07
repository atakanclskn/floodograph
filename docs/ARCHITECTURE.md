# Floodograph: Teknik Mimari Planı

## Bağlam

Floodograph, üstü kapatılmış dereleri yükseklik verisinden yeniden bulan ve 14 Ekim 2026 İstanbul selini gerçek yağışla saat saat 3D haritada yeniden oynatan bir sel analiz platformu. Aynı yağış İzmir ve Ankara'ya da uygulanabilecek, sonuçta aciliyet kademeli bir müdahale listesi çıkacak.

**Şu anki durum:**
- Repo `github.com/atakanclskn/floodograph` yalnızca bir iskelet: README, logo, LICENSE, .gitignore, .env.example.
- Supabase projesi `floodograph` (id `bzohunvpkzjidqzydwmr`, Paris) açık ama boş. PostGIS kurulu değil.
- Vercel projesi `floodograph` açık. MCP erişimi `atakanclskns-projects` kapsamı için yetki istiyor.

**Ekibin kararları:**
- Arayüz Next.js ve TypeScript.
- Mobil: web, Android APK ve iOS (ilk aşamada basit bir Expo sürümü).
- **Her araç ve kütüphanenin son kararlı sürümü kullanılacak.** Kurulumda `npm view <paket> version` ve `uv pip index versions` ile o anki en güncel sürüm alınır. Planda sürüm numarası sabitlenmez.
- **Varsayılan görünüm:** sade, izohipsli (kontur çizgili) bir arazi haritası.
- **Şov noktası: sinematik 3D sel sahnesi.** Su 3D ve akıcı biçimde süzülecek. Akıntıya kapılan moloz ve araçlar suyun üstünde yüzecek, su binalara çarpınca köpürecek.
- Veri PostgreSQL ve PostGIS'te, **gerçekçi su akışı öncelikli.**
- **Tasarım asla varsayılan "hazır AI" görünümünde olmayacak.** Örnek alınacaklar: Apple Liquid Glass, Fluent Design, shadcn/ui, React Bits. Bol ama minimal mikro animasyon ve yerinde sayfa geçişleri olacak.
- Python hesaplama hattını Claude yazacak, ekip inceleyecek.
- Zaman planını Atakan yönetiyor. Bu plan iş sırası ve kapsamı içerir, saat içermez.

**Yerel araçlar:**
- Python 3.15: pysheds, numba ve rasterio için çok yeni. `uv` ile ayrı bir Python 3.12 kurulacak.
- Node 24 ve npm 11 var. pnpm yok, **npm workspaces** kullanılacak.
- Java ve Android SDK yok. **APK, EAS bulut derlemesiyle** alınacak.

---

## 0. Katman bazında araç seçimleri (ücretsiz öncelikli, 7 Kasım güncellemesi)

| Katman | Seçim | Neden |
| --- | --- | --- |
| Harita motoru | **MapLibre GL JS 6** | Açık kaynak, ücretsiz, anahtar ve kota yok. 3D arazi, küre ve three.js özel katmanı destekli. Mapbox GL JS'in açık çatalı. |
| Temel harita | **OpenFreeMap** vektör karoları, kendi stilimiz | Ücretsiz, anahtarsız, sınırsız |
| İzohips | **maplibre-contour**, yükseklik karolarından tarayıcıda | Ek sunucu yok, istenen aralıkta kontur |
| 3D arazi karoları | Ücretsiz Terrarium/Mapterhorn yükseklik karoları | Anahtarsız |
| Hesap DEM'i | **FABDEM** (bina ve ağaçlardan arındırılmış), yedek Copernicus GLO-30 | Copernicus bir yüzey modeli. Binalar zaten içinde olduğundan şehirde selin yönünü bozar. |
| Uydu (isteğe bağlı) | Esri World Imagery ya da Sentinel-2 cloudless | Ücretsiz atıf ile. Gerekirse sonra. |
| Yağış | Open-Meteo (arşiv, geçmiş tahmin, tahmin) | Ücretsiz, anahtarsız |

## 0b. HEC-RAS ile konumlanma (7 Kasım)

**Hedef:** HEC-RAS'ın 2D çekirdeğine olabildiğince yaklaşmak: tam sığ su denklemleri, rain-on-grid, sızma ve menfezler. Ayrışacağımız yerler ise Türkiye'ye özel otomatik kurulum ve 3D sunum.

| | HEC-RAS 6.6 (kararlı) | HEC-RAS 2025 (beta, Nisan 2026'dan beri) | Floodograph |
| --- | --- | --- | --- |
| 2D denklemler | Diffusion wave ve tam SWE | Yeni açık (explicit) motor, GPU yol haritasında | Tam SWE (HLL ve hidrostatik yeniden yapılandırma), yedek local inertial |
| Rain-on-grid | Var | 2026 yol haritasında | Var |
| Menfez ve köprü | Var (ayrıntılı) | 2026–2027 yol haritasında | Basitleştirilmiş menfez ağı (kapasite ve taşma) |
| Model kurulumu | Uzman elle, saatler ya da günler sürer | Aynı | **Otomatik:** `cities.yaml`'a bir satır yazınca DEM, bina, arazi örtüsü ve yağış açık veriden gelir |
| Platform | Masaüstü (Windows) | Linux ve konteyner | **Tarayıcı ve mobil**, kurulum yok |
| Sonuç sunumu | 2D harita (RAS Mapper) | Aynı | **Sinematik 3D**, saat saat oynatma, aciliyet kademeleri |
| Doğrulama verisi | Kullanıcı getirir | Aynı | Haberlerden otomatik (YZ) ve uydu taşkın haritası |

**Dürüst sınır:** HEC-RAS 30 yılı aşkın birikim taşıyor: düzensiz ağ (mesh), 1D-2D bağlaşımı, ayrıntılı yapılar, sediment taşınımı. Bunların hepsini yapmıyoruz. Çekirdek denklemleri aynı sınıftan çözüyoruz ve bunu analitik testlerle kanıtlıyoruz.

**İsteğe bağlı kıyas:** Ekipten biri HEC-RAS 6.6'yı biliyorsa (ücretsiz, Windows), aynı 5x5 km Ayazağa kurgusu HEC-RAS'ta da çalıştırılır. İki derinlik haritası arasındaki IoU, "endüstri standardına karşı doğrulama" olarak sunulur.

## 1. Repo yapısı (monorepo, npm workspaces)

```
floodograph/
  apps/web/          Next.js (son sürüm, App Router) + TS + MapLibre GL JS + three.js   → Vercel (root: apps/web)
  apps/mobile/       Expo (son SDK) + expo-router + TS                           → EAS: Android APK, iOS Expo Go
  packages/core/     Ortak TS: tipler, FloodRepository, RainSource, zaman çizelgesi, kademe kuralları
  pipeline/          Python 3.12 (uv): veri hattı ve 2D sel modeli
  supabase/migrations/  SQL şema, RLS ve RPC'ler (repoda versiyonlu)
  docs/  assets/
```

Mevcut boş `backend/` ve `frontend/` klasörleri `pipeline/` ve `apps/web/` olarak yeniden adlandırılır.

---

## 2. Hesaplama hattı (`pipeline/`, Python)

### Mimari: hafif hexagonal yapı ve Pipes & Filters

```
pipeline/floodograph/
  domain/      dataclass'lar: City, Grid(dem, transform, crs), RainSeries, ScenarioResult
  ports.py     Protocol'ler: DemSource, BuildingSource, LandCoverSource, RainSource, ResultStore
  adapters/    copernicus_dem.py (AWS açık COG), osm.py (osmnx: binalar, kritik tesisler, waterway tunnel=culvert),
               worldcover.py (ESA 10 m), open_meteo.py (arşiv, geçmiş tahmin, tahmin), postgis_store.py (psycopg COPY)
  core/        hydrology.py (koşullandırma, D8, birikim, HAND; pysheds)
               flood2d.py (local inertial 2D model, numba)
               culverts.py (gömülü dere ve menfez ağı)
               vectorize.py (derinlik bantları → poligon, akış vektörleri)
               tiers.py (aciliyet kademeleri)
               validation.py (haber noktası isabeti)
  pipeline/    steps.py (her adım saf fonksiyon; diskte önbellek @cached(adım, parametre özeti))
  cli.py       python -m floodograph run --city istanbul --scenario oct14
cities.yaml   ad, sınır kutusu, EPSG (İstanbul ve İzmir 32635, Ankara 32636), çözünürlük
```

**Desenler:**
- **Ports & Adapters:** Çekirdek saf numpy, dosya ya da ağ bilmez.
- **Strategy:** `RainSource` ve `FloodModel` (`LocalInertialModel`, yedek olarak `HandFillModel`).
- **Pipes & Filters:** Önbellekli adımlar.
- **Repository:** `ResultStore`, yani `PostgisStore` ya da yerel GeoJSON için `LocalStore`.
- **Config ile şehir kaydı:** `cities.yaml`.

### Gerçekçi su akışı modeli

1. **Izgara:**
   - **FABDEM** (Copernicus GLO-30'dan bina ve ağaçları arındırılmış çıplak zemin modeli, ücretsiz, CC BY-NC-SA). Erişilemezse Copernicus GLO-30 ve bina maskesi kullanılır. UTM'ye projekte edilir ve **10 m'ye yeniden örneklenir.** Bu yeni bilgi eklemez, ama binaların engel olarak çizilebilmesini sağlar.
   - OSM bina izleri engel olarak işlenir ("building-block" yöntemi): o hücrelere bina yüksekliği eklenir.
   - Bina yüksekliği OSM'deki `building:levels` × 3 m, etiket yoksa 9 m.
2. **Akış ağı ve HAND:** Çukurları doldurulmuş 30 m DEM üzerinde D8 akış yönü, birikim ve HAND hesaplanır. Bir hücreye yaklaşık 0,3 km²'den fazla alan akıyorsa orası koridor sayılır.
3. **Gömülü dereler:**
   - OSM'de `waterway=* + tunnel=culvert` olarak işaretli kapalı dereler gerçek veridir.
   - Türetilen koridorlardan açık bir dereyle örtüşmeyenler "gömülü dere adayı" olarak işaretlenir.
4. **2D model: tam sığ su denklemleri (HEC-RAS sınıfı çekirdek).**
   - **Ana çözücü:** Yapılandırılmış ızgarada sonlu hacim yöntemi, HLL Riemann çözücüsü ve **hidrostatik yeniden yapılandırma** (Audusse vd. 2004). Bu "durgun suyu" bozmayan (well-balanced) şema, ıslak-kuru sınırları ve dik sokaklarda oluşan hızlı (süperkritik) akışı doğru çözer. Ayazağa vadisi dik olduğu için bu önemli.
   - **Kaynak terimleri:** Yağış (rain-on-grid), Manning sürtünmesi (yarı kapalı/semi-implicit), sızma ve yağmur suyu kanalı kaybı.
   - **Zaman adımı:** CFL 0,45 ile uyarlanır. numba ile paralel çalışır.
   - **Yedek:** Local inertial (Bates 2010, de Almeida 2012) aynı `FloodModel` arayüzüyle. HEC-RAS'taki "diffusion wave" seçeneğinin karşılığı, hızlı tarama için.
   - **Manning katsayısı** arazi örtüsüne (WorldCover) göre: beton yaklaşık 0,015–0,03, bitki örtüsü 0,05–0,1.
   - **Sınırlar:** Kenarlardan su serbestçe çıkar, deniz hücreleri suyu yutar.
   - **Doğrulama testleri** (HEC-RAS'ın kendi doğrulama setinde de kullanılan klasik çözümler):
     - Ritter baraj yıkılması analitik çözümü
     - Durgun göl (well-balanced) testi
     - Thacker salınımı
     - Kütle korunumu
5. **Kayıplar:**
   - Arazi örtüsüne göre sabit bir sızma hızı (mm/saat).
   - Yapılaşmış alanlarda bir yağmur suyu kanalı kapasitesi (parametre, örneğin 20 mm/saat).
6. **Menfez ağı (gerçekçiliğin anahtarı):**
   - Gömülü dere hücreleri, kendi kapasitesine (`Q_cap`, m³/s) kadar suyu yeraltından aşağı akışa taşır.
   - Kapasiteyi aşan su yüzeye çıkar. O an "**dere taştı**" olayı olarak zamanıyla kaydedilir.
   - Bu basitleştirilmiş bir 1D-2D bağlaşımıdır.
7. **Çıktılar (5 dakikada bir, arayüz kareler arasında yumuşak geçiş yapar):**
   - **3D sahne için ızgara kareleri:** Su derinliği ve hız (u, v), 10 m ızgarada. Her kare tek bir sıkıştırılmış ikili dosya (float16, zstd ya da 16 bit PNG kodlaması), Supabase Storage'da. 5x5 km'de bir kare yaklaşık 250 bin hücre, sıkıştırılmış birkaç yüz KB.
   - Derinlik bantları (0,05, 0,15, 0,3, 0,5, 1 ve 2 m) poligon olarak PostGIS'te. Sorgu, istatistik ve izohips görünümündeki sade su katmanı için.
   - **Çarpma noktaları:** Bina kenarına bitişik, hızı ve derinliği yüksek hücreler (köpük ve sıçrama efekti için) her karede küçük bir liste olarak.
   - Her bina için ilk ıslandığı dakika (komşu hücrede derinlik 0,15 m'yi aşınca) ve en yüksek su seviyesi.
   - Koridor taşma olayları.
   - Toplam yağış (mm ve m³).
   - Kütle dengesi raporu.
8. **Kalibrasyon ve doğrulama:**
   - `Q_cap` ve kanal kapasitesi, haberlerdeki 15–20 su basan noktaya ve bildirilen başlangıç saatine göre ayarlanır.
   - İsabet oranı senaryonun `metrics` alanına yazılır.

### Yağış kaynakları (Strategy)

- **`HistoricalRain`:** Open-Meteo geçmiş tahmin verisi (en iyi model). Gerekirse ERA5 arşivine düşer. Saatlik veri 10 dakikaya bölünür.
- **`DesignStormRain`:** Toplamı 20, 40, 60, 80, 100 ve 150 mm olan 6 saatlik tasarım yağışları (alternatif blok yağış dağılımı). Web'deki kaydırıcı bu **önceden hesaplanmış senaryo merdiveninde** gezinir, bu yüzden kaydırıcı da gerçek modeli gösterir.
- **`LiveRain`:** Open-Meteo'nun önümüzdeki 24 saatlik tahmini. Toplamına en yakın merdiven senaryosu seçilir, gerçek tahmin serisi de grafikte gösterilir.
- **Transfer senaryosu:** 14 Ekim serisi İzmir ve Ankara ızgaralarına uygulanır.

---

## 3. Veritabanı (Supabase Postgres ve PostGIS)

**Migration'lar** `supabase/migrations/` altında repoda tutulur ve Supabase MCP'deki `apply_migration` ile uygulanır.

**Eklenti:** `postgis`.

| Tablo | İçerik |
| --- | --- |
| `cities` | id, name, epsg, bbox (Polygon 4326), center, res_m |
| `scenarios` | id, city_id, kind (historical, design, live), label, rain_source, start_ts, step_min, duration_min, total_mm, total_m3, params jsonb, metrics jsonb |
| `rain_series` | scenario_id, t_min, mm |
| `buildings` | id, city_id, osm_id, geom (MultiPolygon), height_m, hand_m, critical (hastane, okul, itfaiye, bakımevi ya da boş) |
| `building_impacts` | scenario_id, building_id, first_wet_min, max_depth_m, tier |
| `corridors` | id, city_id, geom (LineString), kind (buried_osm, derived, open), upstream_km2, min_hand, tier, buildings_at_risk, critical_count |
| `corridor_events` | scenario_id, corridor_id, overflow_start_min, peak_q, capacity_q |
| `water_frames` | scenario_id, t_min, band, depth_min, depth_max, geom (MultiPolygon). GiST indeksli. |
| `grid_frames` | scenario_id, t_min, storage_path (Storage'daki ikili kare), max_depth, wet_cells. Izgara meta verisi (origin, dx, nx, ny, kodlama ölçeği) `scenarios.params` içinde. |
| `impact_points` | scenario_id, t_min, geom (Point), speed, depth (binaya çarpma ve köpük noktaları) |
| `validation_points` | id, city_id, scenario_id, name, geom, source_url, reported_ts, hit, distance_m |

**RPC'ler** (SQL fonksiyonları, `security invoker`, GeoJSON döner, koordinatlar 6 haneli, geometri sadeleştirilmiş):
- `get_buildings(city, scenario)`
- `get_water_frames(scenario, t_from, t_to)`
- `get_grid_frames(scenario)`: kare listesi ve Storage yolları
- `get_scenario_summary(scenario)`: toplamlar, kademe sayıları, koridor listesi, taşma olayları

**Storage:**
- `frames` adlı herkese açık okuma bucket'ı: `frames/{scenario}/{t_min}.bin`.
- Yükleme yalnızca `service_role` ile.

**Güvenlik:**
- Tüm tablolarda RLS açık. Yalnızca `anon` ve `authenticated` için okuma (`select`) politikası var.
- Yazma yalnızca `service_role` ve doğrudan veritabanı bağlantısıyla, sadece yerel hat betiğinden.
- Arayüzde yalnızca publishable/anon anahtar kullanılır.

**Kapasite tahmini:**
- **Veritabanı:** Şehir başına yaklaşık 15 bin bina ve bant poligonları. 500 MB sınırının altında kalır.
- **Storage:** Senaryo başına 18 saat için yaklaşık 216 kare, kare başına birkaç yüz KB, yani senaryo başına yaklaşık 50–100 MB. Ücretsiz katman 1 GB. Bu yüzden ızgara kareleri yalnızca sinematik senaryolar için üretilir (İstanbul 14 Ekim ve şehir başına bir transfer senaryosu). Merdiven senaryoları yalnızca bant ve bina etkisi üretir.
- Her yüklemede boyut kontrol edilir.

---

## 4. Web (`apps/web`, Next.js)

**Sayfalar:**
- `/`: tanıtım
- `/map`: ana uygulama
- `/embed`: mobil WebView için çerçevesiz harita, `postMessage` köprüsüyle

**Bileşenler:**
- `FloodMap`: istemci tarafı, `dynamic(..., {ssr:false})`
- `TimelinePlayer`
- `RainChart` (Recharts)
- `CityScenarioPicker`
- `TierPanel`
- `BuildingPopup`
- `ValidationOverlay`

**İki görünüm** (`MapController` facade'ı ile yönetilir, React bileşenleri mapbox ya da three API'sine doğrudan dokunmaz):

**a) Analiz görünümü (varsayılan): izohipsli arazi haritası**
- Kendi minimal stilimiz (kod içi stil JSON), OpenFreeMap vektör karoları üzerinde. Hazır stil kullanılmaz.
- İzohipsler `maplibre-contour` ile ücretsiz yükseklik karolarından tarayıcıda üretilir. Hafif tepe gölgesi, sade renk paleti.
- Koridorlar ve gömülü dereler animasyonlu çizgiler. Binalar düz, kademe rengine göre.
- PostGIS'ten gelen derinlik bantları sade su katmanı olarak.
- Kademe paneli, yağış grafiği ve zaman çizelgesi.

**b) Sinematik görünüm (şov noktası): 3D sel sahnesi**
- MapLibre `CustomLayerInterface` içinde, aynı WebGL2 bağlamını paylaşan **three.js**. Arazi ücretsiz yükseklik karolarından MapLibre terrain olarak gelir, su ve binalar three.js'te çizilir.
- **Su yüzeyi:** Izgara karesinden üretilen yükseklik alanı ağı. Köşe yüksekliği = `queryTerrainElevation` + derinlik.
  - Kareler arası zaman enterpolasyonu sayesinde su kesintisiz yükselir ve çekilir.
  - Özel shader: hız alanıyla sürüklenen normal haritaları (flow map) sayesinde su akış yönünde süzülür.
  - Fresnel yansıması, derinliğe göre renk ve bulanıklık (sığ yerde kahverengi-çamurlu, derinde koyu).
- **Köpük ve sıçrama:** Hızın yüksek olduğu ve suyun binaya çarptığı hücrelerde (`impact_points`) köpük dokusu ve küçük sıçrama parçacıkları.
- **Sürüklenen nesneler:** Araba, moloz, kütük ve çöp kutusu düşük poligonlu modelleri `InstancedMesh` ile çizilir.
  - Hız alanında taşınırlar (adveksiyon), su yüzeyinde inip kalkar ve dönerler.
  - Su derinliği eşiği aşınca park halindeki araçlar (OSM otopark ve yol kenarı örneklemesi) yerinden kalkar.
- **Binalar:** three.js'te ekstrüde edilir. Islandıkça zemin kat hizasında ıslaklık ve renk geçişi.
- **Kamera:** Önceden tanımlı sinematik yollar (14 Ekim hikâyesi: genel görünüş → Ayazağa koridoru → taşma anı), serbest gezinme.
- **Performans:** LOD, kare dosyalarının önceden yüklenmesi, `requestAnimationFrame` ile ayrık simülasyon saati. Mobilde daha düşük çözünürlüklü ağ ve daha az nesne.
- **Dürüstlük notu:** Sürüklenen nesneler ve köpük görsel temsildir. Modelin hız ve derinlik alanına bağlıdır, ama nesne hasarı simüle edilmez. Sunumda böyle söylenir.

**Ortak katmanlar:**
- **Binalar:** Renk `fw ≤ t` ise ıslak. Kademe rengi.
- **Koridorlar:** Çizgi kalınlığı akış alanına göre, animasyonlu akış çizgisi.

**Durum ve veri:**
- Zustand: city, scenario, t, playing, mode.
- TanStack Query: önbellek ve kareleri önceden yükleme.

**Desenler:**
- **Repository:** `packages/core`'daki `FloodRepository` arayüzü ve `SupabaseFloodRepository` uygulaması.
- **Adapter:** Supabase satırları ve Open-Meteo yanıtları domain tiplerine çevrilir.
- **Strategy:** `RainSource` ve görünüm modu (14 Ekim, merdiven, anlık).
- **Observer:** Store aboneliğinden harita güncellemesine.
- **Facade:** `MapController`.
- **Bridge/Mediator:** `/embed` ile yerel uygulama arasında `postMessage` protokolü.

**PWA:** manifest ve logo ikonları, telefonda alt çekmece (bottom sheet) düzeni.

### Tasarım ilkeleri ve UI yığını (ayrıntılı görsel kararlar ayrı bir turda)

**Yasaklar (varsayılan AI görünümü):**
- Mor-mavi gradyan arka planlar.
- Hazır kahraman (hero) bölümü şablonları.
- Varsayılan gölgeli kartlar.
- Rastgele emoji ikonlar.
- Her şeyin ortalandığı sayfalar.

**Örnek alınacaklar:**
- **Apple Liquid Glass:** Haritanın üstünde yüzen, arkasını bulanıklaştıran (`backdrop-filter`) ve kenarlarında hafif kırılma olan cam paneller. Kırılma efekti SVG `feDisplacementMap` ile verilir.
- **Fluent Design:** Derinlik, ışık ve hareketin anlam taşıması. Odak ve vurgu ışığı (reveal).
- **shadcn/ui:** Erişilebilir temel bileşenler (Radix tabanlı). Kendi tasarım belirteçlerimizle (token) özelleştirilir.
- **React Bits:** Seçilmiş birkaç vurgu animasyonu (metin geçişleri, sayı sayaçları). Ölçülü kullanılır.

**Yığın (hepsi son sürüm):**
- Tailwind CSS
- shadcn/ui
- Motion (eski adı Framer Motion), mikro animasyonlar ve paylaşılan öğe geçişleri
- Sayfa geçişleri için React `ViewTransition` ve View Transitions API
- Animasyonlu sayılar ve metin için React Bits bileşenleri
- İkonlar: varsayılan set yerine ince ve tutarlı bir set (tasarım turunda seçilecek)
- Değişken font: başlık ve gövde için iki aile, tasarım turunda seçilecek

**Hareket kuralları:**
- 150–300 ms, yay (spring) eğrileri.
- `prefers-reduced-motion` desteklenir.
- Animasyonlar yalnızca durum değişimini anlatmak için kullanılır.

**Kurulacak skill'ler (ekip kartı onaylarsa):**
- `frontend-design` (Anthropic): Özgün, varsayılan AI görünümünden uzak arayüz.
- `audit-suite`: web-animation-design, make-interfaces-feel-better, emil-design-engineering, vercel-react-best-practices.
- Arayüz yazılırken bu skill'ler yüklenir ve kurallarına uyulur.

---

## 5. Mobil (`apps/mobile`, Expo)

**Hibrit MVP:** Yerel kabuk ve WebView içinde 3D harita.
- Yerel ekranlar: şehir kartları, kademe listesi (`packages/core` repository'si ile), zaman kaydırıcısı ve oynat düğmesi.
- 3D harita: `react-native-webview` içinde web'in `/embed` sayfası. Kontroller `postMessage` ile senkron.
- Native modül gerektirmediği için **iOS'ta Expo Go ile QR kodla** açılır.
- **Android APK:** EAS Build `preview` profili (`buildType: apk`), bulut derlemesi, yerel Android SDK gerekmez.
- **Sonraki adım:** WebView yerine `@rnmapbox/maps`. Özel derleme ve gizli Mapbox indirme anahtarı gerektirir.

---

## 6. Veri sözleşmesi (ekip paralel çalışabilsin diye)

- Zaman: `t_min`, senaryo başlangıcından itibaren dakika. Kare adımı 5 dakika.
- Izgara karesi: little-endian başlık (nx, ny, ölçek), ardından derinlik, u ve v için uint16 kanallar, zstd ile sıkıştırılmış. Çözücü `packages/core/frames.ts` içinde.
- Koordinatlar her yerde WGS84 (4326). Hesaplama UTM'de.
- Bina özellikleri (RPC çıktısı): `{id, h, hand, crit, fw (dk ya da null), md (m), tier}`.
- Su özellikleri: `{t, band, dmin, dmax}`.
- Kademe kodları: `acil`, `yuksek`, `orta`, `izle`. Kural `packages/core/tiers.ts` ve `pipeline/core/tiers.py` içinde aynı tabloyla tanımlı: HAND ≤ 1/2/3 m, kritik tesis +1 kademe, eşikler kalibrasyonla güncellenir.

---

## 7. İş sırası (saat yok, sıra var)

1. **Temel:** Monorepo iskeleti. Supabase migration (PostGIS, tablolar, RLS, RPC). Ortam değişkenleri. Vercel'i repoya bağlama (root `apps/web`).
2. **Hat v1 (İstanbul):** DEM → HAND → koridorlar ve gömülü dereler → binalar → yükleme. Web'de izohipsli analiz görünümü, HAND'e göre renkli binalar ve koridorlar. **İlk Vercel yayını.**
3. **Hat v2:** 2D model, menfez ağı ve 14 Ekim yağışı → ızgara kareleri, derinlik bantları, bina etkileri, taşma olayları. Web'de zaman oynatıcı ve yağış grafiği.
4. **Sinematik sahne:** three.js özel katmanı, su yüzeyi shader'ı ve kare enterpolasyonu → köpük ve çarpma → sürüklenen nesneler → kamera yolları.
5. Haber noktaları, doğrulama metriği ve kademe paneli.
6. İzmir ve Ankara, transfer senaryosu, tasarım yağışı merdiveni (kaydırıcı), anlık yağış.
7. Mobil: Expo kabuğu, `/embed`, APK ve Expo Go.
8. Tasarım turu (görsel kararlar), README, `docs/` içinde veri soy ağacı.

**Geride kalınırsa bırakılacaklar (bu sırayla):**
1. Anlık yağış
2. Ankara
3. Mobil yerel kontroller (yalın WebView kalır)
4. Tasarım merdiveni (kaydırıcı HAND yaklaşımına düşer)
5. Sürüklenen nesnelerin araç modelleri (yalnızca moloz parçacıkları kalır)
6. 2D model (yerine `HandFillModel`, sinematik sahne yine çalışır ama hız alanı koridor yönünden türetilir)

**Hiçbir koşulda bırakılmayacaklar:** İzohipsli analiz görünümü, 14 Ekim zamanlı gösterim ve sinematik 3D su sahnesi (en az su yüzeyi, akış ve köpük).

## 8. Kullanıcıdan gerekenler

- **Mapbox:** Artık gerekmiyor (MapLibre ve ücretsiz karolar). Yalnızca ileride isteğe bağlı bir uydu katmanı için.
- **Supabase:** Veritabanı bağlantı dizesi ve `service_role` anahtarı. **Yalnızca** yerel `pipeline/.env`'e girer, asla repoya girmez.
- **Vercel:** MCP için `authorize_team_access` onayı ya da panelden root `apps/web` ve ortam değişkenlerinin ayarlanması.
- **Expo hesabı:** EAS ile APK almak için.

## 9. Doğrulama

- **pytest (`pipeline/tests`):**
  - 2D modelde kütle korunumu: yağış = depolama + çıkış + kayıplar, %1 tolerans.
  - Düz havuz testi.
  - Eğik düzlemde kararlı akış testi.
  - Sentetik vadide HAND testi.
  - Menfez kapasitesi aşılınca taşma olayının üretilmesi.
- **Hat koşusu:** İstanbul için özet çıktısı (ıslanan bina sayısı, kare sayısı, kütle dengesi, isabet oranı) ve hızlı PNG önizleme.
- **Supabase:** `get_advisors` ile güvenlik kontrolü (RLS). RPC'ler anon anahtarla `curl` üzerinden denenir.
- **Web:** `next build`. Yerleşik tarayıcıda katmanlar, zaman oynatıcı ve mobil görünüm (`resize_window`) kontrol edilir.
- **Sinematik sahne:**
  - Masaüstünde 60 fps, orta seviye telefonda 30 fps hedefi.
  - Su yüzeyinin araziyle hizası kontrol edilir: su havada asılı ya da arazinin altında görünmemeli.
  - Nesnelerin akış yönünde sürüklendiği ekran kaydıyla doğrulanır.
- **Mobil:** Expo Go ile iPhone'da, EAS APK ile Android'de açılış ve `/embed` senkronu.
