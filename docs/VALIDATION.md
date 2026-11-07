# Doğrulama: 14 Ekim 2026 Sarıyer seli

Model: 2D sığ su çözücüsü, 20 m ızgara, 30 saat, toplam 150 mm yağış (saatlik desen ERA5, toplam Sarıyer gözlemi).
Çözücü: CPU (numba) ve GPU (CUDA) sürümleri bu senaryoda birebir aynı sonucu veriyor (aynı 84.771 adım, aynı bina etkileri).

## Haberlerdeki su basan noktalar

Bir nokta "isabet" sayılır: 100 m yarıçap içinde simüle edilen en yüksek su derinliği eşiği geçiyorsa.

| Nokta | Kaynak | Modeldeki en yüksek derinlik |
|---|---|---|
| Ayazağa Deresi | Gazete Oksijen | 2,38 m |
| Hacıosman Metro İstasyonu | Takvim | 1,91 m |
| Ayazağa Kemerburgaz Caddesi | AA | 0,72 m |
| Ayazağa Meydanı | Takvim, A Haber | 0,34 m |
| Haydar Aliyev Caddesi | AA | 0,06 m (kaçırıldı) |
| Selanik Bulvarı | AA | konumlanamadı |

| Eşik | İsabet | Rastgele bir noktanın isabet olasılığı | Bu sonucun şansla çıkma olasılığı |
|---|---|---|---|
| 0,15 m | 4/5 | %52 | anlamlı değil |
| 0,30 m | 4/5 | %36 | ~%6 |
| 0,50 m | 3/5 | %21 | ~%7 |

**Dürüst okuma:** Model, haberlerde su bastığı söylenen yerlerin çoğunda derin su gösteriyor ve bu, rastgele bir noktadan
belirgin biçimde iyi. Ancak 5 nokta istatistik için az. Yanlış alarm oranı ve IoU için gözlenmiş bir taşkın alanı
(International Charter / Sentinel-1 ürünü) gerekiyor; bulunduğunda `floodograph.core.validation.extent_scores` ile hesaplanacak.
