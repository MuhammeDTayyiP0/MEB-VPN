// MEB VPN - Desktop Application Logic

class MEBVPNApp {
    constructor() {
        this.isConnected = false;
        this.isConnecting = false;
        this.limitExceeded = false;
        this.connectionStartTime = null;
        this.timerInterval = null;
        this.particleInterval = null;
        this.user = null;

        this.initElements();
        this.initEventListeners();
        this.initIPCListeners();
        this.checkSession();
    }

    initElements() {
        // Views
        this.viewLogin = document.getElementById('view-login');
        this.viewDashboard = document.getElementById('view-dashboard');

        // Login
        this.btnGoogleSignIn = document.getElementById('btn-google-signin');
        this.loginError = document.getElementById('login-error');
        this.loginLoading = document.getElementById('login-loading');

        // Dashboard
        this.userEmail = document.getElementById('user-email');
        this.planLimit = document.getElementById('plan-limit');
        this.btnLogout = document.getElementById('btn-logout');
        this.connectBtn = document.getElementById('connect-btn');
        this.statusText = document.getElementById('status-text');
        this.connectLabel = document.getElementById('connect-label');
        this.connectionTime = document.getElementById('connection-time');
        this.timeDisplay = document.getElementById('time-display');
        this.statsGrid = document.getElementById('stats-grid');
        this.downloadSpeed = document.getElementById('download-speed');
        this.uploadSpeed = document.getElementById('upload-speed');
        this.totalUsage = document.getElementById('total-usage');
        this.usageText = document.getElementById('usage-text');
        this.usageFill = document.getElementById('usage-fill');
        this.usageReset = document.getElementById('usage-reset');
        this.errorContainer = document.getElementById('error-container');
        this.errorText = document.getElementById('error-text');
        this.screenFlash = document.getElementById('screen-flash');
        this.particlesContainer = document.getElementById('particles-container');
        this.rippleContainer = document.getElementById('ripple-container');

        // Window controls
        this.btnMinimize = document.getElementById('btn-minimize');
        this.btnClose = document.getElementById('btn-close');
    }

    initEventListeners() {
        this.btnGoogleSignIn.addEventListener('click', () => this.handleGoogleSignIn());
        this.connectBtn.addEventListener('click', () => this.toggleConnection());
        this.btnLogout.addEventListener('click', () => this.handleLogout());
        this.btnMinimize.addEventListener('click', () => window.mebAPI.minimize());
        this.btnClose.addEventListener('click', () => window.mebAPI.close());

        document.getElementById('btn-premium').addEventListener('click', () => {
            this.showError('Premium paketler yakında aktif olacak!');
        });
    }

    initIPCListeners() {
        window.mebAPI.onAuthStatus((data) => {
            if (data.loggedIn) {
                this.user = data.user;
                this.showDashboard();
            } else {
                this.showLogin();
            }
        });

        window.mebAPI.onConnectionStatus((status) => {
            switch (status) {
                case 'connected': this.setConnectedState(); break;
                case 'disconnected': this.setDisconnectedState(); break;
                case 'connecting': break;
            }
        });

        window.mebAPI.onTrafficUpdate((data) => this.updateTrafficUI(data));
        window.mebAPI.onConnectionError((error) => this.showError(error));

        window.mebAPI.onLimitExceeded((message) => {
            this.limitExceeded = true;
            this.showLimitExceededWarning(message);
            this.setDisconnectedState();
        });

        window.mebAPI.onUsageUpdate((data) => {
            this.updateUsageFromServer(data);
        });
    }

    // ========== AUTH ==========
    async checkSession() {
        try {
            const session = await window.mebAPI.getSession();
            if (session.loggedIn) {
                this.user = session.user;
                this.showDashboard();
            } else {
                this.showLogin();
            }
        } catch (e) {
            this.showLogin();
        }
    }

    async handleGoogleSignIn() {
        this.loginError.style.display = 'none';
        this.loginLoading.style.display = 'flex';
        this.btnGoogleSignIn.style.display = 'none';

        try {
            const result = await window.mebAPI.googleSignIn();
            if (result.success) {
                this.user = result.user;
                this.showDashboard();
            } else {
                this.showLoginError(result.error || 'Giriş başarısız oldu');
            }
        } catch (e) {
            this.showLoginError(e.message || 'Bağlantı hatası');
        } finally {
            this.loginLoading.style.display = 'none';
            this.btnGoogleSignIn.style.display = 'flex';
        }
    }

    async handleLogout() {
        await window.mebAPI.logout();
        this.user = null;
        this.showLogin();
    }

    showLoginError(msg) {
        this.loginError.textContent = msg;
        this.loginError.style.display = 'block';
    }

    // ========== VIEW SWITCHING ==========
    showLogin() {
        this.viewLogin.classList.add('active');
        this.viewDashboard.classList.remove('active');
    }

    showDashboard() {
        this.viewLogin.classList.remove('active');
        this.viewDashboard.classList.add('active');
        this.updateUserUI();
    }

    updateUserUI() {
        if (!this.user) return;
        this.userEmail.textContent = this.user.email;

        const periodLabels = { none: '', daily: '/gün', weekly: '/hafta', monthly: '/ay' };
        const period = this.user.data_limit_period || 'none';
        const limitMB = Math.round(this.user.data_limit * 1024);
        const suffix = periodLabels[period] || '';
        this.planLimit.textContent = `${limitMB} MB${suffix} • ${this.user.speed_limit} Mbps`;

        // Usage bar
        const usageMB = Math.round((this.user.period_usage || 0) / (1024 * 1024));
        this.usageText.textContent = `${usageMB} MB / ${limitMB} MB`;
        const pct = this.user.data_limit > 0 ? Math.min(100, (this.user.period_usage || 0) / (this.user.data_limit * 1024 * 1024 * 1024) * 100) : 0;
        this.usageFill.style.width = `${pct}%`;

        // Reset countdown
        if (this.user.period_reset_at) {
            const resetDate = new Date(this.user.period_reset_at);
            const now = new Date();
            const diffMs = resetDate - now;
            if (diffMs > 0) {
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                this.usageReset.textContent = `Sıfırlanma: ${hours}s ${mins}dk`;
            } else {
                this.usageReset.textContent = 'Sıfırlanıyor...';
            }
        }
    }

    // ========== VPN CONNECTION ==========
    async toggleConnection() {
        if (this.isConnecting) return;

        if (this.limitExceeded && !this.isConnected) {
            this.showLimitExceededWarning('Veri limitiniz doldu! Bağlantı kurulamaz.');
            return;
        }

        this.triggerRipple();

        if (this.isConnected) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    }

    async connect() {
        this.setConnectingState();
        try {
            const result = await window.mebAPI.connect();
            if (result.success) {
                this.setConnectedState();
            } else {
                this.setDisconnectedState();
                this.showError(result.error || 'Bağlantı kurulamadı');
            }
        } catch (error) {
            this.setDisconnectedState();
            this.showError(error.message || 'Bağlantı hatası');
        }
    }

    async disconnect() {
        this.triggerScreenFlash('flash-disconnect');
        try {
            await window.mebAPI.disconnect();
            this.setDisconnectedState();
        } catch (error) {
            this.setDisconnectedState();
        }
    }

    // ========== STATE MANAGEMENT ==========
    setConnectingState() {
        this.isConnecting = true;
        this.isConnected = false;
        document.body.className = 'connecting';
        this.statusText.textContent = 'Bağlanıyor...';
        this.connectLabel.textContent = 'Bağlantı kuruluyor';
        this.connectionTime.style.display = 'none';
        this.statsGrid.style.display = 'none';
    }

    setConnectedState() {
        this.isConnected = true;
        this.isConnecting = false;
        this.connectionStartTime = Date.now();
        document.body.className = 'connected';
        this.statusText.textContent = 'Bağlandı';
        this.connectLabel.textContent = 'Bağlantıyı kesmek için dokunun';
        this.connectionTime.style.display = 'flex';
        this.statsGrid.style.display = 'grid';
        this.triggerScreenFlash('flash-success');
        this.startConnectedParticles();
        this.startTimer();
        this.hideError();
    }

    setDisconnectedState() {
        this.isConnected = false;
        this.isConnecting = false;
        this.connectionStartTime = null;
        document.body.className = '';
        this.statusText.textContent = 'Bağlantı Kesildi';
        this.connectLabel.textContent = 'Bağlanmak için dokunun';
        this.connectionTime.style.display = 'none';
        this.statsGrid.style.display = 'none';
        this.stopConnectedParticles();
        this.stopTimer();
    }

    // ========== TRAFFIC UI ==========
    updateTrafficUI(data) {
        if (!this.isConnected) return;
        this.downloadSpeed.textContent = this.formatSpeed(data.downSpeed);
        this.uploadSpeed.textContent = this.formatSpeed(data.upSpeed);
        this.totalUsage.textContent = this.formatData(data.total);
    }

    formatSpeed(bytes) {
        if (!bytes || bytes === 0) return '0.00 KB/s';
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(2)} KB/s`;
        return `${(kb / 1024).toFixed(2)} MB/s`;
    }

    formatData(bytes) {
        if (!bytes || bytes === 0) return '0.00 MB';
        const mb = bytes / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(2)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    }

    // ========== TIMER ==========
    startTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            if (!this.connectionStartTime) return;
            const elapsed = Math.floor((Date.now() - this.connectionStartTime) / 1000);
            const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
            const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
            const s = (elapsed % 60).toString().padStart(2, '0');
            this.timeDisplay.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
        this.timeDisplay.textContent = '00:00:00';
    }

    // ========== ANIMATIONS ==========
    triggerScreenFlash(className) {
        this.screenFlash.className = 'screen-flash';
        void this.screenFlash.offsetWidth;
        this.screenFlash.classList.add(className);
        this.screenFlash.addEventListener('animationend', () => {
            this.screenFlash.className = 'screen-flash';
        }, { once: true });
    }

    triggerRipple() {
        const ripple = document.createElement('div');
        ripple.classList.add('ripple', 'animate');
        this.rippleContainer.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    }

    startConnectedParticles() {
        this.stopConnectedParticles();
        for (let i = 0; i < 5; i++) setTimeout(() => this.spawnParticle(), i * 300);
        this.particleInterval = setInterval(() => {
            if (this.isConnected) this.spawnParticle();
        }, 1200);
    }

    stopConnectedParticles() {
        if (this.particleInterval) { clearInterval(this.particleInterval); this.particleInterval = null; }
        this.particlesContainer.querySelectorAll('.particle').forEach(p => {
            p.style.transition = 'opacity 0.5s';
            p.style.opacity = '0';
            setTimeout(() => p.remove(), 500);
        });
    }

    spawnParticle() {
        const p = document.createElement('div');
        p.classList.add('particle');
        const size = 2 + Math.random() * 4;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;
        p.style.left = `${Math.random() * 100}%`;
        p.style.bottom = '-10px';
        p.style.setProperty('--tx', `${(Math.random() - 0.5) * 120}px`);
        p.style.setProperty('--ty', `${-(150 + Math.random() * 300)}px`);
        const duration = 3 + Math.random() * 5;
        p.style.setProperty('--duration', `${duration}s`);

        const colors = ['#34d399', '#22d3ee', '#818cf8', '#c084fc', '#06b6d4'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        p.style.background = color;
        p.style.boxShadow = `0 0 10px ${color}, 0 0 20px ${color}40`;

        this.particlesContainer.appendChild(p);
        p.classList.add('active');
        setTimeout(() => p.remove(), duration * 1000 + 100);
    }

    // ========== ERROR ==========
    showError(message) {
        this.errorText.textContent = message;
        this.errorContainer.style.display = 'block';
        setTimeout(() => this.hideError(), 6000);
    }

    hideError() {
        this.errorContainer.style.display = 'none';
    }

    // ========== LIMIT EXCEEDED ==========
    showLimitExceededWarning(message) {
        this.errorText.textContent = message;
        this.errorContainer.style.display = 'block';
        this.errorContainer.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        this.errorContainer.style.background = 'rgba(245, 158, 11, 0.15)';
        this.errorContainer.style.color = '#f59e0b';
        // Don't auto-hide limit exceeded warning
    }

    // ========== SERVER USAGE UPDATE ==========
    updateUsageFromServer(data) {
        if (!this.user) return;

        // Update local user data
        this.user.period_usage = data.period_usage;
        this.user.current_usage = data.current_usage;
        this.user.data_limit = data.data_limit;
        this.user.data_limit_period = data.data_limit_period;
        this.user.period_reset_at = data.period_reset_at;
        this.user.active = data.active;
        this.user.speed_limit = data.speed_limit;

        // Check if limit was cleared (e.g. period reset)
        if (!data.limit_exceeded && data.active) {
            this.limitExceeded = false;
            this.hideError();
            // Reset error container style
            this.errorContainer.style.borderColor = '';
            this.errorContainer.style.background = '';
            this.errorContainer.style.color = '';
        }

        // Refresh UI
        this.updateUserUI();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MEBVPNApp();
});
