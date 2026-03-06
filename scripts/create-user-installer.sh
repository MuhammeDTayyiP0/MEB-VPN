#!/bin/bash
# =============================================================================
# MEB VPN - Kullanıcı Bazlı Installer (Sudosuz)
# Bu script tar.gz paketinden self-installer .sh dosyası üretir.
# Kullanım: ./create-user-installer.sh <tar.gz dosya yolu>
# =============================================================================

set -e

TAR_FILE="$1"
VERSION="$2"

if [ -z "$TAR_FILE" ] || [ -z "$VERSION" ]; then
    echo "Kullanım: $0 <tar.gz dosya yolu> <versiyon>"
    echo "Örnek: $0 dist/meb-vpn-1.2.0.tar.gz 1.2.0"
    exit 1
fi

if [ ! -f "$TAR_FILE" ]; then
    echo "Hata: $TAR_FILE bulunamadı!"
    exit 1
fi

OUTPUT_FILE="dist/meb-vpn-${VERSION}-user-installer.sh"

# Self-extracting installer header
cat > "$OUTPUT_FILE" << 'INSTALLER_HEADER'
#!/bin/bash
# =============================================================================
# MEB VPN - Kullanıcı Bazlı Kurulum (Sudo Gerektirmez)
# Çalıştırma: chmod +x meb-vpn-*-user-installer.sh && ./meb-vpn-*-user-installer.sh
# Kaldırma:   ./meb-vpn-*-user-installer.sh --uninstall
# =============================================================================

set -e

APP_NAME="meb-vpn"
INSTALL_DIR="$HOME/.local/share/$APP_NAME"
BIN_LINK="$HOME/.local/bin/$APP_NAME"
DESKTOP_FILE="$HOME/.local/share/applications/$APP_NAME.desktop"
ICON_DIR="$HOME/.local/share/icons/hicolor"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# === KALDIRMA ===
if [ "$1" = "--uninstall" ]; then
    echo -e "${YELLOW}MEB VPN kaldırılıyor...${NC}"
    rm -rf "$INSTALL_DIR"
    rm -f "$BIN_LINK"
    rm -f "$DESKTOP_FILE"
    # Remove icons
    for size in 16 32 48 64 128 256 512; do
        rm -f "$ICON_DIR/${size}x${size}/apps/$APP_NAME.png"
    done
    # Update desktop database
    if command -v update-desktop-database &>/dev/null; then
        update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    fi
    echo -e "${GREEN}MEB VPN başarıyla kaldırıldı!${NC}"
    exit 0
fi

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║         MEB VPN Kurulum              ║"
echo "  ║    Kullanıcı Bazlı (Sudosuz)         ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# Dizinleri oluştur
echo -e "${YELLOW}➜ Dizinler oluşturuluyor...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/share/applications"

# Mevcut kurulumu temizle
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}➜ Önceki kurulum temizleniyor...${NC}"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
fi

# Archive'ı çıkart (PAYLOAD_LINE değişkeni script sonuna eklenir)
echo -e "${YELLOW}➜ Dosyalar çıkartılıyor...${NC}"
ARCHIVE_START=$(awk '/^__ARCHIVE_BELOW__$/{print NR + 1; exit 0}' "$0")
tail -n +"$ARCHIVE_START" "$0" | tar xzf - -C "$INSTALL_DIR" --strip-components=1

# Çalıştırılabilir yapma
chmod +x "$INSTALL_DIR/meb-vpn" 2>/dev/null || true
chmod +x "$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true

# xray binary'sine çalıştırma yetkisi ve TUN için ağ yetenekleri (capabilities)
if [ -d "$INSTALL_DIR/resources/xray" ]; then
    chmod +x "$INSTALL_DIR/resources/xray/xray" 2>/dev/null || true
    # TUN interface oluşturabilmesi için root yetkisi olmadan cap_net_admin veriyoruz.
    # Bu adım sudo gerektirir, installer çalıştırılırken bir kereliğine şifre isteyebilir.
    if command -v setcap &>/dev/null; then
        if [ "$EUID" -ne 0 ]; then
            echo -e "${YELLOW}➜ VPN ağ yönlendirmesi için tek seferlik yetki gerekiyor...${NC}"
            sudo setcap cap_net_admin,cap_net_bind_service=ep "$INSTALL_DIR/resources/xray/xray" || echo -e "${RED}Yetki verilemedi, VPN bağlanırken şifre sorabilir.${NC}"
        else
            setcap cap_net_admin,cap_net_bind_service=ep "$INSTALL_DIR/resources/xray/xray" || true
        fi
    fi
fi

# Symlink oluştur
echo -e "${YELLOW}➜ Symlink oluşturuluyor...${NC}"
ln -sf "$INSTALL_DIR/meb-vpn" "$BIN_LINK"

# İkon kopyalama
echo -e "${YELLOW}➜ İkonlar yükleniyor...${NC}"
ICON_SOURCE="$INSTALL_DIR/resources/icons"
if [ -d "$ICON_SOURCE" ]; then
    for size in 16 32 48 64 128 256 512; do
        ICON_FILE="$ICON_SOURCE/${size}x${size}.png"
        if [ -f "$ICON_FILE" ]; then
            DEST_DIR="$ICON_DIR/${size}x${size}/apps"
            mkdir -p "$DEST_DIR"
            cp "$ICON_FILE" "$DEST_DIR/$APP_NAME.png"
        fi
    done
else
    # Fallback: ana icon.png kullan
    ICON_FILE="$INSTALL_DIR/resources/icon.png"
    if [ -f "$ICON_FILE" ]; then
        for size in 48 128 256; do
            DEST_DIR="$ICON_DIR/${size}x${size}/apps"
            mkdir -p "$DEST_DIR"
            cp "$ICON_FILE" "$DEST_DIR/$APP_NAME.png"
        done
    fi
fi

# Desktop entry oluştur
echo -e "${YELLOW}➜ Uygulama menüsüne ekleniyor...${NC}"
cat > "$DESKTOP_FILE" << DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=MEB VPN
Comment=Güvenli VPN İstemcisi
Exec=$INSTALL_DIR/meb-vpn --no-sandbox %U
Icon=$APP_NAME
Categories=Network;VPN;Security;
Terminal=false
StartupWMClass=meb-vpn
StartupNotify=true
DESKTOP_EOF

chmod +x "$DESKTOP_FILE"

# Desktop database güncelle
if command -v update-desktop-database &>/dev/null; then
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

# Gtk icon cache güncelle
if command -v gtk-update-icon-cache &>/dev/null; then
    for size in 16 32 48 64 128 256 512; do
        gtk-update-icon-cache "$ICON_DIR/${size}x${size}" 2>/dev/null || true
    done
fi

# PATH kontrolü
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo ""
    echo -e "${YELLOW}⚠ ~/.local/bin PATH'inizde yok. Aşağıdaki satırı ~/.bashrc dosyanıza ekleyin:${NC}"
    echo -e "${GREEN}  export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

echo ""
echo -e "${GREEN}✓ MEB VPN başarıyla kuruldu!${NC}"
echo ""
echo -e "  ${BLUE}Başlatma:${NC}     Uygulama menüsünden 'MEB VPN' arayın"
echo -e "                veya terminalde: ${GREEN}meb-vpn${NC}"
echo ""
echo -e "  ${BLUE}Kaldırma:${NC}     $0 --uninstall"
echo ""

exit 0

__ARCHIVE_BELOW__
INSTALLER_HEADER

# Append the tar.gz payload to the installer
cat "$TAR_FILE" >> "$OUTPUT_FILE"
chmod +x "$OUTPUT_FILE"

echo "✓ User installer oluşturuldu: $OUTPUT_FILE"
echo "  Boyut: $(du -h "$OUTPUT_FILE" | cut -f1)"
