package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// 本地代理（SOCKS5 / HTTP）的分流出站。
//
// Windows 上 x-tunnel 只提供一个"什么都往隧道里塞"的本地代理，分流是 v2rayN 干的。
// Mac 版没有 v2rayN 这一层，所以分流必须自己做，否则打开百度也要绕一圈 Cloudflare。
//
// 规则引擎直接复用 Windows 版 TUN 模式那套（tun_route.go + geoip/geosite），
// 只是把判定点从 TUN 网卡挪到了本地代理的入站处。

var routeReady atomic.Bool

// proxyRejectedHosts 记录服务端最近拒绝过的目标主机，值是拒绝发生的时间。
//
// 早先这里是永久记录的：当时服务端连不上任何 Cloudflare 站点，那个结论
// 在整个会话里都成立。换用带 ProxyIP 中转的服务端之后前提变了 ——
// 失败往往只是一次偶发抖动，再永久记着就会让一个本该走代理的站点
// 从此一直直连，而且用户完全看不出为什么。所以改成短期记忆。
var proxyRejectedHosts sync.Map

// 拒绝记录的有效期。只用来削掉连续重试的开销，不做长期判断。
const proxyRejectTTL = 60 * time.Second

// initLocalRouting 在非 TUN 模式下初始化分流。全局模式（-default all）不需要
// 加载 geo 数据，省下几百毫秒启动时间和几十 MB 内存。
func initLocalRouting() {
	initRules(routeStr, defaultRouteStr, ruleMode)

	if strings.EqualFold(strings.TrimSpace(defaultRouteStr), "all") {
		log.Printf("[分流] 全局模式：所有流量走代理")
		routeReady.Store(true)
		return
	}
	loadGeoIP()
	loadGeoSite()
	routeReady.Store(true)
	log.Printf("[分流] 规则模式已就绪")
}

// outbound 是一条出站连接：可能是隧道里的 smux 流，也可能是本地直连的 TCP。
type outbound struct {
	rw        io.ReadWriteCloser
	channelID int
	direct    bool
}

var errBlocked = errors.New("规则拦截")

// dialTargetWithRoute 按路由规则决定 target 走隧道还是直连。
// target 形如 "example.com:443" 或 "1.2.3.4:443"。
func dialTargetWithRoute(target string) (*outbound, error) {
	host, _, err := net.SplitHostPort(target)
	if err != nil {
		host = target
	}

	decision := DecisionProxy
	reason := ""
	if routeReady.Load() {
		// 是域名就按域名匹配，是 IP 就按 IP 匹配；routeTCP 内部已处理两种情况。
		if net.ParseIP(host) != nil {
			decision, reason = routeTCP("", host)
		} else {
			decision, reason = routeTCP(host, host)
			// 域名没命中任何规则时，再按它解析出来的 IP 判一次。
			//
			// geosite 名单只有六千多条后缀，覆盖得了主流网站，覆盖不了长尾：
			// 一个没上榜的国内小站会被当成"不认识"直接丢进代理，绕一圈国外
			// 反而更慢。拿解析结果查一次 geoip 就能救回这类站点。
			if decision == defaultRouteDecision && reason == "default" {
				if d, r, ok := routeByResolvedIP(host); ok {
					decision, reason = d, r
				}
			}
		}
	}

	switch decision {
	case DecisionBlock:
		log.Printf("[分流] 拦截 %s (%s)", target, reason)
		return nil, errBlocked

	case DecisionDirect:
		c, err := net.DialTimeout("tcp", target, 5*time.Second)
		if err != nil {
			// 直连失败不代表该走代理：可能就是站点挂了。
			// 但对国内被墙域名误判成 direct 的情况，退回代理能救回来。
			// wpad 是 macOS 的代理自动发现，它本来就查不到，不值得当错误刷屏
			if !strings.HasPrefix(target, "wpad:") {
				log.Printf("[分流] 直连 %s 失败(%v)，改走代理", target, err)
			}
			return dialViaTunnel(target)
		}
		return &outbound{rw: c, direct: true}, nil

	default:
		return dialViaTunnel(target)
	}
}

// 服务端协议：0=未探测 1=x-tunnel(smux) 2=简易 WebSocket 代理
var serverProtocol atomic.Int32

const (
	protoUnknown int32 = 0
	protoSmux    int32 = 1
	protoSimple  int32 = 2
)

// detectServerProtocol 在首批通道就绪后判定服务端类型。
//
// 两种服务端在 WebSocket 握手层完全一样（都认 Sec-WebSocket-Protocol 里的 token），
// 差别要到发第一帧数据才暴露出来，所以只能主动探。
func detectServerProtocol() {
	if echPool == nil {
		return
	}
	// 先试简易协议：它有明确的 CONNECTED 应答，判定是确定性的。
	// 反过来用 smux 判定不可靠 —— 通道"建立"根本不需要服务端参与，
	// HasHealthyChannel 为真也可能只是本地建了个没人搭理的会话。
	if probeSimpleProtocol() {
		serverProtocol.Store(protoSimple)
		log.Printf("[协议] 服务端类型: 简易 WebSocket 代理（每连接一条 WebSocket）")
		return
	}
	serverProtocol.Store(protoSmux)
	log.Printf("[协议] 服务端类型: x-tunnel（smux 多路复用）")
}

func dialViaTunnel(target string) (*outbound, error) {
	if echPool == nil {
		return nil, errors.New("隧道尚未就绪")
	}

	if serverProtocol.Load() == protoSimple {
		host, _, _ := net.SplitHostPort(target)

		// 服务端拒过的站点直接走直连，别每次都白等它拒绝一遍。
		//
		// Cloudflare Worker 连不上托管在 Cloudflare 上的站点（平台限制，
		// NAT64 绕行也被同一条规则挡住，实测无解）。这类站点每次都要先
		// 花好几秒等服务端说"不行"，纯属浪费。记住一次就够了。
		// 全局模式除外：那种模式下用户要的就是"绝不直连"。
		if defaultRouteDecision != DecisionAll && host != "" {
			if v, ok := proxyRejectedHosts.Load(host); ok {
				if at, _ := v.(time.Time); time.Since(at) < proxyRejectTTL {
					if direct, e := net.DialTimeout("tcp", target, 5*time.Second); e == nil {
						return &outbound{rw: direct, direct: true}, nil
					}
				} else {
					proxyRejectedHosts.Delete(host) // 过期了，重新给代理一次机会
				}
			}
		}

		c, err := dialSimpleWS(target)
		if err == nil {
			return &outbound{rw: c}, nil
		}
		if host != "" {
			proxyRejectedHosts.Store(host, time.Now())
		}
		// Cloudflare Worker 的 connect() 不允许连回 Cloudflare 自家 IP 段，
		// 所以任何托管在 CF 上的站点（ip.sb、claude.ai 等）都会被服务端拒绝。
		// 这是平台限制，客户端绕不过去。
		//
		// 全局模式下**绝不能**偷偷改走直连：用户选"全局"就是要求所有流量都过代理，
		// 悄悄直连等于让他在毫不知情的情况下暴露真实 IP。这种时候宁可失败。
		if defaultRouteDecision == DecisionAll {
			log.Printf("[分流] %s 服务端拒绝(%v)", target, err)
			log.Printf("[分流] 全局模式下不会改走直连；该站点托管在 Cloudflare 上，"+
				"而 Cloudflare Worker 不允许连回自家网络")
			return nil, err
		}

		// 非全局模式本来就允许直连，退回去再试一次比直接报错有用。
		if direct, e := net.DialTimeout("tcp", target, 5*time.Second); e == nil {
			log.Printf("[分流] %s 经服务端失败，已改走直连", target)
			return &outbound{rw: direct, direct: true}, nil
		}
		return nil, err
	}

	s, chID, _, err := echPool.openTCPStream(target)
	if err != nil {
		return nil, err
	}
	return &outbound{rw: s, channelID: chID}, nil
}

// relayOutbound 在客户端连接和出站连接之间双向转发，语义与 proxyConnStream 一致，
// 区别只是出站端放宽成了 io.ReadWriteCloser，好让直连的 net.Conn 也能走这里。
func relayOutbound(c net.Conn, ob *outbound) {
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(ob.rw, c)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(c, ob.rw)
		done <- struct{}{}
	}()
	<-done
	_ = ob.rw.Close()
	_ = c.Close()
	<-done
}

// logRouteEvent 打一条能看出走了哪条路的日志
func logRouteEvent(c net.Conn, reqType, target string, ob *outbound, opened bool) {
	arrow := "关闭"
	if opened {
		arrow = "打开"
	}
	if ob.direct {
		log.Printf("[客户端] %s %s %s %s 直连", clientSourceAddr(c), reqType, arrow, target)
		return
	}
	log.Printf("[客户端] %s %s %s %s 通道 %d", clientSourceAddr(c), reqType, arrow, target, ob.channelID)
}


// resolvedRouteCache 缓存"域名 → 路由判定"，避免每条连接都去解析一次 DNS。
var resolvedRouteCache sync.Map

type resolvedRoute struct {
	decision RouteDecision
	reason   string
	at       time.Time
}

const resolvedRouteTTL = 10 * time.Minute

// routeByResolvedIP 把域名解析成 IP，再按 geoip 规则判一次。
// 第三个返回值表示"是否得到了有效判定"——解析失败或规则没命中都返回 false，
// 让调用方保持原来的默认决策。
func routeByResolvedIP(host string) (RouteDecision, string, bool) {
	if v, ok := resolvedRouteCache.Load(host); ok {
		if rr, _ := v.(resolvedRoute); time.Since(rr.at) < resolvedRouteTTL {
			return rr.decision, rr.reason, true
		}
		resolvedRouteCache.Delete(host)
	}

	// 解析要有超时：DNS 卡住的话，每条连接都会跟着卡。
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(addrs) == 0 {
		return DecisionNone, "", false
	}

	for _, a := range addrs {
		ipStr := a.IP.String()
		if d, rule := routeIPStr(ipStr); d != DecisionNone {
			reason := "ip:" + rule + "(解析自域名)"
			resolvedRouteCache.Store(host, resolvedRoute{decision: d, reason: reason, at: time.Now()})
			return d, reason, true
		}
	}
	return DecisionNone, "", false
}
