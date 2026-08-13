//go:build windows

package main

import (
	"errors"
	"net"
	"strings"
)

// Windows 版当前与 macOS 版一致：默认走本地 SOCKS5/HTTP 监听 + 自带分流，
// 暂不启用 TUN 模式（保留这些符号仅为满足 x-tunnel.go 的跨平台引用）。
// 后续如需 TUN（如 wintun）可在此文件实现。
var (
	tunMode bool = false
	tunName      = "xtun"
	tunMTU       = 9000
)

// setUnicastIF 对应 Windows 的 IP_UNICAST_IF 绑定；TUN 未启用时无需绑定。
func setUnicastIF(fd uintptr, ifaceIdx int, isIPv6 bool) error { return nil }

func chooseTunIPv4Config() (gatewayCIDR string, dnsIP string) {
	return "172.18.0.1/30", "172.18.0.2"
}

func StartTun(cfg *TunConfig) error {
	return errors.New("当前平台暂不支持 TUN 模式")
}

// isVirtualInterface 识别 Windows 上的虚拟网卡，用于挑选真正的物理出口网卡。
func isVirtualInterface(name string) bool {
	virtual := []string{"wintun", "tun", "tap", "docker", "veth",
		"tailscale", "wg", "zerotier", "ppp", "virtual", "loopback"}
	for _, v := range virtual {
		if strings.Contains(name, v) {
			return true
		}
	}
	return false
}

// getSystemDNSServers 返回网卡配置的 DNS；暂不查询，使用系统默认解析器。
func getSystemDNSServers(iface *net.Interface) []string { return nil }

// detectPhysIfaceIndexAPI 暂不通过 Windows API 探测，由上层回退 net.Interfaces 枚举。
func detectPhysIfaceIndexAPI() int { return -1 }