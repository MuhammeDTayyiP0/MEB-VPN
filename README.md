# MEB VPN - Desktop Client

Windows ve Linux için masaüstü VPN istemcisi.

## Kurulum

```bash
npm install
```

## Yapılandırma

`config.json` dosyasını düzenleyin:

```json
{
    "appName": "MEB VPN",
    "version": "1.0.0",
    "googleClientId": "BURAYA_GOOGLE_CLIENT_ID_YAZIN.apps.googleusercontent.com",
    "apiUrl": "https://vpn-sunucunuzun-adresi.com"
}
```

| Alan | Açıklama |
|---|---|
| `googleClientId` | Google Cloud Console'dan aldığınız OAuth 2.0 Client ID |
| `apiUrl` | VPN sunucunuzun API adresi |

## Xray Binary

`resources/xray/` klasörüne platformunuza uygun binary yerleştirin:

- Windows: `resources/xray/xray.exe`
- Linux: `resources/xray/xray`

İndirmek için: https://github.com/XTLS/Xray-core/releases

## Çalıştırma

```bash
npm run dev
```

## Build

```bash
npm run build:win    # Windows
npm run build:linux  # Linux
```
