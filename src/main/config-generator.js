const fs = require('fs');

class ConfigGenerator {
    constructor() {
        this.config = null;
    }

    /**
     * Set VPN config from server response
     * @param {Object} vpnConfig - { uuid, address, port, network, security, wsPath, sni }
     */
    setServerConfig(vpnConfig) {
        this.config = {
            address: vpnConfig.address,
            port: vpnConfig.port || 443,
            uuid: vpnConfig.uuid,
            network: vpnConfig.network || 'ws',
            security: vpnConfig.security || 'tls',
            wsPath: vpnConfig.wsPath || '/mtevpn',
            sni: vpnConfig.sni || vpnConfig.address,
            socksPort: 10808,
            httpPort: 10809,
        };
    }

    generateConfig(outputPath) {
        if (!this.config) {
            throw new Error('VPN config not set. Call setServerConfig() first.');
        }

        const config = this.config;

        const xrayConfig = {
            log: { loglevel: 'warning' },
            stats: {},
            api: {
                tag: 'api',
                services: ['StatsService'],
            },
            policy: {
                levels: {
                    0: {
                        statsUserUplink: true,
                        statsUserDownlink: true,
                    },
                },
                system: {
                    statsInboundUplink: true,
                    statsInboundDownlink: true,
                    statsOutboundUplink: true,
                    statsOutboundDownlink: true,
                },
            },
            inbounds: [
                {
                    tag: 'api',
                    port: 10085,
                    listen: '127.0.0.1',
                    protocol: 'dokodemo-door',
                    settings: { address: '127.0.0.1' },
                },
                {
                    tag: 'tun-in',
                    protocol: 'tun',
                    settings: {
                        autoRoute: true,
                        strictRoute: true,
                        stack: 'system',
                        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] }
                    }
                }
            ],
            outbounds: [
                {
                    tag: 'proxy',
                    protocol: 'vless',
                    settings: {
                        vnext: [{
                            address: config.address,
                            port: config.port,
                            users: [{
                                id: config.uuid,
                                email: 'user@meb.vpn',
                                encryption: 'none',
                                level: 0,
                            }],
                        }],
                    },
                    streamSettings: {
                        network: config.network,
                        security: config.security,
                        wsSettings: {
                            path: config.wsPath,
                            headers: { Host: config.sni },
                        },
                        tlsSettings: {
                            serverName: config.sni,
                            allowInsecure: false,
                        },
                    },
                },
                { tag: 'direct', protocol: 'freedom', settings: {} },
                { tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } },
            ],
            routing: {
                domainStrategy: 'AsIs',
                rules: [
                    { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
                    { type: 'field', outboundTag: 'direct', ip: ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'] },
                    { type: 'field', outboundTag: 'direct', domain: ['localhost'] },
                    { type: 'field', outboundTag: 'proxy', port: '0-65535' },
                ],
            },
        };

        fs.writeFileSync(outputPath, JSON.stringify(xrayConfig, null, 2), 'utf8');
        return xrayConfig;
    }
}

module.exports = ConfigGenerator;
