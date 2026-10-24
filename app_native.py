#!/usr/bin/env python3
"""原生 macOS 外壳 —— 用 WKWebView 开一个真窗口装 Flask 页面。

和 server.py 的区别：没有浏览器地址栏/标签页，是一个真正的 App。
    python3 app_native.py

标题栏处理：pywebview 的 frameless=True 会把红绿灯一起藏掉，那样只能自己画假按钮。
这里改成保留窗口边框，再直接操作底层 NSWindow 把标题栏设成透明 + 内容全尺寸，
于是红绿灯是**系统真按钮**，浮在侧边栏左上角 —— 正是 Mac 微信的样子。
"""
import socket, sys, threading, time

import webview

from server import app, find_free_port

WINDOW_TITLE = "微信"
DEFAULT_SIZE = (1160, 760)
MIN_SIZE = (860, 560)


def _wait_for_server(port, timeout=20.0):
    """等 Flask 起来再开窗口，否则会白屏。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.1)
    return False


def _apply_mac_titlebar(window):
    """把红绿灯放回来。

    窗口用 frameless=True 创建 —— 那条路径下 pywebview 在**建窗时**就把
    NSFullSizeContentView 写进 styleMask 并设好透明标题栏，正是 Mac 微信的形态。
    它唯一多做的一件事是把三颗交通灯 setHidden_(True)，这里撤销掉即可。

    （不要改用「普通窗口 + 事后 setStyleMask_」：AppKit 会因此重算 frame，
      实测窗口会被压成 0x0，进程活着但屏幕上什么都没有。）

    另外 pywebview 的 shown 事件是在工作线程上回调的，而按钮显隐属于窗口几何操作，
    在非主线程调用会抛 NSInternalInconsistencyException，所以必须 callAfter 到主线程。
    """
    try:
        import AppKit
        from PyObjCTools import AppHelper
    except Exception as e:  # pragma: no cover - 非 macOS 或 pyobjc 缺失
        print(f"[app] 标题栏定制跳过: {e}", file=sys.stderr)
        return

    def _on_main():
        ns = window.native
        if ns is None:
            return
        for btn in (AppKit.NSWindowCloseButton,
                    AppKit.NSWindowMiniaturizeButton,
                    AppKit.NSWindowZoomButton):
            b = ns.standardWindowButton_(btn)
            if b is not None:
                b.setHidden_(False)
        try:
            ns.setTitlebarSeparatorStyle_(0)  # 侧栏上不要那条横分隔线
        except Exception:
            pass
        _add_vibrancy(ns)

    AppHelper.callAfter(_on_main)


def _keep_traffic_lights(window):
    """红绿灯要常驻。

    pywebview 建 frameless 窗口时把三颗按钮 setHidden_(True) 了，我们在 shown 时放出来；
    但窗口尺寸变化、最大化、重新加载之后 AppKit 可能重新布局标题栏区域，
    所以在这些时机再断言一次，避免按钮消失。
    """
    for evt in ("loaded", "resized", "restored", "maximized", "minimized"):
        try:
            getattr(window.events, evt).__iadd__(lambda *a, w=window: _apply_mac_titlebar(w))
        except Exception:
            pass


_vibrancy_done = False


def _add_vibrancy(ns):
    """在网页内容底下垫一层毛玻璃。只加一次 —— 标题栏那套断言会被重复调用。

    只垫一层铺满整窗的 NSVisualEffectView，具体哪块透出来由 CSS 决定：
    侧栏用半透明背景所以能看到毛玻璃，中栏和聊天区是不透明色所以盖住它。
    这样不用在原生层去拼多个区域。
    """
    global _vibrancy_done
    import AppKit
    content = ns.contentView()
    if content is None or _vibrancy_done:
        return
    _vibrancy_done = True
    effect = AppKit.NSVisualEffectView.alloc().initWithFrame_(content.bounds())
    effect.setAutoresizingMask_(AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable)
    effect.setBlendingMode_(AppKit.NSVisualEffectBlendingModeBehindWindow)
    # 磨砂感来自材质本身，不靠把 CSS 调透明 —— 调透明会把侧栏颜色冲淡。
    # underWindowBackground 比 sidebar 更暗、更扩散，接近微信那种厚磨砂。
    for name in ("NSVisualEffectMaterialUnderWindowBackground",
                 "NSVisualEffectMaterialSidebar"):
        m = getattr(AppKit, name, None)
        if m is not None:
            try:
                effect.setMaterial_(m)
                break
            except Exception:
                continue
    # 锁定跟随系统外观，避免材质在深色模式下反而发白
    try:
        effect.setAppearance_(ns.effectiveAppearance())
    except Exception:
        pass
    effect.setState_(AppKit.NSVisualEffectStateActive)
    # 放到所有子视图下面，网页仍然在最上层
    content.addSubview_positioned_relativeTo_(effect, AppKit.NSWindowBelow, None)


class Api:
    """暴露给页面的原生能力（window.pywebview.api.*）。

    「查看全部」要开的是一个**真正的系统窗口**（自带红绿灯和标题栏），
    不是页面内的浮层，所以必须由原生层来 create_window。
    """

    def __init__(self):
        self.port = None
        self.main = None
        self.search_win = None

    def open_search_window(self, q=""):
        from urllib.parse import quote
        url = f"http://127.0.0.1:{self.port}/search_window?q={quote(q or '')}"
        if self.search_win is not None:
            try:
                self.search_win.load_url(url)
                return True
            except Exception:
                self.search_win = None
        self.search_win = webview.create_window(
            "搜索聊天记录", url,
            width=1020, height=720, min_size=(760, 520),
            js_api=self,
            frameless=True,   # 标题栏和内容融为一体，靠下面把标题和红绿灯放回来
            easy_drag=False,
        )

        def _closed():
            self.search_win = None

        def _shown():
            _unify_titlebar(self.search_win)
        self.search_win.events.closed += _closed
        self.search_win.events.shown += _shown
        return True

    def focus_chat(self, chat_id):
        """搜索窗口里点「进入聊天」，让主窗口切过去。"""
        if not self.main or not chat_id:
            return False
        safe = str(chat_id).replace("'", "")
        self.main.evaluate_js(
            f"(typeof groups!=='undefined'&&groups.some(g=>g.id==='{safe}'))"
            f"?openGroupChat('{safe}'):openChat('{safe}')"
        )
        if self.search_win is not None:
            try:
                self.search_win.destroy()
            except Exception:
                pass
            self.search_win = None
        return True


def _unify_titlebar(window):
    """标题栏与内容同色：frameless 已经让内容铺满整窗、标题栏透明，
    这里把红绿灯和标题文字放回来，于是看起来就是一整块深色。"""
    try:
        import AppKit
        from PyObjCTools import AppHelper
    except Exception:
        return

    def _on_main():
        ns = window.native
        if ns is None:
            return
        for btn in (AppKit.NSWindowCloseButton,
                    AppKit.NSWindowMiniaturizeButton,
                    AppKit.NSWindowZoomButton):
            b = ns.standardWindowButton_(btn)
            if b is not None:
                b.setHidden_(False)
        try:
            ns.setTitleVisibility_(0)          # NSWindowTitleVisible：标题要显示
            ns.setTitlebarSeparatorStyle_(0)   # 不要分隔线
        except Exception:
            pass

    AppHelper.callAfter(_on_main)


def _shutdown():
    """关窗时收尾：停掉 TTS 常驻进程和 Claude Code 子进程。"""
    try:
        from backend.voice import stop_engine
        stop_engine()
    except Exception:
        pass
    try:
        from backend.claude_session import _sessions, _lock
        with _lock:
            for sess in list(_sessions.values()):
                try:
                    sess._close()
                except Exception:
                    pass
            _sessions.clear()
    except Exception:
        pass


def main():
    port = find_free_port(5888)

    threading.Thread(
        target=lambda: app.run(
            host="127.0.0.1", port=port,
            debug=False, use_reloader=False, threaded=True,
        ),
        daemon=True,
    ).start()

    if not _wait_for_server(port):
        print("Flask 启动超时", file=sys.stderr)
        sys.exit(1)
    print(f"[app] backend ready on {port}", flush=True)

    api = Api()
    api.port = port

    window = webview.create_window(
        WINDOW_TITLE,
        f"http://127.0.0.1:{port}/?native=1",   # 页面据此不画假红绿灯
        width=DEFAULT_SIZE[0], height=DEFAULT_SIZE[1],
        min_size=MIN_SIZE,
        background_color="#EDEDED",
        resizable=True,
        frameless=True,      # 见 _apply_mac_titlebar：这条路径才有全尺寸内容视图
        easy_drag=False,     # 否则拖正文会挪窗口，选不中文字
        transparent=True,    # 让底下垫的 NSVisualEffectView 能透上来
        js_api=api,
    )
    api.main = window
    window.events.shown += lambda: _apply_mac_titlebar(window)
    _keep_traffic_lights(window)
    window.events.closed += _shutdown

    print("[app] window created, entering event loop", flush=True)
    webview.start()
    print("[app] event loop exited", flush=True)


if __name__ == "__main__":
    main()
