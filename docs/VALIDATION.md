# Doğrulama: 14 Ekim 2026 Sarıyer seli

Model: 2D sığ su çözücüsü, 20 m ızgara, 30 saat, toplam 188 mm yağış (saatlik desen ERA5, toplam Sarıyer istasyonu gözlemi).
Parametreler gözlenen sele göre kalibre edildi (aşağıda). Kalibrasyon öncesi taban çizgisi 150 mm yağış ve 15 mm/sa kayıpla çalışıyordu.
Binalar: Overture Maps (OpenStreetMap + Microsoft ML bina izleri), pilot alanda 16.787 bina; OSM tek başına 11.841.
Çözücü: CPU (numba) ve GPU (CUDA) sürümleri bu senaryoda birebir aynı sonucu veriyor (aynı adım sayısı, aynı bina etkileri).

## Kalibrasyon

İlk sürüm 14 Ekim selini olduğundan hafif gösteriyordu: Ayazağa Meydanı'nda 0,21 m çıkıyordu, haberlerde ise restoranda
1,5-2 m su vardı. Modeli haberlerden ve videolardan derlenen gözlemlere göre ayarladık
(`pipeline/floodograph/pipeline/calibrate.py`).

**Yağış artık serbest parametre değil:** Sarıyer istasyonunda 14 Ekim toplamı 187,9 mm (İBB, 15 Ekim 00:47).
Daha önce erken haberlerdeki ~150 mm kullanılıyordu.

**Hedefler:** 9 noktada sokak derinliği aralığı ve bir zamanlama koşulu. Sokak derinliği, noktanın 50 m çevresindeki
bina dışı hücrelerin 75. yüzdeliği; en yüksek değer yan taraftaki dere yatağını ölçerdi, insanların durduğu sokağı değil.
Zamanlama: Dereboyu Caddesi'nde su 17:15 ile 18:45 arasında 0,5 m'ye ulaşmalı (Ayazağa'da su baskını ~17:30'da başladı).
Ayrıca Ayazağa'da araçların sürüklendiği bilindiği için 600 m içinde bir sokakta akış hızı en az 1,5 m/s olmalı.
Simülasyon 10:00-24:00 penceresinde kuru başlangıçtan koşuyor. Skor, her hedefin aralığa log uzaklığının toplamı ile
zamanlama ve hız sapmalarından oluşuyor; düşük olan iyi.

**Taranan parametreler:**

| Parametre | Anlamı |
|---|---|
| Kayıp (mm/sa) | Sızma + yağmur suyu kanalı kapasitesi, alan boyunca tek değer |
| Manning n | Yüzey pürüzlülüğü (0,02 düz asfalt ile 0,05 dağınık kent taşkın ovası arası) |
| Menfez katsayısı | Rasyonel yöntemle hesaplanan menfez kapasitelerinin çarpanı (moloz tıkanması) |
| Keskinleştirme | Saatlik ERA5 yağışını tepe saatlerine toplar; günlük toplam sabit kalır |
| Zaman kaydırma (sa) | Yağış desenini bu kadar saat öne çeker |

**1. tur** (`pipeline/data/istanbul/calibration_round1.csv`, keskinleştirme ve kaydırma yok): denenen değerler arasında en
iyi kayıp 2 mm/sa çıktı; 4 mm/sa derinlikleri belirgin düşürdü (skor 8,4-8,7'ye karşı 12,2-12,6). Menfez katsayısının
(0,25 / 0,5) derinliklere hiçbir etkisi olmadı, yalnızca hızı değiştirdi. n = 0,04, 0,025'e göre biraz daha derin sonuç
verdi. Turun en iyisi (kayıp 2, n 0,04) yine de 9 hedeften yalnızca 4'ünü tuttu: Meydan 0,53 m kaldı ve Dereboyu
0,5 m'ye ancak 19:30'da ulaştı, yani gözlenenden geç.

**2. tur** (`pipeline/data/istanbul/calibration.csv`): kayıp 1-2 mm/sa, n 0,04, menfez 0,5 sabit; keskinleştirme ve
zaman kaydırma tarandı.

| Kayıp | Keskinleştirme | Kaydırma | İsabet | Dereboyu 0,5 m | Skor |
|---|---|---|---|---|---|
| 1 | 2,0 | 1 sa | **7/9** | **18:10** | **4,913** |
| 1 | 2,0 | 0 | 7/9 | 19:10 | 5,330 |
| 1 | 1,5 | 1 sa | 6/9 | 18:15 | 5,345 |
| 2 | 1,5 | 1 sa | 5/9 | 18:20 | 5,505 |
| 1 | 1,5 | 0 | 6/9 | 19:10 | 5,719 |
| 2 | 1,5 | 0 | 6/9 | 19:20 | 6,052 |

**Seçilen değerler:** kayıp 1 mm/sa (önce 15), Manning n 0,04 (önce 0,035), keskinleştirme 2,0, kaydırma 1 sa, yağış 188 mm.
Bunlar artık pipeline varsayılanları (`simulate.py`: `N_MANNING`, `LOSS_MM_H`, `RAIN_SHARPEN`, `RAIN_SHIFT_H`,
`STATION_MM`) ve `/sehirler` sayfasındaki "ya şu kadar yağarsa" yağış merdiveninde (25-300 mm; İstanbul, İzmir, Ankara)
de aynen kullanılıyor.

### Gözlem ve model

| Hedef | Gözlenen | Hedef aralık | Model | İsabet |
|---|---|---|---|---|
| Ayazağa Meydanı | Restoranda 1,5-2 m, su arabanın tavanını aştı (~20:00) | 1,5-2,5 m | 1,54 m | ✓ |
| Dereboyu Cd. (mağaza) | Mağazada 1,70 m, sokakta bel üstü (~18:00) | ≥ 1,0 m | 2,76 m | ✓ |
| Atatürk Cd. | Dereboyu'ndan akan su kütlesi | ≥ 0,7 m | 1,10 m | ✓ |
| Kemerburgaz Cd. | ~200 kişi mahsur, botla/kepçeyle kurtarma | ≥ 1,0 m | 2,08 m | ✓ |
| Cendere Yolu | Yollar ~2 m su altında | ≥ 1,0 m | 2,81 m | ✓ |
| Cendere Cd. | ~300 araç mahsur, bir araç 1 km sürüklendi | ≥ 0,5 m | 2,11 m | ✓ |
| 201. Sokak | 6-7 ev su altında, tahliye | ≥ 0,3 m | 3,26 m | ✓ |
| Hacıosman Metro | İstasyonu su bastı | ≥ 0,3 m | 0,02 m | ✗ |
| Haydar Aliyev Cd. | Su kaldırımlara kadar yükseldi | 0,1-0,4 m | 0,01 m | ✗ |
| Zamanlama | Ayazağa'da baskın ~17:30 | Dereboyu 0,5 m: 17:15-18:45 | 18:10 | ✓ |
| Sürüklenen araçlar | Ayazağa'da ~40 araç | ≥ 1,5 m/s | 3,65 m/s | ✓ |

Sonuç: 9 derinlik hedefinin 7'si tuttu, skor 4,913. Ayazağa'da en yüksek akış hızı 3,65 m/s, 0,15 m'yi aşan su altı
alanı 1.834,8 ha.

**Kaçırılan iki nokta yapısal:** Hacıosman ve Haydar Aliyev daha yüksek kotta. Oralarda su metro ve alt geçitler
üzerinden ve kanalizasyonun geri tepmesiyle geldi. Boru ağı olmayan bir yüzey modeli bunu üretemez; parametre
zorlanarak bu iki nokta tutturulmaya çalışılmadı. Taban çizgisinde Hacıosman'da görülen 1,91 m, 100 m çevredeki en
yüksek değerden, yani yakındaki dere yatağından geliyordu; sokak ölçüsüyle orada su yok.

**Fiziksel okuma:** Rekor yağışta toprak doymuş, ızgaralar tıkanmıştı; bu yüzden etkin kayıp çok küçük (1 mm/sa).
Saatlik ERA5, sel doğuran 10-30 dakikalık sağanakları yumuşatıyor; keskinleştirme bunu telafi ediyor. ERA5 ~25 km'lik
bir hücre ve yerel tepe onun 19:00'daki tepesinden önce geldi (İTÜ Maslak'ta 19:50'ye kadar 124,7 mm); kaydırma bunu
karşılıyor. Kalibrasyon tek bir olaya ve 9 noktaya dayanıyor; başka bir olayla bağımsız sınanmadı.

## Şehir geneli dere koridorları

FABDEM deniz ve boğaz üzerinde 0 m veriyor. Bu düz yüzeyde izlenen akış çizgileri gerçek dere değil, yapaydı. Koridorlar
artık deniz/boğaz üzerinden geçtikleri yerde kesiliyor: İstanbul'da 4.361 koridordan 3.706'ya inildi.

## Sonuçlar (kalibrasyon öncesi taban çizgisi)

Bu bölüm ve sonraki iki bölüm eski ayarla (150 mm, kayıp 15 mm/sa, n 0,035, keskinleştirme ve kaydırma yok) üretildi;
karşılaştırma için tutuluyor. Güncel isabetler için yukarıdaki kalibrasyon tablosuna bakın.

| | |
|---|---|
| Suyun ulaştığı bina | 1.427 / 16.787 |
| 0,5 m'yi aşan bina | 408 |
| En geniş su altı alanı | 1.366 ha |
| Taşan menfez | 15 / 73, ilki 14 Ekim 18:32 |
| Kütle dengesi hatası | 1,4 × 10⁻¹⁴ |

## Haberlerdeki su basan noktalar (taban çizgisi)

Bir nokta "isabet" sayılır: 100 m yarıçap içinde simüle edilen en yüksek su derinliği eşiği geçiyorsa.
(Kalibrasyonda bu ölçü, dere yatağını yakaladığı için 50 m içinde 75. yüzdelik sokak derinliğiyle değiştirildi.)

| Nokta | Kaynak | Modeldeki en yüksek derinlik |
|---|---|---|
| Hacıosman Metro İstasyonu | Takvim | 1,91 m |
| Ayazağa Deresi | Gazete Oksijen | 1,42 m |
| Ayazağa Kemerburgaz Caddesi | AA | 0,66 m |
| Ayazağa Meydanı | Takvim, A Haber | 0,21 m |
| Haydar Aliyev Caddesi | AA | 0,06 m (kaçırıldı) |
| Selanik Bulvarı | AA | konumlanamadı |

| Eşik | İsabet | Rastgele bir noktanın isabet olasılığı |
|---|---|---|
| 0,15 m | 4/5 | %53 |
| 0,30 m | 3/5 | %37 |
| 0,50 m | 3/5 | %22 (3/5'in şansla çıkma olasılığı ~%8) |

**Dürüst okuma:** Model, haberlerde su bastığı söylenen yerlerin çoğunda belirgin su gösteriyor ve bu, rastgele bir
noktadan iyi. Ancak 5 nokta istatistik için az. Yanlış alarm oranı ve IoU için gözlenmiş bir taşkın alanı
(International Charter / Sentinel-1 ürünü) gerekiyor; bulunduğunda `floodograph.core.validation.extent_scores` ile hesaplanacak.

## Yapısal hasar (taban çizgisi)

Bina çevresindeki akışta derinlik × hız en fazla ~2,4 m²/s. Yığma/betonarme yapılar için hasar eşiği 3, yıkılma eşiği
7 m²/s (Clausen & Clark 1990). Model 14 Ekim'de yıkılan bina öngörmüyor; haberlerde de bina çökmesi yok, araç ve
otobüs sürüklenmesi var. Bu değer kalibre edilmiş ayarla yeniden hesaplanmadı; daha derin ve hızlı akış nedeniyle
artması beklenir.
