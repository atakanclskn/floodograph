# Doğrulama: 14 Ekim 2026 Sarıyer seli

Model: 2D sığ su çözücüsü, 20 m ızgara, 30 saat, toplam 150 mm yağış (saatlik desen ERA5, toplam Sarıyer gözlemi).
Binalar: Overture Maps (OpenStreetMap + Microsoft ML bina izleri), pilot alanda 16.787 bina; OSM tek başına 11.841.
Çözücü: CPU (numba) ve GPU (CUDA) sürümleri bu senaryoda birebir aynı sonucu veriyor (aynı adım sayısı, aynı bina etkileri).

## Sonuçlar

| | |
|---|---|
| Suyun ulaştığı bina | 1.427 / 16.787 |
| 0,5 m'yi aşan bina | 408 |
| En geniş su altı alanı | 1.366 ha |
| Taşan menfez | 15 / 73, ilki 14 Ekim 18:32 |
| Kütle dengesi hatası | 1,4 × 10⁻¹⁴ |

## Haberlerdeki su basan noktalar

Bir nokta "isabet" sayılır: 100 m yarıçap içinde simüle edilen en yüksek su derinliği eşiği geçiyorsa.

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

## Yapısal hasar

Bina çevresindeki akışta derinlik × hız en fazla ~2,4 m²/s. Yığma/betonarme yapılar için hasar eşiği 3, yıkılma eşiği
7 m²/s (Clausen & Clark 1990). Model 14 Ekim'de yıkılan bina öngörmüyor; haberlerde de bina çökmesi yok, araç ve
otobüs sürüklenmesi var.
